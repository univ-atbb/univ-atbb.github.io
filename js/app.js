/* ===== نقطة الدخول: توجيه ذكي + النوافذ ===== */
(function () {
  const $ = (id) => document.getElementById(id);

  /* ---------- تبديل التبويبات ---------- */
  window.switchTo = function (id) {
    ['tab-create', 'tab-tenders'].forEach((s) => {
      const el = $(s);
      if (el) el.classList.add('hidden');
    });
    const target = $(id);
    if (target) target.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('bg-primary-800', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('text-slate-500', !on);
    });
  };

  function initBottomNav() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        window.switchTo(target);
        if (target === 'tab-tenders') window.Admin.refreshTenders();
      });
    });
  }

  /* ---------- إغلاق النوافذ المنبثقة ---------- */
  function initModals() {
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    ['qr-modal', 'downloads-modal', 'open-modal'].forEach((id) => {
      const el = $(id);
      if (el) {
        el.addEventListener('click', (e) => {
          if (e.target === el) closeModal(id);
        });
      }
    });
  }

  /* ---------- الإقلاع ---------- */
  function boot() {
    const params = new URLSearchParams(location.search);
    const token = params.get('open');

    let db = null;
    try {
      db = initSupabase();
    } catch (e) {
      console.error(e);
    }

    if (!db) {
      const banner = $('setup-banner');
      if (banner) banner.classList.remove('hidden');
      return;
    }

    initModals();

    if (token) {
      // صفحة المتعامل: نظيفة، بدون تبويبات
      $('page-download').classList.remove('hidden');
      window.DownloadPage.init(token);
    } else {
      // لوحة المدير
      $('page-admin').classList.remove('hidden');
      initBottomNav();
      window.Admin.init();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
