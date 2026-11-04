/**
 * BRS Booking — ระบบจองเวรหน่วยเจาะเลือดเก็บสิ่งส่งตรวจและ POCT
 * Apps Script backend (JSON API) — หน้าเว็บอยู่บน Vercel และเรียกผ่าน /api/gas
 *
 * ติดตั้ง: เปิด Google Sheet ที่ต้องการใช้ → ส่วนขยาย → Apps Script → วางไฟล์นี้และ appsscript.json
 *        → รันฟังก์ชัน setup() หนึ่งครั้งเพื่ออนุญาตสิทธิ์และสร้างแท็บ
 *        → ตั้ง Script Properties: ADMIN_USER, ADMIN_PASS (และ API_SECRET ถ้าต้องการ)
 *        → Deploy เป็น Web app (ดำเนินการในฐานะ: ฉัน, ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน)
 *
 * กฎ: ฟังก์ชันที่ลงท้ายด้วย _ เป็นฟังก์ชันภายใน เรียกจากภายนอกได้เฉพาะชื่อที่อยู่ใน API_
 */

const CONFIG = {
  TZ: 'Asia/Bangkok',
  TH_HOLIDAY_CAL: 'th.th#holiday@group.v.calendar.google.com',
  APP_TITLE: 'ระบบจองเวรหน่วยเจาะเลือดเก็บสิ่งส่งตรวจและPOCT',
  ORG: 'งานห้องปฏิบัติการเวชศาสตร์ชันสูตร โรงพยาบาลศรีนครินทร์',
  SHEETS: {
    BOOKING: 'Booking Data',
    LEAVE: 'Leave',
    STAFF: 'Staff',
    HOLIDAYS: 'Holidays',
    SETTINGS: 'Settings'
  },
  // คอลัมน์ A–L ตรงกับระบบเดิม เพิ่มเฉพาะคอลัมน์ท้าย
  BOOKING_HEADERS: ['Timestamp', 'Date', 'ชื่อ', 'นามสกุล', 'ตำแหน่ง', 'Room', 'Station',
    'เช้า', 'สาย', 'บ่าย', 'นอกเวลาเย็น', 'ดึก', 'ID'],
  LEAVE_HEADERS: ['Timestamp', 'Date', 'ชื่อ', 'นามสกุล', 'ตำแหน่ง', 'Room', 'Station',
    'เช้า', 'สาย', 'บ่าย', 'เย็น', 'ดึก', 'ID', 'ประเภท', 'เหตุผล', 'ดำเนินการโดย'],
  STAFF_HEADERS: ['ID', 'ชื่อ', 'นามสกุล', 'ตำแหน่ง', 'สถานะ', 'PIN Hash', 'Salt', 'สร้างเมื่อ', 'อัปเดตเมื่อ', 'ต้องเปลี่ยน PIN'],
  HOLIDAY_HEADERS: ['Date', 'ชื่อวันหยุด'],
  SETTINGS_HEADERS: ['Key', 'Value', 'คำอธิบาย'],
  POSITIONS: [
    'นักเทคนิคการแพทย์(MT Fulltime)งานห้องปฏิบัติการเวชศาสตร์ชันสูตร',
    'นักเทคนิคการแพทย์(MT บุคลากรประจำคณะแพทย์ศาสตร์)',
    'พยาบาลวิชาชีพ(RN Parttime, บุคลากรประจำคณะแพทย์ศาสตร์)',
    'นักเทคนิคการแพทย์(MT Parttime)',
    'บุคลากรประจำคณะแพทย์ศาสตร์ ตำแหน่งอื่นๆ'
  ],
  ROOMS: [
    { name: 'ห้องเจาะเลือดอาคารผู้ป่วยนอก OPD', stations: ['จุดเจาะเลือด', 'จุดลงทะเบียนรายการตรวจ', 'จุดอื่นๆ (บัตรคิว, นำ-ส่ง สิ่งส่งตรวจ)'] },
    { name: 'ห้องเจาะเลือดอาคารกัลยาฯ กว.', stations: ['จุดเจาะเลือด', 'จุดลงทะเบียนรายการตรวจ', 'จุดอื่นๆ (บัตรคิว, นำ-ส่ง สิ่งส่งตรวจ)'] },
    { name: 'ห้องเจาะเลือด SMC', stations: ['จุดเจาะเลือด', 'จุดลงทะเบียนรายการตรวจ', 'จุดอื่นๆ (บัตรคิว, นำ-ส่ง สิ่งส่งตรวจ)'] }
  ],
  // วันธรรมดา: เลือกได้หลายช่วง / เสาร์-อาทิตย์และวันหยุดราชการ: เลือกได้ 1 ช่วง และจองได้ 1 เวรต่อวัน
  WEEKDAY_SLOTS: ['06:00-08:30', '08:30-12:30', '12:30-16:30', '16:30-สิ้นสุด'],
  SPECIAL_SLOTS: ['06:00-11:00', '06:00-12:00', '06:00-16:00', '06:00-สิ้นสุด'],
  // ช่วงเวลา → ลำดับคอลัมน์ (0=เช้า 1=สาย 2=บ่าย 3=นอกเวลาเย็น 4=ดึก) ตามระบบเดิม
  SLOT_COL: {
    '06:00-08:30': 0, '06:00-11:00': 0,
    '08:30-12:30': 1, '06:00-12:00': 1,
    '12:30-16:30': 2, '06:00-16:00': 2,
    '16:30-สิ้นสุด': 3,
    '06:00-สิ้นสุด': 4
  },
  SESSION_SECONDS: 6 * 60 * 60,
  MAX_FAILS: 5,
  LOCK_MINUTES: 15,
  MAX_LOCK_MINUTES: 360,
  PIN_ITERATIONS: 300,
  MAX_BODY: 60000,
  DEFAULT_SETTINGS: [
    ['BOOKING_OPEN', 'TRUE', 'เปิดรับจองเวร (TRUE/FALSE)'],
    ['BOOKING_MONTHS', '', 'เดือนที่เปิดให้จอง รูปแบบ yyyy-MM คั่นด้วย , (ว่าง = ทุกเดือนตั้งแต่วันนี้)'],
    ['NOTICE', 'บุคลากรทุกท่านจองเวลาปฏิบัติงานผ่านเอกสารอิเล็กทรอนิกส์ ส่งภายในวันที่ 26 ของทุกเดือน (หรือจนกว่าจะปิดรับ) เพื่อให้หัวหน้าหน่วยฯหรือผู้รับผิดชอบจัดทำตารางเวรให้เรียบร้อยและจัดสรรจุดปฏิบัติงานได้ทันเวลา', 'ข้อความประกาศท้ายหน้าเว็บ'],
    ['CONTACT', '63662/67204', 'เบอร์ติดต่อ'],
    ['BLOCK_HOLIDAYS', 'TRUE', 'วันหยุดนักขัตฤกษ์ปิดรับจอง (TRUE/FALSE) — ผู้ดูแลยังเพิ่มการจองให้ได้'],
    ['SPECIAL_DAY_RULE', 'FALSE', 'วันหยุดราชการใช้ช่วงเวลาแบบวันเสาร์-อาทิตย์ (TRUE/FALSE) — ข้อมูลเดิมจองแบบวันธรรมดา จึงปิดไว้'],
    ['CLOSE_AT', '', 'วันสุดท้ายที่รับจอง (yyyy-MM-dd) หลังวันนี้ปิดรับอัตโนมัติ (ว่าง = ไม่กำหนด)'],
    ['ALLOW_SELF_PIN', 'TRUE', 'ให้บุคลากรตั้ง PIN ครั้งแรกเอง (TRUE/FALSE) — ปิดเมื่อทุกคนตั้ง PIN แล้ว เพื่อกันคนอื่นตั้ง PIN แทน']
  ],
  // วันหยุดตั้งต้น (แก้ไขได้ในหน้าผู้ดูแล)
  DEFAULT_HOLIDAYS: [
    ['2026-10-13', 'วันนวมินทรมหาราช'],
    ['2026-10-23', 'วันปิยมหาราช'],
    ['2026-12-05', 'วันคล้ายวันพระบรมราชสมภพ ร.9 วันชาติ และวันพ่อแห่งชาติ'],
    ['2026-12-07', 'ชดเชยวันพ่อแห่งชาติ'],
    ['2026-12-10', 'วันรัฐธรรมนูญ'],
    ['2026-12-31', 'วันสิ้นปี'],
    ['2027-01-01', 'วันขึ้นปีใหม่'],
    ['2027-02-21', 'วันมาฆบูชา'],
    ['2027-02-22', 'ชดเชยวันมาฆบูชา'],
    ['2027-04-06', 'วันจักรี'],
    ['2027-04-13', 'วันสงกรานต์'],
    ['2027-04-14', 'วันสงกรานต์'],
    ['2027-04-15', 'วันสงกรานต์'],
    ['2027-05-04', 'วันฉัตรมงคล'],
    ['2027-05-20', 'วันวิสาขบูชา'],
    ['2027-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี'],
    ['2027-07-18', 'วันอาสาฬหบูชา'],
    ['2027-07-19', 'ชดเชยวันอาสาฬหบูชา'],
    ['2027-07-28', 'วันเฉลิมพระชนมพรรษา ร.10'],
    ['2027-08-12', 'วันแม่แห่งชาติ'],
    ['2027-10-13', 'วันนวมินทรมหาราช'],
    ['2027-10-23', 'วันปิยมหาราช'],
    ['2027-10-25', 'ชดเชยวันปิยมหาราช'],
    ['2027-12-05', 'วันพ่อแห่งชาติ'],
    ['2027-12-06', 'ชดเชยวันพ่อแห่งชาติ'],
    ['2027-12-10', 'วันรัฐธรรมนูญ'],
    ['2027-12-31', 'วันสิ้นปี']
  ]
};

