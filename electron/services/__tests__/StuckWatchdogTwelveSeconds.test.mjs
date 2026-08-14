// Structural regression test for fix B11 in electron/main.ts.
//
// FIX SUMMARY
// -----------
// In BOTH wireSystemCapture (~L1451) and wireMicCapture (~L1612):
//   - Added `const STUCK_WATCHDOG_MS = 12000;` near the top of each body.
//   - Changed `setTimeout(() => {...}, 8000)` to use STUCK_WATCHDOG_MS.
//   - Updated log strings from literal "8s" to template `${STUCK_WATCHDOG_MS/1000}s`.
//   - Mic-side user-facing message also templated.
//
// REGRESSION GUARDED
// ------------------
// A future contributor reverts to 8000 (or any value < 10000) as the stuck-
// watchdog timeout, re-introducing the SCK cold-start race where SCK takes
// slightly longer than 8s to produce its first frame and the watchdog fires
// a false-positive "stuck" event.
//
// This is a STRUCTURAL test — it reads electron/main.ts as a string and uses
// balanced-brace body extraction to scope assertions to the two target
// function bodies. We intentionally do not import or execute main.ts.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAIN_TS_PATH = path.resolve(__dirname, '..', '..', 'main.ts');

const source = fs.readFileSync(MAIN_TS_PATH, 'utf8');

/**
 * Extract the body of a method whose signature starts with `<name>(...): void {`.
 * Uses balanced-brace scanning so we capture exactly the method body and do not
 * over-shoot into the next method.
 *
 * Returns the substring BETWEEN the opening `{` and the matching closing `}`
 * (exclusive of both braces). Returns null if the signature is not found.
 */
function extractMethodBody(src, methodName) {
  // Look for `private <name>(...): ...{` — the wire* helpers are private methods.
  // We use a generous signature pattern that matches the actual declarations.
  const sigPattern = new RegExp(
    `private\\s+${methodName}\\s*\\([^)]*\\)\\s*:\\s*void\\s*\\{`,
    'm'
  );
  const sigMatch = sigPattern.exec(src);
  if (!sigMatch) return null;

  // Position immediately after the opening `{`.
  const bodyStart = sigMatch.index + sigMatch[0].length;
  let depth = 1;
  let i = bodyStart;
  // Naive brace counter; ignores braces inside strings / regex / comments. The
  // wire* bodies use enough template literals that we need to handle at least
  // strings and line comments to avoid mis-counting.
  while (i < src.length && depth > 0) {
    const ch = src[i];
    const next = src[i + 1];

    // Line comment — skip to end of line.
    if (ch === '/' && next === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    // Block comment.
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    // Single-quoted string.
    if (ch === "'") {
      i++;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\') i += 2; else i++;
      }
      i++;
      continue;
    }
    // Double-quoted string.
    if (ch === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i += 2; else i++;
      }
      i++;
      continue;
    }
    // Template literal — may contain ${ ... } expressions with balanced braces.
    if (ch === '`') {
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          // Skip past the matching close-brace of the ${...} interpolation.
          i += 2;
          let tdepth = 1;
          while (i < src.length && tdepth > 0) {
            if (src[i] === '{') tdepth++;
            else if (src[i] === '}') tdepth--;
            if (tdepth > 0) i++;
          }
          i++; // skip the closing }
          continue;
        }
        i++;
      }
      i++;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }

  if (depth !== 0) return null;
  // i is one past the closing brace; body is [bodyStart, i-1).
  return src.slice(bodyStart, i - 1);
}

const systemBody = extractMethodBody(source, 'wireSystemCapture');
const micBody = extractMethodBody(source, 'wireMicCapture');

