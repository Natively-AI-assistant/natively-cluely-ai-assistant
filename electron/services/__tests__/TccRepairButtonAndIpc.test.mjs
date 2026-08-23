// Structural regression test for fix UX2 (in-app TCC repair button).
//
// The critical regression we're guarding against: a future contributor
// lowercases the tccutil service names ('microphone'/'screencapture'),
// which silently fails with "Invalid Service Name" and the button does
// nothing. tccutil REQUIRES capital 'Microphone' and 'ScreenCapture'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..', '..');

const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');

const ipcHandlers = read('electron/ipcHandlers.ts');
const preload = read('electron/preload.ts');
const electronDts = read('src/types/electron.d.ts');
const interfaceTsx = read('src/components/NativelyInterface.tsx');

// Extract the handler body for handler-scoped assertions.
function extractHandlerBody(source) {
  const startIdx = source.indexOf("safeHandle('repair-tcc-permissions'");
  assert.ok(startIdx !== -1, "could not locate safeHandle('repair-tcc-permissions') in ipcHandlers.ts");
  // Walk forward to find matching closing of the safeHandle(...) call.
  // A simple, robust enough approach: grab the next ~5000 chars after the
  // opening — handler is well under that.
  return source.slice(startIdx, startIdx + 5000);
}

const handlerBody = extractHandlerBody(ipcHandlers);

