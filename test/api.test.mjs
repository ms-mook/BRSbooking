// ทดสอบ Code.gs (ตรรกะหลังบ้าน) ผ่าน Apps Script จำลอง: node --test test/api.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from '../dev/gas-mock.mjs';
import { bookingRows, LEAVE_HEADER } from '../dev/fixture.mjs';

const NOW = '2026-11-04T09:00:00+07:00';
function fresh(props) {
  return createGas({
    now: NOW,
    props: props || { ADMIN_USER: 'admin', ADMIN_PASS: 'secret-pass' },
    sheets: { 'Booking Data': bookingRows(), Leave: [LEAVE_HEADER] }
  });
}
const ok = (r) => { assert.equal(r.ok, true, 'expected ok but got: ' + r.error); return r.data; };
const err = (r, code) => { assert.equal(r.ok, false, 'expected error ' + code); if (code) assert.equal(r.code, code, r.error); return r; };
function staffId(gas, first) { return ok(gas.call('getPublicInfo')).staff.find((s) => s.name.startsWith(first)).id; }
function loginAs(gas, first, pin = '1234') {
  const id = staffId(gas, first);
  const r = gas.call('login', { staffId: id, pin });
  if (!r.ok && r.code === 'NO_PIN') return ok(gas.call('setFirstPin', { staffId: id, pin })).token;
  return ok(r).token;
}
function admin(gas) { return ok(gas.call('adminLogin', { username: 'admin', password: 'secret-pass' })).token; }

test('schema: เพิ่มคอลัมน์ ID, สร้างแท็บใหม่, seed รายชื่อจากข้อมูลเดิม', () => {
  const gas = fresh();
  const info = ok(gas.call('getPublicInfo'));
  const b = gas.values('Booking Data');
  assert.equal(b[0][12], 'ID');
  assert.deepEqual(b[0].slice(0, 12), bookingRows()[0], 'คอลัมน์ A–L ต้องเหมือนเดิม');
  assert.ok(b.slice(1).every((r) => /^B[0-9a-f]{12}$/.test(r[12])));
  assert.equal(gas.values('Leave')[0][15], 'ดำเนินการโดย');
  assert.equal(info.staff.length, 5);
  assert.ok(info.staff.some((s) => s.name === 'สมหญิง ใจงาม'), 'ตัดช่องว่างท้ายชื่อ');
  assert.ok(info.staff.every((s) => s.hasPin === false));
  assert.equal(info.holidays.find((h) => h.date === '2026-12-07').name, 'ชดเชยวันพ่อแห่งชาติ');
  assert.equal(info.settings.bookingOpen, true);
  assert.equal(info.today, '2026-11-04');
  const json = JSON.stringify(info);
  assert.ok(!/hash|salt/i.test(json), 'ไม่ส่ง hash/salt ออกไป');
});

test('API: whitelist, รูปแบบคำขอ, API_SECRET', () => {
  const gas = fresh();
  ['setup', 'ensureSchema_', 'hashPin_', 'readStaff_', 'constructor', '__proto__', 'toString'].forEach((fn) => err(gas.call(fn), 'BAD_REQUEST'));
  err(gas.rawPost('not json'), 'BAD_REQUEST');
  err(gas.rawPost('[1,2]'), 'BAD_REQUEST');
  err(gas.rawPost(JSON.stringify({ fn: 'getPublicInfo', pad: 'x'.repeat(70000) })), 'BAD_REQUEST');
  ok(gas.call('getPublicInfo', [1, 2]));
  const sec = fresh({ ADMIN_USER: 'admin', ADMIN_PASS: 'secret-pass', API_SECRET: 's3' });
  err(sec.call('getPublicInfo'), 'FORBIDDEN');
  err(sec.call('getPublicInfo', {}, { secret: 'wrong' }), 'FORBIDDEN');
  ok(sec.call('getPublicInfo', {}, { secret: 's3' }));
});

