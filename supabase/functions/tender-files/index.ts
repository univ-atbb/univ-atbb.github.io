// ============================================================
//  Edge Function: tender-files
//  عمليات الملفات الخاصة بالموظف (تخزين Cloudflare R2):
//   - prepare-upload  : يجهّز رقم الملف ورابط رفع مباشر (30 دقيقة)
//   - finalize-upload : بعد نجاح الرفع، يسجّل الاستشارة
//   - cancel-upload   : يحذف الملف إذا فشل شيء ما
//   - open-tender     : فتح الأظرفة: حذف الملف نهائيًا + تحديث الحالة
//  ----------------------------------------------------------
//  الإنشاء: Supabase Dashboard -> Edge Functions -> New function
//  الاسم: tender-files   |   الإعدادات: يبقى Protected (بدون anonymous)
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_SIZE = 500 * 1024 * 1024; // سقف أمني 500MB (الواجهة تسمح بـ 200MB)

/* ---------- توقيعات S3 (SigV4) — بدون مكتبات خارجية ---------- */

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

async function hmacSha256(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}

async function deriveKey(secret: string, dateStamp: string, region: string): Promise<Uint8Array> {
  let k = await hmacSha256(new TextEncoder().encode('AWS4' + secret), dateStamp);
  k = await hmacSha256(k, region);
  k = await hmacSha256(k, 's3');
  return hmacSha256(k, 'aws4_request');
}

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function timestamps(): { amzDate: string; dateStamp: string } {
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

type Cfg = {
  host: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secret: string;
  region: string;
};

// رابط مؤقت (رفع/تنزيل من المتصفح)
async function presignUrl(method: 'GET' | 'PUT', cfg: Cfg, expires: number, extraQuery?: Record<string, string>): Promise<string> {
  const { amzDate, dateStamp } = timestamps();
  const scope = dateStamp + '/' + cfg.region + '/s3/request';
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': cfg.accessKeyId + '/' + scope,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
    ...(extraQuery || {}),
  };
  const entries = Object.keys(query)
    .map((k) => [rfc3986(k), rfc3986(query[k])] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalQuery = entries.map((p) => p[0] + '=' + p[1]).join('&');
  const canonicalUri = '/' + cfg.bucket + '/' + cfg.key.split('/').map(rfc3986).join('/');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, 'host:' + cfg.host + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signature = toHex(await hmacSha256(await deriveKey(cfg.secret, dateStamp, cfg.region), stringToSign));
  return 'https://' + cfg.host + canonicalUri + '?' + canonicalQuery + '&X-Amz-Signature=' + signature;
}

// طلب موقّع من الخادم (HEAD / DELETE)
async function signedRequest(method: 'HEAD' | 'DELETE', cfg: Cfg): Promise<Response> {
  const { amzDate, dateStamp } = timestamps();
  const scope = dateStamp + '/' + cfg.region + '/s3/request';
  const payloadHash = await sha256Hex('');
  const headers: Record<string, string> = {
    host: cfg.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((h) => h + ':' + headers[h] + '\n').join('');
  const signedHeaders = names.join(';');
  const canonicalUri = '/' + cfg.bucket + '/' + cfg.key.split('/').map(rfc3986).join('/');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signature = toHex(await hmacSha256(await deriveKey(cfg.secret, dateStamp, cfg.region), stringToSign));
  const authorization =
    'AWS4-HMAC-SHA256 Credential=' + cfg.accessKeyId + '/' + scope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  const url = 'https://' + cfg.host + canonicalUri;
  return fetch(url, {
    method,
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
  });
}

/* ---------- إعداد R2 من جدول app_config ---------- */

async function r2Config(db: any): Promise<Cfg> {
  const { data, error } = await db
    .from('app_config')
    .select('key, value')
    .in('key', ['r2_access_key_id', 'r2_secret_access_key', 'r2_bucket', 'r2_account_id']);
  if (error) throw error;
  const m: Record<string, string> = {};
  (data || []).forEach((r: any) => (m[r.key] = r.value));
  const missing = ['r2_access_key_id', 'r2_secret_access_key', 'r2_bucket', 'r2_account_id'].filter((k) => !m[k]);
  if (missing.length) throw new Error('r2_not_configured');
  return {
    host: m.r2_account_id + '.r2.cloudflarestorage.com',
    bucket: m.r2_bucket,
    key: '',
    accessKeyId: m.r2_access_key_id,
    secret: m.r2_secret_access_key,
    region: 'auto',
  };
}

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // موظفون فقط (JWT)
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  if (userErr || !userData || !userData.user) return json({ error: 'unauthorized' }, 401);
  const userId = userData.user.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  try {
    const action = String(body.action || '');
    const tenderId = String(body.tender_id || '');

    /* ----- 1) تجهيز الرفع ----- */
    if (action === 'prepare-upload') {
      const size = Number(body.size || 0);
      if (!size || size < 1 || size > MAX_SIZE) return json({ error: 'bad_size' }, 400);
      const cfg = await r2Config(db);
      const id = crypto.randomUUID();
      const uploadUrl = await presignUrl('PUT', { ...cfg, key: id + '.pdf' }, 1800);
      return json({ tender_id: id, upload_url: uploadUrl });
    }

    /* ----- 2) النشر بعد نجاح الرفع ----- */
    if (action === 'finalize-upload') {
      const kind = String(body.kind || 'consultation') === 'tender' ? 'tender' : 'consultation';
      const reference = String(body.reference || '').trim();
      const title = String(body.title || '').trim();
      const duration = String(body.duration || '').trim() || null;
      const opening = String(body.opening_date || '');
      if (!tenderId || !reference || !title || !opening) return json({ error: 'missing_fields' }, 400);

      const cfg = await r2Config(db);
      const key = tenderId + '.pdf';

      // تأكيد أن الملف رُفع فعلًا إلى R2
      const head = await signedRequest('HEAD', { ...cfg, key });
      if (head.status === 404) return json({ error: 'file_not_uploaded' }, 400);
      if (!head.ok) return json({ error: 'r2_check_failed (' + head.status + ')' }, 502);

      const { error: insErr } = await db.from('tenders').insert({
        id: tenderId,
        kind,
        reference,
        title,
        duration,
        opening_date: new Date(opening).toISOString(),
        pdf_path: key,
        pdf_source: 'r2',
        status: 'published',
      });
      if (insErr) {
        // حذف الملف لتفادي الملفات اليتيمة
        await signedRequest('DELETE', { ...cfg, key }).catch(() => {});
        if (String(insErr.message).toLowerCase().includes('duplicate')) {
          return json({ error: 'duplicate_reference' }, 409);
        }
        return json({ error: insErr.message }, 500);
      }
      return json({ ok: true, tender_id: tenderId, reference });
    }

    /* ----- 3) إلغاء رفع (تنظيف) ----- */
    if (action === 'cancel-upload') {
      if (!tenderId) return json({ error: 'bad_request' }, 400);
      const cfg = await r2Config(db);
      await signedRequest('DELETE', { ...cfg, key: tenderId + '.pdf' }).catch(() => {});
      return json({ ok: true });
    }

    /* ----- 4) فتح الأظرفة: حذف نهائي + تحديث الحالة ----- */
    if (action === 'open-tender') {
      if (!tenderId) return json({ error: 'bad_request' }, 400);
      const { data: t, error: tErr } = await db
        .from('tenders')
        .select('*')
        .eq('id', tenderId)
        .maybeSingle();
      if (tErr || !t) return json({ error: 'not_found' }, 404);
      if (t.status !== 'published') return json({ error: 'already_opened' }, 409);

      // حذف الملف نهائيًا (R2 أو التخزين القديم)
      try {
        if (t.pdf_source === 'r2') {
          const cfg = await r2Config(db);
          const del = await signedRequest('DELETE', { ...cfg, key: t.pdf_path });
          if (!del.ok && del.status !== 404) console.warn('R2 delete failed:', del.status);
        } else if (t.pdf_path) {
          const path = String(t.pdf_path).split('/').map(encodeURIComponent).join('/');
          const delRes = await fetch(
            Deno.env.get('SUPABASE_URL')! + '/storage/v1/object/tenders/' + path,
            {
              method: 'DELETE',
              headers: { Authorization: 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! },
            }
          );
          if (!delRes.ok && delRes.status !== 400) console.warn('Supabase storage delete failed:', delRes.status);
        }
      } catch (e) {
        console.warn('File delete warning:', e);
      }

      const { data: up, error: upErr } = await db
        .from('tenders')
        .update({ status: 'opened', opened_at: new Date().toISOString(), opened_by: userId })
        .eq('id', tenderId)
        .eq('status', 'published')
        .select('id');
      if (upErr || !up || !up.length) return json({ error: 'update_failed' }, 500);
      return json({ ok: true });
    }

    /* ----- 5) تجهيز استبدال ملف استشارة (نفس المفتاح → نفس QR) ----- */
    if (action === 'prepare-replace') {
      if (!tenderId) return json({ error: 'bad_request' }, 400);
      const { data: t, error: tErr } = await db
        .from('tenders')
        .select('*')
        .eq('id', tenderId)
        .maybeSingle();
      if (tErr || !t) return json({ error: 'not_found' }, 404);
      if (t.status !== 'published' || t.pdf_source !== 'r2') return json({ error: 'bad_state' }, 409);
      const cfg = await r2Config(db);
      const uploadUrl = await presignUrl('PUT', { ...cfg, key: t.pdf_path }, 1800);
      return json({ upload_url: uploadUrl });
    }

    /* ----- 6) حذف استشارة (الملف + الصف + سجلات التحميل) ----- */
    if (action === 'delete-tender') {
      if (!tenderId) return json({ error: 'bad_request' }, 400);
      const { data: t, error: tErr } = await db
        .from('tenders')
        .select('*')
        .eq('id', tenderId)
        .maybeSingle();
      if (tErr || !t) return json({ error: 'not_found' }, 404);
      try {
        if (t.pdf_source === 'r2' && t.pdf_path) {
          const cfg = await r2Config(db);
          await signedRequest('DELETE', { ...cfg, key: t.pdf_path }).catch(() => {});
        }
      } catch (e) {
        console.warn('delete file warn:', e);
      }
      const { error: delErr } = await db.from('tenders').delete().eq('id', tenderId);
      if (delErr) return json({ error: delErr.message }, 500);
      return json({ ok: true });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (err: any) {
    if (String((err && err.message) || err) === 'r2_not_configured') {
      return json({ error: 'r2_not_configured' }, 503);
    }
    console.error(err);
    return json({ error: String((err && err.message) || err) }, 500);
  }
});
