// ทดสอบหน้าเว็บทั้งหมดด้วย Playwright + Apps Script จำลอง: node test/e2e.mjs  (รัน npm run build ก่อน)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/npm-tools/node_modules/playwright'); }
const { devices } = playwright;
const XLSX = require('xlsx');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test/output');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 3911;
const BASE = 'http://localhost:' + PORT;

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('  ✓ ' + name); } catch (e) { results.push(['FAIL', name, e]); console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); }
}

const server = spawn(process.execPath, [path.join(ROOT, 'dev/server.mjs')], { env: Object.assign({}, process.env, { PORT: String(PORT), MOCK_NOW: '2026-11-04T09:00:00+07:00', GAS_URL: '', FIXTURE_FILE: '', MOCK_DELAY: '150' }), stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));

const browser = await playwright.chromium.launch();
const errors = [];
async function newPage(opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }, opts || {}));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()); // ไม่โหลดฟอนต์จากอินเทอร์เน็ตระหว่างทดสอบ
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.addInitScript(() => {
    window.__printed = []; window.print = () => { window.__printed.push(document.getElementById('print-area').innerHTML); };
    window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  return page;
}
async function expectToast(page, re) {
  try {
    await page.waitForFunction((src) => Array.from(document.querySelectorAll('#toasts .alert')).some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 8000 });
  } catch (e) {
    const all = await page.$$eval('#toasts .alert', (ts) => ts.map((t) => t.textContent));
    throw new Error('ไม่พบการแจ้งเตือน ' + re + ' — มี: ' + JSON.stringify(all));
  }
  await page.evaluate(() => document.querySelectorAll('#toasts .alert').forEach((x) => x.remove()));
  await page.waitForFunction(() => !document.body.hasAttribute('data-loading'));
}
const idle = (page) => page.waitForFunction(() => !document.body.hasAttribute('data-loading'));
const day = (page, d, m) => page.locator('#calendar .cal-day[data-date="2026-' + (m || '11') + '-' + String(d).padStart(2, '0') + '"]');
async function pick(page, q, name) {
  await page.fill('#staff-search', q);
  await page.locator('#staff-options .combo-item', { hasText: name }).first().click();
}
async function firstLogin(page, q, name, pin) {
  await pick(page, q, name);
  await page.fill('#login-pin', pin);
  await page.click('#btn-login');
  await page.waitForSelector('#pin-setup-block:not([hidden])');
  await page.fill('#setup-pin', pin); await page.fill('#setup-pin2', pin);
  await page.click('#btn-setpin');
  await page.waitForSelector('#view-user:not([hidden])');
  await idle(page);
}
async function noHScroll(page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, window.scrollX]);
  assert.ok(w[0] <= w[1] + 1 && w[2] === 0, 'มี scroll แนวนอน ' + w);
  // ตรวจว่าไม่มีองค์ประกอบล้นขอบจอ (แม้หน้าเว็บจะซ่อน scroll แนวนอนไว้)
  const over = await page.evaluate(() => Array.from(document.querySelectorAll('main *')).filter((e) => {
    if (!e.offsetParent || e.closest('.overflow-x-auto, dialog, #toasts, .combo-list')) return false;
    const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
  }).slice(0, 5).map((e) => (e.id || e.className || e.tagName).toString().slice(0, 40)));
  assert.deepEqual(over, [], 'มีองค์ประกอบล้นขอบจอ: ' + JSON.stringify(over));
}

console.log('E2E: ผู้ใช้ (PC เต็มจอ)');
const page = await newPage();
await page.goto(BASE);

await step('หน้าเข้าสู่ระบบโหลดได้ แสดงประกาศ และไอคอน Lucide ถูกแปลงครบ', async () => {
  await page.waitForSelector('#view-login:not([hidden])');
  assert.match(await page.textContent('#notice-login'), /วันที่ 26/);
  await page.waitForFunction(() => document.querySelectorAll('svg.lucide').length > 10 && !document.querySelector('#view-login i[data-lucide]'));
});

await step('เลือกชื่อ → ใส่ PIN → ระบบบอกว่ายังไม่ตั้ง → ตั้ง PIN ครั้งแรก (กัน PIN ง่าย)', async () => {
  await page.fill('#staff-search', 'zzz');
  assert.match(await page.textContent('#staff-options'), /ไม่พบชื่อ/);
  await page.fill('#staff-search', 'สม');
  assert.equal(await page.locator('#staff-options .combo-item').count(), 2);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  assert.match(await page.textContent('#staff-picked'), /สมชาย ทดสอบดี/);
  assert.ok(await page.isVisible('#pin-login-block'), 'แสดงช่อง PIN ก่อน (ไม่บอกล่วงหน้าว่าใครยังไม่ตั้ง PIN)');
  await page.click('#btn-login');
  await expectToast(page, /กรุณากรอก PIN/);
  await page.fill('#login-pin', '2580');
  await page.click('#btn-login');
  await expectToast(page, /ยังไม่เคยตั้ง PIN/);
  assert.ok(await page.isVisible('#pin-setup-block'));
  await page.fill('#setup-pin', '1234'); await page.fill('#setup-pin2', '1234');
  await page.click('#btn-setpin');
  await expectToast(page, /เดาง่าย/);
  await page.fill('#setup-pin', '2580'); await page.fill('#setup-pin2', '2581');
  await page.click('#btn-setpin');
  await expectToast(page, /ไม่ตรงกัน/);
  await page.fill('#setup-pin2', '2580');
  await page.click('#btn-setpin');
  await page.waitForSelector('#view-user:not([hidden])');
  await expectToast(page, /ตั้ง PIN เรียบร้อย/);
  assert.match(await page.textContent('#hello'), /สมชาย ทดสอบดี/);
});

await step('PC แสดงผลเต็มความกว้างจอ (ไม่ล็อกกลางจอ)', async () => {
  const w = await page.evaluate(() => ({ view: document.getElementById('view-user').getBoundingClientRect().width, side: document.getElementById('sidebar').getBoundingClientRect().width, cal: document.getElementById('calendar').getBoundingClientRect().width, vw: innerWidth }));
  assert.ok(w.side > 200 && w.view >= w.vw - w.side - 20, 'เนื้อหาใช้พื้นที่เต็มจอที่เหลือจากเมนูซ้าย ' + JSON.stringify(w));
  assert.ok(w.cal > (w.vw - w.side) * 0.5, 'ปฏิทินใช้พื้นที่ส่วนใหญ่ ' + JSON.stringify(w));
});

