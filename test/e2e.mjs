// ทดสอบหน้าเว็บทั้งหมดด้วย Playwright + Apps Script จำลอง: node test/e2e.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/npm-tools/node_modules/playwright'); }
const XLSX = require('xlsx');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test/output');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 3911;
const BASE = 'http://localhost:' + PORT;

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('  ✓ ' + name); } catch (e) { results.push(['FAIL', name, e]); console.log('  ✗ ' + name + '\n    ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); }
}

const server = spawn(process.execPath, [path.join(ROOT, 'dev/server.mjs')], { env: Object.assign({}, process.env, { PORT: String(PORT), MOCK_NOW: '2026-11-04T09:00:00+07:00', GAS_URL: '' }), stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));

const browser = await playwright.chromium.launch();
const errors = [];
async function newPage(opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 }, acceptDownloads: true }, opts || {}));
  // ไม่ให้ไปโหลดฟอนต์จากอินเทอร์เน็ตระหว่างทดสอบ
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.dismiss());
  await page.addInitScript(() => { window.__printed = []; window.print = () => { window.__printed.push(document.getElementById('print-area').innerHTML); }; });
  return page;
}
async function expectToast(page, re) {
  try {
    await page.waitForFunction((src) => Array.from(document.querySelectorAll('.toast')).some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 8000 });
  } catch (e) {
    const all = await page.$$eval('.toast', (ts) => ts.map((t) => t.textContent));
    throw new Error('ไม่พบ toast ' + re + ' — มี: ' + JSON.stringify(all));
  }
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove()));
}
const idle = (page) => page.waitForFunction(() => document.getElementById('busy').hidden);
const day = (page, d) => page.locator('#calendar .day[data-date="2026-11-' + String(d).padStart(2, '0') + '"]');
async function pick(page, q, name) {
  await page.fill('#staff-search', q);
  await page.locator('#staff-options .combo-item', { hasText: name }).click();
}
async function noHScroll(page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w[0] <= w[1] + 1, 'มี scroll แนวนอน ' + w);
}

console.log('E2E: ผู้ใช้');
const page = await newPage();
await page.goto(BASE);

await step('หน้าเข้าสู่ระบบโหลดได้ และแสดงประกาศ', async () => {
  await page.waitForSelector('#view-login:not([hidden])');
  assert.match(await page.textContent('#notice-login'), /วันที่ 26/);
  assert.match(await page.textContent('#app-title'), /ระบบจองเวร/);
});

await step('ค้นหาชื่อ เลือกชื่อ และตั้ง PIN ครั้งแรก', async () => {
  await page.fill('#staff-search', 'zzz');
  assert.match(await page.textContent('#staff-options'), /ไม่พบชื่อ/);
  await page.fill('#staff-search', 'สม');
  assert.equal(await page.locator('#staff-options .combo-item').count(), 2);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  assert.match(await page.textContent('#staff-picked'), /สมชาย ทดสอบดี/);
  assert.ok(await page.isVisible('#pin-setup-block'));
  await page.fill('#setup-pin', '1234'); await page.fill('#setup-pin2', '1235');
  await page.click('#btn-setpin');
  await expectToast(page, /ไม่ตรงกัน/);
  await page.fill('#setup-pin2', '1234');
  await page.click('#btn-setpin');
  await page.waitForSelector('#view-user:not([hidden])');
  assert.match(await page.textContent('#hello'), /สมชาย ทดสอบดี/);
});

await step('ปฏิทินแสดงเดือน พ.ย. 2569 เวรที่จองไว้ วันหยุด และสถานะเปิดรับ', async () => {
  assert.equal(await page.textContent('#cal-title'), 'พฤศจิกายน 2569');
  assert.match(await page.textContent('#month-status'), /เปิดรับจอง/);
  assert.match(await day(page, 3).textContent(), /OPD เช้า·สาย·บ่าย/);
  assert.match(await day(page, 7).textContent(), /OPD ทั้งวัน/);
  assert.ok(await day(page, 4).evaluate((e) => e.classList.contains('today')));
  assert.ok(await day(page, 7).evaluate((e) => e.classList.contains('sat')));
  assert.ok(await day(page, 2).evaluate((e) => e.classList.contains('past')));
  await page.screenshot({ path: path.join(OUT, 'user-desktop.png'), fullPage: true });
});

