// Regression test for B6 fix (2026-05-28): setupSystemAudioPipeline used to
// gate the `resolveMacScreenCaptureCapability` call inside the
// `if (!this.systemAudioCapture)` branch. That meant a 2nd meeting started
// after a between-meeting TCC revoke (Screen Recording permission removed
// from System Settings while a stale SystemAudioCapture wrapper survived
// from the prior meeting — e.g. mid-stream reconfigureAudio failure, or
// any path where teardown is deferred) would skip the permission re-check
// entirely. The stale wrapper kept feeding the STT pipeline zero-filled
// audio against a now-denied permission, the user saw "Listening for
// audio…" forever, and NO banner ever surfaced. This is the precise
// "permissions granted then revoked → no transcription, no UI signal"
// failure mode the audit flagged.
//
// Fix: hoist resolveMacScreenCaptureCapability OUT of the
// !this.systemAudioCapture guard so it runs UNCONDITIONALLY at every
// pipeline setup. The permission-denied branch now also tears down any
// stale capture (await destroy() inside try/catch, null the wrapper,
// reset _sysSttRateApplied) so the next meeting doesn't reuse it. The
// construction path (`new SystemAudioCapture()`) remains gated on
// !this.systemAudioCapture in the else-if branch — that part of the
// original gating was correct and was preserved.
//
// Regression we guard against: a future contributor "tidies up" by
// re-wrapping resolveMacScreenCaptureCapability back inside the
// `if (!this.systemAudioCapture)` block (tempting cleanup: "why
// re-check permission when we already have a capture?"). That
// silently restores the original bug.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainPath = path.join(root, 'electron/main.ts');
const source = fs.readFileSync(mainPath, 'utf8');

// Balanced-brace extractor for the function body. Mirrors the helper used
// by SetupSystemAudioPipelineConstructionGuards.test.mjs (B3): walks
// forward from the opening `{`, honoring //, /* */, and string literals.
function extractFunctionBody(src, signaturePattern) {
  const sigRe = new RegExp(signaturePattern);
  const m = sigRe.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  if (src[i - 1] !== '{') {
    while (i < src.length && src[i] !== '{') i++;
    if (i >= src.length) return null;
    i++;
  }
  const bodyStart = i;
  let depth = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = null;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i);
    }
    i++;
  }
  return null;
}

// Extract the body of a `{ ... }` block whose opening `{` is at or after
// `startOffset`. Returns substring between (exclusive of) the outer
// braces, or null on parse failure.
function extractBracedBlock(src, startOffset) {
  let i = startOffset;
  while (i < src.length && src[i] !== '{') i++;
  if (i >= src.length) return null;
  i++;
  const bodyStart = i;
  let depth = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = null;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i);
    }
    i++;
  }
  return null;
}

const fnBody = extractFunctionBody(
  source,
  String.raw`private\s+async\s+setupSystemAudioPipeline\s*\(\s*\)\s*:\s*Promise<void>\s*\{`,
);

// Locate the `if (screenCapability.effectiveDenied) { ... }` block and
// return its inner body. This is the "permission-denied branch" the fix
// expanded to also tear down stale captures.
function extractPermissionDeniedBranch(body) {
  const re = /if\s*\(\s*screenCapability\.effectiveDenied\s*\)\s*\{/;
  const m = re.exec(body);
  if (!m) return null;
  return extractBracedBlock(body, m.index);
}

// Compute line number (1-indexed) of a substring offset within `body`.
function lineOf(body, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < body.length; i++) {
    if (body[i] === '\n') line++;
  }
  return line;
}

