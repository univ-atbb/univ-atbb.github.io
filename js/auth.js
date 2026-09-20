/* ===== المصادقة: دخول / إنشاء حساب / خروج ===== */
(function () {
  const A = (window.Auth = {});
  const $ = (id) => document.getElementById(id);

  A.onAuthed = null; // يُعيَّن من app.js

  A.init = function () {
    updateUI(false);
    DB.auth.getSession().then(({ data }) => {
      updateUI(!!(data && data.session));
    });
    DB.auth.onAuthStateChange((_event, session) => {
      updateUI(!!session);
    });

    const form = $('login-form');
    if (form) form.addEventListener('submit', onLogin);
    const su = $('signup-btn');
    if (su) su.addEventListener('click', onSignup);
    const lo = $('logout-btn');
    if (lo) lo.addEventListener('click', () => DB.auth.signOut());
  };

  function updateUI(authed) {
    $('login-card').classList.toggle('hidden', authed);
    $('authed-app').classList.toggle('hidden', !authed);
    if (authed) {
      DB.auth.getUser().then(({ data }) => {
        const nameEl = $('user-name');
        if (nameEl && data && data.user) nameEl.textContent = data.user.email || '';
      });
      if (A.onAuthed) A.onAuthed();
    }
  }

  function onLogin(e) {
    e.preventDefault();
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    if (!email || !password) return toast('أدخل البريد وكلمة المرور', 'error');
    const btn = $('login-form button[type=submit]');
    setBusy(btn, true, '⏳ جارٍ الدخول...');
    DB.auth.signInWithPassword({ email, password }).then(({ error }) => {
      setBusy(btn, false, 'دخول');
      if (error) {
        const msg =
          error.message === 'Invalid login credentials'
            ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
            : 'فشل الدخول: ' + error.message;
        toast(msg, 'error', 5000);
      }
    });
  }

  function onSignup() {
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    if (!email || !password) return toast('أدخل البريد وكلمة المرور أولًا', 'error');
    if (password.length < 8) return toast('كلمة المرور: 8 أحرف على الأقل', 'error');
    const btn = $('signup-btn');
    setBusy(btn, true, '⏳ جارٍ الإنشاء...');
    DB.auth.signUp({ email, password }).then(({ error }) => {
      setBusy(btn, false, 'إنشاء حساب جديد (أول مرة)');
      if (error) return toast('فشل: ' + error.message, 'error', 5000);
      toast(
        '✅ تم إنشاء الحساب. إذا وصلك بريد تأكيد من Supabase: افتحه واضغط الرابط ثم ادخل. وإلا ادخل مباشرة.',
        'success',
        9000
      );
    });
  }
})();
