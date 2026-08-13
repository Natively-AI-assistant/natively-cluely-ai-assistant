// F-109 repro: child-process-gone / gpu-process-crashed permanently kill the DB.
//
// Launches the real app, proves the DB works (modesGetAll > 0 — built-in modes
// guarantee non-empty on a healthy DB), then SIGKILLs the GPU child process —
// a RECOVERABLE event: Chromium relaunches the GPU process and the app keeps
// running. Pre-fix, main.ts's unconditional emergencyCloseDatabase() on
// child-process-gone nulls the DB singleton (no reopen path), so the same
// read silently degrades for the rest of the session.
//
// Expected (correct): app survives the GPU kill AND the DB still answers → exit 0.
// Bug (F-109): app survives, GPU relaunches, but DB reads are dead → exit 1.
// Inconclusive setups (no GPU child, empty DB, app died) → exit 2.
//
// Run: node scripts/audit/F-109-repro.mjs
import { _electron as electron } from '@playwright/test';

const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
  },
  timeout: 60_000,
});

const stdio = [];
app.process().stdout?.on('data', (d) => stdio.push(d.toString()));
app.process().stderr?.on('data', (d) => stdio.push(d.toString()));

await app.firstWindow({ timeout: 30_000 }).catch(() => null);
await new Promise((r) => setTimeout(r, 6_000));

async function bridgeWindow() {
  for (const w of app.windows()) {
    try {
      const ok = await w.evaluate(() => typeof window.electronAPI?.modesGetAll === 'function');
      if (ok) return w;
    } catch { /* window may be navigating/destroyed */ }
  }
  return null;
}

async function probeModes(label) {
  const w = await bridgeWindow();
  if (!w) return { label, error: 'no bridge window' };
  try {
    const res = await w.evaluate(async () => {
      const r = await window.electronAPI.modesGetAll();
      const arr = Array.isArray(r) ? r : (r?.modes ?? r?.data ?? []);
      return { count: Array.isArray(arr) ? arr.length : -1, shape: typeof r };
    });
    return { label, ...res };
  } catch (e) {
    return { label, error: String(e).slice(0, 200) };
  }
}

const before = await probeModes('before');
console.log('[F-109] probe before kill:', JSON.stringify(before));
if (!(before.count > 0)) {
  console.error('[F-109] Inconclusive: healthy-DB probe did not return modes.');
  app.process().kill('SIGKILL');
  process.exit(2);
}

const gpu = await app.evaluate(({ app: eApp }) =>
  eApp.getAppMetrics().filter((m) => m.type === 'GPU').map((m) => m.pid)
);
console.log('[F-109] GPU child pid(s):', gpu);
if (!gpu.length) {
  console.error('[F-109] Inconclusive: no GPU child process found.');
  app.process().kill('SIGKILL');
  process.exit(2);
}

process.kill(gpu[0], 'SIGKILL');
console.log('[F-109] SIGKILL sent to GPU process', gpu[0], '— waiting 5s…');
await new Promise((r) => setTimeout(r, 5_000));

// The event must be NON-FATAL: main alive, GPU relaunched by Chromium.
const alive = app.process().exitCode === null;
const gpuAfter = alive
  ? await app.evaluate(({ app: eApp }) =>
      eApp.getAppMetrics().filter((m) => m.type === 'GPU').map((m) => m.pid)
    ).catch(() => [])
  : [];
const sawEvent = stdio.join('').includes('child-process-gone');
console.log('[F-109] main alive:', alive, '| GPU pids after:', gpuAfter, '| child-process-gone observed:', sawEvent);
if (!alive) {
  console.error('[F-109] Inconclusive: main process died with the GPU process (event would be moot).');
  process.exit(2);
}

const after = await probeModes('after');
console.log('[F-109] probe after kill:', JSON.stringify(after));

const cleanup = () => { try { app.process().kill('SIGKILL'); } catch { /* already gone */ } };

if (after.count > 0) {
  console.log('[F-109] PASS: app survived a recoverable GPU crash and the DB still answers.');
  cleanup();
  process.exit(0);
}

console.error('[F-109] FAIL: app survived (GPU relaunched:', gpuAfter.length > 0, ') but DB reads are dead — silent permanent persistence loss (F-109 reproduced).');
cleanup();
process.exit(1);
