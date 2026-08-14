// F-108 repro: overlay 'close' handler cancels app quit mid-teardown.
//
// Launches the real app (existing dist-electron bundle, production-style
// file:// renderer load, real dev userData — same pattern as tests/e2e-modes
// probes), force-shows the overlay window via the main process, then calls
// app.quit() and observes whether the process actually exits.
//
// Expected (correct) behavior: app exits within the wait window → exit 0.
// Bug (F-108): overlay close handler preventDefaults on visibility with no
// isQuitting() guard → Electron cancels the quit → on macOS the process
// survives with zero windows, a closed DB and scrubbed keys → exit 1.
//
// Run: node scripts/audit/F-108-repro.mjs
import { _electron as electron } from '@playwright/test';

const WAIT_MS = 12_000;

const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: {
    ...process.env,
    NODE_ENV: 'production', // isDev=false → file:// renderer, no dev server needed
    NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
  },
  timeout: 60_000,
});

await app.firstWindow({ timeout: 30_000 }).catch(() => null);
// Let async init settle (window creation, IPC registration).
await new Promise((r) => setTimeout(r, 6_000));

const setup = await app.evaluate(async ({ BrowserWindow, app: eApp }) => {
  const state = { beforeQuit: false, willQuit: false, quit: false };
  eApp.on('before-quit', () => { state.beforeQuit = true; });
  eApp.on('will-quit', () => { state.willQuit = true; });
  eApp.on('quit', () => { state.quit = true; });
  globalThis.__f108 = state;

  const wins = BrowserWindow.getAllWindows();
  const overlay = wins.find((w) => {
    try { return /[?&]window=overlay(?:&|$)/.test(w.webContents.getURL()); } catch { return false; }
  });
  if (!overlay) {
    return {
      ok: false,
      urls: wins.map((w) => { try { return w.webContents.getURL().slice(0, 90); } catch { return '?'; } }),
    };
  }
  overlay.showInactive();
  return { ok: true, overlayVisible: overlay.isVisible(), windowCount: wins.length };
});
console.log('[F-108] setup:', JSON.stringify(setup));
if (!setup.ok) {
  console.error('[F-108] Could not locate overlay window — repro inconclusive.');
  app.process().kill('SIGKILL');
  process.exit(2);
}

// Adjacent-behavior guard (regression check for the fix): closing the overlay
// OUTSIDE of quit must still be intercepted — hidden, not destroyed.
const adjacent = await app.evaluate(async ({ BrowserWindow }) => {
  const overlay = BrowserWindow.getAllWindows().find((w) => {
    try { return /[?&]window=overlay(?:&|$)/.test(w.webContents.getURL()); } catch { return false; }
  });
  overlay.close();
  await new Promise((r) => setTimeout(r, 500));
  const stillExists = BrowserWindow.getAllWindows().some((w) => {
    try { return /[?&]window=overlay(?:&|$)/.test(w.webContents.getURL()); } catch { return false; }
  });
  return { stillExists, destroyed: overlay.isDestroyed() };
});
console.log('[F-108] adjacent (non-quit close must hide, not destroy):', JSON.stringify(adjacent));
if (!adjacent.stillExists || adjacent.destroyed) {
  console.error('[F-108] REGRESSION: non-quit overlay close destroyed the overlay.');
  app.process().kill('SIGKILL');
  process.exit(3);
}

// Re-show the overlay (the adjacent check hid it via switchToLauncher) so the
// quit phase actually exercises the visible-overlay close path, then trigger
// the quit from inside the main process, decoupled from this evaluate.
await app.evaluate(({ BrowserWindow, app: eApp }) => {
  const overlay = BrowserWindow.getAllWindows().find((w) => {
    try { return /[?&]window=overlay(?:&|$)/.test(w.webContents.getURL()); } catch { return false; }
  });
  overlay.showInactive();
  if (!overlay.isVisible()) throw new Error('overlay not visible before quit — repro invalid');
  setTimeout(() => eApp.quit(), 100);
});
console.log('[F-108] app.quit() dispatched; waiting up to', WAIT_MS, 'ms for process exit…');

const proc = app.process();
const exited = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(false), WAIT_MS);
  proc.once('exit', () => { clearTimeout(t); resolve(true); });
});

if (exited) {
  console.log('[F-108] PASS: process exited after app.quit(). Bug not present.');
  process.exit(0);
}

// Process survived — collect post-mortem from inside the still-alive main process.
const post = await app
  .evaluate(({ BrowserWindow }) => ({
    lifecycle: globalThis.__f108,
    windows: BrowserWindow.getAllWindows().length,
    visibleWindows: BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length,
  }))
  .catch((e) => ({ evalError: String(e) }));
console.log('[F-108] post-mortem (process STILL ALIVE):', JSON.stringify(post));
console.log('[F-108] FAIL: quit was cancelled — before-quit ran destructive teardown but the app never exited (F-108 reproduced).');
proc.kill('SIGKILL');
process.exit(1);