/* =========================== Entry points =========================== */

const API_ = {
  getPublicInfo: getPublicInfo_,
  login: login_,
  setFirstPin: setFirstPin_,
  requestAccount: requestAccount_,
  changePin: changePin_,
  logout: logout_,
  getMyBookings: getMyBookings_,
  saveBooking: saveBooking_,
  saveBookings: saveBookings_,
  cancelBooking: cancelBooking_,
  adminLogin: adminLogin_,
  adminGetMonth: adminGetMonth_,
  adminSaveBooking: adminSaveBooking_,
  adminDeleteBooking: adminDeleteBooking_,
  adminListStaff: adminListStaff_,
  adminSaveStaff: adminSaveStaff_,
  adminResetPin: adminResetPin_,
  adminSaveHolidays: adminSaveHolidays_,
  adminSaveSettings: adminSaveSettings_,
  adminFetchHolidays: adminFetchHolidays_
};

function doGet() {
  return json_({ ok: true, data: { service: 'BRSbooking API', time: nowStr_() } });
}

function doPost(e) {
  let out;
  try {
    const body = (e && e.postData && e.postData.contents) || '';
    if (!body) throw appError_('ไม่มีข้อมูลคำขอ', 'BAD_REQUEST');
    if (body.length > CONFIG.MAX_BODY) throw appError_('ข้อมูลคำขอใหญ่เกินไป', 'BAD_REQUEST');
    let req;
    try { req = JSON.parse(body); } catch (err) { throw appError_('รูปแบบคำขอไม่ถูกต้อง', 'BAD_REQUEST'); }
    if (!req || typeof req !== 'object' || Array.isArray(req)) throw appError_('รูปแบบคำขอไม่ถูกต้อง', 'BAD_REQUEST');
    const secret = prop_('API_SECRET');
    if (secret && req.secret !== secret) throw appError_('ไม่ได้รับอนุญาต', 'FORBIDDEN');
    const fn = String(req.fn || '');
    if (!Object.prototype.hasOwnProperty.call(API_, fn)) throw appError_('ไม่พบคำสั่ง', 'BAD_REQUEST');
    const args = req.args && typeof req.args === 'object' && !Array.isArray(req.args) ? req.args : {};
    ensureSchema_();
    out = { ok: true, data: API_[fn](args) };
  } catch (err) {
    out = { ok: false, error: err && err.code ? err.message : 'เกิดข้อผิดพลาดในระบบ: ' + (err && err.message), code: (err && err.code) || 'ERROR' };
  }
  return json_(out);
}

/** รันครั้งแรกจากหน้าแก้โค้ด เพื่ออนุญาตสิทธิ์และสร้างแท็บ/คอลัมน์ที่ต้องใช้ */
function setup() {
  CacheService.getScriptCache().remove('schema_v2');
  ensureSchema_();
  const ss = ss_();
  Logger.log('พร้อมใช้งาน: ' + ss.getName());
  Logger.log('ADMIN_USER ตั้งแล้ว: ' + (prop_('ADMIN_USER') ? 'ใช่' : 'ยังไม่ตั้ง'));
  Logger.log('ADMIN_PASS ตั้งแล้ว: ' + (prop_('ADMIN_PASS') ? 'ใช่' : 'ยังไม่ตั้ง'));
  try { Logger.log('ปฏิทินวันหยุดไทย: ' + (CalendarApp.getCalendarById(CONFIG.TH_HOLIDAY_CAL) ? 'พร้อมใช้' : 'ไม่พบ')); } catch (e) { Logger.log('ปฏิทินวันหยุดไทย: ยังไม่ได้อนุญาตสิทธิ์'); }
}

/* =========================== Public / user API =========================== */

