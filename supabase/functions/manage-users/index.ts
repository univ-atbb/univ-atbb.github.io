// ============================================================
//  Edge Function: manage-users
//  إدارة حسابات الموظفين (قائمة / إضافة / حذف) — صلاحيات كاملة
//  محمية: يعمل فقط لمن هو مسجّل الدخول (JWT صالح)
//  ----------------------------------------------------------
//  الإنشاء: Supabase Dashboard -> Edge Functions -> New function
//  الاسم: manage-users
//  الإعدادات: Authentication = Protected (يتطلب JWT صالحًا)
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // التحقق من أن المستدعي مسجّل دخول
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return json({ error: 'unauthorized' }, 401);
  const { data: userData, error: authErr } = await db.auth.getUser(token);
  if (authErr || !userData.user) return json({ error: 'unauthorized' }, 401);
  const callerId = userData.user.id;

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const action = String(body.action || '');

  // قائمة الحسابات
  if (action === 'list') {
    const { data, error } = await db.auth.admin.listUsers();
    if (error) return json({ error: error.message }, 500);
    const users = (data.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      full_name: (u.user_metadata && u.user_metadata.full_name) || '',
      role: parseRole(u.user_metadata && u.user_metadata.role),
      created_at: u.created_at,
      is_you: u.id === callerId,
    }));
    return json({ users });
  }

  // إضافة حساب (كامل / لجنة عرض / لجنة فتح)
  if (action === 'create') {
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    const full_name = String(body.full_name || '').trim();
    const role = parseRole(body.role, 'admin');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'bad_email' }, 400);
    if (password.length < 8) return json({ error: 'weak_password' }, 400);
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role },
    });
    if (error) {
      const status = /already/i.test(error.message) ? 409 : 500;
      return json({ error: error.message }, status);
    }
    return json({ id: data.user.id });
  }

  // تغيير دور حساب (كامل / لجنة عرض / لجنة فتح)
  if (action === 'update') {
    const id = String(body.id || '');
    const role = parseRole(body.role);
    if (!id || !role) return json({ error: 'bad_request' }, 400);
    if (id === callerId) return json({ error: 'cannot_change_self' }, 400);
    const { data: existing, error: getErr } = await db.auth.admin.getUserById(id);
    if (getErr || !existing) return json({ error: 'user_not_found' }, 404);
    const meta = (existing.user_metadata || {}) as Record<string, unknown>;
    const { error } = await db.auth.admin.updateUserById(id, {
      user_metadata: { ...meta, role },
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // حذف حساب (لا يمكن حذف حسابك الحالي)
  if (action === 'delete') {
    const id = String(body.id || '');
    if (!id) return json({ error: 'bad_request' }, 400);
    if (id === callerId) return json({ error: 'cannot_delete_self' }, 400);
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
});

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// توحيد الدور: admin (كامل) | committee (عرض فقط) | opener (لجنة فتح الأظرفة)
function parseRole(v: unknown, fallback = ''): string {
  const r = String(v || '');
  if (r === 'committee') return 'committee';
  if (r === 'opener') return 'opener';
  return fallback || 'admin';
}
