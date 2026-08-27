import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

// Regression pins for "Stop the meeting, Start another one fast → the PREVIOUS
// meeting's overlay is on screen for a beat, then snaps back to default"
// (reported on Windows).
//
// The overlay BrowserWindow is persistent: created once with show:false, then
// only hide()/show()'d — its React tree is never unmounted between meetings.
// So the next show() paints whatever the last meeting left behind unless two
// separate things hold:
//
//   1. ORDER — the renderer is told to clear BEFORE the window is shown.
//      webContents.send() is async, so a reset sent after setWindowMode
//      ('overlay') races the show(): on a fast restart the teardown happens
//      on screen.
//   2. WINDOWS FIRST FRAME — a hidden HWND's renderer paints nothing, so its
//      last composited frame is the previous meeting. show() presents that
//      stale surface until a new frame arrives, regardless of content
//      protection, so the opacity shield must not be gated on the CP flag.
//
// main.ts / WindowHelper.ts import electron at module scope and cannot load
// under `node --test`; these assert the contracts in source, matching the
// existing StealthShortcutGuard / WindowsStealthSurfaceInvariants approach.

// These pins are ORDER pins, and the code they guard is heavily commented —
// including comments that quote the very calls being ordered. Strip comments
// first so an explanatory line can never satisfy (or break) an assertion.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const sliceStartMeetingTransition = (main) => {
  const start = main.indexOf('private async startMeetingTransition(');
  assert.ok(start > -1, 'startMeetingTransition() not found in electron/main.ts');
  const end = main.indexOf('public endMeeting(', start);
  assert.ok(end > start, 'end of startMeetingTransition() not found');
  return stripComments(main.slice(start, end));
};

const sliceEndMeetingTransition = (main) => {
  const start = main.indexOf('private async endMeetingTransition(');
  assert.ok(start > -1, 'endMeetingTransition() not found in electron/main.ts');
  return stripComments(main.slice(start, start + 6000));
};

const sliceSwitchToOverlay = (helper) => {
  const start = helper.indexOf('public switchToOverlay(');
  assert.ok(start > -1, 'switchToOverlay() not found in electron/WindowHelper.ts');
  const end = helper.indexOf('public switchToLauncher(', start);
  assert.ok(end > start, 'end of switchToOverlay() not found');
  return stripComments(helper.slice(start, end));
};

// ─── #1: clear-then-show, never show-then-clear ───────────────────────────────
test('startMeetingTransition sends session-reset BEFORE swapping to the overlay', () => {
  const body = sliceStartMeetingTransition(read('electron/main.ts'));

  const resetAt = body.indexOf("'session-reset'");
  const swapAt = body.indexOf("setWindowMode('overlay')");

  assert.ok(resetAt > -1, "startMeetingTransition must still send 'session-reset' (safety net for the cold-start / early-return paths where endMeeting never cleared).");
  assert.ok(swapAt > -1, "startMeetingTransition must still call setWindowMode('overlay').");
  assert.ok(
    resetAt < swapAt,
    "'session-reset' must be sent BEFORE setWindowMode('overlay') — send() is async, so a reset issued after the swap lands with the window already visible and the previous meeting's UI is torn down on screen.",
  );
});

test('the start-side session-reset reaches the overlay window, not only the launcher', () => {
  const body = sliceStartMeetingTransition(read('electron/main.ts'));
  const swapAt = body.indexOf("setWindowMode('overlay')");
  const preSwap = body.slice(0, swapAt);

  assert.match(
    preSwap,
    /sendToWindow\(\s*this\.getWindowHelper\(\)\.getOverlayWindow\(\),\s*'session-reset'\s*\)/,
    'the overlay window must receive session-reset before the swap — it is the surface that carries the stale meeting state.',
  );
  assert.match(
    preSwap,
    /sendToWindow\(\s*this\.getWindowHelper\(\)\.getLauncherWindow\(\),\s*'session-reset'\s*\)/,
    'the launcher must keep receiving session-reset alongside the overlay.',
  );
});

// The end-side clear is the fast path (a whole meeting of idle time to apply it
// while hidden). It stays, and it stays AFTER the hide so the teardown is never
// painted. Both platforms depend on this ordering.
test('endMeetingTransition still clears the overlay only after hiding it', () => {
  const body = sliceEndMeetingTransition(read('electron/main.ts'));

  const hideAt = body.indexOf("setWindowMode('launcher')");
  const resetAt = body.indexOf("'session-reset'");

  assert.ok(hideAt > -1, "endMeetingTransition must still call setWindowMode('launcher').");
  assert.ok(resetAt > -1, 'endMeetingTransition must still clear the overlay tree while hidden.');
  assert.ok(
    hideAt < resetAt,
    'the overlay must be hidden BEFORE session-reset — clearing it while visible plays the chat-list unmount and width collapse on screen.',
  );
});

