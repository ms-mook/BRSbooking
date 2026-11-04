// สร้างภาพวิธีใช้งาน public/guide.png (1080 px กว้าง เหมาะส่งต่อใน LINE) จากข้อมูลใน public/guide.js
// ใช้: node dev/make-guide.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); }
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/guide.js'), 'utf8'), ctx);
const G = ctx.window.BRS_GUIDE;
const lucide = require(path.join(ROOT, 'node_modules/lucide/dist/cjs/lucide.js'));
const TONES = { 'tube-1': '#4E9BD4', 'tube-2': '#C73E37', 'tube-3': '#D3A21F', 'tube-4': '#2F9160', 'tube-5': '#8466BE', 'tube-6': '#87929A' };
const pascal = (n) => n.replace(/(^|-)(\w)/g, (m, a, b) => b.toUpperCase());
function svg(name, color) {
  const node = lucide.icons[pascal(name)];
  const kids = node.map(([tag, attrs]) => '<' + tag + ' ' + Object.entries(attrs).map(([k, v]) => k + '="' + v + '"').join(' ') + '/>').join('');
  return '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + kids + '</svg>';
}
const font = (w, set = 'thai') => 'url(data:font/woff2;base64,' + fs.readFileSync(path.join(ROOT, 'public/fonts/sarabun-' + set + '-' + w + '-normal.woff2')).toString('base64') + ')';
const logo = fs.readFileSync(path.join(ROOT, 'public/icons/icon.svg'), 'utf8');
const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
@font-face{font-family:S;font-weight:400;src:${font(400)}}@font-face{font-family:S;font-weight:600;src:${font(600)}}@font-face{font-family:S;font-weight:700;src:${font(700)}}@font-face{font-family:SL;font-weight:400;src:${font(400, 'latin')}}@font-face{font-family:SL;font-weight:600;src:${font(600, 'latin')}}@font-face{font-family:SL;font-weight:700;src:${font(700, 'latin')}}
*{box-sizing:border-box;margin:0;padding:0}body{width:1080px;font-family:SL,S,sans-serif;background:#F4F7F9;color:#12303F}
.top{background:#12303F;color:#F2F7FA;padding:56px 64px 48px;display:flex;gap:28px;align-items:center;position:relative}
.top svg.logo{width:112px;height:112px;flex:none}.top h1{font-size:64px;line-height:1.1}.top p{font-size:28px;color:#A9BFCB;margin-top:6px}
.rail{display:grid;grid-template-columns:repeat(6,1fr);height:14px}.rail i:nth-child(1){background:#4E9BD4}.rail i:nth-child(2){background:#C73E37}.rail i:nth-child(3){background:#D3A21F}.rail i:nth-child(4){background:#2F9160}.rail i:nth-child(5){background:#8466BE}.rail i:nth-child(6){background:#87929A}
ol{list-style:none;padding:44px 64px 8px;display:grid;gap:22px}
li{display:grid;grid-template-columns:96px 1fr;gap:28px;align-items:start;background:#fff;border:2px solid #D2DDE4;border-radius:28px;padding:26px 30px}
.ic{position:relative;width:96px;height:96px;border-radius:24px;display:grid;place-items:center}
.n{position:absolute;top:-14px;left:-14px;width:44px;height:44px;border-radius:50%;background:#fff;display:grid;place-items:center;font-weight:700;font-size:24px;border:3px solid}
b{display:block;font-size:38px;font-weight:700;line-height:1.25}li p{font-size:29px;color:#435A68;line-height:1.5;margin-top:4px}
.box{margin:22px 64px 0;padding:26px 30px;border-radius:24px;font-size:28px;line-height:1.5}
.forgot{background:#FBECEB;color:#7A2520}.home{background:#E7F1F8;color:#1C4A63}
.box b{font-size:30px;display:inline}
.foot{padding:30px 64px 48px;font-size:26px;color:#587080;display:flex;justify-content:space-between}
</style></head><body>
<div class="top">${logo.replace('<svg', '<svg class="logo"')}<div><h1>วิธีใช้งานระบบจองเวร</h1><p>หน่วยเจาะเลือดเก็บสิ่งส่งตรวจและ POCT</p></div></div>
<div class="rail"><i></i><i></i><i></i><i></i><i></i><i></i></div>
<ol>${G.steps.map((s, i) => `<li><div class="ic" style="background:${TONES[s.tone]}"><span class="n" style="border-color:${TONES[s.tone]};color:${TONES[s.tone]}">${i + 1}</span>${svg(s.icon, '#fff')}</div><div><b>${s.title}</b><p>${s.text}</p></div></li>`).join('')}</ol>
<div class="box home"><b>${G.homeTitle}</b> ${G.home}</div>
<div class="box forgot"><b>ลืม PIN</b> ${G.forgot.replace(/^ลืม PIN:\s*/, '')}</div>
<div class="foot"><span>${G.url}</span><span>งานห้องปฏิบัติการเวชศาสตร์ชันสูตร โรงพยาบาลศรีนครินทร์</span></div>
</body></html>`;
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 800 }, deviceScaleFactor: 1 });
await p.setContent(html); await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: path.join(ROOT, 'public/guide.png'), fullPage: true });
await b.close();
console.log('wrote public/guide.png');
