-- ============================================================
--  009: تقوية الأمان — قفل الأدوار
--  1) الدور ينتقل من user_metadata إلى app_metadata
--     (app_metadata لا يستطيع المستخدم كتابته من المتصفح)
--  2) سياسات RLS تُقفل حسب الدور داخل التوكن
--  التشغيل: Supabase Dashboard -> SQL Editor -> Run
--  ملاحظة: بعد التشغيل، كل موظف يسجّل خروجًا ثم دخولًا مرة واحدة
-- ============================================================

-- ------------------------------------------------------------
-- 1) نقل الدور إلى raw_app_meta_data (للمستخدمين الحاليين)
--    (لا يستطيع المستخدم كتابة هذا العمود من المتصفح)
-- ------------------------------------------------------------
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('role', raw_user_meta_data->>'role')
where raw_user_meta_data ? 'role'
  and raw_user_meta_data->>'role' in ('admin', 'committee', 'opener');

-- ------------------------------------------------------------
-- 2) إزالة الدور من raw_user_meta_data (كان قابلًا للتعديل من المتصفح)
-- ------------------------------------------------------------
update auth.users
set raw_user_meta_data = raw_user_meta_data - 'role'
where raw_user_meta_data ? 'role';

-- ------------------------------------------------------------
-- 3) جدول الاستشارات: الكتابة حسب الدور
--    الإنشاء والحذف: الإداري فقط
--    التعديل: الإداري + لجنة الفتح (تحديث حالة الفتح)
-- ------------------------------------------------------------
drop policy if exists "tenders_auth_insert" on public.tenders;
create policy "tenders_admin_insert" on public.tenders
  for insert
  with check (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists "tenders_auth_update" on public.tenders;
create policy "tenders_staff_update" on public.tenders
  for update
  using (auth.jwt() -> 'app_metadata' ->> 'role' in ('admin', 'opener'))
  with check (auth.jwt() -> 'app_metadata' ->> 'role' in ('admin', 'opener'));

drop policy if exists "tenders_auth_delete" on public.tenders;
create policy "tenders_admin_delete" on public.tenders
  for delete
  using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

-- (القراءة تبقى لكل موظف مسجّل: سياسة tenders_auth_read قائمة)

-- ------------------------------------------------------------
-- 4) سجل التحميلات: إزالة سياسة الإدراج العامة
--    (الكتابة تتم فقط عبر دالة get-download بصلاحية service)
--    بدونها لا يستطيع أي خارجي تضخيم عداد التحميلات
-- ------------------------------------------------------------
drop policy if exists "downloads_public_insert" on public.downloads;

-- ------------------------------------------------------------
-- 5) التخزين: رفع/تعديل/حذف الملفات للإداري فقط
-- ------------------------------------------------------------
drop policy if exists "storage_auth_write" on storage.objects;
create policy "storage_admin_write" on storage.objects
  for insert
  with check (bucket_id = 'tenders'
              and auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists "storage_auth_update" on storage.objects;
create policy "storage_admin_update" on storage.objects
  for update
  using (bucket_id = 'tenders'
         and auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  with check (bucket_id = 'tenders'
              and auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists "storage_auth_delete" on storage.objects;
create policy "storage_admin_delete" on storage.objects
  for delete
  using (bucket_id = 'tenders'
         and auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

-- ============================================================
--  نهاية — جدول app_config محمي أصلًا (RLS مفعلة بدون أي سياسات
--  => لا يقرؤه إلا service_role) — لا يحتاج تعديلًا
-- ============================================================
