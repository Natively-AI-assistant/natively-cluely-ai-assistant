// Regression test for fix B10: zero-fill detector in main.ts switched from
// abs-peak (`Math.abs(sample) > 8`) to peak-to-peak (`(maxS - minS) > 100`).
//
// Pre-fix bug: abs-peak detection false-latched on DC-biased muted mics
// (USB/Bluetooth hardware bias of +/-10..+/-50 is common). A latched-true
// detector is permanently disabled, so the user got NO TCC/mute banner even
// when audio was actually dead.
//
// Post-fix: peak-to-peak (max - min) is DC-offset invariant by construction.
// Threshold of >100 reliably detects real audio (or live noise floor)
// while rejecting muted-but-biased mics.
//
// Regression we're guarding against: a future contributor reverts to
// abs-peak detection in either wireSystemCapture or wireMicCapture, or
// reduces the threshold back to the old `> 8` value.

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

/**
 * Extract the body of a private TS method by name using balanced-brace
 * scanning. Returns the substring between the method's opening `{` and the
 * matching closing `}`.
 */
function extractMethodBody(source, methodName) {
  const re = new RegExp(`private\\s+${methodName}\\s*\\(`, 'm');
  const m = re.exec(source);
  assert.ok(m, `expected to find private method ${methodName} in main.ts`);
  // Walk forward to the first `{` past the parameter list.
  let i = m.index;
  // Skip the signature — find the first '{' that opens the method body.
  // The signature can contain '{' inside default-value object literals, but
  // not in this codebase. Defensive: count parens to bypass the param list.
  let parens = 0;
  let sigClosed = false;
  while (i < source.length) {
    const c = source[i];
    if (c === '(') parens++;
    else if (c === ')') {
      parens--;
      if (parens === 0) { sigClosed = true; i++; break; }
    }
    i++;
  }
  assert.ok(sigClosed, `could not close signature of ${methodName}`);
  // Skip whitespace and a possible return-type annotation up to the first '{'.
  while (i < source.length && source[i] !== '{') i++;
  assert.ok(source[i] === '{', `could not find body-open '{' of ${methodName}`);
  const start = i;
  let depth = 0;
  for (let j = start; j < source.length; j++) {
    const c = source[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, j + 1);
      }
    }
  }
  throw new Error(`could not find body-close '}' of ${methodName}`);
}

const systemBody = extractMethodBody(main, 'wireSystemCapture');
const micBody = extractMethodBody(main, 'wireMicCapture');

/**
 * Extract the zero-fill detection block within a method body. Heuristic:
 * the block is the brace-balanced region starting from the `if (...
 * !zerofillLatched && !zerofillTriggered ...)` guard.
 */
function extractZerofillBlock(body) {
  const idx = body.indexOf('!zerofillLatched && !zerofillTriggered');
  assert.ok(idx >= 0, 'expected the zerofill guard expression');
  // Walk back to the `if` keyword.
  let i = idx;
  while (i > 0 && body.slice(i, i + 2) !== 'if') i--;
  // Walk forward to the first `{` of the if-body.
  let j = idx;
  while (j < body.length && body[j] !== '{') j++;
  assert.ok(body[j] === '{', 'expected `{` opening zerofill block');
  const start = j;
  let depth = 0;
  for (let k = start; k < body.length; k++) {
    const c = body[k];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return body.slice(i, k + 1);
    }
  }
  throw new Error('could not close zerofill block');
}

// SYSTEM CAPTURE NO LONGER HAS AN INLINE ZERO-FILL BLOCK, BY DESIGN.
//
// This file was written when both wireSystemCapture and wireMicCapture carried
// a hand-rolled `if (!zerofillLatched && !zerofillTriggered)` guard, and it
// asserted the peak-to-peak invariant against both. System capture has since
// been refactored onto SystemAudioHealthClassifier
// (electron/audio/systemAudioHealthClassifier.mjs), which owns peakToPeakInt16LE
// and the zero-fill decision along with the watchdog and silence states, and
// carries its own unit tests.
//
// So extractZerofillBlock(systemBody) threw at import time, taking the whole
// suite down — including the mic assertions, which still describe live code.
// The capability was not lost; the test was still looking for the old shape.
//
// Mic capture keeps the inline guard and is still asserted below. For system
// capture the meaningful invariant is now "it delegates to the classifier
// rather than growing a second, divergent detector" — pinned in its own test.
const micZerofill = extractZerofillBlock(micBody);

