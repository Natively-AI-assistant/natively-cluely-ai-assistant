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

  // chat:focusInput must drive the native tap on any platform where it is
  // available (not darwin-gated). It branches stop/start on the pre-show engaged
  // state (see the round-2 toggle-regression fix) rather than calling toggle().
  const focusInputBlock = mainSource.slice(
    mainSource.indexOf("actionId === 'chat:focusInput'"),
    mainSource.indexOf("actionId === 'chat:whatToAnswer'"),
  );
  assert.ok(focusInputBlock.length > 0, 'chat:focusInput handler not found');
  assert.match(
    focusInputBlock,
    /if \(mgr\.isAvailable\(\)\) \{[\s\S]{0,300}mgr\.stop\(\)[\s\S]{0,60}mgr\.start\(\)/,
    'BUG: chat:focusInput must drive the stealth tap whenever available (macOS AND Windows).',
  );
  // The overlay must never be focused UNCONDITIONALLY (that steals the meeting
  // app's foreground on Windows). But the no-native-tap fallback DOES need
  // overlay.focus() on macOS/Linux — the panel must become key for the DOM
  // input to receive keystrokes there. So: no setTypingFocus at all, and any
  // overlay.focus() must be win32-guarded.
  assert.doesNotMatch(
    focusInputBlock,
    /setTypingFocus/,
    'BUG: setTypingFocus (the focus-to-type bridge) must be gone.',
  );
  const focusCalls = focusInputBlock.match(/overlay\.focus\(\)/g) ?? [];
  for (const _ of focusCalls) {
    assert.match(
      focusInputBlock,
      /process\.platform !== 'win32'\) overlay\.focus\(\)/,
      'BUG: overlay.focus() in chat:focusInput must be win32-guarded — unconditional focus steals ' +
        "the meeting app's foreground on Windows, but macOS/Linux need it for the no-tap fallback.",
    );
  }
});

// ── macOS-default parity of the engaged session ─────────────────────────────
// macOS's DEFAULT path gives the input real DOM focus (the panel holds key
// focus without activating): submitting keeps the caret, focus never times out,
// and the input shows the violet `aurora` glow — no green ring (that only marks
// macOS's explicitly hotkey-engaged tap mode). Windows can never focus the
// input, so it must reproduce all three through the stealth session.

test('Windows: Enter submits WITHOUT ending the session (macOS keeps the caret)', () => {
  const src = read('src/components/NativelyInterface.tsx');
  const enterCase = src.slice(
    src.indexOf('case 36: // Return'),
    src.indexOf('case 51: // Backspace'),
  );
  assert.ok(enterCase.length > 0, 'Enter case not found in the captured-key switch');
  assert.match(
    enterCase,
    /if \(!isWindows\) \{\s*window\.electronAPI\.stealthTapStop\(\)/,
    'BUG: on Windows the stealth session must survive Enter — the hook IS the input path, so ' +
      'stopping would send the next message\'s keystrokes to the meeting app. macOS keeps focus.',
  );
});

test('Windows: the idle window is a long backstop, not the 10s macOS tap-mode timer', () => {
  const mgr = read('electron/services/StealthKeyboardManager.ts');
  assert.match(
    mgr,
    /IDLE_TIMEOUT_WIN32_MS = 5 \* 60_000/,
    'BUG: Windows needs a long idle backstop — a 10s window silently redirects typing to the ' +
      'meeting app mid-thought, which macOS (DOM focus, no timeout) never does.',
  );
  assert.match(
    mgr,
    /idleTimeoutMs\(\)[\s\S]{0,220}process\.platform === 'win32'[\s\S]{0,120}IDLE_TIMEOUT_WIN32_MS/,
    'BUG: the platform must select the timeout via idleTimeoutMs().',
  );
  assert.match(
    mgr,
    /}, StealthKeyboardManager\.idleTimeoutMs\(\)\);/,
    'BUG: armIdleTimer must USE idleTimeoutMs() — a hardcoded constant there ignores the split.',
  );
});