await step('ปฏิทินแสดงเวรที่จองไว้ วันหยุด วันนี้ และสถานะเปิดรับ', async () => {
  assert.equal(await page.textContent('#cal-title'), 'พฤศจิกายน 2569');
  assert.match(await page.textContent('#month-status'), /เปิดรับจอง/);
  assert.match(await day(page, 3).textContent(), /OPD เช้า·สาย·บ่าย/);
  assert.match(await day(page, 7).textContent(), /OPD ทั้งวัน/);
  assert.ok(await day(page, 4).evaluate((e) => e.classList.contains('is-today')));
  assert.ok(await day(page, 7).evaluate((e) => e.classList.contains('is-sat')));
  assert.ok(await day(page, 2).evaluate((e) => e.classList.contains('is-past')));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'pc-user.png') });
});

await step('วันที่ผ่านมา: ดูได้แต่จอง/ยกเลิกไม่ได้', async () => {
  await day(page, 3).click();
  assert.match(await page.textContent('#day-panel'), /วันอังคารที่ 3 พฤศจิกายน 2569/);
  assert.ok(await page.isDisabled('#btn-book'));
  assert.equal(await page.locator('#day-panel [data-cancel]').count(), 0);
});

await step('จองวันธรรมดาหลายช่วง (แจ้งเตือนแบบ toast ไม่ปิดหน้าต่าง)', async () => {
  await day(page, 12).click();
  assert.match(await page.textContent('#day-panel'), /วันธรรมดา/);
  await page.click('#btn-book');
  await page.waitForSelector('#dlg-booking[open]');
  assert.equal(await page.locator('#booking-slots input[type=checkbox]').count(), 4);
  await page.click('#booking-submit');
  await expectToast(page, /ห้องและจุด/);
  assert.ok(await page.isVisible('#dlg-booking'), 'หน้าต่างยังเปิดอยู่ ผู้ใช้กรอกต่อได้ทันที');
  await page.selectOption('#booking-room', 'ห้องเจาะเลือดอาคารผู้ป่วยนอก OPD');
  await page.selectOption('#booking-station', 'จุดเจาะเลือด');
  await page.click('#booking-submit');
  await expectToast(page, /ช่วงเวลา/);
  await page.check('#booking-slots input[value="06:00-08:30"]');
  await page.check('#booking-slots input[value="12:30-16:30"]');
  await page.click('#booking-submit');
  await expectToast(page, /บันทึกการจองสำเร็จ/);
  assert.match(await day(page, 12).textContent(), /OPD เช้า·บ่าย/);
  assert.match(await page.textContent('#day-panel'), /06:00-08:30/);
});

await step('ช่วงที่จองแล้วในวันเดียวกันถูกปิดไว้ และจองช่วงที่เหลือได้ (ต่างห้อง)', async () => {
  await page.click('#btn-book');
  assert.ok(await page.isDisabled('#booking-slots input[value="06:00-08:30"]'));
  assert.match(await page.textContent('#booking-slots'), /จองแล้วที่ OPD/);
  await page.selectOption('#booking-room', 'ห้องเจาะเลือด SMC');
  await page.selectOption('#booking-station', 'จุดลงทะเบียนรายการตรวจ');
  await page.check('#booking-slots input[value="08:30-12:30"]');
  await page.click('#booking-submit');
  await expectToast(page, /สำเร็จ/);
  assert.equal(await page.locator('#day-panel .bk').count(), 2);
});

await step('วันเสาร์: เลือกได้ 1 ช่วง (radio) และจองได้ 1 เวรต่อวัน', async () => {
  await day(page, 14).click();
  assert.match(await page.textContent('#day-panel'), /เลือกได้ 1 ช่วงเวลา/);
  await page.click('#btn-book');
  assert.equal(await page.locator('#booking-slots input[type=radio]').count(), 4);
  await page.selectOption('#booking-room', 'ห้องเจาะเลือดอาคารกัลยาฯ กว.');
  await page.selectOption('#booking-station', 'จุดเจาะเลือด');
  await page.check('#booking-slots input[value="06:00-11:00"]');
  await page.check('#booking-slots input[value="06:00-12:00"]');
  assert.equal(await page.locator('#booking-slots input:checked').count(), 1);
  await page.click('#booking-submit');
  await expectToast(page, /สำเร็จ/);
  assert.ok(await page.isDisabled('#btn-book'));
  assert.match(await page.textContent('#day-panel'), /จองครบ 1 เวรแล้ว/);
});

await step('แก้ไขการจอง', async () => {
  await day(page, 14).click();
  await page.click('#day-panel [data-edit]');
  assert.equal(await page.inputValue('#booking-room'), 'ห้องเจาะเลือดอาคารกัลยาฯ กว.');
  assert.ok(await page.isChecked('#booking-slots input[value="06:00-12:00"]'));
  await page.check('#booking-slots input[value="06:00-สิ้นสุด"]');
  await page.click('#booking-submit');
  await expectToast(page, /แก้ไขการจองสำเร็จ/);
  assert.match(await day(page, 14).textContent(), /กว\. ทั้งวัน/);
});

await step('ยกเลิกการจอง (รอบยังเปิด) และเห็นประวัติ', async () => {
  await day(page, 12).click();
  await page.locator('#day-panel [data-cancel]').first().click();
  await page.waitForSelector('#dlg-ask[open]');
  assert.match(await page.textContent('#ask-title'), /ยกเลิกการจอง/);
  await page.click('#ask-cancel');
  assert.equal(await page.locator('#day-panel .bk').count(), 2, 'กดยกเลิกในกล่องยืนยันแล้วไม่ถูกลบ');
  await page.locator('#day-panel [data-cancel]').first().click();
  await page.fill('#ask-input', 'ติดธุระ');
  await page.click('#ask-ok');
  await expectToast(page, /ยกเลิกการจองเรียบร้อย/);
  assert.equal(await page.locator('#day-panel .bk').count(), 1);
  assert.match(await page.textContent('#day-history'), /ยกเลิกการจอง\s*OPD .*ติดธุระ/);
});

await step('สรุปเวรของฉัน (เดือน / ล่วงหน้า) และพิมพ์', async () => {
  await page.click('#btn-summary');
  await page.waitForSelector('#dlg-summary[open]');
  const stats = async () => page.$$eval('#sum-stats [data-stat]', (els) => els.map((e) => e.textContent));
  assert.deepEqual(await stats(), ['5', '8', '1']);
  await page.click('#summary-seg [data-mode="upcoming"]');
  await idle(page);
  assert.match(await page.textContent('#summary-content'), /ตั้งแต่ 4 พฤศจิกายน 2569/);
  assert.deepEqual(await stats(), ['3', '3', '1']);
  await page.click('#summary-print');
  const printed = await page.evaluate(() => window.__printed.pop());
  assert.match(printed, /สรุปเวรที่จอง — สมชาย ทดสอบดี/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'pc-summary.png') });
  await page.click('#dlg-summary [data-close]');
});

