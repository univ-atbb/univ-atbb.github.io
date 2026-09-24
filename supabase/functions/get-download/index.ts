// ============================================================
//  Edge Function: get-download (عام — بدون تسجيل)
//  بعد التحقق من الاستشارة وتسجيل بيانات المتعامل،
//  يولّد رابط تحميل مؤقتًا صالحًا 10 دقائق.
//  يعمل من الخادم، فلا يرى المتعامل مسار الملف أبدًا.
//  يدعم: التخزين القديم (Supabase) + Cloudflare R2 (الجديد)
//  ----------------------------------------------------------
//  الاسم: get-download   |   الإعدادات: Allow anonymous calls
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/* ---------- توقيع S3 (SigV4) لرابط R2 المؤقت ---------- */

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

async function presignGet(
  host: string,
  bucket: string,
  key: string,
  accessKeyId: string,
  secret: string,
  expires: number,
  extraQuery: Record<string, string>
): Promise<string> {
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const scope = dateStamp + '/' + region + '/s3/request';
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': accessKeyId + '/' + scope,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
    ...extraQuery,
  };
  const entries = Object.keys(query)
    .map((k) => [rfc3986(k), rfc3986(query[k])] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalQuery = entries.map((p) => p[0] + '=' + p[1]).join('&');
  const canonicalUri = '/' + bucket + '/' + key.split('/').map(rfc3986).join('/');
  const canonicalRequest = ['GET', canonicalUri, canonicalQuery, 'host:' + host + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signature = toHex(await hmacSha256(await deriveKey(secret, dateStamp, region), stringToSign));
  return 'https://' + host + canonicalUri + '?' + canonicalQuery + '&X-Amz-Signature=' + signature;
}

async function r2Config(db: any): Promise<{ host: string; bucket: string; accessKeyId: string; secret: string }> {
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
    accessKeyId: m.r2_access_key_id,
    secret: m.r2_secret_access_key,
  };
}

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/* ---------- بريد الإيصال التلقائي (SMTP — Brevo مجاني) ----------
   يُفعَّل تلقائيًا عند ضبط السرّات الثلاث:
   EMAIL_SMTP_USER (ba8c46001@smtp-brevo.com)
   EMAIL_SMTP_PASS (كلمة مرور SMTP)
   EMAIL_FROM      (البريد المسجَّل في حساب Brevo — منه يُرسل الإيصال)
   فشل البريد لا يوقف التحميل أبدًا. */

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]
  );
}

