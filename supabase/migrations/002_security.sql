-- ============================================================
--  002_security.sql — ترقية الأمان: قفل القاعدة بالأدوار
--  التشغيل: SQL Editor -> New query (بعد تشغيل 001)
-- ============================================================

-- 1) حذف السياسات المفتوحة (وضع التجربة)
drop policy if exists "tenders_read_mvp"     on public.tenders;
drop policy if exists "tenders_insert_mvp"   on public.tenders;
drop policy if exists "tenders_update_mvp"   on public.tenders;
drop policy if exists "downloads_read_mvp"   on public.downloads;
drop policy if exists "downloads_insert_mvp" on public.downloads;
drop policy if exists "storage_read_mvp"     on storage.objects;
drop policy if exists "storage_write_mvp"    on storage.objects;
drop policy if exists "storage_delete_mvp"   on storage.objects;

-- 2) عرض عام للمتعامل: حقول الاستشارة المنشورة فقط
--    (بدون pdf_path — لا يعرف المتعامل أبداً أين يوجد الملف)
create or replace view public.tenders_public as
  select id, reference, title, duration, opening_date, status
  from public.tenders
  where status = 'published';

grant select on public.tenders_public to anon, authenticated;

-- 3) جدول الاستشارات الحقيقي: للمصادَق فقط
drop policy if exists "tenders_auth_read" on public.tenders;
create policy "tenders_auth_read" on public.tenders
  for select using (auth.uid() is not null);

drop policy if exists "tenders_auth_insert" on public.tenders;
create policy "tenders_auth_insert" on public.tenders
  for insert with check (auth.uid() is not null);

drop policy if exists "tenders_auth_update" on public.tenders;
create policy "tenders_auth_update" on public.tenders
  for update using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- 4) سجل التحميلات: القراءة للمصادَق فقط
--    الكتابة عامة لكن فقط لاستشارة منشورة (عبر العرض العام)
drop policy if exists "downloads_auth_read" on public.downloads;
create policy "downloads_auth_read" on public.downloads
  for select using (auth.uid() is not null);

drop policy if exists "downloads_public_insert" on public.downloads;
create policy "downloads_public_insert" on public.downloads
  for insert with check (
    exists (select 1 from public.tenders_public t where t.id = tender_id)
  );

-- 5) التخزين: رفع وحذف للمصادَق فقط
drop policy if exists "storage_auth_write" on storage.objects;
create policy "storage_auth_write" on storage.objects
  for insert with check (bucket_id = 'tenders' and auth.uid() is not null);

drop policy if exists "storage_auth_delete" on storage.objects;
create policy "storage_auth_delete" on storage.objects
  for delete using (bucket_id = 'tenders' and auth.uid() is not null);

-- ============================================================
-- ملاحظة: المتعامل لا يقرأ الملفات إطلاقًا من المتصفح.
-- رابط التحميل يولَّده Edge Function "get-download" على
-- خادم Supabase (بصلاحية service) بعد التحقق والتسجيل.
-- ============================================================