await step('[R29] เปลี่ยนเดือน + วันหยุดนักขัตฤกษ์ปิดรับจอง (กดจอง/เลือกหลายวันไม่ได้)', async () => {
  await page.click('#cal-next');
  await idle(page);
  assert.equal(await page.textContent('#cal-title'), 'ธันวาคม 2569');
  assert.match(await day(page, 7, '12').textContent(), /ชดเชยวันพ่อ/);
  await day(page, 7, '12').click();
  assert.match(await page.textContent('#day-panel'), /วันหยุดนักขัตฤกษ์ — ปิดรับจอง/);
  assert.ok(await page.isDisabled('#btn-book'));
  assert.ok(await day(page, 7, '12').evaluate((e) => e.classList.contains('is-blocked')));
  await page.check('#multi-toggle');
  await day(page, 7, '12').click();
  await expectToast(page, /วันหยุดนักขัตฤกษ์ .*ปิดรับจอง/);
  assert.equal(await page.locator('#calendar .cal-day.is-picked').count(), 0);
  await page.uncheck('#multi-toggle');
  await page.click('#cal-prev');
  await idle(page);
});

await step('เปลี่ยน PIN, ออกจากระบบ, เข้าใหม่ด้วย PIN ใหม่, PIN ผิดแจ้งเตือน', async () => {
  await page.click('#btn-change-pin');
  await page.fill('#pin-old', '2580'); await page.fill('#pin-new', '5678'); await page.fill('#pin-new2', '5678');
  await page.click('#pin-form button[type=submit]');
  await expectToast(page, /เดาง่าย/);
  await page.fill('#pin-new', '3691'); await page.fill('#pin-new2', '3691');
  await page.click('#pin-form button[type=submit]');
  await expectToast(page, /เปลี่ยน PIN เรียบร้อย/);
  await page.reload();
  await page.waitForSelector('#view-user:not([hidden])');
  await page.click('#btn-logout');
  await page.waitForSelector('#view-login:not([hidden])');
  await pick(page, 'ทดสอบดี', 'สมชาย');
  await page.fill('#login-pin', '2580');
  await page.press('#login-pin', 'Enter');
  await expectToast(page, /PIN ไม่ถูกต้อง/);
  await page.fill('#login-pin', '3691');
  await page.click('#btn-login');
  await page.waitForSelector('#view-user:not([hidden])');
  await page.click('#btn-logout');
});

await step('ขอเพิ่มรายชื่อ (แจ้งผลด้วย toast)', async () => {
  await page.click('#btn-open-request');
  await page.fill('#req-first', "แอน'นา");
  await page.fill('#req-last', 'ทดลอง "ใหม่"');
  await page.selectOption('#req-position', 'นักเทคนิคการแพทย์(MT Parttime)');
  await page.fill('#req-pin', '7395'); await page.fill('#req-pin2', '7395');
  await page.click('#request-form button[type=submit]');
  await expectToast(page, /ส่งคำขอเรียบร้อย/);
  assert.ok(!(await page.evaluate(() => document.getElementById('dlg-request').open)), 'หน้าต่างคำขอปิดแล้ว');
});

console.log('E2E: การแจ้งเตือนและ motion ไม่ขัดจังหวะ');
await step('[R12] toast ไม่บังการคลิก ปิดเองอัตโนมัติ และแสดงไม่เกิน 3 อัน', async () => {
  const st = await page.evaluate(() => getComputedStyle(document.getElementById('toasts')).pointerEvents);
  assert.equal(st, 'none');
  await page.click('#btn-open-request');
  await page.fill('#req-first', 'ทดสอบ'); await page.fill('#req-last', 'แจ้งเตือน');
  for (let i = 0; i < 5; i++) await page.click('#request-form button[type=submit]');
  assert.ok(await page.locator('#toasts .alert').count() <= 3);
  await page.click('#dlg-request [data-close]');
  await page.waitForFunction(() => document.querySelectorAll('#toasts .alert').length === 0, null, { timeout: 9000 });
});

await step('[R13] ระหว่างรอ server ไม่มีหน้าจอทึบบัง (มีแถบโหลดด้านบน + spinner บนปุ่ม)', async () => {
  await pick(page, 'ทดสอบดี', 'สมชาย');
  await page.fill('#login-pin', '3691');
  await page.evaluate(() => { window.__seen = { loading: false, spin: false }; new MutationObserver(() => { if (document.body.hasAttribute('data-loading')) window.__seen.loading = true; if (document.querySelector('#btn-login .loading')) window.__seen.spin = true; }).observe(document.body, { attributes: true, childList: true, subtree: true }); });
  await page.click('#btn-login');
  const covered = await page.evaluate(() => { const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return !!el && getComputedStyle(el).position === 'fixed' && el.offsetWidth >= innerWidth; });
  assert.equal(covered, false);
  await page.waitForSelector('#view-user:not([hidden])');
  assert.deepEqual(await page.evaluate(() => window.__seen), { loading: true, spin: true });
});

await step('[R14] ปุ่มย้อนกลับของเบราว์เซอร์ (มือถือ) ปิดหน้าต่างแทนการออกจากหน้า', async () => {
  await page.click('#btn-summary');
  await page.waitForSelector('#dlg-summary[open]');
  await page.goBack();
  await page.waitForFunction(() => !document.getElementById('dlg-summary').open);
  assert.ok(await page.isVisible('#view-user'));
});

await step('[R15] ไม่มีการละเมิด CSP (ไม่มี inline script/handler)', async () => {
  assert.deepEqual(await page.evaluate(() => window.__csp), []);
  await page.click('#btn-logout');
});

console.log('E2E: ผู้ดูแล');
const adm = await newPage({ viewport: { width: 1920, height: 1080 } });
await adm.goto(BASE);
await adm.waitForSelector('#view-login:not([hidden])');

await step('เข้าสู่ระบบผู้ดูแล (ผิด/ถูก)', async () => {
  await adm.click('#btn-open-admin');
  await adm.fill('#adm-user', 'admin'); await adm.fill('#adm-pass', 'wrong');
  await adm.click('#admin-login-form button[type=submit]');
  await expectToast(adm, /ไม่ถูกต้อง/);
  await adm.fill('#adm-pass', 'admin1234');
  await adm.click('#admin-login-form button[type=submit]');
  await adm.waitForSelector('#view-admin:not([hidden])');
  assert.equal(await adm.textContent('#adm-title'), 'พฤศจิกายน 2569');
  assert.equal(await adm.textContent('#pending-badge'), '1');
});

