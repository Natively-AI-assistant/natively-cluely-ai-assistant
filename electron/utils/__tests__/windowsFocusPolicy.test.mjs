// Windows click-no-activate contract for the meeting overlay family.
//
// macOS: overlay/pill/toggle/popovers are non-activating NSPanels
// (type:'panel' + becomesKeyOnlyIfNeeded via applyStealthToWindow) — clicking
// them never steals focus, and typing is captured by a CGEventTap so the
// window never becomes key (no blur even while typing).
// Windows: the mouse half is WS_EX_NOACTIVATE via setFocusable(false) (this
// module); the keyboard half is a WH_KEYBOARD_LL hook exposing the same
// StealthKeyboardTap the JS speaks (native-module/src/keyboard_hook_windows.rs)
// so the overlay is NEVER focused. Reference acceptance check: with the overlay
// above https://www.proginosko.com/test/WindowFocusEvents.html, clicking
// overlay buttons AND clicking the input to type must fire NO blur.
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
  setStealthHookAvailabilityProvider,
} = require(path.join(repoRoot, 'dist-electron/electron/utils/windowsFocusPolicy.js'));

// The availability provider is module-level state. Default it back to "hook
// present" after each test so ordering can't leak.
function withHookAvailable(available, fn) {
  setStealthHookAvailabilityProvider(() => available);
  try {
    fn();
  } finally {
    setStealthHookAvailabilityProvider(() => true);
  }
}

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
});

test('win32: attach applies WS_EX_NOACTIVATE (setFocusable(false)) immediately', () => {
  const win = fakeWindow();
  assert.equal(attachNoActivate(win, 'win32'), true);
  assert.deepEqual(win.calls, [['setFocusable', false]]);
  assert.equal(isNoActivateManaged(win), true);
});

test('win32: NO stealth hook → policy is skipped, window stays focusable (fallback, not dead input)', () => {
  withHookAvailable(false, () => {
    const win = fakeWindow();
    // With no hook to type through, making the overlay unfocusable would leave
    // a dead input. Fall back: skip the policy, leave the window focusable.
    assert.equal(attachNoActivate(win, 'win32'), false);
    assert.deepEqual(win.calls, [], 'must not touch focusable when falling back');
    assert.equal(isNoActivateManaged(win), false);
  });
});

test('win32: hook available → policy applies (the normal path)', () => {
  withHookAvailable(true, () => {
    const win = fakeWindow();
    assert.equal(attachNoActivate(win, 'win32'), true);
    assert.deepEqual(win.calls, [['setFocusable', false]]);
    assert.equal(isNoActivateManaged(win), true);
  });
});

test('win32: the window is NEVER focused — the policy is permanent, not a typing grant', () => {
  // Regression guard for the earlier "focus while typing" design that caused
  // the exact blur the user reported. The module must expose no focus path.
  const mod = require(path.join(repoRoot, 'dist-electron/electron/utils/windowsFocusPolicy.js'));
  assert.equal(
    typeof mod.setTypingFocus,
    'undefined',
    'BUG: setTypingFocus must not exist — focusing the overlay to type is what stole focus. ' +
      'Typing without focus is handled by the WH_KEYBOARD_LL hook, not by focusing the window.',
  );
  const win = fakeWindow();
  attachNoActivate(win, 'win32');
  // Only ever setFocusable(false) — never true.
  assert.ok(
    win.calls.every(([m, arg]) => m !== 'setFocusable' || arg === false),
    'BUG: attachNoActivate must never call setFocusable(true)',
  );
});

test('win32: blur/hide re-assert focusable=false (defensive against a stray focus)', () => {
  for (const event of ['blur', 'hide']) {
    const win = fakeWindow();
    attachNoActivate(win, 'win32');
    win.calls.length = 0;
    win.emit(event);
    assert.deepEqual(
      win.calls,
      [['setFocusable', false]],
      `'${event}' must re-assert the no-activate state`,
    );
  }
});