function getPublicInfo_() {
  const settings = readSettings_();
  const staff = readStaff_().filter(function (s) { return s.status === 'active'; })
    .map(function (s) { return { id: s.id, name: s.firstName + ' ' + s.lastName, position: s.position }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  return {
    title: CONFIG.APP_TITLE,
    org: CONFIG.ORG,
    today: todayKey_(),
    positions: CONFIG.POSITIONS,
    rooms: CONFIG.ROOMS,
    weekdaySlots: CONFIG.WEEKDAY_SLOTS,
    specialSlots: CONFIG.SPECIAL_SLOTS,
    holidays: readHolidays_(),
    settings: publicSettings_(settings),
    staff: staff
  };
}

function login_(a) {
  const staff = findStaff_(str_(a.staffId));
  if (!staff || staff.status !== 'active') throw appError_('ไม่พบรายชื่อ หรือบัญชียังไม่ได้รับการอนุมัติ', 'AUTH');
  if (!staff.hash) throw appError_('ยังไม่ได้ตั้ง PIN กรุณาตั้ง PIN ครั้งแรก', 'NO_PIN');
  checkLocked_('u_' + staff.id);
  if (hashPin_(str_(a.pin), staff.salt) !== staff.hash) {
    registerFail_('u_' + staff.id);
    throw appError_('PIN ไม่ถูกต้อง', 'AUTH');
  }
  clearFails_('u_' + staff.id);
  return { token: newUserSession_(staff), user: publicUser_(staff), mustChange: !!staff.mustChange };
}

function setFirstPin_(a) {
  if (readSettings_().ALLOW_SELF_PIN !== 'TRUE') throw appError_('ระบบปิดการตั้ง PIN ด้วยตนเอง กรุณาติดต่อผู้ดูแลเพื่อขอ PIN ชั่วคราว', 'SELF_PIN_OFF');
  const pin = validPin_(a.pin, true);
  rateLimit_('setpin_all', 60, 3600, 'มีการตั้ง PIN จำนวนมาก กรุณาลองใหม่ภายหลัง');
  return withLock_(function () {
    const staff = findStaff_(str_(a.staffId));
    if (!staff || staff.status !== 'active') throw appError_('ไม่พบรายชื่อ หรือบัญชียังไม่ได้รับการอนุมัติ', 'AUTH');
    if (staff.hash) throw appError_('บัญชีนี้ตั้ง PIN แล้ว กรุณาเข้าสู่ระบบด้วย PIN เดิม หรือติดต่อผู้ดูแลเพื่อรีเซ็ต', 'HAS_PIN');
    const salt = newSalt_();
    staff.salt = salt;
    staff.hash = hashPin_(pin, salt);
    staff.mustChange = false;
    writeStaff_(staff);
    return { token: newUserSession_(staff), user: publicUser_(staff) };
  });
}

function requestAccount_(a) {
  const firstName = cleanName_(a.firstName, 'ชื่อ');
  const lastName = cleanName_(a.lastName, 'นามสกุล');
  const position = validPosition_(a.position);
  const pin = validPin_(a.pin, true);
  rateLimit_('req_all', 30, 3600, 'มีคำขอจำนวนมาก กรุณาลองใหม่ภายหลัง');
  return withLock_(function () {
    const exists = readStaff_().some(function (s) { return s.key === nameKey_(firstName, lastName); });
    if (exists) throw appError_('มีชื่อนี้ในระบบแล้ว หากเข้าไม่ได้กรุณาติดต่อผู้ดูแล', 'DUPLICATE');
    const salt = newSalt_();
    const staff = {
      id: newId_('S'), firstName: firstName, lastName: lastName, position: position,
      status: 'pending', salt: salt, hash: hashPin_(pin, salt), createdAt: nowStr_(), updatedAt: nowStr_(), mustChange: false
    };
    appendStaff_(staff);
    return { status: 'pending' };
  });
}

function changePin_(a) {
  const staff = requireUser_(a.token);
  const pin = validPin_(a.newPin, true);
  checkLocked_('u_' + staff.id);
  if (hashPin_(str_(a.oldPin), staff.salt) !== staff.hash) { registerFail_('u_' + staff.id); throw appError_('PIN เดิมไม่ถูกต้อง', 'AUTH'); }
  if (str_(a.oldPin) === pin) throw appError_('PIN ใหม่ต้องไม่ซ้ำกับ PIN เดิม', 'BAD_REQUEST');
  return withLock_(function () {
    staff.mustChange = false;
    staff.salt = newSalt_();
    staff.hash = hashPin_(pin, staff.salt);
    writeStaff_(staff);
    return { token: newUserSession_(staff) };
  });
}

function logout_(a) {
  const t = str_(a.token);
  if (t) {
    CacheService.getScriptCache().remove('usr_' + t);
    CacheService.getScriptCache().remove('adm_' + t);
  }
  return { done: true };
}

function getMyBookings_(a) {
  const staff = requireUser_(a.token);
  const range = monthRange_(a.month, a.upcoming);
  const mine = function (b) { return b.key === staff.key && b.date >= range.from && b.date <= range.to; };
  const bookings = readBookings_().filter(mine).sort(byDate_);
  const leaves = readLeaves_().filter(mine).sort(byDate_);
  return { user: publicUser_(staff), today: todayKey_(), mustChange: !!staff.mustChange, from: range.from, to: range.to, bookings: bookings.map(cleanBooking_), leaves: leaves.map(cleanBooking_) };
}

function saveBooking_(a) {
  const staff = requireUser_(a.token);
  const input = validBookingInput_(a, false);
  const settings = readSettings_();
  checkUserCanChange_(input.date, settings, 'จอง');
  return withLock_(function () {
    const all = readBookings_();
    let existing = null;
    if (a.id) {
      existing = findById_(all, str_(a.id));
      if (existing.key !== staff.key) throw appError_('คุณไม่ได้รับอนุญาตให้แก้ไขการจองนี้', 'FORBIDDEN');
      checkUserCanChange_(existing.date, settings, 'แก้ไข');
    }
    checkDuplicate_(all, staff.key, input, existing ? existing.id : null, settings);
    const row = bookingRow_(input, staff, existing ? existing.id : newId_('B'));
    writeBooking_(row, existing);
    return { id: row[12], message: existing ? 'แก้ไขการจองสำเร็จ' : 'บันทึกการจองสำเร็จ' };
  });
}

/** จองหลายวันพร้อมกัน (ห้อง/จุด/ช่วงเวลาเดียวกัน) — ตรวจกติกาทีละวัน บันทึกเฉพาะวันที่ผ่าน */
function saveBookings_(a) {
  const staff = requireUser_(a.token);
  if (!Array.isArray(a.dates) || !a.dates.length) throw appError_('กรุณาเลือกวันที่อย่างน้อย 1 วัน', 'BAD_REQUEST');
  if (a.dates.length > 31) throw appError_('เลือกได้ไม่เกิน 31 วันต่อครั้ง', 'BAD_REQUEST');
  const settings = readSettings_();
  const dates = [];
  a.dates.forEach(function (d) { const k = validDate_(d); if (dates.indexOf(k) < 0) dates.push(k); });
  dates.sort();
  return withLock_(function () {
    const all = readBookings_();
    const results = [];
    dates.forEach(function (date) {
      try {
        const input = validBookingInput_({ date: date, room: a.room, station: a.station, slots: a.slots }, false);
        checkUserCanChange_(date, settings, 'จอง');
        checkDuplicate_(all, staff.key, input, null, settings);
        const row = bookingRow_(input, staff, newId_('B'));
        writeBooking_(row, null);
        all.push({ id: row[12], key: staff.key, date: date, slots: input.slots });
        results.push({ date: date, ok: true });
      } catch (err) {
        if (!err.code) throw err;
        results.push({ date: date, ok: false, error: err.message, code: err.code });
      }
    });
    const ok = results.filter(function (r) { return r.ok; }).length;
    return { results: results, saved: ok, failed: results.length - ok, message: 'บันทึกการจอง ' + ok + ' วัน' + (results.length - ok ? ' (ไม่สำเร็จ ' + (results.length - ok) + ' วัน)' : '') };
  });
}

function cancelBooking_(a) {
  const staff = requireUser_(a.token);
  const settings = readSettings_();
  return withLock_(function () {
    const b = findById_(readBookings_(), str_(a.id));
    if (b.key !== staff.key) throw appError_('คุณไม่ได้รับอนุญาตให้ยกเลิกการจองนี้', 'FORBIDDEN');
    if (b.date < todayKey_()) throw appError_('ไม่สามารถยกเลิกเวรที่ผ่านมาแล้ว', 'CLOSED');
    const open = isMonthOpen_(b.date, settings);
    const reason = cleanText_(a.reason, 300);
    if (!open && !reason) throw appError_('รอบจองเดือนนี้ปิดแล้ว การยกเลิกจะบันทึกเป็นการลาเวร กรุณาระบุเหตุผล', 'NEED_REASON');
    const type = open ? 'ยกเลิกการจอง' : 'ลาเวร';
    moveToLeave_(b, type, reason, staff.firstName + ' ' + staff.lastName);
    return { type: type, message: type === 'ลาเวร' ? 'บันทึกการลาเวรเรียบร้อย' : 'ยกเลิกการจองเรียบร้อย' };
  });
}

/* =========================== Admin API =========================== */

function adminLogin_(a) {
  const user = prop_('ADMIN_USER');
  const pass = prop_('ADMIN_PASS');
  if (!user || !pass) throw appError_('ยังไม่ได้ตั้งรหัสผู้ดูแล (ADMIN_USER / ADMIN_PASS) ใน Script Properties', 'NOT_CONFIGURED');
  // ล็อกตามชื่อผู้ใช้ที่พิมพ์ — คนที่ไม่รู้ชื่อผู้ใช้จริงจึงทำให้บัญชีผู้ดูแลถูกล็อกไม่ได้
  const lockKey = 'admin_' + shortHash_(str_(a.username).toLowerCase());
  checkLocked_(lockKey);
  if (str_(a.username) !== user || str_(a.password) !== pass) {
    registerFail_(lockKey);
    throw appError_('ชื่อผู้ใช้หรือรหัสผ่านผู้ดูแลไม่ถูกต้อง', 'AUTH');
  }
  clearFails_(lockKey);
  const token = newToken_();
  CacheService.getScriptCache().put('adm_' + token, JSON.stringify({ p: shortHash_(user + ':' + pass) }), CONFIG.SESSION_SECONDS);
  return { token: token };
}

function adminGetMonth_(a) {
  requireAdmin_(a.token);
  const range = a.from || a.to ? dateRange_(a.from, a.to) : monthRange_(a.month);
  const inRange = function (b) { return b.date >= range.from && b.date <= range.to; };
  return {
    from: range.from,
    to: range.to,
    bookings: readBookings_().filter(inRange).sort(byDate_).map(cleanBooking_),
    leaves: readLeaves_().filter(inRange).sort(byDate_).map(cleanBooking_),
    staff: readStaff_().map(adminStaffView_),
    holidays: readHolidays_(),
    settings: publicSettings_(readSettings_())
  };
}

function adminSaveBooking_(a) {
  requireAdmin_(a.token);
  const input = validBookingInput_(a, true);
  const settings = readSettings_();
  return withLock_(function () {
    const staff = findStaff_(str_(a.staffId));
    if (!staff) throw appError_('ไม่พบรายชื่อบุคลากร', 'NOT_FOUND');
    const all = readBookings_();
    const existing = a.id ? findById_(all, str_(a.id)) : null;
    if (!a.force) checkDuplicate_(all, staff.key, input, existing ? existing.id : null, settings);
    const row = bookingRow_(input, staff, existing ? existing.id : newId_('B'));
    writeBooking_(row, existing);
    return { id: row[12], message: existing ? 'แก้ไขการจองสำเร็จ' : 'เพิ่มการจองสำเร็จ' };
  });
}

function adminDeleteBooking_(a) {
  requireAdmin_(a.token);
  const reason = cleanText_(a.reason, 300);
  const type = a.type === 'ลาเวร' ? 'ลาเวร' : 'ลบโดยผู้ดูแล';
  return withLock_(function () {
    const b = findById_(readBookings_(), str_(a.id));
    moveToLeave_(b, type, reason, 'ผู้ดูแลระบบ');
    return { message: 'ดำเนินการเรียบร้อย' };
  });
}

function adminListStaff_(a) {
  requireAdmin_(a.token);
  return readStaff_().map(adminStaffView_);
}

function adminSaveStaff_(a) {
  requireAdmin_(a.token);
  const firstName = cleanName_(a.firstName, 'ชื่อ');
  const lastName = cleanName_(a.lastName, 'นามสกุล');
  const position = validPosition_(a.position);
  const status = ['active', 'pending', 'inactive'].indexOf(a.status) >= 0 ? a.status : 'active';
  return withLock_(function () {
    const list = readStaff_();
    const key = nameKey_(firstName, lastName);
    const clash = list.filter(function (s) { return s.key === key && s.id !== a.id; });
    if (clash.length) throw appError_('มีชื่อนี้ในระบบแล้ว', 'DUPLICATE');
    if (a.id) {
      const s = findStaff_(str_(a.id), list);
      if (!s) throw appError_('ไม่พบรายชื่อบุคลากร', 'NOT_FOUND');
      let renamed = 0;
      if (s.key !== key || s.position !== position) renamed = renameInBookings_(s, firstName, lastName, position);
      s.firstName = firstName; s.lastName = lastName; s.position = position; s.status = status;
      writeStaff_(s);
      return { id: s.id, renamed: renamed, message: 'บันทึกข้อมูลบุคลากรแล้ว' };
    }
    const staff = { id: newId_('S'), firstName: firstName, lastName: lastName, position: position, status: status, salt: '', hash: '', createdAt: nowStr_(), updatedAt: nowStr_() };
    appendStaff_(staff);
    return { id: staff.id, message: 'เพิ่มบุคลากรแล้ว' };
  });
}

function adminResetPin_(a) {
  requireAdmin_(a.token);
  return withLock_(function () {
    const s = findStaff_(str_(a.id));
    if (!s) throw appError_('ไม่พบรายชื่อบุคลากร', 'NOT_FOUND');
    clearFails_('u_' + s.id);
    if (readSettings_().ALLOW_SELF_PIN === 'TRUE') {
      s.hash = ''; s.salt = ''; s.mustChange = false;
      writeStaff_(s);
      return { message: 'รีเซ็ต PIN แล้ว ผู้ใช้จะตั้ง PIN ใหม่ได้เมื่อเข้าสู่ระบบครั้งถัดไป' };
    }
    const temp = tempPin_();
    s.salt = newSalt_(); s.hash = hashPin_(temp, s.salt); s.mustChange = true;
    writeStaff_(s);
    return { tempPin: temp, message: 'ออก PIN ชั่วคราวแล้ว แจ้ง PIN นี้ให้ผู้ใช้โดยตรง ผู้ใช้ต้องเปลี่ยน PIN เมื่อเข้าสู่ระบบ' };
  });
}

function adminSaveHolidays_(a) {
  requireAdmin_(a.token);
  if (!Array.isArray(a.holidays)) throw appError_('ข้อมูลวันหยุดไม่ถูกต้อง', 'BAD_REQUEST');
  if (a.holidays.length > 500) throw appError_('จำนวนวันหยุดมากเกินไป', 'BAD_REQUEST');
  const seen = {};
  const rows = [];
  a.holidays.forEach(function (h) {
    const date = validDate_(h && h.date);
    const name = cleanText_(h && h.name, 120) || 'วันหยุด';
    if (seen[date]) throw appError_('วันที่ ' + date + ' ซ้ำกัน', 'BAD_REQUEST');
    seen[date] = true;
    rows.push([date, safeCell_(name)]);
  });
  rows.sort(function (x, y) { return x[0] < y[0] ? -1 : 1; });
  return withLock_(function () {
    const sh = sheet_(CONFIG.SHEETS.HOLIDAYS);
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
    if (rows.length) {
      sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, rows.length, 2).setValues(rows);
    }
    return { count: rows.length, holidays: readHolidays_() };
  });
}

/** ดึงวันหยุดจากปฏิทินวันหยุดไทยของ Google (ผู้ดูแลตรวจแล้วกดบันทึกเอง ไม่บันทึกอัตโนมัติ) */
function adminFetchHolidays_(a) {
  requireAdmin_(a.token);
  const year = Number(a.year);
  if (!(year >= 2020 && year <= 2100)) throw appError_('ปีไม่ถูกต้อง', 'BAD_REQUEST');
  let cal = null;
  try { cal = CalendarApp.getCalendarById(CONFIG.TH_HOLIDAY_CAL); } catch (e) { cal = null; }
  if (!cal) throw appError_('เปิดปฏิทินวันหยุดไทยของ Google ไม่ได้ กรุณารัน setup() อีกครั้งเพื่ออนุญาตสิทธิ์ปฏิทิน', 'NOT_CONFIGURED');
  const events = cal.getEvents(new Date(year, 0, 1), new Date(year + 1, 0, 1));
  const seen = {};
  const out = [];
  events.forEach(function (ev) {
    const date = Utilities.formatDate(ev.getStartTime(), CONFIG.TZ, 'yyyy-MM-dd');
    const desc = String(ev.getDescription() || '');
    const official = !/observance|การเฉลิมฉลอง|วันสำคัญ/i.test(desc);
    const name = cleanText_(ev.getTitle(), 120);
    if (seen[date + name]) return;
    seen[date + name] = true;
    out.push({ date: date, name: name, official: official });
  });
  out.sort(function (x, y) { return x.date < y.date ? -1 : 1; });
  return { year: year, holidays: out };
}

function adminSaveSettings_(a) {
  requireAdmin_(a.token);
  const s = a.settings || {};
  const months = str_(s.BOOKING_MONTHS).split(',').map(function (m) { return m.trim(); }).filter(String);
  months.forEach(function (m) { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw appError_('รูปแบบเดือนไม่ถูกต้อง: ' + m + ' (ต้องเป็น yyyy-MM)', 'BAD_REQUEST'); });
  const values = {
    BOOKING_OPEN: s.BOOKING_OPEN === true || s.BOOKING_OPEN === 'TRUE' ? 'TRUE' : 'FALSE',
    BOOKING_MONTHS: months.join(','),
    NOTICE: safeCell_(cleanText_(s.NOTICE, 1000)),
    CONTACT: safeCell_(cleanText_(s.CONTACT, 100)),
    SPECIAL_DAY_RULE: s.SPECIAL_DAY_RULE === true || s.SPECIAL_DAY_RULE === 'TRUE' ? 'TRUE' : 'FALSE',
    BLOCK_HOLIDAYS: s.BLOCK_HOLIDAYS === false || s.BLOCK_HOLIDAYS === 'FALSE' ? 'FALSE' : 'TRUE',
    CLOSE_AT: s.CLOSE_AT ? validDate_(s.CLOSE_AT) : '',
    ALLOW_SELF_PIN: s.ALLOW_SELF_PIN === false || s.ALLOW_SELF_PIN === 'FALSE' ? 'FALSE' : 'TRUE'
  };
  return withLock_(function () {
    const sh = sheet_(CONFIG.SHEETS.SETTINGS);
    const data = sh.getDataRange().getValues();
    Object.keys(values).forEach(function (k) {
      let found = false;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === k) { sh.getRange(i + 1, 2).setValue(values[k]); found = true; break; }
      }
      if (!found) sh.appendRow([k, values[k], '']);
    });
    return { settings: publicSettings_(readSettings_()) };
  });
}