await step('ตารางเวรรวมเต็มจอ สถิติ และตัวกรอง', async () => {
  const w = await adm.evaluate(() => [document.getElementById('adm-table').getBoundingClientRect().width, document.getElementById('sidebar').getBoundingClientRect().width]);
  assert.ok(w[0] > (1920 - w[1]) * 0.9, 'ตารางกว้างเต็มพื้นที่ที่เหลือจากเมนูซ้าย: ' + w);
  assert.match(await adm.textContent('#adm-stats'), /รายการ 11/);
  await adm.fill('#f-name', 'สมชาย');
  assert.match(await adm.textContent('#adm-stats'), /รายการ 5/);
  await adm.fill('#f-name', '');
  await adm.selectOption('#f-room', 'ห้องเจาะเลือด SMC');
  assert.match(await adm.textContent('#adm-stats'), /รายการ 3/);
  await adm.selectOption('#f-room', '');
  await adm.fill('#f-date', '2026-11-05');
  assert.match(await adm.textContent('#adm-stats'), /รายการ 2/);
  await adm.fill('#f-date', '');
  await adm.dispatchEvent('#f-date', 'change');
  assert.match(await adm.textContent('#adm-leave-table'), /ยกเลิกการจอง.*ติดธุระ/);
  await adm.waitForTimeout(500);
  await adm.screenshot({ path: path.join(OUT, 'pc-admin-roster.png') });
});

await step('ผู้ดูแลเพิ่มการจอง (ย้อนหลังได้) และเตือนจองซ้ำ', async () => {
  await adm.click('#adm-add');
  await adm.waitForSelector('#dlg-booking[open]');
  const opt = await adm.locator('#booking-staff option', { hasText: 'ปิติ ยินดี' }).getAttribute('value');
  await adm.selectOption('#booking-staff', opt);
  await adm.fill('#booking-date-input', '2026-11-10');
  await adm.dispatchEvent('#booking-date-input', 'change');
  await adm.selectOption('#booking-room', 'ห้องเจาะเลือด SMC');
  await adm.selectOption('#booking-station', 'จุดเจาะเลือด');
  await adm.check('#booking-slots input[value="06:00-08:30"]');
  await adm.click('#booking-submit');
  await adm.waitForSelector('#dlg-ask[open]');
  assert.match(await adm.textContent('#ask-title'), /พบการจองซ้ำ/);
  await adm.click('#ask-cancel');
  await adm.fill('#booking-date-input', '2026-11-01');
  await adm.dispatchEvent('#booking-date-input', 'change');
  assert.equal(await adm.locator('#booking-slots input[type=radio]').count(), 4, 'วันอาทิตย์ใช้ช่วงพิเศษ');
  await adm.check('#booking-slots input[value="06:00-12:00"]');
  await adm.click('#booking-submit');
  await expectToast(adm, /เพิ่มการจองสำเร็จ/);
  assert.match(await adm.textContent('#adm-stats'), /รายการ 12/);
});

await step('[R16] ตรวจพบรายการจองซ้ำซ้อน (แบบที่เจอในข้อมูลจริง) แสดงป้าย "ซ้ำ" และกรองได้', async () => {
  await adm.click('#adm-add');
  const opt = await adm.locator('#booking-staff option', { hasText: 'ปิติ ยินดี' }).getAttribute('value');
  await adm.selectOption('#booking-staff', opt);
  await adm.fill('#booking-date-input', '2026-11-10');
  await adm.dispatchEvent('#booking-date-input', 'change');
  await adm.selectOption('#booking-room', 'ห้องเจาะเลือด SMC');
  await adm.selectOption('#booking-station', 'จุดเจาะเลือด');
  await adm.check('#booking-slots input[value="06:00-08:30"]');
  await adm.click('#booking-submit');
  await adm.click('#ask-ok');
  await expectToast(adm, /เพิ่มการจองสำเร็จ/);
  assert.match(await adm.textContent('#adm-stats'), /ซ้ำซ้อน 2/);
  await adm.check('#f-conflict');
  assert.equal(await adm.locator('#adm-table tbody tr').count(), 2);
  assert.equal(await adm.locator('#adm-table .badge-error', { hasText: 'ซ้ำ' }).count(), 2);
  const row = adm.locator('#adm-table tbody tr').filter({ hasText: 'SMC' });
  await row.locator('[data-adel]').click();
  await adm.click('#ask-ok');
  await expectToast(adm, /เรียบร้อย/);
  await adm.uncheck('#f-conflict');
  assert.doesNotMatch(await adm.textContent('#adm-stats'), /ซ้ำซ้อน/);
});

await step('ผู้ดูแลแก้ไข และบันทึกเป็นลาเวร', async () => {
  const row = () => adm.locator('#adm-table tr', { hasText: 'ปิติ ยินดี' }).filter({ hasText: '06:00-12:00' });
  await row().locator('[data-aedit]').click();
  await adm.selectOption('#booking-station', 'จุดลงทะเบียนรายการตรวจ');
  await adm.click('#booking-submit');
  await expectToast(adm, /แก้ไขการจองสำเร็จ/);
  await row().locator('[data-adel]').click();
  await adm.check('input[name="ask-choice"][value="ลาเวร"]');
  await adm.fill('#ask-input', 'ป่วย');
  await adm.click('#ask-ok');
  await expectToast(adm, /เรียบร้อย/);
  assert.match(await adm.textContent('#adm-leave-table'), /ลาเวร\s*ป่วย/);
});

await step('Export Excel: ไฟล์มี 4 แท็บและข้อมูลถูกต้อง', async () => {
  const [dl] = await Promise.all([adm.waitForEvent('download'), adm.click('#adm-excel')]);
  const file = path.join(OUT, 'export.xlsx');
  await dl.saveAs(file);
  assert.match(dl.suggestedFilename(), /^BRS-roster-2569-11\.xlsx$/);
  const wb = XLSX.readFile(file);
  assert.deepEqual(wb.SheetNames, ['ตารางเวร', 'สรุปรายวัน', 'สรุปรายบุคคล', 'ลา-ยกเลิก', 'ตารางเวร (ตาราง)', 'ยังไม่จอง']);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['ตารางเวร'], { header: 1 });
  assert.equal(rows.length, 12);
  assert.deepEqual(rows[0].slice(8), ['เช้า', 'สาย', 'บ่าย', 'นอกเวลาเย็น', 'ดึก']);
  const per = XLSX.utils.sheet_to_json(wb.Sheets['สรุปรายบุคคล']);
  const som = per.find((r) => r['ชื่อ-นามสกุล'] === 'สมชาย ทดสอบดี');
  assert.equal(som['จำนวนวัน'], 5); assert.equal(som['จำนวนช่วงเวร'], 8);
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['ลา-ยกเลิก']).length, 3);
  await expectToast(adm, /ดาวน์โหลดไฟล์ Excel แล้ว/);
});

