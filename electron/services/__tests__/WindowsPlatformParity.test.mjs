// Windows/macOS parity for platform-gated behaviour that was macOS-only.
//
// Each test pins one gap found in a cross-platform audit, where a feature
// existed on macOS and was missing, stubbed, or degraded on Windows. Source
// assertions: these are wiring/branching contracts, and the code they guard
// touches Electron singletons (tray, app.isPackaged, screen) that cannot be
// instantiated in a plain node test.
//
// The rule every fix follows: the darwin path must stay byte-for-byte what
// shipped, so a Windows fix can never regress macOS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

// ── 1. Packaged Windows builds failed their own asset preflight ──────────────
// sharp / sqlite-vec ship as per-OS packages. The four darwin paths used to run
// unconditionally, so every packaged Windows build failed them, flipped
// `nativeOk` false, and told the user "Please reinstall Natively" on a good
// install. Dev mode short-circuits the check, hiding it locally.

test('preflight: the darwin-only native asset checks are gated to darwin', () => {
  const src = read('electron/services/LocalFallbackPreflight.ts');
  const block = src.slice(
    src.indexOf('// sharp / sqlite-vec ship as per-OS packages'),
    src.indexOf('// 4. Ollama optional path.'),
  );
  assert.ok(block.length > 0, 'platform-scoped native-asset block not found');
  assert.match(
    block,
    /if \(process\.platform === 'darwin'\) \{[\s\S]*?sharp darwin-arm64 native/,
    'BUG: the darwin sharp/sqlite-vec checks must sit behind a darwin gate — running them on ' +
      'Windows fails four checks for binaries that are never installed there.',
  );
  // Every darwin check must still be present and unchanged (no macOS regression).
  for (const id of [
    'sharp darwin-arm64 native',
    'sharp darwin-x64 native',
    'sqlite-vec darwin-arm64 dylib',
    'sqlite-vec darwin-x64 dylib',
  ]) {
    assert.ok(block.includes(id), `BUG: macOS regression — the "${id}" check disappeared.`);
  }
});

test('preflight: the Windows sharp check pins the RUNNING arch, not a prefix', () => {
  const src = read('electron/services/LocalFallbackPreflight.ts');
  const block = src.slice(
    src.indexOf("} else if (process.platform === 'win32') {"),
    src.indexOf('// 4. Ollama optional path.'),
  );
  assert.ok(block.length > 0, 'win32 native-asset branch not found');

  // This assertion INVERTS the one it replaces, deliberately.
  //
  // The original required the Windows check to be arch-agnostic, because the
  // build only ever installed @img/sharp-win32-x64 and pinning an arch would
  // have failed the ia32 installer with a false 'reinstall Natively' alarm.
  // That made the prefix match the lesser evil, not the correct check.
  //
  // scripts/ensure-sharp-win-deps.js now installs every arch the NSIS target
  // ships, so the false alarm is gone — and the prefix match became the
  // defect: 'sharp-win32-' also matches the packaged x64 directory on an ia32
  // install, so the check reported healthy on exactly the wrong-bitness
  // install it exists to catch.
  assert.ok(
    block.includes('sharp-win32-' + '${process.arch}'),
    'BUG: the Windows sharp check must pin the running arch — a prefix match is ' +
      'satisfied by the packaged x64 directory on an ia32 install, hiding a ' +
      'wrong-bitness binary behind a passing check.',
  );
  assert.ok(
    !block.includes("checkUnpackedNativePrefix('node_modules/@img'"),
    'BUG: reverted to the prefix match — see above; it cannot distinguish arches.',
  );
});

test('preflight: sqlite-vec absent on a non-x64 Windows arch is expected, not a failure', () => {
  const src = read('electron/services/LocalFallbackPreflight.ts');
  const block = src.slice(
    src.indexOf("} else if (process.platform === 'win32') {"),
    src.indexOf('// 4. Ollama optional path.'),
  );

  // sqlite-vec publishes a Windows extension for x64 only, at every version
  // (checked through 0.1.10-alpha.4). On ia32 the extension is legitimately
  // absent: DatabaseManager catches the load error and VectorStore drops to
  // JS cosine. Asserting its presence there would flip `nativeOk` and tell a
  // correctly-installed user to reinstall — so the arch split must stay, and
  // the non-x64 branch must report ok.
  assert.ok(
    block.includes("if (process.arch === 'x64') {"),
    'BUG: the sqlite-vec Windows check must be split by arch — only x64 has a ' +
      'published extension to look for.',
  );
  assert.ok(
    block.includes('sqlite-vec-windows-x64/vec0.dll'),
    'BUG: the x64 branch must verify the actual packaged extension file.',
  );

  const nonX64Branch = block.slice(block.indexOf('} else {'));
  assert.ok(
    nonX64Branch.includes("id: 'sqlite-vec windows extension'") &&
      nonX64Branch.includes('ok: true'),
    'BUG: on a non-x64 Windows arch the check must report ok — a missing ' +
      'sqlite-vec there is upstream reality, not a corrupt install, and failing ' +
      'it produces a false "Please reinstall Natively".',
  );
});

// ── 1c. 32-bit Windows has no ONNX runtime, and said so as 'reinstall me' ────
// onnxruntime-node publishes prebuilt binaries only, for win32 {x64, arm64}.
// The ia32 installer therefore has no ONNX runtime at all, so the three import
// probes failed and every packaged-local provider reported
// 'missing_required_asset' — i.e. told a correctly-installed 32-bit user to
// reinstall, which could never help. Cloud STT and cloud embeddings are
// unaffected, so the honest status is 'unavailable', not 'corrupt'.

test('preflight: the ONNX import probes are skipped on an arch with no runtime', () => {
  const src = read('electron/services/LocalFallbackPreflight.ts');

  assert.ok(
    src.includes('function onnxRuntimeSupportsThisArch()'),
    'BUG: the arch-capability gate is gone — the ia32 build then probes for an ' +
      'onnxruntime-node binary that is not published for it.',
  );
  assert.ok(
    src.includes("if (process.platform === 'win32') return process.arch === 'x64' || process.arch === 'arm64';"),
    'BUG: the win32 ONNX arch set must stay {x64, arm64} — those are the only ' +
      'binaries onnxruntime-node publishes for Windows.',
  );
  assert.ok(
    src.includes('const onnxArchSupported = onnxRuntimeSupportsThisArch();') &&
      src.includes('if (onnxArchSupported) {'),
    'BUG: the import probes must sit behind the arch gate.',
  );
});

test('preflight: a no-ONNX arch reports unavailable, never "Please reinstall"', () => {
  const src = read('electron/services/LocalFallbackPreflight.ts');

  // 'missing_required_asset' is the only health that sets recoverable:false
  // (see statusFor), and it is the one that renders the reinstall prompt. An
  // architecture that upstream never built for is not a damaged install.
  for (const provider of ['local-embedding', 'intent-classifier', 'local-reranker']) {
    const idx = src.indexOf("'" + provider + "',");
    assert.ok(idx > -1, 'provider status block for ' + provider + ' not found');
    const block = src.slice(idx, idx + 900);
    assert.ok(
      block.includes("onnxArchSupported ? 'missing_required_asset' : 'unavailable'"),
      'BUG: ' + provider + ' must report unavailable (not missing_required_asset) ' +
        'when the architecture has no ONNX runtime — otherwise a correctly ' +
        'installed 32-bit user is told to reinstall, which cannot help.',
    );
  }
});

// ── 2. Full-screen screenshots captured the wrong monitor on Windows ─────────
// main.ts resolves the display the overlay/meeting is on and passes it down,
// but the win32 branch dropped the argument, so capture fell through to
// screen.getPrimaryDisplay() — a multi-monitor user silently sent the model
// their primary screen instead of the meeting's.

test('screenshot: BOTH desktop platforms forward preferredDisplay', () => {
  const src = read('electron/ScreenshotHelper.ts');
  // Every full-screen desktopCapturer call (i.e. not the area/cropper one) must
  // pass preferredDisplay.
  const fullScreenCalls = src
    .split('\n')
    .filter((l) => l.includes('captureWithDesktopCapturer(screenshotPath'));
  assert.ok(fullScreenCalls.length >= 2, 'expected the queue + extra full-screen capture calls');
  for (const call of fullScreenCalls) {
    if (call.includes('captureArea')) continue; // selective capture resolves its own display
    assert.match(
      call,
      /preferredDisplay/,
      'BUG: a full-screen capture dropped preferredDisplay — it will fall through to ' +
        'screen.getPrimaryDisplay() and capture the wrong monitor on multi-display setups.',
    );
  }
  // And there must be no win32 branch that calls it without the display.
  assert.doesNotMatch(
    src,
    /process\.platform === 'win32'\) \{\s*\n\s*await this\.captureWithDesktopCapturer\(screenshotPath\);/,
    'BUG: the win32-only capture branch that omitted preferredDisplay is back.',
  );
});

// ── 3 & 5. Undetectable mode was only half-applied on Windows ────────────────
// showTray()/hideTray() were reachable only from _enforceDockState(), which
// returns immediately off darwin — so on Windows nothing drove the tray at all
// (launch-undetectable gave no tray for the session; toggling back off never
// restored it). Separately the launcher is the only window without
// skipTaskbar, so undetectable still left a taskbar button.

test('undetectable: Windows drives the tray on toggle (macOS does it via _enforceDockState)', () => {
  const src = read('electron/main.ts');
  const win32Branch = src.slice(
    src.indexOf("if (process.platform === 'win32') {", src.indexOf('public setUndetectable')),
    src.indexOf("SettingsManager.getInstance().set('isUndetectable'"),
  );
  assert.ok(win32Branch.length > 0, 'win32 branch of setUndetectable not found');
  assert.match(
    win32Branch,
    /if \(state\) this\.hideTray\(\);\s*\n\s*else this\.showTray\(\);/,
    'BUG: the Windows toggle must drive the tray — otherwise the tray menu (show window / quit) ' +
      'never appears for a session that started undetectable, and never returns after toggling off.',
  );
  // macOS must keep driving it from the enforcement loop (no regression).
  //
  // Asserted on the PRESENCE of both pairs inside _enforceDockState, not on the
  // tray call sitting directly under app.dock.hide()/show(). That adjacency is
  // not the invariant, and pinning it makes this test fail on a legitimate
  // refactor: the tray calls belong OUTSIDE the `shouldApply` gate, because
  // decideDockTransition sets it false whenever the dock is already settled —
  // so gating the tray on it means stealth ON with the dock already hidden
  // never runs hideTray() (the tray keeps the real app name for the whole
  // session), and the mirror case leaves no tray at all. What must never
  // regress is that this function drives BOTH the dock and the tray on the
  // darwin path; where the two calls sit relative to each other is free.
  const enforceBody = src.slice(
    src.indexOf('private _enforceDockState('),
    src.indexOf('this._enforceDockState(wantUndetectable, targetFocusWindow, attempt + 1'),
  );
  assert.ok(enforceBody.length > 0, '_enforceDockState body not found');
  for (const [call, what] of [
    ['app.dock.hide();', 'the dock hide'],
    ['app.dock.show();', 'the dock restore'],
    ['this.hideTray();', 'the tray hide'],
    ['this.showTray();', 'the tray restore'],
  ]) {
    assert.ok(
      enforceBody.includes(call),
      `BUG: macOS regression — ${what} (${call}) disappeared from _enforceDockState.`,
    );
  }
});

test('undetectable: the launcher leaves the Windows taskbar, at creation AND on toggle', () => {
  const wh = read('electron/WindowHelper.ts');
  const main = read('electron/main.ts');
  const fn = wh.slice(
    wh.indexOf('public syncLauncherTaskbarForStealth()'),
    wh.indexOf('// Force-reapply the CURRENT content-protection state'),
  );
  assert.ok(fn.length > 0, 'syncLauncherTaskbarForStealth() not found');
  assert.match(
    fn,
    /process\.platform !== 'win32'\) return/,
    'BUG: must no-op off win32 — macOS stealth is the Dock/activation-policy path and does not ' +
      'use skipTaskbar; forcing it there would be an unrequested behaviour change.',
  );
  assert.match(
    fn,
    /setSkipTaskbar\(!!this\.appState\.getUndetectable\(\)\)/,
    'BUG: the launcher taskbar presence must track the undetectable setting.',
  );
  // Creation-time application: a session that STARTS undetectable must not show
  // a taskbar button until the user toggles twice.
  assert.match(
    wh,
    /this\.launcherWindow\.setContentProtection\(this\.contentProtection\);\s*\n[\s\S]{0,320}this\.syncLauncherTaskbarForStealth\(\);/,
    'BUG: apply the persisted undetectable state to the launcher at creation.',
  );
  // Toggle-time application.
  assert.match(
    main,
    /this\.windowHelper\.syncLauncherTaskbarForStealth\(\);/,
    'BUG: setUndetectable must re-sync the launcher taskbar on Windows.',
  );
});

