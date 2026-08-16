// F-110 repro: a throw in initializeApp's unguarded stretch leaves a
// lock-holding, windowless zombie process.
//
// The single-instance lock is acquired early; on macOS the activation policy
// is 'accessory' (no dock tile) until late in init. A throw in the long
// unguarded stretch (credentials init, AppState construction, IPC handler
// registration, disguise, window creation) unwinds into initializeApp's
// top-level .catch, which closes the DB, writes a report, logs — and returns
// WITHOUT app.exit(). The process stays alive with no window and holds the
// lock, so relaunching from Finder/Spotlight signals the zombie
// (second-instance → centerAndShowWindow → launcherWindow === null → nothing)
// and the app is unlaunchable until the PID is killed. The repo names this
// exact hazard at the verification-flags assert, which exits explicitly.
//
// Realistic external injections were attempted first: a corrupted
// natively-preferences-secure.json self-heals (fallback credentials), and a
// read-only userData dir kills Chromium before app code runs. The
// NATIVELY_TEST_INIT_FAULT env hook (inert unless set) makes the contract
// deterministically testable.
//
// Expected (correct): process exits within the window after the injected
// init failure → exit 0. Bug (F-110): process still alive, zero windows →
// exit 1.
//
// Run: node scripts/audit/F-110-repro.mjs
import { _electron as electron } from '@playwright/test';

let app;
try {
  app = await electron.launch({
    args: ['dist-electron/electron/main.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
      NATIVELY_TEST_INIT_FAULT: '1',
    },
    timeout: 30_000,
  });
} catch (e) {
  // A launch error can be the FIXED behavior: the app exited before
  // Playwright finished the handshake. Distinguish by message.
  if (/has been closed|exited|closed before/i.test(String(e))) {
    console.log('[F-110] PASS: app process terminated during launch after the injected init failure.');
    process.exit(0);
  }
  console.error('[F-110] Inconclusive: launch failed unexpectedly:', String(e).slice(0, 300));
  process.exit(2);
}

const proc = app.process();
const exited = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(false), 15_000);
  proc.once('exit', () => { clearTimeout(t); resolve(true); });
  if (proc.exitCode !== null) { clearTimeout(t); resolve(true); }
});

if (exited) {
  console.log('[F-110] PASS: process exited after the injected init failure (code ' + proc.exitCode + ').');
  process.exit(0);
}

const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 'eval-failed');
console.log('[F-110] process STILL ALIVE 15s after the injected init failure; windows:', windows);
console.error('[F-110] FAIL: windowless zombie holding the single-instance lock (F-110 reproduced).');
proc.kill('SIGKILL');
process.exit(1);
