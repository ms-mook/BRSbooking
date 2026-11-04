// เซิร์ฟเวอร์สำหรับพัฒนา/ทดสอบบนเครื่อง
//   npm run dev                 → ใช้ Apps Script จำลอง (ข้อมูลตัวอย่าง, ผู้ดูแล admin / admin1234)
//   GAS_URL=<ลิงก์ /exec> npm run dev → ส่งต่อไป Apps Script จริงผ่าน api/gas.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from './gas-mock.mjs';
import { bookingRows, LEAVE_HEADER } from './fixture.mjs';
import gasHandler from '../api/gas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
// ใช้ security headers ชุดเดียวกับ vercel.json เพื่อให้การทดสอบตรงกับของจริง (รวม CSP)
const VERCEL_HEADERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).headers[0].headers;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ics': 'text/calendar' };

let gas;
// FIXTURE_FILE=ไฟล์ JSON {values:[[...]]} ของแท็บ Booking Data (ไม่รวมหัวตาราง) เพื่อทดสอบกับข้อมูลจริงบนเครื่อง — อย่า commit ไฟล์ข้อมูลจริง
function loadRows() {
  if (!process.env.FIXTURE_FILE) return bookingRows();
  const v = JSON.parse(fs.readFileSync(process.env.FIXTURE_FILE, 'utf8')).values;
  return [bookingRows()[0]].concat(v);
}
function resetMock() {
  gas = createGas({
    now: process.env.MOCK_NOW || undefined,
    props: { ADMIN_USER: 'admin', ADMIN_PASS: 'admin1234' },
    calendarEvents: [
      { date: '2027-01-01', title: 'วันขึ้นปีใหม่', desc: 'วันหยุดนักขัตฤกษ์' },
      { date: '2027-01-09', title: 'วันเด็กแห่งชาติ', desc: 'การเฉลิมฉลอง' },
      { date: '2027-03-15', title: 'วันหยุดพิเศษ (ทดสอบ)', desc: 'วันหยุดนักขัตฤกษ์' },
      { date: '2027-04-13', title: 'วันสงกรานต์', desc: 'วันหยุดนักขัตฤกษ์' }
    ],
    sheets: { 'Booking Data': loadRows(), Leave: [LEAVE_HEADER] }
  });
}
resetMock();

function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });
}

function shimRes(res) {
  const r = {
    statusCode: 200,
    setHeader: (k, v) => res.setHeader(k, v),
    status(c) { this.statusCode = c; return this; },
    json(o) { res.writeHead(this.statusCode, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); },
    send(t) { res.writeHead(this.statusCode); res.end(t); }
  };
  return r;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  VERCEL_HEADERS.forEach((h) => { if (h.key !== 'Strict-Transport-Security') res.setHeader(h.key, h.value); });
  if (url.pathname === '/api/gas') {
    const body = await readBody(req);
    if (process.env.GAS_URL) {
      let parsed = body; try { parsed = JSON.parse(body); } catch (e) { /* keep string */ }
      return gasHandler({ method: req.method, body: parsed }, shimRes(res));
    }
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    let payload; try { payload = JSON.parse(body); } catch (e) { payload = {}; }
    const out = gas.rawPost(JSON.stringify({ fn: payload.fn, args: payload.args || {} }));
    if (process.env.MOCK_DELAY) await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY)));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(out));
  }
  if (url.pathname.startsWith('/__mock/') && !process.env.GAS_URL) {
    if (url.pathname === '/__mock/reset') resetMock();
    if (url.pathname === '/__mock/now') gas.setNow(url.searchParams.get('t'));
    if (url.pathname === '/__mock/sheet') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(gas.values(url.searchParams.get('name'))));
    }
    res.writeHead(200); return res.end('ok');
  }
  let file = path.normalize(path.join(PUB, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log('BRSbooking dev: http://localhost:' + PORT + (process.env.GAS_URL ? ' (Apps Script จริง)' : ' (Apps Script จำลอง)')));