test('destroyed windows are ignored by attach, and the revert never touches a dead window', () => {
  const win = fakeWindow();
  win.destroyed = true;
  assert.equal(attachNoActivate(win, 'win32'), false);
  assert.deepEqual(win.calls, []);

  const win2 = fakeWindow();
  attachNoActivate(win2, 'win32');
  win2.calls.length = 0;
  win2.destroyed = true;
  win2.emit('blur');
  assert.deepEqual(win2.calls, [], 'revert must guard isDestroyed()');
});

// ── Source assertions: the wiring ────────────────────────────────────────────

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const windowHelperSource = read('electron/WindowHelper.ts');
const mainSource = read('electron/main.ts');
const stealthMgrSource = read('electron/services/StealthKeyboardManager.ts');
const preloadSource = read('electron/preload.ts');
const ipcHandlersSource = read('electron/ipcHandlers.ts');

test('overlay, pill and toggle windows are placed under the no-activate policy at creation', () => {
  for (const win of ['this.overlayWindow', 'this.pillWindow', 'this.toggleWindow']) {
    assert.match(
      windowHelperSource,
      new RegExp(`attachNoActivate\\(${win.replace(/[.$]/g, '\\$&')}\\)`),
      `BUG: ${win} must call attachNoActivate() right after construction — without it, every ` +
        'click on that window activates Natively on Windows and steals foreground focus.',
    );
  }
});

test('the overlay-anchored popovers (settings / model selector) opt in too', () => {
  assert.match(
    read('electron/SettingsWindowHelper.ts'),
    /attachNoActivate\(this\.settingsWindow\)/,
    'BUG: the settings popover must call attachNoActivate() or clicking it steals focus on Windows.',
  );
  assert.match(
    read('electron/ModelSelectorWindowHelper.ts'),
    /attachNoActivate\(this\.window\)/,
    'BUG: the model selector must call attachNoActivate() or clicking it steals focus on Windows.',
  );
});