describe('B6: setupSystemAudioPipeline permission check is always run', () => {
  it('1. setupSystemAudioPipeline function body extracts cleanly', () => {
    assert.ok(
      fnBody !== null && fnBody.length > 0,
      'BUG: could not extract setupSystemAudioPipeline body. ' +
        'Signature shape changed, or function malformed. Update the test if the rename was intentional — ' +
        'the B6 permission-always-checked contract still applies.',
    );
  });

  it('2. resolveMacScreenCaptureCapability is NOT inside an `if (!this.systemAudioCapture)` block', () => {
    // CORE B6 ASSERTION. We locate the line containing the
    // resolveMacScreenCaptureCapability call and check that the nearest
    // preceding `if (!this.systemAudioCapture` line is NOT close enough
    // to plausibly contain the call.
    const callRe = /resolveMacScreenCaptureCapability\s*\(/;
    const callMatch = callRe.exec(fnBody);
    assert.ok(
      callMatch !== null,
      'BUG: resolveMacScreenCaptureCapability call not found inside setupSystemAudioPipeline. ' +
        'The B6 fix REQUIRES this call to run unconditionally at pipeline setup so a between-meeting ' +
        'TCC revoke is detected on the 2nd meeting. If you removed the call, you reintroduced the ' +
        'silent zero-fill bug — restore it.',
    );
    const callLine = lineOf(fnBody, callMatch.index);

    // Find ALL `if (!this.systemAudioCapture` occurrences before the call.
    const guardRe = /if\s*\(\s*!\s*this\.systemAudioCapture\b/g;
    let lastGuardLine = -Infinity;
    let lastGuardOffset = -1;
    let gm;
    while ((gm = guardRe.exec(fnBody)) !== null) {
      if (gm.index >= callMatch.index) break;
      lastGuardOffset = gm.index;
      lastGuardLine = lineOf(fnBody, gm.index);
    }

    if (lastGuardOffset === -1) {
      // No preceding guard at all — the call is unconditionally reached.
      return;
    }

    // If a guard exists within ~5 lines before the call, the call is
    // almost certainly gated by it. That is the regression.
    const distance = callLine - lastGuardLine;
    assert.ok(
      distance > 5,
      'BUG (B6 REGRESSION): resolveMacScreenCaptureCapability appears to be gated by ' +
        `an \`if (!this.systemAudioCapture)\` block at line ${lastGuardLine} (call is at line ${callLine}, ` +
        `distance ${distance} lines). Gating the permission re-check on the absence of a wrapper ` +
        'silently restores the original bug: a stale wrapper that survived from the prior meeting ' +
        '(e.g. teardown was deferred, or reconfigureAudio mid-stream failure) prevents the permission ' +
        'check from running, and a between-meeting TCC revoke causes the 2nd meeting to zero-fill ' +
        'forever with no banner. resolveMacScreenCaptureCapability MUST run unconditionally at every ' +
        'pipeline setup — move it OUT of the `if (!this.systemAudioCapture)` block.',
    );
  });

  it('3. Permission-denied branch sends sendSystemAudioPermissionDenied AND calls destroy() on stale capture', () => {
    const deniedBranch = extractPermissionDeniedBranch(fnBody);
    assert.ok(
      deniedBranch !== null,
      'BUG: could not locate `if (screenCapability.effectiveDenied) { ... }` block. ' +
        'The B6 fix introduced this branch — without it, permission denial is silently ignored.',
    );
    assert.ok(
      /sendSystemAudioPermissionDenied\s*\(/.test(deniedBranch),
      'BUG: permission-denied branch no longer calls sendSystemAudioPermissionDenied. ' +
        'Without this IPC, the user sees no banner explaining why audio capture stopped working.',
    );
    assert.ok(
      /\.destroy\s*\(\s*\)/.test(deniedBranch),
      'BUG (B6 REGRESSION): permission-denied branch no longer tears down stale system audio capture ' +
        'via .destroy(). The whole point of B6 is that a stale wrapper from a prior meeting must NOT ' +
        'continue feeding the STT pipeline zero-filled audio after permission is revoked. ' +
        'Restore the `await this.systemAudioCapture.destroy()` call inside this branch.',
    );
  });

  it('4. Permission-denied branch resets `_sysSttRateApplied = false`', () => {
    const deniedBranch = extractPermissionDeniedBranch(fnBody);
    assert.ok(deniedBranch !== null, 'denied branch must exist (see previous test)');
    assert.ok(
      /_sysSttRateApplied\s*=\s*false/.test(deniedBranch),
      'BUG (B6 REGRESSION): permission-denied branch does not reset `_sysSttRateApplied = false`. ' +
        'After tearing down the stale capture, the rate-applied flag must be reset so that when the ' +
        'user re-grants permission and a new SystemAudioCapture is constructed on the NEXT pipeline ' +
        'setup, its sample rate gets re-applied to the STT provider. Leaving the flag at `true` causes ' +
        'the new capture to silently drift against a stale STT rate config.',
    );
  });

  it('5. Permission-denied branch nulls `this.systemAudioCapture`', () => {
    const deniedBranch = extractPermissionDeniedBranch(fnBody);
    assert.ok(deniedBranch !== null, 'denied branch must exist');
    assert.ok(
      /this\.systemAudioCapture\s*=\s*null/.test(deniedBranch),
      'BUG (B6 REGRESSION): permission-denied branch does not null `this.systemAudioCapture` after ' +
        '.destroy(). Calling destroy() without nulling the reference leaves the dead wrapper around — ' +
        'downstream `if (!this.systemAudioCapture)` guards then misfire, the wrapper appears to still ' +
        'exist, and the construction path for the next attempt is skipped.',
    );
  });

  it('6. destroy() call is awaited AND wrapped in try/catch', () => {
    const deniedBranch = extractPermissionDeniedBranch(fnBody);
    assert.ok(deniedBranch !== null, 'denied branch must exist');
    assert.ok(
      /await\s+this\.systemAudioCapture\.destroy\s*\(\s*\)/.test(deniedBranch),
      'BUG: destroy() is not awaited in the permission-denied branch. ' +
        'SystemAudioCapture.destroy() is async (it drains the native ring buffer and joins the capture ' +
        'thread). Not awaiting it races the subsequent null-assignment against in-flight native callbacks ' +
        'that may still write to the wrapper.',
    );
    assert.ok(
      /\btry\s*\{/.test(deniedBranch) && /\bcatch\s*\(/.test(deniedBranch),
      'BUG: destroy() call in permission-denied branch is not wrapped in try/catch. ' +
        'A throwing destroy() must NOT prevent the wrapper from being nulled and the rate flag from ' +
        'being reset — those cleanups are independent and the catch must let them proceed.',
    );
  });

  it('7. Construction path `new SystemAudioCapture()` is still gated on `!this.systemAudioCapture`', () => {
    // The fix MOVED the permission check OUT of the guard, but the
    // ctor MUST still be gated on it. Otherwise a healthy existing
    // wrapper gets clobbered on every pipeline setup.
    //
    // Strategy: locate `new SystemAudioCapture(` and verify there is an
    // `else if (!this.systemAudioCapture` or `if (!this.systemAudioCapture`
    // structurally protecting it.
    const ctorRe = /new\s+SystemAudioCapture\s*\(/;
    const ctorMatch = ctorRe.exec(fnBody);
    assert.ok(
      ctorMatch !== null,
      'BUG: `new SystemAudioCapture()` not found inside setupSystemAudioPipeline. ' +
        'If you moved construction elsewhere, update the test.',
    );

    // Look for a preceding `else if (!this.systemAudioCapture` OR
    // `if (!this.systemAudioCapture` within a reasonable window before
    // the ctor.
    const before = fnBody.slice(0, ctorMatch.index);
    const guardRe = /(?:else\s+)?if\s*\(\s*!\s*this\.systemAudioCapture\b/g;
    let lastGuardMatch = null;
    let m;
    while ((m = guardRe.exec(before)) !== null) {
      lastGuardMatch = m;
    }
    assert.ok(
      lastGuardMatch !== null,
      'BUG (B6 REGRESSION): `new SystemAudioCapture()` is not gated on `!this.systemAudioCapture`. ' +
        'The B6 fix MOVED resolveMacScreenCaptureCapability out of the guard, but the ctor itself ' +
        'must remain gated — otherwise every pipeline setup clobbers a healthy existing wrapper.',
    );

    const ctorLine = lineOf(fnBody, ctorMatch.index);
    const guardLine = lineOf(fnBody, lastGuardMatch.index);
    assert.ok(
      ctorLine - guardLine < 30,
      `BUG: \`new SystemAudioCapture()\` at line ${ctorLine} is too far from the nearest ` +
        `\`!this.systemAudioCapture\` guard at line ${guardLine} — guard may not be protecting it.`,
    );
  });

  it('8. Sanity: existing B3 invariant holds — at least 3 try blocks in setupSystemAudioPipeline', () => {
    // Cross-check that B6 did not regress B3 (each capture construction
    // retains its own inner try/catch + the outer try).
    const tryMatches = fnBody.match(/\btry\s*\{/g) || [];
    assert.ok(
      tryMatches.length >= 3,
      `BUG: B3 invariant regressed — expected >= 3 try blocks in setupSystemAudioPipeline, found ${tryMatches.length}. ` +
        'B6 must not consolidate the inner construction try/catches back into the outer try.',
    );
  });
});
