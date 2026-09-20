-- ============================================================
--  005: السماح للموظف بحذف الاستشارات
--  التشغيل: Supabase Dashboard -> SQL Editor -> Run
-- ============================================================

drop policy if exists "tenders_auth_delete" on public.tenders;
create policy "tenders_auth_delete" on public.tenders
  for delete using (auth.uid() is not null);

-- سجل التحميلات يُحذف تلقائيًا (on delete cascade)