async function sendReceiptEmail(opts: {
  email: string;
  company: string;
  phone: string;
  kind: string;
  reference: string;
  title: string;
}): Promise<void> {
  const user = Deno.env.get('EMAIL_SMTP_USER') || '';
  const pass = Deno.env.get('EMAIL_SMTP_PASS') || '';
  const from = Deno.env.get('EMAIL_FROM') || '';
  if (!user || !pass || !from || !opts.email) return;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.email)) return;
  let transporter: nodemailer.Transporter | null = null;
  try {
    const kindName = opts.kind === 'tender' ? 'طلب عروض' : 'استشارة';
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-DZ', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });
    const subject = 'إيصال تحميل — ' + kindName + ' ' + opts.reference;
    const row = (l: string, v: string) =>
      '<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;color:#64748b;white-space:nowrap">' + l +
      '</td><td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:bold;color:#0f172a">' + v + '</td></tr>';
    const html =
      '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:520px;margin:auto;background:#f8fafc;border-radius:12px;overflow:hidden">' +
      '<div style="background:#0f766e;color:#fff;padding:14px 20px;text-align:center">' +
      '<div style="font-size:15px;font-weight:bold">جامعة عين تموشنت - كلية العلوم و التكنولوجيا</div>' +
      '<div style="font-size:12px;opacity:.85">مكتب الصفقات — إيصال تحميل إلكتروني</div></div>' +
      '<div style="padding:20px">' +
      '<p style="margin:0 0 12px;font-size:14px;color:#334155">تم تسجيل تحميل دفتر الشروط بنجاح. نرجو الاحتفاظ بهذا الإيصال.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      row('النوع', kindName) +
      row('المرجع', escapeHtml(opts.reference)) +
      row('العنوان', escapeHtml(opts.title)) +
      row('الشركة', escapeHtml(opts.company)) +
      row('الهاتف', escapeHtml(opts.phone)) +
      row('التاريخ', dateStr + ' — ' + timeStr) +
      '</table>' +
      '<p style="margin:14px 0 0;font-size:11px;color:#94a3b8">هذا بريد آلي من بوابة مكتب الصفقات — لا حاجة للرد.</p>' +
      '</div></div>';
    transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: 'مكتب الصفقات <' + from + '>',
      to: opts.email,
      subject,
      html,
    });
  } catch (e) {
    console.error('email failed', e);
  } finally {
    if (transporter) transporter.close();
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const tenderId = String(body.tender_id || '');
  const company = String(body.company || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const noLogRequested = body.no_log === true;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenderId)) {
    return json({ error: 'bad_request' }, 400);
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // تحميل داخلي (لوحة الموظفين): يُسكت السجل فقط إذا كان المستدعي موظفًا مسجَّلًا (وليس الموقع العام)
  let isStaff = false;
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (bearer) {
    try {
      const { data } = await db.auth.getUser(bearer);
      isStaff = !!(data && data.user);
    } catch {
      isStaff = false;
    }
  }
  const noLog = noLogRequested && isStaff;

  if (!noLog && (!company || !phone || !email)) {
    return json({ error: 'missing_fields' }, 400);
  }

  // تحقق من المدخلات (طول + تنسيق) — لمنع الإسهاب والبيانات الفاسدة
  if (!noLog) {
    if (company.length > 120 || phone.length > 30 || email.length > 120) return json({ error: 'bad_request' }, 400);
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 8 || phoneDigits.length > 15) return json({ error: 'bad_phone' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'bad_email' }, 400);
  }

  // 1) تحقق: الاستشارة موجودة ومنشورة
  const { data: tender, error: tErr } = await db
    .from('tenders')
    .select('id, reference, kind, title, pdf_path, pdf_source, status, opening_date')
    .eq('id', tenderId)
    .maybeSingle();
  if (tErr || !tender || tender.status !== 'published') {
    return json({ error: 'unavailable' }, 404);
  }

  // 2) تسجيل/تحديث بيانات المتعامل — (يُتخطى في التحميل الداخلي)
  let isUpdate = false;
  if (!noLog) {
    const ip =
      (req.headers.get('cf-connecting-ip') ||
        req.headers.get('x-forwarded-for') ||
        '').split(',')[0].trim() || null;
    const ua = (req.headers.get('user-agent') || '').slice(0, 500);

    // تحييد إساءة الاستخدام: حد 5 تحميلات/ساعة لكل عنوان IP
    if (ip) {
      const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count: recent, error: cntErr } = await db
        .from('downloads')
        .select('id', { count: 'exact', head: true })
        .eq('ip_address', ip)
        .gte('downloaded_at', hourAgo);
      if (!cntErr && recent !== null && recent >= 5) {
        return json({ error: 'rate_limited' }, 429);
      }
    }

    // تطبيع الهاتف: أرقام فقط، بدون 213 وبدون الصفر الأول (آخر 9 خانات)
    const norm = (p: string) => {
      let d = p.replace(/\D/g, '');
      if (d.startsWith('213')) d = d.slice(3);
      if (d.startsWith('0')) d = d.slice(1);
      return d.slice(-9);
    };
    const phoneKey = norm(phone);

    const { data: existing, error: qErr } = await db
      .from('downloads')
      .select('id, phone')
      .eq('tender_id', tenderId);
    if (!qErr && existing && existing.length) {
      const match = existing.find((r: any) => norm(String(r.phone)) === phoneKey);
      if (match) {
        const { error: uErr } = await db
          .from('downloads')
          .update({ company, email, ip_address: ip, user_agent: ua, downloaded_at: new Date().toISOString() })
          .eq('id', match.id);
        if (uErr) return json({ error: 'record_failed' }, 500);
        isUpdate = true;
      } else {
        const { error: iErr } = await db.from('downloads').insert({
          tender_id: tenderId, company, phone, email, ip_address: ip, user_agent: ua,
        });
        if (iErr) return json({ error: 'record_failed' }, 500);
      }
    } else {
      // تعذر الجلب المسبق — نكتفي بالإدراج
      const { error: iErr } = await db.from('downloads').insert({
        tender_id: tenderId, company, phone, email, ip_address: ip, user_agent: ua,
      });
      if (iErr) return json({ error: 'record_failed' }, 500);
    }
  }

  // اسم الملف عند التحميل (لاتيني لتوافق كل الأجهزة)
  const safeRef = String(tender.reference).replace(/[^0-9A-Za-z._-]+/g, '-');
  const fileName = 'tender_' + (safeRef || tenderId.slice(0, 8)) + '.pdf';

  try {
    let url: string;

    if (tender.pdf_source === 'r2') {
      // 3a) رابط R2 موقّع (600 ثانية) مع فرض تنزيل باسم الملف
      const cfg = await r2Config(db);
      url = await presignGet(
        cfg.host,
        cfg.bucket,
        String(tender.pdf_path),
        cfg.accessKeyId,
        cfg.secret,
        600,
        {
          'response-content-type': 'application/pdf',
          'response-content-disposition': 'attachment; filename="' + fileName + '"',
        }
      );
    } else {
      // 3b) التخزين القديم (Supabase Storage)
      const { data: s, error: sErr } = await db.storage
        .from('tenders')
        .createSignedUrl(String(tender.pdf_path), 600, { download: true, filename: fileName });
      if (sErr || !s) return json({ error: 'link_failed' }, 500);
      url = s.signedUrl;
    }

    // 4) إيصال بريدي تلقائي (جهد — لا يوقف التحميل) — ليس في التحميل الداخلي
    if (!noLog) {
      await sendReceiptEmail({
        email,
        company,
        phone,
        kind: String(tender.kind),
        reference: tender.reference,
        title: String(tender.title || ''),
      });
    }

    return json({ url, reference: tender.reference, expires_in: 600, updated: isUpdate }, 200);
  } catch (err: any) {
    if (String((err && err.message) || err) === 'r2_not_configured') {
      return json({ error: 'r2_not_configured' }, 503);
    }
    console.error(err);
    return json({ error: String((err && err.message) || err) }, 500);
  }
});