await step('พิมพ์ / PDF ตารางเวร', async () => {
  await adm.click('#adm-pdf');
  const printed = await adm.evaluate(() => window.__printed.pop());
  assert.match(printed, /ตารางเวร/);
  assert.match(printed, /วันจันทร์ที่ 2 พฤศจิกายน 2569/);
  await adm.evaluate((h) => { document.getElementById('print-area').innerHTML = h; }, printed);
  await adm.emulateMedia({ media: 'print' });
  await adm.pdf({ path: path.join(OUT, 'roster.pdf'), format: 'A4', landscape: true });
  await adm.emulateMedia({ media: 'screen' });
});

await step('บุคลากร: อนุมัติคำขอ แก้ไข รีเซ็ต PIN และเพิ่มคนใหม่', async () => {
  await adm.click('#side-nav [data-tab="staff"]');
  assert.ok(await adm.isVisible('#pending-card'));
  assert.match(await adm.textContent('#pending-table'), /แอน'นา ทดลอง "ใหม่"/);
  await adm.click('#pending-table [data-approve]');
  await expectToast(adm, /อนุมัติแล้ว/);
  assert.ok(await adm.isHidden('#pending-card'));
  assert.ok(await adm.isHidden('#pending-badge'));
  await adm.fill('#staff-filter', 'สมชาย');
  assert.equal(await adm.locator('#staff-table tbody tr').count(), 1);
  await adm.click('#staff-table [data-sreset]');
  await adm.click('#ask-ok');
  await expectToast(adm, /รีเซ็ต PIN แล้ว/);
  assert.match(await adm.textContent('#staff-table'), /ยังไม่ตั้ง/);
  await adm.fill('#staff-filter', 'ชูใจ');
  await adm.click('#staff-table [data-sedit]');
  await adm.fill('#st-last', 'รักงานมาก');
  await adm.click('#staff-form button[type=submit]');
  await expectToast(adm, /ปรับรายการจอง 2 รายการ/);
  await adm.fill('#staff-filter', '');
  await adm.click('#staff-add');
  await adm.fill('#st-first', 'ใหม่'); await adm.fill('#st-last', 'ล่าสุด');
  await adm.selectOption('#st-position', 'บุคลากรประจำคณะแพทย์ศาสตร์ ตำแหน่งอื่นๆ');
  await adm.click('#staff-form button[type=submit]');
  await expectToast(adm, /เพิ่มบุคลากรแล้ว/);
  assert.match(await adm.textContent('#staff-table'), /ใหม่ ล่าสุด/);
  await adm.waitForTimeout(400);
  await adm.screenshot({ path: path.join(OUT, 'pc-admin-staff.png') });
});

await step('วันหยุด: เพิ่ม แก้ ลบ และบันทึก', async () => {
  await adm.click('#side-nav [data-tab="holidays"]');
  assert.equal(await adm.inputValue('#hol-year'), '2026');
  assert.equal(await adm.locator('#hol-table tbody tr').count(), 6);
  await adm.click('#hol-add');
  await adm.click('#hol-save');
  await expectToast(adm, /ยังไม่ได้เลือกวันที่/);
  await adm.fill('#hol-table [data-hdate="0"]', '2026-11-20');
  await adm.dispatchEvent('#hol-table [data-hdate="0"]', 'change');
  await adm.fill('#hol-table [data-hname="0"]', 'วันหยุดพิเศษตามมติ ครม.');
  await adm.locator('#hol-table tr').filter({ has: adm.locator('input[value="2026-12-31"]') }).locator('[data-hdel]').click();
  await adm.click('#hol-save');
  await expectToast(adm, /บันทึกวันหยุด 27 วัน/);
  await adm.selectOption('#hol-year', '2027');
  assert.equal(await adm.locator('#hol-table tbody tr').count(), 21);
  await adm.selectOption('#hol-year', '2026');
});

await step('ตั้งค่า: ปิดรอบเดือน พ.ย. (เปิดเฉพาะ ธ.ค.), ปิดการตั้ง PIN เอง และแก้ประกาศ', async () => {
  await adm.click('#side-nav [data-tab="settings"]');
  assert.ok(await adm.isChecked('#set-open'));
  assert.ok(!(await adm.isChecked('#set-holiday-rule')));
  assert.ok(await adm.isChecked('#set-self-pin'));
  assert.match(await adm.textContent('#set-months'), /ทุกเดือน/);
  await adm.click('#set-month-add');
  await expectToast(adm, /กรุณาเลือกเดือน/);
  await adm.fill('#set-month-input', '2026-12');
  await adm.click('#set-month-add');
  assert.match(await adm.textContent('#set-months'), /ธันวาคม 2569/);
  await adm.uncheck('#set-self-pin');
  await adm.fill('#set-notice', 'ส่งภายในวันที่ 20 ของเดือน');
  await adm.click('#set-save');
  await expectToast(adm, /บันทึกการตั้งค่าแล้ว/);
  await adm.screenshot({ path: path.join(OUT, 'pc-admin-settings.png') });
});

let tempPin = '';
await step('[R17] ปิดตั้ง PIN เอง: รีเซ็ต PIN ได้ PIN ชั่วคราว 6 หลัก', async () => {
  await adm.click('#side-nav [data-tab="staff"]');
  await adm.fill('#staff-filter', 'สมหญิง');
  await adm.click('#staff-table [data-sreset]');
  await adm.click('#ask-ok');
  await adm.waitForSelector('#temp-pin');
  tempPin = (await adm.textContent('#temp-pin')).trim();
  assert.match(tempPin, /^\d{6}$/);
  await adm.click('#ask-ok');
  assert.match(await adm.textContent('#staff-table'), /PIN ชั่วคราว/);
});

await step('[R17] ผู้ใช้เข้าด้วย PIN ชั่วคราว → ถูกบังคับเปลี่ยน PIN (กด Esc/ย้อนกลับปิดไม่ได้)', async () => {
  await page.goto(BASE);
  await page.waitForSelector('#view-login:not([hidden])');
  assert.match(await page.textContent('#notice-login'), /วันที่ 20/);
  await pick(page, 'มานะ', 'มานะ');
  await page.fill('#login-pin', '8024');
  await page.click('#btn-login');
  await expectToast(page, /ติดต่อผู้ดูแลเพื่อขอ PIN ชั่วคราว/);
  assert.ok(await page.isHidden('#pin-setup-block'));
  await page.click('#btn-repick');
  await pick(page, 'สมหญิง', 'สมหญิง');
  await page.fill('#login-pin', tempPin);
  await page.click('#btn-login');
  await page.waitForSelector('#dlg-pin[open]');
  assert.ok(await page.isVisible('#pin-force-note'));
  assert.ok(await page.isHidden('#pin-cancel'));
  await page.keyboard.press('Escape');
  await page.goBack();
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => document.getElementById('dlg-pin').open), 'ยังเปิดอยู่');
  await page.fill('#pin-old', tempPin); await page.fill('#pin-new', '4826'); await page.fill('#pin-new2', '4826');
  await page.click('#pin-form button[type=submit]');
  await expectToast(page, /เปลี่ยน PIN เรียบร้อย/);
  assert.ok(!(await page.evaluate(() => document.getElementById('dlg-pin').open)));
});

