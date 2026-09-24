-- ============================================================
--  013: دالة server_now() — وقت الخادم الصحيح
--  يستدعيها الموقع لحساب العدّاد التنازلي والفتح التلقائي
--  من وقت Supabase (الصحيح دائمًا) لا من ساعة جهاز المتعامل
--  (التي قد تكون خاطئة، مثل: ساعة زائدة على الحاسوب)
--  التشغيل: Supabase Dashboard -> SQL Editor -> الصق -> Run
-- ============================================================

create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$ select now() $$;

comment on function public.server_now() is 'وقت الخادم (UTC) — تصحيح فروق ساعات الأجهزة';