await step('วันที่ผ่านมา: ดูได้แต่จอง/ยกเลิกไม่ได้', async () => {
  await day(page, 3).click();
  assert.match(await page.textContent('#day-panel'), /วันอังคารที่ 3 พฤศจิกายน 2569/);
  assert.ok(await page.isDisabled('#btn-book'));
  assert.equal(await page.locator('#day-panel [data-cancel]').count(), 0);
});

await step('จองวันธรรมดาหลายช่วง', async () => {
  await day(page, 12).click();
  assert.match(await page.textContent('#day-panel'), /วันธรรมดา/);
  await page.click('#btn-book');
  await page.waitForSelector('#dlg-booking[open]');
  assert.equal(await page.locator('#booking-slots input[type=checkbox]').count(), 4);
  await page.click('#booking-submit');
  await expectToast(page, /ห้องและจุด/);
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
  assert.match(await page.textContent('#day-panel'), /ยกเลิกการจอง: OPD .*ติดธุระ/);
});

await step('สรุปเวรของฉัน (เดือน / ล่วงหน้า) และพิมพ์', async () => {
  await page.click('#btn-summary');
  await page.waitForSelector('#dlg-summary[open]');
  const txt = await page.textContent('#summary-content');
  assert.match(txt, /5วัน/);
  assert.match(txt, /8ช่วงเวร/);
  assert.match(txt, /1ลา\/ยกเลิก/);
  await page.click('#summary-seg [data-mode="upcoming"]');
  await idle(page);
  assert.match(await page.textContent('#summary-content'), /ตั้งแต่ 4 พฤศจิกายน 2569/);
  assert.match(await page.textContent('#summary-content'), /3วัน/);
  await page.click('#summary-print');
  const printed = await page.evaluate(() => window.__printed.pop());
  assert.match(printed, /สรุปเวรที่จอง — สมชาย ทดสอบดี/);
  await page.screenshot({ path: path.join(OUT, 'user-summary.png') });
  await page.click('#dlg-summary [data-close]');
});

await step('เปลี่ยนเดือน', async () => {
  await page.click('#cal-next');
  await idle(page);
  assert.equal(await page.textContent('#cal-title'), 'ธันวาคม 2569');
  assert.match(await page.locator('#calendar .day[data-date="2026-12-07"]').textContent(), /ชดเชยวันพ่อ/);
  await page.locator('#calendar .day[data-date="2026-12-07"]').click();
  assert.match(await page.textContent('#day-panel'), /วันหยุดราชการ — เลือกได้ 1 ช่วง/);
  await page.click('#cal-prev');
  await idle(page);
});

await step('เปลี่ยน PIN, ออกจากระบบ, เข้าใหม่ด้วย PIN ใหม่, PIN ผิดแจ้งเตือน', async () => {
  await page.click('#btn-change-pin');
  await page.fill('#pin-old', '1234'); await page.fill('#pin-new', '5678'); await page.fill('#pin-new2', '5678');
  await page.click('#pin-form button[type=submit]');
  await expectToast(page, /เปลี่ยน PIN เรียบร้อย/);
  await page.reload();
  await page.waitForSelector('#view-user:not([hidden])');
  await page.click('#btn-logout');
  await page.waitForSelector('#view-login:not([hidden])');
  await pick(page, 'ทดสอบดี', 'สมชาย');
  assert.ok(await page.isVisible('#pin-login-block'));
  await page.fill('#login-pin', '1234');
  await page.press('#login-pin', 'Enter');
  await expectToast(page, /PIN ไม่ถูกต้อง/);
  await page.fill('#login-pin', '5678');
  await page.click('#btn-login');
  await page.waitForSelector('#view-user:not([hidden])');
  await page.click('#btn-logout');
});

await step('ขอเพิ่มรายชื่อ', async () => {
  await page.click('#btn-open-request');
  await page.fill('#req-first', "แอน'นา");
  await page.fill('#req-last', 'ทดลอง "ใหม่"');
  await page.selectOption('#req-position', 'นักเทคนิคการแพทย์(MT Parttime)');
  await page.fill('#req-pin', '1111'); await page.fill('#req-pin2', '1111');
  await page.click('#request-form button[type=submit]');
  await page.waitForSelector('#dlg-ask[open]');
  assert.match(await page.textContent('#ask-title'), /ส่งคำขอเรียบร้อย/);
  await page.click('#ask-ok');
});

