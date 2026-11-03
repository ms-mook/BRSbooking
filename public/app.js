/* BRS Booking — front-end (vanilla JS) */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const API_URL = CFG.apiUrl || '/api/gas';
  const $ = (id) => document.getElementById(id);
  const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const SLOT_SHORT = {
    '06:00-08:30': 'เช้า', '08:30-12:30': 'สาย', '12:30-16:30': 'บ่าย', '16:30-สิ้นสุด': 'เย็น',
    '06:00-11:00': '06-11', '06:00-12:00': '06-12', '06:00-16:00': '06-16', '06:00-สิ้นสุด': 'ทั้งวัน'
  };
  const SLOT_COL = {
    '06:00-08:30': 0, '06:00-11:00': 0, '08:30-12:30': 1, '06:00-12:00': 1,
    '12:30-16:30': 2, '06:00-16:00': 2, '16:30-สิ้นสุด': 3, '06:00-สิ้นสุด': 4
  };
  const ROOM_SHORT = (r) => r.indexOf('OPD') >= 0 ? 'OPD' : r.indexOf('กว.') >= 0 ? 'กว.' : r.indexOf('SMC') >= 0 ? 'SMC' : r;
  const POS_SHORT = {
    'นักเทคนิคการแพทย์(MT Fulltime)งานห้องปฏิบัติการเวชศาสตร์ชันสูตร': 'MT Fulltime',
    'นักเทคนิคการแพทย์(MT บุคลากรประจำคณะแพทย์ศาสตร์)': 'MT ประจำคณะฯ',
    'พยาบาลวิชาชีพ(RN Parttime, บุคลากรประจำคณะแพทย์ศาสตร์)': 'RN Parttime',
    'นักเทคนิคการแพทย์(MT Parttime)': 'MT Parttime',
    'บุคลากรประจำคณะแพทย์ศาสตร์ ตำแหน่งอื่นๆ': 'ตำแหน่งอื่นๆ'
  };
  const STATUS_LABEL = { active: 'ใช้งาน', pending: 'รออนุมัติ', inactive: 'ระงับ' };

  const S = {
    info: null, token: null, user: null, month: null, selected: null,
    my: { bookings: [], leaves: [] }, picked: null,
    admin: { token: null, month: null, data: null, staff: [], holidays: [], settings: null, months: [], tab: 'roster' }
  };

  /* ---------------- utilities ---------------- */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function store(key, val) {
    try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; }
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
  function fmtShort(key) {
    const p = parts(key);
    return DOW[dow(key)].slice(0, 2).replace('พฤ', 'พฤ') + ' ' + p.d + '/' + p.m + '/' + String(p.y + 543).slice(2);
  }
  function holidayOf(key) { return (S.info.holidays || []).find((h) => h.date === key) || null; }
  function isSpecial(key) {
    const d = dow(key);
    if (d === 0 || d === 6) return true;
    return S.info.settings.holidayAsWeekend && !!holidayOf(key);
  }
  function monthOpen(key) {
    const st = S.info.settings;
    if (!st.bookingOpen) return false;
    return !st.bookingMonths.length || st.bookingMonths.indexOf(key.slice(0, 7)) >= 0;
  }
  function sortSlots(slots) { return slots.slice().sort((a, b) => SLOT_COL[a] - SLOT_COL[b]); }
  function fullName(b) { return b.firstName + ' ' + b.lastName; }

  let busyCount = 0;
  function busy(on) { busyCount += on ? 1 : -1; if (busyCount < 0) busyCount = 0; $('busy').hidden = busyCount === 0; }

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind === 'err' ? 'toast-err' : kind === 'ok' ? 'toast-ok' : '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3500);
  }

  async function api(fn, args, opts) {
    opts = opts || {};
    if (!opts.silent) busy(true);
    try {
      const direct = /^https:\/\/script\.google(usercontent)?\.com\//.test(API_URL);
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': direct ? 'text/plain;charset=utf-8' : 'application/json' },
        body: JSON.stringify({ fn: fn, args: args || {} }),
        redirect: 'follow'
      });
      let out;
      try { out = await res.json(); } catch (e) { throw Object.assign(new Error('เชื่อมต่อ server ไม่สำเร็จ (' + res.status + ')'), { code: 'NETWORK' }); }
      if (!out.ok) throw Object.assign(new Error(out.error || 'เกิดข้อผิดพลาด'), { code: out.code || 'ERROR' });
      return out.data;
    } catch (e) {
      if (!e.code) { e.code = 'NETWORK'; e.message = 'เชื่อมต่อ server ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'; }
      if (e.code === 'SESSION' && !opts.keepSession) handleExpired(fn);
      throw e;
    } finally {
      if (!opts.silent) busy(false);
    }
  }

  function handleExpired(fn) {
    if (fn.indexOf('admin') === 0) { S.admin.token = null; store('brs_admin', null); }
    else { S.token = null; S.user = null; store('brs_session', null); }
    closeAllDialogs();
    showView('login');
  }

  function closeAllDialogs() { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); }
  function openDialog(id) { const d = $(id); if (!d.open) d.showModal(); return d; }

  /** dialog ถาม/ยืนยัน — คืน null ถ้ายกเลิก หรือ { value, choice } */
  function ask(o) {
    return new Promise((resolve) => {
      const d = $('dlg-ask');
      $('ask-title').textContent = o.title || '';
      const text = $('ask-text');
      text.textContent = o.text || '';
      if (o.choices) {
        const wrap = document.createElement('div');
        wrap.className = 'slots';
        wrap.style.marginTop = '12px';
        wrap.innerHTML = o.choices.map((c, i) => '<label class="slot-opt"><input type="radio" name="ask-choice" value="' + esc(c.value) + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(c.label) + '</span></label>').join('');
        text.appendChild(wrap);
      }
      $('ask-input-wrap').hidden = !o.input;
      $('ask-input').value = '';
      $('ask-input-label').textContent = o.input ? o.input.label : '';
      $('ask-ok').textContent = o.okText || 'ตกลง';
      $('ask-ok').className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary');
      const finish = (val) => { cleanup(); d.close(); resolve(val); };
      const onSubmit = (ev) => {
        ev.preventDefault();
        const value = $('ask-input').value.trim();
        if (o.input && o.input.required && !value) { toast(o.input.requiredMsg || 'กรุณากรอกข้อมูล', 'err'); return; }
        const ch = d.querySelector('input[name="ask-choice"]:checked');
        finish({ value: value, choice: ch ? ch.value : null });
      };
      const onCancel = () => finish(null);
      const onClose = () => { cleanup(); resolve(null); };
      function cleanup() {
        $('ask-form').removeEventListener('submit', onSubmit);
        $('ask-cancel').removeEventListener('click', onCancel);
        d.removeEventListener('cancel', onClose);
      }
      $('ask-form').addEventListener('submit', onSubmit);
      $('ask-cancel').addEventListener('click', onCancel);
      d.addEventListener('cancel', onClose);
      openDialog('dlg-ask');
      if (o.input) $('ask-input').focus();
    });
  }

  function showView(name) {
    ['loading', 'login', 'user', 'admin'].forEach((v) => { $('view-' + v).hidden = v !== name; });
    const act = $('topbar-actions');
    act.innerHTML = '';
    if (name === 'user') act.innerHTML = '<button class="btn btn-ghost btn-sm" id="btn-logout">ออกจากระบบ</button>';
    if (name === 'admin') act.innerHTML = '<span class="muted small" style="align-self:center">ผู้ดูแลระบบ</span><button class="btn btn-ghost btn-sm" id="btn-admin-logout">ออกจากระบบ</button>';
    const lo = $('btn-logout'); if (lo) lo.onclick = logout;
    const alo = $('btn-admin-logout'); if (alo) alo.onclick = adminLogout;
    if (name === 'login') resetLogin();
    window.scrollTo(0, 0);
  }

  function renderNotice() {
    const st = S.info.settings;
    const html = st.notice ? '<strong>หมายเหตุ:</strong> ' + esc(st.notice) + (st.contact ? ' หากมีข้อสงสัยติดต่อ ' + esc(st.contact) : '') : '';
    $('notice-login').innerHTML = html;
    $('notice-user').innerHTML = html;
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    bindStatic();
    try {
      S.info = await api('getPublicInfo', {}, { silent: true });
    } catch (e) {
      $('view-loading').innerHTML = '<div class="card center"><p><b>เชื่อมต่อ server ไม่สำเร็จ</b></p><p class="muted">' + esc(e.message) + '</p><button class="btn btn-primary" onclick="location.reload()">ลองใหม่</button></div>';
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
  function resetLogin() {
    S.picked = null;
    $('staff-search').value = '';
    $('staff-search').hidden = false;
    $('staff-picked').hidden = true;
    $('staff-options').hidden = true;
    $('login-pin').value = '';
    $('setup-pin').value = '';
    $('setup-pin2').value = '';
    $('pin-login-block').hidden = false;
    $('pin-setup-block').hidden = true;
  }

  function renderCombo() {
    const q = $('staff-search').value.trim().toLowerCase();
    const list = $('staff-options');
    if (!q) { list.hidden = true; return; }
    const hits = S.info.staff.filter((s) => s.name.toLowerCase().indexOf(q) >= 0).slice(0, 12);
    list.innerHTML = hits.length
      ? hits.map((s, i) => '<button type="button" class="combo-item' + (i === 0 ? ' active' : '') + '" data-id="' + esc(s.id) + '">' + esc(s.name) + '<small>' + esc(POS_SHORT[s.position] || s.position) + '</small></button>').join('')
      : '<div class="combo-empty">ไม่พบชื่อ — กด "ขอเพิ่มรายชื่อ" ด้านล่าง</div>';
    list.hidden = false;
  }

  function pickStaff(id) {
    const s = S.info.staff.find((x) => x.id === id);
    if (!s) return;
    S.picked = s;
    $('staff-options').hidden = true;
    $('staff-search').hidden = true;
    const p = $('staff-picked');
    p.innerHTML = '<div><b>' + esc(s.name) + '</b><small>' + esc(s.position) + '</small></div><button type="button" class="link" id="btn-repick">เปลี่ยน</button>';
    p.hidden = false;
    $('btn-repick').onclick = () => { resetLogin(); $('staff-search').focus(); };
    $('pin-login-block').hidden = !s.hasPin;
    $('pin-setup-block').hidden = s.hasPin;
    (s.hasPin ? $('login-pin') : $('setup-pin')).focus();
  }

  async function doLogin() {
    if (!S.picked) { toast('กรุณาเลือกชื่อของคุณ', 'err'); return; }
    const pin = $('login-pin').value.trim();
    if (!pin) { toast('กรุณากรอก PIN', 'err'); return; }
    try {
      const r = await api('login', { staffId: S.picked.id, pin: pin });
      afterLogin(r);
    } catch (e) {
      if (e.code === 'NO_PIN') { S.picked.hasPin = false; pickStaff(S.picked.id); }
      toast(e.message, 'err');
      $('login-pin').select();
    }
  }

  async function doSetPin() {
    const a = $('setup-pin').value.trim();
    const b = $('setup-pin2').value.trim();
    if (!/^\d{4,6}$/.test(a)) { toast('PIN ต้องเป็นตัวเลข 4–6 หลัก', 'err'); return; }
    if (a !== b) { toast('PIN ทั้งสองช่องไม่ตรงกัน', 'err'); return; }
    try {
      const r = await api('setFirstPin', { staffId: S.picked.id, pin: a });
      S.picked.hasPin = true;
      toast('ตั้ง PIN เรียบร้อย', 'ok');
      afterLogin(r);
    } catch (e) {
      if (e.code === 'HAS_PIN') { S.picked.hasPin = true; pickStaff(S.picked.id); }
      toast(e.message, 'err');
    }
  }

  async function afterLogin(r) {
    S.token = r.token; S.user = r.user;
    store('brs_session', { token: r.token, user: r.user });
    try { await enterUser(); } catch (e) { toast(e.message, 'err'); }
  }

  async function logout() {
    const t = S.token;
    S.token = null; S.user = null; store('brs_session', null);
    showView('login');
    if (t) api('logout', { token: t }, { silent: true }).catch(() => {});
  }

  /* ---------------- user view ---------------- */
  async function enterUser() {
    await loadMyMonth();
    $('hello').textContent = 'สวัสดี ' + S.user.firstName + ' ' + S.user.lastName;
    $('user-position').textContent = S.user.position;
    showView('user');
    renderCalendar();
    selectDay(S.selected && S.selected.slice(0, 7) === S.month ? S.selected : (S.info.today.slice(0, 7) === S.month ? S.info.today : null));
  }

  async function loadMyMonth() {
    const r = await api('getMyBookings', { token: S.token, month: S.month });
    S.my = { bookings: r.bookings, leaves: r.leaves };
    S.user = r.user;
  }

  async function changeMonth(delta) {
    S.month = shiftMonth(S.month, delta);
    S.selected = null;
    try { await loadMyMonth(); } catch (e) { toast(e.message, 'err'); }
    renderCalendar();
    selectDay(null);
  }

  function renderCalendar() {
    $('cal-title').textContent = monthLabel(S.month);
    const [y, m] = S.month.split('-').map(Number);
    const first = keyOf(y, m, 1);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const open = monthOpen(first) || monthOpen(keyOf(y, m, days));
    const ms = $('month-status');
    ms.innerHTML = open
      ? '<span class="pill pill-open">เปิดรับจองเวรเดือนนี้</span>'
      : '<span class="pill pill-closed">ปิดรับจองเวรเดือนนี้</span> <span class="muted small">ยกเลิกได้โดยแจ้งลาเวร</span>';
    let html = '';
    for (let i = 0; i < dow(first); i++) html += '<div class="day empty"></div>';
    for (let d = 1; d <= days; d++) {
      const key = keyOf(y, m, d);
      const wd = dow(key);
      const hol = holidayOf(key);
      const cls = ['day'];
      if (wd === 6) cls.push('sat');
      if (wd === 0) cls.push('sun');
      if (hol) cls.push('holiday');
      if (key < S.info.today) cls.push('past');
      if (key === S.info.today) cls.push('today');
      if (key === S.selected) cls.push('selected');
      const mine = S.my.bookings.filter((b) => b.date === key);
      const chips = mine.map((b) => '<span class="chip">' + esc(ROOM_SHORT(b.room)) + ' ' + esc(b.slots.map((s) => SLOT_SHORT[s] || s).join('·')) + '</span>').join('');
      const label = fmtDate(key, true) + (hol ? ' ' + hol.name : '') + (mine.length ? ' มีเวร ' + mine.length + ' รายการ' : '');
      html += '<button type="button" class="' + cls.join(' ') + '" data-date="' + key + '" aria-label="' + esc(label) + '"><span class="num">' + d + '</span>' +
        (hol ? '<span class="hname">' + esc(hol.name) + '</span>' : '') + chips + '</button>';
    }
    $('calendar').innerHTML = html;
  }

  function selectDay(key) {
    S.selected = key;
    document.querySelectorAll('#calendar .day').forEach((el) => el.classList.toggle('selected', el.dataset.date === key));
    const panel = $('day-panel');
    if (!key) { panel.innerHTML = '<div class="muted center">เลือกวันที่บนปฏิทินเพื่อดูหรือจองเวร</div>'; return; }
    const hol = holidayOf(key);
    const special = isSpecial(key);
    const past = key < S.info.today;
    const open = monthOpen(key);
    const mine = S.my.bookings.filter((b) => b.date === key);
    const left = S.my.leaves.filter((b) => b.date === key);
    let typeText = special
      ? (hol && !(dow(key) === 0 || dow(key) === 6) ? 'วันหยุดราชการ' : 'วันเสาร์-อาทิตย์') + ' — เลือกได้ 1 ช่วงเวลา และจองได้ 1 เวรต่อวัน'
      : 'วันธรรมดา — เลือกได้หลายช่วงเวลา';
    if (hol) typeText = '<b style="color:var(--holiday-ink)">' + esc(hol.name) + '</b><br>' + esc(typeText);
    else typeText = esc(typeText);
    let html = '<h3>' + esc(fmtDate(key, true)) + '</h3><div class="daytype">' + typeText + '</div>';
    if (!mine.length) html += '<p class="muted">ยังไม่มีเวรที่คุณจองในวันนี้</p>';
    mine.forEach((b) => {
      html += '<div class="bk"><div class="bk-title">' + esc(b.room) + '</div><div class="bk-meta">' + esc(b.station) + '</div>' +
        '<div class="bk-slots">' + b.slots.map((s) => '<span class="slot-tag">' + esc(s) + '</span>').join('') + '</div>' +
        (past ? '' : '<div class="bk-actions">' +
          (open ? '<button class="btn btn-ghost btn-sm" data-edit="' + esc(b.id) + '">แก้ไข</button>' : '') +
          '<button class="btn btn-sm ' + (open ? 'btn-ghost' : 'btn-danger') + '" data-cancel="' + esc(b.id) + '">' + (open ? 'ยกเลิก' : 'แจ้งลาเวร') + '</button></div>') +
        '</div>';
    });
    if (left.length) {
      html += '<div class="muted small" style="margin:8px 0 4px">ประวัติยกเลิก/ลาในวันนี้</div>';
      left.forEach((b) => { html += '<div class="small muted">• ' + esc(b.type) + ': ' + esc(ROOM_SHORT(b.room)) + ' ' + esc(b.slots.join(', ')) + (b.reason ? ' (' + esc(b.reason) + ')' : '') + '</div>'; });
    }
    let reason = '';
    if (past) reason = 'ไม่สามารถจองย้อนหลังได้';
    else if (!open) reason = 'ปิดรับจองเวรของเดือนนี้แล้ว';
    else if (special && mine.length) reason = 'วันนี้คุณจองครบ 1 เวรแล้ว';
    html += '<button class="btn btn-primary btn-block" id="btn-book"' + (reason ? ' disabled' : '') + '>+ จองเวรวันนี้</button>';
    if (reason) html += '<p class="muted small center">' + esc(reason) + '</p>';
    panel.innerHTML = html;
    const bb = $('btn-book'); if (bb && !reason) bb.onclick = () => openBooking({ mode: 'user', date: key });
    panel.querySelectorAll('[data-edit]').forEach((el) => { el.onclick = () => openBooking({ mode: 'user', date: key, booking: mine.find((b) => b.id === el.dataset.edit) }); });
    panel.querySelectorAll('[data-cancel]').forEach((el) => { el.onclick = () => cancelMine(mine.find((b) => b.id === el.dataset.cancel)); });
    if (window.innerWidth <= 900 && !S._noScroll) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function cancelMine(b) {
    const open = monthOpen(b.date);
    const r = await ask({
      title: open ? 'ยกเลิกการจองนี้?' : 'แจ้งลาเวร',
      text: fmtDate(b.date, true) + '\n' + b.room + ' — ' + b.station + '\n' + b.slots.join(', ') +
        (open ? '' : '\n\nรอบจองเดือนนี้ปิดแล้ว ระบบจะบันทึกเป็น "ลาเวร" และแจ้งผู้ดูแล'),
      input: open ? { label: 'เหตุผล (ไม่บังคับ)' } : { label: 'เหตุผลการลา', required: true, requiredMsg: 'กรุณาระบุเหตุผลการลา' },
      okText: open ? 'ยืนยันยกเลิก' : 'ยืนยันลาเวร',
      danger: true
    });
    if (!r) return;
    try {
      const res = await api('cancelBooking', { token: S.token, id: b.id, reason: r.value });
      toast(res.message, 'ok');
      await loadMyMonth();
      renderCalendar();
      S._noScroll = true; selectDay(b.date); S._noScroll = false;
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- booking dialog (user + admin) ---------------- */
  let BK = null;
  function openBooking(o) {
    BK = o;
    const isAdmin = o.mode === 'admin';
    const b = o.booking || null;
    $('booking-title').textContent = b ? 'แก้ไขการจอง' : (isAdmin ? 'เพิ่มการจอง' : 'จองเวร');
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
    } else {
      $('booking-date').textContent = fmtDate(o.date, true);
    }
    $('booking-room').innerHTML = '<option value="">เลือกห้อง...</option>' + S.info.rooms.map((r) => '<option value="' + esc(r.name) + '">' + esc(r.name) + '</option>').join('');
    $('booking-room').value = b ? b.room : '';
    fillStations(b ? b.station : '');
    renderSlots(b ? b.slots : []);
    openDialog('dlg-booking');
  }

  function bookingDate() { return BK.mode === 'admin' ? $('booking-date-input').value : BK.date; }

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
    if (!date) { box.innerHTML = '<div class="muted small">เลือกวันที่ก่อน</div>'; $('booking-hint').textContent = ''; return; }
    const special = isSpecial(date);
    const slots = special ? S.info.specialSlots : S.info.weekdaySlots;
    $('booking-hint').textContent = special ? 'วันเสาร์-อาทิตย์/วันหยุดราชการ เลือกได้ 1 ช่วง' : 'วันธรรมดา เลือกได้หลายช่วง';
    // ช่วงที่ผู้ใช้จองไว้แล้วในวันเดียวกัน (ยกเว้นรายการที่กำลังแก้)
    const taken = {};
    if (BK.mode === 'user') {
      S.my.bookings.filter((b) => b.date === date && (!BK.booking || b.id !== BK.booking.id))
        .forEach((b) => b.slots.forEach((s) => { taken[SLOT_COL[s]] = b; }));
    }
    const type = special ? 'radio' : 'checkbox';
    box.innerHTML = slots.map((s) => {
      const t = taken[SLOT_COL[s]];
      const dis = !!t;
      return '<label class="slot-opt' + (dis ? ' taken' : '') + '"><input type="' + type + '" name="slot" value="' + esc(s) + '"' +
        (checked.indexOf(s) >= 0 ? ' checked' : '') + (dis ? ' disabled' : '') + '><span>' + esc(s) +
        (dis ? ' <small>(จองแล้วที่ ' + esc(ROOM_SHORT(t.room)) + ')</small>' : '') + '</span></label>';
    }).join('');
  }

  async function submitBooking(ev) {
    ev.preventDefault();
    const date = bookingDate();
    const slots = Array.from(document.querySelectorAll('#booking-slots input:checked')).map((i) => i.value);
    const args = { date: date, room: $('booking-room').value, station: $('booking-station').value, slots: sortSlots(slots) };
    if (BK.booking) args.id = BK.booking.id;
    if (!date) { toast('กรุณาเลือกวันที่', 'err'); return; }
    if (!args.room || !args.station) { toast('กรุณาเลือกห้องและจุดปฏิบัติงาน', 'err'); return; }
    if (!slots.length) { toast('กรุณาเลือกช่วงเวลา', 'err'); return; }
    try {
      if (BK.mode === 'admin') {
        args.staffId = $('booking-staff').value;
        if (!args.staffId) { toast('กรุณาเลือกบุคลากร', 'err'); return; }
        args.token = S.admin.token;
        let res;
        try {
          res = await api('adminSaveBooking', args);
        } catch (e) {
          if (e.code !== 'DUPLICATE') throw e;
          const ok = await ask({ title: 'พบการจองซ้ำ', text: e.message + '\n\nต้องการบันทึกต่อหรือไม่?', okText: 'บันทึกต่อ', danger: true });
          if (!ok) return;
          args.force = true;
          res = await api('adminSaveBooking', args);
        }
        $('dlg-booking').close();
        toast(res.message, 'ok');
        await loadAdminMonth();
      } else {
        args.token = S.token;
        const res = await api('saveBooking', args);
        $('dlg-booking').close();
        toast(res.message, 'ok');
        await loadMyMonth();
        renderCalendar();
        S._noScroll = true; selectDay(date); S._noScroll = false;
      }
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- summary ---------------- */
  let SUM_MODE = 'month';
  let SUM_DATA = null;
  async function openSummary(mode) {
    SUM_MODE = mode || 'month';
    document.querySelectorAll('#summary-seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === SUM_MODE));
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
    let html = '';
    if (forPrint) html += '<h1>สรุปเวรที่จอง — ' + esc(S.user.firstName + ' ' + S.user.lastName) + '</h1><p class="sub">' + esc(S.user.position) + ' · ' + esc(title) + '</p>';
    else html += '<p class="muted">' + esc(title) + '</p>';
    html += '<div class="sum-cards"><div class="sum-card"><b>' + Object.keys(days).length + '</b>วัน</div><div class="sum-card"><b>' + slots + '</b>ช่วงเวร</div><div class="sum-card"><b>' + data.leaves.length + '</b>ลา/ยกเลิก</div></div>';
    if (forPrint) html = html.replace('class="sum-cards"', 'class="sum-cards" style="display:flex;gap:16pt;margin:6pt 0"');
    html += '<div class="table-wrap"><table class="table"><thead><tr><th>วันที่</th><th>ห้อง</th><th>จุดปฏิบัติงาน</th><th>ช่วงเวลา</th></tr></thead><tbody>';
    if (!bookings.length) html += '<tr class="empty-row"><td colspan="4">ไม่มีเวรที่จอง</td></tr>';
    bookings.forEach((b) => {
      const hol = holidayOf(b.date);
      html += '<tr><td class="date-cell">' + esc(fmtDate(b.date, true)) + (hol ? '<div class="small" style="color:var(--holiday-ink)">' + esc(hol.name) + '</div>' : '') + '</td><td>' + esc(b.room) + '</td><td>' + esc(b.station) + '</td><td>' + esc(b.slots.join(', ')) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    if (data.leaves.length) {
      html += '<h3 class="h2" style="margin-top:16px">ลาเวร / ยกเลิก</h3><div class="table-wrap"><table class="table"><thead><tr><th>วันที่</th><th>ประเภท</th><th>ห้อง / ช่วงเวลา</th><th>เหตุผล</th></tr></thead><tbody>';
      data.leaves.forEach((b) => { html += '<tr><td class="date-cell">' + esc(fmtDate(b.date)) + '</td><td>' + esc(b.type) + '</td><td>' + esc(ROOM_SHORT(b.room)) + ' ' + esc(b.slots.join(', ')) + '</td><td>' + esc(b.reason || '-') + '</td></tr>'; });
      html += '</tbody></table></div>';
    }
    return html;
  }

  function printHtml(html) {
    $('print-area').innerHTML = html + '<p class="foot">พิมพ์เมื่อ ' + esc(new Date().toLocaleString('th-TH')) + ' · ' + esc(S.info.title) + '</p>';
    window.print();
  }

  async function changePin(ev) {
    ev.preventDefault();
    const o = $('pin-old').value.trim(), n = $('pin-new').value.trim(), n2 = $('pin-new2').value.trim();
    if (!/^\d{4,6}$/.test(n)) { toast('PIN ใหม่ต้องเป็นตัวเลข 4–6 หลัก', 'err'); return; }
    if (n !== n2) { toast('PIN ใหม่ทั้งสองช่องไม่ตรงกัน', 'err'); return; }
    try {
      const r = await api('changePin', { token: S.token, oldPin: o, newPin: n });
      S.token = r.token; store('brs_session', { token: r.token, user: S.user });
      $('dlg-pin').close();
      toast('เปลี่ยน PIN เรียบร้อย', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function submitRequest(ev) {
    ev.preventDefault();
    const pin = $('req-pin').value.trim();
    if (!/^\d{4,6}$/.test(pin)) { toast('PIN ต้องเป็นตัวเลข 4–6 หลัก', 'err'); return; }
    if (pin !== $('req-pin2').value.trim()) { toast('PIN ทั้งสองช่องไม่ตรงกัน', 'err'); return; }
    try {
      await api('requestAccount', { firstName: $('req-first').value, lastName: $('req-last').value, position: $('req-position').value, pin: pin });
      $('dlg-request').close();
      $('request-form').reset();
      await ask({ title: 'ส่งคำขอเรียบร้อย', text: 'กรุณารอผู้ดูแลระบบอนุมัติ หลังอนุมัติแล้วจะเลือกชื่อและเข้าสู่ระบบด้วย PIN ที่ตั้งไว้ได้', okText: 'รับทราบ' });
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- admin ---------------- */
  async function adminLoginSubmit(ev) {
    ev.preventDefault();
    try {
      const r = await api('adminLogin', { username: $('adm-user').value.trim(), password: $('adm-pass').value });
      S.admin.token = r.token;
      store('brs_admin', { token: r.token });
      $('dlg-admin-login').close();
      $('adm-pass').value = '';
      await enterAdmin();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function adminLogout() {
    const t = S.admin.token;
    S.admin.token = null; store('brs_admin', null);
    showView('login');
    if (t) api('logout', { token: t }, { silent: true }).catch(() => {});
  }

  async function enterAdmin() {
    await loadAdminMonth(true);
    showView('admin');
    switchTab(S.admin.tab);
  }

  async function loadAdminMonth(noRender) {
    const d = await api('adminGetMonth', { token: S.admin.token, month: S.admin.month });
    S.admin.data = d;
    S.admin.staff = d.staff;
    S.admin.holidays = d.holidays.map((h) => ({ date: h.date, name: h.name }));
    S.admin.settings = d.settings;
    S.info.holidays = d.holidays;
    S.info.settings = d.settings;
    renderNotice();
    if (!noRender) renderAdmin();
  }

  function switchTab(tab) {
    S.admin.tab = tab;
    document.querySelectorAll('#admin-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.admin-pane').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
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
    return S.admin.data.bookings.filter((b) =>
      (!room || b.room === room) && (!st || b.station === st) && (!pos || b.position === pos) && (!date || b.date === date) &&
      (!q || fullName(b).toLowerCase().indexOf(q) >= 0));
  }

  function rosterSort(list) {
    const roomIdx = (r) => { const i = S.info.rooms.findIndex((x) => x.name === r); return i < 0 ? 99 : i; };
    return list.slice().sort((a, b) => a.date.localeCompare(b.date) || roomIdx(a.room) - roomIdx(b.room) || a.station.localeCompare(b.station, 'th') ||
      (SLOT_COL[a.slots[0]] - SLOT_COL[b.slots[0]]) || fullName(a).localeCompare(fullName(b), 'th'));
  }

  function renderRoster() {
    $('adm-title').textContent = monthLabel(S.admin.month);
    const list = rosterSort(filteredBookings());
    const people = {}; let slots = 0; const byRoom = {};
    list.forEach((b) => { people[fullName(b)] = 1; slots += b.slots.length; byRoom[ROOM_SHORT(b.room)] = (byRoom[ROOM_SHORT(b.room)] || 0) + 1; });
    $('adm-stats').innerHTML = '<span class="stat">รายการ <b>' + list.length + '</b></span><span class="stat">ช่วงเวร <b>' + slots + '</b></span><span class="stat">บุคลากร <b>' + Object.keys(people).length + '</b> คน</span>' +
      Object.keys(byRoom).map((r) => '<span class="stat">' + esc(r) + ' <b>' + byRoom[r] + '</b></span>').join('');
    let html = '<thead><tr><th>วันที่</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>ห้อง</th><th>จุดปฏิบัติงาน</th><th>ช่วงเวลา</th><th></th></tr></thead><tbody>';
    if (!list.length) html += '<tr class="empty-row"><td colspan="7">ไม่มีรายการจองในเดือนนี้' + (filteredBookings().length !== S.admin.data.bookings.length ? 'ตามตัวกรอง' : '') + '</td></tr>';
    let last = '';
    list.forEach((b) => {
      const first = b.date !== last; last = b.date;
      const hol = holidayOf(b.date);
      html += '<tr' + (first ? ' class="group-start"' : '') + '><td class="date-cell">' + (first ? esc(fmtShort(b.date)) + (hol ? '<div class="small" style="color:var(--holiday-ink);font-weight:500">' + esc(hol.name) + '</div>' : '') : '') + '</td>' +
        '<td>' + esc(fullName(b)) + '</td><td>' + esc(POS_SHORT[b.position] || b.position) + '</td><td>' + esc(ROOM_SHORT(b.room)) + '</td><td>' + esc(b.station) + '</td>' +
        '<td>' + b.slots.map((s) => '<span class="slot-tag">' + esc(s) + '</span>').join(' ') + '</td>' +
        '<td class="actions"><button class="btn btn-ghost btn-sm" data-aedit="' + esc(b.id) + '">แก้ไข</button> <button class="btn btn-ghost btn-sm" data-adel="' + esc(b.id) + '">ลบ/ลา</button></td></tr>';
    });
    $('adm-table').innerHTML = html + '</tbody>';
    $('adm-table').querySelectorAll('[data-aedit]').forEach((el) => { el.onclick = () => { const b = S.admin.data.bookings.find((x) => x.id === el.dataset.aedit); openBooking({ mode: 'admin', date: b.date, booking: b }); }; });
    $('adm-table').querySelectorAll('[data-adel]').forEach((el) => { el.onclick = () => adminDelete(S.admin.data.bookings.find((x) => x.id === el.dataset.adel)); });

    const lv = S.admin.data.leaves;
    let lh = '<thead><tr><th>วันที่</th><th>ชื่อ-นามสกุล</th><th>ห้อง / จุด</th><th>ช่วงเวลา</th><th>ประเภท</th><th>เหตุผล</th><th>โดย / เมื่อ</th></tr></thead><tbody>';
    if (!lv.length) lh += '<tr class="empty-row"><td colspan="7">ไม่มีรายการ</td></tr>';
    lv.forEach((b) => {
      lh += '<tr><td class="date-cell">' + esc(fmtShort(b.date)) + '</td><td>' + esc(fullName(b)) + '</td><td>' + esc(ROOM_SHORT(b.room)) + ' · ' + esc(b.station) + '</td><td>' + esc(b.slots.join(', ')) + '</td>' +
        '<td>' + esc(b.type || '-') + '</td><td>' + esc(b.reason || '-') + '</td><td class="small">' + esc(b.by || '-') + '<br>' + esc(b.timestamp) + '</td></tr>';
    });
    $('adm-leave-table').innerHTML = lh + '</tbody>';
  }

  async function adminDelete(b) {
    const r = await ask({
      title: 'นำรายการนี้ออกจากตารางเวร',
      text: fullName(b) + '\n' + fmtDate(b.date, true) + '\n' + b.room + ' — ' + b.station + '\n' + b.slots.join(', '),
      choices: [{ value: 'ลบโดยผู้ดูแล', label: 'ลบรายการ (ผู้ดูแลลบ)' }, { value: 'ลาเวร', label: 'บันทึกเป็นการลาเวร' }],
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
      pend.map((s) => '<tr><td>' + esc(s.firstName + ' ' + s.lastName) + '</td><td>' + esc(s.position) + '</td><td class="small">' + esc(s.createdAt) + '</td>' +
        '<td class="actions"><button class="btn btn-accent btn-sm" data-approve="' + esc(s.id) + '">อนุมัติ</button> <button class="btn btn-ghost btn-sm" data-reject="' + esc(s.id) + '">ไม่อนุมัติ</button></td></tr>').join('') + '</tbody>';
    const list = all.filter((s) => !q || (s.firstName + ' ' + s.lastName).toLowerCase().indexOf(q) >= 0);
    let html = '<thead><tr><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>สถานะ</th><th>PIN</th><th></th></tr></thead><tbody>';
    if (!list.length) html += '<tr class="empty-row"><td colspan="5">ไม่พบรายชื่อ</td></tr>';
    list.forEach((s) => {
      html += '<tr><td>' + esc(s.firstName + ' ' + s.lastName) + '</td><td>' + esc(POS_SHORT[s.position] || s.position) + '</td>' +
        '<td><span class="status status-' + esc(s.status) + '">' + esc(STATUS_LABEL[s.status] || s.status) + '</span></td><td class="small">' + (s.hasPin ? 'ตั้งแล้ว' : '<span class="muted">ยังไม่ตั้ง</span>') + '</td>' +
        '<td class="actions"><button class="btn btn-ghost btn-sm" data-sedit="' + esc(s.id) + '">แก้ไข</button>' + (s.hasPin ? ' <button class="btn btn-ghost btn-sm" data-sreset="' + esc(s.id) + '">รีเซ็ต PIN</button>' : '') + '</td></tr>';
    });
    $('staff-table').innerHTML = html + '</tbody>';
    const byId = (id) => S.admin.staff.find((s) => s.id === id);
    document.querySelectorAll('[data-approve]').forEach((el) => { el.onclick = () => saveStaffStatus(byId(el.dataset.approve), 'active'); });
    document.querySelectorAll('[data-reject]').forEach((el) => { el.onclick = () => saveStaffStatus(byId(el.dataset.reject), 'inactive'); });
    document.querySelectorAll('[data-sedit]').forEach((el) => { el.onclick = () => openStaff(byId(el.dataset.sedit)); });
    document.querySelectorAll('[data-sreset]').forEach((el) => { el.onclick = () => resetPin(byId(el.dataset.sreset)); });
  }

  async function reloadStaff() {
    S.admin.staff = await api('adminListStaff', { token: S.admin.token });
    renderAdmin();
  }

  async function saveStaffStatus(s, status) {
    try {
      await api('adminSaveStaff', { token: S.admin.token, id: s.id, firstName: s.firstName, lastName: s.lastName, position: s.position, status: status });
      toast(status === 'active' ? 'อนุมัติแล้ว' : 'บันทึกแล้ว', 'ok');
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
      const r = await api('adminSaveStaff', args);
      $('dlg-staff').close();
      toast(r.message + (r.renamed ? ' (ปรับรายการจอง ' + r.renamed + ' รายการ)' : ''), 'ok');
      if (r.renamed) await loadAdminMonth(); else await reloadStaff();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function resetPin(s) {
    const ok = await ask({ title: 'รีเซ็ต PIN', text: 'รีเซ็ต PIN ของ ' + s.firstName + ' ' + s.lastName + '?\nผู้ใช้จะตั้ง PIN ใหม่ได้เองเมื่อเข้าสู่ระบบครั้งถัดไป', okText: 'รีเซ็ต', danger: true });
    if (!ok) return;
    try { const r = await api('adminResetPin', { token: S.admin.token, id: s.id }); toast(r.message, 'ok'); await reloadStaff(); } catch (e) { toast(e.message, 'err'); }
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
    let html = '<thead><tr><th style="width:190px">วันที่</th><th>ชื่อวันหยุด</th><th style="width:140px">วัน</th><th></th></tr></thead><tbody>';
    let shown = 0;
    S.admin.holidays.forEach((h, i) => {
      if (year !== 'all' && h.date && h.date.slice(0, 4) !== year) return;
      shown++;
      html += '<tr><td><input class="input" type="date" data-hdate="' + i + '" value="' + esc(h.date) + '"></td>' +
        '<td><input class="input" type="text" maxlength="120" data-hname="' + i + '" value="' + esc(h.name) + '" placeholder="ชื่อวันหยุด"></td>' +
        '<td class="small muted">' + (h.date ? esc(DOW[dow(h.date)]) : '') + '</td>' +
        '<td class="actions"><button class="btn btn-ghost btn-sm" data-hdel="' + i + '">ลบ</button></td></tr>';
    });
    if (!shown) html += '<tr class="empty-row"><td colspan="4">ยังไม่มีวันหยุดในปีนี้</td></tr>';
    $('hol-table').innerHTML = html + '</tbody>';
    $('hol-table').querySelectorAll('[data-hdate]').forEach((el) => { el.onchange = () => { S.admin.holidays[el.dataset.hdate].date = el.value; renderHolidays(); }; });
    $('hol-table').querySelectorAll('[data-hname]').forEach((el) => { el.oninput = () => { S.admin.holidays[el.dataset.hname].name = el.value; }; });
    $('hol-table').querySelectorAll('[data-hdel]').forEach((el) => { el.onclick = () => { S.admin.holidays.splice(Number(el.dataset.hdel), 1); renderHolidays(); }; });
  }

  async function saveHolidays() {
    const list = S.admin.holidays;
    if (list.some((h) => !h.date)) { toast('มีแถวที่ยังไม่ได้เลือกวันที่', 'err'); return; }
    try {
      const r = await api('adminSaveHolidays', { token: S.admin.token, holidays: list });
      S.admin.holidays = r.holidays.map((h) => ({ date: h.date, name: h.name }));
      S.info.holidays = r.holidays;
      toast('บันทึกวันหยุด ' + r.count + ' วันเรียบร้อย', 'ok');
      renderHolidays();
    } catch (e) { toast(e.message, 'err'); }
  }

  function renderSettings() {
    const st = S.admin.settings;
    $('set-open').checked = st.bookingOpen;
    $('set-holiday-rule').checked = st.holidayAsWeekend;
    $('set-notice').value = st.notice;
    $('set-contact').value = st.contact;
    S.admin.months = st.bookingMonths.slice();
    renderMonthChips();
  }

  function renderMonthChips() {
    const box = $('set-months');
    box.innerHTML = S.admin.months.length
      ? S.admin.months.slice().sort().map((m) => '<span class="chip-x">' + esc(monthLabel(m)) + '<button type="button" data-mdel="' + esc(m) + '" aria-label="ลบเดือน">&times;</button></span>').join('')
      : '<span class="muted small">ทุกเดือน (ตั้งแต่วันนี้)</span>';
    box.querySelectorAll('[data-mdel]').forEach((el) => { el.onclick = () => { S.admin.months = S.admin.months.filter((m) => m !== el.dataset.mdel); renderMonthChips(); }; });
  }

  async function saveSettings() {
    try {
      const r = await api('adminSaveSettings', {
        token: S.admin.token,
        settings: {
          BOOKING_OPEN: $('set-open').checked, BOOKING_MONTHS: S.admin.months.join(','),
          NOTICE: $('set-notice').value, CONTACT: $('set-contact').value, SPECIAL_DAY_RULE: $('set-holiday-rule').checked
        }
      });
      S.admin.settings = r.settings; S.info.settings = r.settings;
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
    let X;
    busy(true);
    try { X = await loadXlsx(); } catch (e) { toast(e.message, 'err'); return; } finally { busy(false); }
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

    const data = X.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const [yy, mm] = S.admin.month.split('-');
    a.download = 'BRS-roster-' + (Number(yy) + 543) + '-' + mm + '.xlsx'; // ชื่อไฟล์ภาษาอังกฤษ เพื่อให้ทุกเบราว์เซอร์ตั้งชื่อถูก
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('ดาวน์โหลดไฟล์ Excel แล้ว', 'ok');
  }

  function addSheet(X, wb, name, rows, widths) {
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
    groups.sort((a, b) => a.date.localeCompare(b.date) || list.findIndex((x) => x.room === a.room) - list.findIndex((x) => x.room === b.room) || a.station.localeCompare(b.station, 'th') || SLOT_COL[a.slot] - SLOT_COL[b.slot]);
    let html = '<h1>ตารางเวร ' + esc(S.info.title) + '</h1><p class="sub">' + esc(S.info.org) + ' · เดือน' + esc(monthLabel(S.admin.month)) + ' · ' + list.length + ' รายการ</p>';
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
  function bindStatic() {
    document.querySelectorAll('[data-close]').forEach((b) => { b.addEventListener('click', () => b.closest('dialog').close()); });
    $('staff-search').addEventListener('input', renderCombo);
    $('staff-search').addEventListener('keydown', (e) => {
      const items = Array.from($('staff-options').querySelectorAll('.combo-item'));
      if (!items.length) return;
      let i = items.findIndex((x) => x.classList.contains('active'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (i >= 0) items[i].classList.remove('active');
        i = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
        items[i].classList.add('active'); items[i].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') { e.preventDefault(); pickStaff(items[Math.max(0, i)].dataset.id); }
    });
    $('staff-options').addEventListener('click', (e) => { const b = e.target.closest('.combo-item'); if (b) pickStaff(b.dataset.id); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#staff-combo')) $('staff-options').hidden = true; });
    $('btn-login').onclick = doLogin;
    $('login-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $('btn-setpin').onclick = doSetPin;
    $('setup-pin2').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSetPin(); });
    $('btn-open-request').onclick = () => openDialog('dlg-request');
    $('btn-open-admin').onclick = () => { openDialog('dlg-admin-login'); $('adm-user').focus(); };
    $('request-form').addEventListener('submit', submitRequest);
    $('admin-login-form').addEventListener('submit', adminLoginSubmit);

    $('cal-prev').onclick = () => changeMonth(-1);
    $('cal-next').onclick = () => changeMonth(1);
    $('calendar').addEventListener('click', (e) => { const d = e.target.closest('.day'); if (d && d.dataset.date) selectDay(d.dataset.date); });
    $('btn-summary').onclick = () => openSummary('month');
    $('summary-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) openSummary(b.dataset.mode); });
    $('summary-print').onclick = () => printHtml(summaryHtml(SUM_DATA, true));
    $('btn-change-pin').onclick = () => { $('pin-form').reset(); openDialog('dlg-pin'); };
    $('pin-form').addEventListener('submit', changePin);

    $('booking-room').addEventListener('change', () => { fillStations(''); });
    $('booking-date-input').addEventListener('change', () => renderSlots([]));
    $('booking-form').addEventListener('submit', submitBooking);

    $('admin-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });
    $('adm-prev').onclick = async () => { S.admin.month = shiftMonth(S.admin.month, -1); $('f-date').value = ''; try { await loadAdminMonth(); } catch (e) { toast(e.message, 'err'); } };
    $('adm-next').onclick = async () => { S.admin.month = shiftMonth(S.admin.month, 1); $('f-date').value = ''; try { await loadAdminMonth(); } catch (e) { toast(e.message, 'err'); } };
    ['f-room', 'f-station', 'f-position', 'f-date'].forEach((id) => $(id).addEventListener('change', renderRoster));
    $('f-name').addEventListener('input', renderRoster);
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
    $('set-month-add').onclick = () => {
      const v = $('set-month-input').value;
      if (!/^\d{4}-\d{2}$/.test(v)) { toast('กรุณาเลือกเดือน', 'err'); return; }
      if (S.admin.months.indexOf(v) < 0) S.admin.months.push(v);
      renderMonthChips();
    };
    $('set-save').onclick = saveSettings;
  }

  window.BRS = { state: S };
  boot();
})();