/* =========================== Booking rules =========================== */

function validBookingInput_(a, isAdmin) {
  const date = validDate_(a.date);
  if (!isAdmin) {
    const st = readSettings_();
    const hol = st.BLOCK_HOLIDAYS === 'TRUE' && readHolidays_().filter(function (h) { return h.date === date; })[0];
    if (hol) throw appError_('วันที่ ' + date + ' เป็นวันหยุดนักขัตฤกษ์ (' + hol.name + ') ปิดรับจอง', 'HOLIDAY');
  }
  const room = CONFIG.ROOMS.filter(function (r) { return r.name === a.room; })[0];
  if (!room) throw appError_('กรุณาเลือกห้อง', 'BAD_REQUEST');
  if (room.stations.indexOf(a.station) < 0) throw appError_('กรุณาเลือกจุดปฏิบัติงาน', 'BAD_REQUEST');
  if (!Array.isArray(a.slots) || !a.slots.length) throw appError_('กรุณาเลือกช่วงเวลาอย่างน้อย 1 ช่วง', 'BAD_REQUEST');
  const slots = [];
  a.slots.forEach(function (s) { if (slots.indexOf(s) < 0) slots.push(s); });
  const special = isSpecialDay_(date, readHolidays_(), readSettings_());
  const allowed = special ? CONFIG.SPECIAL_SLOTS : CONFIG.WEEKDAY_SLOTS;
  slots.forEach(function (s) { if (allowed.indexOf(s) < 0) throw appError_('ช่วงเวลา ' + s + ' ใช้ไม่ได้กับวันที่เลือก', 'BAD_REQUEST'); });
  if (special && slots.length > 1) throw appError_('วันเสาร์-อาทิตย์และวันหยุดราชการจองได้เพียง 1 เวรเท่านั้น', 'RULE');
  slots.sort(function (x, y) { return CONFIG.SLOT_COL[x] - CONFIG.SLOT_COL[y]; });
  return { date: date, room: room.name, station: a.station, slots: slots, special: special };
}