// ── 4. CJK/IME input was silently broken on Windows ─────────────────────────
// The hook swallows keystrokes before IMM32/TSF can compose them, and the text
// it substitutes comes from ToUnicodeEx, which does no composition. Windows had
// no probe and hardcoded should-auto-engage=true, so a Pinyin/Hangul/Kanji user
// clicking the input lost the candidate window and could only type raw Latin.
// macOS detects the same situation (ImeDetector) and declines to auto-engage.

test('ime: the native probe exists and keys off the CJK primary language ids', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  const fn = rust.slice(
    rust.indexOf('pub fn is_ime_keyboard_active()'),
    rust.indexOf('pub struct StealthKeyboardTap'),
  );
  assert.ok(fn.length > 0, 'is_ime_keyboard_active() not found');
  assert.match(fn, /GetKeyboardLayout\(thread_id\)/, 'BUG: must read the active keyboard layout.');
  assert.match(
    fn,
    /LANG_CHINESE: u16 = 0x04[\s\S]{0,200}LANG_JAPANESE: u16 = 0x11[\s\S]{0,200}LANG_KOREAN: u16 = 0x12/,
    'BUG: must test the CJK PRIMARYLANGIDs (zh/ja/ko) — those are the composing layouts.',
  );
  assert.match(
    fn,
    /& 0x03FF/,
    'BUG: PRIMARYLANGID is the low 10 bits of the LANGID; masking wrongly misclassifies layouts.',
  );
});

