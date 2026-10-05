// F-111 repro: quit-time screenshot cleanup is a no-op.
//
// The before-quit handler constructs a BRAND-NEW ScreenshotHelper and calls
// clearQueues() on it. clearQueues() deletes only the files listed in the
// instance's in-memory queue arrays — empty on a fresh instance (the
// constructor never scans the directory) — so fs.unlink is called zero times
// while the log claims "Screenshot queues cleared on quit". The real,
// populated instance is AppState.screenshotHelper, which is never cleared:
// captured screenshots of the user's meeting screen accumulate forever in
// userData/screenshots.
//
// Live repro: real app (isolated scratch profile). A marker PNG is written
// into the live helper's screenshotDir and pushed onto its queue, then the
// app quits normally. Correct behavior deletes the queued file during quit.
//
// Expected (correct): marker file deleted after quit → exit 0.
// Bug (F-111): marker file still on disk after quit → exit 1.
//
// Run: node scripts/audit/F-111-repro.mjs
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';

const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: { ...process.env, NODE_ENV: 'production', NATIVELY_DEV_BYPASS_SCREEN_TCC: '1' },
  timeout: 60_000,
});
await app.firstWindow({ timeout: 30_000 }).catch(() => null);
await app.evaluate(() => {
  const Module = process.mainModule.constructor;
  const key = Object.keys(Module._cache).find((k) => k.includes('dist-electron') && k.endsWith('main.js'));
  if (key) globalThis.__auditMainExports = Module._cache[key].exports;
});
await new Promise((r) => setTimeout(r, 3_000));

const setup = await app.evaluate(() => {
  const { AppState } = globalThis.__auditMainExports ?? {};
  if (!AppState?.getInstance) return { ok: false };
  const s = AppState.getInstance();
  const helper = s.getScreenshotHelper?.() ?? s.screenshotHelper;
  if (!helper) return { ok: false, why: 'no screenshotHelper' };
  const nodeFs = process.mainModule.require('fs');
  const nodePath = process.mainModule.require('path');
  const marker = nodePath.join(helper.screenshotDir, 'audit-f111-marker.png');
  nodeFs.writeFileSync(marker, Buffer.from('89504e470d0a1a0a', 'hex'));
  helper.screenshotQueue.push(marker);
  return { ok: true, marker, queueLen: helper.screenshotQueue.length };
});
console.log('[F-111] setup:', JSON.stringify(setup));
if (!setup.ok) {
  console.error('[F-111] Inconclusive:', setup.why ?? 'AppState unreachable');
  app.process().kill('SIGKILL');
  process.exit(2);
}

await app.evaluate(({ app: eApp }) => { setTimeout(() => eApp.quit(), 100); });
const proc = app.process();
const exited = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(false), 15_000);
  proc.once('exit', () => { clearTimeout(t); resolve(true); });
});
if (!exited) {
  console.error('[F-111] Inconclusive: app did not quit (unrelated failure).');
  proc.kill('SIGKILL');
  process.exit(2);
}

const stillThere = fs.existsSync(setup.marker);
if (stillThere) {
  fs.unlinkSync(setup.marker); // tidy the scratch profile
  console.error('[F-111] FAIL: queued screenshot survived quit — the before-quit cleanup cleared a fresh empty instance, not the live one (F-111 reproduced).');
  process.exit(1);
}
console.log('[F-111] PASS: queued screenshot was deleted during quit.');
process.exit(0);
