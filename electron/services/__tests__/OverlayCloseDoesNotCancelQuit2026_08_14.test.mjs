// F-108 regression pin (audit/autopilot-2026-08-14).
//
// The overlay's 'close' handler intercepts close (hide, don't destroy) so the
// overlay survives Cmd+W during a meeting. But during APP QUIT the close comes
// from Electron's CloseAllWindows sweep, AFTER before-quit has already run the
// destructive teardown (DB close, credential scrub). Preventing THAT close
// cancels the whole quit: will-quit/quit never fire, and on macOS
// window-all-closed is a no-op — leaving a windowless, post-teardown zombie
// process that must be Force Quit. Live-reproduced via
// scripts/audit/F-108-repro.mjs (before-quit ran, 0 windows, process alive).
//
// Contract pinned here: the overlay close handler MUST consult
// appState.isQuitting() and return (letting the close proceed) BEFORE its
// visibility-gated preventDefault. The launcher handler has carried the same
// guard since 2026-07; the two must stay symmetric.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'WindowHelper.ts'),
  'utf8'
);

/** Extract the body of the first `<owner>.on('close', …)` handler after `anchor`. */
function closeHandlerBody(owner) {
  const anchor = source.indexOf(`this.${owner}.on('close'`);
  assert.notEqual(anchor, -1, `no close handler found for this.${owner}`);
  // Body ends at the next `});` at the handler's indentation. A coarse slice to
  // the following .on( registration (or 500 chars) is enough for the ordering
  // assertions below and keeps this test resilient to reformatting.
  const tail = source.slice(anchor, anchor + 900);
  return tail;
}

test('overlay close handler lets the close proceed while the app is quitting', () => {
  const body = closeHandlerBody('overlayWindow');
  const quitGuard = body.indexOf('isQuitting()');
  const prevent = body.indexOf('preventDefault()');
  assert.notEqual(quitGuard, -1, 'overlay close handler must consult appState.isQuitting()');
  assert.notEqual(prevent, -1, 'overlay close handler should still preventDefault for user-initiated closes');
  assert.ok(
    quitGuard < prevent,
    'the isQuitting() guard must run BEFORE preventDefault(), or quit is cancelled after destructive before-quit teardown (F-108)'
  );
});

test('launcher close handler keeps its symmetric isQuitting() guard', () => {
  const body = closeHandlerBody('launcherWindow');
  const quitGuard = body.indexOf('isQuitting()');
  const prevent = body.indexOf('preventDefault()');
  assert.notEqual(quitGuard, -1, 'launcher close handler must consult appState.isQuitting()');
  assert.notEqual(prevent, -1);
  assert.ok(quitGuard < prevent, 'launcher guard must precede preventDefault()');
});