function checkUserCanChange_(date, settings, verb) {
  if (date < todayKey_()) throw appError_('ไม่สามารถ' + verb + 'เวรย้อนหลังได้', 'CLOSED');
  if (!isMonthOpen_(date, settings)) throw appError_('ยังไม่เปิดรับจองเวรของเดือนนี้ หรือปิดรับจองแล้ว', 'CLOSED');
}

function checkDuplicate_(all, key, input, excludeId, settings) {
  const mine = all.filter(function (b) { return b.key === key && b.date === input.date && b.id !== excludeId; });
  if (!mine.length) return;
  if (input.special) throw appError_('วันเสาร์-อาทิตย์และวันหยุดราชการจองได้เพียง 1 เวรเท่านั้น (มีการจองในวันนี้แล้ว)', 'DUPLICATE');
  const used = {};
  mine.forEach(function (b) { b.slots.forEach(function (s) { used[CONFIG.SLOT_COL[s]] = s; }); });
  const clash = input.slots.filter(function (s) { return used.hasOwnProperty(CONFIG.SLOT_COL[s]); });
  if (clash.length) throw appError_('พบการจองซ้ำซ้อนในวันเดียวกัน (ช่วง ' + clash.join(', ') + ') กรุณาตรวจสอบอีกครั้ง', 'DUPLICATE');
}

