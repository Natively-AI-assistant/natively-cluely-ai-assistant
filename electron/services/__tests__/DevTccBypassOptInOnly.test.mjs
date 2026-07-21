// Regression test for B5 fix (2026-05-28): the dev-mode TCC bypass for
// macOS screen capture used to be unconditional. Both
// getMacScreenCaptureStatus and resolveMacScreenCaptureCapability would
// short-circuit on `!app.isPackaged` and report screen capture as
// `'granted'` / `capturable: true`. The side effect was diagnostic
// blindness — devs could never reproduce production-only TCC bugs
// because dev builds always claimed permission was granted.
//
// Fix: introduce an `isDevTccBypassEnabled()` helper that requires BOTH
// `!app.isPackaged` AND `process.env.NATIVELY_DEV_BYPASS_SCREEN_TCC === '1'`.
// Both gates now call this helper instead of bare `!app.isPackaged`.
// Default in dev is now to run the full production capability path so
// devs see real TCC status.
//
// Regression we guard against: a future contributor reverts to the
// unconditional bypass ("dev mode should always be granted") — likely
// motivated by the friction of having to set the env var for daily
// development. This test fails fast on any such revert, including
// partial reverts where one of the two call sites is restored.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainPath = path.join(root, 'electron/main.ts');
const main = fs.readFileSync(mainPath, 'utf8');

/**
 * Extract the balanced-brace body of the first function declaration whose
 * signature matches `signatureRe`. Returns the substring between the
 * opening `{` and the matching closing `}` (exclusive of both).
 */
