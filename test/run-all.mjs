// รันการทดสอบทั้งหมด: หลังบ้าน (Code.gs) + หน้าเว็บ (Playwright)
import { spawnSync } from 'node:child_process';
const run = (args) => spawnSync(process.execPath, args, { stdio: 'inherit' }).status;
// รันชุดหลังบ้านทั้งเวลา UTC และเวลาไทย กันบัคที่ขึ้นกับ timezone ของเครื่อง
const runTz = (tz, args) => spawnSync(process.execPath, args, { stdio: 'inherit', env: Object.assign({}, process.env, { TZ: tz }) }).status;
const a = runTz('UTC', ['--test', 'test/api.test.mjs']) || runTz('Asia/Bangkok', ['--test', 'test/api.test.mjs']);
const b = run(['test/e2e.mjs']);
process.exit(a || b ? 1 : 0);
