// Vercel Serverless Function: ส่งต่อคำขอจากหน้าเว็บไปยัง Apps Script Web App
// ตั้งค่า Environment Variables บน Vercel: GAS_URL (ลิงก์ /exec) และ API_SECRET (ไม่บังคับ ต้องตรงกับ Script Properties)
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed', code: 'BAD_REQUEST' });
    return;
  }
  const url = process.env.GAS_URL;
  if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.trim())) {
    res.status(500).json({ ok: false, error: 'ยังไม่ได้ตั้งค่า GAS_URL บน Vercel (ต้องเป็นลิงก์ /exec ของ Apps Script)', code: 'NOT_CONFIGURED' });
    return;
  }
  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) { payload = null; }
  }
  if (!payload || typeof payload !== 'object' || typeof payload.fn !== 'string') {
    res.status(400).json({ ok: false, error: 'รูปแบบคำขอไม่ถูกต้อง', code: 'BAD_REQUEST' });
    return;
  }
  const body = JSON.stringify({ fn: payload.fn, args: payload.args || {}, secret: process.env.API_SECRET || undefined });
  if (body.length > 60000) {
    res.status(413).json({ ok: false, error: 'ข้อมูลคำขอใหญ่เกินไป', code: 'BAD_REQUEST' });
    return;
  }
  try {
    const r = await fetch(url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow'
    });
    const text = await r.text();
    try {
      JSON.parse(text);
    } catch (e) {
      res.status(502).json({ ok: false, error: 'Apps Script ตอบกลับไม่ถูกต้อง — ตรวจสอบว่า Deploy เวอร์ชันล่าสุด และตั้งสิทธิ์ผู้เข้าถึงเป็น "ทุกคน"', code: 'UPSTREAM' });
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(text);
  } catch (e) {
    res.status(502).json({ ok: false, error: 'เชื่อมต่อ Apps Script ไม่สำเร็จ', code: 'UPSTREAM' });
  }
}
