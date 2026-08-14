// Regression test for B7 fix (2026-05-28): restartCapturesAfterResume in
// electron/main.ts now resets BOTH recovery attempt counters at the top
// of the function body (after the !isMeetingActive early-return, before
// the destroy()+recreate sequence):
//
//   this._systemAudioRecoveryAttempts = 0;
//   this._micRecoveryAttempts = 0;
//
// The counters are tied to a SPECIFIC capture instance's failure history;
// once we destroy + recreate, the fresh captures must start with a clean
// slate. Pre-fix, a flaky pre-sleep meeting that saturated either counter
// at 3 caused the early-return guards in setupMicRecoveryHandler /
// setupAudioRecoveryHandler ("Skipping recovery — already at max
// attempts") to fire on the FIRST post-wake error event, silently
// dropping the cpal transient 'error' that almost always fires on wake
// (device handle is briefly invalid before reattaching).
//
// Regression we guard against: a future contributor removes one or both
// resets ("they should auto-reset on success", "destroy() should clear
// them", etc.), re-introducing the silent-drop bug where post-wake
// transient errors are eaten by the >= 3 attempts guard. The user sees
// "Listening for audio…" forever and no UI signal explains why.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainPath = path.join(root, 'electron/main.ts');
const source = fs.readFileSync(mainPath, 'utf8');

// Balanced-brace extractor for the function body. Starts at the opening
// `{` after the function signature, walks forward counting braces, and
// returns the substring between (exclusive of) the outer braces. Honors
// // and /* */ comments and string literals so braces inside them don't
// throw off the counter.
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
      if (depth === 0) {
        return src.slice(bodyStart, i);
      }
    }
    i++;
  }
  return null;
}

// Count occurrences of a regex in a string, ignoring overlapping.
function countMatches(str, re) {
  // Make sure the regex is global. If caller didn't pass /g, recompile.
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const gre = new RegExp(re.source, flags);
  let n = 0;
  while (gre.exec(str) !== null) {
    n++;
    if (gre.lastIndex === 0) break; // zero-width — bail to avoid infinite loop
  }
  return n;
}

// Find the index (within `body`) of the first match of `re`, or -1.
function firstIndex(body, re) {
  const m = re.exec(body);
  return m ? m.index : -1;
}

// Pre-flight: extract the function body once. Many assertions reuse it.
const fnBody = extractFunctionBody(
  source,
  String.raw`public\s+async\s+restartCapturesAfterResume\s*\(\s*\)\s*:\s*Promise<void>\s*\{`,
);

