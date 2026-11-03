// จำลอง Google Apps Script (SpreadsheetApp, CacheService, LockService, PropertiesService, Utilities, ContentService)
// เพื่อรัน apps-script/Code.gs จริงบน Node สำหรับทดสอบ — ไม่ได้ใช้ในระบบจริง
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TZ_OFFSET_MIN = 7 * 60; // Asia/Bangkok, ไม่มี DST

function bkkParts(d) {
  const t = new Date(d.getTime() + TZ_OFFSET_MIN * 60000);
  return { y: t.getUTCFullYear(), M: t.getUTCMonth() + 1, d: t.getUTCDate(), H: t.getUTCHours(), m: t.getUTCMinutes(), s: t.getUTCSeconds() };
}
const p2 = (n) => String(n).padStart(2, '0');

function formatDate(date, tz, fmt) {
  const p = bkkParts(date);
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss|M|d/g, (t) => ({ yyyy: p.y, MM: p2(p.M), dd: p2(p.d), HH: p2(p.H), mm: p2(p.m), ss: p2(p.s), M: p.M, d: p.d }[t]));
}

// แปลงค่าแบบที่ Google Sheets ทำเมื่อเขียนข้อความลงเซลล์
function coerce(v, textFormat) {
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  if (textFormat) return v;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) - TZ_OFFSET_MIN * 60000);
  }
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 15) return Number(v);
  return v;
}

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sheet.data[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined || v === null ? '' : v instanceof Date ? new Date(v.getTime()) : v);
      }
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((r) => r.length !== this.nc)) throw new Error('Range size mismatch');
    vals.forEach((row, i) => row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.raw(this.r + i, this.c + j, ''); return this; }
  setNumberFormat(f) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.fmt[(this.r + i) + ':' + (this.c + j)] = f; return this; }
}

class Sheet {
  constructor(name, data) { this.name = name; this.data = data || []; this.fmt = {}; }
  getName() { return this.name; }
  raw(r, c, v) { while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  set(r, c, v) { this.raw(r, c, coerce(v, this.fmt[r + ':' + c] === '@')); }
  getLastRow() { let n = this.data.length; while (n > 0 && this.data[n - 1].every((v) => v === '' || v == null)) n--; return n; }
  getLastColumn() { return this.data.reduce((m, r) => { let n = r.length; while (n > 0 && (r[n - 1] === '' || r[n - 1] == null)) n--; return Math.max(m, n); }, 0); }
  getRange(r, c, nr, nc) { if (r < 1 || c < 1) throw new Error('Bad range'); return new Range(this, r, c, nr || 1, nc || 1); }
  getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  appendRow(row) { const r = this.getLastRow() + 1; row.forEach((v, j) => this.set(r, j + 1, v)); return this; }
  deleteRow(r) { if (r < 1 || r > this.data.length) throw new Error('deleteRow out of range'); this.data.splice(r - 1, 1); return this; }
}

export function createGas(opts = {}) {
  const sheets = {};
  for (const [name, rows] of Object.entries(opts.sheets || {})) {
    const sh = new Sheet(name);
    rows.forEach((row, i) => row.forEach((v, j) => sh.set(i + 1, j + 1, v)));
    sheets[name] = sh;
  }
  let nowMs = opts.now ? new Date(opts.now).getTime() : Date.now();
  const cache = new Map();
  const props = Object.assign({}, opts.props || {});
  const calls = { lock: 0 };

  const ss = {
    getName: () => 'Mock spreadsheet',
    getSpreadsheetTimeZone: () => 'Asia/Bangkok',
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => { if (sheets[n]) throw new Error('exists'); sheets[n] = new Sheet(n); return sheets[n]; }
  };

  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(nowMs); else super(...a); }
    static now() { return nowMs; }
    static [Symbol.hasInstance](x) { return x instanceof RealDate; }
  }

  const sandbox = {
    Date: FakeDate,
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const e = cache.get(k); if (!e) return null; if (e.exp <= nowMs) { cache.delete(k); return null; } return e.v; },
        put: (k, v, ttl) => { if (String(v).length > 100000) throw new Error('cache value too large'); cache.set(k, { v: String(v), exp: nowMs + Math.min(ttl || 600, 21600) * 1000 }); },
        remove: (k) => cache.delete(k)
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => { calls.lock++; return true; }, waitLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } })
    },
    Logger: { log: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });

  function call(fn, args, extra) {
    const body = JSON.stringify(Object.assign({ fn, args: args || {} }, extra || {}));
    return JSON.parse(sandbox.doPost({ postData: { contents: body } }).getContent());
  }
  function rawPost(body) { return JSON.parse(sandbox.doPost({ postData: { contents: body } }).getContent()); }

  return {
    sandbox, sheets, cache, props, calls, call, rawPost,
    setNow: (d) => { nowMs = new Date(d).getTime(); },
    advance: (ms) => { nowMs += ms; },
    values: (name) => (sheets[name] ? sheets[name].getDataRange().getValues() : null)
  };
}
