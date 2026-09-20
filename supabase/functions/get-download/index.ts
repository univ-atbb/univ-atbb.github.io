// ============================================================
//  Edge Function: get-download
//  يولّد رابط تحميل مؤقت (10 دقائق) بعد التحقق والتسجيل
//  — يعمل بخادم Supabase، فلا يرى المتعامل مسار الملف أبدًا
//  ----------------------------------------------------------
//  الإنشاء: Supabase Dashboard -> Edge Functions -> New function
//  الاسم: get-download   |   الإعدادات: Allow anonymous calls
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const tenderId = String(body.tender_id || '');
  const company = String(body.company || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenderId)) {
    return json({ error: 'bad_request' }, 400);
  }
  if (!company || !phone || !email) {
    return json({ error: 'missing_fields' }, 400);
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 1) تحقق: الاستشارة موجودة ومنشورة
  const { data: tender, error: tErr } = await db
    .from('tenders')
    .select('id, reference, pdf_path, status, opening_date')
    .eq('id', tenderId)
    .maybeSingle();
  if (tErr || !tender || tender.status !== 'published') {
    return json({ error: 'unavailable' }, 404);
  }

  // 2) تسجيل بيانات المتعامل
  const ip =
    (req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-forwarded-for') ||
      '').split(',')[0].trim() || null;
  const { error: dErr } = await db.from('downloads').insert({
    tender_id: tenderId,
    company,
    phone,
    email,
    ip_address: ip,
    user_agent: (req.headers.get('user-agent') || '').slice(0, 500),
  });
  if (dErr) return json({ error: 'record_failed' }, 500);

  // 3) توليد رابط موقّع صالح 10 دقائق
  const { data: s, error: sErr } = await db.storage
    .from('tenders')
    .createSignedUrl(tender.pdf_path, 600);
  if (sErr || !s) return json({ error: 'link_failed' }, 500);

  return json(
    { url: s.signedUrl, reference: tender.reference, expires_in: 600 },
    200
  );
});

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
