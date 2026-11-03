// ตั้งค่าหน้าเว็บ — ปกติไม่ต้องแก้ (หน้าเว็บเรียก /api/gas บน Vercel ซึ่งส่งต่อไปยัง Apps Script ตาม GAS_URL)
// ถ้าต้องการเรียก Apps Script ตรง ให้ใส่ลิงก์ /exec แทน '/api/gas'
window.APP_CONFIG = { apiUrl: '/api/gas' };
