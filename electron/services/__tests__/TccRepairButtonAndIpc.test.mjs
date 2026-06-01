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

test('NativelyInterface.tsx renders a Repair Permissions button gated by isMac', () => {
  assert.match(
    interfaceTsx,
    /Repair Permissions/,
    "expected literal 'Repair Permissions' button label in NativelyInterface.tsx",
  );
  // Locate the *button label* literal (quoted string-literal rendered into
  // JSX), not earlier occurrences in code comments. Earlier matches may
  // exist in comments documenting the button (e.g. "Repair Permissions"
  // in JSDoc). Use the LAST occurrence — the actual rendered label sits
  // deep in the JSX tree, far below any comment.
  const allMatches = [...interfaceTsx.matchAll(/Repair Permissions/g)];
  assert.ok(allMatches.length > 0, "expected a 'Repair Permissions' literal");
  const labelIdx = allMatches[allMatches.length - 1].index;
  // Walk back a generously sized window — the surrounding JSX block is
  // verbose (handler, className, title attrs all inline). 5000 chars is
  // enough to capture the enclosing {isMac && ( ... )} guard while still
  // failing if a contributor moves the button out of the macOS branch.
  const before = interfaceTsx.slice(Math.max(0, labelIdx - 5000), labelIdx);
  assert.match(
    before,
    /\{\s*isMac\s*&&/,
    "Repair Permissions button must be wrapped in an isMac guard",
  );
});

test('renderer button calls window.electronAPI?.repairTccPermissions', () => {
  // Allow optional chaining variants on either side.
  assert.match(
    interfaceTsx,
    /window\.electronAPI\??\.\s*repairTccPermissions/,
    "expected window.electronAPI?.repairTccPermissions(...) call in renderer",
  );
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
