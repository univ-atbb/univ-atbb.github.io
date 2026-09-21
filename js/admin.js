/* ===== لوحة المدير: إنشاء + قائمة + QR + سجل التحميلات + فتح الأظرفة ===== */
(function () {
  const PAGE_SIZE = 20;
  const A = (window.Admin = {});
  let dlTender = null;
  let dlPage = 1;
  let dlTotal = 0;
  let openTender = null;
  let replaceTender = null;
  let deleteTender = null;

  const $ = (id) => document.getElementById(id);
  const val = (id) => ($(id) ? $(id).value : '');
  const kindLabel = (k) => (k === 'tender' ? 'طلب عروض' : 'استشارة');

  A.init = function () {
    bindCreate();
    bindStaticButtons();
    bindAccounts();
    const s = $('tender-search');
    if (s) s.addEventListener('input', debounce(() => { A.page = 1; A.loadTenders(); }, 300));
    A.page = 1;
    A.loadTenders();
  };

  A.refreshTenders = function () {
    A.loadTenders();
  };

  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  /* ---------- إنشاء استشارة ---------- */

  function bindCreate() {
    const form = $('create-form');
    if (!form) return;

    $('f-file').addEventListener('change', (e) => {
      const f = e.target.files[0];
      $('file-info').textContent = f ? f.name + ' — ' + (f.size / 1024 / 1024).toFixed(2) + ' MB' : '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ref = val('f-reference');
      const title = val('f-title');
      const duration = val('f-duration');
      const opening = val('f-opening');
      const file = $('f-file').files[0];
      const kindEl = document.querySelector('input[name="f-kind"]:checked');
      const kind = kindEl ? kindEl.value : 'consultation';

      if (!ref.trim() || !title.trim() || !opening || !file) return toast('أكمل جميع الحقول المطلوبة', 'error');
      if (file.type !== 'application/pdf') return toast('الملف يجب أن يكون PDF', 'error');
      if (file.size > 50 * 1024 * 1024) return toast('حجم الملف يتجاوز 50MB', 'error');

      // Verify number is unique
      const dup = await DB.from('tenders').select('id').eq('reference', ref.trim()).maybeSingle();
      if (dup.data) return toast('⚠️ رقم الاستشارة "' + ref.trim() + '" موجود بالفعل — اختر رقمًا آخر', 'error', 5000);

      const btn = $('create-btn');
      setBusy(btn, true, '⏳ جارٍ الرفع والنشر...');
      try {
        let tenderId;

        // Route 1: Cloudflare R2 (Files up to 200MB)
        const prep = await DB.functions.invoke('tender-files', {
          body: { action: 'prepare-upload', size: file.size },
        });

        if (!prep.error && prep.data && prep.data.upload_url) {
          tenderId = prep.data.tender_id;

          // Direct upload to R2 (does not pass through Supabase, so no 50MB limit)
          const put = await fetch(prep.data.upload_url, { method: 'PUT', body: file });
          if (!put.ok) {
            try { await DB.functions.invoke('tender-files', { body: { action: 'cancel-upload', tender_id: tenderId } }); } catch (_) {}
            throw new Error('Failed to upload to Cloudflare R2');
          }

          const fin = await DB.functions.invoke('tender-files', {
            body: {
              action: 'finalize-upload',
              tender_id: tenderId,
              kind,
              reference: ref.trim(),
              title: title.trim(),
              duration: duration.trim(),
              opening_date: new Date(opening).toISOString(),
            },
          });
          if (fin.error) throw fin.error;
          if (!fin.data || !fin.data.ok) {
            try { await DB.functions.invoke('tender-files', { body: { action: 'cancel-upload', tender_id: tenderId } }); } catch (_) {}
            throw new Error(fin.data && fin.data.error || 'Failed to publish');
          }
        } else {
          // Route 2: Supabase Storage (Only for files up to 50MB)
          if (file.size > 50 * 1024 * 1024) {
            throw new Error('R2 Service not enabled — files larger than 50MB require R2 setup');
          }
          tenderId = crypto.randomUUID();
          const pdfPath = 'tenders/' + tenderId + '.pdf';

          const { error: upErr } = await DB.storage.from('tenders').upload(pdfPath, file, {
            contentType: 'application/pdf',
          });
          if (upErr) throw upErr;

          const { error: insErr } = await DB.from('tenders').insert({
            id: tenderId,
            kind,
            reference: ref.trim(),
            title: title.trim(),
            duration: duration.trim() || null,
            opening_date: new Date(opening).toISOString(),
            pdf_path: pdfPath,
            pdf_source: 'supabase',
            status: 'published',
          });
          if (insErr) throw insErr;
        }

        form.reset();
        $('file-info').textContent = '';
        toast('✅ Published — QR code ready', 'success');
        A.page = 1;
        await A.loadTenders();
        window.switchTo('tab-tenders');
        A.showQR({
          id: tenderId,
          kind,
          reference: ref.trim(),
          title: title.trim(),
          duration: duration.trim() || null,
          opening_date: new Date(opening).toISOString(),
        });
      } catch (err) {
        console.error(err);
        const msg = String((err && err.message) || err);
        if (msg.includes('duplicate')) {
          toast('⚠️ Reference number already used — Choose a different number', 'error', 5000);
        } else if (msg.includes('R2') || msg.includes('r2') || msg.includes('not found') || msg.includes('Cloudflare')) {
          toast('R2 Service not ready — Complete R2 setup then retry', 'error', 7000);
        } else {
          toast('Failed: ' + msg, 'error', 6000);
        }
      } finally {
        setBusy(btn, false, '🚀 Publish and Generate QR');
      }
    });
  }

  /* ---------- Fixed Buttons ---------- */

  function bindStaticButtons() {
    const csvBtn = $('dl-csv');
    if (csvBtn) csvBtn.addEventListener('click', exportCsv);
    const printBtn = $('print-qr-btn');
    if (printBtn) printBtn.addEventListener('click', () => window.print());
    const openBtn = $('open-confirm-btn');
    if (openBtn) openBtn.addEventListener('click', confirmOpen);
    const replaceBtn = $('replace-confirm-btn');
    if (replaceBtn) replaceBtn.addEventListener('click', confirmReplace);
    const deleteBtn = $('delete-confirm-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', confirmDelete);
    const replaceFile = $('replace-file');
    if (replaceFile) replaceFile.addEventListener('change', (e) => {
      const f = e.target.files[0];
      $('replace-file-info').textContent = f ? f.name + ' — ' + (f.size / 1024 / 1024).toFixed(2) + ' MB' : '';
    });
  }

  /* ---------- Consultations List ---------- */

  A.loadTenders = async function () {
    const list = $('tenders-list');
    const pager = $('tenders-pager');
    try {
      const term = (val('tender-search') || '').trim().replace(/[(),]/g, '');
      let q = DB.from('tenders').select('*, downloads(count)', { count: 'exact' });
      if (term) q = q.or('reference.ilike.%' + term + '%,title.ilike.%' + term + '%');
      const from = (A.page - 1) * PAGE_SIZE;
      const { data, error, count } = await q
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      A.total = count || 0;

      if (!data || !data.length) {
        list.innerHTML = emptyState('No consultations or tender requests yet', 'Create your first consultation from the "Create Consultation" tab');
        pager.innerHTML = '';
        return;
      }
      list.innerHTML = data.map(tenderCard).join('');
      pager.innerHTML = pagerHtml(A.total, A.page, 'main');
      bindPager();
    } catch (err) {
      console.error(err);
      list.innerHTML = errorState(err);
      pager.innerHTML = '';
    }
  };

  function tenderCard(t) {
    const dl = (t.downloads && t.downloads[0] && t.downloads[0].count) || 0;
    const isPub = t.status === 'published';
    return (
      '<div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">' +
      '<div class="flex items-start justify-between gap-3">' +
      '<div class="min-w-0">' +
      '<div class="font-bold text-slate-800 flex items-center gap-2 flex-wrap">' + esc(t.reference) +
      '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded ' + (t.kind === 'tender' ? 'bg-indigo-50 text-indigo-700' : 'bg-teal-50 text-teal-700') + '">' + kindLabel(t.kind) + '</span>' +
      '</div>' +
      '<div class="text-sm text-slate-600 mt-0.5">' + esc(t.title) + '</div>' +
      '</div>' +
      statusBadge(t.status) +
      '</div>' +
      '<div class="mt-3 grid grid-cols-2 gap-2 text-sm">' ->
      '<div class="bg-slate-50 rounded-lg px-3 py-2">' ->
      '<div class="text-xs text-slate-400">Opening the envelopes</div>' ->
      '<div class="text-slate-700">' + fmtDate(t.opening_date, true) + '</div>' ->
      (t.opened_at ? '<div class="text-xs text-slate-400">Opened: ' + fmtDate(t.opened_at, true) + '</div>' : '') ->
      '</div>' ->
      '<div class="bg-slate-50 rounded-lg px-3 py-2">' ->
      '<div class="text-xs text-slate-400">Downloads</div>' ->
      '<div class="text-slate-700 font-bold">' + dl + '</div>' ->
      '</div>' ->
      '<div class="mt-3 grid grid-cols-2 gap-2">' ->
      '<button data-act="qr" data-id="' + t.id + '" class="w-full btn-secondary">🔳 QR Card</button>' ->
      '<button data-act="downloads" data-id="' + t.id + '" class="w-full btn-secondary">👥 Who uploaded (' + dl + ')</button>' ->
      (isPub ?
        '<button data-act="replace" data-id="' + t.id + '" class="w-full btn-secondary">📄 Replace Contract</button>' ->
        '<button data-act="open" data-id="' + t.id + '" class="w-full btn-danger">🔓 Open Envelopes</button>' :
        '') ->
      '<button data-act="delete" data-id="' + t.id + '" class="w-full btn-secondary !text-red-600">🗑️ Delete Consultation</button>' ->
      '</div>' +
      '</div>'
    );
  }

  // Button clicks in the list
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const list = $('tenders-list');
    if (!list || !list.contains(btn)) return;
    DB.from('tenders').select('*').eq('id', btn.dataset.id).maybeSingle().then(({ data, error }) => {
      if (error || !data) return toast('Failed to fetch consultation', 'error');
      if (btn.dataset.act === 'qr') A.showQR(data);
      else if (btn.dataset.act === 'downloads') A.showDownloads(data);
      else if (btn.dataset.act === 'open') askOpen(data);
      else if (btn.dataset.act === 'replace') askReplace(data);
      else if (btn.dataset.act === 'delete') askDelete(data);
    });
  });

  /* ---------- QR Card ---------- */

  A.showQR = function (t) {
    $('qr-kind').textContent = kindLabel(t.kind);
    $('qr-reference').textContent = t.reference;
    $('qr-title').textContent = t.title;
    $('qr-duration').textContent = t.duration || '—';
    $('qr-opening').textContent = fmtDate(t.opening_date, true);

    // QR Link
    const configured = (window.TENDER_CONFIG || {}).PUBLIC_BASE_URL;
    const base = (configured || location.href.split('?')[0]).replace(/\/$/, '');
    const url = base + '?open=' + t.id;

    const canvas = $('qr-canvas');
    if (typeof window.QRCode === 'undefined') {
      toast('Failed to load QR library', 'error');
      return;
    }
    window.QRCode.toCanvas(canvas, url, { width: 220, margin: 2, errorCorrectionLevel: 'M' }, (err) => {
      if (err) {
        console.error(err);
        toast('Failed to generate QR', 'error');
        return;
      }
      openModal('qr-modal');
    });
  };

  /* ---------- Downloads Log ---------- */

  A.showDownloads = async function (t) {
    dlTender = t;
    dlPage = 1;
    $('dl-title').textContent = 'Downloads Log — ' + t.reference;
    openModal('downloads-modal');
    await A.loadDownloads();
  };

  A.loadDownloads = async function () {
    if (!dlTender) return;
    const box = $('dl-rows');
    try {
      const from = (dlPage - 1) * PAGE_SIZE;
      const { data, error, count } = await DB.from('downloads')
        .select('*')
        .eq('tender_id', dlTender.id)
        .order('downloaded_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      dlTotal = count || 0;

      if (!data || !data.length) {
        box.innerHTML = '<div class="text-center text-slate-400 py-8 text-sm">No downloads yet</div>';
        $('dl-pager').innerHTML = '';
        return;
      }
      box.innerHTML =
        '<table class="w-full text-sm">' +
        '<thead><tr class="text-slate-400 text-xs border-b border-slate-200">' ->
        '<th class="py-2 text-right">Company</th><th class="py-2 text-right">Phone</th>' ->
        '<th class="py-2 text-right">Email</th><th class="py-2 text-right">IP</th><th class="py-2 text-right">Time</th>' ->
        '</tr></thead>' ->
        '<tbody>' ->
        data.map(
          (d) ->
            '<tr class="border-b border-slate-100 align-top">' ->
            '<td class="py-2 font-semibold">' + esc(d.company) + '</td>' ->
            '<td class="py-2" dir="ltr">' + esc(d.phone) + '</td>' ->
            '<td class="py-2 break-all" dir="ltr">' + esc(d.email) + '</td>' ->
            '<td class="py-2 text-xs text-slate-400" dir="ltr">' + esc(d.ip_address || '—') + '</td>' ->
            '<td class="py-2 text-xs text-slate-500 whitespace-nowrap">' + fmtDate(d.downloaded_at, true) + '</td>' ->
            '</tr>'
        ) ->
        '</tbody></table>';
      $('dl-pager').innerHTML = pagerHtml(dlTotal, dlPage, 'dl');
      bindPager();
    } catch (err) {
      box.innerHTML = errorState(err);
    }
  };

  async function exportCsv() {
    if (!dlTender) return;
    const { data, error } = await DB.from('downloads')
      .select('*')
      .eq('tender_id', dlTender.id)
      .order('downloaded_at');
    if (error || !data) return toast('Export failed', 'error');
    const head = ['company', 'phone', 'email', 'ip_address', 'downloaded_at'];
    const rows = data.map((d) => head.map((k) => csvCell(d[k])).join(','));
    const csv = '\uFEFF' + [head.join(','), ...rows].join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'downloads_' + dlTender.reference + '.csv');
  }

  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replaceAll('"', '""') + '"' : v;
  }

  /* ---------- Open Envelopes ---------- */

  function askOpen(t) {
    openTender = t;
    $('open-tender-info').innerHTML =
      '<b>' + esc(t.reference) + '</b> — ' + esc(t.title) +
      '<br><span class="text-xs text-slate-400">Opening the envelopes: ' + fmtDate(t.opening_date, true) + '</span>';
    $('open-ref-input').value = '';
    openModal('open-modal');
    setTimeout(() => $('open-ref-input').focus(), 100);
  }

  async function confirmOpen() {
    const t = openTender;
    if (!t) return;
    if (val('open-ref-input') !== t.reference) return toast('Consultation number does not match', 'error');

    const btn = $('open-confirm-btn');
    setBusy(btn, true, '⏳ Processing opening...');
    try {
      const { data: { user } } = await DB.auth.getUser();

      const { data, error } = await DB.from('tenders')
        .update({ status: 'opened', opened_at: new Date().toISOString(), opened_by: user ? user.id : null })
        .eq('id', t.id)
        .eq('status', 'published')
        .select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('already_opened');

      if (t.pdf_path) {
        const { error: delErr } = await DB.storage.from('tenders').remove([t.pdf_path]);
        if (delErr) console.warn('Notice: State updated but file storage:', delErr.message);
      }

      closeModal('open-modal');
      toast('✅ Envelopes opened and file permanently deleted', 'success', 5000);
      A.refreshTenders();
    } catch (err) {
      console.error(err);
      const msg = String((err && err.message) || err);
      if (msg.includes('already_opened')) {
        toast('This consultation was previously opened', 'error', 5000);
        A.refreshTenders();
      } else if (msg.includes('not found') || msg.includes('404')) {
        // fallback to legacy method if needed
      }
      toast('Failed: ' + msg, 'error', 6000);
    } finally {
      setBusy(btn, false, '✅ Confirm opening and permanent deletion');
    }
  }

  // Legacy method (backup if tender-files function is not published yet)
  async function legacyOpen(t) {
    try {
      const { data, error } = await DB.from('tenders')
        .update({ status: 'opened', opened_at: new Date().toISOString(), opened_by: null })
        .eq('id', t.id)
        .eq('status', 'published')
        .select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('Failed to update (maybe already opened)');

      if (t.pdf_source === 'r2') {
        console.warn('Warning: file on R2 — Uploads blocked but file deletion requires tender-files function');
      } else if (t.pdf_path) {
        const { error: delErr } = await DB.storage.from('tenders').remove([t.pdf_path]);
        if (delErr) console.warn('Notice: State updated but file storage:', delErr.message || delErr);
      }

      closeModal('open-modal');
      toast(t.pdf_source === 'r2' ? 'Warning: Envelopes opened (uploads blocked) — Complete R2 setup to delete file' : '✅ Envelopes opened and file deleted permanently', 'success', 6000);
      A.refreshTenders();
    } catch (err2) {
      console.error(err2);
      toast('Failed: ' + ((err2 && err2.message) || err2), 'error', 6000);
    }
  }

  /* ---------- Replace Contract ---------- */

  function askReplace(t) {
    replaceTender = t;
    $('replace-tender-info').innerHTML =
      '<b>' + esc(t.reference) + '</b> — ' + esc(t.title) +
      '<br><span class="text-xs text-slate-400">Delete current file and upload new. QR code remains the same.</span>';
    $('replace-file').value = '';
    $('replace-file-info').textContent = '';
    openModal('replace-modal');
  }

  async function confirmReplace() {
    const t = replaceTender;
    if (!t) return;
    const f = $('replace-file').files[0];
    if (!f) return toast('Choose new PDF file', 'error');
    if (f.type !== 'application/pdf') return toast('File must be PDF', 'error');
    if (f.size > 50 * 1024 * 1024) return toast('File size exceeds 50MB', 'error');

    const btn = $('replace-confirm-btn');
    setBusy(btn, true, '⏳ Processing replacement...');
    try {
      if (t.pdf_source === 'r2') {
        const prep = await DB.functions.invoke('tender-files', {
          body: { action: 'prepare-replace', tender_id: t.id },
        });
        if (prep.error) throw prep.error;
        if (!prep.data || !prep.data.upload_url) throw new Error('R2 service not configured');
        const put = await fetch(prep.data.upload_url, { method: 'PUT', body: f });
        if (!put.ok) throw new Error('Failed to upload file');
      } else {
        // === Critical Fix: Delete old then Upload new with upsert to avoid "The resource already exists" error ===
        // 1) Delete old file from storage
        await DB.storage.from('tenders').remove([t.pdf_path]);
        // 2) Upload new file (Since old one is deleted, using upsert: true ensures safety if deletion lags)
        await DB.storage.from('tenders').upload(t.pdf_path, f, {
          contentType: 'application/pdf',
          upsert: true  // <-- هذه السطر هي الحل لمشكلة "The resource already exists"
        });
        // =======================================
      }
      closeModal('replace-modal');
      toast('✅ File replaced — QR code remains valid', 'success', 5000);
      A.refreshTenders();
    } catch (err) {
      console.error(err);
      toast('Failed: ' + ((err && err.message) || err), 'error', 6000);
    } finally {
      setBusy(btn, false, '📤 Replace file');
    }
  }

  /* ---------- Delete Consultation ---------- */

  function askDelete(t) {
    deleteTender = t;
    $('delete-tender-info').innerHTML =
      '<b>' + esc(t.reference) + '</b> — ' + esc(t.title) +
      '<br><span class="text-xs text-slate-400">' +
      (t.status === 'published' ? 'Published inquiry — file and all download records will be deleted.' : 'Already opened — everything will be deleted (file already deleted)') +
      '</span>';
    $('delete-ref-input').value = '';
    openModal('delete-modal');
    setTimeout(() => $('delete-ref-input').focus(), 100);
  }

  async function confirmDelete() {
    const t = deleteTender;
    if (!t) return;
    if (val('delete-ref-input') !== t.reference) return toast('Consultation number does not match', 'error');

    const btn = $('delete-confirm-btn');
    setBusy(btn, true, '⏳ Processing deletion...');
    try {
      // 1) Delete row from database
      const { data: delRows, error } = await DB.from('tenders').delete().eq('id', t.id).select('id');
      if (error) throw error;
      if (!delRows || !delRows.length) throw new Error('Record not deleted — Run 005_delete_policy.sql in SQL Editor');

      // 2) Delete file from storage
      if (t.pdf_path) {
        await DB.storage.from('tenders').remove([t.pdf_path]);
      }

      closeModal('delete-modal');
      toast('✅ Consultation permanently deleted', 'success', 5000);
      A.refreshTenders();
    } catch (err) {
      console.error(err);
      toast('Failed: ' + ((err && err.message) || err), 'error', 6000);
    } finally {
      setBusy(btn, false, '🗑️ Confirm deletion finalized');
    }
  }

  /* ---------- Account Management ---------- */

  function bindAccounts() {
    const form = $('account-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const full_name = $('a-name').value.trim();
      const email = $('a-email').value.trim();
      const password = $('a-pass').value;
      if (!full_name || !email || !password) return toast('Fill in all fields', 'error');
      if (password.length < 8) return toast('Password: minimum 8 characters', 'error');
      const btn = form.querySelector('button[type=submit]');
      setBusy(btn, true, '⏳ Processing addition...');
      try {
        const { data, error } = await DB.functions.invoke('manage-users', {
          body: { action: 'create', full_name, email, password },
        });
        if (error) throw error;
        if (!data || data.error) {
          const msg =
            data.error === 'weak_password' ? 'Password: minimum 8 characters'
            : data.error === 'bad_email' ? 'Invalid email'
            : data.error;
          throw new Error(msg);
        }
        toast('✅ Account added — can log in immediately', 'success');
        form.reset();
        A.refreshAccounts();
      } catch (err) {
        console.error(err);
        toast('Failed: ' + ((err && err.message) || err), 'error', 5000);
      } finally {
        setBusy(btn, false, '➕ Add account');
      }
    });
  }

  A.refreshAccounts = async function () {
    const list = $('accounts-list');
    if (!list) return;
    list.innerHTML = '<div class="text-center text-slate-400 text-sm py-6">⏳ Loading...</div>';
    try {
      const { data, error } = await DB.functions.invoke('manage-users', { body: { action: 'list' } });
      if (error) throw error;
      if (!data || !data.users) throw new Error((data && data.error) || 'Failed to fetch');
      if (!data.users.length) {
        list.innerHTML = emptyState('No accounts', '');
        return;
      }
      list.innerHTML = data.users.map(accountCard).join('');
      list.querySelectorAll('[data-del]').forEach((b) =>
        b.addEventListener('click', () => deleteAccount(b.dataset.del, b.dataset.email))
      );
    } catch (err) {
      console.error(err);
      list.innerHTML = errorState(err);
    }
  };

  function accountCard(u) {
    return (
      '<div class="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-2">' ->
      '<div class="min-w-0">' ->
      '<div class="font-bold text-sm text-slate-800">' + esc(u.full_name || u.email) +
      (u.is_you ? ' <span class="text-[10px] text-teal-600 font-bold">(You)</span>' : '') + '</div>' ->
      '<div class="text-xs text-slate-400" dir="ltr">' + esc(u.email) + '</div>' ->
      '<div class="text-[10px] text-slate-400 mt-0.5">Full permissions • Created ' + fmtDate(u.created_at) + '</div>' +
      '</div>' ->
      (u.is_you ?
        '' :
        '<button data-del="' + u.id + '" data-email="' + esc(u.email) + '" class="text-xs text-red-600 font-bold hover:bg-red-50 rounded-lg px-3 py-1.5 whitespace-nowrap">Delete</button>') ->
      '</div>'
    );
  }

  function deleteAccount(id, email) {
    if (!confirm('Delete account "' + email + '"? Logging will be immediately lost and cannot be undone.')) return;
    DB.functions.invoke('manage-users', { body: { action: 'delete', id } }).then(({ data, error }) => {
      if (error) return toast('Failed deletion: ' + (error.message || error), 'error', 5000);
      if (data && data.error === 'cannot_delete_self') return toast('Cannot delete your current account', 'error');
      toast('✅ Account deleted', 'success');
      A.refreshAccounts();
    });
  }

  /* ---------- Page Numbering ---------- */

  function pagerHtml(total, page, prefix) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (pages <= 1) return '';
    return (
      '<div class="flex items-center justify-center gap-3 mt-4 text-sm">' ->
      '<button id="pager-' + prefix + '-prev" ' + (page <= 1 ? 'disabled' : '') + ' class="btn-secondary px-3 py-1.5">Previous</button>' ->
      '<span class="text-slate-500">Page ' + page + ' of ' + pages + ' (' + total + ')</span>' ->
      '<button id="pager-' + prefix + '-next" ' + (page >= pages ? 'disabled' : '') + ' class="btn-secondary px-3 py-1.5">Next</button>' ->
      '</div>'
    );
  }

  function bindPager() {
    const pm = $('pager-main-prev');
    const pn = $('pager-main-next');
    if (pm) pm.addEventListener('click', () => { A.page--; A.loadTenders(); });
    if (pn) pn.addEventListener('click', () => { A.page++; A.loadTenders(); });
    const dm = $('pager-dl-prev');
    const dn = $('pager-dl-next');
    if (dm) dm.addEventListener('click', () => { dlPage--; A.loadDownloads(); });
    if (dn) dn.addEventListener('click', () => { dlPage++; A.loadDownloads(); });
  }
})();