console.log('E2E: ผู้ดูแล');
const adm = await newPage();
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

await step('ตารางเวรรวม สถิติ และตัวกรอง', async () => {
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
  await adm.screenshot({ path: path.join(OUT, 'admin-roster.png'), fullPage: true });
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

await step('ผู้ดูแลแก้ไข และบันทึกเป็นลาเวร', async () => {
  const row = adm.locator('#adm-table tr', { hasText: 'ปิติ ยินดี' }).filter({ hasText: '06:00-12:00' });
  await row.locator('[data-aedit]').click();
  await adm.selectOption('#booking-station', 'จุดลงทะเบียนรายการตรวจ');
  await adm.click('#booking-submit');
  await expectToast(adm, /แก้ไขการจองสำเร็จ/);
  await adm.locator('#adm-table tr', { hasText: 'ปิติ ยินดี' }).filter({ hasText: '06:00-12:00' }).locator('[data-adel]').click();
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
  assert.deepEqual(wb.SheetNames, ['ตารางเวร', 'สรุปรายวัน', 'สรุปรายบุคคล', 'ลา-ยกเลิก']);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['ตารางเวร'], { header: 1 });
  assert.equal(rows.length, 12);
  assert.deepEqual(rows[0].slice(8), ['เช้า', 'สาย', 'บ่าย', 'นอกเวลาเย็น', 'ดึก']);
  const per = XLSX.utils.sheet_to_json(wb.Sheets['สรุปรายบุคคล']);
  const som = per.find((r) => r['ชื่อ-นามสกุล'] === 'สมชาย ทดสอบดี');
  assert.equal(som['จำนวนวัน'], 5); assert.equal(som['จำนวนช่วงเวร'], 8);
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['ลา-ยกเลิก']).length, 2);
});

await step('พิมพ์ / PDF ตารางเวร', async () => {
  await adm.click('#adm-pdf');
  const printed = await adm.evaluate(() => window.__printed.pop());
  assert.match(printed, /ตารางเวร/);
  assert.match(printed, /วันจันทร์ที่ 2 พฤศจิกายน 2569/);
  await adm.evaluate((h) => { document.getElementById('print-area').innerHTML = h; }, printed);
  await adm.emulateMedia({ media: 'print' });
  await adm.screenshot({ path: path.join(OUT, 'admin-print.png'), fullPage: true });
  await adm.pdf({ path: path.join(OUT, 'roster.pdf'), format: 'A4', landscape: true });
  await adm.emulateMedia({ media: 'screen' });
});

await step('บุคลากร: อนุมัติคำขอ แก้ไข รีเซ็ต PIN และเพิ่มคนใหม่', async () => {
  await adm.click('#admin-tabs [data-tab="staff"]');
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
  await adm.screenshot({ path: path.join(OUT, 'admin-staff.png'), fullPage: true });
});

await step('วันหยุด: เพิ่ม แก้ ลบ และบันทึก', async () => {
  await adm.click('#admin-tabs [data-tab="holidays"]');
  assert.equal(await adm.inputValue('#hol-year'), '2026');
  assert.equal(await adm.locator('#hol-table tbody tr').count(), 4);
  await adm.click('#hol-add');
  await adm.click('#hol-save');
  await expectToast(adm, /ยังไม่ได้เลือกวันที่/);
  await adm.fill('#hol-table [data-hdate="0"]', '2026-11-20');
  await adm.dispatchEvent('#hol-table [data-hdate="0"]', 'change');
  await adm.fill('#hol-table [data-hname="0"]', 'วันหยุดพิเศษตามมติ ครม.');
  await adm.locator('#hol-table tr', { hasText: '' }).filter({ has: adm.locator('input[value="2026-12-31"]') }).locator('[data-hdel]').click();
  await adm.click('#hol-save');
  await expectToast(adm, /บันทึกวันหยุด 25 วัน/);
  await adm.selectOption('#hol-year', '2027');
  assert.equal(await adm.locator('#hol-table tbody tr').count(), 21);
  await adm.selectOption('#hol-year', '2026');
  await adm.screenshot({ path: path.join(OUT, 'admin-holidays.png'), fullPage: true });
});