function isSpecialDay_(date, holidays, settings) {
  const p = date.split('-').map(Number);
  const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  if (dow === 0 || dow === 6) return true;
  if (!settings || settings.SPECIAL_DAY_RULE !== 'TRUE') return false;
  return holidays.some(function (h) { return h.date === date; });
}

function isMonthOpen_(date, settings) {
  if (settings.BOOKING_OPEN !== 'TRUE') return false;
  if (settings.CLOSE_AT && todayKey_() > settings.CLOSE_AT) return false;
  const months = str_(settings.BOOKING_MONTHS).split(',').map(function (m) { return m.trim(); }).filter(String);
  return !months.length || months.indexOf(date.slice(0, 7)) >= 0;
}

function bookingRow_(input, staff, id) {
  const cols = ['', '', '', '', ''];
  input.slots.forEach(function (s) { cols[CONFIG.SLOT_COL[s]] = s; });
  return [nowStr_(), input.date, staff.firstName, staff.lastName, staff.position, input.room, input.station]
    .concat(cols).concat([id]);
}

function writeBooking_(row, existing) {
  const sh = sheet_(CONFIG.SHEETS.BOOKING);
  if (existing) {
    const r = locateRow_(sh, existing.id, 13);
    sh.getRange(r, 1, 1, row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
}

function moveToLeave_(b, type, reason, by) {
  const cols = ['', '', '', '', ''];
  b.slots.forEach(function (s) { cols[CONFIG.SLOT_COL[s]] = s; });
  const leaveRow = [nowStr_(), b.date, b.firstName, b.lastName, b.position, b.room, b.station]
    .concat(cols).concat([b.id, type, safeCell_(reason || ''), safeCell_(by)]);
  sheet_(CONFIG.SHEETS.LEAVE).appendRow(leaveRow);
  const sh = sheet_(CONFIG.SHEETS.BOOKING);
  sh.deleteRow(locateRow_(sh, b.id, 13));
}

function renameInBookings_(oldStaff, firstName, lastName, position) {
  let n = 0;
  [CONFIG.SHEETS.BOOKING, CONFIG.SHEETS.LEAVE].forEach(function (name, idx) {
    const sh = sheet_(name);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (nameKey_(data[i][2], data[i][3]) === oldStaff.key) {
        sh.getRange(i + 1, 3, 1, 3).setValues([[safeCell_(firstName), safeCell_(lastName), position]]);
        if (idx === 0) n++;
      }
    }
  });
  return n;
}

/* =========================== Data access =========================== */

function ss_() {
  const id = prop_('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw appError_('ไม่พบแท็บ "' + name + '" กรุณารัน setup()', 'NOT_CONFIGURED');
  return sh;
}

function ensureSchema_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('schema_v2')) return;
  withLock_(function () {
    const ss = ss_();
    const booking = ensureSheet_(ss, CONFIG.SHEETS.BOOKING, CONFIG.BOOKING_HEADERS);
    ensureSheet_(ss, CONFIG.SHEETS.LEAVE, CONFIG.LEAVE_HEADERS);
    fillMissingIds_(booking, 13, 'B');
    fillMissingIds_(ss.getSheetByName(CONFIG.SHEETS.LEAVE), 13, 'L');
    if (!ss.getSheetByName(CONFIG.SHEETS.SETTINGS)) {
      const sh = ss.insertSheet(CONFIG.SHEETS.SETTINGS);
      sh.getRange(1, 1, 1, 3).setValues([CONFIG.SETTINGS_HEADERS]);
      sh.getRange(2, 1, CONFIG.DEFAULT_SETTINGS.length, 3).setValues(CONFIG.DEFAULT_SETTINGS);
    }
    if (!ss.getSheetByName(CONFIG.SHEETS.HOLIDAYS)) {
      const sh = ss.insertSheet(CONFIG.SHEETS.HOLIDAYS);
      sh.getRange(1, 1, 1, 2).setValues([CONFIG.HOLIDAY_HEADERS]);
      sh.getRange(2, 1, CONFIG.DEFAULT_HOLIDAYS.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, CONFIG.DEFAULT_HOLIDAYS.length, 2).setValues(CONFIG.DEFAULT_HOLIDAYS);
    }
    if (!ss.getSheetByName(CONFIG.SHEETS.STAFF)) {
      const sh = ss.insertSheet(CONFIG.SHEETS.STAFF);
      sh.getRange(1, 1, 1, CONFIG.STAFF_HEADERS.length).setValues([CONFIG.STAFF_HEADERS]);
      seedStaffFromBookings_(sh, booking);
    } else {
      ensureSheet_(ss, CONFIG.SHEETS.STAFF, CONFIG.STAFF_HEADERS);
    }
  });
  cache.put('schema_v2', '1', 21600);
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const width = Math.max(sh.getLastColumn(), 1);
  const current = sh.getRange(1, 1, 1, width).getValues()[0];
  for (let c = 0; c < headers.length; c++) {
    if (!current[c]) sh.getRange(1, c + 1).setValue(headers[c]);
  }
  return sh;
}

function fillMissingIds_(sh, col, prefix) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const range = sh.getRange(2, col, last - 1, 1);
  const ids = range.getValues();
  const dates = sh.getRange(2, 2, last - 1, 1).getValues();
  let changed = false;
  for (let i = 0; i < ids.length; i++) {
    if (!ids[i][0] && dates[i][0] !== '') { ids[i][0] = newId_(prefix); changed = true; }
  }
  if (changed) range.setValues(ids);
}

function seedStaffFromBookings_(staffSheet, bookingSheet) {
  const data = bookingSheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const first = norm_(data[i][2]);
    const last = norm_(data[i][3]);
    if (!first) continue;
    const k = nameKey_(first, last);
    const ts = String(data[i][0]);
    if (!map[k] || ts >= map[k].ts) map[k] = { first: first, last: last, position: norm_(data[i][4]), ts: ts };
  }
  const rows = Object.keys(map).sort().map(function (k) {
    const m = map[k];
    return [newId_('S'), m.first, m.last, m.position, 'active', '', '', nowStr_(), nowStr_(), ''];
  });
  if (rows.length) staffSheet.getRange(2, 1, rows.length, CONFIG.STAFF_HEADERS.length).setValues(rows);
}

function readBookings_() {
  return readBookingLike_(CONFIG.SHEETS.BOOKING, false);
}

function readLeaves_() {
  return readBookingLike_(CONFIG.SHEETS.LEAVE, true);
}

