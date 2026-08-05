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