await step('ตั้งค่า: ปิดรอบเดือน พ.ย. (เปิดเฉพาะ ธ.ค.) และแก้ประกาศ', async () => {
  await adm.click('#admin-tabs [data-tab="settings"]');
  assert.ok(await adm.isChecked('#set-open'));
  assert.match(await adm.textContent('#set-months'), /ทุกเดือน/);
  await adm.click('#set-month-add');
  await expectToast(adm, /กรุณาเลือกเดือน/);
  await adm.fill('#set-month-input', '2026-12');
  await adm.click('#set-month-add');
  assert.match(await adm.textContent('#set-months'), /ธันวาคม 2569/);
  await adm.fill('#set-notice', 'ส่งภายในวันที่ 20 ของเดือน');
  await adm.click('#set-save');
  await expectToast(adm, /บันทึกการตั้งค่าแล้ว/);
  await adm.screenshot({ path: path.join(OUT, 'admin-settings.png'), fullPage: true });
});

await step('ผู้ใช้เห็นวันหยุดใหม่ รอบปิด และยกเลิกต้องแจ้งลาเวรพร้อมเหตุผล', async () => {
  await page.goto(BASE);
  await page.waitForSelector('#view-login:not([hidden])');
  assert.match(await page.textContent('#notice-login'), /วันที่ 20/);
  await pick(page, 'สมหญิง', 'สมหญิง');
  await page.fill('#setup-pin', '2222'); await page.fill('#setup-pin2', '2222');
  await page.click('#btn-setpin');
  await page.waitForSelector('#view-user:not([hidden])');
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

console.log('E2E: เลย์เอาต์มือถือ/แท็บเล็ต');
for (const vp of [{ name: 'mobile', width: 375, height: 760, who: 'มานะ' }, { name: 'tablet', width: 820, height: 1100, who: 'ปิติ' }]) {
  const m = await newPage({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.name === 'mobile', hasTouch: vp.name === 'mobile' });
  await step(vp.name + ': หน้าเข้าสู่ระบบ ผู้ใช้ และผู้ดูแล ไม่มี scroll แนวนอน', async () => {
    await m.goto(BASE);
    await m.waitForSelector('#view-login:not([hidden])');
    await noHScroll(m);
    await m.screenshot({ path: path.join(OUT, vp.name + '-login.png'), fullPage: true });
    await pick(m, vp.who, vp.who);
    await m.fill('#setup-pin', '3333'); await m.fill('#setup-pin2', '3333');
    await m.click('#btn-setpin');
    await m.waitForSelector('#view-user:not([hidden])');
    await m.locator('#calendar .day[data-date="2026-11-05"]').click();
    await noHScroll(m);
    await m.screenshot({ path: path.join(OUT, vp.name + '-user-nov.png'), fullPage: true });
    await m.click('#cal-next');
    await idle(m);
    await m.locator('#calendar .day[data-date="2026-12-03"]').click();
    await noHScroll(m);
    await m.screenshot({ path: path.join(OUT, vp.name + '-user.png'), fullPage: true });
    await m.click('#btn-book');
    await m.screenshot({ path: path.join(OUT, vp.name + '-booking.png') });
    await m.click('#dlg-booking [data-close]');
    await m.click('#btn-logout');
    await m.click('#btn-open-admin');
    await m.fill('#adm-user', 'admin'); await m.fill('#adm-pass', 'admin1234');
    await m.click('#admin-login-form button[type=submit]');
    await m.waitForSelector('#view-admin:not([hidden])');
    await noHScroll(m);
    await m.screenshot({ path: path.join(OUT, vp.name + '-admin.png'), fullPage: true });
    await m.click('#btn-admin-logout');
    await m.waitForSelector('#view-login:not([hidden])');
  });
}

await step('ไม่มี JavaScript error ในหน้าเว็บ', async () => { assert.deepEqual(errors, []); });

await browser.close();
server.kill();
const failed = results.filter((r) => r[0] !== 'ok');
console.log('\nE2E: ผ่าน ' + (results.length - failed.length) + '/' + results.length);
process.exit(failed.length ? 1 : 0);
