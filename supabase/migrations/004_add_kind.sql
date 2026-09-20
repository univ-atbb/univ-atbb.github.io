-- ============================================================
--  004: نوع الصفقة (استشارة / طلب عروض)
--  التشغيل: Supabase Dashboard -> SQL Editor -> Run
-- ============================================================

-- 'consultation' = استشارة   |   'tender' = طلب عروض
-- القيمة الافتراضية 'consultation' (الاستشارات القديمة تبقى كما هي)
alter table public.tenders
  add column if not exists kind text not null default 'consultation'
  check (kind in ('consultation', 'tender'));

-- تحديث العرض العام ليحتوي النوع (تظهر على صفحة المتعامل)
create or replace view public.tenders_public as
  select id, reference, kind, title, duration, opening_date, status
  from public.tenders
  where status = 'published';
