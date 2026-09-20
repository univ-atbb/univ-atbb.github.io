-- ============================================================
--  بوابة مكتب الصفقات — Schema
--  التشغيل: Supabase Dashboard -> SQL Editor -> Run
-- ============================================================

-- ------------------------------------------------------------
-- 1) جداول
-- ------------------------------------------------------------
create table if not exists public.tenders (
  id            uuid primary key default gen_random_uuid(),
  reference     text unique not null,
  title         text not null,
  duration      text,
  opening_date  timestamptz not null,
  pdf_path      text,
  status        text not null default 'published'
                check (status in ('published','opened')),
  opened_at     timestamptz,
  opened_by     uuid,
  created_at    timestamptz not null default now()
);

create table if not exists public.downloads (
  id            uuid primary key default gen_random_uuid(),
  tender_id     uuid not null references public.tenders(id) on delete cascade,
  company       text not null,
  phone         text not null,
  email         text not null,
  ip_address    text,
  user_agent    text,
  downloaded_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) فهارس
-- ------------------------------------------------------------
create index if not exists idx_tenders_status   on public.tenders(status);
create index if not exists idx_tenders_opening  on public.tenders(opening_date);
create index if not exists idx_tenders_created  on public.tenders(created_at desc);
create index if not exists idx_downloads_tender on public.downloads(tender_id);
create index if not exists idx_downloads_email  on public.downloads(email);

-- ------------------------------------------------------------
-- 3) Row Level Security
-- ------------------------------------------------------------
alter table public.tenders   enable row level security;
alter table public.downloads enable row level security;

-- سياسات MVP (مفتوحة للتجربة — استبدلها بسياسات الإنتاج في الأسفل)
drop policy if exists "tenders_read_mvp" on public.tenders;
create policy "tenders_read_mvp" on public.tenders
  for select using (true);

drop policy if exists "tenders_insert_mvp" on public.tenders;
create policy "tenders_insert_mvp" on public.tenders
  for insert with check (true);

drop policy if exists "tenders_update_mvp" on public.tenders;
create policy "tenders_update_mvp" on public.tenders
  for update using (true) with check (true);

drop policy if exists "downloads_read_mvp" on public.downloads;
create policy "downloads_read_mvp" on public.downloads
  for select using (true);

drop policy if exists "downloads_insert_mvp" on public.downloads;
create policy "downloads_insert_mvp" on public.downloads
  for insert with check (
  exists (select 1 from public.tenders t
          where t.id = tender_id and t.status = 'published')
);

-- ------------------------------------------------------------
-- 4) التخزين: Bucket خاص باسم "tenders"
--    مسار الملف: tenders/{tender_id}.pdf  (حد 10MB من جهة الواجهة)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('tenders', 'tenders', false)
on conflict (id) do nothing;

drop policy if exists "storage_read_mvp" on storage.objects;
create policy "storage_read_mvp" on storage.objects
  for select using (bucket_id = 'tenders');

drop policy if exists "storage_write_mvp" on storage.objects;
create policy "storage_write_mvp" on storage.objects
  for insert with check (bucket_id = 'tenders');

drop policy if exists "storage_delete_mvp" on storage.objects;
create policy "storage_delete_mvp" on storage.objects
  for delete using (bucket_id = 'tenders');

-- ============================================================
--  سياسات الإنتاج (بعد تفعيل Supabase Auth — اختياري لاحقًا)
-- ------------------------------------------------------------
-- drop policy "tenders_read_mvp"   on public.tenders;
-- drop policy "tenders_insert_mvp" on public.tenders;
-- drop policy "tenders_update_mvp" on public.tenders;
-- drop policy "downloads_read_mvp" on public.downloads;
--
-- create policy "tenders_read_published" on public.tenders
--   for select using (status = 'published' or auth.role() = 'authenticated');
-- create policy "tenders_admin_insert" on public.tenders
--   for insert with check (auth.role() = 'authenticated');
-- create policy "tenders_admin_update" on public.tenders
--   for update using (auth.role() = 'authenticated');
-- create policy "downloads_admin_read" on public.downloads
--   for select using (auth.role() = 'authenticated');
-- ============================================================
