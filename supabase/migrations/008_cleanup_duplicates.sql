-- ============================================================
--  008: تنظيف التكرار في سجل التحميلات (عملية لمرة واحدة)
--  يحتفظ بأحدث سجل لكل هاتف ضمن كل استشارة ويحذف الباقي
--  + يزيل صف الفحص الاختباري (هاتف 000000000)
--  التشغيل: Supabase Dashboard -> SQL Editor -> الصق -> Run
-- ============================================================

-- 1) إزالة صف الفحص الاختباري
delete from public.downloads where phone = '000000000';

-- 2) إزالة المكرر: أحدث سجل لكل (استشارة + هاتف) هو الذي يبقى
delete from public.downloads
where id in (
  select id from (
    select id,
           row_number() over (
             partition by tender_id, regexp_replace(phone, '[^0-9]', '', 'g')
             order by downloaded_at desc
           ) as rn
    from public.downloads
  ) t
  where rn > 1
);
