// Windows click-no-activate contract for the meeting overlay family.
//
// macOS: overlay/pill/toggle/popovers are non-activating NSPanels
// (type:'panel' + becomesKeyOnlyIfNeeded via applyStealthToWindow) — clicking
// them never steals focus from the user's meeting app.
// Windows: the equivalent is WS_EX_NOACTIVATE via setFocusable(false), applied
// by utils/windowsFocusPolicy, with a transient typing grant so the chat input
// still works. Reference acceptance check: with the overlay above
// https://www.proginosko.com/test/WindowFocusEvents.html, clicking overlay
// buttons must fire NO blur in the browser.
//
// Platform is injected (no process.platform mutation), so BOTH branches run
// on either OS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const {
  isClickActivatingPlatform,
  attachNoActivate,
  isNoActivateManaged,
  setTypingFocus,
} = require(path.join(repoRoot, 'dist-electron/electron/utils/windowsFocusPolicy.js'));

function fakeWindow() {
  const calls = [];
  const listeners = new Map();
  return {
    calls,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    setFocusable(f) {
      calls.push(['setFocusable', f]);
    },
    focus() {
      calls.push(['focus']);
    },
    on(event, cb) {
      const arr = listeners.get(event) ?? [];
      arr.push(cb);
      listeners.set(event, arr);
    },
    emit(event) {
      for (const cb of listeners.get(event) ?? []) cb();
    },
  };
}

// ── Platform branches ────────────────────────────────────────────────────────

test('only win32 windows click-activate (darwin uses NSPanel, not this policy)', () => {
  assert.equal(isClickActivatingPlatform('win32'), true);
  assert.equal(isClickActivatingPlatform('darwin'), false);
  assert.equal(isClickActivatingPlatform('linux'), false);
});

test('darwin: attach is a no-op — the mac panel path must stay untouched', () => {
  const win = fakeWindow();
  assert.equal(attachNoActivate(win, 'darwin'), false);
  assert.deepEqual(win.calls, [], 'must not touch focusable on macOS');
  assert.equal(isNoActivateManaged(win), false);
  assert.equal(setTypingFocus(win, true, 'darwin'), false);
});

test('win32: attach applies WS_EX_NOACTIVATE (setFocusable(false)) immediately', () => {
  const win = fakeWindow();
  assert.equal(attachNoActivate(win, 'win32'), true);
  assert.deepEqual(win.calls, [['setFocusable', false]]);
  assert.equal(isNoActivateManaged(win), true);
});

test('win32: typing grant flips focusable on + focuses; release flips it back', () => {
  const win = fakeWindow();
  attachNoActivate(win, 'win32');
  win.calls.length = 0;

  assert.equal(setTypingFocus(win, true, 'win32'), true);
  assert.deepEqual(win.calls, [['setFocusable', true], ['focus']]);

  win.calls.length = 0;
  assert.equal(setTypingFocus(win, false, 'win32'), true);
  assert.deepEqual(win.calls, [['setFocusable', false]]);
});

test('win32: typing grant self-reverts on blur and hide — a finished typing session can never leave the window click-activating', () => {
  for (const event of ['blur', 'hide']) {
    const win = fakeWindow();
    attachNoActivate(win, 'win32');
    setTypingFocus(win, true, 'win32');
    win.calls.length = 0;
    win.emit(event);
    assert.deepEqual(
      win.calls,
      [['setFocusable', false]],
      `'${event}' must restore the no-activate state`,
    );
  }
});

test('win32: unmanaged windows are refused — WeakSet membership is the IPC sender authorization', () => {
  // The preload bridge is installed in EVERY window; a launcher renderer (or a
  // compromised one) sending overlay-typing-focus must not be able to change
  // its own focusability.
  const launcher = fakeWindow();
  assert.equal(setTypingFocus(launcher, true, 'win32'), false);
  assert.deepEqual(launcher.calls, []);
});

test('destroyed windows are ignored by attach and grant', () => {
  const win = fakeWindow();
  win.destroyed = true;
  assert.equal(attachNoActivate(win, 'win32'), false);
  assert.equal(setTypingFocus(win, true, 'win32'), false);
  assert.deepEqual(win.calls, []);

  // Destruction AFTER attach: the blur/hide revert must not touch a dead window.
  const win2 = fakeWindow();
  attachNoActivate(win2, 'win32');
  win2.calls.length = 0;
  win2.destroyed = true;
  win2.emit('blur');
  assert.deepEqual(win2.calls, []);
});

// ── Source assertions: the wiring ────────────────────────────────────────────
// The policy is worthless if the windows stop opting in, or if another code
// path re-arms click-activation.

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const windowHelperSource = read('electron/WindowHelper.ts');
const preloadSource = read('electron/preload.ts');
const ipcHandlersSource = read('electron/ipcHandlers.ts');
const mainSource = read('electron/main.ts');