test('ime: Windows reports stealth typing unavailable while a CJK IME is active', () => {
  const mgr = read('electron/services/StealthKeyboardManager.ts');
  const isAvail = mgr.slice(
    mgr.indexOf('public isAvailable()'),
    mgr.indexOf('public isNativeTapPresent()'),
  );
  assert.ok(isAvail.length > 0, 'isAvailable() not found');
  assert.match(
    isAvail,
    /process\.platform === 'win32' && this\.isImeActive\(\)\) return false/,
    'BUG: an active CJK IME must make stealth typing report unavailable, which routes the user ' +
      'through the focusable-overlay fallback where composition actually works.',
  );
  // The probe must fail OPEN (no IME) when the export is missing, so a stale
  // binary keeps working instead of disabling stealth typing for everyone.
  const probe = mgr.slice(mgr.indexOf('private isImeActive()'));
  assert.match(
    probe,
    /typeof native\?\.isImeKeyboardActive === 'function'[\s\S]{0,120}: false/,
    'BUG: a binary without the probe must be treated as "no IME", not as "IME active".',
  );
  // Binary-presence semantics must remain available separately.
  assert.match(mgr, /public isNativeTapPresent\(\)/, 'BUG: keep a raw binary-presence accessor.');
});

test('ime: the Windows auto-engage handlers consult the probe, not a hardcoded true', () => {
  const main = read('electron/main.ts');
  const win32Else = main.slice(
    main.indexOf('// Windows: same decision as macOS, different probe.'),
    main.indexOf("registerStealthHandler('stealth-tap:available', () => false)"),
  );
  assert.ok(win32Else.length > 0, 'win32 stealth-handler branch not found');
  assert.match(
    win32Else,
    /'stealth-tap:should-auto-engage', \(\) => stealth\.isAvailable\(\)/,
    'BUG: Windows must decline auto-engage while an IME is active.',
  );
  assert.doesNotMatch(
    win32Else,
    /'stealth-tap:should-auto-engage', \(\) => true/,
    'BUG: the hardcoded true is back — CJK users would auto-engage and lose composition.',
  );
  // macOS must still use its own TIS probe (no regression).
  assert.match(
    main,
    /const \{ shouldAutoEngageStealthTap \} = require\('\.\/services\/ImeDetector'\)/,
    'BUG: macOS regression — the ImeDetector probe is no longer used on darwin.',
  );
});

