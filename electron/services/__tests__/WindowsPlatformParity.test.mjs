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

test('preflight: Windows has its own sharp / sqlite-vec checks, arch-agnostic', () => {
  const src = read('electron/services/LocalFallbackPreflight.ts');
  const block = src.slice(
    src.indexOf("} else if (process.platform === 'win32') {"),
    src.indexOf('// 4. Ollama optional path.'),
  );
  assert.ok(block.length > 0, 'win32 native-asset branch not found');
  assert.match(
    block,
    /checkUnpackedNativePrefix\('node_modules\/@img', 'sharp-win32-'/,
    'BUG: Windows must verify a sharp win32 binary was packaged.',
  );
  assert.match(
    block,
    /checkUnpackedNativePrefix\('node_modules', 'sqlite-vec-windows-'/,
    'BUG: Windows must verify the sqlite-vec Windows extension was packaged.',
  );
  // Arch must NOT be hardcoded: Windows ships x64 AND ia32 installers, so
  // pinning one arch would fail the other with the same false "reinstall" alarm.
  assert.doesNotMatch(
    block,
    /sharp-win32-x64|sharp-win32-ia32|sqlite-vec-windows-x64/,
    'BUG: do not hardcode a Windows arch — prefix-match so x64/ia32/arm64 all pass.',
  );
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
  assert.match(
    src,
    /app\.dock\.show\(\);\s*\n\s*this\.showTray\(\);/,
    'BUG: macOS regression — the dock/tray restore in _enforceDockState disappeared.',
  );
  assert.match(
    src,
    /app\.dock\.hide\(\);\s*\n\s*this\.hideTray\(\);/,
    'BUG: macOS regression — the dock/tray hide in _enforceDockState disappeared.',
  );
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