await step('ผู้ใช้เห็นวันหยุดใหม่ รอบปิด และยกเลิกต้องแจ้งลาเวรพร้อมเหตุผล', async () => {
  assert.match(await page.textContent('#month-status'), /ปิดรับจอง/);
  assert.match(await day(page, 20).textContent(), /วันหยุดพิเศษ/);
  await day(page, 12).click();
  assert.ok(await page.isDisabled('#btn-book'));
  assert.equal(await page.locator('#day-panel [data-edit]').count(), 0);
  await page.click('#day-panel [data-cancel]');
  assert.match(await page.textContent('#ask-title'), /แจ้งลาเวร/);
  await page.click('#ask-ok');
  await expectToast(page, /กรุณาระบุเหตุผล/);
  await page.fill('#ask-input', 'ไปอบรม');
  await page.click('#ask-ok');
  await expectToast(page, /บันทึกการลาเวรเรียบร้อย/);
  await page.click('#cal-next');
  await idle(page);
  assert.match(await page.textContent('#month-status'), /เปิดรับจอง/);
});

await step('session หมดอายุ → กลับหน้าเข้าสู่ระบบ', async () => {
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('brs_session')); s.token = 'bad'; localStorage.setItem('brs_session', JSON.stringify(s)); });
  await page.reload();
  await page.waitForSelector('#view-login:not([hidden])');
});

await step('ไม่มี CSP violation ในหน้าผู้ดูแล', async () => {
  assert.deepEqual(await adm.evaluate(() => window.__csp), []);
});

console.log('E2E: ฟีเจอร์ใหม่ (ธีม ฟอนต์ เมนูซ้าย ภาพรวม จองหลายวัน ปฏิทินมือถือ วันปิดรับ)');
const nf = await newPage({ colorScheme: 'dark' });
await step('[R20] ธีมเริ่มต้นเป็นสว่างแม้เครื่องตั้งโหมดมืด, สลับ มืด → ตามเครื่อง → สว่าง และจำค่าไว้', async () => {
  await nf.goto(BASE);
  await nf.waitForSelector('#view-login:not([hidden])');
  const theme = () => nf.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.dataset.mode]);
  assert.deepEqual(await theme(), ['corporate', 'light']);
  await nf.click('#theme-btn');
  assert.deepEqual(await theme(), ['business', 'dark']);
  await nf.reload(); await nf.waitForSelector('#view-login:not([hidden])');
  assert.deepEqual(await theme(), ['business', 'dark'], 'จำธีมหลังรีเฟรช');
  await nf.waitForTimeout(800);
  await nf.screenshot({ path: path.join(OUT, 'pc-login-dark.png') });
  await nf.click('#theme-btn');
  assert.deepEqual(await theme(), ['business', 'auto'], 'ตามเครื่อง (เครื่องตั้งมืด)');
  await nf.click('#theme-btn');
  assert.deepEqual(await theme(), ['corporate', 'light']);
});

await step('[R21] ใช้ฟอนต์ Sarabun จากเว็บเอง และขนาดตัวอักษรบน PC ใหญ่ขึ้น', async () => {
  await nf.evaluate(() => document.fonts.ready);
  const r = await nf.evaluate(async () => { await document.fonts.load('16px Sarabun', 'ก'); return { ok: document.fonts.check('16px Sarabun', 'กขค'), fam: getComputedStyle(document.body).fontFamily, size: getComputedStyle(document.documentElement).fontSize }; });
  assert.ok(r.ok, 'โหลด Sarabun ไม่สำเร็จ');
  assert.match(r.fam, /Sarabun/);
  assert.equal(r.size, '16.5px');
});

await step('[R22] เมนูด้านซ้ายบน PC + หัวเรื่องหน้า + ภาพรวม (เวรถัดไป / เวรเดือนนี้ / รอบการจอง)', async () => {
  await adm.click('#side-nav [data-tab="settings"]');
  await adm.check('#set-self-pin');
  await adm.click('#set-save');
  await expectToast(adm, /บันทึกการตั้งค่าแล้ว/);
  await firstLogin(nf, 'มานะ', 'มานะ', '5307');
  assert.ok(await nf.isVisible('#sidebar'));
  assert.match(await nf.textContent('#side-foot'), /มานะ ขยันยิ่ง/);
  assert.equal(await nf.textContent('#page-name'), 'ปฏิทินจองเวร');
  assert.ok(await nf.isHidden('#user-dock'), 'PC ไม่แสดงเมนูล่าง');
  await nf.waitForFunction(() => document.getElementById('kpi-next'));
  assert.match(await nf.textContent('#kpi-round'), /ปิดรับจอง|เปิดรับจอง|เหลืออีก/);
  assert.match(await nf.textContent('#kpi-month'), /\d+ วัน · \d+ ช่วง/);
});

await step('[R23] จองหลายวันพร้อมกัน: เลือกวันธรรมดา 3 วัน กันเลือกปนเสาร์-อาทิตย์ แล้วบันทึกครั้งเดียว', async () => {
  await nf.click('#cal-next'); await idle(nf);
  assert.equal(await nf.textContent('#cal-title'), 'ธันวาคม 2569');
  await nf.check('#multi-toggle');
  for (const d of ['21', '22', '23']) await nf.click('#calendar .cal-day[data-date="2026-12-' + d + '"]');
  await nf.click('#calendar .cal-day[data-date="2026-12-26"]');
  await expectToast(nf, /ประเภทเดียวกัน/);
  await nf.click('#calendar .cal-day[data-date="2026-12-22"]');
  await nf.click('#calendar .cal-day[data-date="2026-12-22"]');
  assert.equal(await nf.locator('#calendar .cal-day.is-picked').count(), 3);
  assert.match(await nf.textContent('#btn-book-multi'), /3 วัน/);
  await nf.click('#btn-book-multi');
  await nf.waitForSelector('#dlg-booking[open]');
  assert.match(await nf.textContent('#booking-title'), /จองหลายวัน \(3 วัน\)/);
  await nf.selectOption('#booking-room', 'ห้องเจาะเลือดอาคารผู้ป่วยนอก OPD');
  await nf.selectOption('#booking-station', 'จุดเจาะเลือด');
  await nf.check('#booking-slots input[value="06:00-08:30"]');
  await nf.check('#booking-slots input[value="08:30-12:30"]');
  await nf.click('#booking-submit');
  await expectToast(nf, /บันทึกการจอง 3 วัน/);
  assert.ok(!(await nf.isChecked('#multi-toggle')), 'ออกจากโหมดเลือกหลายวันอัตโนมัติ');
  for (const d of ['21', '22', '23']) assert.match(await nf.locator('#calendar .cal-day[data-date="2026-12-' + d + '"]').textContent(), /OPD เช้า·สาย/);
  // บางวันซ้ำ → บันทึกเฉพาะวันที่ผ่าน และแจ้งรายการที่ไม่สำเร็จ
  await nf.check('#multi-toggle');
  for (const d of ['23', '24']) await nf.click('#calendar .cal-day[data-date="2026-12-' + d + '"]');
  await nf.click('#btn-book-multi');
  await nf.selectOption('#booking-room', 'ห้องเจาะเลือด SMC');
  await nf.selectOption('#booking-station', 'จุดเจาะเลือด');
  await nf.check('#booking-slots input[value="06:00-08:30"]');
  await nf.click('#booking-submit');
  await nf.waitForSelector('#dlg-ask[open]');
  assert.match(await nf.textContent('#ask-text'), /23 ธันวาคม 2569: พบการจองซ้ำซ้อน/);
  await nf.click('#ask-ok');
  await expectToast(nf, /บันทึกการจอง 1 วัน \(ไม่สำเร็จ 1 วัน\)/);
  await nf.screenshot({ path: path.join(OUT, 'pc-multi.png') });
});