function readBookingLike_(name, isLeave) {
  const sh = sheet_(name);
  const data = sh.getDataRange().getValues();
  const out = [];
  let missing = false;
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const date = dateKey_(r[1]);
    if (!date) continue;
    if (!r[12]) { missing = true; continue; }
    const slots = [];
    for (let c = 7; c <= 11; c++) { const v = norm_(r[c]); if (v) slots.push(v); }
    const b = {
      id: String(r[12]), timestamp: tsStr_(r[0]), date: date,
      firstName: norm_(r[2]), lastName: norm_(r[3]), position: norm_(r[4]),
      room: norm_(r[5]), station: norm_(r[6]), slots: slots
    };
    b.key = nameKey_(b.firstName, b.lastName);
    if (isLeave) { b.type = norm_(r[13]); b.reason = String(r[14] || ''); b.by = String(r[15] || ''); }
    out.push(b);
  }
  if (missing) {
    // แถวที่ถูกเพิ่มโดยระบบเดิม (ไม่มี ID) — เติม ID แล้วอ่านใหม่
    withLock_(function () { fillMissingIds_(sh, 13, isLeave ? 'L' : 'B'); });
    return readBookingLike_(name, isLeave);
  }
  return out;
}

function cleanBooking_(b) {
  const o = {};
  ['id', 'timestamp', 'date', 'firstName', 'lastName', 'position', 'room', 'station', 'slots', 'type', 'reason', 'by']
    .forEach(function (k) { if (b[k] !== undefined) o[k] = b[k]; });
  return o;
}

function findById_(list, id) {
  const b = list.filter(function (x) { return x.id === id; })[0];
  if (!b) throw appError_('ไม่พบข้อมูลการจอง (อาจถูกยกเลิกไปแล้ว) กรุณารีเฟรช', 'NOT_FOUND');
  return b;
}

function locateRow_(sh, id, col) {
  const last = sh.getLastRow();
  const ids = sh.getRange(1, col, last, 1).getValues();
  for (let i = 1; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 1;
  throw appError_('ไม่พบข้อมูลการจอง (อาจถูกยกเลิกไปแล้ว) กรุณารีเฟรช', 'NOT_FOUND');
}

function readStaff_() {
  const data = sheet_(CONFIG.SHEETS.STAFF).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    const s = {
      id: String(r[0]), firstName: norm_(r[1]), lastName: norm_(r[2]), position: norm_(r[3]),
      status: norm_(r[4]) || 'active', hash: String(r[5] || ''), salt: String(r[6] || ''),
      createdAt: tsStr_(r[7]), updatedAt: tsStr_(r[8]), mustChange: r[9] === true || String(r[9]).toUpperCase() === 'TRUE', row: i + 1
    };
    s.key = nameKey_(s.firstName, s.lastName);
    out.push(s);
  }
  return out;
}

function findStaff_(id, list) {
  if (!id) return null;
  return (list || readStaff_()).filter(function (s) { return s.id === id; })[0] || null;
}

function writeStaff_(s) {
  const sh = sheet_(CONFIG.SHEETS.STAFF);
  const row = locateRow_(sh, s.id, 1);
  s.updatedAt = nowStr_();
  sh.getRange(row, 6, 1, 2).setNumberFormat('@');
  sh.getRange(row, 1, 1, 10).setValues([[s.id, safeCell_(s.firstName), safeCell_(s.lastName), s.position, s.status, s.hash, s.salt, s.createdAt, s.updatedAt, s.mustChange ? 'TRUE' : '']]);
}

function appendStaff_(s) {
  const sh = sheet_(CONFIG.SHEETS.STAFF);
  sh.getRange(sh.getLastRow() + 1, 6, 1, 2).setNumberFormat('@');
  sh.appendRow([s.id, safeCell_(s.firstName), safeCell_(s.lastName), s.position, s.status, s.hash, s.salt, s.createdAt, s.updatedAt, s.mustChange ? 'TRUE' : '']);
}

function adminStaffView_(s) {
  return { id: s.id, firstName: s.firstName, lastName: s.lastName, position: s.position, status: s.status, hasPin: !!s.hash, mustChange: !!s.mustChange, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

function publicUser_(s) {
  return { id: s.id, firstName: s.firstName, lastName: s.lastName, position: s.position };
}

function readHolidays_() {
  const data = sheet_(CONFIG.SHEETS.HOLIDAYS).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const d = dateKey_(data[i][0]);
    if (d) out.push({ date: d, name: norm_(data[i][1]) });
  }
  return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}

function readSettings_() {
  const s = {};
  CONFIG.DEFAULT_SETTINGS.forEach(function (d) { s[d[0]] = d[1]; });
  const data = sheet_(CONFIG.SHEETS.SETTINGS).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const v = data[i][1];
    if (data[i][0]) s[String(data[i][0])] = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v instanceof Date ? dateKey_(v) : String(v);
  }
  s.BOOKING_OPEN = String(s.BOOKING_OPEN).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
  s.SPECIAL_DAY_RULE = String(s.SPECIAL_DAY_RULE).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
  s.BLOCK_HOLIDAYS = String(s.BLOCK_HOLIDAYS).toUpperCase() === 'FALSE' ? 'FALSE' : 'TRUE';
  s.ALLOW_SELF_PIN = String(s.ALLOW_SELF_PIN).toUpperCase() === 'FALSE' ? 'FALSE' : 'TRUE';
  s.CLOSE_AT = dateKey_(s.CLOSE_AT) || '';
  return s;
}

function publicSettings_(s) {
  return {
    bookingOpen: s.BOOKING_OPEN === 'TRUE',
    bookingMonths: str_(s.BOOKING_MONTHS).split(',').map(function (m) { return m.trim(); }).filter(String),
    notice: s.NOTICE || '',
    contact: s.CONTACT || '',
    holidayAsWeekend: s.SPECIAL_DAY_RULE === 'TRUE',
    blockHolidays: s.BLOCK_HOLIDAYS === 'TRUE',
    allowSelfPin: s.ALLOW_SELF_PIN === 'TRUE',
    closeAt: s.CLOSE_AT || ''
  };
}

/* =========================== Auth helpers =========================== */

function newUserSession_(staff) {
  const token = newToken_();
  CacheService.getScriptCache().put('usr_' + token, JSON.stringify({ id: staff.id, h: staff.hash.slice(0, 16) }), CONFIG.SESSION_SECONDS);
  return token;
}

function requireUser_(token) {
  const t = str_(token);
  const raw = t && CacheService.getScriptCache().get('usr_' + t);
  if (!raw) throw appError_('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่', 'SESSION');
  const sess = JSON.parse(raw);
  const staff = findStaff_(sess.id);
  if (!staff || staff.status !== 'active' || !staff.hash || staff.hash.slice(0, 16) !== sess.h) {
    CacheService.getScriptCache().remove('usr_' + t);
    throw appError_('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่', 'SESSION');
  }
  return staff;
}

