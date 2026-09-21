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

create or replace view public.tenders_public as
  select id, reference, kind, title, duration, opening_date, status
  from public.tenders
  where status = 'published';

-- ------------------------------------------------------------
-- [005] السماح للموظف بحذف الاستشارات (السجلات تُحذف تلقائيًا)
-- ------------------------------------------------------------
drop policy if exists "tenders_auth_delete" on public.tenders;
create policy "tenders_auth_delete" on public.tenders
  for delete using (auth.uid() is not null);
