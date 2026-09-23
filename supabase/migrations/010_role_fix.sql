-- ============================================================
--  010: إصلاح حالة "بدون دور" + مرونة السياسات
--  - يعيّن دور admin لكل مستخدم لا يحمل دورًا (الحساب الأول
--    غالبًا أُنشئ من لوحة Supabase مباشرة دون دور)
--  - السياسات تعامل "بدون دور" كـ admin (اتساقًا مع تطبيق
--    الذي يعامل الحسابات بلا دور كحسابات كاملة)
--  التشغيل: Supabase Dashboard -> SQL Editor -> Run
--  بعد التشغيل: خروج كامل ثم دخول، ثم إعادة الحذف
-- ============================================================

-- 1) تعيين دور admin لمن لا يحمل دورًا
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('role', 'admin')
where not (coalesce(raw_app_meta_data, '{}'::jsonb) ? 'role');

-- 2) السياسات: "بدون دور" = admin
drop policy if exists "tenders_admin_insert" on public.tenders;
create policy "tenders_admin_insert" on public.tenders
  for insert
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'admin') = 'admin');

drop policy if exists "tenders_staff_update" on public.tenders;
create policy "tenders_staff_update" on public.tenders
  for update
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'admin') in ('admin', 'opener'))
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'admin') in ('admin', 'opener'));

drop policy if exists "tenders_admin_delete" on public.tenders;
create policy "tenders_admin_delete" on public.tenders
  for delete
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'admin') = 'admin');

drop policy if exists "storage_admin_write" on storage.objects;
create policy "storage_admin_write" on storage.objects
  for insert
  with check (bucket_id = 'tenders'
              and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'admin') = 'admin');

drop policy if exists "storage_admin_update" on storage.objects;
create policy "storage_admin_update" on storage.objects
  for update
  using (bucket_id = 'tenders'
         and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'admin') = 'admin')
  with check (bucket_id = 'tenders'
              and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'admin') = 'admin');

drop policy if exists "storage_admin_delete" on storage.objects;
create policy "storage_admin_delete" on storage.objects
  for delete
  using (bucket_id = 'tenders'
         and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'admin') = 'admin');
