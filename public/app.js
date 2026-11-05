/* BRS Booking — front-end (vanilla JS + daisyUI + Lucide) */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const API_URL = CFG.apiUrl || '/api/gas';
  const API_TIMEOUT_MS = 30000;
  const $ = (id) => document.getElementById(id);
  const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const DOW_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const SLOT_SHORT = {
    '06:00-08:30': 'เช้า', '08:30-12:30': 'สาย', '12:30-16:30': 'บ่าย', '16:30-สิ้นสุด': 'เย็น',
    '06:00-11:00': '06-11', '06:00-12:00': '06-12', '06:00-16:00': '06-16', '06:00-สิ้นสุด': 'ทั้งวัน'
  };
  const SLOT_ICON = {
    '06:00-08:30': ['sunrise', 'text-warning'], '08:30-12:30': ['sun', 'text-warning'], '12:30-16:30': ['cloud-sun', 'text-info'], '16:30-สิ้นสุด': ['sunset', 'text-secondary'],
    '06:00-11:00': ['sunrise', 'text-warning'], '06:00-12:00': ['sun', 'text-warning'], '06:00-16:00': ['cloud-sun', 'text-info'], '06:00-สิ้นสุด': ['moon', 'text-secondary']
  };
  const SLOT_COL = {
    '06:00-08:30': 0, '06:00-11:00': 0, '08:30-12:30': 1, '06:00-12:00': 1,
    '12:30-16:30': 2, '06:00-16:00': 2, '16:30-สิ้นสุด': 3, '06:00-สิ้นสุด': 4
  };
  const ROOM_SHORT = (r) => r.indexOf('OPD') >= 0 ? 'OPD' : r.indexOf('กว.') >= 0 ? 'กว.' : r.indexOf('SMC') >= 0 ? 'SMC' : r;
  // ชื่อย่อสำหรับตาราง (ตำแหน่งที่ไม่อยู่ในนี้แสดงชื่อเต็ม)
  const POS_SHORT = {
    'บุคลากรประจำคณะแพทย์ศาสตร์ ตำแหน่งอื่นๆ': 'ตำแหน่งอื่นๆ'
  };
  const STATUS = { active: ['ใช้งาน', 'badge-success'], pending: ['รออนุมัติ', 'badge-warning'], inactive: ['ระงับ', 'badge-error'] };

  const S = {
    info: null, token: null, user: null, month: null, selected: null,
    my: { bookings: [], leaves: [] }, picked: null,
    admin: { token: null, month: null, data: null, staff: [], holidays: [], settings: null, months: [], tab: 'roster', conflicts: {} }
  };

  /* ---------------- utilities ---------------- */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const ic = (name, cls) => '<i data-lucide="' + name + '" class="' + (cls || 'w-4 h-4') + '"></i>';
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
    return null;
  }
  function parts(key) { const p = key.split('-').map(Number); return { y: p[0], m: p[1], d: p[2] }; }
  function dow(key) { const p = parts(key); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function keyOf(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function monthLabel(month) { const [y, m] = month.split('-').map(Number); return MONTHS[m - 1] + ' ' + (y + 543); }
  function shiftMonth(month, delta) { let [y, m] = month.split('-').map(Number); m += delta; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + '-' + pad(m); }
  function fmtDate(key, long) {
    const p = parts(key);
    const base = p.d + ' ' + MONTHS[p.m - 1] + ' ' + (p.y + 543);
    return long ? 'วัน' + DOW[dow(key)] + 'ที่ ' + base : base;
  }
  function fmtShort(key) { const p = parts(key); return DOW_SHORT[dow(key)] + ' ' + p.d + '/' + p.m + '/' + String(p.y + 543).slice(2); }
  function holidayOf(key) { return (S.info.holidays || []).find((h) => h.date === key) || null; }
  function isWeekend(key) { const d = dow(key); return d === 0 || d === 6; }
  function isBlockedHoliday(key) { return !!(S.info.settings.blockHolidays && holidayOf(key)); }
  function isSpecial(key) { return isWeekend(key) || (S.info.settings.holidayAsWeekend && !!holidayOf(key)); }
  function monthOpen(key) {
    const st = S.info.settings;
    if (!st.bookingOpen) return false;
    if (st.closeAt && S.info.today > st.closeAt) return false;
    return !st.bookingMonths.length || st.bookingMonths.indexOf(key.slice(0, 7)) >= 0;
  }
  function sortSlots(slots) { return slots.slice().sort((a, b) => SLOT_COL[a] - SLOT_COL[b]); }
  function fullName(b) { return b.firstName + ' ' + b.lastName; }
  function slotBadges(slots, size) {
    return slots.map((s) => {
      const icn = SLOT_ICON[s] || ['clock', ''];
      return '<span class="badge badge-soft badge-primary slot-badge gap-1 ' + (size || '') + '">' + ic(icn[0], 'w-3.5 h-3.5 ' + icn[1]) + esc(s) + '</span>';
    }).join(' ');
  }

  /* ---------------- icons (Lucide) ---------------- */
  let iconFrame = null;
  function renderIcons() { if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 2 } }); }
  new MutationObserver(() => {
    if (!iconFrame) iconFrame = requestAnimationFrame(() => { iconFrame = null; if (document.querySelector('i[data-lucide]')) renderIcons(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------------- loading (ไม่บังหน้าจอ) ---------------- */
  let loadingCount = 0;
  function loading(on) {
    loadingCount = Math.max(0, loadingCount + (on ? 1 : -1));
    if (loadingCount) document.body.setAttribute('data-loading', ''); else document.body.removeAttribute('data-loading');
  }
  function btnBusy(btn, on) {
    if (!btn) return;
    if (on) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.insertAdjacentHTML('afterbegin', '<span class="loading loading-spinner loading-sm btn-spin"></span>');
    } else {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      const sp = btn.querySelector('.btn-spin'); if (sp) sp.remove();
    }
  }

  /* ---------------- toast (ไม่ขัดจังหวะการใช้งาน) ---------------- */
  const TOAST = {
    ok: ['alert-success', 'circle-check', 3200], err: ['alert-error', 'circle-alert', 6000],
    warn: ['alert-warning', 'triangle-alert', 5000], info: ['alert-info', 'info', 3500]
  };
  function toast(msg, kind) {
    const t = TOAST[kind] || TOAST.info;
    const box = $('toasts');
    while (box.children.length >= 3) box.firstElementChild.remove();
    const el = document.createElement('div');
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    el.className = 'alert alert-soft ' + t[0] + ' shadow-lg';
    el.dataset.kind = kind || 'info';
    el.innerHTML = ic(t[1], 'w-5 h-5') + '<span class="toast-msg text-sm font-medium"></span><button type="button" class="btn btn-ghost btn-xs btn-circle" aria-label="ปิด">' + ic('x', 'w-4 h-4') + '</button><span class="bar"></span>';
    el.querySelector('.toast-msg').textContent = msg;
    el.querySelector('.bar').style.animationDuration = t[2] + 'ms';
    const close = () => { if (el.classList.contains('is-leaving')) return; el.classList.add('is-leaving'); setTimeout(() => el.remove(), 260); };
    el.querySelector('button').onclick = close;
    let timer = setTimeout(close, t[2]);
    el.addEventListener('mouseenter', () => { clearTimeout(timer); el.querySelector('.bar').style.animationPlayState = 'paused'; });
    el.addEventListener('mouseleave', () => { timer = setTimeout(close, 1500); });
    box.appendChild(el);
  }

  /* ---------------- API ---------------- */
  async function api(fn, args, opts) {
    opts = opts || {};
    if (!opts.silent) loading(true);
    btnBusy(opts.btn, true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    try {
      const direct = /^https:\/\/script\.google(usercontent)?\.com\//.test(API_URL);
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': direct ? 'text/plain;charset=utf-8' : 'application/json' },
        body: JSON.stringify({ fn: fn, args: args || {} }),
        redirect: 'follow',
        signal: ctrl.signal
      });
      let out;
      try { out = await res.json(); } catch (e) { throw Object.assign(new Error('เชื่อมต่อ server ไม่สำเร็จ (' + res.status + ')'), { code: 'NETWORK' }); }
      if (!out.ok) throw Object.assign(new Error(out.error || 'เกิดข้อผิดพลาด'), { code: out.code || 'ERROR' });
      return out.data;
    } catch (e) {
      if (e.name === 'AbortError') e = Object.assign(new Error('server ตอบช้าเกินไป กรุณาลองใหม่อีกครั้ง'), { code: 'TIMEOUT' });
      else if (!e.code) { e.code = 'NETWORK'; e.message = 'เชื่อมต่อ server ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'; }
      if (e.code === 'SESSION') handleExpired(fn);
      if (e.code === 'MUST_CHANGE' && S.token && !$('dlg-pin').open) forceChangePin();
      throw e;
    } finally {
      clearTimeout(timer);
      btnBusy(opts.btn, false);
      if (!opts.silent) loading(false);
    }
  }

  function handleExpired(fn) {
    if (fn.indexOf('admin') === 0) { S.admin.token = null; store('brs_admin', null); }
    else { S.token = null; S.user = null; store('brs_session', null); }
    closeAllDialogs();
    showView('login');
  }

  /* ---------------- dialogs + ปุ่มย้อนกลับบนมือถือ ---------------- */
  let ignorePop = 0;
  function openDialog(id) {
    const d = $(id);
    if (d.open) return d;
    d.showModal();
    history.pushState({ dlg: id }, '');
    d.addEventListener('close', function onClose() {
      d.removeEventListener('close', onClose);
      if (history.state && history.state.dlg === id) { ignorePop++; history.back(); }
    });
    return d;
  }
  window.addEventListener('popstate', () => {
    if (ignorePop) { ignorePop--; return; }
    const open = Array.from(document.querySelectorAll('dialog[open]'));
    const top = open[open.length - 1];
    if (!top) return;
    if (top.dataset.locked) history.pushState({ dlg: top.id }, '');
    else top.close();
  });
  function closeAllDialogs() { document.querySelectorAll('dialog[open]').forEach((d) => { delete d.dataset.locked; d.close(); }); }

  /** กล่องยืนยัน — คืน null ถ้ายกเลิก หรือ { value, choice } */
  function ask(o) {
    return new Promise((resolve) => {
      const d = $('dlg-ask');
      const tone = o.danger ? ['bg-error/15 text-error', 'triangle-alert'] : o.tone === 'ok' ? ['bg-success/15 text-success', 'circle-check'] : ['bg-info/15 text-info', o.icon || 'info'];
      $('ask-icon').className = 'icon-tile icon-tile-sm ' + tone[0];
      $('ask-icon').innerHTML = ic(tone[1]);
      $('ask-title').textContent = o.title || '';
      $('ask-text').textContent = o.text || '';
      if (o.html) $('ask-text').insertAdjacentHTML('beforeend', o.html);
      $('ask-choices').innerHTML = (o.choices || []).map((c, i) => '<label class="flex items-center gap-3 p-3 rounded-box border border-base-300 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5"><input type="radio" class="radio radio-primary radio-sm" name="ask-choice" value="' + esc(c.value) + '"' + (i === 0 ? ' checked' : '') + '>' + (c.icon ? ic(c.icon, 'w-4 h-4 ' + (c.iconClass || '')) : '') + '<span>' + esc(c.label) + '</span></label>').join('');
      $('ask-input-wrap').hidden = !o.input;
      $('ask-input').value = '';
      $('ask-input-label').textContent = o.input ? o.input.label : '';
      $('ask-ok').textContent = o.okText || 'ตกลง';
      $('ask-ok').className = 'btn ' + (o.danger ? 'btn-error' : 'btn-primary');
      $('ask-cancel').hidden = !!o.alertOnly;
      const finish = (val) => { cleanup(); d.close(); resolve(val); };
      const onSubmit = (ev) => {
        ev.preventDefault();
        const value = $('ask-input').value.trim();
        if (o.input && o.input.required && !value) { toast(o.input.requiredMsg || 'กรุณากรอกข้อมูล', 'warn'); $('ask-input').focus(); return; }
        const ch = d.querySelector('input[name="ask-choice"]:checked');
        finish({ value: value, choice: ch ? ch.value : null });
      };
      const onCancel = () => finish(null);
      const onClose = () => { cleanup(); resolve(null); };
      function cleanup() {
        $('ask-form').removeEventListener('submit', onSubmit);
        $('ask-cancel').removeEventListener('click', onCancel);
        d.removeEventListener('close', onClose);
      }
      $('ask-form').addEventListener('submit', onSubmit);
      $('ask-cancel').addEventListener('click', onCancel);
      d.addEventListener('close', onClose);
      openDialog('dlg-ask');
      if (o.input) $('ask-input').focus();
    });
  }

  /* ---------------- ธีม สว่าง / มืด / ตามเครื่อง ---------------- */
  const THEME = { light: ['sun', 'text-warning', 'ธีมสว่าง'], dark: ['moon', 'text-info', 'ธีมมืด'], auto: ['monitor', 'text-primary', 'ตามการตั้งค่าเครื่อง'] };
  function getMode() { try { return localStorage.getItem('brs_theme') || 'light'; } catch (e) { return 'light'; } }
  function applyTheme(mode) {
    const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'business' : 'corporate');
    document.documentElement.setAttribute('data-mode', mode);
    const t = THEME[mode];
    const btn = $('theme-btn');
    btn.innerHTML = ic(t[0], 'w-5 h-5 ' + t[1]);
    btn.title = 'ธีม: ' + t[2] + ' (กดเพื่อสลับ)';
    btn.setAttribute('aria-label', 'ธีม: ' + t[2]);
  }
  function cycleTheme() {
    const order = ['light', 'dark', 'auto'];
    const next = order[(order.indexOf(getMode()) + 1) % 3];
    try { localStorage.setItem('brs_theme', next); } catch (e) { /* ignore */ }
    applyTheme(next);
    toast('เปลี่ยนเป็น' + THEME[next][2], 'info');
  }

  /* ---------------- แถบเมนูซ้าย (PC) + หัวเรื่องหน้า ---------------- */
  const PAGES = {
    user: ['calendar-days', 'ปฏิทินจองเวร', 'เลือกวันเพื่อจอง แก้ไข หรือยกเลิกเวร'],
    roster: ['calendar-range', 'ตารางเวรรวม', 'ภาพรวมการจองของบุคลากรทั้งหมด'],
    staff: ['users', 'บุคลากร', 'อนุมัติคำขอ แก้ไขข้อมูล และรีเซ็ต PIN'],
    holidays: ['party-popper', 'วันหยุดราชการ', 'แก้ไขได้เมื่อมีประกาศเปลี่ยนแปลง'],
    settings: ['settings', 'ตั้งค่าระบบ', 'รอบการจอง ประกาศ และล้างข้อมูลเก่า']
  };
  function setPage(key) {
    const p = PAGES[key]; if (!p) return;
    $('page-icon').innerHTML = ic(p[0]);
    $('page-name').textContent = p[1];
    $('page-sub').textContent = p[2];
  }
  function sideItem(id, icon, color, label, extra) {
    return '<li><button type="button" class="side-link flex items-center gap-3 py-2.5" ' + (id ? 'id="' + id + '" ' : '') + (extra || '') + '>' + ic(icon, 'w-5 h-5 ' + color) + '<span>' + esc(label) + '</span></button></li>';
  }
  function renderSidebar(view) {
    const nav = $('side-nav'), foot = $('side-foot');
    if (view === 'user') {
      $('side-label').textContent = 'เมนูบุคลากร';
      nav.innerHTML = sideItem('side-calendar', 'calendar-days', 'text-primary', 'ปฏิทินจองเวร') + sideItem('btn-summary', 'list-checks', 'text-success', 'สรุปเวรของฉัน') + sideItem('btn-change-pin', 'key-round', 'text-warning', 'เปลี่ยน PIN') + sideItem('btn-guide', 'book-open', 'text-success', 'วิธีใช้งาน');
      foot.innerHTML = '<div class="flex items-center gap-3 p-2 rounded-box bg-base-200/60">' + ic('circle-user-round', 'w-8 h-8 text-info') + '<div class="min-w-0 flex-1"><div class="font-semibold truncate">' + esc(S.user.firstName + ' ' + S.user.lastName) + '</div><div class="text-xs opacity-60 truncate">' + esc(POS_SHORT[S.user.position] || S.user.position) + '</div></div></div>' +
        '<button type="button" class="btn btn-ghost btn-block justify-start mt-2" id="btn-logout">' + ic('log-out', 'w-5 h-5 text-error') + 'ออกจากระบบ</button>';
      $('side-calendar').classList.add('active');
      $('side-calendar').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
      $('btn-summary').onclick = () => openSummary('month');
      $('btn-change-pin').onclick = openPinDialog;
      $('btn-guide').onclick = openGuide;
      $('btn-logout').onclick = logout;
    } else if (view === 'admin') {
      $('side-label').textContent = 'เมนูผู้ดูแล';
      nav.innerHTML = sideItem('', 'calendar-range', 'text-primary', 'ตารางเวรรวม', 'data-tab="roster"') + sideItem('', 'users', 'text-info', 'บุคลากร', 'data-tab="staff"') +
        sideItem('', 'party-popper', 'text-holiday', 'วันหยุดราชการ', 'data-tab="holidays"') + sideItem('', 'settings', 'text-accent', 'ตั้งค่าระบบ', 'data-tab="settings"');
      foot.innerHTML = '<div class="flex items-center gap-3 p-2 rounded-box bg-base-200/60">' + ic('shield-check', 'w-8 h-8 text-secondary') + '<div class="font-semibold">ผู้ดูแลระบบ</div></div>';
      nav.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
    }
  }

  function showView(name) {
    ['loading', 'login', 'user', 'admin'].forEach((v) => { $('view-' + v).hidden = v !== name; });
    const act = $('topbar-actions');
    act.innerHTML = '';
    const shell = name === 'user' || name === 'admin';
    document.body.classList.toggle('has-sidebar', shell);
    document.body.classList.toggle('is-login', name === 'login');
    if (shell) { renderSidebar(name); setPage(name === 'user' ? 'user' : S.admin.tab); }
    if (name === 'admin') act.innerHTML = '<span class="badge badge-secondary badge-soft gap-1 hidden sm:inline-flex">' + ic('shield-check', 'w-3.5 h-3.5') + 'ผู้ดูแลระบบ</span><button class="btn btn-ghost btn-sm" id="btn-admin-logout" aria-label="ออกจากระบบผู้ดูแล">' + ic('log-out', 'w-4 h-4 text-error') + '<span class="hidden sm:inline">ออกจากระบบ</span></button>';
    const alo = $('btn-admin-logout'); if (alo) alo.onclick = adminLogout;
    if (name === 'login') { resetLogin(); setLoginMode('staff', false); }
    window.scrollTo(0, 0);
  }

  function renderNotice() {
    const st = S.info.settings;
    const html = st.notice
      ? '<div role="note" class="alert alert-soft alert-info items-start">' + ic('megaphone', 'w-5 h-5 text-info mt-0.5') + '<div class="text-sm"><b>หมายเหตุ:</b> ' + esc(st.notice) + (st.contact ? ' <span class="whitespace-nowrap">' + ic('phone', 'w-3.5 h-3.5 inline text-success') + ' ติดต่อ ' + esc(st.contact) + '</span>' : '') + '</div></div>'
      : '';
    $('forgot-contact').textContent = st.contact ? 'โทร ' + st.contact : '';
    $('default-pin-text').textContent = st.defaultPin || '1234';
    $('notice-login').innerHTML = $('notice-login-m').innerHTML = st.notice ? '<p>' + esc(st.notice) + '</p>' + (st.contact ? '<p class="login-contact">' + ic('phone', 'w-4 h-4 text-success') + 'ติดต่อ ' + esc(st.contact) + '</p>' : '') : '';
    renderLoginDay();
    $('notice-user').innerHTML = html;
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    applyTheme(getMode());
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getMode() === 'auto') applyTheme('auto'); });
    bindStatic();
    try {
      S.info = await api('getPublicInfo', {}, { silent: true });
    } catch (e) {
      $('view-loading').innerHTML = '<div class="card bg-base-100 shadow max-w-md w-full"><div class="card-body items-center text-center"><span class="icon-tile bg-error/15 text-error">' + ic('circle-alert') + '</span><h2 class="card-title">เชื่อมต่อ server ไม่สำเร็จ</h2><p class="opacity-70">' + esc(e.message) + '</p><button class="btn btn-primary" id="btn-retry">' + ic('rotate-ccw') + 'ลองใหม่</button></div></div>';
      $('btn-retry').onclick = () => location.reload();
      return;
    }
    $('app-title').textContent = S.info.title;
    $('app-org').textContent = S.info.org;
    renderNotice();
    fillPositions();
    S.month = S.info.today.slice(0, 7);
    S.admin.month = S.month;

    const adm = store('brs_admin');
    const ses = store('brs_session');
    if (adm && adm.token) {
      S.admin.token = adm.token;
      try { await enterAdmin(); return; } catch (e) { /* fall through */ }
    }
    if (ses && ses.token) {
      S.token = ses.token; S.user = ses.user;
      try { await enterUser(); return; } catch (e) { /* fall through */ }
    }
    showView('login');
  }

  function fillPositions() {
    const opts = '<option value="">เลือกตำแหน่ง...</option>' + S.info.positions.map((p) => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join('');
    $('req-position').innerHTML = opts;
    $('st-position').innerHTML = opts;
    $('f-position').innerHTML = '<option value="">ทุกตำแหน่ง</option>' + S.info.positions.map((p) => '<option value="' + esc(p) + '">' + esc(POS_SHORT[p] || p) + '</option>').join('');
    $('f-room').innerHTML = '<option value="">ทุกห้อง</option>' + S.info.rooms.map((r) => '<option value="' + esc(r.name) + '">' + esc(r.name) + '</option>').join('');
    const stations = [];
    S.info.rooms.forEach((r) => r.stations.forEach((s) => { if (stations.indexOf(s) < 0) stations.push(s); }));
    $('f-station').innerHTML = '<option value="">ทุกจุด</option>' + stations.map((s) => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
  }

  /* ---------------- login ---------------- */
  // วันนี้ + สถานะรอบจอง (แสดงเฉพาะเมื่อมีเรื่องต้องบอก: ปิดรับ / เปิดเฉพาะบางเดือน / มีวันปิดรับ)
  function renderLoginDay() {
    const t = S.info.today, p = parts(t), st = S.info.settings;
    $('login-today').textContent = 'วัน' + DOW[dow(t)] + 'ที่ ' + p.d + ' ' + MONTHS[p.m - 1] + ' ' + (p.y + 543);
    const r = $('login-round');
    const closed = !st.bookingOpen || (st.closeAt && t > st.closeAt);
    let txt = '', tone = 'open';
    if (closed) { txt = 'ตอนนี้ปิดรับจองเวร'; tone = 'closed'; }
    else {
      if (st.bookingMonths.length) txt = 'เปิดรับจองเดือน' + st.bookingMonths.map(monthLabel).join(', ');
      if (st.closeAt) {
        const left = Math.round((Date.UTC(...st.closeAt.split('-').map((x, i) => i === 1 ? x - 1 : +x)) - Date.UTC(p.y, p.m - 1, p.d)) / 86400000);
        txt += (txt ? ' ' : '') + (left === 0 ? 'ปิดรับวันนี้' : 'ปิดรับ ' + fmtDate(st.closeAt) + ' (อีก ' + left + ' วัน)');
        if (left <= 3) tone = 'soon';
      }
    }
    r.dataset.tone = tone;
    r.textContent = txt;
    r.hidden = !txt;
  }

  function renderPinCells() {
    const n = $('login-pin').value.length;
    document.querySelectorAll('#pin-field .pin-cells span').forEach((c, i) => c.classList.toggle('on', i < n));
  }

  function openGuide() {
    const g = window.BRS_GUIDE;
    if (!$('guide-steps').childElementCount) {
      $('guide-steps').innerHTML = g.steps.map((x) => '<li><span class="guide-ic" style="--c:var(--' + x.tone + ')">' + ic(x.icon) + '</span><div><b>' + esc(x.title) + '</b><p>' + esc(x.text) + '</p></div></li>').join('');
    }
    const c = S.info && S.info.settings && S.info.settings.contact;
    $('guide-home').innerHTML = ic('smartphone', 'w-5 h-5 text-info') + '<span><b>' + esc(g.homeTitle) + '</b> ' + esc(g.home) + '</span>';
    $('guide-forgot').innerHTML = ic('life-buoy', 'w-5 h-5 text-error') + '<span>' + esc(g.forgot) + (c ? ' โทร ' + esc(c) : '') + '</span>';
    openDialog('dlg-guide');
  }

  function setLoginMode(mode, focus) {
    const admin = mode === 'admin';
    $('login-panel').dataset.mode = admin ? 'admin' : 'staff';
    $('login-staff').hidden = admin;
    $('admin-login-form').hidden = !admin;
    if (focus !== false) (admin ? $('adm-user') : ($('staff-combo').hidden ? $('login-pin') : $('staff-search'))).focus();
  }

  function resetLogin() {
    S.picked = null;
    $('staff-search').value = '';
    $('staff-combo').hidden = false;
    $('staff-picked').hidden = true;
    $('staff-options').hidden = true;
    $('login-pin').value = '';
    renderPinCells();
  }

  function renderCombo() {
    const q = $('staff-search').value.trim().toLowerCase();
    const list = $('staff-options');
    if (!q) { list.hidden = true; return; }
    const hits = S.info.staff.filter((s) => s.name.toLowerCase().indexOf(q) >= 0).slice(0, 12);
    list.innerHTML = hits.length
      ? hits.map((s, i) => '<li><button type="button" class="combo-item flex items-center gap-3' + (i === 0 ? ' menu-active' : '') + '" data-id="' + esc(s.id) + '">' + ic('user', 'w-4 h-4 text-primary') + '<span class="flex flex-col items-start text-left"><span class="font-semibold">' + esc(s.name) + '</span><span class="text-xs opacity-70">' + esc(POS_SHORT[s.position] || s.position) + '</span></span></button></li>').join('')
      : '<li class="p-3 text-sm opacity-70 flex flex-row gap-2 items-center">' + ic('user-x', 'w-4 h-4 text-error') + 'ไม่พบชื่อ — กด "ขอเพิ่มรายชื่อ" ด้านล่าง</li>';
    list.hidden = false;
  }

  function pickStaff(id) {
    const s = S.info.staff.find((x) => x.id === id);
    if (!s) return;
    S.picked = s;
    $('staff-options').hidden = true;
    $('staff-combo').hidden = true;
    const p = $('staff-picked');
    p.innerHTML = '<span class="login-avatar" aria-hidden="true">' + esc(s.name.trim().charAt(0)) + '</span><div class="flex-1 min-w-0"><div class="font-bold leading-snug">' + esc(s.name) + '</div><div class="text-sm opacity-70 leading-snug">' + esc(s.position) + '</div></div><button type="button" class="btn btn-ghost btn-sm px-2" id="btn-repick" aria-label="เปลี่ยนชื่อ">' + ic('rotate-ccw', 'w-4 h-4 text-primary') + '<span class="hidden sm:inline">เปลี่ยน</span></button>';
    p.hidden = false;
    $('btn-repick').onclick = () => { resetLogin(); $('staff-search').focus(); };
    $('login-pin').focus();
  }

  async function doLogin() {
    if (!S.picked) { toast('กรุณาเลือกชื่อของคุณก่อน', 'warn'); $('staff-search').focus(); return; }
    const pin = $('login-pin').value.trim();
    if (!pin) { toast('กรุณากรอก PIN', 'warn'); $('login-pin').focus(); return; }
    try {
      const r = await api('login', { staffId: S.picked.id, pin: pin }, { btn: $('btn-login') });
      afterLogin(r);
    } catch (e) {
      toast(e.message, 'err');
      $('login-pin').value = ''; renderPinCells(); $('login-pin').focus();
    }
  }

  async function afterLogin(r) {
    S.token = r.token; S.user = r.user;
    store('brs_session', { token: r.token, user: r.user });
    try { await enterUser(); } catch (e) { toast(e.message, 'err'); return; }
    if (r.mustChange && !$('dlg-pin').open) forceChangePin();
  }

  function defaultPin() { return (S.info && S.info.settings && S.info.settings.defaultPin) || '1234'; }

  // บัญชีที่ใช้ PIN เริ่มต้น: ต้องตั้ง PIN ใหม่ก่อนใช้งาน (PIN เดิม = PIN เริ่มต้น จึงไม่ต้องกรอก)
  function forceChangePin() {
    $('pin-form').reset();
    $('pin-old').value = defaultPin();
    $('pin-old-wrap').hidden = true;
    $('pin-force-note').hidden = false;
    $('pin-cancel').hidden = true;
    $('dlg-pin').dataset.locked = '1';
    openDialog('dlg-pin');
  }

  async function logout() {
    const t = S.token;
    S.token = null; S.user = null; store('brs_session', null);
    showView('login');
    toast('ออกจากระบบแล้ว', 'info');
    if (t) api('logout', { token: t }, { silent: true }).catch(() => {});
  }

  /* ---------------- user view ---------------- */
  async function enterUser() {
    const r = await loadMyMonth();
    const h = new Date().getHours();
    $('greet-time').textContent = h < 12 ? 'สวัสดีตอนเช้า' : h < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
    $('hello').textContent = S.user.firstName + ' ' + S.user.lastName;
    S.multi = null; $('multi-toggle').checked = false;
    loadUpcoming();
    $('user-position').textContent = S.user.position;
    showView('user');
    renderCalendar();
    selectDay(S.selected && S.selected.slice(0, 7) === S.month ? S.selected : (S.info.today.slice(0, 7) === S.month ? S.info.today : null), true);
    if (r && r.mustChange && !$('dlg-pin').open) forceChangePin();
  }

  async function loadUpcoming() {
    try { const r = await api('getMyBookings', { token: S.token, upcoming: true }, { silent: true }); S.upcoming = r.bookings; } catch (e) { S.upcoming = null; }
    renderKpis();
  }

  function kpi(icon, tone, label, value, sub, id) {
    return '<div class="kpi card bg-base-100 shadow-sm motion-fade-up"' + (id ? ' id="' + id + '"' : '') + '><div class="card-body p-4 flex-row items-center gap-3"><span class="icon-tile ' + tone + '">' + ic(icon) + '</span><div class="min-w-0"><div class="text-xs opacity-70">' + esc(label) + '</div><div class="text-lg font-bold leading-tight truncate">' + value + '</div>' + (sub ? '<div class="text-xs opacity-70 truncate">' + sub + '</div>' : '') + '</div></div></div>';
  }

  function renderKpis() {
    if (!S.user || !$('kpis')) return;
    const next = (S.upcoming || []).filter((b) => b.date >= S.info.today)[0];
    const days = {}; let slots = 0;
    S.my.bookings.forEach((b) => { days[b.date] = 1; slots += b.slots.length; });
    const st = S.info.settings;
    let roundVal, roundSub, roundTone;
    const closed = !st.bookingOpen || (st.closeAt && S.info.today > st.closeAt);
    if (closed) { roundVal = 'ปิดรับจอง'; roundSub = st.contact ? 'ติดต่อ ' + esc(st.contact) : ''; roundTone = 'bg-error/15 text-error'; }
    else if (st.closeAt) {
      const left = Math.round((Date.UTC(...st.closeAt.split('-').map((x, i) => i === 1 ? x - 1 : +x)) - Date.UTC(...S.info.today.split('-').map((x, i) => i === 1 ? x - 1 : +x))) / 86400000);
      roundVal = left === 0 ? 'ปิดรับวันนี้' : 'เหลืออีก ' + left + ' วัน';
      roundSub = 'ปิดรับจอง ' + esc(fmtDate(st.closeAt)); roundTone = left <= 3 ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success';
    } else { roundVal = 'เปิดรับจอง'; roundSub = st.bookingMonths.length ? 'เดือน ' + esc(st.bookingMonths.map(monthLabel).join(', ')) : ''; roundTone = 'bg-success/15 text-success'; }
    $('kpis').innerHTML =
      kpi('calendar-clock', 'bg-primary/15 text-primary', 'เวรถัดไปของฉัน', next ? esc(fmtDate(next.date, true).replace('ที่ ', ' ')) : 'ยังไม่มีเวร', next ? esc(ROOM_SHORT(next.room) + ' · ' + next.slots.join(', ')) : 'เลือกวันบนปฏิทินเพื่อจอง', 'kpi-next') +
      kpi('list-checks', 'bg-info/15 text-info', 'เวรเดือน' + monthLabel(S.month).split(' ')[0], Object.keys(days).length + ' วัน · ' + slots + ' ช่วง', S.my.leaves.length ? 'ลา/ยกเลิก ' + S.my.leaves.length + ' รายการ' : '', 'kpi-month') +
      kpi(closed ? 'ban' : 'hourglass', roundTone, 'รอบการจอง', roundVal, roundSub, 'kpi-round');
  }

  async function loadMyMonth(opts) {
    const r = await api('getMyBookings', { token: S.token, month: S.month }, opts);
    S.my = { bookings: r.bookings, leaves: r.leaves };
    S.user = r.user;
    if (r.today) S.info.today = r.today;
    renderKpis();
    return r;
  }

  // ใช้ข้อมูลที่ส่งกลับมาพร้อมคำตอบบันทึก/ยกเลิก (ไม่ต้องเรียก server ซ้ำอีก 2 รอบ)
  async function applyView(v) {
    if (v && v.month === S.month) {
      S.my = { bookings: v.bookings, leaves: v.leaves };
      S.upcoming = v.upcoming;
      if (v.today) S.info.today = v.today;
      renderKpis();
    } else {
      await loadMyMonth();
      if (v) { S.upcoming = v.upcoming; renderKpis(); } else loadUpcoming();
    }
    renderCalendar();
  }

  function reopenBooking(saved) {
    openBooking({ mode: saved.mode, date: saved.date, dates: saved.dates, booking: saved.booking });
    $('booking-room').value = saved.room;
    fillStations(saved.station);
    renderSlots(saved.slots);
  }

  let monthBusy = false;
  async function changeMonth(delta) {
    if (monthBusy) return;
    monthBusy = true;
    const prev = S.month;
    S.month = shiftMonth(S.month, delta);
    S.selected = null;
    $('calendar').style.opacity = '.55';
    try { await loadMyMonth(); } catch (e) { toast(e.message, 'err'); S.month = prev; }
    $('calendar').style.opacity = '';
    monthBusy = false;
    if (!S.token) return;
    renderCalendar(delta);
    if (S.multi) renderMultiPanel(); else selectDay(null, true);
  }

  function renderCalendar(dir) {
    $('cal-title').textContent = monthLabel(S.month);
    const [y, m] = S.month.split('-').map(Number);
    const first = keyOf(y, m, 1);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const open = monthOpen(first) || monthOpen(keyOf(y, m, days));
    $('month-status').innerHTML = open
      ? '<span class="badge badge-success badge-soft gap-1">' + ic('circle-check', 'w-3.5 h-3.5') + 'เปิดรับจองเวรเดือนนี้</span>'
      : '<span class="badge badge-error badge-soft gap-1">' + ic('ban', 'w-3.5 h-3.5') + 'ปิดรับจองเวรเดือนนี้</span> <span class="text-xs opacity-70 block sm:inline">ยกเลิกได้โดยแจ้งลาเวร</span>';
    let html = '';
    for (let i = 0; i < dow(first); i++) html += '<div class="cal-day is-empty"></div>';
    for (let d = 1; d <= days; d++) {
      const key = keyOf(y, m, d);
      const wd = dow(key);
      const hol = holidayOf(key);
      const cls = ['cal-day', 'motion-pop'];
      if (wd === 6) cls.push('is-sat');
      if (wd === 0) cls.push('is-sun');
      if (hol) cls.push('is-holiday');
      if (hol && S.info.settings.blockHolidays) cls.push('is-blocked');
      if (key < S.info.today) cls.push('is-past');
      if (key === S.info.today) cls.push('is-today');
      if (key === S.selected) cls.push('is-selected');
      if (S.multi && S.multi.indexOf(key) >= 0) cls.push('is-picked');
      const mine = S.my.bookings.filter((b) => b.date === key);
      const pending = S.pending && S.pending.indexOf(key) >= 0;
      if (pending) cls.push('is-pending');
      const chips = mine.map((b) => '<span class="chip">' + esc(ROOM_SHORT(b.room)) + '<span class="slots"> ' + esc(b.slots.map((s) => SLOT_SHORT[s] || s).join('·')) + '</span></span>').join('') +
        (pending ? '<span class="chip chip-pending"><span class="loading loading-spinner loading-xs"></span> กำลังบันทึก</span>' : '');
      const label = fmtDate(key, true) + (hol ? ' ' + hol.name : '') + (mine.length ? ' มีเวร ' + mine.length + ' รายการ' : '');
      html += '<button type="button" class="' + cls.join(' ') + '" style="--i:' + d + '" data-date="' + key + '" aria-label="' + esc(label) + '"><span class="num"><span>' + d + '</span>' + (hol ? '<span class="hol-dot"></span>' : '') + '</span>' +
        (hol ? '<span class="hname">' + esc(hol.name) + '</span>' : '') + chips + '</button>';
    }
    const cal = $('calendar');
    cal.innerHTML = html;
    cal.classList.remove('motion-slide-left', 'motion-slide-right');
    if (dir) { void cal.offsetWidth; cal.classList.add(dir > 0 ? 'motion-slide-right' : 'motion-slide-left'); }
  }

  /* ---------------- เลือกหลายวัน ---------------- */
  function setMulti(on) {
    S.multi = on ? [] : null;
    $('multi-toggle').checked = on;
    $('multi-hint').textContent = on ? 'แตะวันที่ต้องการ (เลือกได้หลายวัน) แล้วกด "จองวันที่เลือก"' : 'แตะวันที่เพื่อดูหรือจองเวร';
    renderCalendar();
    if (on) renderMultiPanel(); else selectDay(null, true);
  }
  function togglePick(key) {
    const i = S.multi.indexOf(key);
    if (i >= 0) S.multi.splice(i, 1);
    else {
      if (key < S.info.today) { toast('ไม่สามารถจองย้อนหลังได้', 'warn'); return; }
      if (!monthOpen(key)) { toast('ปิดรับจองเวรของเดือนนี้แล้ว', 'warn'); return; }
      if (isBlockedHoliday(key)) { toast('วันหยุดนักขัตฤกษ์ (' + holidayOf(key).name + ') ปิดรับจอง', 'warn'); return; }
      if (S.multi.length && isSpecial(S.multi[0]) !== isSpecial(key)) { toast('เลือกได้เฉพาะวันประเภทเดียวกัน (วันธรรมดา หรือ เสาร์-อาทิตย์/วันหยุด) เพราะช่วงเวลาต่างกัน', 'warn'); return; }
      if (S.multi.length >= 31) { toast('เลือกได้ไม่เกิน 31 วันต่อครั้ง', 'warn'); return; }
      S.multi.push(key); S.multi.sort();
    }
    const el = document.querySelector('#calendar .cal-day[data-date="' + key + '"]');
    if (el) el.classList.toggle('is-picked', S.multi.indexOf(key) >= 0);
    renderMultiPanel();
  }
  function renderMultiPanel() {
    const list = S.multi || [];
    let html = '<div class="motion-fade-up"><div class="flex items-start gap-3"><span class="icon-tile bg-accent/15 text-accent">' + ic('calendar-range') + '</span><div><h3 class="font-bold text-lg leading-tight">เลือกหลายวัน</h3><div class="text-sm opacity-70">' +
      (list.length ? 'เลือกแล้ว ' + list.length + ' วัน · ' + (isSpecial(list[0]) ? 'เสาร์-อาทิตย์/วันหยุด (1 ช่วงต่อวัน)' : 'วันธรรมดา') : 'แตะวันที่บนปฏิทินเพื่อเลือก') + '</div></div></div>';
    html += '<div class="flex flex-wrap gap-1 mt-3" id="multi-list">' + list.map((d) => '<span class="badge badge-accent badge-soft gap-1">' + esc(fmtShort(d)) + '<button type="button" class="btn btn-ghost btn-xs btn-circle" data-unpick="' + d + '" aria-label="เอาออก">' + ic('x', 'w-3 h-3') + '</button></span>').join('') + '</div>';
    html += '<button class="btn btn-primary btn-block mt-4" id="btn-book-multi"' + (list.length ? '' : ' disabled') + '>' + ic('calendar-plus', 'w-5 h-5') + 'จองวันที่เลือก' + (list.length ? ' (' + list.length + ' วัน)' : '') + '</button>';
    html += '<button class="btn btn-ghost btn-block mt-2" id="btn-multi-clear"' + (list.length ? '' : ' disabled') + '>' + ic('rotate-ccw', 'w-4 h-4') + 'ล้างที่เลือก</button></div>';
    $('day-panel').innerHTML = html;
    $('btn-book-multi').onclick = () => openBooking({ mode: 'bulk', dates: S.multi.slice() });
    $('btn-multi-clear').onclick = () => { S.multi = []; renderCalendar(); renderMultiPanel(); };
    $('day-panel').querySelectorAll('[data-unpick]').forEach((b) => { b.onclick = () => togglePick(b.dataset.unpick); });
  }

  function selectDay(key, noScroll) {
    S.selected = key;
    document.querySelectorAll('#calendar .cal-day').forEach((el) => el.classList.toggle('is-selected', el.dataset.date === key));
    const panel = $('day-panel');
    if (!key) {
      panel.innerHTML = '<div class="flex flex-col items-center text-center gap-3 py-6 opacity-80"><span class="icon-tile bg-primary/10 text-primary w-14 h-14">' + ic('calendar-days', 'w-7 h-7') + '</span><div>เลือกวันที่บนปฏิทินเพื่อดูหรือจองเวร</div></div>';
      return;
    }
    const hol = holidayOf(key);
    const special = isSpecial(key);
    const past = key < S.info.today;
    const open = monthOpen(key);
    const mine = S.my.bookings.filter((b) => b.date === key);
    const left = S.my.leaves.filter((b) => b.date === key);
    let typeText;
    if (isBlockedHoliday(key)) typeText = 'วันหยุดนักขัตฤกษ์ — ปิดรับจอง';
    else if (special) typeText = (isWeekend(key) ? 'วันเสาร์-อาทิตย์' : 'วันหยุดราชการ') + ' — เลือกได้ 1 ช่วงเวลา และจองได้ 1 เวรต่อวัน';
    else typeText = (hol ? 'วันหยุดราชการ (ใช้ช่วงเวลาแบบวันธรรมดา)' : 'วันธรรมดา') + ' — เลือกได้หลายช่วงเวลา';
    let html = '<div class="motion-fade-up"><div class="flex items-start gap-3"><span class="icon-tile ' + (hol ? 'bg-holiday-soft text-holiday' : special ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary') + '">' + ic(hol ? 'party-popper' : special ? 'sun' : 'calendar-days') + '</span><div><h3 class="font-bold text-lg leading-tight">' + esc(fmtDate(key, true)) + '</h3>' +
      (hol ? '<div class="text-holiday font-semibold text-sm">' + esc(hol.name) + '</div>' : '') + '<div class="text-sm opacity-70">' + esc(typeText) + '</div></div></div>';
    html += '<div class="grid gap-2 mt-4">';
    if (!mine.length) html += '<div class="text-sm opacity-70 flex items-center gap-2">' + ic('calendar-x', 'w-4 h-4 text-base-content/50') + 'ยังไม่มีเวรที่คุณจองในวันนี้</div>';
    mine.forEach((b, i) => {
      html += '<div class="bk rounded-box border border-base-300 bg-base-200/50 p-3 motion-fade-up" style="--i:' + i + '"><div class="flex items-start gap-2">' + ic('building-2', 'w-4 h-4 text-primary mt-1') + '<div class="flex-1 min-w-0"><div class="font-semibold">' + esc(b.room) + '</div><div class="text-sm opacity-70 flex items-center gap-1">' + ic('map-pin', 'w-3.5 h-3.5 text-error') + esc(b.station) + '</div></div></div>' +
        '<div class="flex flex-wrap gap-1 mt-2">' + slotBadges(b.slots) + '</div>' +
        (past ? '' : '<div class="flex justify-end gap-2 mt-2">' +
          (open && !isBlockedHoliday(key) ? '<button class="btn btn-sm btn-ghost" data-edit="' + esc(b.id) + '">' + ic('pencil', 'w-4 h-4 text-info') + 'แก้ไข</button>' : '') +
          '<button class="btn btn-sm ' + (open ? 'btn-ghost' : 'btn-error btn-soft') + '" data-cancel="' + esc(b.id) + '">' + ic(open ? 'trash-2' : 'calendar-x', 'w-4 h-4 text-error') + (open ? 'ยกเลิก' : 'แจ้งลาเวร') + '</button></div>') +
        '</div>';
    });
    html += '</div>';
    if (left.length) {
      html += '<div class="mt-3 text-xs opacity-70 flex items-center gap-1">' + ic('history', 'w-3.5 h-3.5 text-warning') + 'ประวัติยกเลิก/ลาในวันนี้</div><ul class="text-sm mt-1 grid gap-1" id="day-history">';
      left.forEach((b) => { html += '<li class="flex flex-wrap gap-2"><span class="badge badge-sm ' + (b.type === 'ลาเวร' ? 'badge-warning' : 'badge-ghost') + '">' + esc(b.type) + '</span><span class="opacity-80">' + esc(ROOM_SHORT(b.room)) + ' ' + esc(b.slots.join(', ')) + (b.reason ? ' (' + esc(b.reason) + ')' : '') + '</span></li>'; });
      html += '</ul>';
    }
    let reason = '';
    if (past) reason = 'ไม่สามารถจองย้อนหลังได้';
    else if (isBlockedHoliday(key)) reason = 'วันหยุดนักขัตฤกษ์ ปิดรับจอง';
    else if (!open) reason = 'ปิดรับจองเวรของเดือนนี้แล้ว';
    else if (special && mine.length) reason = 'วันนี้คุณจองครบ 1 เวรแล้ว';
    html += '<button class="btn btn-primary btn-block mt-4" id="btn-book"' + (reason ? ' disabled' : '') + '>' + ic('calendar-plus', 'w-5 h-5') + 'จองเวรวันนี้</button>';
    if (reason) html += '<p class="text-center text-xs opacity-70 mt-2" id="book-reason">' + esc(reason) + '</p>';
    html += '</div>';
    panel.innerHTML = html;
    const bb = $('btn-book'); if (bb && !reason) bb.onclick = () => openBooking({ mode: 'user', date: key });
    panel.querySelectorAll('[data-edit]').forEach((el) => { el.onclick = () => openBooking({ mode: 'user', date: key, booking: mine.find((b) => b.id === el.dataset.edit) }); });
    panel.querySelectorAll('[data-cancel]').forEach((el) => { el.onclick = () => cancelMine(mine.find((b) => b.id === el.dataset.cancel), el); });
    if (!noScroll && window.innerWidth < 1024) $('day-panel-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function cancelMine(b, btn) {
    const open = monthOpen(b.date);
    const r = await ask({
      title: open ? 'ยกเลิกการจองนี้?' : 'แจ้งลาเวร',
      text: fmtDate(b.date, true) + '\n' + b.room + ' — ' + b.station + '\n' + b.slots.join(', ') +
        (open ? '' : '\n\nรอบจองเดือนนี้ปิดแล้ว ระบบจะบันทึกเป็น "ลาเวร" ให้ผู้ดูแลทราบ'),
      input: open ? { label: 'เหตุผล (ไม่บังคับ)' } : { label: 'เหตุผลการลา', required: true, requiredMsg: 'กรุณาระบุเหตุผลการลา' },
      okText: open ? 'ยืนยันยกเลิก' : 'ยืนยันลาเวร',
      danger: true
    });
    if (!r) return;
    try {
      const res = await api('cancelBooking', { token: S.token, id: b.id, reason: r.value, month: S.month }, { btn: btn });
      toast(res.message, 'ok');
      await applyView(res.view);
      selectDay(b.date, true);
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- booking dialog (user + admin) ---------------- */
  let BK = null;
  function openBooking(o) {
    BK = o;
    const isAdmin = o.mode === 'admin';
    const b = o.booking || null;
    $('booking-title').textContent = b ? 'แก้ไขการจอง' : (isAdmin ? 'เพิ่มการจอง' : o.mode === 'bulk' ? 'จองหลายวัน (' + o.dates.length + ' วัน)' : 'จองเวร');
    $('booking-staff-field').hidden = !isAdmin;
    $('booking-date-field').hidden = !isAdmin;
    $('booking-date').hidden = isAdmin;
    if (isAdmin) {
      const staff = S.admin.staff.filter((s) => s.status === 'active' || (b && s.firstName === b.firstName && s.lastName === b.lastName))
        .sort((x, y) => (x.firstName + x.lastName).localeCompare(y.firstName + y.lastName, 'th'));
      $('booking-staff').innerHTML = '<option value="">เลือกบุคลากร...</option>' + staff.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.firstName + ' ' + s.lastName) + ' — ' + esc(POS_SHORT[s.position] || s.position) + '</option>').join('');
      const cur = b ? staff.find((s) => s.firstName === b.firstName && s.lastName === b.lastName) : null;
      $('booking-staff').value = cur ? cur.id : '';
      $('booking-date-input').value = o.date || '';
    } else if (o.mode === 'bulk') {
      $('booking-date').innerHTML = ic('calendar-range', 'w-5 h-5 text-accent') + '<span class="font-semibold">' + esc(o.dates.map(fmtShort).join(', ')) + '</span>';
    } else {
      $('booking-date').innerHTML = ic('calendar-days', 'w-5 h-5 text-primary') + '<span class="font-semibold">' + esc(fmtDate(o.date, true)) + '</span>';
    }
    $('booking-room').innerHTML = '<option value="">เลือกห้อง...</option>' + S.info.rooms.map((r) => '<option value="' + esc(r.name) + '">' + esc(r.name) + '</option>').join('');
    $('booking-room').value = b ? b.room : '';
    fillStations(b ? b.station : '');
    renderSlots(b ? b.slots : []);
    openDialog('dlg-booking');
  }

  function bookingDate() { return BK.mode === 'admin' ? $('booking-date-input').value : BK.mode === 'bulk' ? BK.dates[0] : BK.date; }

  function fillStations(selected) {
    const room = S.info.rooms.find((r) => r.name === $('booking-room').value);
    const st = $('booking-station');
    st.innerHTML = '<option value="">เลือกจุดปฏิบัติงาน...</option>' + (room ? room.stations.map((s) => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('') : '');
    st.disabled = !room;
    st.value = selected || '';
  }

  function renderSlots(checked) {
    const date = bookingDate();
    const box = $('booking-slots');
    if (!date) { box.innerHTML = '<div class="text-sm opacity-70">เลือกวันที่ก่อน</div>'; $('booking-hint').textContent = ''; return; }
    const special = isSpecial(date);
    const slots = special ? S.info.specialSlots : S.info.weekdaySlots;
    $('booking-hint').textContent = special ? '(เลือกได้ 1 ช่วง)' : '(เลือกได้หลายช่วง)';
    const taken = {};
    if (BK.mode === 'user') {
      S.my.bookings.filter((b) => b.date === date && (!BK.booking || b.id !== BK.booking.id))
        .forEach((b) => b.slots.forEach((s) => { taken[SLOT_COL[s]] = b; }));
    }
    const type = special ? 'radio' : 'checkbox';
    box.innerHTML = slots.map((s) => {
      const t = taken[SLOT_COL[s]];
      const icn = SLOT_ICON[s] || ['clock', ''];
      return '<label class="flex items-center gap-3 p-3 rounded-box border border-base-300 cursor-pointer transition has-[:checked]:border-primary has-[:checked]:bg-primary/5' + (t ? ' opacity-50 cursor-not-allowed' : '') + '">' +
        '<input type="' + type + '" name="slot" value="' + esc(s) + '" class="' + (special ? 'radio radio-primary' : 'checkbox checkbox-primary') + '"' + (checked.indexOf(s) >= 0 ? ' checked' : '') + (t ? ' disabled' : '') + '>' +
        ic(icn[0], 'w-5 h-5 ' + icn[1]) + '<span class="flex flex-col"><span class="font-semibold">' + esc(s) + '</span>' + (t ? '<small class="text-error">จองแล้วที่ ' + esc(ROOM_SHORT(t.room)) + '</small>' : '<small class="opacity-60">' + esc(SLOT_SHORT[s] || '') + '</small>') + '</span></label>';
    }).join('');
  }

  async function submitBooking(ev) {
    ev.preventDefault();
    const date = bookingDate();
    const slots = Array.from(document.querySelectorAll('#booking-slots input:checked')).map((i) => i.value);
    const args = { date: date, room: $('booking-room').value, station: $('booking-station').value, slots: sortSlots(slots) };
    if (BK.booking) args.id = BK.booking.id;
    if (!date) { toast('กรุณาเลือกวันที่', 'warn'); return; }
    if (!args.room || !args.station) { toast('กรุณาเลือกห้องและจุดปฏิบัติงาน', 'warn'); return; }
    if (!slots.length) { toast('กรุณาเลือกช่วงเวลา', 'warn'); return; }
    const btn = $('booking-submit');
    if (btn.disabled) return; // กันกดซ้ำ
    if (BK.mode === 'bulk' || BK.mode === 'user') {
      // ปิดหน้าต่างทันทีแล้วบันทึกเบื้องหลัง (ปฏิทินขึ้น "กำลังบันทึก") — ถ้าไม่สำเร็จจะเปิดหน้าต่างเดิมพร้อมค่าที่เลือกไว้ให้แก้
      const bulk = BK.mode === 'bulk';
      const saved = { mode: BK.mode, date: BK.date, dates: BK.dates, booking: BK.booking, room: args.room, station: args.station, slots: args.slots };
      const payload = bulk ? { token: S.token, dates: BK.dates, room: args.room, station: args.station, slots: args.slots, month: S.month } : Object.assign({}, args, { token: S.token, month: S.month });
      $('dlg-booking').close();
      if (bulk) setMulti(false);
      S.pending = bulk ? saved.dates.slice() : [date];
      renderCalendar();
      try {
        const res = await api(bulk ? 'saveBookings' : 'saveBooking', payload);
        S.pending = null;
        await applyView(res.view);
        if (!bulk) selectDay(date, true);
        if (!bulk || !res.failed) toast(res.message, 'ok');
        else {
          toast(res.message, 'warn');
          await ask({ title: 'บางวันจองไม่สำเร็จ', icon: 'triangle-alert', alertOnly: true, okText: 'รับทราบ', text: res.results.filter((r) => !r.ok).map((r) => '• ' + fmtDate(r.date, true) + ': ' + r.error).join('\n') });
        }
      } catch (e) {
        S.pending = null;
        renderCalendar();
        toast(e.message, e.code === 'DUPLICATE' || e.code === 'RULE' || e.code === 'CLOSED' || e.code === 'HOLIDAY' ? 'warn' : 'err');
        if (e.code !== 'SESSION' && e.code !== 'MUST_CHANGE') reopenBooking(saved);
      }
      return;
    }
    try {
      if (BK.mode === 'admin') {
        args.staffId = $('booking-staff').value;
        if (!args.staffId) { toast('กรุณาเลือกบุคลากร', 'warn'); return; }
        args.token = S.admin.token;
        let res;
        try {
          res = await api('adminSaveBooking', args, { btn: btn });
        } catch (e) {
          if (e.code !== 'DUPLICATE') throw e;
          const ok = await ask({ title: 'พบการจองซ้ำ', text: e.message + '\n\nต้องการบันทึกต่อหรือไม่?', okText: 'บันทึกต่อ', danger: true });
          if (!ok) return;
          args.force = true;
          res = await api('adminSaveBooking', args, { btn: btn });
        }
        $('dlg-booking').close();
        toast(res.message, 'ok');
        await loadAdminMonth();
      }
    } catch (e) { toast(e.message, e.code === 'DUPLICATE' || e.code === 'RULE' || e.code === 'CLOSED' ? 'warn' : 'err'); }
  }

  /* ---------------- summary ---------------- */
  let SUM_MODE = 'month';
  let SUM_DATA = null;
  async function openSummary(mode) {
    SUM_MODE = mode || 'month';
    document.querySelectorAll('#summary-seg button').forEach((b) => b.classList.toggle('btn-active', b.dataset.mode === SUM_MODE));
    try {
      SUM_DATA = SUM_MODE === 'month' ? { bookings: S.my.bookings, leaves: S.my.leaves } : await api('getMyBookings', { token: S.token, upcoming: true });
    } catch (e) { toast(e.message, 'err'); return; }
    $('summary-content').innerHTML = summaryHtml(SUM_DATA, false);
    openDialog('dlg-summary');
  }

  function summaryHtml(data, forPrint) {
    const bookings = data.bookings;
    const days = {};
    let slots = 0;
    bookings.forEach((b) => { days[b.date] = 1; slots += b.slots.length; });
    const title = SUM_MODE === 'month' ? 'เดือน' + monthLabel(S.month) : 'ตั้งแต่ ' + fmtDate(S.info.today) + ' เป็นต้นไป';
    const nDays = Object.keys(days).length;
    if (forPrint) {
      let h = '<h1>สรุปเวรที่จอง — ' + esc(S.user.firstName + ' ' + S.user.lastName) + '</h1><p class="sub">' + esc(S.user.position) + ' · ' + esc(title) + '</p>';
      h += '<div class="sum-row"><b>' + nDays + ' วัน</b><b>' + slots + ' ช่วงเวร</b><b>' + data.leaves.length + ' ลา/ยกเลิก</b></div>';
      h += '<table><thead><tr><th>วันที่</th><th>ห้อง</th><th>จุดปฏิบัติงาน</th><th>ช่วงเวลา</th></tr></thead><tbody>';
      if (!bookings.length) h += '<tr><td colspan="4">ไม่มีเวรที่จอง</td></tr>';
      bookings.forEach((b) => { const hol = holidayOf(b.date); h += '<tr><td>' + esc(fmtDate(b.date, true)) + (hol ? '<br>' + esc(hol.name) : '') + '</td><td>' + esc(b.room) + '</td><td>' + esc(b.station) + '</td><td>' + esc(b.slots.join(', ')) + '</td></tr>'; });
      h += '</tbody></table>';
      if (data.leaves.length) {
        h += '<h1 style="font-size:12pt;margin-top:10pt">ลาเวร / ยกเลิก</h1><table><thead><tr><th>วันที่</th><th>ประเภท</th><th>ห้อง / ช่วงเวลา</th><th>เหตุผล</th></tr></thead><tbody>';
        data.leaves.forEach((b) => { h += '<tr><td>' + esc(fmtDate(b.date)) + '</td><td>' + esc(b.type) + '</td><td>' + esc(ROOM_SHORT(b.room)) + ' ' + esc(b.slots.join(', ')) + '</td><td>' + esc(b.reason || '-') + '</td></tr>'; });
        h += '</tbody></table>';
      }
      return h;
    }
    let html = '<p class="text-sm opacity-70 flex items-center gap-1">' + ic('calendar-range', 'w-4 h-4 text-primary') + esc(title) + '</p>';
    html += '<div class="grid grid-cols-3 gap-2 my-3" id="sum-stats">' +
      '<div class="rounded-box bg-primary/10 p-3 text-center"><div class="flex justify-center text-primary">' + ic('calendar-check', 'w-5 h-5') + '</div><div class="text-2xl font-bold" data-stat="days">' + nDays + '</div><div class="text-xs opacity-70">วัน</div></div>' +
      '<div class="rounded-box bg-success/10 p-3 text-center"><div class="flex justify-center text-success">' + ic('clock', 'w-5 h-5') + '</div><div class="text-2xl font-bold" data-stat="slots">' + slots + '</div><div class="text-xs opacity-70">ช่วงเวร</div></div>' +
      '<div class="rounded-box bg-warning/10 p-3 text-center"><div class="flex justify-center text-warning">' + ic('calendar-x', 'w-5 h-5') + '</div><div class="text-2xl font-bold" data-stat="leaves">' + data.leaves.length + '</div><div class="text-xs opacity-70">ลา/ยกเลิก</div></div></div>';
    html += '<ul class="grid gap-2">';
    if (!bookings.length) html += '<li class="text-center opacity-70 py-6">ไม่มีเวรที่จอง</li>';
    bookings.forEach((b, i) => {
      const hol = holidayOf(b.date);
      const p = parts(b.date);
      html += '<li class="flex items-start gap-3 rounded-box border border-base-300 p-3 motion-fade-up" style="--i:' + Math.min(i, 10) + '">' +
        '<div class="flex flex-col items-center justify-center rounded-box bg-primary/10 text-primary w-14 py-1 shrink-0"><span class="text-xs">' + DOW_SHORT[dow(b.date)] + '</span><span class="text-xl font-bold leading-none">' + p.d + '</span><span class="text-[10px]">' + MONTHS[p.m - 1].slice(0, 3) + '</span></div>' +
        '<div class="flex-1 min-w-0"><div class="font-semibold">' + esc(b.room) + '</div><div class="text-sm opacity-70">' + esc(b.station) + (hol ? ' · <span class="text-holiday">' + esc(hol.name) + '</span>' : '') + '</div><div class="flex flex-wrap gap-1 mt-1">' + slotBadges(b.slots, 'badge-sm') + '</div></div></li>';
    });
    html += '</ul>';
    if (data.leaves.length) {
      html += '<h4 class="font-bold mt-4 mb-2 flex items-center gap-2">' + ic('history', 'w-4 h-4 text-warning') + 'ลาเวร / ยกเลิก</h4><ul class="grid gap-1 text-sm">';
      data.leaves.forEach((b) => { html += '<li class="flex flex-wrap gap-2"><span class="font-semibold">' + esc(fmtDate(b.date)) + '</span><span class="badge badge-sm ' + (b.type === 'ลาเวร' ? 'badge-warning' : 'badge-ghost') + '">' + esc(b.type) + '</span><span class="opacity-80">' + esc(ROOM_SHORT(b.room)) + ' ' + esc(b.slots.join(', ')) + (b.reason ? ' — ' + esc(b.reason) : '') + '</span></li>'; });
      html += '</ul>';
    }
    return html;
  }

  /* ---------------- เพิ่มลงปฏิทินมือถือ (.ics) ---------------- */
  const SLOT_TIME = {
    '06:00-08:30': ['0600', '0830'], '08:30-12:30': ['0830', '1230'], '12:30-16:30': ['1230', '1630'], '16:30-สิ้นสุด': ['1630', '2030'],
    '06:00-11:00': ['0600', '1100'], '06:00-12:00': ['0600', '1200'], '06:00-16:00': ['0600', '1600'], '06:00-สิ้นสุด': ['0600', '2030']
  };
  function icsTime(date, hhmm) {
    const p = parts(date);
    const t = new Date(Date.UTC(p.y, p.m - 1, p.d, +hhmm.slice(0, 2) - 7, +hhmm.slice(2)));
    return t.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  function exportIcs() {
    const list = (SUM_DATA && SUM_DATA.bookings) || [];
    if (!list.length) { toast('ไม่มีเวรให้เพิ่มลงปฏิทิน', 'warn'); return; }
    const icsEsc = (v) => String(v).replace(/([,;\\])/g, '\\$1');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BRSbooking//TH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:เวรเจาะเลือด'];
    const stamp = icsTime(S.info.today, '0700');
    list.forEach((b) => {
      const times = b.slots.map((x) => SLOT_TIME[x]).filter(Boolean);
      if (!times.length) return;
      const start = times.map((t) => t[0]).sort()[0], end = times.map((t) => t[1]).sort().slice(-1)[0];
      lines.push('BEGIN:VEVENT', 'UID:' + b.id + '@brsbooking', 'DTSTAMP:' + stamp, 'DTSTART:' + icsTime(b.date, start), 'DTEND:' + icsTime(b.date, end),
        'SUMMARY:' + icsEsc('เวร ' + ROOM_SHORT(b.room) + ' ' + b.slots.join(', ')), 'LOCATION:' + icsEsc(b.room + ' - ' + b.station),
        'DESCRIPTION:' + icsEsc('ช่วงเวลา ' + b.slots.join(', ') + ' (สิ้นสุดเวลาโดยประมาณ)'), 'BEGIN:VALARM', 'TRIGGER:-PT12H', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc('พรุ่งนี้มีเวร ' + ROOM_SHORT(b.room)), 'END:VALARM', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'BRS-my-shifts.ics';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('ดาวน์โหลดไฟล์ปฏิทินแล้ว (' + list.length + ' เวร) — เปิดไฟล์เพื่อเพิ่มลงปฏิทินในมือถือ', 'ok');
  }

  function printHtml(html) {
    $('print-area').innerHTML = html + '<p class="foot">พิมพ์เมื่อ ' + esc(new Date().toLocaleString('th-TH')) + ' · ' + esc(S.info.title) + '</p>';
    window.print();
  }

  async function changePin(ev) {
    ev.preventDefault();
    const o = $('pin-old').value.trim(), n = $('pin-new').value.trim(), n2 = $('pin-new2').value.trim();
    if (!/^\d{4,6}$/.test(n)) { toast('PIN ใหม่ต้องเป็นตัวเลข 4–6 หลัก', 'warn'); return; }
    if (n !== n2) { toast('PIN ใหม่ทั้งสองช่องไม่ตรงกัน', 'warn'); return; }
    if (n === defaultPin()) { toast('ห้ามใช้ PIN เริ่มต้น ' + defaultPin() + ' กรุณาตั้ง PIN ใหม่', 'warn'); return; }
    try {
      const r = await api('changePin', { token: S.token, oldPin: o, newPin: n }, { btn: $('pin-form').querySelector('[type=submit]') });
      S.token = r.token; store('brs_session', { token: r.token, user: S.user });
      const d = $('dlg-pin');
      delete d.dataset.locked;
      $('pin-force-note').hidden = true; $('pin-cancel').hidden = false; $('pin-old-wrap').hidden = false;
      d.close();
      toast('เปลี่ยน PIN เรียบร้อย', 'ok');
    } catch (e) { toast(e.message, e.code === 'WEAK_PIN' ? 'warn' : 'err'); }
  }

  async function submitRequest(ev) {
    ev.preventDefault();
    const pin = $('req-pin').value.trim();
    if (!/^\d{4,6}$/.test(pin)) { toast('PIN ต้องเป็นตัวเลข 4–6 หลัก', 'warn'); return; }
    if (pin !== $('req-pin2').value.trim()) { toast('PIN ทั้งสองช่องไม่ตรงกัน', 'warn'); return; }
    try {
      await api('requestAccount', { firstName: $('req-first').value, lastName: $('req-last').value, position: $('req-position').value, pin: pin }, { btn: $('request-form').querySelector('[type=submit]') });
      $('dlg-request').close();
      $('request-form').reset();
      toast('ส่งคำขอเรียบร้อย กรุณารอผู้ดูแลอนุมัติ แล้วเข้าสู่ระบบด้วย PIN ที่ตั้งไว้', 'ok');
    } catch (e) { toast(e.message, e.code === 'WEAK_PIN' || e.code === 'DUPLICATE' ? 'warn' : 'err'); }
  }

  /* ---------------- admin ---------------- */
  async function adminLoginSubmit(ev) {
    ev.preventDefault();
    try {
      const r = await api('adminLogin', { username: $('adm-user').value.trim(), password: $('adm-pass').value }, { btn: $('admin-login-form').querySelector('[type=submit]') });
      S.admin.token = r.token;
      store('brs_admin', { token: r.token });
      $('adm-pass').value = '';
      setLoginMode('staff');
      await enterAdmin();
      toast('เข้าสู่ระบบผู้ดูแลแล้ว', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function adminLogout() {
    const t = S.admin.token;
    S.admin.token = null; store('brs_admin', null);
    showView('login');
    toast('ออกจากระบบผู้ดูแลแล้ว', 'info');
    if (t) api('logout', { token: t }, { silent: true }).catch(() => {});
  }

  async function enterAdmin() {
    await loadAdminMonth(true);
    showView('admin');
    switchTab(S.admin.tab);
  }

  async function loadAdminMonth(noRender) {
    const q = S.admin.range ? { token: S.admin.token, from: S.admin.range.from, to: S.admin.range.to } : { token: S.admin.token, month: S.admin.month };
    const d = await api('adminGetMonth', q);
    S.admin.data = d;
    S.admin.staff = d.staff;
    S.admin.holidays = d.holidays.map((h) => ({ date: h.date, name: h.name }));
    S.admin.settings = d.settings;
    S.info.holidays = d.holidays;
    S.info.settings = d.settings;
    S.admin.conflicts = findConflicts(d.bookings);
    renderNotice();
    if (!noRender) renderAdmin();
  }

  /** หาการจองซ้ำซ้อน: คนเดียวกัน วันเดียวกัน ช่วงเวลาทับกัน หรือวันเสาร์-อาทิตย์/วันหยุดเกิน 1 เวร */
  function findConflicts(list) {
    const by = {};
    list.forEach((b) => { const k = fullName(b) + '|' + b.date; (by[k] = by[k] || []).push(b); });
    const ids = {};
    Object.keys(by).forEach((k) => {
      const g = by[k];
      if (g.length < 2) return;
      if (isSpecial(g[0].date)) { g.forEach((b) => { ids[b.id] = 1; }); return; }
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const a = g[i].slots.map((s) => SLOT_COL[s]);
        if (g[j].slots.some((s) => a.indexOf(SLOT_COL[s]) >= 0)) { ids[g[i].id] = 1; ids[g[j].id] = 1; }
      }
    });
    return ids;
  }

  function switchTab(tab) {
    S.admin.tab = tab;
    document.querySelectorAll('#admin-tabs [data-tab]').forEach((b) => b.classList.toggle('tab-active', b.dataset.tab === tab));
    document.querySelectorAll('#side-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    setPage(tab);
    document.querySelectorAll('.admin-pane').forEach((p) => {
      p.hidden = p.dataset.pane !== tab;
      if (!p.hidden) { p.classList.remove('motion-fade-up'); void p.offsetWidth; p.classList.add('motion-fade-up'); }
    });
    renderAdmin();
  }

  function renderAdmin() {
    const pending = S.admin.staff.filter((s) => s.status === 'pending').length;
    $('pending-badge').hidden = !pending;
    $('pending-badge').textContent = pending;
    if (S.admin.tab === 'roster') renderRoster();
    if (S.admin.tab === 'staff') renderStaff();
    if (S.admin.tab === 'holidays') renderHolidays();
    if (S.admin.tab === 'settings') renderSettings();
  }

  function filteredBookings() {
    const room = $('f-room').value, st = $('f-station').value, pos = $('f-position').value, date = $('f-date').value;
    const q = $('f-name').value.trim().toLowerCase();
    const onlyConflict = $('f-conflict').checked;
    const slot = $('f-slot').value;
    const cf = S.admin.conflicts || {};
    return S.admin.data.bookings.filter((b) =>
      (!room || b.room === room) && (!st || b.station === st) && (!pos || b.position === pos) && (!date || b.date === date) &&
      (!q || fullName(b).toLowerCase().indexOf(q) >= 0) && (!onlyConflict || cf[b.id]) &&
      (slot === '' || b.slots.some((x) => String(SLOT_COL[x]) === slot)));
  }

  function rosterSort(list) {
    const roomIdx = (r) => { const i = S.info.rooms.findIndex((x) => x.name === r); return i < 0 ? 99 : i; };
    return list.slice().sort((a, b) => a.date.localeCompare(b.date) || roomIdx(a.room) - roomIdx(b.room) || a.station.localeCompare(b.station, 'th') ||
      (SLOT_COL[a.slots[0]] - SLOT_COL[b.slots[0]]) || fullName(a).localeCompare(fullName(b), 'th'));
  }

  function stat(icon, color, label, value) {
    return '<span class="badge badge-lg badge-soft ' + color + ' gap-2 py-4">' + ic(icon, 'w-4 h-4') + esc(label) + ' <b>' + value + '</b></span>';
  }

  function rangeLabel() {
    const d = S.admin.data;
    return S.admin.range ? fmtDate(d.from) + ' – ' + fmtDate(d.to) : 'เดือน' + monthLabel(S.admin.month);
  }
  function rangeDates() {
    const out = []; const d = S.admin.data;
    let t = Date.UTC(+d.from.slice(0, 4), +d.from.slice(5, 7) - 1, +d.from.slice(8));
    const end = Date.UTC(+d.to.slice(0, 4), +d.to.slice(5, 7) - 1, +d.to.slice(8));
    for (; t <= end; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  }
  /** บุคลากรที่ยังไม่มีการจองในช่วงที่เลือก (ใช้ตัวกรองตำแหน่ง/ชื่อ) */
  function missingStaff() {
    const pos = $('f-position').value, q = $('f-name').value.trim().toLowerCase();
    const booked = {};
    S.admin.data.bookings.forEach((b) => { booked[fullName(b)] = 1; });
    return S.admin.staff.filter((s) => s.status === 'active' && !booked[s.firstName + ' ' + s.lastName] && (!pos || s.position === pos) && (!q || (s.firstName + ' ' + s.lastName).toLowerCase().indexOf(q) >= 0))
      .sort((a, b) => (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName, 'th'));
  }
  const STATION_SHORT = (st) => st.indexOf('ลงทะเบียน') >= 0 ? 'ลทบ.' : st.indexOf('อื่นๆ') >= 0 ? 'อื่นๆ' : '';
  const COL_NAME = ['เช้า', 'สาย', 'บ่าย', 'เย็น', 'ดึก/ทั้งวัน'];
  /** ข้อมูลตาราง: แถว = วันที่, คอลัมน์ = ห้อง × ช่วงเวลา (เฉพาะคอลัมน์ที่มีคนจอง) */
  function gridModel(list) {
    const cols = [];
    S.info.rooms.forEach((r) => { for (let c = 0; c < 5; c++) if (list.some((b) => b.room === r.name && b.slots.some((x) => SLOT_COL[x] === c))) cols.push({ room: r.name, col: c }); });
    const cell = {};
    list.forEach((b) => b.slots.forEach((x) => {
      const k = b.date + '|' + b.room + '|' + SLOT_COL[x];
      (cell[k] = cell[k] || []).push(b.firstName + (STATION_SHORT(b.station) ? ' (' + STATION_SHORT(b.station) + ')' : ''));
    }));
    return { cols: cols, cell: cell, dates: rangeDates() };
  }
  function renderGrid(list) {
    const g = gridModel(list);
    let h = '<thead><tr><th class="bg-base-200">วันที่</th>' + g.cols.map((c) => '<td class="bg-base-200 font-semibold text-center">' + esc(ROOM_SHORT(c.room)) + '<div class="text-xs font-normal opacity-70">' + COL_NAME[c.col] + '</div></td>').join('') + '</tr></thead><tbody>';
    if (!g.cols.length) h += '<tr><td class="text-center opacity-70 py-8">ไม่มีรายการตามตัวกรอง</td></tr>';
    else g.dates.forEach((d) => {
      const hol = holidayOf(d);
      h += '<tr class="' + (hol ? 'hol' : isWeekend(d) ? 'wk' : '') + '"><th class="font-semibold">' + esc(fmtShort(d)) + (hol ? '<div class="text-xs text-holiday font-normal">' + esc(hol.name) + '</div>' : '') + '</th>' +
        g.cols.map((c) => { const n = g.cell[d + '|' + c.room + '|' + c.col] || []; return '<td class="names">' + (n.length ? '<span class="cnt">' + n.length + '</span> ' + n.map(esc).join(', ') : '<span class="opacity-30">-</span>') + '</td>'; }).join('') + '</tr>';
    });
    $('adm-grid').innerHTML = h + '</tbody>';
  }
  function renderMissing() {
    const miss = missingStaff();
    let h = '<div role="alert" class="alert alert-soft alert-warning mb-3">' + ic('user-x', 'w-5 h-5') + '<span>บุคลากรที่ยังไม่มีการจองใน' + esc(rangeLabel()) + ' <b>' + miss.length + ' คน</b> (จากผู้ใช้งาน ' + S.admin.staff.filter((s) => s.status === 'active').length + ' คน)</span></div>';
    h += '<div class="overflow-x-auto rounded-box border border-base-300"><table class="table table-sm min-w-[520px]" id="missing-table"><thead><tr><th>#</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>PIN</th></tr></thead><tbody>';
    if (!miss.length) h += '<tr><td colspan="4" class="text-center opacity-70 py-6">ทุกคนจองแล้ว</td></tr>';
    miss.forEach((s, i) => { h += '<tr class="hover"><td>' + (i + 1) + '</td><td class="font-semibold whitespace-nowrap">' + esc(s.firstName + ' ' + s.lastName) + '</td><td>' + esc(POS_SHORT[s.position] || s.position) + '</td><td>' + (s.hasPin ? '<span class="badge badge-success badge-soft badge-sm">ใช้งานแล้ว</span>' : '<span class="badge badge-ghost badge-sm">ยังไม่เคยเข้าระบบ</span>') + '</td></tr>'; });
    $('pane-missing').innerHTML = h + '</tbody></table></div>';
  }
  function setRosterView(v) {
    S.admin.view = v;
    document.querySelectorAll('#roster-views [data-view]').forEach((b) => b.classList.toggle('btn-active', b.dataset.view === v));
    renderRoster();
  }

  function renderRoster() {
    const nf = ['f-room', 'f-station', 'f-position', 'f-date', 'f-name', 'f-slot'].filter((id) => $(id).value.trim()).length + ($('f-conflict').checked ? 1 : 0) + (S.admin.range ? 1 : 0);
    $('filter-count').hidden = !nf; $('filter-count').textContent = nf;
    $('adm-title').textContent = S.admin.range ? rangeLabel() : monthLabel(S.admin.month);
    const view = S.admin.view || 'list';
    $('pane-list').hidden = view !== 'list'; $('pane-grid').hidden = view !== 'grid'; $('pane-missing').hidden = view !== 'missing';
    if (view === 'grid') renderGrid(rosterSort(filteredBookings()));
    if (view === 'missing') renderMissing();
    const list = rosterSort(filteredBookings());
    const cf = S.admin.conflicts || {};
    const people = {}; let slots = 0; const byRoom = {};
    list.forEach((b) => { people[fullName(b)] = 1; slots += b.slots.length; byRoom[ROOM_SHORT(b.room)] = (byRoom[ROOM_SHORT(b.room)] || 0) + 1; });
    const nConf = Object.keys(cf).length;
    $('adm-stats').innerHTML = stat('clipboard-list', 'badge-primary', 'รายการ', list.length) + stat('clock', 'badge-info', 'ช่วงเวร', slots) + stat('users', 'badge-success', 'บุคลากร', Object.keys(people).length + ' คน') +
      Object.keys(byRoom).map((r) => stat('building-2', 'badge-neutral', r, byRoom[r])).join('') + (nConf ? stat('triangle-alert', 'badge-error', 'ซ้ำซ้อน', nConf) : '') +
      stat('user-x', 'badge-warning', 'ยังไม่จอง', missingStaff().length + ' คน');
    const emptyMsg = 'ไม่มีรายการจองในเดือนนี้' + (list.length !== S.admin.data.bookings.length ? 'ตามตัวกรอง' : '');
    const btns = (b) => '<button class="btn btn-ghost btn-sm btn-square" title="แก้ไข" aria-label="แก้ไข" data-aedit="' + esc(b.id) + '">' + ic('pencil', 'w-4 h-4 text-info') + '</button><button class="btn btn-ghost btn-sm btn-square" title="ลบ/ลา" aria-label="ลบ/ลา" data-adel="' + esc(b.id) + '">' + ic('trash-2', 'w-4 h-4 text-error') + '</button>';
    let html = '<thead><tr><th>วันที่</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>ห้อง</th><th>จุดปฏิบัติงาน</th><th>ช่วงเวลา</th><th></th></tr></thead><tbody>';
    if (!list.length) html += '<tr><td colspan="7" class="text-center opacity-70 py-8">' + emptyMsg + '</td></tr>';
    let last = '';
    list.forEach((b) => {
      const first = b.date !== last; last = b.date;
      const hol = holidayOf(b.date);
      html += '<tr class="hover' + (first ? ' group-start' : '') + (cf[b.id] ? ' bg-error/5' : '') + '"><td class="whitespace-nowrap font-semibold">' + (first ? esc(fmtShort(b.date)) + (hol ? '<div class="text-xs text-holiday font-normal">' + esc(hol.name) + '</div>' : '') : '') + '</td>' +
        '<td class="whitespace-nowrap">' + esc(fullName(b)) + (cf[b.id] ? ' <span class="badge badge-error badge-sm gap-1">' + ic('triangle-alert', 'w-3 h-3') + 'ซ้ำ</span>' : '') + '</td><td class="whitespace-nowrap">' + esc(POS_SHORT[b.position] || b.position) + '</td><td>' + esc(ROOM_SHORT(b.room)) + '</td><td>' + esc(b.station) + '</td>' +
        '<td><div class="flex flex-wrap gap-1">' + slotBadges(b.slots, 'badge-sm') + '</div></td><td class="text-right whitespace-nowrap">' + btns(b) + '</td></tr>';
    });
    $('adm-table').innerHTML = html + '</tbody>';
    // การ์ดสำหรับมือถือ
    let cards = '';
    if (!list.length) cards = '<div class="text-center opacity-70 py-8">' + emptyMsg + '</div>';
    last = '';
    list.forEach((b) => {
      if (b.date !== last) {
        last = b.date; const hol = holidayOf(b.date);
        cards += '<div class="font-bold mt-2 flex flex-wrap items-center gap-2">' + ic('calendar-days', 'w-4 h-4 text-primary') + esc(fmtDate(b.date, true)) + (hol ? '<span class="badge badge-sm badge-holiday">' + esc(hol.name) + '</span>' : '') + '</div>';
      }
      cards += '<div class="rounded-box border ' + (cf[b.id] ? 'border-error bg-error/5' : 'border-base-300') + ' p-3"><div class="flex items-start gap-1"><div class="flex-1 min-w-0"><div class="font-semibold">' + esc(fullName(b)) + (cf[b.id] ? ' <span class="badge badge-error badge-sm">ซ้ำ</span>' : '') + '</div><div class="text-xs opacity-70">' + esc(POS_SHORT[b.position] || b.position) + ' · ' + esc(ROOM_SHORT(b.room)) + ' · ' + esc(b.station) + '</div></div>' +
        btns(b) + '</div><div class="flex flex-wrap gap-1 mt-2">' + slotBadges(b.slots, 'badge-sm') + '</div></div>';
    });
    $('adm-cards').innerHTML = cards;
    document.querySelectorAll('#adm-table [data-aedit], #adm-cards [data-aedit]').forEach((el) => { el.onclick = () => { const b = S.admin.data.bookings.find((x) => x.id === el.dataset.aedit); openBooking({ mode: 'admin', date: b.date, booking: b }); }; });
    document.querySelectorAll('#adm-table [data-adel], #adm-cards [data-adel]').forEach((el) => { el.onclick = () => adminDelete(S.admin.data.bookings.find((x) => x.id === el.dataset.adel)); });

    const lv = S.admin.data.leaves;
    let lh = '<thead><tr><th>วันที่</th><th>ชื่อ-นามสกุล</th><th>ห้อง / จุด</th><th>ช่วงเวลา</th><th>ประเภท</th><th>เหตุผล</th><th>โดย / เมื่อ</th></tr></thead><tbody>';
    if (!lv.length) lh += '<tr><td colspan="7" class="text-center opacity-70 py-6">ไม่มีรายการ</td></tr>';
    lv.forEach((b) => {
      lh += '<tr><td class="whitespace-nowrap font-semibold">' + esc(fmtShort(b.date)) + '</td><td class="whitespace-nowrap">' + esc(fullName(b)) + '</td><td>' + esc(ROOM_SHORT(b.room)) + ' · ' + esc(b.station) + '</td><td>' + esc(b.slots.join(', ')) + '</td>' +
        '<td><span class="badge badge-sm ' + (b.type === 'ลาเวร' ? 'badge-warning' : b.type === 'ลบโดยผู้ดูแล' ? 'badge-error badge-soft' : 'badge-ghost') + '">' + esc(b.type || '-') + '</span></td><td>' + esc(b.reason || '-') + '</td><td class="text-xs">' + esc(b.by || '-') + '<br>' + esc(b.timestamp) + '</td></tr>';
    });
    $('adm-leave-table').innerHTML = lh + '</tbody>';
  }

  async function adminDelete(b) {
    const r = await ask({
      title: 'นำรายการนี้ออกจากตารางเวร',
      text: fullName(b) + '\n' + fmtDate(b.date, true) + '\n' + b.room + ' — ' + b.station + '\n' + b.slots.join(', '),
      choices: [{ value: 'ลบโดยผู้ดูแล', label: 'ลบรายการ (ผู้ดูแลลบ)', icon: 'trash-2', iconClass: 'text-error' }, { value: 'ลาเวร', label: 'บันทึกเป็นการลาเวร', icon: 'calendar-x', iconClass: 'text-warning' }],
      input: { label: 'เหตุผล (ไม่บังคับ)' },
      okText: 'ยืนยัน', danger: true
    });
    if (!r) return;
    try {
      const res = await api('adminDeleteBooking', { token: S.admin.token, id: b.id, type: r.choice, reason: r.value });
      toast(res.message, 'ok');
      await loadAdminMonth();
    } catch (e) { toast(e.message, 'err'); }
  }

  function renderStaff() {
    const q = $('staff-filter').value.trim().toLowerCase();
    const all = S.admin.staff.slice().sort((a, b) => (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName, 'th'));
    const pend = all.filter((s) => s.status === 'pending');
    $('pending-card').hidden = !pend.length;
    $('pending-table').innerHTML = '<thead><tr><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>ขอเมื่อ</th><th></th></tr></thead><tbody>' +
      pend.map((s) => '<tr><td class="font-semibold">' + esc(s.firstName + ' ' + s.lastName) + '</td><td>' + esc(s.position) + '</td><td class="text-xs">' + esc(s.createdAt) + '</td>' +
        '<td class="text-right whitespace-nowrap"><button class="btn btn-success btn-sm" data-approve="' + esc(s.id) + '">' + ic('user-check', 'w-4 h-4') + 'อนุมัติ</button> <button class="btn btn-ghost btn-sm" data-reject="' + esc(s.id) + '">' + ic('user-x', 'w-4 h-4 text-error') + 'ไม่อนุมัติ</button></td></tr>').join('') + '</tbody>';
    const list = all.filter((s) => !q || (s.firstName + ' ' + s.lastName).toLowerCase().indexOf(q) >= 0);
    $('staff-count').textContent = all.length + ' คน';
    let html = '<thead><tr><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>สถานะ</th><th>PIN</th><th></th></tr></thead><tbody>';
    if (!list.length) html += '<tr><td colspan="5" class="text-center opacity-70 py-6">ไม่พบรายชื่อ</td></tr>';
    list.forEach((s) => {
      const st = STATUS[s.status] || [s.status, 'badge-ghost'];
      const pin = !s.hasPin || s.mustChange ? '<span class="badge badge-warning badge-soft badge-sm">PIN เริ่มต้น</span>' : '<span class="badge badge-success badge-soft badge-sm gap-1">' + ic('check', 'w-3 h-3') + 'ตั้งแล้ว</span>';
      html += '<tr class="hover"><td class="whitespace-nowrap font-semibold">' + esc(s.firstName + ' ' + s.lastName) + '</td><td class="whitespace-nowrap">' + esc(POS_SHORT[s.position] || s.position) + '</td>' +
        '<td><span class="badge badge-sm badge-soft ' + st[1] + '">' + esc(st[0]) + '</span></td><td class="pin-cell">' + pin + '</td>' +
        '<td class="text-right whitespace-nowrap"><button class="btn btn-ghost btn-sm" data-sedit="' + esc(s.id) + '">' + ic('pencil', 'w-4 h-4 text-info') + 'แก้ไข</button> <button class="btn btn-ghost btn-sm" data-sreset="' + esc(s.id) + '">' + ic('rotate-ccw', 'w-4 h-4 text-warning') + 'รีเซ็ต PIN</button></td></tr>';
    });
    $('staff-table').innerHTML = html + '</tbody>';
    const byId = (id) => S.admin.staff.find((s) => s.id === id);
    document.querySelectorAll('[data-approve]').forEach((el) => { el.onclick = () => saveStaffStatus(byId(el.dataset.approve), 'active', el); });
    document.querySelectorAll('[data-reject]').forEach((el) => { el.onclick = () => saveStaffStatus(byId(el.dataset.reject), 'inactive', el); });
    document.querySelectorAll('[data-sedit]').forEach((el) => { el.onclick = () => openStaff(byId(el.dataset.sedit)); });
    document.querySelectorAll('[data-sreset]').forEach((el) => { el.onclick = () => resetPin(byId(el.dataset.sreset)); });
  }

  async function reloadStaff() {
    S.admin.staff = await api('adminListStaff', { token: S.admin.token });
    renderAdmin();
  }

  async function saveStaffStatus(s, status, btn) {
    try {
      await api('adminSaveStaff', { token: S.admin.token, id: s.id, firstName: s.firstName, lastName: s.lastName, position: s.position, status: status }, { btn: btn });
      toast(status === 'active' ? 'อนุมัติแล้ว: ' + s.firstName + ' ' + s.lastName : 'บันทึกแล้ว', 'ok');
      await reloadStaff();
    } catch (e) { toast(e.message, 'err'); }
  }

  let EDIT_STAFF = null;
  function openStaff(s) {
    EDIT_STAFF = s || null;
    $('staff-title').textContent = s ? 'แก้ไขบุคลากร' : 'เพิ่มบุคลากร';
    $('st-first').value = s ? s.firstName : '';
    $('st-last').value = s ? s.lastName : '';
    $('st-position').value = s ? s.position : '';
    $('st-status').value = s ? s.status : 'active';
    $('st-note').hidden = !s;
    openDialog('dlg-staff');
  }

  async function submitStaff(ev) {
    ev.preventDefault();
    const args = { token: S.admin.token, firstName: $('st-first').value, lastName: $('st-last').value, position: $('st-position').value, status: $('st-status').value };
    if (EDIT_STAFF) args.id = EDIT_STAFF.id;
    try {
      const r = await api('adminSaveStaff', args, { btn: $('staff-form').querySelector('[type=submit]') });
      $('dlg-staff').close();
      toast(r.message + (r.renamed ? ' (ปรับรายการจอง ' + r.renamed + ' รายการ)' : ''), 'ok');
      if (r.renamed) await loadAdminMonth(); else await reloadStaff();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function resetPin(s) {
    const dp = S.admin.settings.defaultPin || '1234';
    const ok = await ask({ title: 'รีเซ็ต PIN', text: 'รีเซ็ต PIN ของ ' + s.firstName + ' ' + s.lastName + ' กลับเป็น PIN เริ่มต้น ' + dp + '?\nผู้ใช้เข้าสู่ระบบด้วย ' + dp + ' แล้วต้องตั้ง PIN ใหม่ก่อนใช้งาน', okText: 'รีเซ็ต', danger: true });
    if (!ok) return;
    try {
      const r = await api('adminResetPin', { token: S.admin.token, id: s.id });
      await reloadStaff();
      toast(r.message, 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  function holYears() {
    const ys = {};
    const now = Number(S.info.today.slice(0, 4));
    [now, now + 1].forEach((y) => { ys[y] = 1; });
    S.admin.holidays.forEach((h) => { if (h.date) ys[h.date.slice(0, 4)] = 1; });
    return Object.keys(ys).sort();
  }

  function renderHolidays() {
    const sel = $('hol-year');
    const cur = sel.value || S.info.today.slice(0, 4);
    sel.innerHTML = '<option value="all">ทุกปี</option>' + holYears().map((y) => '<option value="' + y + '">พ.ศ. ' + (Number(y) + 543) + '</option>').join('');
    sel.value = cur;
    const year = sel.value;
    let html = '<thead><tr><th class="w-48">วันที่</th><th>ชื่อวันหยุด</th><th class="w-28">วัน</th><th></th></tr></thead><tbody>';
    let shown = 0;
    S.admin.holidays.forEach((h, i) => {
      if (year !== 'all' && h.date && h.date.slice(0, 4) !== year) return;
      shown++;
      html += '<tr><td><input class="input input-sm w-full" type="date" data-hdate="' + i + '" value="' + esc(h.date) + '" aria-label="วันที่"></td>' +
        '<td><input class="input input-sm w-full" type="text" maxlength="120" data-hname="' + i + '" value="' + esc(h.name) + '" placeholder="ชื่อวันหยุด" aria-label="ชื่อวันหยุด"></td>' +
        '<td class="text-sm opacity-70">' + (h.date ? esc(DOW[dow(h.date)]) : '') + '</td>' +
        '<td class="text-right"><button class="btn btn-ghost btn-sm btn-square" aria-label="ลบวันหยุด" data-hdel="' + i + '">' + ic('trash-2', 'w-4 h-4 text-error') + '</button></td></tr>';
    });
    if (!shown) html += '<tr><td colspan="4" class="text-center opacity-70 py-6">ยังไม่มีวันหยุดในปีนี้</td></tr>';
    $('hol-table').innerHTML = html + '</tbody>';
    $('hol-table').querySelectorAll('[data-hdate]').forEach((el) => { el.onchange = () => { S.admin.holidays[el.dataset.hdate].date = el.value; renderHolidays(); }; });
    $('hol-table').querySelectorAll('[data-hname]').forEach((el) => { el.oninput = () => { S.admin.holidays[el.dataset.hname].name = el.value; }; });
    $('hol-table').querySelectorAll('[data-hdel]').forEach((el) => { el.onclick = () => { S.admin.holidays.splice(Number(el.dataset.hdel), 1); renderHolidays(); }; });
  }

  async function fetchHolidays() {
    const sel = $('hol-year').value;
    const year = sel === 'all' ? Number(S.info.today.slice(0, 4)) + 1 : Number(sel);
    try {
      const r = await api('adminFetchHolidays', { token: S.admin.token, year: year }, { btn: $('hol-fetch') });
      const have = {};
      S.admin.holidays.forEach((h) => { have[h.date] = 1; });
      const add = r.holidays.filter((h) => h.official && !have[h.date]);
      const skipped = r.holidays.filter((h) => !h.official).length;
      add.forEach((h) => S.admin.holidays.push({ date: h.date, name: h.name }));
      S.admin.holidays.sort((a, b) => (a.date || '0').localeCompare(b.date || '0'));
      $('hol-year').value = String(year);
      renderHolidays();
      toast('พบวันหยุด พ.ศ. ' + (year + 543) + ' เพิ่มใหม่ ' + add.length + ' วัน' + (skipped ? ' (ข้ามวันสำคัญที่ไม่ใช่วันหยุด ' + skipped + ' วัน)' : '') + ' — ตรวจแล้วกด "บันทึกวันหยุด"', add.length ? 'ok' : 'info');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function saveHolidays() {
    const list = S.admin.holidays;
    if (list.some((h) => !h.date)) { toast('มีแถวที่ยังไม่ได้เลือกวันที่', 'warn'); return; }
    try {
      const r = await api('adminSaveHolidays', { token: S.admin.token, holidays: list }, { btn: $('hol-save') });
      S.admin.holidays = r.holidays.map((h) => ({ date: h.date, name: h.name }));
      S.info.holidays = r.holidays;
      toast('บันทึกวันหยุด ' + r.count + ' วันเรียบร้อย', 'ok');
      renderHolidays();
    } catch (e) { toast(e.message, 'err'); }
  }

  function archiveDefault() { return shiftMonth(S.info.today.slice(0, 7), -1) + '-01'; }

  async function runArchive() {
    const before = $('archive-before').value;
    if (!before) { toast('กรุณาเลือกวันที่', 'warn'); return; }
    try {
      const c = await api('adminArchive', { token: S.admin.token, before: before, dryRun: true }, { btn: $('archive-run') });
      if (!c.bookings && !c.leaves) { toast('ไม่มีรายการก่อนวันที่ ' + fmtDate(before) + ' ให้ย้าย', 'info'); return; }
      const ok = await ask({ title: 'ย้ายข้อมูลเก่าไปเก็บ', text: 'ย้ายรายการก่อนวันที่ ' + fmtDate(before) + '\nการจอง ' + c.bookings + ' รายการ และลา/ยกเลิก ' + c.leaves + ' รายการ\nไปไว้ในแท็บ Archive ของ Google Sheet (ไม่ลบทิ้ง)', okText: 'ย้ายข้อมูล' });
      if (!ok) return;
      const r = await api('adminArchive', { token: S.admin.token, before: before }, { btn: $('archive-run') });
      toast('ย้ายไปเก็บแล้ว: การจอง ' + r.bookings + ' รายการ ลา/ยกเลิก ' + r.leaves + ' รายการ', 'ok');
      await loadAdminMonth();
    } catch (e) { toast(e.message, 'err'); }
  }

  function renderSettings() {
    if (!$('archive-before').value) $('archive-before').value = archiveDefault();
    $('archive-before').max = S.info.today;
    const st = S.admin.settings;
    $('set-open').checked = st.bookingOpen;
    $('set-holiday-rule').checked = st.holidayAsWeekend;
    $('set-close-at').value = st.closeAt || '';
    $('set-block-holiday').checked = st.blockHolidays;
    $('set-notice').value = st.notice;
    $('set-contact').value = st.contact;
    S.admin.months = st.bookingMonths.slice();
    renderMonthChips();
  }

  function renderMonthChips() {
    const box = $('set-months');
    box.innerHTML = S.admin.months.length
      ? S.admin.months.slice().sort().map((m) => '<span class="badge badge-primary badge-soft badge-lg gap-1">' + ic('calendar-days', 'w-3.5 h-3.5') + esc(monthLabel(m)) + '<button type="button" class="btn btn-ghost btn-xs btn-circle" data-mdel="' + esc(m) + '" aria-label="ลบเดือน">' + ic('x', 'w-3 h-3') + '</button></span>').join('')
      : '<span class="text-sm opacity-70">ทุกเดือน (ตั้งแต่วันนี้)</span>';
    box.querySelectorAll('[data-mdel]').forEach((el) => { el.onclick = () => { S.admin.months = S.admin.months.filter((m) => m !== el.dataset.mdel); renderMonthChips(); }; });
  }

  async function saveSettings() {
    try {
      const r = await api('adminSaveSettings', {
        token: S.admin.token,
        settings: {
          BOOKING_OPEN: $('set-open').checked, BOOKING_MONTHS: S.admin.months.join(','),
          NOTICE: $('set-notice').value, CONTACT: $('set-contact').value,
          SPECIAL_DAY_RULE: $('set-holiday-rule').checked, CLOSE_AT: $('set-close-at').value, BLOCK_HOLIDAYS: $('set-block-holiday').checked
        }
      }, { btn: $('set-save') });
      S.admin.settings = r.settings; S.info.settings = r.settings;
      S.admin.conflicts = findConflicts(S.admin.data.bookings);
      renderNotice(); renderSettings();
      toast('บันทึกการตั้งค่าแล้ว', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- export ---------------- */
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('โหลดตัวสร้างไฟล์ Excel ไม่สำเร็จ'));
      document.head.appendChild(s);
    });
  }

  async function exportExcel() {
    const btn = $('adm-excel');
    let X;
    btnBusy(btn, true);
    try { X = await loadXlsx(); } catch (e) { toast(e.message, 'err'); btnBusy(btn, false); return; }
    try {
      const list = rosterSort(filteredBookings());
      const wb = X.utils.book_new();
      const cols = ['เช้า', 'สาย', 'บ่าย', 'นอกเวลาเย็น', 'ดึก'];
      const rows1 = [['วันที่', 'วัน', 'วันหยุด', 'ชื่อ', 'นามสกุล', 'ตำแหน่ง', 'ห้อง', 'จุดปฏิบัติงาน'].concat(cols)];
      list.forEach((b) => {
        const c = ['', '', '', '', ''];
        b.slots.forEach((s) => { c[SLOT_COL[s]] = s; });
        const hol = holidayOf(b.date);
        rows1.push([fmtDate(b.date), DOW[dow(b.date)], hol ? hol.name : '', b.firstName, b.lastName, b.position, b.room, b.station].concat(c));
      });
      addSheet(X, wb, 'ตารางเวร', rows1, [16, 10, 18, 14, 16, 34, 30, 30, 12, 12, 12, 13, 13]);

      const groups = {};
      list.forEach((b) => b.slots.forEach((s) => {
        const k = b.date + '|' + b.room + '|' + b.station + '|' + s;
        (groups[k] = groups[k] || []).push(fullName(b));
      }));
      const rows2 = [['วันที่', 'ห้อง', 'จุดปฏิบัติงาน', 'ช่วงเวลา', 'จำนวนคน', 'รายชื่อ']];
      Object.keys(groups).sort((a, b) => {
        const pa = a.split('|'), pb = b.split('|');
        return pa[0].localeCompare(pb[0]) || pa[1].localeCompare(pb[1], 'th') || pa[2].localeCompare(pb[2], 'th') || SLOT_COL[pa[3]] - SLOT_COL[pb[3]];
      }).forEach((k) => { const p = k.split('|'); rows2.push([fmtDate(p[0]), p[1], p[2], p[3], groups[k].length, groups[k].join(', ')]); });
      addSheet(X, wb, 'สรุปรายวัน', rows2, [16, 30, 30, 14, 10, 80]);

      const per = {};
      list.forEach((b) => {
        const k = fullName(b);
        per[k] = per[k] || { position: b.position, days: {}, slots: 0 };
        per[k].days[b.date] = 1; per[k].slots += b.slots.length;
      });
      const rows3 = [['ชื่อ-นามสกุล', 'ตำแหน่ง', 'จำนวนวัน', 'จำนวนช่วงเวร', 'วันที่จอง']];
      Object.keys(per).sort((a, b) => a.localeCompare(b, 'th')).forEach((k) => {
        const d = Object.keys(per[k].days).sort();
        rows3.push([k, per[k].position, d.length, per[k].slots, d.map((x) => Number(x.slice(8))).join(', ')]);
      });
      addSheet(X, wb, 'สรุปรายบุคคล', rows3, [28, 40, 10, 12, 60]);

      const rows4 = [['วันที่', 'ชื่อ-นามสกุล', 'ตำแหน่ง', 'ห้อง', 'จุดปฏิบัติงาน', 'ช่วงเวลา', 'ประเภท', 'เหตุผล', 'ดำเนินการโดย', 'บันทึกเมื่อ']];
      S.admin.data.leaves.forEach((b) => rows4.push([fmtDate(b.date), fullName(b), b.position, b.room, b.station, b.slots.join(', '), b.type, b.reason, b.by, b.timestamp]));
      addSheet(X, wb, 'ลา-ยกเลิก', rows4, [16, 28, 34, 30, 30, 22, 14, 30, 18, 20]);

      const g = gridModel(list);
      const rows5 = [['วันที่', 'วัน', 'วันหยุด'].concat(g.cols.map((c) => ROOM_SHORT(c.room) + ' ' + COL_NAME[c.col]))];
      g.dates.forEach((d) => { const hol = holidayOf(d); rows5.push([fmtDate(d), DOW[dow(d)], hol ? hol.name : ''].concat(g.cols.map((c) => (g.cell[d + '|' + c.room + '|' + c.col] || []).join(', ')))); });
      addSheet(X, wb, 'ตารางเวร (ตาราง)', rows5, [16, 10, 18].concat(g.cols.map(() => 28)));

      const rows6 = [['ชื่อ', 'นามสกุล', 'ตำแหน่ง', 'สถานะการเข้าระบบ']];
      missingStaff().forEach((x) => rows6.push([x.firstName, x.lastName, x.position, x.hasPin ? 'ใช้งานแล้ว' : 'ยังไม่เคยเข้าระบบ']));
      addSheet(X, wb, 'ยังไม่จอง', rows6, [16, 18, 40, 18]);

      const data = X.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const [yy, mm] = S.admin.month.split('-');
      a.download = S.admin.range ? 'BRS-roster-' + S.admin.data.from + '_' + S.admin.data.to + '.xlsx' : 'BRS-roster-' + (Number(yy) + 543) + '-' + mm + '.xlsx'; // ชื่อไฟล์ภาษาอังกฤษ เพื่อให้ทุกเบราว์เซอร์ตั้งชื่อถูก
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('ดาวน์โหลดไฟล์ Excel แล้ว (' + list.length + ' รายการ)', 'ok');
    } catch (e) { toast('สร้างไฟล์ Excel ไม่สำเร็จ: ' + e.message, 'err'); } finally { btnBusy(btn, false); }
  }

  function addSheet(X, wb, name, rows, widths) {
    // ป้องกันสูตรแทรกเมื่อเปิดใน Excel: ข้อความที่ขึ้นต้นด้วย = + - @ ให้เป็นข้อความ
    rows = rows.map((r) => r.map((v) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v)));
    const ws = X.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map((w) => ({ wch: w }));
    if (rows.length > 1) ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
    X.utils.book_append_sheet(wb, ws, name);
  }

  function printRoster() {
    const list = rosterSort(filteredBookings());
    const groups = [];
    const idx = {};
    list.forEach((b) => b.slots.forEach((s) => {
      const k = b.date + '|' + b.room + '|' + b.station + '|' + s;
      if (!idx[k]) { idx[k] = { date: b.date, room: b.room, station: b.station, slot: s, names: [] }; groups.push(idx[k]); }
      idx[k].names.push(fullName(b) + ' (' + (POS_SHORT[b.position] || b.position) + ')');
    }));
    const roomIdx = (r) => S.info.rooms.findIndex((x) => x.name === r);
    groups.sort((a, b) => a.date.localeCompare(b.date) || roomIdx(a.room) - roomIdx(b.room) || a.station.localeCompare(b.station, 'th') || SLOT_COL[a.slot] - SLOT_COL[b.slot]);
    let html = '<h1>ตารางเวร ' + esc(S.info.title) + '</h1><p class="sub">' + esc(S.info.org) + ' · ' + esc(rangeLabel()) + ' · ' + list.length + ' รายการ</p>';
    html += '<table><thead><tr><th style="width:17%">วันที่</th><th style="width:16%">ห้อง</th><th style="width:17%">จุดปฏิบัติงาน</th><th style="width:11%">ช่วงเวลา</th><th>รายชื่อ</th></tr></thead><tbody>';
    if (!groups.length) html += '<tr><td colspan="5">ไม่มีรายการ</td></tr>';
    let last = '';
    groups.forEach((g) => {
      const hol = holidayOf(g.date);
      const first = g.date !== last; last = g.date;
      html += '<tr><td>' + (first ? '<b>' + esc(fmtDate(g.date, true)) + '</b>' + (hol ? '<br>' + esc(hol.name) : '') : '') + '</td><td>' + esc(g.room) + '</td><td>' + esc(g.station) + '</td><td>' + esc(g.slot) + '</td><td>' + esc(g.names.join(', ')) + '</td></tr>';
    });
    html += '</tbody></table>';
    printHtml(html);
  }

  /* ---------------- bindings ---------------- */
  function openPinDialog() { $('pin-form').reset(); $('pin-old-wrap').hidden = false; $('pin-force-note').hidden = true; $('pin-cancel').hidden = false; openDialog('dlg-pin'); }

  function bindSwipe(el, onLeft, onRight) {
    let x0 = null, y0 = null;
    el.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const t = e.changedTouches[0]; const dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? onLeft : onRight)();
    }, { passive: true });
  }

  function bindStatic() {
    document.querySelectorAll('[data-close]').forEach((b) => { b.addEventListener('click', () => b.closest('dialog').close()); });
    // dialog ที่ล็อกไว้ (บังคับเปลี่ยน PIN) ปิดด้วย Esc ไม่ได้
    $('dlg-pin').addEventListener('cancel', (e) => { if ($('dlg-pin').dataset.locked) e.preventDefault(); });
    $('staff-search').addEventListener('input', renderCombo);
    $('staff-search').addEventListener('keydown', (e) => {
      const items = Array.from($('staff-options').querySelectorAll('.combo-item'));
      if (!items.length) return;
      let i = items.findIndex((x) => x.classList.contains('menu-active'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (i >= 0) items[i].classList.remove('menu-active');
        i = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
        items[i].classList.add('menu-active'); items[i].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') { e.preventDefault(); pickStaff(items[Math.max(0, i)].dataset.id); }
    });
    $('staff-options').addEventListener('click', (e) => { const b = e.target.closest('.combo-item'); if (b) pickStaff(b.dataset.id); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#staff-combo')) $('staff-options').hidden = true; });
    $('btn-login').onclick = doLogin;
    $('login-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $('btn-open-request').onclick = () => openDialog('dlg-request');
    $('btn-open-admin').onclick = () => setLoginMode('admin');
    $('btn-open-guide').onclick = openGuide;
    $('btn-open-guide-hero').onclick = openGuide;
    $('btn-guide-m').onclick = openGuide;
    $('btn-admin-back').onclick = () => setLoginMode('staff');
    $('archive-run').onclick = runArchive;
    $('login-pin').addEventListener('input', () => { const el = $('login-pin'); const v = el.value.replace(/\D/g, '').slice(0, 6); if (v !== el.value) el.value = v; renderPinCells(); });
    $('request-form').addEventListener('submit', submitRequest);
    $('admin-login-form').addEventListener('submit', adminLoginSubmit);

    $('cal-prev').onclick = () => changeMonth(-1);
    $('cal-next').onclick = () => changeMonth(1);
    bindSwipe($('calendar'), () => changeMonth(1), () => changeMonth(-1));
    $('calendar').addEventListener('click', (e) => { const d = e.target.closest('.cal-day'); if (!d || !d.dataset.date) return; if (S.multi) togglePick(d.dataset.date); else selectDay(d.dataset.date); });
    $('multi-toggle').addEventListener('change', (e) => setMulti(e.target.checked));
    $('theme-btn').onclick = cycleTheme;
    $('btn-summary-m').onclick = () => openSummary('month');
    $('summary-ics').onclick = exportIcs;
    $('set-close-clear').onclick = () => { $('set-close-at').value = ''; };
    $('summary-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) openSummary(b.dataset.mode); });
    $('summary-print').onclick = () => printHtml(summaryHtml(SUM_DATA, true));
    const openPin = openPinDialog;
    $('pin-form').addEventListener('submit', changePin);
    $('dock-calendar').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    $('dock-summary').onclick = () => openSummary('month');
    $('dock-pin').onclick = openPin;
    $('dock-logout').onclick = logout;

    $('booking-room').addEventListener('change', () => { fillStations(''); });
    $('booking-date-input').addEventListener('change', () => renderSlots([]));
    $('booking-form').addEventListener('submit', submitBooking);

    $('admin-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab); });
    const admMonth = async (delta) => { S.admin.range = null; $('f-from').value = ''; $('f-to').value = ''; S.admin.month = shiftMonth(S.admin.month, delta); $('f-date').value = ''; try { await loadAdminMonth(); } catch (e) { toast(e.message, 'err'); } };
    $('adm-prev').onclick = () => admMonth(-1);
    $('adm-next').onclick = () => admMonth(1);
    ['f-room', 'f-station', 'f-position', 'f-date', 'f-conflict'].forEach((id) => $(id).addEventListener('change', renderRoster));
    $('f-name').addEventListener('input', renderRoster);
    // ตัวกรองผู้ดูแล: เปิดค้างบนจอกว้าง พับเก็บบนมือถือ (กดแถบ "ตัวกรอง" เพื่อเปิด)
    if (window.matchMedia && matchMedia('(min-width: 768px)').matches) $('adm-filters').open = true;
    $('adm-add').onclick = () => openBooking({ mode: 'admin', date: $('f-date').value || '' });
    $('adm-excel').onclick = exportExcel;
    $('adm-pdf').onclick = printRoster;
    $('staff-filter').addEventListener('input', renderStaff);
    $('staff-add').onclick = () => openStaff(null);
    $('staff-form').addEventListener('submit', submitStaff);
    $('hol-year').addEventListener('change', renderHolidays);
    $('hol-add').onclick = () => {
      const y = $('hol-year').value === 'all' ? S.info.today.slice(0, 4) : $('hol-year').value;
      S.admin.holidays.unshift({ date: '', name: '' });
      $('hol-year').value = y;
      renderHolidays();
      const first = $('hol-table').querySelector('[data-hdate="0"]'); if (first) first.focus();
    };
    $('hol-save').onclick = saveHolidays;
    $('hol-fetch').onclick = fetchHolidays;
    $('f-slot').addEventListener('change', renderRoster);
    $('roster-views').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setRosterView(b.dataset.view); });
    $('f-range-apply').onclick = async () => {
      const f = $('f-from').value, t = $('f-to').value;
      if (!f || !t) { toast('กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด', 'warn'); return; }
      if (t < f) { toast('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น', 'warn'); return; }
      const prev = S.admin.range; S.admin.range = { from: f, to: t };
      try { await loadAdminMonth(); toast('แสดงข้อมูล ' + rangeLabel(), 'info'); } catch (e) { S.admin.range = prev; toast(e.message, 'err'); }
    };
    $('f-range-clear').onclick = async () => { $('f-from').value = ''; $('f-to').value = ''; if (!S.admin.range) return; S.admin.range = null; try { await loadAdminMonth(); } catch (e) { toast(e.message, 'err'); } };
    $('set-month-add').onclick = () => {
      const v = $('set-month-input').value;
      if (!/^\d{4}-\d{2}$/.test(v)) { toast('กรุณาเลือกเดือน', 'warn'); return; }
      if (S.admin.months.indexOf(v) < 0) S.admin.months.push(v);
      renderMonthChips();
    };
    $('set-save').onclick = saveSettings;
  }

  window.BRS = { state: S };
  boot();
})();
