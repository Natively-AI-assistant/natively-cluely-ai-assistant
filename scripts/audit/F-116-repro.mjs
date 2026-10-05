// F-116 repro: stealthTapRefreshIme is missing from the preload bridge.
//
// Main registers 'stealth-tap:refresh-ime' on all three platform branches
// (the mid-session IME re-probe that prevents the stealth tap from swallowing
// CJK composition keystrokes after the user adds an input source), the
// renderer calls window.electronAPI?.stealthTapRefreshIme?.() on every window
// focus, and electron.d.ts declares it — but preload never exposes it, so the
// optional call silently no-ops forever. Two source-regex tests each verify
// one END of the contract; neither asserts the preload link.
//
// Expected (correct): the bridge exposes a function and invoking it reaches
// the live main handler → exit 0. Bug (F-116): typeof is 'undefined' → exit 1.
//
// Run: node scripts/audit/F-116-repro.mjs
import { _electron as electron } from '@playwright/test';

const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: { ...process.env, NODE_ENV: 'production', NATIVELY_DEV_BYPASS_SCREEN_TCC: '1' },
  timeout: 60_000,
});
await app.firstWindow({ timeout: 30_000 }).catch(() => null);
await new Promise((r) => setTimeout(r, 3_000));

let probe = { type: 'no-bridge-window' };
for (const w of app.windows()) {
  try {
    const res = await w.evaluate(async () => {
      const fn = window.electronAPI?.stealthTapRefreshIme;
      if (typeof fn !== 'function') return { type: typeof fn };
      try {
        const value = await fn();
        return { type: 'function', invoked: true, value };
      } catch (e) {
        return { type: 'function', invoked: false, error: String(e).slice(0, 120) };
      }
    });
    if (res.type !== 'no-bridge') { probe = res; break; }
  } catch { /* window navigating */ }
}
console.log('[F-116] probe:', JSON.stringify(probe));
app.process().kill('SIGKILL');

if (probe.type === 'no-bridge-window') {
  console.error('[F-116] Inconclusive: no window with the preload bridge found.');
  process.exit(2);
}
if (probe.type === 'function' && probe.invoked) {
  console.log('[F-116] PASS: bridge exposes stealthTapRefreshIme and it reaches the main handler.');
  process.exit(0);
}
console.error('[F-116] FAIL: stealthTapRefreshIme is', probe.type, '— the renderer focus-driven IME re-probe silently no-ops (F-116 reproduced).');
process.exit(1);