test('Windows: the engaged input shows the aurora glow, not the green tap-mode ring', () => {
  const src = read('src/components/NativelyInterface.tsx');
  assert.match(
    src,
    /stealthTapActive && isWindows \? 'aurora-focus-active' : ''/,
    'BUG: Windows must apply aurora-focus-active while engaged — the input can never take real ' +
      'DOM focus, so without it the box looks permanently unfocused (macOS glows on click).',
  );
  assert.match(
    src,
    /stealthTapActive && !isWindows \? 'ring-2 ring-emerald/,
    'BUG: the green ring must be macOS-only — on Windows every click engages the hook, so it ' +
      'would be permanently green, which macOS never shows.',
  );
  const css = read('src/index.css');
  assert.match(
    css,
    /\.aurora-focus:focus,\s*\n\.aurora-focus\.aurora-focus-active \{/,
    'BUG: .aurora-focus-active must be paired with :focus so the scripted class renders identically.',
  );
  for (const theme of ['liquid-glass', 'modern']) {
    assert.match(
      css,
      new RegExp(
        `\\[data-interface-theme="${theme}"\\] \\.aurora-focus\\.aurora-focus-active`,
      ),
      `BUG: the ${theme} theme override must also pair with .aurora-focus-active, or the glow ` +
        'silently differs from macOS under that theme.',
    );
  }
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

test('the Windows native hook stops stealth on Alt+Tab / any app switch (no click involved)', () => {
  // Alt+Tab is PASSED THROUGH by the keyboard hook's system-modifier filter, so
  // the user can leave without ever clicking. Without a foreground watcher the
  // hook would keep swallowing keys and their typing would land in Natively's
  // chatbox instead of the app they switched to. macOS gets this free (the
  // panel resigns key when another app activates).
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  assert.match(
    rust,
    /SetWinEventHook\(\s*EVENT_SYSTEM_FOREGROUND/,
    'BUG: a foreground-change WinEvent hook must be installed, or Alt+Tab leaves stealth engaged.',
  );
  assert.match(
    rust,
    /WINEVENT_OUTOFCONTEXT/,
    'BUG: the WinEvent hook must be out-of-context so its callback is delivered on the worker ' +
      "thread's existing message pump.",
  );
  const fgProc = rust.slice(
    rust.indexOf('unsafe extern "system" fn foreground_event_proc'),
    rust.indexOf('fn send_payload('),
  );
  assert.ok(fgProc.length > 0, 'foreground_event_proc() not found');
  assert.match(
    fgProc,
    /if window_belongs_to_us\(hwnd\) \{\s*return;/,
    'BUG: activating one of our OWN windows must NOT stop the session.',
  );
  assert.match(
    fgProc,
    /is_outside_mouse_down: true/,
    'BUG: the foreground proc must emit the stop signal when the new foreground window is not ours.',
  );
  assert.match(
    rust,
    /UnhookWinEvent\(self\.fg\)/,
    'BUG: the WinEvent hook must be released on session cleanup (now via the HookGuard Drop).',
  );
});

test('the keyboard hook passes the MODIFIER KEYS THEMSELVES through (or every shortcut dies)', () => {
  // REGRESSION GUARD. The modifier_held() guard only catches keys pressed WHILE
  // a modifier is already down — it cannot catch the modifier's own keydown,
  // because an LL hook runs before the system updates its key-state tables, so
  // GetAsyncKeyState does not yet report that very key. Without the modifier
  // VKs in the pass-through list, Alt/Ctrl/Shift/Win keydowns were swallowed,
  // the OS never saw the modifier, and NO combination could form: the app's
  // Alt+H screenshot bind and Windows' own Win-key shortcuts all died while
  // stealth typing was engaged. This is the Windows translation of the macOS
  // tap's flagsChanged pass-through (keyboard_tap.rs: `if event_type == 12`).
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  const fn = rust.slice(
    rust.indexOf('fn is_passthrough_vk('),
    rust.indexOf('fn vk_to_mac_keycode('),
  );
  assert.ok(fn.length > 0, 'is_passthrough_vk() not found');

  // Alt(0x12), Ctrl(0x11), Shift(0x10) and both Win keys must be listed.
  for (const [name, code] of [
    ['VK_MENU_ (Alt)', '0x12'],
    ['VK_CONTROL_', '0x11'],
    ['VK_SHIFT_', '0x10'],
    ['VK_LWIN_', '0x5B'],
    ['VK_RWIN_', '0x5C'],
  ]) {
    assert.match(
      fn,
      new RegExp(`${code}`, 'i'),
      `BUG: ${name} must be passed through — swallowing a modifier's own keydown means the OS ` +
        'never sees it and no shortcut can ever form.',
    );
  }
  // And they must actually be wired into the matches! arm, not just declared.
  assert.match(
    fn,
    /matches!\([\s\S]{0,900}VK_MENU_[\s\S]{0,900}\)/,
    'BUG: the modifier constants must be included in the matches! pass-through arm.',
  );
  // L/R-specific modifier codes (0xA0..=0xA5) an LL hook can report.
  assert.match(
    fn,
    /\(VK_LSHIFT_\.\.=VK_RMENU_\)\.contains\(&vk\)/,
    'BUG: the left/right-specific modifier codes (0xA0-0xA5) must pass through too.',
  );
  // CapsLock must not be eaten, or the toggle breaks.
  assert.match(
    fn,
    /VK_CAPITAL_/,
    'BUG: CapsLock must pass through or its toggle stops working while engaged.',
  );
  // Esc/Enter/Backspace must NOT be passed through — the renderer needs them.
  for (const nope of ['0x1B', '0x0D', '0x08']) {
    assert.doesNotMatch(
      fn,
      new RegExp(`${nope}`),
      `BUG: ${nope} (Esc/Enter/Backspace) must NOT be in the pass-through list — the renderer ` +
        'switch needs it, and Esc is how the user exits stealth typing.',
    );
  }
});

test('inside-vs-outside ownership uses a GA_ROOT walk (shared by both stop triggers)', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  const fn = rust.slice(
    rust.indexOf('unsafe fn window_belongs_to_us'),
    rust.indexOf('// ─── Foreground-change hook'),
  );
  assert.ok(fn.length > 0, 'window_belongs_to_us() not found');
  assert.match(
    fn,
    /GetAncestor\(hwnd, GA_ROOT\)/,
    'BUG: must walk to the root window — a Chromium child HWND can report a different process, ' +
      'which would read as "not ours" and stop stealth on the very click that engages typing.',
  );
  assert.match(
    fn,
    /pid == GetCurrentProcessId\(\)/,
    'BUG: ownership must be decided by process id, not window geometry (DPI-free).',
  );
});

test('main registers real stealth-tap handlers on Windows (not the non-desktop no-op stubs)', () => {
  // The gate that decides real-vs-stub must include win32.
  assert.match(
    mainSource,
    /process\.platform === 'darwin' \|\| process\.platform === 'win32'\) \{[\s\S]{0,1600}stealth-tap:start'/,
    'BUG: stealth-tap:* handlers must be registered for win32 with the real manager, or ' +
      'stealthTapStart() no-ops and click-to-type never engages the hook.',
  );
});
