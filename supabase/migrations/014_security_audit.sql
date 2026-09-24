-- ============================================================
--  014: تدقيق أمني — "رفض افتراضي" (Fail-Closed)
--  ════════════════════════════════════════════════════════════
--  ما يُغلقه هذا الملف:
--  1) الثغرة الأخطر: "لا دور = admin"
--     السياسات القديمة كانت coalesce(role, 'admin') أي أن أي مستخدم
--     مسجّل بلا دور (مثل تسجيل مجهول إن كان مفعّلًا) يصبح إداريًا كاملًا
--     (إنشاء/تعديل/حذف استشارات + كتابة/حذف ملفات).
--     الآن: لا دور = لا صلاحيات (عدا العرض العام).
--  2) قراءة الجداول الداخلية (tenders الكاملة + سجل التحميلات)
--     كانت متاحة لكل "مسجّل" (auth.uid) — الآن تتطلب دورًا وظيفيًا
--     صريحًا (admin / committee / opener).
--  3) app_config (أسرار R2): سحب صريح للصلاحيات عن anon/authenticated
--     + FORCE RLS على الجداول (حماية إضافية حتى من مالك الجدول).
--  4) سياسة قراءة التخزين: لا توجد (الملفات تُفتح فقط عبر روابط موقّعة
--     مؤقتة 10 دقائق من get-download) — وهذا مطلوب، نتأكد أنه لا يوجد
--     أي policy قراءة متبقٍ.
--  5) فهرس على ip_address لدعم التحييد (throttling) في get-download.
--  ────────────────────────────────────────────────────────────
--  التشغيل: Supabase Dashboard -> SQL Editor -> Run
--  آمن على البيانات الحالية: كل المستخدمين الحقيقيين يملكون دورًا صريحًا
--  (أُضيف في 009/010) لذلك لن يتأثر أي موظف.
-- ============================================================

-- ------------------------------------------------------------
-- 1) جدول الاستشارات — أدوار صريحة (بدون coalesce إلى admin)
-- ------------------------------------------------------------
drop policy if exists "tenders_admin_insert" on public.tenders;
create policy "tenders_admin_insert" on public.tenders
  for insert
  with check (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists "tenders_staff_update" on public.tenders;
create policy "tenders_staff_update" on public.tenders
  for update
  using (auth.jwt() -> 'app_metadata' ->> 'role' in ('admin', 'opener'))
  with check (auth.jwt() -> 'app_metadata' ->> 'role' in ('admin', 'opener'));

drop policy if exists "tenders_admin_delete" on public.tenders;
create policy "tenders_admin_delete" on public.tenders
  for delete
  using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

-- القراءة الداخلية: لكل من يملك دورًا وظيفيًا صريحًا فقط
drop policy if exists "tenders_auth_read" on public.tenders;
drop policy if exists "tenders_staff_read" on public.tenders;
create policy "tenders_staff_read" on public.tenders
  for select
  using (auth.jwt() -> 'app_metadata' ->> 'role' in ('admin', 'committee', 'opener'));

alter table public.tenders force row level security;

-- ------------------------------------------------------------
-- 2) سجل التحميلات — قراءة للفرق فقط
--    (الكتابة تتم حصريًا عبر get-download بصلاحية service_role)
-- ------------------------------------------------------------
drop policy if exists "downloads_auth_read" on public.downloads;
drop policy if exists "downloads_staff_read" on public.downloads;
create policy "downloads_staff_read" on public.downloads
  for select
  using (auth.jwt() -> 'app_metadata' ->> 'role' in ('admin', 'committee', 'opener'));

-- أي سياسات كتابة/تحديث/حذف قديمة على السجل (إن وُجدت) — تُسحب
drop policy if exists "downloads_insert" on public.downloads;
drop policy if exists "downloads_update" on public.downloads;
drop policy if exists "downloads_delete" on public.downloads;

alter table public.downloads force row level security;

-- ------------------------------------------------------------
-- 3) app_config (أسرار R2) — service_role فقط
-- ------------------------------------------------------------
drop policy if exists "app_config_read" on public.app_config;
drop policy if exists "app_config_write" on public.app_config;
revoke all on public.app_config from anon, authenticated;
alter table public.app_config force row level security;

-- ------------------------------------------------------------
-- 4) التخزين — إداري فقط (بصيغة صريحة) + تأكيد غياب أي سياسة قراءة
-- ------------------------------------------------------------
drop policy if exists "storage_public_read" on storage.objects;
drop policy if exists "storage_read_mvp" on storage.objects;
drop policy if exists "storage_read" on storage.objects;

drop policy if exists "storage_admin_write" on storage.objects;
create policy "storage_admin_write" on storage.objects
  for insert
  with check (bucket_id = 'tenders'
              and auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists "storage_admin_update" on storage.objects;
create policy "storage_admin_update" on storage.objects
  for update
  using (bucket_id = 'tenders'
         and auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  with check (bucket_id = 'tenders'
              and auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists "storage_admin_delete" on storage.objects;
create policy "storage_admin_delete" on storage.objects
  for delete
  using (bucket_id = 'tenders'
         and auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

-- ------------------------------------------------------------
-- 5) العرض العام (المتعامل) — بلا تغيير: المنشورة + المفتوحة فقط
-- ------------------------------------------------------------
grant select on public.tenders_public to anon, authenticated;

-- ------------------------------------------------------------
-- 6) فهرس لدعم التحييد (5/ساعة لكل IP) في get-download
-- ------------------------------------------------------------
create index if not exists idx_downloads_ip
  on public.downloads(ip_address, downloaded_at);