// ── Review hardening: security (bounded capture, IPC auth, shutdown) ─────────

test('security: stealth typing is stopped when the overlay hides or we leave it', () => {
  const wh = read('electron/WindowHelper.ts');
  assert.match(
    wh,
    /private stopStealthTyping\(\): void \{[\s\S]{0,260}StealthKeyboardManager[\s\S]{0,80}\.stop\(\)/,
    'BUG: WindowHelper needs a stopStealthTyping() that disengages the hook.',
  );
  const hide = wh.slice(wh.indexOf('public hideOverlay()'), wh.indexOf('public hideOverlay()') + 800);
  assert.match(hide, /this\.stopStealthTyping\(\)/, 'BUG: hideOverlay must stop stealth typing.');
  const toLauncher = wh.slice(
    wh.indexOf('public switchToLauncher('),
    wh.indexOf('public switchToLauncher(') + 800,
  );
  assert.match(
    toLauncher,
    /this\.stopStealthTyping\(\)/,
    'BUG: switchToLauncher (end-meeting) must stop stealth typing, or the hook keeps swallowing ' +
      'keystrokes system-wide with the overlay hidden and no visible indicator.',
  );
  // And the manager stops when the overlay window is destroyed.
  const mgr = read('electron/services/StealthKeyboardManager.ts');
  assert.match(
    mgr,
    /this\.overlayWebContents = null;[\s\S]{0,400}if \(this\.active\) this\.stop\(\)/,
    "BUG: the overlay 'closed' handler must stop the tap — a destroyed sink must not keep capture live.",
  );
});

test('security: stealth-tap:start is authorized to the overlay sender only', () => {
  const main = read('electron/main.ts');
  const block = main.slice(
    main.indexOf('const isFromOverlay'),
    main.indexOf("registerStealthHandler('stealth-tap:start'") + 200,
  );
  assert.match(
    block,
    /overlay\.webContents\.id === event\?\.sender\?\.id/,
    'BUG: isFromOverlay must compare the sender to the overlay webContents id.',
  );
  assert.match(
    block,
    /registerStealthHandler\('stealth-tap:start', \(event: any\) =>\s*isFromOverlay\(event\) \? stealth\.start\(\) : false/,
    'BUG: stealth-tap:start must reject senders that are not the overlay — any renderer could ' +
      'otherwise engage the system-wide keyboard hook.',
  );
});

test('security: shutdown stops the tap on Windows too (napi teardown race)', () => {
  const main = read('electron/main.ts');
  assert.match(
    main,
    /if \(process\.platform === 'darwin' \|\| process\.platform === 'win32'\) \{[\s\S]{0,800}Failed to stop StealthKeyboardManager during shutdown/,
    'BUG: the shutdown stop() was darwin-only; the Windows worker holds an Arc<ThreadsafeFunction> ' +
      'and can crash on quit if a keystroke fires during V8 teardown.',
  );
});

// ── Second-round review: F1-residual, toggle regression, start visibility ────

test('security(round2): hideMainWindow (Ctrl+B / screenshot hide) also stops stealth', () => {
  const wh = read('electron/WindowHelper.ts');
  const fn = wh.slice(wh.indexOf('public hideMainWindow()'), wh.indexOf('public hideMainWindow()') + 900);
  assert.match(
    fn,
    /this\.stopStealthTyping\(\)/,
    'BUG: hideMainWindow hides the overlay directly — it must stop stealth too, or Ctrl+B leaves the ' +
      'hook engaged with the overlay hidden (the F1 residual).',
  );
});

test('security(round2): chat:focusInput branches on pre-show state, not toggle()', () => {
  const main = read('electron/main.ts');
  const block = main.slice(
    main.indexOf("actionId === 'chat:focusInput'"),
    main.indexOf("actionId === 'chat:whatToAnswer'"),
  );
  assert.match(
    block,
    /const wasStealthActive = mgr\.isAvailable\(\) && mgr\.isActive\(\);\s*\n\s*this\.showMainWindow/,
    'BUG: wasActive must be captured BEFORE showMainWindow (which can stop stealth via ' +
      'switchToLauncher), or the toggle always starts and can never disengage in launcher mode.',
  );
  assert.match(
    block,
    /if \(wasStealthActive\) mgr\.stop\(\);\s*\n\s*else mgr\.start\(\)/,
    'BUG: must branch stop/start explicitly.',
  );
  assert.doesNotMatch(block, /mgr\.toggle\(\)/, 'BUG: the broken toggle() call must be gone.');
});

test('security(round2): start() refuses on win32 when the overlay is not visible', () => {
  const mgr = read('electron/services/StealthKeyboardManager.ts');
  const start = mgr.slice(mgr.indexOf('public start(): boolean'), mgr.indexOf('this.active = true;'));
  assert.match(
    start,
    /process\.platform === 'win32' &&\s*\([\s\S]{0,160}!this\.overlayWindow\.isVisible\(\)[\s\S]{0,40}\)\s*\)\s*\{\s*return false/,
    'BUG: start() must refuse on win32 when the overlay is hidden/destroyed — enforces ' +
      'hook-engaged⟹overlay-visible so the hook can never swallow keystrokes with no visible UI.',
  );
  // macOS must NOT gain a visibility gate (no regression).
  assert.match(start, /process\.platform === 'win32' &&/, 'the gate must be win32-scoped');
});

test('rust(round2): the catch_unwind Err arms do NOT log (eprintln can panic → abort)', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  // Neither the keyboard nor mouse proc shell may print in the panic arm.
  assert.doesNotMatch(
    rust,
    /Err\(_\) => \{\s*\n\s*eprintln!/,
    'BUG: an eprintln! in the catch_unwind Err arm can itself panic across the FFI boundary and ' +
      'abort the process — the exact failure the guard prevents.',
  );
  assert.doesNotMatch(rust, /proc panicked/, 'BUG: the panic-arm log lines must be gone.');
});

test('rust(round2): AltGr is Ctrl+Alt only — the VK_RMENU disjunct is removed', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  assert.match(
    rust,
    /let altgr = ctrl && alt;/,
    'BUG: altgr must be `ctrl && alt` — the VK_RMENU disjunct fabricated a Ctrl on US/UK layouts ' +
      'and split left/right-Alt shortcut handling.',
  );
  assert.doesNotMatch(
    rust,
    /modifier_held\(VK_RMENU\)/,
    'BUG: the VK_RMENU AltGr disjunct must be gone.',
  );
});

test('rust(round2): the message queue is forced BEFORE the hooks install (timeout-leak fix)', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  const worker = rust.slice(
    rust.indexOf('fn hook_worker('),
    rust.indexOf('let hook = match unsafe'),
  );
  assert.match(
    worker,
    /PeekMessageW\(&mut msg, HWND::default\(\), WM_USER, WM_USER, PM_NOREMOVE\)/,
    'BUG: PeekMessageW must run before SetWindowsHookExW so a WM_QUIT on the start() timeout path ' +
      'is never lost (which would leak the worker thread and both global hooks).',
  );
  // And there must be exactly ONE PeekMessageW CALL (the old later one was
  // removed). Match the call form with its args so a comment mention doesn't count.
  assert.equal(
    (rust.match(/PeekMessageW\(&mut msg/g) ?? []).length,
    1,
    'BUG: there should be exactly one PeekMessageW call (moved to the top, not duplicated).',
  );
});

// ── Review hardening: native Rust safety/correctness (source assertions) ─────

test('rust: all three hook procs are panic-contained (catch_unwind) and cleanup is a Drop guard', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  for (const proc of ['keyboard_hook_inner', 'mouse_hook_inner', 'foreground_event_inner']) {
    assert.match(
      rust,
      new RegExp(`catch_unwind\\(AssertUnwindSafe\\(\\|\\| unsafe \\{\\s*${proc}`),
      `BUG: ${proc} must run under catch_unwind — a panic across the extern "system" boundary ` +
        'aborts the whole app from the OS input thread.',
    );
  }
  assert.match(
    rust,
    /impl Drop for HookGuard \{[\s\S]{0,400}UnhookWindowsHookEx\(self\.kb\)/,
    'BUG: hook cleanup must be a Drop guard so a panic in the worker still unhooks — otherwise a ' +
      'global keyboard hook is left installed swallowing every keystroke system-wide.',
  );
});

test('rust: the message-queue race and session-id cleanup are fixed', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  // PeekMessage forces the thread queue to exist BEFORE ready is signalled
  // (it now sits at the top of the worker, so check order, not proximity).
  const peekIdx = rust.indexOf('PeekMessageW(&mut msg, HWND::default(), WM_USER, WM_USER, PM_NOREMOVE)');
  const readyIdx = rust.indexOf('ready_tx.send(true)');
  assert.ok(peekIdx > 0 && readyIdx > 0, 'PeekMessageW / ready_tx.send(true) not found');
  assert.ok(
    peekIdx < readyIdx,
    "BUG: the queue must be forced (PeekMessageW) before signalling ready, or a fast stop()'s " +
      'WM_QUIT is dropped and the main thread hangs on join().',
  );
  // Cleanup keyed on session id, not the always-true Arc::ptr_eq.
  assert.match(
    rust,
    /session_id\.load\(Ordering::Acquire\) == self\.session_id/,
    'BUG: cleanup must compare a session id — Arc::ptr_eq was always true (every worker shares one Arc).',
  );
  assert.doesNotMatch(rust, /Arc::ptr_eq\(/, 'BUG: the no-op Arc::ptr_eq() guard call must be gone.');
});

test('rust: char translation uses the foreground layout, captures AltGr, honours NumLock/CapsLock', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  assert.match(
    rust,
    /fn foreground_keyboard_layout\(\)[\s\S]{0,200}GetKeyboardLayout\(tid\)/,
    'BUG: must resolve chars with the foreground app\'s layout, not the worker thread default.',
  );
  assert.match(
    rust,
    /let altgr = ctrl && alt;/,
    'BUG: AltGr must be detected as Ctrl+Alt so its characters are captured, not leaked. (The ' +
      'VK_RMENU disjunct was removed — it fabricated a Ctrl on US/UK layouts.)',
  );
  assert.match(
    rust,
    /if altgr && key_code == 0 && chars\.is_empty\(\) \{\s*return pass\(\)/,
    'BUG: an AltGr combo that yields no text is a real shortcut and must pass through.',
  );
  assert.match(
    rust,
    /if num \{\s*key_state\[VK_NUMLOCK\.0 as usize\] = 0x01/,
    'BUG: NumLock must be set in the key-state or numpad digits resolve to nothing.',
  );
  assert.match(
    rust,
    /caps_on: AtomicBool[\s\S]{0,60}num_on: AtomicBool/,
    'BUG: CapsLock/NumLock toggle state must be tracked (worker-thread GetKeyState is stale).',
  );
});

test('rust: the foreground-change proc ignores transient hwnd==0 states', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  const fg = rust.slice(
    rust.indexOf('unsafe fn foreground_event_inner'),
    rust.indexOf('fn send_payload('),
  );
  assert.match(
    fg,
    /if hwnd\.0 == 0 \{\s*return;/,
    'BUG: a transient foreground change to hwnd==0 must NOT stop the session (it is not an app switch).',
  );
});

test('preflight: the new Windows check ids are still selected by nativeOk', () => {
  // `nativeOk` picks checks by id prefix; renaming an id silently drops it from
  // the aggregate, which would make the gate pass while the asset is missing.
  const src = read('electron/services/LocalFallbackPreflight.ts');
  const line = src.split('\n').find((l) => l.includes('const nativeOk ='));
  assert.ok(line, 'nativeOk aggregate not found');
  const selects = (id) =>
    id.startsWith('rust native') ||
    id.includes('better-sqlite3') ||
    id.startsWith('sharp ') ||
    id.startsWith('sqlite-vec ');
  for (const id of ['sharp win32 native', 'sqlite-vec windows extension']) {
    assert.ok(
      selects(id),
      `BUG: "${id}" is not matched by the nativeOk selector — the check would run but never ` +
        'count, so a genuinely missing binary would report healthy.',
    );
  }
  // And the selector itself must still use those prefixes.
  assert.match(line, /startsWith\('sharp '\)/);
  assert.match(line, /startsWith\('sqlite-vec '\)/);
});

// ── 5. A dead key vanished entirely while stealth typing was engaged ─────────
// unicode_for_key treated every non-positive ToUnicodeEx result as "no
// character". For n == 0 that is correct: nothing was written and the buffer
// holds stale data. For n < 0 it is not — that is a DEAD KEY, and where the
// layout allows it the OS has ALREADY written the SPACING form of the accent to
// the buffer (U+00B4 ACUTE ACCENT, not U+0301 COMBINING ACUTE ACCENT).
//
// Returning "" lost the key outright. The only empty-chars escape hatch in the
// hook proc is AltGr-gated:
//
//     if altgr && key_code == 0 && chars.is_empty() { return pass(); }
//
// A plain dead key is not AltGr, so it skipped that guard, reached send_payload
// with chars: "", and fell through to LRESULT(1) — "Swallow: the foreground
// meeting app never sees this keystroke." The key therefore reached NEITHER the
// overlay NOR the foreground app, silently killing every accent key on German
// T1, AZERTY, Spanish, Nordic and US-International layouts.

test('deadkey: n == 0 and n < 0 are separate branches, and the dead key is not swallowed', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  const start = rust.indexOf('fn unicode_for_key(');
  assert.ok(start !== -1, 'unicode_for_key() not found');
  const fn = rust.slice(start, rust.indexOf('fn ', rust.indexOf('String::from_utf16_lossy(&buf[..n])')));

  assert.doesNotMatch(
    fn,
    /if n <= 0 \{/,
    'BUG: the collapsed `n <= 0` branch treats a DEAD KEY as "no character" and returns "". ' +
      'A plain dead key is not AltGr, so it misses the only empty-chars pass() guard and is ' +
      'swallowed — reaching neither the overlay nor the foreground app.',
  );
  assert.match(
    fn,
    /if n == 0 \{/,
    'BUG: n == 0 (no translation, buffer stale and unreadable) must be its own branch.',
  );
  assert.match(
    fn,
    /if n < 0 \{/,
    'BUG: n < 0 (dead key) must be handled separately from n == 0.',
  );
});

test('deadkey: only buf[0] is read, and a layout that writes nothing still yields ""', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  const start = rust.indexOf('if n < 0 {');
  assert.ok(start !== -1, 'the dead-key branch not found');
  const branch = rust.slice(start, rust.indexOf('let n = (n as usize).min(buf.len());'));

  // ToUnicodeEx writes ONLY the spacing accent for a dead key; the rest of the
  // buffer is stale, so the multi-unit `&buf[..n]` read must not be used here.
  assert.match(
    branch,
    /buf\.first\(\)/,
    'BUG: only buf[0] is meaningful for a dead key — reading further is stale data.',
  );
  // "If possible" in the Win32 docs is load-bearing: a layout may write nothing
  // at all, in which case there is genuinely no character to emit.
  assert.match(
    branch,
    /None \| Some\(&0\) => String::new\(\)/,
    'BUG: a layout that writes no dead-key character must still yield "" rather than U+0000.',
  );
  assert.match(
    branch,
    /Some\(&unit\) => String::from_utf16_lossy\(&\[unit\]\)/,
    'BUG: the spacing form of the accent must be emitted so the key reaches the overlay.',
  );
});

test('deadkey: the AltGr pass-through guard stays NARROW (a real Ctrl+Alt chord still reaches the OS)', () => {
  const rust = read('native-module/src/keyboard_hook_windows.rs');
  // A genuine AltGr shortcut produces NO character (n == 0 → ""), so it still
  // hits this guard and passes to the foreground app. Widening this to cover any
  // no-text printable key is a separate change with its own test.
  assert.match(
    rust,
    /if altgr && key_code == 0 && chars\.is_empty\(\) \{\s*\n\s*return pass\(\);/,
    'BUG: the AltGr escape hatch must stay exactly this narrow — it is what lets a real ' +
      'Ctrl+Alt shortcut through while stealth typing is engaged.',
  );
  // wFlags = 0x4 must remain: it stops the kernel accumulating the dead key.
  // Composing properly would corrupt what every OTHER app on the machine sees.
  assert.match(
    rust,
    /ToUnicodeEx\(vk, scan, &key_state, &mut buf, 0x4, hkl\)/,
    'BUG: wFlags must stay 0x4 (do not alter kernel keyboard state) — dropping it makes the ' +
      'hook corrupt dead-key composition system-wide.',
  );
});