test('the hover-gate interaction policy must not re-arm click-activation on managed windows', () => {
  const body = windowHelperSource.slice(
    windowHelperSource.indexOf('public syncOverlayInteractionPolicy('),
    windowHelperSource.indexOf('public setOverlayHoverInteractive('),
  );
  assert.ok(body.length > 0, 'syncOverlayInteractionPolicy() not found');
  const unguarded = body
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .filter((l) => /setFocusable\(true\)/.test(l));
  const guards = body.match(/isNoActivateManaged\(/g) ?? [];
  assert.ok(
    guards.length >= unguarded.length && unguarded.length > 0,
    'BUG: every setFocusable(true) in syncOverlayInteractionPolicy must be guarded by ' +
      '!isNoActivateManaged(...) — an unguarded call re-arms click-activation on Windows.',
  );
});

test('the removed typing-focus bridge is gone (preload + ipc) — it was the blur cause', () => {
  assert.doesNotMatch(
    preloadSource,
    /overlay-typing-focus|installWindowsTypingFocusBridge/,
    'BUG: the preload typing-focus bridge must be removed — focusing to type stole focus.',
  );
  assert.doesNotMatch(
    ipcHandlersSource,
    /overlay-typing-focus|setTypingFocus/,
    'BUG: the overlay-typing-focus IPC handler must be removed.',
  );
});

test('typing without focus is wired to the native stealth hook on BOTH desktop platforms', () => {
  // StealthKeyboardManager must load the native tap on win32 too (not darwin-only).
  const createTap = stealthMgrSource.slice(
    stealthMgrSource.indexOf('private createTapInstance('),
    stealthMgrSource.indexOf('private callNativePermissionCheck('),
  );
  assert.ok(createTap.length > 0, 'createTapInstance() not found');
  assert.match(
    createTap,
    /process\.platform !== 'darwin' && process\.platform !== 'win32'/,
    "BUG: createTapInstance must allow win32 — the Windows WH_KEYBOARD_LL hook exports the same " +
      'StealthKeyboardTap; gating on darwin-only leaves Windows with no keystroke capture.',
  );

  // WindowHelper must register the overlay as the captured-key sink on win32.
  const reg = windowHelperSource.slice(
    windowHelperSource.indexOf('Register the overlay as the sole recipient'),
    windowHelperSource.indexOf('Register the overlay as the sole recipient') + 900,
  );
  assert.match(
    reg,
    /process\.platform === 'darwin' \|\| process\.platform === 'win32'/,
    'BUG: the overlay must be registered with StealthKeyboardManager on Windows too, or captured ' +
      'keystrokes have no sink (and would fan out to all windows if the guard were dropped).',
  );

  // chat:focusInput must toggle the native tap on any platform where it is
  // available (not darwin-gated) and must NOT focus the overlay as a fallback.
  const focusInputBlock = mainSource.slice(
    mainSource.indexOf("actionId === 'chat:focusInput'"),
    mainSource.indexOf("actionId === 'chat:whatToAnswer'"),
  );
  assert.ok(focusInputBlock.length > 0, 'chat:focusInput handler not found');
  assert.match(
    focusInputBlock,
    /mgr\.isAvailable\(\)[\s\S]{0,80}mgr\.toggle\(\)/,
    'BUG: chat:focusInput must toggle the stealth tap whenever available (macOS AND Windows).',
  );
  assert.doesNotMatch(
    focusInputBlock,
    /overlay\.focus\(\)|setTypingFocus/,
    'BUG: chat:focusInput must NOT focus the overlay — focusing a WS_EX_NOACTIVATE window steals ' +
      'foreground focus, the regression this feature removes.',
  );
});

test('main registers the hook-availability provider before creating windows (dead-input fallback)', () => {
  const providerIdx = mainSource.indexOf('setStealthHookAvailabilityProvider(');
  const windowIdx = mainSource.indexOf('this.windowHelper = new WindowHelper(this)');
  assert.ok(providerIdx > 0, 'BUG: main must register the stealth-hook availability provider.');
  assert.ok(windowIdx > 0, 'WindowHelper construction not found');
  assert.ok(
    providerIdx < windowIdx,
    'BUG: the provider must be registered BEFORE WindowHelper is created, or the overlay could be ' +
      'made no-activate before availability is known — a dead input when the hook is missing.',
  );
  assert.match(
    mainSource.slice(providerIdx, providerIdx + 400),
    /StealthKeyboardManager[\s\S]{0,80}isAvailable\(\)/,
    'BUG: the provider must report actual native-hook availability via StealthKeyboardManager.isAvailable().',
  );
});

test('the Windows native hook stops stealth on a click outside Natively (outside-click parity)', () => {
  // Rust-source assertion (the binary is built out-of-band). The manager already
  // stops on isOutsideMouseDown; the Windows hook must PRODUCE that signal via a
  // WH_MOUSE_LL hook using a process check (DPI-free, no bounds needed).
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  assert.match(
    rust,
    /SetWindowsHookExW\(\s*WH_MOUSE_LL/,
    'BUG: a WH_MOUSE_LL hook must be installed — without it, clicking back into the meeting app ' +
      'does not stop stealth, so the keyboard hook keeps swallowing keys and the user cannot type there.',
  );
  assert.match(
    rust,
    /is_outside_mouse_down: true/,
    'BUG: the mouse hook must emit isOutsideMouseDown so StealthKeyboardManager.stop() fires.',
  );
  assert.match(
    rust,
    /GetWindowThreadProcessId[\s\S]{0,200}GetCurrentProcessId\(\)/,
    'BUG: outside-vs-inside must be decided by the clicked window PROCESS (clicking any Natively ' +
      'window keeps the session; another process stops it) — DPI-free, no bounds math.',
  );
  assert.match(
    rust,
    /Never swallow the click[\s\S]{0,80}CallNextHookEx/,
    'BUG: the mouse hook must pass clicks through (never swallow) — the click must reach its target.',
  );
});

test('main registers real stealth-tap handlers on Windows (not the non-desktop no-op stubs)', () => {
  // The gate that decides real-vs-stub must include win32.
  assert.match(
    mainSource,
    /process\.platform === 'darwin' \|\| process\.platform === 'win32'\) \{[\s\S]{0,600}stealth-tap:start'/,
    'BUG: stealth-tap:* handlers must be registered for win32 with the real manager, or ' +
      'stealthTapStart() no-ops and click-to-type never engages the hook.',
  );
});
