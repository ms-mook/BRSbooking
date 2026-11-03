// รันการทดสอบทั้งหมด: หลังบ้าน (Code.gs) + หน้าเว็บ (Playwright)
import { spawnSync } from 'node:child_process';
const run = (args) => spawnSync(process.execPath, args, { stdio: 'inherit' }).status;
const a = run(['--test', 'test/api.test.mjs']);
const b = run(['test/e2e.mjs']);
process.exit(a || b ? 1 : 0);
