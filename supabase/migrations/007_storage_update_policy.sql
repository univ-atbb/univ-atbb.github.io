-- ============================================================
--  006: إصلاح "تغيير دفتر الشروط" — سياسة تحديث ملفات التخزين
--  السبب: الاستبدال يستخدم upsert (تحديث ملف موجود) ولا توجد
--         سياسة UPDATE على storage.objects =>
--         "new row violates row-level security policy"
--  التشغيل: Supabase Dashboard -> SQL Editor -> Run
-- ============================================================

drop policy if exists "storage_auth_update" on storage.objects;
create policy "storage_auth_update" on storage.objects
  for update
  using (bucket_id = 'tenders' and auth.uid() is not null)
  with check (bucket_id = 'tenders' and auth.uid() is not null);