function extractFunctionBody(source, signatureRe) {
  const m = signatureRe.exec(source);
  if (!m) return null;
  // Find the first `{` at or after the match end.
  let i = m.index + m[0].length;
  while (i < source.length && source[i] !== '{') i++;
  if (i >= source.length) return null;
  const start = i + 1;
  let depth = 1;
  i++;
  // Walk forward, tracking string/comment context so braces inside literals
  // don't break the depth count.
  let inLine = false, inBlock = false, inStr = null, esc = false;
  for (; i < source.length; i++) {
    const c = source[i];
    if (inLine) {
      if (c === '\n') inLine = false;
      continue;
    }
    if (inBlock) {
      if (c === '*' && source[i + 1] === '/') { inBlock = false; i++; }
      continue;
    }
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') { inLine = true; i++; continue; }
    if (c === '/' && source[i + 1] === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null;
}

describe("B5: dev-mode TCC bypass is opt-in (NATIVELY_DEV_BYPASS_SCREEN_TCC=1) only", () => {
  it("isDevTccBypassEnabled() helper exists and checks BOTH !app.isPackaged AND the env flag", () => {
    const body = extractFunctionBody(
      main,
      /function\s+isDevTccBypassEnabled\s*\(\s*\)\s*:\s*boolean/,
    );
    assert.ok(
      body !== null,
      "BUG: isDevTccBypassEnabled() helper is missing from electron/main.ts. " +
        "B5 fix requires this helper to centralize the opt-in dev-bypass policy.",
    );
    assert.ok(
      /!\s*app\.isPackaged/.test(body),
      "BUG: isDevTccBypassEnabled() no longer checks !app.isPackaged. " +
        "The bypass MUST remain dev-only — packaged builds must never short-circuit TCC.",
    );
    assert.ok(
      /process\.env\.NATIVELY_DEV_BYPASS_SCREEN_TCC/.test(body),
      "BUG: isDevTccBypassEnabled() no longer checks process.env.NATIVELY_DEV_BYPASS_SCREEN_TCC. " +
        "Without the env-flag gate the bypass becomes unconditional in dev and re-introduces " +
        "the diagnostic blindness B5 was meant to remove.",
    );
    // Confirm the conjunction (both conditions joined by &&), not a disjunction
    // that would let either alone trigger the bypass.
    assert.ok(
      /!\s*app\.isPackaged[\s\S]*&&[\s\S]*NATIVELY_DEV_BYPASS_SCREEN_TCC/.test(body) ||
        /NATIVELY_DEV_BYPASS_SCREEN_TCC[\s\S]*&&[\s\S]*!\s*app\.isPackaged/.test(body),
      "BUG: isDevTccBypassEnabled() must combine !app.isPackaged AND the env-flag check " +
        "with && (logical AND). A || here would re-create the unconditional dev bypass.",
    );
  });

  it("getMacScreenCaptureStatus calls isDevTccBypassEnabled() and has no bare !app.isPackaged early-return", () => {
    const body = extractFunctionBody(
      main,
      /function\s+getMacScreenCaptureStatus\s*\(\s*\)\s*:\s*MacScreenCaptureStatus/,
    );
    assert.ok(body !== null, "could not locate getMacScreenCaptureStatus body in main.ts");

    assert.ok(
      /isDevTccBypassEnabled\s*\(/.test(body),
      "BUG: getMacScreenCaptureStatus no longer calls isDevTccBypassEnabled(). " +
        "B5 fix routes the dev bypass through the helper so the env-flag gate cannot be skipped.",
    );

    // Negative: no `if (!app.isPackaged) return 'granted'` (or analogous bare
    // early-return) that bypasses TCC without the env-flag check.
    assert.ok(
      !/if\s*\(\s*!\s*app\.isPackaged\s*\)\s*return\s+['"]granted['"]/.test(body),
      "BUG: getMacScreenCaptureStatus contains a bare `if (!app.isPackaged) return 'granted'` " +
        "early-return. This is the pre-fix unconditional dev bypass that B5 explicitly removed " +
        "to restore diagnostic visibility of real TCC denials in dev.",
    );
  });

  it("resolveMacScreenCaptureCapability calls isDevTccBypassEnabled() and has no bare !app.isPackaged early-return", () => {
    const body = extractFunctionBody(
      main,
      /(?:async\s+)?function\s+resolveMacScreenCaptureCapability\s*\(/,
    );
    assert.ok(body !== null, "could not locate resolveMacScreenCaptureCapability body in main.ts");

    assert.ok(
      /isDevTccBypassEnabled\s*\(/.test(body),
      "BUG: resolveMacScreenCaptureCapability no longer calls isDevTccBypassEnabled(). " +
        "Both screen-capture gates (status + capability) must share the same opt-in policy — " +
        "if only one is fixed the other still lies about TCC in dev.",
    );

    // Negative: no `!isMac || !app.isPackaged` pattern (the pre-fix form) and
    // no isolated `!app.isPackaged` short-circuit returning capturable:true.
    assert.ok(
      !/!\s*isMac\s*\|\|\s*!\s*app\.isPackaged/.test(body),
      "BUG: resolveMacScreenCaptureCapability contains the pre-fix pattern " +
        "`!isMac || !app.isPackaged`. This is the unconditional dev bypass that B5 removed. " +
        "The dev branch of the OR must be gated through isDevTccBypassEnabled().",
    );
    assert.ok(
      !/if\s*\(\s*!\s*app\.isPackaged\s*\)\s*\{?\s*(?:return|clearSystemAudioPermissionWarning)/.test(body),
      "BUG: resolveMacScreenCaptureCapability contains a bare `if (!app.isPackaged)` " +
        "early-return path. The dev-bypass condition must be expressed via isDevTccBypassEnabled().",
    );
  });

  it("env var NATIVELY_DEV_BYPASS_SCREEN_TCC is documented somewhere in main.ts", () => {
    // The env knob is part of the public dev contract; it must be discoverable
    // by grep so devs who hit denied-screen-recording in dev can find the
    // escape hatch.
    const occurrences = (main.match(/NATIVELY_DEV_BYPASS_SCREEN_TCC/g) || []).length;
    assert.ok(
      occurrences >= 1,
      "BUG: env var NATIVELY_DEV_BYPASS_SCREEN_TCC is no longer referenced in main.ts. " +
        "This is the documented dev knob — removing it (or renaming silently) breaks the " +
        "documented bypass workflow.",
    );
  });

  it("no function in main.ts returns 'granted' solely on !app.isPackaged (global audit)", () => {
    // Catch-all: search the entire file for any `if (!app.isPackaged) return 'granted'`
    // pattern, regardless of which function it lives in. This guards against a
    // future contributor adding a *new* capture-status helper that silently
    // re-introduces the unconditional dev bypass.
    const bareBypass = /if\s*\(\s*!\s*app\.isPackaged\s*\)\s*\{?\s*return\s+['"]granted['"]/g;
    const matches = main.match(bareBypass) || [];
    assert.equal(
      matches.length,
      0,
      `BUG: main.ts contains ${matches.length} bare \`if (!app.isPackaged) return 'granted'\` ` +
        "patterns. Any such early-return must instead go through isDevTccBypassEnabled() so the " +
        "env-flag gate cannot be skipped. Offending lines:\n" +
        matches.map((m) => `  - ${m}`).join("\n"),
    );
  });

  it("documentation block near isDevTccBypassEnabled mentions both 'granted' and the env-var name", () => {
    // The JSDoc/comment that explains *why* the bypass exists is the place
    // future contributors will look before "fixing" the friction. It must
    // mention both the value the bypass returns ('granted') and the env-var
    // name they need to set, so the doc fully describes the contract.
    const idx = main.search(/function\s+isDevTccBypassEnabled\s*\(/);
    assert.ok(idx >= 0, "isDevTccBypassEnabled declaration not found");
    // Inspect the ~1500 chars immediately above the declaration — that's
    // where the documenting comment block lives.
    const docWindow = main.slice(Math.max(0, idx - 1500), idx);
    assert.ok(
      /['"]granted['"]/.test(docWindow),
      "BUG: the doc block above isDevTccBypassEnabled no longer mentions 'granted'. " +
        "The doc must describe what the bypass actually does (force-reports screen capture " +
        "as 'granted') so reviewers understand the diagnostic-blindness risk.",
    );
    assert.ok(
      /NATIVELY_DEV_BYPASS_SCREEN_TCC/.test(docWindow),
      "BUG: the doc block above isDevTccBypassEnabled no longer mentions the env-var name " +
        "NATIVELY_DEV_BYPASS_SCREEN_TCC. Devs reading the helper must be told exactly which " +
        "env var opts them in.",
    );
  });
});