await step('[R24] เพิ่มเวรลงปฏิทินมือถือ (.ics) ได้ไฟล์ที่ถูกต้อง', async () => {
  await nf.click('#btn-summary');
  await nf.waitForSelector('#dlg-summary[open]');
  const [dl] = await Promise.all([nf.waitForEvent('download'), nf.click('#summary-ics')]);
  assert.equal(dl.suggestedFilename(), 'BRS-my-shifts.ics');
  const f = path.join(OUT, 'my.ics'); await dl.saveAs(f);
  const ics = fs.readFileSync(f, 'utf8');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.match(ics, /DTSTART:20261220T230000Z/, '06:00 น. เวลาไทย = 23:00 UTC ของวันก่อน');
  assert.match(ics, /DTEND:20261221T053000Z/, '12:30 น. เวลาไทย');
  await nf.click('#dlg-summary [data-close]');
});

await step('[R25] วันปิดรับอัตโนมัติ: ผู้ดูแลตั้งวันที่ → ผู้ใช้เห็นนับถอยหลัง', async () => {
  await adm.click('#side-nav [data-tab="settings"]');
  await adm.fill('#set-close-at', '2026-11-10');
  await adm.click('#set-save');
  await expectToast(adm, /บันทึกการตั้งค่าแล้ว/);
  await nf.reload(); await nf.waitForSelector('#view-user:not([hidden])');
  await nf.waitForFunction(() => /เหลืออีก 6 วัน/.test(document.getElementById('kpi-round').textContent));
  assert.match(await nf.textContent('#kpi-round'), /ปิดรับจอง 10 พฤศจิกายน 2569/);
  await adm.click('#set-close-clear');
  await adm.click('#set-save');
  await expectToast(adm, /บันทึกการตั้งค่าแล้ว/);
  await nf.waitForTimeout(300);
  await nf.screenshot({ path: path.join(OUT, 'pc-user-v2.png') });
  assert.deepEqual(await nf.evaluate(() => window.__csp), []);
});

await step('[R30] ผู้ดูแล: กรองช่วงวันที่ข้ามเดือน + ช่วงเวลา, มุมมองตารางเวร, รายชื่อคนยังไม่จอง และ Export ตามตัวกรอง', async () => {
  await adm.click('#side-nav [data-tab="roster"]');
  await adm.fill('#f-from', '2026-11-01'); await adm.fill('#f-to', '2026-12-31');
  await adm.click('#f-range-apply');
  await expectToast(adm, /แสดงข้อมูล 1 พฤศจิกายน 2569 – 31 ธันวาคม 2569/);
  assert.equal(await adm.textContent('#adm-title'), '1 พฤศจิกายน 2569 – 31 ธันวาคม 2569');
  assert.match(await adm.textContent('#adm-table'), /ธ\. ?|ธ\/|\/12\/69/);
  await adm.selectOption('#f-slot', '4');
  const rows = await adm.$$eval('#adm-table tbody tr', (r) => r.map((x) => x.textContent));
  assert.ok(rows.length > 0 && rows.every((x) => /06:00-สิ้นสุด/.test(x)), 'กรองเฉพาะช่วงดึก/ทั้งวัน: ' + rows.length);
  await adm.selectOption('#f-slot', '');
  await adm.click('#roster-views [data-view="grid"]');
  assert.ok(await adm.isVisible('#pane-grid'));
  assert.equal(await adm.locator('#adm-grid tbody tr').count(), 61, 'ทุกวันในช่วง 61 วัน');
  assert.match(await adm.textContent('#adm-grid thead'), /OPD.*เช้า/);
  assert.match(await adm.textContent('#adm-grid'), /สมชาย/);
  await adm.screenshot({ path: path.join(OUT, 'pc-admin-grid.png') });
  await adm.click('#roster-views [data-view="missing"]');
  assert.match(await adm.textContent('#pane-missing'), /ใหม่ ล่าสุด/);
  assert.match(await adm.textContent('#adm-stats'), /ยังไม่จอง \d+ คน/);
  await adm.selectOption('#f-position', 'นักเทคนิคการแพทย์(MT Parttime)');
  assert.doesNotMatch(await adm.textContent('#pane-missing'), /ใหม่ ล่าสุด/, 'กรองตามตำแหน่ง');
  await adm.screenshot({ path: path.join(OUT, 'pc-admin-missing.png') });
  const [dl] = await Promise.all([adm.waitForEvent('download'), adm.click('#adm-excel')]);
  assert.equal(dl.suggestedFilename(), 'BRS-roster-2026-11-01_2026-12-31.xlsx');
  const f = path.join(OUT, 'export-range.xlsx'); await dl.saveAs(f);
  const wb = XLSX.readFile(f);
  const main = XLSX.utils.sheet_to_json(wb.Sheets['ตารางเวร']);
  assert.ok(main.length > 0 && main.every((r) => r['ตำแหน่ง'] === 'นักเทคนิคการแพทย์(MT Parttime)'), 'Export เฉพาะตำแหน่งที่กรอง');
  const grid = XLSX.utils.sheet_to_json(wb.Sheets['ตารางเวร (ตาราง)'], { header: 1 });
  assert.equal(grid[1][0], '1 พฤศจิกายน 2569'); assert.equal(grid[grid.length - 1][0], '31 ธันวาคม 2569', 'Export ข้ามเดือน');
  const miss = XLSX.utils.sheet_to_json(wb.Sheets['ยังไม่จอง']);
  assert.ok(miss.every((r) => r['ตำแหน่ง'] === 'นักเทคนิคการแพทย์(MT Parttime)'));
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['ตารางเวร (ตาราง)'], { header: 1 }).length, 62);
  await expectToast(adm, /ดาวน์โหลดไฟล์ Excel แล้ว/);
  await adm.selectOption('#f-position', '');
  await adm.click('#roster-views [data-view="list"]');
  await adm.click('#f-range-clear');
  await idle(adm);
  assert.equal(await adm.textContent('#adm-title'), 'พฤศจิกายน 2569');
});

