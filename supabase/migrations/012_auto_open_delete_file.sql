-- ============================================================
--  012: الفتح التلقائي + حذف ملف دفتر الشروط (توفير مساحة)
--  - يعيد جدولة مهمة الفتح التلقائي (من 011) لتعمل:
--    1) حذف ملف دفتر الشروط من التخزين (Supabase Storage)
--    2) ثم تحويل الحالة إلى "مفتوحة"
--  - الاستشارة تبقى على المنصة بصفحة "تم فتح الأظرفة"
--    (العرض العام يشمل المنشورة والمفتوحة)
--  - ملاحظة: يعمل مع Supabase Storage. إن استُخدم R2 مستقبلاً
--    يبقى ملفه (التحميل محظور في كل الأحوال).
--  التشغيل: Supabase Dashboard -> SQL Editor -> الصق الكل -> Run
--  (هذا الملف شامل: إن لم تشغّل 011 من قبل، لا حاجة له)
-- ============================================================

-- ------------------------------------------------------------
-- 1) تفعيل pg_cron (إن لم يكن مفعّلًا بعد)
-- ------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron غير متاح — حذف الملف التلقائي معطّل';
end
$$;

-- ------------------------------------------------------------
-- 2) إعادة جدولة المهمة: حذف الملف ثم الفتح
-- ------------------------------------------------------------
do $$
begin
  perform cron.unschedule('auto-open-tenders');
  perform cron.schedule('auto-open-tenders', '* * * * *', $cmd$
    -- (أ) حذف ملفات دفاتر الشروط التي حلّ موعد فتحها
    delete from storage.objects so
    using public.tenders t
    where t.status = 'published'
      and t.opening_date is not null
      and t.opening_date <= now()
      and t.pdf_path is not null
      and coalesce(t.pdf_source, 'supabase') = 'supabase'
      and so.bucket_id = 'tenders'
      and so.name = t.pdf_path;

    -- (ب) تحويلها إلى مفتوحة
    update public.tenders
    set status = 'opened', opened_at = now()
    where status = 'published'
      and opening_date is not null
      and opening_date <= now();
  $cmd$);
exception
  when others then
    raise notice 'تعذّرت جدولة مهمة الفتح التلقائي (pg_cron)';
end
$$;

-- ------------------------------------------------------------
-- 3) العرض العام: المنشورة + المفتوحة (بما في ذلك وقت الفتح)
-- ------------------------------------------------------------
drop view if exists public.tenders_public;
create view public.tenders_public as
  select id, reference, kind, title, duration, opening_date, status, opened_at
  from public.tenders
  where status in ('published','opened');

grant select on public.tenders_public to anon, authenticated;

-- ============================================================
--  تحقق اختياري — يجب أن تظهر سطر auto-open-tenders:
--    select jobname, schedule from cron.job;
-- ============================================================