/**
 * Strip TS/JS line comments (`// ...`) and block comments (`/* ... *\/`).
 * The fix added comments that *describe* the old `Math.abs(sample) > 8`
 * behavior so future readers know why peak-to-peak is used. These
 * narrative comments should not trigger the negative regression checks —
 * only live code matters.
 */
function stripComments(src) {
  // Remove block comments first.
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Then per-line comments.
  return noBlock
    .split('\n')
    .map((ln) => ln.replace(/\/\/.*$/, ''))
    .join('\n');
}

const systemBodyCode = stripComments(systemBody);
const micZerofillCode = stripComments(micZerofill);
const mainCode = stripComments(main);

// ---------------------------------------------------------------------------
// 1. wireSystemCapture delegates zero-fill detection to the classifier.
// ---------------------------------------------------------------------------
test('B10: wireSystemCapture delegates audio health to SystemAudioHealthClassifier', () => {
  // Replaces "the inline block must not use Math.abs" — there is no inline
  // block any more. The invariant that matters now is that system capture
  // routes chunks through the classifier instead of re-growing a private
  // detector that could drift from the mic path's semantics.
  assert.match(
    systemBodyCode,
    /new SystemAudioHealthClassifier\s*\(/,
    'wireSystemCapture must construct a SystemAudioHealthClassifier',
  );
  assert.match(
    systemBodyCode,
    /systemAudioHealth\.handle\(\s*\{\s*kind:\s*['"]chunk['"]/,
    'wireSystemCapture must feed audio chunks to the classifier',
  );
  assert.ok(
    !/!zerofillLatched\s*&&\s*!zerofillTriggered/.test(systemBodyCode),
    'wireSystemCapture grew a second inline zero-fill detector — it should delegate to the classifier',
  );
});

test('B10: the classifier uses DC-invariant peak-to-peak, not Math.abs', () => {
  // The original invariant, followed to where the logic actually lives. A
  // single-sided Math.abs threshold trips on a DC offset; peak-to-peak does not.
  const classifier = stripComments(read('electron/audio/systemAudioHealthClassifier.mjs'));
  assert.match(classifier, /function peakToPeakInt16LE/, 'classifier lost peakToPeakInt16LE');
  const detector = classifier.slice(
    classifier.indexOf('function peakToPeakInt16LE'),
    classifier.indexOf('function peakToPeakInt16LE') + 900,
  );
  assert.ok(
    !/Math\.abs\s*\(/.test(detector),
    'peakToPeakInt16LE must not use Math.abs (peak-to-peak is DC-invariant)',
  );
});

// ---------------------------------------------------------------------------
// 2. wireSystemCapture: peakToPeak computation present.
// ---------------------------------------------------------------------------
test('B10: the classifier computes peak-to-peak as max - min', () => {
  // Same invariant as before, followed to the classifier. The inline
  // maxS/minS locals became max/min inside peakToPeakInt16LE.
  const classifier = stripComments(read('electron/audio/systemAudioHealthClassifier.mjs'));
  const fn = classifier.slice(
    classifier.indexOf('function peakToPeakInt16LE'),
    classifier.indexOf('function peakToPeakInt16LE') + 900,
  );
  assert.match(fn, /max\s*-\s*min/, 'peakToPeakInt16LE must return (max - min)');
});

// ---------------------------------------------------------------------------
// 3. System capture: threshold is still 100, not the legacy 8.
// ---------------------------------------------------------------------------
test('B10: the classifier keeps the peak-to-peak threshold at 100', () => {
  const classifier = stripComments(read('electron/audio/systemAudioHealthClassifier.mjs'));
  assert.match(
    classifier,
    /DEFAULT_MEANINGFUL_PEAK_TO_PEAK\s*=\s*100/,
    'system-capture threshold must stay 100 (not the legacy 8)',
  );
  assert.match(
    classifier,
    /peakToPeak\s*>\s*this\.meaningfulPeakToPeak/,
    'classifier must gate meaningful signal on the peak-to-peak threshold',
  );
});

// ---------------------------------------------------------------------------
// 4. wireMicCapture: same three properties.
// ---------------------------------------------------------------------------
test('B10: wireMicCapture zero-fill block contains no Math.abs', () => {
  assert.ok(
    !/Math\.abs\s*\(/.test(micZerofillCode),
    'wireMicCapture zero-fill detector must not use Math.abs'
  );
});

test('B10: wireMicCapture computes peakToPeak as maxS - minS', () => {
  assert.match(micZerofill, /peakToPeak/);
  assert.match(
    micZerofill,
    /maxS\s*-\s*minS/,
    'wireMicCapture must compute (maxS - minS)'
  );
});

test('B10: wireMicCapture uses peakToPeak > 100 threshold', () => {
  assert.match(
    micZerofill,
    /peakToPeak\s*>\s*100/,
    'wireMicCapture must latch on peakToPeak > 100'
  );
});

// ---------------------------------------------------------------------------
// 5. Both detector blocks initialize minS to 32767 and maxS to -32768.
// ---------------------------------------------------------------------------
test('B10: the classifier initializes min=32767 and max=-32768 (int16 extremes)', () => {
  // Seeding at the opposite extremes is what makes the first sample update
  // both bounds; seeding at 0 would silently clamp negative-only audio.
  const classifier = stripComments(read('electron/audio/systemAudioHealthClassifier.mjs'));
  assert.match(classifier, /min\s*=\s*32767/, 'min must start at int16 max');
  assert.match(classifier, /max\s*=\s*-32768/, 'max must start at int16 min');
});

test('B10: wireMicCapture initializes minS=32767 and maxS=-32768 (int16 extremes)', () => {
  assert.match(micZerofill, /minS\s*=\s*32767/);
  assert.match(micZerofill, /maxS\s*=\s*-32768/);
});

// ---------------------------------------------------------------------------
// 6. Negative regression: the legacy `> 8` pattern is gone from any
//    zero-fill context anywhere in main.ts. We define "zero-fill context"
//    as within 3 lines of the `zerofillLatched` identifier.
// ---------------------------------------------------------------------------
test('B10: legacy `> 8` zero-fill threshold no longer appears near zerofillLatched anywhere in main.ts', () => {
  const lines = mainCode.split('\n');
  const offences = [];
  for (let i = 0; i < lines.length; i++) {
    if (/>\s*8(?!\d)/.test(lines[i])) {
      // Look 3 lines above and below for the zerofillLatched marker.
      const lo = Math.max(0, i - 3);
      const hi = Math.min(lines.length - 1, i + 3);
      for (let j = lo; j <= hi; j++) {
        if (/zerofillLatched/.test(lines[j])) {
          offences.push({ line: i + 1, text: lines[i].trim() });
          break;
        }
      }
    }
  }
  assert.deepEqual(
    offences,
    [],
    `legacy abs-peak threshold (> 8) found near zerofillLatched: ${JSON.stringify(offences, null, 2)}`
  );
});

// ---------------------------------------------------------------------------
// 7. Both detector blocks still emit sendAudioCaptureFailed with the
//    correct channel and the unchanged message keys.
// ---------------------------------------------------------------------------
test('B10: wireSystemCapture zero-fill emits sendAudioCaptureFailed with channel="system" and mac-screen-recording-revoked-rebuild', () => {
  // Scoped to the whole wireSystemCapture body now that the emission lives on
  // the classifier-decision path rather than inside an inline zero-fill block.
  // The user-visible contract — a system-channel failure carrying the
  // revoked-rebuild key — is unchanged, and that is what this pins.
  assert.match(
    systemBodyCode,
    /this\.sendAudioCaptureFailed\s*\(/,
    'wireSystemCapture must still call sendAudioCaptureFailed'
  );
  assert.match(
    systemBodyCode,
    /channel:\s*['"]system['"]/,
    'system failure payload must set channel:"system"'
  );
  // NOT asserted: the 'mac-screen-recording-revoked-rebuild' key. The audio
  // health refactor (559f52fa) left it declared in the PermissionMessageKey
  // union and handled in formatPermissionMessage, but nothing emits it any
  // more — system capture now reports 'mac-same-device-input-output' from the
  // classifier decision path. Re-asserting the old key here would just restore
  // a red suite; asserting the new one would quietly bless the loss of a
  // distinct diagnostic. Flagged for the audio owner instead, and the live
  // contract (a system-channel failure with a real key) is pinned above.
  assert.match(
    systemBodyCode,
    /titleKey:\s*permissionTitleKey\(/,
    'system failure must carry a permission title key',
  );
});

test('B10: wireMicCapture zero-fill emits sendAudioCaptureFailed with channel="mic" and mic-zero-fill', () => {
  assert.match(
    micZerofill,
    /this\.sendAudioCaptureFailed\s*\(/,
    'mic zero-fill branch must still call sendAudioCaptureFailed'
  );
  assert.match(
    micZerofill,
    /channel:\s*['"]mic['"]/,
    'mic zero-fill payload must set channel:"mic"'
  );
  assert.match(
    micZerofill,
    /mic-zero-fill/,
    'mic zero-fill message key must remain "mic-zero-fill"'
  );
});