await step('[R31] ดึงวันหยุดนักขัตฤกษ์จาก Google แล้วบันทึก (ข้ามวันสำคัญที่ไม่ใช่วันหยุด)', async () => {
  await adm.click('#side-nav [data-tab="holidays"]');
  await adm.selectOption('#hol-year', '2027');
  await adm.click('#hol-fetch');
  await expectToast(adm, /เพิ่มใหม่ 1 วัน \(ข้ามวันสำคัญที่ไม่ใช่วันหยุด 1 วัน\)/);
  assert.equal(await adm.locator('#hol-table input[value="2027-03-15"]').count(), 1);
  await adm.click('#hol-save');
  await expectToast(adm, /บันทึกวันหยุด 28 วัน/);
});

console.log('E2E: มือถือ / แท็บเล็ต');
const DEV = [
  { name: 'iphone-se', d: devices['iPhone SE'], who: 'ปิติ', pin: '8024', mobile: true },
  { name: 'pixel-7', d: devices['Pixel 7'], who: 'ชูใจ', pin: '9173', mobile: true },
  { name: 'ipad-mini', d: devices['iPad Mini'], who: 'ใหม่', pin: '6402', mobile: true }
];
// ตอนนี้ปิดการตั้ง PIN เองอยู่ → เปิดกลับเพื่อทดสอบผู้ใช้ใหม่บนมือถือ
await adm.click('#side-nav [data-tab="settings"]');
await adm.check('#set-self-pin');
await adm.click('#set-save');
await expectToast(adm, /บันทึกการตั้งค่าแล้ว/);
for (const v of DEV) {
  const m = await newPage(Object.assign({}, v.d));
  await step(v.name + ': ใช้งานครบด้วยการแตะ ไม่มี scroll แนวนอน ปุ่มใหญ่พอ ช่องกรอกไม่ทำให้ซูม', async () => {
    await m.goto(BASE);
    await m.waitForSelector('#view-login:not([hidden])');
    await noHScroll(m);
    await m.waitForTimeout(500);
    await m.screenshot({ path: path.join(OUT, v.name + '-login.png'), fullPage: true });
    const fonts = await m.$$eval('#view-login input', (els) => els.filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize)));
    assert.ok(fonts.every((f) => f >= 16), 'ขนาดตัวอักษรช่องกรอก ' + fonts);
    await firstLogin(m, v.who, v.who, v.pin);
    await noHScroll(m);
    const isPhone = m.viewportSize().width < 1024;
    if (isPhone) assert.ok(await m.isVisible('#user-dock'), 'มีแถบเมนูล่างบนมือถือ/แท็บเล็ต');
    const box = await m.locator('#calendar').boundingBox();
    await m.evaluate(({ x, y }) => {
      const el = document.getElementById('calendar');
      const t = (cx) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [t(x + 120)], touches: [t(x + 120)], bubbles: true }));
      el.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t(x - 60)], touches: [], bubbles: true }));
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await m.waitForFunction(() => document.getElementById('cal-title').textContent === 'ธันวาคม 2569');
    await idle(m);
    await m.locator('#calendar .cal-day[data-date="2026-12-03"]').tap();
    await m.waitForTimeout(600);
    await m.screenshot({ path: path.join(OUT, v.name + '-user.png'), fullPage: true });
    const small = await m.$$eval('#view-user .btn', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 36).map((e) => e.id || e.textContent.trim()));
    assert.deepEqual(small, [], 'ปุ่มเล็กเกินไปสำหรับนิ้ว: ' + JSON.stringify(small));
    await m.locator('#btn-book').tap();
    await m.waitForSelector('#dlg-booking[open]');
    await m.selectOption('#booking-room', 'ห้องเจาะเลือด SMC');
    await m.selectOption('#booking-station', 'จุดเจาะเลือด');
    await m.locator('#booking-slots label').first().tap();
    await m.waitForTimeout(400);
    const vh = m.viewportSize().height;
    const btn = await m.locator('#booking-submit').boundingBox();
    assert.ok(btn.y + btn.height <= vh, 'ปุ่มบันทึกอยู่ในจอ ' + JSON.stringify(btn) + ' vh=' + vh);
    await m.screenshot({ path: path.join(OUT, v.name + '-booking.png') });
    await m.locator('#booking-submit').tap();
    await expectToast(m, /บันทึกการจองสำเร็จ/);
    await m.waitForFunction(() => /OPD|SMC|กว\./.test(document.getElementById('kpi-next').textContent));
    await noHScroll(m);
    if (isPhone) {
      await m.locator('#dock-summary').tap();
      await m.waitForSelector('#dlg-summary[open]');
      await m.waitForTimeout(400);
      const close = await m.locator('#dlg-summary [data-close]').boundingBox();
      assert.ok(close.y + close.height <= vh, 'ปุ่มปิดในหน้าสรุปอยู่ในจอ');
      await m.screenshot({ path: path.join(OUT, v.name + '-summary.png') });
      await m.locator('#dlg-summary [data-close]').tap();
      await m.locator('#dock-logout').tap();
    } else {
      await m.click('#btn-logout');
    }
    await m.waitForSelector('#view-login:not([hidden])');
    await m.click('#btn-open-admin');
    await m.fill('#adm-user', 'admin'); await m.fill('#adm-pass', 'admin1234');
    await m.click('#admin-login-form button[type=submit]');
    await m.waitForSelector('#view-admin:not([hidden])');
    await noHScroll(m);
    if (m.viewportSize().width < 768) assert.ok(await m.locator('#adm-cards [data-aedit]').count() > 0, 'มือถือแสดงรายการเป็นการ์ด');
    await m.waitForTimeout(400);
    await m.screenshot({ path: path.join(OUT, v.name + '-admin.png'), fullPage: true });
    await m.click('#btn-admin-logout');
    await m.waitForSelector('#view-login:not([hidden])');
    assert.deepEqual(await m.evaluate(() => window.__csp), []);
  });
}

await step('ไม่มี JavaScript error ในหน้าเว็บ', async () => { assert.deepEqual(errors, []); });

await browser.close();
server.kill();
const failed = results.filter((r) => r[0] !== 'ok');
console.log('\nE2E: ผ่าน ' + (results.length - failed.length) + '/' + results.length);
process.exit(failed.length ? 1 : 0);