test('PIN: ตั้งครั้งแรก, เข้าสู่ระบบ, ล็อกเมื่อผิด 5 ครั้ง, เปลี่ยน PIN', () => {
  const gas = fresh();
  const id = staffId(gas, 'สมชาย');
  err(gas.call('login', { staffId: id, pin: '1234' }), 'NO_PIN');
  err(gas.call('setFirstPin', { staffId: id, pin: '12' }), 'BAD_REQUEST');
  err(gas.call('setFirstPin', { staffId: id, pin: 'abcd' }), 'BAD_REQUEST');
  const t = ok(gas.call('setFirstPin', { staffId: id, pin: '1234' })).token;
  assert.ok(t.length >= 32);
  err(gas.call('setFirstPin', { staffId: id, pin: '9999' }), 'HAS_PIN');
  const staffRow = gas.values('Staff').find((r) => r[0] === id);
  assert.ok(staffRow[5].length === 64 && staffRow[5] !== '1234', 'เก็บ hash ไม่เก็บ PIN จริง');
  for (let i = 0; i < 5; i++) err(gas.call('login', { staffId: id, pin: '0000' }), 'AUTH');
  err(gas.call('login', { staffId: id, pin: '1234' }), 'LOCKED');
  // คนอื่นยังเข้าได้ (ไม่ล็อกทั้งระบบ)
  loginAs(gas, 'มานะ');
  gas.advance(16 * 60 * 1000);
  const t2 = ok(gas.call('login', { staffId: id, pin: '1234' })).token;
  err(gas.call('changePin', { token: t2, oldPin: '1111', newPin: '5678' }), 'AUTH');
  const t3 = ok(gas.call('changePin', { token: t2, oldPin: '1234', newPin: '5678' })).token;
  err(gas.call('getMyBookings', { token: t2, month: '2026-11' }), 'SESSION');
  ok(gas.call('getMyBookings', { token: t3, month: '2026-11' }));
  ok(gas.call('login', { staffId: id, pin: '5678' }));
  ok(gas.call('logout', { token: t3 }));
  err(gas.call('getMyBookings', { token: t3, month: '2026-11' }), 'SESSION');
});

test('session หมดอายุใน 6 ชั่วโมง', () => {
  const gas = fresh();
  const t = loginAs(gas, 'สมชาย');
  gas.advance(5 * 3600 * 1000);
  ok(gas.call('getMyBookings', { token: t, month: '2026-11' }));
  gas.advance(1.1 * 3600 * 1000);
  err(gas.call('getMyBookings', { token: t, month: '2026-11' }), 'SESSION');
});

test('getMyBookings: เฉพาะของตัวเอง ตามเดือน และล่วงหน้า', () => {
  const gas = fresh();
  const t = loginAs(gas, 'สมชาย');
  const nov = ok(gas.call('getMyBookings', { token: t, month: '2026-11' }));
  assert.equal(nov.bookings.length, 3);
  assert.ok(nov.bookings.every((b) => b.firstName === 'สมชาย'));
  assert.deepEqual(nov.bookings.map((b) => b.date), ['2026-11-02', '2026-11-03', '2026-11-07']);
  assert.deepEqual(nov.bookings[1].slots, ['06:00-08:30', '08:30-12:30', '12:30-16:30']);
  assert.equal(ok(gas.call('getMyBookings', { token: t, upcoming: true })).bookings.length, 1);
  const t2 = loginAs(gas, 'สมหญิง');
  assert.equal(ok(gas.call('getMyBookings', { token: t2, month: '2026-11' })).bookings.length, 2);
  err(gas.call('getMyBookings', { token: t, month: '2026-13' }), 'BAD_REQUEST');
});

