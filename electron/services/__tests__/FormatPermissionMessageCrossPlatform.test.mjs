// Static regression test for the formatPermissionMessage helper in
// electron/main.ts. Two invariants are enforced:
//
//   1. Every PermissionReason whose name begins with `mac-` (the convention
//      for variants whose copy is macOS-specific) MUST be invoked only from
//      a call site that is gated by `process.platform === 'darwin'` (or
//      equivalently checks `isMac`). This protects the cross-platform
//      broadcast paths from leaking macOS-only copy to Windows users —
//      the bug class behind issue #252.
//
//   2. Every `mac-` variant inside the helper must contain a defensive
//      `if (!isMac) return formatPermissionMessage(...)` fallback so the
//      helper is safe end-to-end even if a future contributor wires up
//      a new cross-platform call site without remembering to gate it.
//
// This is a structural test — it reads main.ts as source and asserts
// invariants on the text. It deliberately does not import main.ts (which
// has heavy side effects at module load).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const main = read('electron/main.ts');

function extractMacVariants() {
  // The PermissionReason union sits between `type PermissionReason =` and the
  // closing semicolon. Pull every `'mac-...'` literal from inside it.
  const unionMatch = main.match(/type PermissionReason =[\s\S]*?;/);
  assert.ok(unionMatch, 'PermissionReason union should be declared in main.ts');
  return Array.from(unionMatch[0].matchAll(/'(mac-[a-z0-9-]+)'/g)).map(
    (m) => m[1]
  );
}

test('every `mac-` PermissionReason has a defensive isMac fallback inside the helper', () => {
  const variants = extractMacVariants();
  assert.ok(variants.length > 0, 'expected at least one mac-prefixed variant');

  for (const variant of variants) {
    // Find the case body for this variant.
    const caseRegex = new RegExp(
      `case '${variant}':([\\s\\S]*?)(?=case '|\\n {4}}\\n)`,
      'm'
    );
    const body = main.match(caseRegex);
    assert.ok(body, `case '${variant}': should be defined`);
    assert.match(
      body[1],
      /if \(!isMac\) return formatPermissionMessage\(/,
      `case '${variant}' must guard with !isMac and fall back to a cross-platform variant — otherwise a non-darwin call site leaks macOS copy`
    );
  }
});

test('every call site that passes a `mac-` PermissionReason is gated on darwin', () => {
  const variants = extractMacVariants();
  for (const variant of variants) {
    const callRegex = new RegExp(
      `formatPermissionMessage\\(['\"]${variant}['\"]`,
      'g'
    );
    let m;
    while ((m = callRegex.exec(main)) !== null) {
      // Look at the 2000 chars *before* this call site; require a
      // darwin / isMac gate somewhere in that window. This is heuristic but
      // catches all current call sites and the obvious regressions.
      // 2000 chars ≈ 50 lines of context — wide enough to span function
      // bodies with intervening logic (e.g. the TCC zero-fill detector
      // gates 19 lines above its broadcast site).
      const window = main.slice(Math.max(0, m.index - 2000), m.index);
      const isGated =
        /process\.platform\s*===\s*['"]darwin['"]/.test(window) ||
        /isMac\b/.test(window);
      assert.ok(
        isGated,
        `call to formatPermissionMessage('${variant}') at offset ${m.index} is not preceded by a darwin/isMac gate within 800 chars — Windows users will see macOS copy`
      );
    }
  }
});

test('no renderer file outside src/utils references x-apple.systempreferences without a darwin/isMac gate', () => {
  // Defense-in-depth: the IPC allowlist already gates this scheme, but the
  // renderer should never *construct* such a URL on Windows either. This
  // test scans all .tsx files under src/ and flags any line containing
  // `x-apple.systempreferences` whose surrounding 1500-char window does not
  // contain an isMac / platform === 'darwin' check.
  function walk(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full, acc);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))
      ) {
        acc.push(full);
      }
    }
    return acc;
  }

  const files = walk(path.join(root, 'src'));
  const offenders = [];

  // Strip block comments and line comments so we only inspect executable
  // references. Comments that mention `x-apple.systempreferences` for
  // historical context (e.g. the issue #252 changelog note) are fine.
  function stripComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  for (const file of files) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    let from = 0;
    while (true) {
      const idx = text.indexOf('x-apple.systempreferences', from);
      if (idx < 0) break;
      const window = text.slice(Math.max(0, idx - 1500), idx + 200);
      const isGated =
        /isMac\b/.test(window) ||
        /process\.platform\s*===\s*['"]darwin['"]/.test(window) ||
        /platform\s*===\s*['"]darwin['"]/.test(window) ||
        // Early-return guards are also acceptable.
        /process\.platform\s*!==\s*['"]darwin['"]/.test(window) ||
        /platform\s*!==\s*['"]darwin['"]/.test(window);
      if (!isGated) offenders.push(`${path.relative(root, file)} @ ${idx}`);
      from = idx + 'x-apple.systempreferences'.length;
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `These renderer files reference x-apple.systempreferences without a darwin/isMac gate within 1500 chars:\n${offenders.join('\n')}`
  );
});
