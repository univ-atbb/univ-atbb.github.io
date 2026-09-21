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
-- يجب drop view أولًا: create or replace لا يسمح بإضافة عمود جديد
-- وسياسة downloads_public_insert تعتمد على العرض فتُسقط أولًا وتُعاد بعدها
drop policy if exists "downloads_public_insert" on public.downloads;

drop view if exists public.tenders_public;
create view public.tenders_public as
  select id, reference, kind, title, duration, opening_date, status
  from public.tenders
  where status = 'published';

-- إعادة منح الصلاحيات (تُفقد عند إعادة إنشاء العرض)
grant select on public.tenders_public to anon, authenticated;

-- إعادة إنشاء سياسة الإدخال العام
create policy "downloads_public_insert" on public.downloads
  for insert with check (
    exists (select 1 from public.tenders_public t where t.id = tender_id)
  );