// ─── #2: the Windows opacity shield is unconditional ──────────────────────────
test('switchToOverlay shields the first Windows frame regardless of content protection', () => {
  const body = sliceSwitchToOverlay(read('electron/WindowHelper.ts'));

  assert.doesNotMatch(
    body,
    /if \(process\.platform === 'win32' && this\.contentProtection\)/,
    "the shield must not be gated on contentProtection — with CP off, show() presents the previous meeting's stale composited frame.",
  );
  assert.match(
    body,
    /if \(process\.platform === 'win32'\) \{/,
    'the win32 branch must select the shielded show path for every Windows show.',
  );

  const win32At = body.indexOf("if (process.platform === 'win32') {");
  const elseAt = body.indexOf('} else {', win32At);
  assert.ok(elseAt > win32At, 'the win32 branch must still have a non-Windows fallback.');
  const win32Branch = body.slice(win32At, elseAt);

  const zeroAt = win32Branch.indexOf('setOpacity(0)');
  const showAt = win32Branch.search(/\.showInactive\(\)|\.show\(\)/);
  const restoreAt = win32Branch.indexOf('setOpacity(1)');
  assert.ok(zeroAt > -1 && showAt > -1 && restoreAt > -1, 'the win32 branch must zero opacity, show, then restore opacity.');
  assert.ok(zeroAt < showAt, 'opacity must be zeroed BEFORE show() or the stale frame is presented.');
  assert.ok(showAt < restoreAt, 'opacity must be restored only after the show, on the deferred timer.');

  // The overlay chrome is ALWAYS content-protected, independent of undetectable
  // mode — see applyContentProtection and OverlayAlwaysContentProtected.test.mjs.
  // Coupling this call to `this.contentProtection` was the "Natively is visible on
  // Google Meet calls" leak: undetectable mode is off by default, so every overlay
  // show called setContentProtection(false) and re-exposed the window. The shield
  // being unconditional (asserted above) is a SEPARATE property from the CP
  // argument, and only the shield is this test's subject.
  assert.match(
    win32Branch,
    /setContentProtection\(true\)/,
    'the win32 show path must force content protection on, never follow undetectable mode.',
  );
});

test('the macOS show path stays un-shielded and never calls setAlwaysOnTop', () => {
  const body = sliceSwitchToOverlay(read('electron/WindowHelper.ts'));
  const elseAt = body.indexOf('} else {', body.indexOf("if (process.platform === 'win32') {"));
  const macBranch = body.slice(elseAt, body.indexOf('this.isWindowVisible = true;', elseAt));

  assert.doesNotMatch(
    macBranch,
    /setOpacity\(0\)/,
    'macOS must keep showing at full opacity — its window server does not re-present a hidden window\'s old surface.',
  );
  assert.doesNotMatch(
    macBranch,
    /setAlwaysOnTop/,
    'setAlwaysOnTop on macOS triggers [NSApp activate] and steals focus from the meeting app even after showInactive().',
  );
});

// The shield timer now arms on EVERY win32 overlay show, not just the
// content-protected ones. A Stop landing inside its 60ms window would
// otherwise leave it to un-shield — and focus() — a window switchToLauncher
// has already hidden, on precisely the fast Stop→Start cadence being fixed.
test('the deferred un-shield cannot outlive the overlay mode that armed it', () => {
  const body = sliceSwitchToOverlay(read('electron/WindowHelper.ts'));
  const timerAt = body.indexOf('this.opacityTimeout = setTimeout(');
  assert.ok(timerAt > -1, 'the deferred un-shield timer must still exist.');
  const callback = body.slice(timerAt, body.indexOf('}, 60);', timerAt));

  assert.match(
    callback,
    /if \(this\.currentWindowMode !== 'overlay'\) return;/,
    'the un-shield callback must bail when the mode has already swapped away from the overlay.',
  );
  const guardAt = callback.indexOf("this.currentWindowMode !== 'overlay'");
  const focusAt = callback.indexOf('.focus()');
  assert.ok(focusAt > -1, 'the callback must still focus the overlay on activating shows.');
  assert.ok(guardAt < focusAt, 'the mode guard must run before focus() — focusing a hidden overlay is the hazard.');
});

test('switchToLauncher drops any pending overlay un-shield on both branches', () => {
  const helper = read('electron/WindowHelper.ts');
  const start = helper.indexOf('public switchToLauncher(');
  assert.ok(start > -1, 'switchToLauncher() not found.');
  const body = stripComments(helper.slice(start, helper.indexOf('public setWindowMode(', start)));

  const clearAt = body.indexOf('clearTimeout(this.opacityTimeout)');
  const cpBranchAt = body.indexOf("process.platform === 'win32' && this.contentProtection");
  assert.ok(clearAt > -1, 'switchToLauncher must clear the pending un-shield timer.');
  assert.ok(cpBranchAt > -1, 'the launcher content-protection branch must still exist.');
  assert.ok(
    clearAt < cpBranchAt,
    'the clear must happen BEFORE the content-protection branch — the non-CP branch arms no timer of its own and would otherwise leave the overlay timer live.',
  );
});