test('overlay, pill and toggle windows are placed under the no-activate policy at creation', () => {
  for (const win of ['this.overlayWindow', 'this.pillWindow', 'this.toggleWindow']) {
    assert.match(
      windowHelperSource,
      new RegExp(`attachNoActivate\\(${win.replace(/[.$]/g, '\\$&')}\\)`),
      `BUG: ${win} must call attachNoActivate() right after construction — without it, every ` +
        'click on that window activates Natively on Windows and steals foreground focus from ' +
        'the meeting app (macOS is protected separately by type:"panel").',
    );
  }
});

test('the overlay-anchored popovers (settings / model selector) opt in too', () => {
  assert.match(
    read('electron/SettingsWindowHelper.ts'),
    /attachNoActivate\(this\.settingsWindow\)/,
    'BUG: the settings popover opens mid-meeting; without attachNoActivate() clicking it ' +
      'steals focus on Windows (mac parity: applyStealthToWindow).',
  );
  assert.match(
    read('electron/ModelSelectorWindowHelper.ts'),
    /attachNoActivate\(this\.window\)/,
    'BUG: the model selector opens mid-meeting; without attachNoActivate() clicking it ' +
      'steals focus on Windows (mac parity: applyStealthToWindow).',
  );
});

test('the hover-gate interaction policy must not re-arm click-activation on managed windows', () => {
  // syncOverlayInteractionPolicy() runs on every hover boundary crossing and
  // historically called setFocusable(true) unconditionally — on Windows that
  // silently strips WS_EX_NOACTIVATE the moment the pointer touches the panel.
  const body = windowHelperSource.slice(
    windowHelperSource.indexOf('public syncOverlayInteractionPolicy('),
    windowHelperSource.indexOf('public setOverlayHoverInteractive('),
  );
  assert.ok(body.length > 0, 'syncOverlayInteractionPolicy() not found');
  const unguarded = body
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .filter((l) => /setFocusable\(true\)/.test(l));
  // Every setFocusable(true) inside the policy must sit behind an
  // isNoActivateManaged() guard (checked structurally: the guard appears
  // before each call within the same statement block).
  const guards = body.match(/isNoActivateManaged\(/g) ?? [];
  assert.ok(
    guards.length >= unguarded.length && unguarded.length > 0,
    'BUG: every setFocusable(true) in syncOverlayInteractionPolicy must be guarded by ' +
      '!isNoActivateManaged(...) — an unguarded call re-arms click-activation on Windows ' +
      'and overlay clicks steal foreground focus again.',
  );
});

test('preload installs the win32 typing bridge (focusin/pointerdown → overlay-typing-focus)', () => {
  const bridge = preloadSource.slice(
    preloadSource.indexOf('installWindowsTypingFocusBridge'),
  );
  assert.ok(bridge.length > 0, 'typing bridge not found in preload');
  assert.match(
    bridge,
    /process\.platform !== 'win32'\) return/,
    'BUG: the bridge must be win32-only — on macOS the NSPanel handles typing focus natively.',
  );
  assert.match(
    bridge,
    /ipcRenderer\.send\('overlay-typing-focus'/,
    'BUG: the bridge must request the grant over the overlay-typing-focus channel.',
  );
  for (const ev of ['focusin', 'focusout', 'pointerdown']) {
    assert.match(
      bridge,
      new RegExp(`addEventListener\\(\\s*'${ev}'`),
      `BUG: the bridge must listen for '${ev}' — focusin grants, focusout releases, and ` +
        'pointerdown re-grants after an OS blur left the DOM caret in place (no focusin re-fires then).',
    );
  }
});

test('main process wires the bridge: IPC handler + chat:focusInput shortcut grant', () => {
  assert.match(
    ipcHandlersSource,
    /safeOn\('overlay-typing-focus'[\s\S]{0,200}setTypingFocus\(/,
    'BUG: ipcHandlers must route overlay-typing-focus through setTypingFocus() — its managed-window ' +
      'check is the sender authorization.',
  );
  const focusInputBlock = mainSource.slice(
    mainSource.indexOf("actionId === 'chat:focusInput'"),
    mainSource.indexOf("actionId === 'chat:whatToAnswer'"),
  );
  assert.ok(focusInputBlock.length > 0, 'chat:focusInput handler not found');
  assert.match(
    focusInputBlock,
    /setTypingFocus\(overlay, true\)/,
    'BUG: the chat:focusInput fallback must grant typing focus before overlay.focus() — with ' +
      'WS_EX_NOACTIVATE a bare focus() is a no-op and the shortcut would type into nothing.',
  );
});