test("ipcHandlers.ts registers safeHandle('repair-tcc-permissions', ...)", () => {
  assert.match(
    ipcHandlers,
    /safeHandle\(\s*['"]repair-tcc-permissions['"]\s*,/,
    "expected safeHandle('repair-tcc-permissions', ...) registration",
  );
});

test('repair-tcc-permissions handler uses execFile, NOT shell exec', () => {
  assert.match(
    handlerBody,
    /execFile/,
    'handler must use execFile from node:child_process',
  );
  // Reject shell-y `exec(` usage inside the handler. Allow `execFile`/`execFileAsync`.
  // Look for require('child_process').exec( or `, exec }` import patterns.
  const badExec = /require\(\s*['"](?:node:)?child_process['"]\s*\)\s*\.\s*exec\s*\(/;
  assert.doesNotMatch(
    handlerBody,
    badExec,
    'handler must not invoke child_process.exec() (shell exec is unsafe)',
  );
  // Also reject destructured `{ exec }` (not execFile) inside handler body.
  const destructuredExec = /\{\s*exec\s*[,}]/;
  assert.doesNotMatch(
    handlerBody,
    destructuredExec,
    'handler must not destructure { exec } from child_process',
  );
});

test("handler invokes tccutil with exact capitalized 'Microphone' service name", () => {
  // Must appear with capital M inside the handler body.
  assert.match(
    handlerBody,
    /['"]Microphone['"]/,
    "expected exact 'Microphone' (capital M) argv in handler",
  );
});

test("handler invokes tccutil with exact capitalized 'ScreenCapture' service name", () => {
  assert.match(
    handlerBody,
    /['"]ScreenCapture['"]/,
    "expected exact 'ScreenCapture' (capital S+C) argv in handler",
  );
});

test('handler is gated on process.platform === \'darwin\' with early-return', () => {
  assert.match(
    handlerBody,
    /process\.platform\s*!==\s*['"]darwin['"]/,
    'handler must early-return when process.platform !== "darwin"',
  );
});

test('handler passes a timeout option to execFile to prevent indefinite hang', () => {
  assert.match(
    handlerBody,
    /timeout\s*:\s*\d{3,}/,
    'expected a numeric timeout option (>= 3 digits ms) on execFile call',
  );
});

test("preload.ts exposes repairTccPermissions bridging 'repair-tcc-permissions'", () => {
  assert.match(
    preload,
    /repairTccPermissions\s*:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]repair-tcc-permissions['"]\s*\)/,
    "expected preload bridge: repairTccPermissions: () => ipcRenderer.invoke('repair-tcc-permissions')",
  );
});

test('electron.d.ts declares repairTccPermissions with ok:boolean and message:string', () => {
  // Locate the declaration block for repairTccPermissions.
  const idx = electronDts.indexOf('repairTccPermissions');
  assert.ok(idx !== -1, 'expected repairTccPermissions in src/types/electron.d.ts');
  const decl = electronDts.slice(idx, idx + 600);
  assert.match(decl, /ok\s*:\s*boolean/, "expected 'ok: boolean' in repairTccPermissions return type");
  assert.match(decl, /message\s*:\s*string/, "expected 'message: string' in repairTccPermissions return type");
});

// THE BUTTON IS GONE ON PURPOSE, AND THAT IS WHAT THESE NOW ASSERT.
//
// Two tests here used to require a "Repair Permissions" button in the
// audio-warning banner, gated by isMac and calling repairTccPermissions.
// b4ea6040 ("single-action warning banner") deliberately removed it: three
// same-weight buttons crowded the strip, and a tccutil reset is a last-resort
// recovery rather than the step a user takes next. That commit landed AFTER
// this file was written and did not update it, so the suite has failed on main
// ever since — which is worse than either outcome, because a permanently red
// guard stops being read.
//
// Restoring the button to satisfy the old assertions would revert a considered
// UX decision. So the contract is re-pinned to what the code now promises: the
// IPC survives, deliberately, for a future entry point. Everything below the
// renderer boundary (handler, preload bridge, isMac guard in main, the
// ok/message return shape) is still asserted by the tests above — that is the
// part a refactor could silently break.

test('the repair-tcc IPC stays wired even with no UI entry point', () => {
  // The banner button was removed but the capability was kept on purpose. If
  // someone garbage-collects the "unused" IPC, the next UI that wants it comes
  // back to a missing bridge — so pin the surface, not the button.
  assert.match(
    preload,
    /repairTccPermissions\s*:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]repair-tcc-permissions['"]/,
    'preload no longer bridges repairTccPermissions',
  );
  assert.match(
    ipcHandlers,
    /safeHandle\(\s*['"]repair-tcc-permissions['"]/,
    'main no longer handles repair-tcc-permissions',
  );
});

test('no renderer calls repairTccPermissions without an isMac guard', () => {
  // tccutil is macOS-only. There is no call site today; if one is added back,
  // it must sit inside an isMac branch or this fails. Written as a guard on
  // FUTURE code rather than a requirement that the button exist.
  const calls = [...interfaceTsx.matchAll(/window\.electronAPI\??\.\s*repairTccPermissions/g)];
  for (const call of calls) {
    const before = interfaceTsx.slice(Math.max(0, call.index - 5000), call.index);
    assert.match(
      before,
      /\{\s*isMac\s*&&/,
      'a repairTccPermissions call site is not wrapped in an isMac guard',
    );
  }
});

test('NEGATIVE: ipcHandlers.ts has no lowercase tccutil service names near tccutil', () => {
  // Find every occurrence of 'tccutil' and scan ±500 chars for lowercase
  // 'microphone' or 'screencapture' as string literals — the silent-failure
  // regression.
  const tccutilRegex = /tccutil/gi;
  const offenders = [];
  let match;
  while ((match = tccutilRegex.exec(ipcHandlers)) !== null) {
    const start = Math.max(0, match.index - 500);
    const end = Math.min(ipcHandlers.length, match.index + 500);
    const window = ipcHandlers.slice(start, end);
    // Lowercase, quoted variants only. We don't want to false-match prose
    // like "Microphone" appearing differently, so check quoted literals.
    if (/['"]microphone['"]/.test(window)) {
      offenders.push({ pos: match.index, kind: 'microphone' });
    }
    if (/['"]screencapture['"]/.test(window)) {
      offenders.push({ pos: match.index, kind: 'screencapture' });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Lowercase tccutil service names found near 'tccutil' — these silently fail with "Invalid Service Name". Offenders: ${JSON.stringify(offenders)}`,
  );
});