test('จองวันธรรมดา: หลายช่วง, กันซ้ำตามคอลัมน์, ต่างห้องแต่ช่วงซ้ำก็ไม่ได้', () => {
  const gas = fresh();
  const t = loginAs(gas, 'ปิติ');
  // 2026-11-10 ปิติจองครบ 4 ช่วงแล้ว
  err(gas.call('saveBooking', { token: t, date: '2026-11-10', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['12:30-16:30'] }), 'DUPLICATE');
  const r = ok(gas.call('saveBooking', { token: t, date: '2026-11-11', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['08:30-12:30', '06:00-08:30'] }));
  const row = gas.values('Booking Data').find((x) => x[12] === r.id);
  assert.equal(row[2], 'ปิติ');
  assert.equal(row[4], 'นักเทคนิคการแพทย์(MT Fulltime)งานห้องปฏิบัติการเวชศาสตร์ชันสูตร', 'ตำแหน่งมาจากรายชื่อ ไม่ใช่จากหน้าเว็บ');
  assert.ok(row[1] instanceof Date);
  assert.deepEqual(row.slice(7, 12), ['06:00-08:30', '08:30-12:30', '', '', ''], 'ลงคอลัมน์ เช้า/สาย ตามระบบเดิม');
  assert.match(row[0], /^2026\/11\/04, 09:00:00$/);
  err(gas.call('saveBooking', { token: t, date: '2026-11-11', room: 'ห้องเจาะเลือดอาคารผู้ป่วยนอก OPD', station: 'จุดเจาะเลือด', slots: ['08:30-12:30'] }), 'DUPLICATE');
  ok(gas.call('saveBooking', { token: t, date: '2026-11-11', room: 'ห้องเจาะเลือดอาคารผู้ป่วยนอก OPD', station: 'จุดเจาะเลือด', slots: ['12:30-16:30', '16:30-สิ้นสุด'] }));
  err(gas.call('saveBooking', { token: t, date: '2026-11-12', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-11:00'] }), 'BAD_REQUEST');
  err(gas.call('saveBooking', { token: t, date: '2026-11-12', room: 'ห้องไม่มีจริง', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }), 'BAD_REQUEST');
  err(gas.call('saveBooking', { token: t, date: '2026-11-12', room: 'ห้องเจาะเลือด SMC', station: 'จุดมั่ว', slots: ['06:00-08:30'] }), 'BAD_REQUEST');
  err(gas.call('saveBooking', { token: t, date: '2026-11-12', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: [] }), 'BAD_REQUEST');
  err(gas.call('saveBooking', { token: t, date: '2026-02-30', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }), 'BAD_REQUEST');
});

test('เสาร์-อาทิตย์และวันหยุดราชการ: 1 ช่วง 1 เวรต่อวัน และใช้ช่วงเวลาพิเศษ', () => {
  const gas = fresh();
  const t = loginAs(gas, 'ชูใจ');
  const sat = { token: t, date: '2026-11-14', room: 'ห้องเจาะเลือดอาคารผู้ป่วยนอก OPD', station: 'จุดเจาะเลือด' };
  err(gas.call('saveBooking', Object.assign({ slots: ['06:00-11:00', '06:00-16:00'] }, sat)), 'RULE');
  err(gas.call('saveBooking', Object.assign({ slots: ['06:00-08:30'] }, sat)), 'BAD_REQUEST');
  const r = ok(gas.call('saveBooking', Object.assign({ slots: ['06:00-16:00'] }, sat)));
  const row = gas.values('Booking Data').find((x) => x[12] === r.id);
  assert.deepEqual(row.slice(7, 12), ['', '', '06:00-16:00', '', '']);
  err(gas.call('saveBooking', Object.assign({}, sat, { room: 'ห้องเจาะเลือด SMC', slots: ['06:00-สิ้นสุด'] })), 'DUPLICATE');
  // 2026-12-07 (จันทร์) วันหยุดชดเชย → ใช้กติกาวันหยุด
  const hol = { token: t, date: '2026-12-07', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด' };
  err(gas.call('saveBooking', Object.assign({ slots: ['06:00-08:30'] }, hol)), 'BAD_REQUEST');
  const h = ok(gas.call('saveBooking', Object.assign({ slots: ['06:00-สิ้นสุด'] }, hol)));
  assert.equal(gas.values('Booking Data').find((x) => x[12] === h.id)[11], '06:00-สิ้นสุด', 'ลงคอลัมน์ ดึก');
  // ปิดกติกาวันหยุด → วันหยุดใช้ช่วงวันธรรมดา
  const at = admin(gas);
  ok(gas.call('adminSaveSettings', { token: at, settings: { BOOKING_OPEN: true, BOOKING_MONTHS: '', NOTICE: 'x', CONTACT: '1', SPECIAL_DAY_RULE: false } }));
  ok(gas.call('saveBooking', { token: t, date: '2026-12-10', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30', '08:30-12:30'] }));
});

test('แก้ไขการจอง: เฉพาะของตัวเอง, ไม่นับรายการเดิมเป็นการซ้ำ', () => {
  const gas = fresh();
  const t = loginAs(gas, 'สมชาย');
  const mine = ok(gas.call('getMyBookings', { token: t, month: '2026-11' })).bookings.find((b) => b.date === '2026-11-07');
  const before = gas.values('Booking Data').length;
  ok(gas.call('saveBooking', { token: t, id: mine.id, date: '2026-11-07', room: 'ห้องเจาะเลือด SMC', station: 'จุดลงทะเบียนรายการตรวจ', slots: ['06:00-12:00'] }));
  const rows = gas.values('Booking Data');
  assert.equal(rows.length, before, 'แก้ไขแถวเดิม ไม่เพิ่มแถว');
  const row = rows.find((x) => x[12] === mine.id);
  assert.equal(row[5], 'ห้องเจาะเลือด SMC');
  assert.deepEqual(row.slice(7, 12), ['', '06:00-12:00', '', '', '']);
  // คนอื่นแก้/ยกเลิกไม่ได้
  const t2 = loginAs(gas, 'มานะ');
  err(gas.call('saveBooking', { token: t2, id: mine.id, date: '2026-11-07', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-12:00'] }), 'FORBIDDEN');
  err(gas.call('cancelBooking', { token: t2, id: mine.id }), 'FORBIDDEN');
  err(gas.call('cancelBooking', { token: t2, id: 'Bnotexist' }), 'NOT_FOUND');
});

test('ย้อนหลังและรอบปิด: จอง/แก้ไม่ได้, ยกเลิก = ลาเวร ต้องมีเหตุผล', () => {
  const gas = fresh();
  const t = loginAs(gas, 'สมชาย');
  err(gas.call('saveBooking', { token: t, date: '2026-11-03', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['16:30-สิ้นสุด'] }), 'CLOSED');
  const past = ok(gas.call('getMyBookings', { token: t, month: '2026-11' })).bookings.find((b) => b.date === '2026-11-03');
  err(gas.call('cancelBooking', { token: t, id: past.id }), 'CLOSED');
  ok(gas.call('saveBooking', { token: t, date: '2026-11-04', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['16:30-สิ้นสุด'] }));

  const at = admin(gas);
  ok(gas.call('adminSaveSettings', { token: at, settings: { BOOKING_OPEN: true, BOOKING_MONTHS: '2026-12', NOTICE: '', CONTACT: '' } }));
  err(gas.call('saveBooking', { token: t, date: '2026-11-20', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }), 'CLOSED');
  ok(gas.call('saveBooking', { token: t, date: '2026-12-01', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }));
  const nov7 = ok(gas.call('getMyBookings', { token: t, month: '2026-11' })).bookings.find((b) => b.date === '2026-11-07');
  err(gas.call('saveBooking', { token: t, id: nov7.id, date: '2026-12-02', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }), 'CLOSED');
  err(gas.call('cancelBooking', { token: t, id: nov7.id }), 'NEED_REASON');
  assert.equal(ok(gas.call('cancelBooking', { token: t, id: nov7.id, reason: 'ป่วย' })).type, 'ลาเวร');
  const leave = gas.values('Leave').find((r) => r[12] === nov7.id);
  assert.equal(leave[13], 'ลาเวร'); assert.equal(leave[14], 'ป่วย'); assert.equal(leave[15], 'สมชาย ทดสอบดี');
  assert.equal(leave[11], '06:00-สิ้นสุด', 'คงช่วงเวลาไว้ในคอลัมน์เดิม');
  assert.ok(!gas.values('Booking Data').some((r) => r[12] === nov7.id), 'ลบออกจาก Booking Data');
  const dec = ok(gas.call('getMyBookings', { token: t, month: '2026-12' })).bookings[0];
  assert.equal(ok(gas.call('cancelBooking', { token: t, id: dec.id })).type, 'ยกเลิกการจอง');
  const nov = ok(gas.call('getMyBookings', { token: t, month: '2026-11' }));
  assert.equal(nov.leaves.length, 1);
  ok(gas.call('adminSaveSettings', { token: at, settings: { BOOKING_OPEN: false, BOOKING_MONTHS: '', NOTICE: '', CONTACT: '' } }));
  err(gas.call('saveBooking', { token: t, date: '2026-12-03', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }), 'CLOSED');
  assert.equal(ok(gas.call('getPublicInfo')).settings.bookingOpen, false);
});

test('ขอเพิ่มรายชื่อ → รออนุมัติ → ผู้ดูแลอนุมัติ → เข้าสู่ระบบได้', () => {
  const gas = fresh();
  err(gas.call('requestAccount', { firstName: 'สมชาย', lastName: 'ทดสอบดี', position: 'นักเทคนิคการแพทย์(MT Parttime)', pin: '1234' }), 'DUPLICATE');
  err(gas.call('requestAccount', { firstName: '=cmd', lastName: 'x', position: 'นักเทคนิคการแพทย์(MT Parttime)', pin: '1234' }), 'BAD_REQUEST');
  err(gas.call('requestAccount', { firstName: '<b>', lastName: 'x', position: 'นักเทคนิคการแพทย์(MT Parttime)', pin: '1234' }), 'BAD_REQUEST');
  err(gas.call('requestAccount', { firstName: 'ใหม่', lastName: 'คนดี', position: 'ตำแหน่งปลอม', pin: '1234' }), 'BAD_REQUEST');
  ok(gas.call('requestAccount', { firstName: ' ใหม่ ', lastName: 'คนดี', position: 'นักเทคนิคการแพทย์(MT Parttime)', pin: '2468' }));
  assert.ok(!ok(gas.call('getPublicInfo')).staff.some((s) => s.name === 'ใหม่ คนดี'), 'pending ไม่แสดงในรายชื่อ');
  const at = admin(gas);
  const p = ok(gas.call('adminListStaff', { token: at })).find((s) => s.firstName === 'ใหม่');
  assert.equal(p.status, 'pending');
  err(gas.call('login', { staffId: p.id, pin: '2468' }), 'AUTH');
  ok(gas.call('adminSaveStaff', { token: at, id: p.id, firstName: 'ใหม่', lastName: 'คนดี', position: p.position, status: 'active' }));
  ok(gas.call('login', { staffId: p.id, pin: '2468' }));
  for (let i = 0; i < 30; i++) gas.call('requestAccount', { firstName: 'คน' + i, lastName: 'ทดสอบ', position: p.position, pin: '1234' });
  err(gas.call('requestAccount', { firstName: 'คนเกิน', lastName: 'ทดสอบ', position: p.position, pin: '1234' }), 'RATE_LIMIT');
});

test('ผู้ดูแล: เข้าสู่ระบบ, ล็อก, ไม่ตั้งรหัส, สิทธิ์', () => {
  err(fresh({}).call('adminLogin', { username: 'admin', password: '' }), 'NOT_CONFIGURED');
  const gas = fresh();
  for (let i = 0; i < 5; i++) err(gas.call('adminLogin', { username: 'admin', password: 'x' }), 'AUTH');
  err(gas.call('adminLogin', { username: 'admin', password: 'secret-pass' }), 'LOCKED');
  gas.advance(16 * 60 * 1000);
  const at = admin(gas);
  const ut = loginAs(gas, 'สมชาย');
  ['adminGetMonth', 'adminSaveBooking', 'adminDeleteBooking', 'adminListStaff', 'adminSaveStaff', 'adminResetPin', 'adminSaveHolidays', 'adminSaveSettings']
    .forEach((fn) => { err(gas.call(fn, { token: ut, month: '2026-11' }), 'SESSION'); err(gas.call(fn, {}), 'SESSION'); });
  err(gas.call('getMyBookings', { token: at, month: '2026-11' }), 'SESSION');
  const m = ok(gas.call('adminGetMonth', { token: at, month: '2026-11' }));
  assert.equal(m.bookings.length, 9);
  assert.ok(!/"hash"|"salt"/.test(JSON.stringify(m)));
  gas.props.ADMIN_PASS = 'changed';
  err(gas.call('adminGetMonth', { token: at, month: '2026-11' }), 'SESSION');
});

test('ผู้ดูแล: เพิ่ม/แก้/ลบ/ลา การจอง (ข้ามกติกาวันที่ได้, เตือนการจองซ้ำ)', () => {
  const gas = fresh();
  const at = admin(gas);
  const sid = staffId(gas, 'ปิติ');
  const base = { token: at, staffId: sid, room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด' };
  err(gas.call('adminSaveBooking', Object.assign({ date: '2026-11-10', slots: ['06:00-08:30'] }, base)), 'DUPLICATE');
  ok(gas.call('adminSaveBooking', Object.assign({ date: '2026-11-10', slots: ['06:00-08:30'], force: true }, base)));
  const past = ok(gas.call('adminSaveBooking', Object.assign({ date: '2026-11-01', slots: ['06:00-12:00'] }, base)));
  err(gas.call('adminSaveBooking', Object.assign({ date: '2026-11-01', slots: ['06:00-08:30'] }, base)), 'BAD_REQUEST');
  ok(gas.call('adminSaveBooking', Object.assign({ id: past.id, date: '2026-11-01', slots: ['06:00-สิ้นสุด'] }, base)));
  assert.equal(gas.values('Booking Data').find((r) => r[12] === past.id)[11], '06:00-สิ้นสุด');
  ok(gas.call('adminDeleteBooking', { token: at, id: past.id, type: 'ลาเวร', reason: '=HYPERLINK("x")' }));
  const lv = gas.values('Leave').find((r) => r[12] === past.id);
  assert.equal(lv[13], 'ลาเวร');
  assert.equal(lv[14], '=HYPERLINK("x")', 'เก็บเป็นข้อความ (ใส่ \' นำหน้า) ไม่ใช่สูตร');
  assert.equal(lv[15], 'ผู้ดูแลระบบ');
  const m = ok(gas.call('adminGetMonth', { token: at, month: '2026-11' }));
  assert.equal(m.leaves.length, 1);
  err(gas.call('adminDeleteBooking', { token: at, id: past.id }), 'NOT_FOUND');
});

test('ผู้ดูแล: แก้ชื่อบุคลากรแล้วปรับรายการจองเดิม, รีเซ็ต PIN ตัด session, ระงับบัญชี', () => {
  const gas = fresh();
  const at = admin(gas);
  const ut = loginAs(gas, 'สมหญิง');
  const s = ok(gas.call('adminListStaff', { token: at })).find((x) => x.firstName === 'สมหญิง');
  assert.equal(s.hasPin, true);
  const r = ok(gas.call('adminSaveStaff', { token: at, id: s.id, firstName: 'สมหญิง', lastName: 'ใจงามมาก', position: s.position, status: 'active' }));
  assert.equal(r.renamed, 2);
  assert.equal(gas.values('Booking Data').filter((x) => x[3] === 'ใจงามมาก').length, 2);
  assert.equal(ok(gas.call('getMyBookings', { token: ut, month: '2026-11' })).bookings.length, 2, 'session เดิมยังเห็นการจองหลังเปลี่ยนชื่อ');
  err(gas.call('adminSaveStaff', { token: at, id: s.id, firstName: 'สมชาย', lastName: 'ทดสอบดี', position: s.position }), 'DUPLICATE');
  ok(gas.call('adminResetPin', { token: at, id: s.id }));
  err(gas.call('getMyBookings', { token: ut, month: '2026-11' }), 'SESSION');
  err(gas.call('login', { staffId: s.id, pin: '1234' }), 'NO_PIN');
  const ut2 = ok(gas.call('setFirstPin', { staffId: s.id, pin: '4321' })).token;
  ok(gas.call('adminSaveStaff', { token: at, id: s.id, firstName: 'สมหญิง', lastName: 'ใจงามมาก', position: s.position, status: 'inactive' }));
  err(gas.call('getMyBookings', { token: ut2, month: '2026-11' }), 'SESSION');
  err(gas.call('login', { staffId: s.id, pin: '4321' }), 'AUTH');
  assert.ok(!ok(gas.call('getPublicInfo')).staff.some((x) => x.id === s.id));
  const n = ok(gas.call('adminSaveStaff', { token: at, firstName: 'พนักงาน', lastName: 'ใหม่', position: s.position, status: 'active' }));
  assert.ok(ok(gas.call('getPublicInfo')).staff.some((x) => x.id === n.id && !x.hasPin));
});

test('ผู้ดูแล: วันหยุดและการตั้งค่า', () => {
  const gas = fresh();
  const at = admin(gas);
  err(gas.call('adminSaveHolidays', { token: at, holidays: [{ date: '2026-12-05', name: 'a' }, { date: '2026-12-05', name: 'b' }] }), 'BAD_REQUEST');
  err(gas.call('adminSaveHolidays', { token: at, holidays: [{ date: '5/12/2026', name: 'a' }] }), 'BAD_REQUEST');
  err(gas.call('adminSaveHolidays', { token: at, holidays: 'x' }), 'BAD_REQUEST');
  const r = ok(gas.call('adminSaveHolidays', { token: at, holidays: [{ date: '2026-12-31', name: 'วันสิ้นปี' }, { date: '2026-11-20', name: 'วันหยุดพิเศษ (ครม.)' }, { date: '2026-11-21', name: '' }] }));
  assert.equal(r.count, 3);
  assert.deepEqual(r.holidays.map((h) => h.date), ['2026-11-20', '2026-11-21', '2026-12-31']);
  assert.equal(r.holidays[1].name, 'วันหยุด');
  assert.equal(gas.values('Holidays').length, 4, 'เขียนทับทั้งแท็บ ไม่เหลือแถวเก่า');
  assert.equal(typeof gas.values('Holidays')[1][0], 'string', 'วันที่เก็บเป็นข้อความ');
  const t = loginAs(gas, 'มานะ');
  err(gas.call('saveBooking', { token: t, date: '2026-11-20', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }), 'BAD_REQUEST');
  ok(gas.call('saveBooking', { token: t, date: '2026-11-20', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-12:00'] }));
  ok(gas.call('saveBooking', { token: t, date: '2026-12-07', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30', '08:30-12:30'] }), 'ลบวันหยุด 7 ธ.ค. แล้ว กลับเป็นวันธรรมดา');
  err(gas.call('adminSaveSettings', { token: at, settings: { BOOKING_MONTHS: '2026-13' } }), 'BAD_REQUEST');
  err(gas.call('adminSaveSettings', { token: at, settings: { BOOKING_MONTHS: 'Dec' } }), 'BAD_REQUEST');
  const st = ok(gas.call('adminSaveSettings', { token: at, settings: { BOOKING_OPEN: true, BOOKING_MONTHS: '2026-12, 2027-01', NOTICE: '+ประกาศ', CONTACT: '1234' } })).settings;
  assert.deepEqual(st.bookingMonths, ['2026-12', '2027-01']);
  assert.equal(st.notice, '+ประกาศ');
  assert.equal(ok(gas.call('getPublicInfo')).settings.contact, '1234');
});

test('แถวใหม่จากระบบเดิม (ไม่มี ID) ถูกเติม ID อัตโนมัติ', () => {
  const gas = fresh();
  ok(gas.call('getPublicInfo'));
  gas.sheets['Booking Data'].appendRow(['2026/11/04, 08:00:00', '2026-11-25', 'สมชาย', 'ทดสอบดี', 'นักเทคนิคการแพทย์(MT Parttime)', 'ห้องเจาะเลือด SMC', 'จุดเจาะเลือด', '06:00-08:30']);
  const t = loginAs(gas, 'สมชาย');
  const b = ok(gas.call('getMyBookings', { token: t, month: '2026-11' })).bookings.find((x) => x.date === '2026-11-25');
  assert.ok(b && /^B/.test(b.id));
  ok(gas.call('cancelBooking', { token: t, id: b.id }));
});
