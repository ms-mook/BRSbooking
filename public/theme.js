// ตั้งธีมก่อนหน้าเว็บแสดงผล (กันจอกระพริบ) — ค่า: light | dark | auto (ค่าเริ่มต้น light)
(function () {
  var mode = 'light';
  try { mode = localStorage.getItem('brs_theme') || 'light'; } catch (e) { /* ignore */ }
  var dark = mode === 'dark' || (mode === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'business' : 'corporate');
  document.documentElement.setAttribute('data-mode', mode);
})();
