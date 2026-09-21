-- ============================================================
--  006: تحديث كامل — آمن إعادة تشغيله
--  ينفذ (003 + 004 + 005) في مرة واحدة.
--  التشغيل: Supabase Dashboard -> SQL Editor -> الصق الكل -> Run
--  (إن سبقك تشغيل 003/004/005 على حدة، فلا ضرر من إعادة هذا)
-- ============================================================

-- ------------------------------------------------------------
-- [003] دعم R2: عمود pdf_source + جدول app_config
-- ------------------------------------------------------------
alter table public.tenders
  add column if not exists pdf_source text not null default 'supabase';

create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;

-- ------------------------------------------------------------
-- [004] نوع الصفقة (استشارة / طلب عروض) + تحديث العرض العام
-- ------------------------------------------------------------
alter table public.tenders
  add column if not exists kind text not null default 'consultation'
  check (kind in ('consultation', 'tender'));

-- يجب إسقاط العرض أولًا: create or replace لا يسمح بإضافة عمود جديد
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

-- ------------------------------------------------------------
-- [005] السماح للموظف بحذف الاستشارات (السجلات تُحذف تلقائيًا)
-- ------------------------------------------------------------
drop policy if exists "tenders_auth_delete" on public.tenders;
create policy "tenders_auth_delete" on public.tenders
  for delete using (auth.uid() is not null);

-- ------------------------------------------------------------
-- [إضافي] السماح بتحديث ملفات التخزين (احتياطي لاستبدال دفتر الشروط)
-- ------------------------------------------------------------
drop policy if exists "storage_auth_update" on storage.objects;
create policy "storage_auth_update" on storage.objects
  for update
  using (bucket_id = 'tenders' and auth.uid() is not null)
  with check (bucket_id = 'tenders' and auth.uid() is not null);
