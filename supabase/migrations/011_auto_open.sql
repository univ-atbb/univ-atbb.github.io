-- ============================================================
--  011: الفتح التلقائي + صفحة "تم فتح الأظرفة" العامة
--  1) pg_cron: كل دقيقة تُفتح تلقائيًا كل استشارة منشورة
--     حلّ موعد فتحها (status='opened', opened_at=now())
--  2) العرض العام يتضمّن المنشورة والمفتوحة معًا — حتى يرى
--     المتعامل صفحة "تم فتح الأظرفة" بدل "غير موجودة"
--  التشغيل: Supabase Dashboard -> SQL Editor -> الصق الكل -> Run
--  ملاحظة: حتى لو تعذّر pg_cron، تبقى الصفحة تعرض حالة الفتح
--          تلقائيًا (الكشف يتم في المتصفح من تاريخ الفتح).
-- ============================================================

-- ------------------------------------------------------------
-- 1) تفعيل pg_cron وجدولة الفتح التلقائي (محاولات آمنة)
-- ------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron غير متاح — الفتح التلقائي من قاعدة البيانات معطّل (الصفحة ستعرض الحالة تلقائيًا على أي حال)';
end
$$;

do $$
begin
  perform cron.unschedule('auto-open-tenders');
  perform cron.schedule('auto-open-tenders', '* * * * *',
    'update public.tenders
       set status = ''opened'', opened_at = now()
     where status = ''published''
       and opening_date is not null
       and opening_date <= now();');
exception
  when others then
    raise notice 'تعذّرت جدولة مهمة الفتح التلقائي (pg_cron) — الصفحة ستعرض الحالة تلقائيًا';
end
$$;

-- ------------------------------------------------------------
-- 2) العرض العام: المنشورة + المفتوحة
--    (يُضاف العمود opened_at لعرض وقت الفتح الفعلي)
-- ------------------------------------------------------------
drop view if exists public.tenders_public;
create view public.tenders_public as
  select id, reference, kind, title, duration, opening_date, status, opened_at
  from public.tenders
  where status in ('published','opened');

grant select on public.tenders_public to anon, authenticated;

-- ============================================================
--  نهاية. التحميل نفسه يبقى محميًا: دالة get-download ترفض
--  أي استشارة ليست 'published'، فلا يُحمَّل دفتر شروط مفتوحة.
-- ============================================================