describe('B11 stuck-watchdog 12000ms regression — electron/main.ts', () => {
  test('extractMethodBody finds both wire* bodies', () => {
    assert.ok(systemBody, 'wireSystemCapture body was not extracted');
    assert.ok(micBody, 'wireMicCapture body was not extracted');
    // Sanity: each body should be substantial (hundreds of chars), not a stub.
    assert.ok(systemBody.length > 200, 'wireSystemCapture body suspiciously short');
    assert.ok(micBody.length > 200, 'wireMicCapture body suspiciously short');
  });

  // 1. wireSystemCapture declares the const.
  test('wireSystemCapture declares `const STUCK_WATCHDOG_MS = 12000`', () => {
    assert.match(
      systemBody,
      /const\s+STUCK_WATCHDOG_MS\s*=\s*12000\s*;?/,
      'wireSystemCapture must declare `const STUCK_WATCHDOG_MS = 12000` ' +
      '— fix B11 requires the named constant, not a bare 8000 literal.'
    );
  });

  // 2. wireSystemCapture uses the constant in setTimeout.
  test('wireSystemCapture calls setTimeout(..., STUCK_WATCHDOG_MS)', () => {
    assert.match(
      systemBody,
      /setTimeout\s*\([\s\S]*?,\s*STUCK_WATCHDOG_MS\s*\)/,
      'wireSystemCapture must use STUCK_WATCHDOG_MS (not a numeric literal) ' +
      'as the setTimeout delay so the value cannot drift out of sync with the log message.'
    );
  });

  // 3. wireMicCapture declares the same const.
  test('wireMicCapture declares `const STUCK_WATCHDOG_MS = 12000`', () => {
    assert.match(
      micBody,
      /const\s+STUCK_WATCHDOG_MS\s*=\s*12000\s*;?/,
      'wireMicCapture must declare `const STUCK_WATCHDOG_MS = 12000` — ' +
      'mic and system watchdogs must stay symmetric.'
    );
  });

  // 4. wireMicCapture uses the constant in setTimeout.
  test('wireMicCapture calls setTimeout(..., STUCK_WATCHDOG_MS)', () => {
    assert.match(
      micBody,
      /setTimeout\s*\([\s\S]*?,\s*STUCK_WATCHDOG_MS\s*\)/,
      'wireMicCapture must use STUCK_WATCHDOG_MS as the setTimeout delay.'
    );
  });

  // 5. Neither body uses the literal 8000 as a setTimeout argument
  //    (catches a partial revert where the const exists but a hardcoded 8000
  //    sneaks back into the actual setTimeout call).
  test('neither wire* body uses `setTimeout(..., 8000)` literal', () => {
    const systemHas8000 = /setTimeout\s*\([\s\S]*?,\s*8000\s*\)/.test(systemBody);
    const micHas8000 = /setTimeout\s*\([\s\S]*?,\s*8000\s*\)/.test(micBody);
    assert.equal(
      systemHas8000,
      false,
      'wireSystemCapture must not contain `setTimeout(..., 8000)` — ' +
      'this would re-introduce the SCK cold-start race fix B11 closed.'
    );
    assert.equal(
      micHas8000,
      false,
      'wireMicCapture must not contain `setTimeout(..., 8000)` — partial revert detected.'
    );
  });

  // 6. Negative regression check — globally scoped to the wire* bodies.
  //    The literal 8000 may legitimately appear elsewhere in main.ts (e.g.
  //    unrelated timers, sample-rate math), so we MUST scope the assertion
  //    tightly to the two function bodies extracted above.
  test('no `setTimeout(..., 8000)` anywhere inside the wire* function bodies', () => {
    const combined = `${systemBody}\n/* --- boundary --- */\n${micBody}`;
    const matches = combined.match(/setTimeout\s*\([\s\S]*?,\s*8000\s*\)/g) || [];
    assert.equal(
      matches.length,
      0,
      `Found ${matches.length} setTimeout(..., 8000) call(s) inside wire* bodies. ` +
      'Fix B11 raised this timeout to 12000ms to avoid false-positive stuck ' +
      'events during SCK cold-start. Use STUCK_WATCHDOG_MS instead.'
    );
  });

  // 7. Constant value is >= 10000ms — guards against a contributor lowering
  //    it to, say, 9000 in a half-fix that still uses the named constant.
  test('STUCK_WATCHDOG_MS value is >= 10000 in both bodies', () => {
    const constRe = /STUCK_WATCHDOG_MS\s*=\s*(\d+)/g;

    const checkBody = (body, name) => {
      const found = [...body.matchAll(constRe)];
      assert.ok(
        found.length >= 1,
        `${name} must declare STUCK_WATCHDOG_MS at least once.`
      );
      for (const m of found) {
        const value = Number(m[1]);
        assert.ok(
          value >= 10000,
          `${name}: STUCK_WATCHDOG_MS = ${value} is too low. ` +
          'Fix B11 requires >= 10000ms to absorb SCK cold-start latency. ' +
          'Anything less re-opens the false-positive stuck-event race.'
        );
      }
    };

    checkBody(systemBody, 'wireSystemCapture');
    checkBody(micBody, 'wireMicCapture');
  });
});