describe('B7: restartCapturesAfterResume resets recovery counters before destroy+recreate', () => {
  it('1. restartCapturesAfterResume function exists in electron/main.ts', () => {
    assert.ok(
      /public\s+async\s+restartCapturesAfterResume\s*\(\s*\)\s*:\s*Promise<void>\s*\{/.test(source),
      'BUG: restartCapturesAfterResume signature not found in electron/main.ts. ' +
        'If you renamed or restructured the function, update this test — ' +
        'the counter-reset regression contract still applies.',
    );
    assert.ok(
      fnBody !== null && fnBody.length > 0,
      'BUG: could not extract restartCapturesAfterResume body via balanced-brace parse. ' +
        'Either the signature changed shape or the body is malformed.',
    );
  });

  it('2. Body contains BOTH `_systemAudioRecoveryAttempts = 0` AND `_micRecoveryAttempts = 0`', () => {
    assert.ok(
      /this\._systemAudioRecoveryAttempts\s*=\s*0\s*;/.test(fnBody),
      'BUG: restartCapturesAfterResume no longer resets `this._systemAudioRecoveryAttempts = 0`. ' +
        'Without this reset, a pre-sleep meeting that saturated the counter at 3 causes the ' +
        'setupAudioRecoveryHandler early-return guard (>= 3) to drop the first post-wake ' +
        "cpal transient 'error' silently — user sees \"Listening for audio…\" forever.",
    );
    assert.ok(
      /this\._micRecoveryAttempts\s*=\s*0\s*;/.test(fnBody),
      'BUG: restartCapturesAfterResume no longer resets `this._micRecoveryAttempts = 0`. ' +
        'Same silent-drop hazard as system-audio counter — first post-wake mic error gets ' +
        'eaten by the setupMicRecoveryHandler >= 3 guard.',
    );
  });

  it('3. BOTH resets appear BEFORE any `.destroy()` call in the function body', () => {
    const sysResetIdx = firstIndex(fnBody, /this\._systemAudioRecoveryAttempts\s*=\s*0\s*;/);
    const micResetIdx = firstIndex(fnBody, /this\._micRecoveryAttempts\s*=\s*0\s*;/);
    const destroyIdx = firstIndex(fnBody, /\.destroy\s*\(/);

    assert.ok(sysResetIdx >= 0, 'precondition: system reset must exist (see test 2)');
    assert.ok(micResetIdx >= 0, 'precondition: mic reset must exist (see test 2)');
    assert.ok(
      destroyIdx >= 0,
      'precondition: restartCapturesAfterResume body must contain at least one `.destroy()` call. ' +
        'If destroy semantics changed, the resets-before-destroy contract may need a rewrite.',
    );

    assert.ok(
      sysResetIdx < destroyIdx,
      `BUG: \`_systemAudioRecoveryAttempts = 0\` (idx ${sysResetIdx}) appears AFTER the first \`.destroy()\` call (idx ${destroyIdx}). ` +
        'B7 requires resets BEFORE destroy+recreate, because in-flight error events fired DURING destroy() ' +
        'would be evaluated against the still-saturated counter and dropped.',
    );
    assert.ok(
      micResetIdx < destroyIdx,
      `BUG: \`_micRecoveryAttempts = 0\` (idx ${micResetIdx}) appears AFTER the first \`.destroy()\` call (idx ${destroyIdx}). ` +
        'Same hazard as the system counter — must be reset before destroy().',
    );
  });

  it('4. BOTH resets appear AFTER the `if (!this.isMeetingActive) return;` early-return', () => {
    // The early-return is the no-active-meeting short-circuit. Resets
    // happening BEFORE that guard would be wasted work (and arguably
    // wrong — we'd clobber counters even when there's no meeting to
    // recover). Resets must live in the "we have an active meeting and
    // are about to recreate captures" path.
    const earlyReturnRe = /if\s*\(\s*!\s*this\.isMeetingActive\s*\)\s*\{[^}]*return\s*;?\s*\}/;
    const earlyReturnMatch = earlyReturnRe.exec(fnBody);
    assert.ok(
      earlyReturnMatch !== null,
      'BUG: could not locate the `if (!this.isMeetingActive) ... return;` early-return guard at the top of ' +
        'restartCapturesAfterResume. If you restructured the guard, update this test — but the ' +
        '"resets only fire when a meeting is active" contract still applies.',
    );
    const earlyReturnEndIdx = earlyReturnMatch.index + earlyReturnMatch[0].length;

    const sysResetIdx = firstIndex(fnBody, /this\._systemAudioRecoveryAttempts\s*=\s*0\s*;/);
    const micResetIdx = firstIndex(fnBody, /this\._micRecoveryAttempts\s*=\s*0\s*;/);

    assert.ok(
      sysResetIdx > earlyReturnEndIdx,
      `BUG: \`_systemAudioRecoveryAttempts = 0\` (idx ${sysResetIdx}) appears BEFORE the !isMeetingActive early-return (ends at ${earlyReturnEndIdx}). ` +
        'Resets must live AFTER the short-circuit — otherwise they fire even for resume events with no active meeting, ' +
        'masking unrelated bugs in counter management.',
    );
    assert.ok(
      micResetIdx > earlyReturnEndIdx,
      `BUG: \`_micRecoveryAttempts = 0\` (idx ${micResetIdx}) appears BEFORE the !isMeetingActive early-return. Same hazard as system counter.`,
    );
  });

  it('5. Each reset appears EXACTLY ONCE in the function body (no accidental duplicates)', () => {
    const sysCount = countMatches(fnBody, /this\._systemAudioRecoveryAttempts\s*=\s*0\s*;/);
    const micCount = countMatches(fnBody, /this\._micRecoveryAttempts\s*=\s*0\s*;/);
    assert.equal(
      sysCount,
      1,
      `BUG: \`_systemAudioRecoveryAttempts = 0\` appears ${sysCount} times in restartCapturesAfterResume. ` +
        'Expected exactly 1 — a duplicate suggests two contributors independently added the reset ' +
        '(confusion about ownership) and may indicate one of them is in the wrong position relative to destroy().',
    );
    assert.equal(
      micCount,
      1,
      `BUG: \`_micRecoveryAttempts = 0\` appears ${micCount} times in restartCapturesAfterResume. Expected exactly 1.`,
    );
  });

  it('6. Cross-check: `_micRecoveryAttempts >= 3` early-return guard still exists in setupMicRecoveryHandler', () => {
    // B7 unblocks this gate. If a future refactor deletes the >= 3 cap,
    // the resets become pointless busywork AND the system loses its
    // infinite-restart-loop protection. The reset and the gate are a
    // matched pair; this test ensures the gate survives.
    const setupMicBody = extractFunctionBody(
      source,
      String.raw`private\s+setupMicRecoveryHandler\s*\(\s*\)\s*:\s*void\s*\{`,
    );
    assert.ok(
      setupMicBody !== null,
      'BUG: setupMicRecoveryHandler not found in main.ts. The B7 reset only matters because this ' +
        'handler enforces a `>= 3` early-return. If the handler was renamed or removed, the ' +
        'contract between B7 and the gate needs re-examination.',
    );
    assert.ok(
      /_micRecoveryAttempts\s*>=\s*3/.test(setupMicBody),
      'BUG: setupMicRecoveryHandler no longer contains the `_micRecoveryAttempts >= 3` guard. ' +
        'B7 (counter reset on resume) and this gate are a matched pair — without the gate, the reset is ' +
        'dead code; without the reset, the gate silently drops post-wake errors. ' +
        'If you intentionally removed the cap, also remove the reset in restartCapturesAfterResume ' +
        'and delete this test.',
    );
  });

  it('7. Cross-check: `_systemAudioRecoveryAttempts >= 3` early-return guard still exists in setupAudioRecoveryHandler', () => {
    const setupSysBody = extractFunctionBody(
      source,
      String.raw`private\s+setupAudioRecoveryHandler\s*\(\s*\)\s*:\s*void\s*\{`,
    );
    assert.ok(
      setupSysBody !== null,
      'BUG: setupAudioRecoveryHandler not found in main.ts. The B7 reset only matters because this ' +
        'handler enforces a `>= 3` early-return.',
    );
    assert.ok(
      /_systemAudioRecoveryAttempts\s*>=\s*3/.test(setupSysBody),
      'BUG: setupAudioRecoveryHandler no longer contains the `_systemAudioRecoveryAttempts >= 3` guard. ' +
        'B7 (counter reset on resume) and this gate are a matched pair — see test 6 commentary.',
    );
  });
});
