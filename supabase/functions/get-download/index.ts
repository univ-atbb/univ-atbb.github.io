import { createClient } from '@supabase/supabase-js';

// عميل Supabase للعميل (anon)
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default defineEventHandler(async (event) => {
  try {
    const { reference } = await getQuery(event);
    // استعلام الاستشارة من العرض العام
    const { data: tender, error } = await supabase
      .from('tenders_public')
      .select('*')
      .eq('reference', reference)
      .single();

    if (error || !tender) return sendError(event, 404, 'استشارة غير موجودة');

    // توليد اسم الملف الآمن
    const safeRef = String(tender.reference).replace(/[^0-9A-Za-z._-]+/g, '-');
    const fileName = 'tender_' + (safeRef || tender.id.slice(0, 8)) + '.pdf';

    // توليد رابط تحميل موقّت (Temporary Signed URL) صالح 10 دقائق
    const { data: signedUrl, error: signErr } = await supabase
      .storage
      .from('tenders')
      .createSignedUrl(String(tender.pdf_path), 600, {
        download: true,
        filename: fileName,
      });

    if (signErr || !signedUrl) {
      // logging error silently or returning generic error
      return sendError(event, 500, 'فشل في توليد رابط التحميل');
    }

    // تسجيل عملية التحميل (يمكن توسيعها لاحقاً)
    // await supabase.from('downloads').insert({ ... });

    return sendEvent(event, 200, {
      url: signedUrl.signedUrl,
      reference: tender.reference,
      expires_in: 600,
    });
  });