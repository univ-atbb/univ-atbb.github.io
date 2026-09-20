-- ============================================================
--  003: دعم Cloudflare R2 (ملفات أكبر من 50MB)
--  التشغيل: Supabase Dashboard -> SQL Editor -> Run
-- ============================================================

-- مكان تخزين ملف PDF: 'supabase' (الاستشارات القديمة) أو 'r2' (الجديدة)
alter table public.tenders
  add column if not exists pdf_source text not null default 'supabase';

-- بيانات اتصال R2 (مكتوبة في الاستعلام التالي)
-- جدول خاص: بدون أي سياسة RLS => يصل إليه فقط service_role (الدوال) ولوحة SQL
create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
