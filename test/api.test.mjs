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
function loginAs(gas, first, pin = '2580') {
  const id = staffId(gas, first);
  const r = gas.call('login', { staffId: id, pin });
  if (!r.ok && r.code === 'AUTH') return setPin(gas, id, pin);
  return ok(r).token;
}
// เข้าครั้งแรกด้วย PIN เริ่มต้น 1234 แล้วตั้ง PIN ใหม่
function setPin(gas, id, pin) {
  const lg = ok(gas.call('login', { staffId: id, pin: '1234' }));
  assert.equal(lg.mustChange, true);
  return ok(gas.call('changePin', { token: lg.token, oldPin: '1234', newPin: pin })).token;
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
  assert.ok(info.staff.every((s) => !('hasPin' in s)), 'ไม่บอกว่าใครยังไม่ตั้ง PIN');
  assert.equal(gas.values('Staff')[0][9], 'ต้องเปลี่ยน PIN');
  assert.equal(info.holidays.find((h) => h.date === '2026-12-07').name, 'ชดเชยวันพ่อแห่งชาติ');
  assert.equal(info.settings.bookingOpen, true);
  assert.equal(info.settings.holidayAsWeekend, false, 'ค่าเริ่มต้น: วันหยุดใช้ช่วงวันธรรมดาเหมือนข้อมูลเดิม');
  assert.equal(info.settings.defaultPin, '1234');
  assert.ok(info.holidays.some((h) => h.date === '2026-10-13'));
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

test('PIN: เข้าครั้งแรกด้วย 1234, ต้องตั้ง PIN ใหม่ก่อนจอง, ล็อกเมื่อผิด 5 ครั้ง', () => {
  const gas = fresh();
  const id = staffId(gas, 'สมชาย');
  err(gas.call('setFirstPin', { staffId: id, pin: '2580' }), 'BAD_REQUEST');
  err(gas.call('login', { staffId: id, pin: '2580' }), 'AUTH');
  const lg = ok(gas.call('login', { staffId: id, pin: '1234' }));
  assert.equal(lg.mustChange, true);
  assert.equal(ok(gas.call('getMyBookings', { token: lg.token, month: '2026-11' })).mustChange, true, 'ดูข้อมูลตัวเองได้');
  const bk = { token: lg.token, date: '2026-11-26', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] };
  err(gas.call('saveBooking', bk), 'MUST_CHANGE');
  err(gas.call('saveBookings', { token: lg.token, items: [bk] }), 'MUST_CHANGE');
  err(gas.call('cancelBooking', { token: lg.token, id: 'Bxxx' }), 'MUST_CHANGE');
  err(gas.call('changePin', { token: lg.token, oldPin: '1234', newPin: '12' }), 'BAD_REQUEST');
  err(gas.call('changePin', { token: lg.token, oldPin: '1234', newPin: 'abcd' }), 'BAD_REQUEST');
  err(gas.call('changePin', { token: lg.token, oldPin: '1234', newPin: '1234' }), 'WEAK_PIN');
  err(gas.call('changePin', { token: lg.token, oldPin: '9999', newPin: '2580' }), 'AUTH');
  const t = ok(gas.call('changePin', { token: lg.token, oldPin: '1234', newPin: '2580' })).token;
  assert.ok(t.length >= 32);
  err(gas.call('getMyBookings', { token: lg.token, month: '2026-11' }), 'SESSION');
  assert.equal(ok(gas.call('getMyBookings', { token: t, month: '2026-11' })).mustChange, false);
  err(gas.call('login', { staffId: id, pin: '1234' }), 'AUTH');
  assert.equal(ok(gas.call('login', { staffId: id, pin: '2580' })).mustChange, false);
  const staffRow = gas.values('Staff').find((r) => r[0] === id);
  assert.ok(staffRow[5].length === 64 && staffRow[5] !== '2580', 'เก็บ hash ไม่เก็บ PIN จริง');
  for (let i = 0; i < 5; i++) err(gas.call('login', { staffId: id, pin: '0000' }), 'AUTH');
  err(gas.call('login', { staffId: id, pin: '2580' }), 'LOCKED');
  // คนอื่นยังเข้าได้ (ไม่ล็อกทั้งระบบ)
  loginAs(gas, 'มานะ');
  gas.advance(16 * 60 * 1000);
  const t2 = ok(gas.call('login', { staffId: id, pin: '2580' })).token;
  err(gas.call('changePin', { token: t2, oldPin: '1111', newPin: '3691' }), 'AUTH');
  const t3 = ok(gas.call('changePin', { token: t2, oldPin: '2580', newPin: '3691' })).token;
  err(gas.call('getMyBookings', { token: t2, month: '2026-11' }), 'SESSION');
  ok(gas.call('getMyBookings', { token: t3, month: '2026-11' }));
  ok(gas.call('login', { staffId: id, pin: '3691' }));
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
  assert.equal(row[4], 'พยาบาล (Part time)', 'ตำแหน่งมาจากรายชื่อ ไม่ใช่จากหน้าเว็บ');
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
  ok(gas.call('adminSaveSettings', { token: admin(gas), settings: { BOOKING_OPEN: true, BLOCK_HOLIDAYS: false } }));
  // ค่าเริ่มต้น: วันหยุดราชการ (ไม่ใช่เสาร์-อาทิตย์) ใช้ช่วงวันธรรมดา เหมือนข้อมูลจริง 13/23 ต.ค.
  ok(gas.call('saveBooking', { token: t, date: '2026-12-10', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30', '08:30-12:30'] }));
  ok(gas.call('adminSaveSettings', { token: admin(gas), settings: { BOOKING_OPEN: true, BOOKING_MONTHS: '', NOTICE: 'x', CONTACT: '1', SPECIAL_DAY_RULE: true, BLOCK_HOLIDAYS: false } }));
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
  err(gas.call('requestAccount', { firstName: 'สมชาย', lastName: 'ทดสอบดี', position: 'นักเทคนิคการแพทย์ (Part time)', pin: '2580' }), 'DUPLICATE');
  err(gas.call('requestAccount', { firstName: '=cmd', lastName: 'x', position: 'นักเทคนิคการแพทย์ (Part time)', pin: '2580' }), 'BAD_REQUEST');
  err(gas.call('requestAccount', { firstName: '<b>', lastName: 'x', position: 'นักเทคนิคการแพทย์ (Part time)', pin: '2580' }), 'BAD_REQUEST');
  err(gas.call('requestAccount', { firstName: 'ใหม่', lastName: 'คนดี', position: 'ตำแหน่งปลอม', pin: '2580' }), 'BAD_REQUEST');
  err(gas.call('requestAccount', { firstName: 'ใหม่', lastName: 'คนดี', position: 'นักเทคนิคการแพทย์ (Part time)', pin: '1234' }), 'WEAK_PIN');
  ok(gas.call('requestAccount', { firstName: ' ใหม่ ', lastName: 'คนดี', position: 'นักเทคนิคการแพทย์ (Part time)', pin: '2468' }));
  assert.ok(!ok(gas.call('getPublicInfo')).staff.some((s) => s.name === 'ใหม่ คนดี'), 'pending ไม่แสดงในรายชื่อ');
  const at = admin(gas);
  const p = ok(gas.call('adminListStaff', { token: at })).find((s) => s.firstName === 'ใหม่');
  assert.equal(p.status, 'pending');
  err(gas.call('login', { staffId: p.id, pin: '2468' }), 'AUTH');
  ok(gas.call('adminSaveStaff', { token: at, id: p.id, firstName: 'ใหม่', lastName: 'คนดี', position: p.position, status: 'active' }));
  ok(gas.call('login', { staffId: p.id, pin: '2468' }));
  for (let i = 0; i < 30; i++) gas.call('requestAccount', { firstName: 'คน' + i, lastName: 'ทดสอบ', position: p.position, pin: '2580' });
  err(gas.call('requestAccount', { firstName: 'คนเกิน', lastName: 'ทดสอบ', position: p.position, pin: '2580' }), 'RATE_LIMIT');
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
  err(gas.call('login', { staffId: s.id, pin: '2580' }), 'AUTH');
  assert.equal(ok(gas.call('adminListStaff', { token: at })).find((x) => x.id === s.id).mustChange, true);
  const ut2 = setPin(gas, s.id, '7395');
  ok(gas.call('adminSaveStaff', { token: at, id: s.id, firstName: 'สมหญิง', lastName: 'ใจงามมาก', position: s.position, status: 'inactive' }));
  err(gas.call('getMyBookings', { token: ut2, month: '2026-11' }), 'SESSION');
  err(gas.call('login', { staffId: s.id, pin: '7395' }), 'AUTH');
  assert.ok(!ok(gas.call('getPublicInfo')).staff.some((x) => x.id === s.id));
  const n = ok(gas.call('adminSaveStaff', { token: at, firstName: 'พนักงาน', lastName: 'ใหม่', position: s.position, status: 'active' }));
  assert.ok(ok(gas.call('getPublicInfo')).staff.some((x) => x.id === n.id));
  err(gas.call('login', { staffId: n.id, pin: '2580' }), 'AUTH');
  assert.equal(ok(gas.call('login', { staffId: n.id, pin: '1234' })).mustChange, true, 'คนใหม่ใช้ PIN เริ่มต้น');
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
  ok(gas.call('adminSaveSettings', { token: at, settings: { BOOKING_OPEN: true, SPECIAL_DAY_RULE: true, BLOCK_HOLIDAYS: false } }));
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
  gas.sheets['Booking Data'].appendRow(['2026/11/04, 08:00:00', '2026-11-25', 'สมชาย', 'ทดสอบดี', 'นักเทคนิคการแพทย์ (Part time)', 'ห้องเจาะเลือด SMC', 'จุดเจาะเลือด', '06:00-08:30']);
  const t = loginAs(gas, 'สมชาย');
  const b = ok(gas.call('getMyBookings', { token: t, month: '2026-11' })).bookings.find((x) => x.date === '2026-11-25');
  assert.ok(b && /^B/.test(b.id));
  ok(gas.call('cancelBooking', { token: t, id: b.id }));
});

/* ---------------- Regression tests สำหรับบัค/ช่องโหว่ที่แก้ในรอบตรวจระบบ ---------------- */

test('[R1] ปฏิเสธ PIN ที่เดาง่ายทุกจุดที่ตั้ง PIN ใหม่', () => {
  const gas = fresh();
  const id = staffId(gas, 'สมชาย');
  const lg = ok(gas.call('login', { staffId: id, pin: '1234' }));
  ['1234', '0000', '111111', '4321', '1212', '123456', '987654', '2525'].forEach((pin) => err(gas.call('changePin', { token: lg.token, oldPin: '1234', newPin: pin }), 'WEAK_PIN'));
  const t = ok(gas.call('changePin', { token: lg.token, oldPin: '1234', newPin: '2580' })).token;
  err(gas.call('changePin', { token: t, oldPin: '2580', newPin: '5678' }), 'WEAK_PIN');
  err(gas.call('changePin', { token: t, oldPin: '2580', newPin: '2580' }), 'BAD_REQUEST');
});

test('[R2] รายชื่อสาธารณะไม่เปิดเผยว่าใครยังไม่ตั้ง PIN', () => {
  const gas = fresh();
  loginAs(gas, 'สมชาย');
  const json = JSON.stringify(ok(gas.call('getPublicInfo')).staff);
  assert.ok(!/hasPin|mustChange/.test(json));
});

test('[R3] ผู้ดูแลรีเซ็ต PIN → กลับเป็น 1234 → ผู้ใช้ต้องตั้ง PIN ใหม่', () => {
  const gas = fresh();
  const at = admin(gas);
  const id = staffId(gas, 'สมชาย');
  const ut = loginAs(gas, 'สมชาย', '2580');
  const r = ok(gas.call('adminResetPin', { token: at, id }));
  assert.ok(!('tempPin' in r));
  assert.match(r.message, /1234/);
  err(gas.call('getMyBookings', { token: ut, month: '2026-11' }), 'SESSION');
  err(gas.call('login', { staffId: id, pin: '2580' }), 'AUTH');
  const row = gas.values('Staff').find((x) => x[0] === id);
  assert.equal(row[5], ''); assert.ok(row[9] === true || row[9] === 'TRUE');
  const lg = ok(gas.call('login', { staffId: id, pin: '1234' }));
  assert.equal(lg.mustChange, true);
  assert.equal(ok(gas.call('adminListStaff', { token: at })).find((s) => s.id === id).mustChange, true);
  const t2 = ok(gas.call('changePin', { token: lg.token, oldPin: '1234', newPin: '3691' })).token;
  assert.equal(ok(gas.call('getMyBookings', { token: t2, month: '2026-11' })).mustChange, false);
  assert.equal(ok(gas.call('login', { staffId: id, pin: '3691' })).mustChange, false);
  assert.equal(ok(gas.call('adminListStaff', { token: at })).find((s) => s.id === id).mustChange, false);
  assert.equal(typeof gas.values('Staff').find((x) => x[0] === id)[5], 'string', 'hash เก็บเป็นข้อความ');
  // ล็อกบัญชียังทำงานกับ PIN เริ่มต้น
  ok(gas.call('adminResetPin', { token: at, id }));
  for (let i = 0; i < 5; i++) err(gas.call('login', { staffId: id, pin: '0000' }), 'AUTH');
  err(gas.call('login', { staffId: id, pin: '1234' }), 'LOCKED');
});

test('[R4] ล็อกซ้ำ เวลาล็อกเพิ่มเป็นเท่าตัว (กันสุ่ม PIN)', () => {
  const gas = fresh();
  const id = staffId(gas, 'สมชาย');
  setPin(gas, id, '2580');
  for (let i = 0; i < 5; i++) gas.call('login', { staffId: id, pin: '0000' });
  assert.match(err(gas.call('login', { staffId: id, pin: '2580' }), 'LOCKED').error, /15 นาที/);
  gas.advance(16 * 60 * 1000);
  for (let i = 0; i < 5; i++) gas.call('login', { staffId: id, pin: '0000' });
  assert.match(err(gas.call('login', { staffId: id, pin: '2580' }), 'LOCKED').error, /30 นาที/);
  gas.advance(20 * 60 * 1000);
  err(gas.call('login', { staffId: id, pin: '2580' }), 'LOCKED');
  gas.advance(11 * 60 * 1000);
  ok(gas.call('login', { staffId: id, pin: '2580' }));
});

test('[R5] เดาชื่อผู้ใช้ผู้ดูแลผิดไม่ทำให้บัญชีผู้ดูแลจริงถูกล็อก', () => {
  const gas = fresh();
  for (let i = 0; i < 10; i++) gas.call('adminLogin', { username: 'root', password: 'x' });
  err(gas.call('adminLogin', { username: 'root', password: 'x' }), 'LOCKED');
  ok(gas.call('adminLogin', { username: 'admin', password: 'secret-pass' }));
});

test('[R6] แก้ชื่อบุคลากรแล้วประวัติลา/ยกเลิกยังตามไปด้วย', () => {
  const gas = fresh();
  const at = admin(gas);
  const t = loginAs(gas, 'สมชาย');
  const b = ok(gas.call('getMyBookings', { token: t, month: '2026-11' })).bookings.find((x) => x.date === '2026-11-07');
  ok(gas.call('cancelBooking', { token: t, id: b.id }));
  const s = ok(gas.call('adminListStaff', { token: at })).find((x) => x.firstName === 'สมชาย');
  ok(gas.call('adminSaveStaff', { token: at, id: s.id, firstName: 'สมชาย', lastName: 'เปลี่ยนสกุล', position: s.position, status: 'active' }));
  const mine = ok(gas.call('getMyBookings', { token: t, month: '2026-11' }));
  assert.equal(mine.leaves.length, 1);
  assert.equal(mine.bookings.length, 2);
});

test('[R7] ชื่อที่ขึ้นต้นด้วย - ถูกเก็บเป็นข้อความ ไม่กลายเป็นตัวเลข/สูตร', () => {
  const gas = fresh();
  const at = admin(gas);
  const s = ok(gas.call('adminListStaff', { token: at })).find((x) => x.firstName === 'มานะ');
  ok(gas.call('adminSaveStaff', { token: at, id: s.id, firstName: 'มานะ', lastName: '-1+1', position: s.position, status: 'active' }));
  assert.equal(gas.values('Staff').find((x) => x[0] === s.id)[2], '-1+1');
  assert.ok(gas.values('Booking Data').some((x) => x[3] === '-1+1'));
});

test('[R8] getMyBookings ส่งวันที่ปัจจุบันจาก server (กันปฏิทินค้างข้ามเที่ยงคืน)', () => {
  const gas = fresh();
  gas.setNow('2026-11-04T23:50:00+07:00');
  const t = loginAs(gas, 'สมชาย');
  assert.equal(ok(gas.call('getMyBookings', { token: t, month: '2026-11' })).today, '2026-11-04');
  gas.setNow('2026-11-05T00:05:00+07:00');
  assert.equal(ok(gas.call('getMyBookings', { token: t, month: '2026-11' })).today, '2026-11-05');
});

test('[R9] ใส่ PIN เดิมผิดตอนเปลี่ยน PIN นับรวมการล็อก', () => {
  const gas = fresh();
  const t = loginAs(gas, 'สมชาย');
  for (let i = 0; i < 5; i++) err(gas.call('changePin', { token: t, oldPin: '0000', newPin: '3691' }), 'AUTH');
  err(gas.call('changePin', { token: t, oldPin: '2580', newPin: '3691' }), 'LOCKED');
});

test('[R10] ชีต Staff รุ่นเก่า (9 คอลัมน์) ได้คอลัมน์ "ต้องเปลี่ยน PIN" เพิ่มอัตโนมัติ', () => {
  const gas = createGas({
    now: NOW, props: { ADMIN_USER: 'admin', ADMIN_PASS: 'secret-pass' },
    sheets: {
      'Booking Data': bookingRows(), Leave: [LEAVE_HEADER],
      Staff: [['ID', 'ชื่อ', 'นามสกุล', 'ตำแหน่ง', 'สถานะ', 'PIN Hash', 'Salt', 'สร้างเมื่อ', 'อัปเดตเมื่อ'], ['S1', 'ก', 'ข', 'นักเทคนิคการแพทย์ (Part time)', 'active', '', '', '', '']]
    }
  });
  ok(gas.call('getPublicInfo'));
  assert.equal(gas.values('Staff')[0][9], 'ต้องเปลี่ยน PIN');
  setPin(gas, 'S1', '2580');
});

test('[R11] ข้อมูลรูปแบบจริง: วันหยุดที่มีการจองช่วงวันธรรมดาแล้วยังแก้ไข/ยกเลิกได้', () => {
  const gas = fresh();
  const at = admin(gas);
  ok(gas.call('adminSaveSettings', { token: at, settings: { BOOKING_OPEN: true, BLOCK_HOLIDAYS: false } }));
  const sid = staffId(gas, 'ปิติ');
  const r = ok(gas.call('adminSaveBooking', { token: at, staffId: sid, date: '2026-12-10', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }));
  const t = loginAs(gas, 'ปิติ');
  ok(gas.call('saveBooking', { token: t, id: r.id, date: '2026-12-10', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30', '08:30-12:30'] }));
  ok(gas.call('cancelBooking', { token: t, id: r.id }));
});

test('[R18] จองหลายวันพร้อมกัน: บันทึกวันที่ผ่าน แจ้งวันที่ไม่ผ่านพร้อมเหตุผล', () => {
  const gas = fresh();
  const t = loginAs(gas, 'สมชาย');
  const base = { token: t, room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] };
  err(gas.call('saveBookings', Object.assign({ dates: [] }, base)), 'BAD_REQUEST');
  err(gas.call('saveBookings', Object.assign({ dates: Array.from({ length: 32 }, (_, i) => '2026-12-' + String((i % 28) + 1).padStart(2, '0')) }, base)), 'BAD_REQUEST');
  // 3 พ.ย. ผ่านมาแล้ว, 2 พ.ย. ซ้ำช่วงเช้า+อดีต, 14 พ.ย. เสาร์ใช้ช่วงวันธรรมดาไม่ได้, 16-18 พ.ย. ผ่าน (18 ส่งซ้ำ)
  const r = ok(gas.call('saveBookings', Object.assign({ dates: ['2026-11-18', '2026-11-03', '2026-11-16', '2026-11-14', '2026-11-17', '2026-11-18'] }, base)));
  assert.equal(r.saved, 3);
  assert.equal(r.failed, 2);
  assert.deepEqual(r.results.map((x) => [x.date, x.ok, x.code || '']), [
    ['2026-11-03', false, 'CLOSED'], ['2026-11-14', false, 'BAD_REQUEST'], ['2026-11-16', true, ''], ['2026-11-17', true, ''], ['2026-11-18', true, '']
  ]);
  const again = ok(gas.call('saveBookings', Object.assign({ dates: ['2026-11-16', '2026-11-19'] }, base)));
  assert.deepEqual(again.results.map((x) => x.code || 'OK'), ['DUPLICATE', 'OK'], 'กันจองซ้ำกับรายการที่มีอยู่');
  const rows = gas.values('Booking Data').filter((x) => x[2] === 'สมชาย' && x[5] === 'ห้องเจาะเลือด SMC');
  assert.equal(rows.length, 4);
  assert.ok(rows.every((x) => /^B[0-9a-f]{12}$/.test(x[12]) && x[7] === '06:00-08:30'));
  err(gas.call('saveBookings', Object.assign({}, base, { token: 'bad', dates: ['2026-11-20'] })), 'SESSION');
});

test('[R19] วันปิดรับจองอัตโนมัติ (CLOSE_AT)', () => {
  const gas = fresh();
  const at = admin(gas);
  err(gas.call('adminSaveSettings', { token: at, settings: { BOOKING_OPEN: true, CLOSE_AT: '26/11/2026' } }), 'BAD_REQUEST');
  const st = ok(gas.call('adminSaveSettings', { token: at, settings: { BOOKING_OPEN: true, CLOSE_AT: '2026-11-05' } })).settings;
  assert.equal(st.closeAt, '2026-11-05');
  assert.equal(ok(gas.call('getPublicInfo')).settings.closeAt, '2026-11-05');
  gas.setNow('2026-11-05T20:00:00+07:00');
  const t = loginAs(gas, 'สมชาย');
  const b = { token: t, room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] };
  ok(gas.call('saveBooking', Object.assign({ date: '2026-12-01' }, b)), 'ก่อนวันปิด จองได้');
  gas.setNow('2026-11-05T23:59:00+07:00');
  ok(gas.call('saveBooking', Object.assign({ date: '2026-12-02' }, b)), 'วันปิดรับยังจองได้ถึงสิ้นวัน');
  gas.setNow('2026-11-06T00:01:00+07:00');
  const t2 = loginAs(gas, 'มานะ');
  err(gas.call('saveBooking', { token: t2, date: '2026-12-03', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }), 'CLOSED');
  const mine = ok(gas.call('getMyBookings', { token: t, month: '2026-12' })).bookings[0];
  err(gas.call('cancelBooking', { token: t, id: mine.id }), 'NEED_REASON');
  ok(gas.call('adminSaveSettings', { token: admin(gas), settings: { BOOKING_OPEN: true, CLOSE_AT: '' } }));
  ok(gas.call('saveBooking', { token: t2, date: '2026-12-03', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }));
});

test('[R26] วันหยุดนักขัตฤกษ์ปิดรับจอง (ค่าเริ่มต้น) แต่ผู้ดูแลยังเพิ่มให้ได้', () => {
  const gas = fresh();
  assert.equal(ok(gas.call('getPublicInfo')).settings.blockHolidays, true);
  const t = loginAs(gas, 'มานะ');
  const b = { token: t, room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] };
  const e = err(gas.call('saveBooking', Object.assign({ date: '2026-12-07' }, b)), 'HOLIDAY');
  assert.match(e.error, /ชดเชยวันพ่อแห่งชาติ/);
  const bulk = ok(gas.call('saveBookings', Object.assign({ dates: ['2026-12-07', '2026-12-08'] }, b)));
  assert.deepEqual(bulk.results.map((x) => x.code || 'OK'), ['HOLIDAY', 'OK']);
  const at = admin(gas);
  ok(gas.call('adminSaveBooking', { token: at, staffId: staffId(gas, 'มานะ'), date: '2026-12-10', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }), 'ผู้ดูแลเพิ่มได้');
  ok(gas.call('adminSaveSettings', { token: at, settings: { BOOKING_OPEN: true, BLOCK_HOLIDAYS: false } }));
  ok(gas.call('saveBooking', Object.assign({ date: '2026-12-07' }, b)), 'ปิดการบล็อกแล้วจองได้');
});

test('[R27] ผู้ดูแลดูข้อมูลตามช่วงวันที่ (ข้ามเดือนได้)', () => {
  const gas = fresh();
  const at = admin(gas);
  const r = ok(gas.call('adminGetMonth', { token: at, from: '2026-10-01', to: '2026-11-05' }));
  assert.equal(r.from, '2026-10-01'); assert.equal(r.to, '2026-11-05');
  assert.deepEqual(r.bookings.map((b) => b.date), ['2026-10-15', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-05']);
  err(gas.call('adminGetMonth', { token: at, from: '2026-11-05', to: '2026-11-01' }), 'BAD_REQUEST');
  err(gas.call('adminGetMonth', { token: at, from: '2026-01-01', to: '2027-06-01' }), 'BAD_REQUEST');
  err(gas.call('adminGetMonth', { token: at, from: 'x', to: '2026-11-01' }), 'BAD_REQUEST');
});

test('[R28] ดึงวันหยุดจากปฏิทินวันหยุดไทยของ Google (แยกวันหยุดจริงกับวันสำคัญ)', () => {
  const ev = [
    { date: '2027-01-01', title: 'วันขึ้นปีใหม่', desc: 'วันหยุดนักขัตฤกษ์' },
    { date: '2027-01-09', title: 'วันเด็กแห่งชาติ', desc: 'การเฉลิมฉลอง' },
    { date: '2027-02-14', title: 'วันวาเลนไทน์', desc: 'Observance' },
    { date: '2027-04-13', title: 'วันสงกรานต์', desc: 'Public holiday' },
    { date: '2026-12-31', title: 'วันสิ้นปี', desc: 'วันหยุดนักขัตฤกษ์' }
  ];
  const gas = createGas({ now: NOW, props: { ADMIN_USER: 'admin', ADMIN_PASS: 'secret-pass' }, calendarEvents: ev, sheets: { 'Booking Data': bookingRows(), Leave: [LEAVE_HEADER] } });
  const at = admin(gas);
  const r = ok(gas.call('adminFetchHolidays', { token: at, year: 2027 }));
  assert.deepEqual(r.holidays.map((h) => [h.date, h.official]), [['2027-01-01', true], ['2027-01-09', false], ['2027-02-14', false], ['2027-04-13', true]]);
  err(gas.call('adminFetchHolidays', { token: at, year: 1999 }), 'BAD_REQUEST');
  err(gas.call('adminFetchHolidays', { year: 2027 }), 'SESSION');
  err(fresh().call('adminFetchHolidays', { token: admin(fresh()), year: 2027 }), 'SESSION');
  const g2 = fresh();
  err(g2.call('adminFetchHolidays', { token: admin(g2), year: 2027 }), 'NOT_CONFIGURED');
});

test('[R32] ผู้ดูแลย้ายข้อมูลเก่าไปแท็บ Archive (ไม่ลบทิ้ง) นับก่อนย้าย และกันวันอนาคต', () => {
  const gas = fresh();
  const at = admin(gas);
  const ut = loginAs(gas, 'สมชาย');
  const b = ok(gas.call('getMyBookings', { token: ut, month: '2026-11' })).bookings.find((x) => x.date === '2026-11-02');
  ok(gas.call('adminDeleteBooking', { token: at, id: b.id, asLeave: true, reason: 'ป่วย' }));
  err(gas.call('adminArchive', { token: ut, before: '2026-11-04' }), 'SESSION');
  err(gas.call('adminArchive', { token: at, before: '2026-12-01' }), 'BAD_REQUEST');
  err(gas.call('adminArchive', { token: at, before: '4/11/2026' }), 'BAD_REQUEST');
  const total = gas.values('Booking Data').length - 1;
  const dry = ok(gas.call('adminArchive', { token: at, before: '2026-11-04', dryRun: true }));
  assert.equal(dry.bookings, 2, 'ก่อน 4 พ.ย.: 15 ต.ค. และ 3 พ.ย.');
  assert.equal(dry.leaves, 1);
  assert.equal(gas.values('Booking Data').length - 1, total, 'dryRun ไม่ย้ายจริง');
  assert.ok(!gas.sheets['Archive Booking']);
  const r = ok(gas.call('adminArchive', { token: at, before: '2026-11-04' }));
  assert.deepEqual([r.bookings, r.leaves], [2, 1]);
  const left = gas.values('Booking Data').slice(1).filter((x) => x[1] !== '');
  assert.equal(left.length, total - 2);
  assert.ok(left.every((x) => String(x[1]) >= '2026-11-04'));
  const arc = gas.values('Archive Booking');
  assert.equal(arc[0][12], 'ID');
  assert.deepEqual(arc.slice(1).map((x) => x[1]).sort(), ['2026-10-15', '2026-11-03']);
  assert.equal(gas.values('Archive Leave').length - 1, 1);
  assert.equal(ok(gas.call('adminGetMonth', { token: at, month: '2026-11' })).bookings.filter((x) => x.date < '2026-11-04').length, 0);
  // ย้ายซ้ำ: ต่อท้าย ไม่ทับของเดิม
  assert.deepEqual([ok(gas.call('adminArchive', { token: at, before: '2026-11-04' })).bookings], [0], 'ย้ายซ้ำวันเดิม: ไม่มีอะไรเหลือให้ย้าย');
  gas.advance(2 * 86400000);
  ok(gas.call('adminArchive', { token: admin(gas), before: '2026-11-06' }));
  assert.equal(gas.values('Archive Booking').filter((x) => x[1] === '2026-11-05').length, 2);
  assert.equal(gas.values('Archive Booking').length - 1, 4);
});

test('[R33] บันทึก/จองหลายวัน/ยกเลิก ส่งข้อมูลเดือนนี้ + เวรล่วงหน้ากลับมาในคำตอบเดียว (หน้าเว็บไม่ต้องโหลดซ้ำ)', () => {
  const gas = fresh();
  const ut = loginAs(gas, 'สมชาย');
  const r = ok(gas.call('saveBooking', { token: ut, month: '2026-11', date: '2026-11-18', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }));
  assert.equal(r.view.month, '2026-11');
  assert.ok(r.view.bookings.some((b) => b.id === r.id && b.date === '2026-11-18'));
  assert.ok(r.view.upcoming.every((b) => b.date >= '2026-11-04'));
  assert.ok(r.view.upcoming.some((b) => b.id === r.id));
  const fresh2 = ok(gas.call('getMyBookings', { token: ut, month: '2026-11' }));
  assert.deepEqual(r.view.bookings, fresh2.bookings, 'ตรงกับการโหลดใหม่');
  const m = ok(gas.call('saveBookings', { token: ut, month: '2026-12', dates: ['2026-12-02', '2026-12-03'], room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }));
  assert.equal(m.view.month, '2026-12');
  assert.equal(m.view.bookings.filter((b) => b.date === '2026-12-02' || b.date === '2026-12-03').length, 2);
  const c = ok(gas.call('cancelBooking', { token: ut, id: r.id, month: '2026-11' }));
  assert.ok(!c.view.bookings.some((b) => b.id === r.id));
  assert.ok(c.view.leaves.some((b) => b.id === r.id));
  // ไม่ส่งเดือน / เดือนผิดรูปแบบ: บันทึกยังสำเร็จ แค่ไม่มี view
  const n = ok(gas.call('saveBooking', { token: ut, month: '2026-13', date: '2026-11-19', room: 'ห้องเจาะเลือด SMC', station: 'จุดเจาะเลือด', slots: ['06:00-08:30'] }));
  assert.equal(n.view, null);
  assert.ok(ok(gas.call('getMyBookings', { token: ut, month: '2026-11' })).bookings.some((b) => b.id === n.id));
});