function requireAdmin_(token) {
  const t = str_(token);
  const raw = t && CacheService.getScriptCache().get('adm_' + t);
  if (!raw) throw appError_('หมดเวลาการใช้งานผู้ดูแล กรุณาเข้าสู่ระบบใหม่', 'SESSION');
  const sess = JSON.parse(raw);
  if (sess.p !== shortHash_(prop_('ADMIN_USER') + ':' + prop_('ADMIN_PASS'))) {
    CacheService.getScriptCache().remove('adm_' + t);
    throw appError_('หมดเวลาการใช้งานผู้ดูแล กรุณาเข้าสู่ระบบใหม่', 'SESSION');
  }
  return true;
}

function checkLocked_(key) {
  const n = Number(CacheService.getScriptCache().get('fail_' + key) || 0);
  if (n >= CONFIG.MAX_FAILS) {
    const m = Number(CacheService.getScriptCache().get('lockm_' + key) || CONFIG.LOCK_MINUTES);
    throw appError_('ใส่รหัสผิดหลายครั้ง บัญชีถูกล็อกชั่วคราว ' + m + ' นาที', 'LOCKED');
  }
}

function registerFail_(key) {
  const c = CacheService.getScriptCache();
  const n = Number(c.get('fail_' + key) || 0) + 1;
  let minutes = CONFIG.LOCK_MINUTES;
  if (n >= CONFIG.MAX_FAILS) {
    // ถูกล็อกซ้ำ → เวลาล็อกเพิ่มเป็นเท่าตัว (15, 30, 60, ... สูงสุด 6 ชั่วโมง) กันการสุ่ม PIN
    const rounds = Number(c.get('lockn_' + key) || 0) + 1;
    c.put('lockn_' + key, String(rounds), 21600);
    minutes = Math.min(CONFIG.LOCK_MINUTES * Math.pow(2, rounds - 1), CONFIG.MAX_LOCK_MINUTES);
    c.put('lockm_' + key, String(minutes), minutes * 60);
  }
  c.put('fail_' + key, String(n), minutes * 60);
}

function clearFails_(key) {
  CacheService.getScriptCache().remove('fail_' + key);
}

function rateLimit_(key, max, seconds, msg) {
  const c = CacheService.getScriptCache();
  const n = Number(c.get('rl_' + key) || 0);
  if (n >= max) throw appError_(msg, 'RATE_LIMIT');
  c.put('rl_' + key, String(n + 1), seconds);
}

function hashPin_(pin, salt) {
  let h = salt + ':' + pin;
  for (let i = 0; i < CONFIG.PIN_ITERATIONS; i++) {
    h = toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return h;
}

function shortHash_(s) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)).slice(0, 24);
}

function toHex_(bytes) {
  return bytes.map(function (b) { const v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function newToken_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function newSalt_() { return Utilities.getUuid().replace(/-/g, ''); }
function newId_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 12); }

/* =========================== Validation & utils =========================== */

function validPin_(pin, isNew) {
  const p = str_(pin);
  if (!/^\d{4,6}$/.test(p)) throw appError_('PIN ต้องเป็นตัวเลข 4–6 หลัก', 'BAD_REQUEST');
  if (isNew && isWeakPin_(p)) throw appError_('PIN เดาง่ายเกินไป (เช่น 1234, 0000, 1212) กรุณาตั้งใหม่', 'WEAK_PIN');
  return p;
}

function isWeakPin_(p) {
  if (/^(\d)\1+$/.test(p)) return true;                       // 0000, 111111
  if ('01234567890'.indexOf(p) >= 0 || '09876543210'.indexOf(p) >= 0) return true; // เรียงกัน
  if (p.length % 2 === 0 && p.slice(0, 2).repeat(p.length / 2) === p) return true;  // 1212, 2525
  return ['123123', '112233', '121212'].indexOf(p) >= 0;
}

function tempPin_() {
  let p;
  do { p = String(100000 + parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 900000); } while (isWeakPin_(p));
  return p;
}

function validDate_(d) {
  const s = str_(d);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw appError_('รูปแบบวันที่ไม่ถูกต้อง', 'BAD_REQUEST');
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) throw appError_('วันที่ไม่ถูกต้อง', 'BAD_REQUEST');
  return s;
}

function validPosition_(p) {
  if (CONFIG.POSITIONS.indexOf(p) < 0) throw appError_('กรุณาเลือกตำแหน่ง', 'BAD_REQUEST');
  return p;
}

function cleanName_(v, label) {
  const s = norm_(v);
  if (!s) throw appError_('กรุณากรอก' + label, 'BAD_REQUEST');
  if (s.length > 60) throw appError_(label + 'ยาวเกินไป', 'BAD_REQUEST');
  if (/[<>=+@]/.test(s.charAt(0)) || /[<>]/.test(s)) throw appError_(label + 'มีอักขระที่ไม่อนุญาต', 'BAD_REQUEST');
  return s;
}

function cleanText_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
}

function safeCell_(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function dateRange_(from, to) {
  const f = validDate_(from), t = validDate_(to);
  if (t < f) throw appError_('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น', 'BAD_REQUEST');
  const days = (Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8)) - Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8))) / 86400000;
  if (days > 366) throw appError_('เลือกช่วงวันที่ได้ไม่เกิน 1 ปี', 'BAD_REQUEST');
  return { from: f, to: t };
}

function monthRange_(month, upcoming) {
  if (upcoming) {
    return { from: todayKey_(), to: '9999-12-31' };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(str_(month));
  if (!m || +m[2] < 1 || +m[2] > 12) throw appError_('รูปแบบเดือนไม่ถูกต้อง', 'BAD_REQUEST');
  const days = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
  return { from: month + '-01', to: month + '-' + (days < 10 ? '0' : '') + days };
}

function dateKey_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, sheetTz_(), 'yyyy-MM-dd');
  const m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(String(v || '').trim());
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

function tsStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TZ, 'yyyy/MM/dd, HH:mm:ss');
  return String(v || '');
}

function byDate_(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (CONFIG.SLOT_COL[a.slots[0]] || 0) - (CONFIG.SLOT_COL[b.slots[0]] || 0);
}

function todayKey_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy/MM/dd, HH:mm:ss'); }
function norm_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
function str_(v) { return v == null ? '' : String(v).trim(); }
function nameKey_(f, l) { return (norm_(f) + '|' + norm_(l)).toLowerCase(); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }

let LOCK_DEPTH_ = 0;
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) { // ถืออยู่แล้วในคำขอเดียวกัน — ไม่ปล่อย lock ก่อนเวลา
    LOCK_DEPTH_++;
    try { return fn(); } finally { LOCK_DEPTH_--; }
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw appError_('ระบบกำลังบันทึกข้อมูลของผู้อื่น กรุณาลองใหม่อีกครั้ง', 'BUSY');
  LOCK_DEPTH_ = 1;
  try { return fn(); } finally { LOCK_DEPTH_ = 0; lock.releaseLock(); }
}

let SHEET_TZ_ = '';
function sheetTz_() {
  if (!SHEET_TZ_) {
    try { SHEET_TZ_ = ss_().getSpreadsheetTimeZone() || CONFIG.TZ; } catch (e) { SHEET_TZ_ = CONFIG.TZ; }
  }
  return SHEET_TZ_;
}

function appError_(msg, code) {
  const e = new Error(msg);
  e.code = code || 'ERROR';
  return e;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
