// Regression test for fix B10: the zero-fill detector switched from abs-peak
// (`Math.abs(sample) > 8`) to peak-to-peak (`(maxS - minS) > 100`).
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
// abs-peak detection on either audio path, or reduces the threshold back to
// the old `> 8` value.
//
// WHERE THE TWO PATHS LIVE (they are no longer symmetric):
//
//   mic path    — still inline in main.ts `wireMicCapture`, guarded by the
//                 `zerofillLatched`/`zerofillTriggered` pair.
//   system path — extracted into electron/audio/systemAudioHealthClassifier.mjs
//                 (`peakToPeakInt16LE` + DEFAULT_MEANINGFUL_PEAK_TO_PEAK).
//                 `wireSystemCapture` now only forwards chunks to it.
//
// This test previously probed `wireSystemCapture`'s body for the inline
// `zerofillLatched` guard. After the extraction that string was gone, so the
// test threw before it reached ANY assertion — including the mic ones — which
// left the B10 invariant unguarded on both paths while looking merely "broken".
// The system-path assertions below therefore target the classifier source, and
// a delegation check fails if `wireSystemCapture` ever stops using it.
//
// The behavioral counterpart — a DC-biased chunk must NOT read as signal — is
// in electron/audio/__tests__/SystemAudioHealthClassifier.test.mjs. Source
// probes alone cannot tell peak-to-peak from abs-peak on real samples.

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
const classifier = read('electron/audio/systemAudioHealthClassifier.mjs');

/**
 * Return the substring from the first `{` at or after `from` through its
 * matching `}`, inclusive.
 */
function extractBraceBlock(source, from, what) {
  let start = from;
  while (start < source.length && source[start] !== '{') start++;
  assert.ok(source[start] === '{', `could not find body-open '{' of ${what}`);

  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`could not find body-close '}' of ${what}`);
}

/**
 * Extract the body of a private TS method by name. The signature can contain
 * parentheses in default values, so bypass the parameter list by counting
 * parens before looking for the body's opening brace.
 */
function extractMethodBody(source, methodName) {
  const re = new RegExp(`private\\s+${methodName}\\s*\\(`, 'm');
  const m = re.exec(source);
  assert.ok(m, `expected to find private method ${methodName} in main.ts`);

  let i = m.index;
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

  return extractBraceBlock(source, i, methodName);
}

/** Extract a top-level `function NAME(...) { ... }` body from a module. */
function extractFunctionBody(source, fnName) {
  const re = new RegExp(`function\\s+${fnName}\\s*\\(`, 'm');
  const m = re.exec(source);
  assert.ok(m, `expected to find function ${fnName}`);
  return extractBraceBlock(source, m.index + m[0].length, fnName);
}

/**
 * Extract the zero-fill detection block within a method body. Heuristic:
 * the block is the brace-balanced region starting from the `if (...
 * !zerofillLatched && !zerofillTriggered ...)` guard.
 */
function extractZerofillBlock(body, what) {
  const idx = body.indexOf('!zerofillLatched && !zerofillTriggered');
  assert.ok(idx >= 0, `expected the zerofill guard expression in ${what}`);
  // Walk back to the `if` keyword so the returned block includes the guard.
  let i = idx;
  while (i > 0 && body.slice(i, i + 2) !== 'if') i--;
  const block = extractBraceBlock(body, idx, `${what} zerofill block`);
  return body.slice(i, body.indexOf(block) + block.length);
}

// Extraction is LAZY and memoized, never top-level.
//
// These helpers assert on source shape (`private <name>(`, the zerofill guard
// expression), so a routine refactor can make one of them throw. When they ran
// at module scope a single such throw killed every test in the file at import
// time — which is exactly how the system-path probe silently stopped guarding
// anything while merely looking "broken". Per-test evaluation means a refactor
// fails only the assertions that actually depend on the shape that changed.
function memo(fn) {
  let cached;
  let done = false;
  return () => {
    if (!done) { cached = fn(); done = true; }
    return cached;
  };
}

const systemBody = memo(() => extractMethodBody(main, 'wireSystemCapture'));
const micBody = memo(() => extractMethodBody(main, 'wireMicCapture'));
const micZerofill = memo(() => extractZerofillBlock(micBody(), 'wireMicCapture'));
const peakToPeakFn = memo(() => extractFunctionBody(classifier, 'peakToPeakInt16LE'));

/**
 * Strip TS/JS line comments (`// ...`) and block comments.
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

const micZerofillCode = memo(() => stripComments(micZerofill()));
const peakToPeakFnCode = memo(() => stripComments(peakToPeakFn()));
const mainCode = stripComments(main);
const classifierCode = stripComments(classifier);

// ---------------------------------------------------------------------------
// 1. System path: wireSystemCapture must still delegate to the classifier.
//    Without this, re-inlining a (possibly abs-peak) detector into
//    wireSystemCapture would leave every assertion below passing against a
//    module nothing calls.
// ---------------------------------------------------------------------------
test('B10: wireSystemCapture delegates chunk health to SystemAudioHealthClassifier', () => {
  assert.match(
    systemBody(),
    /SystemAudioHealthClassifier/,
    'wireSystemCapture must construct a SystemAudioHealthClassifier'
  );
  assert.match(
    systemBody(),
    /kind:\s*'chunk'[\s\S]{0,120}?chunk/,
    "wireSystemCapture must forward each chunk to the classifier via a { kind: 'chunk', chunk } event"
  );
  // Forwarding alone is not enough: the classifier's decision has to reach the
  // user. Without this, dropping the handler (`health.handle(...)` as a bare
  // statement) would keep both matches above green while silencing every
  // system-audio diagnostic.
  assert.match(
    systemBody(),
    /handleSystemAudioHealthDecision\s*\(\s*systemAudioHealth\.handle\s*\(\s*\{\s*kind:\s*'chunk'/,
    'the chunk decision must be passed to handleSystemAudioHealthDecision, not discarded'
  );
});

// ---------------------------------------------------------------------------
// 2. System path: peakToPeakInt16LE has the three B10 properties.
// ---------------------------------------------------------------------------
test('B10: peakToPeakInt16LE contains no Math.abs', () => {
  assert.ok(
    !/Math\.abs\s*\(/.test(peakToPeakFnCode()),
    'the system-audio detector must not use Math.abs (peak-to-peak is DC-invariant)'
  );
});

test('B10: peakToPeakInt16LE computes max - min', () => {
  assert.match(
    peakToPeakFn(),
    /return\s+max\s*-\s*min\s*;/,
    'peakToPeakInt16LE must return (max - min) for peak-to-peak'
  );
});

test('B10: peakToPeakInt16LE scans every sample (no stride — striding aliases)', () => {
  assert.match(
    peakToPeakFnCode(),
    /i\s*\+=\s*2\b/,
    'the scan must step one int16 sample at a time'
  );
  assert.ok(
    !/stride/i.test(peakToPeakFnCode()),
    'subsampling reintroduces aliasing: at 48kHz/1920B chunks a 30-sample stride made 1600/3200/4800Hz tones measure 0 for 600 consecutive chunks'
  );
});

test('B10: peakToPeakInt16LE initializes min=32767 and max=-32768 (int16 extremes)', () => {
  assert.match(
    peakToPeakFn(),
    /min\s*=\s*32767/,
    'min must start at int16 max so the first sample updates it'
  );
  assert.match(
    peakToPeakFn(),
    /max\s*=\s*-32768/,
    'max must start at int16 min so the first sample updates it'
  );
});

// ---------------------------------------------------------------------------
// 3. System path: the threshold is 100, and it gates the meaningful-signal
//    decision. A contributor lowering this to 8 restores the original bug.
// ---------------------------------------------------------------------------
test('B10: classifier uses a meaningful peak-to-peak threshold of 100', () => {
  assert.match(
    classifierCode,
    /DEFAULT_MEANINGFUL_PEAK_TO_PEAK\s*=\s*100\b/,
    'DEFAULT_MEANINGFUL_PEAK_TO_PEAK must be 100 (not the legacy abs-peak 8)'
  );
  assert.match(
    classifierCode,
    /peakToPeak\s*>\s*this\.meaningfulPeakToPeak/,
    'the classifier must latch meaningful signal on peakToPeak > meaningfulPeakToPeak'
  );
});

// ---------------------------------------------------------------------------
// 4. Mic path: shares the same detector rather than reimplementing it.
//
//    The two paths previously carried independent copies of the loop. They
//    drifted (the system side moved into the classifier; this one stayed in
//    main.ts) and only one copy was under test. Requiring delegation is what
//    keeps a single fix covering both.
// ---------------------------------------------------------------------------
test('B10: wireMicCapture zero-fill block contains no Math.abs', () => {
  assert.ok(
    !/Math\.abs\s*\(/.test(micZerofillCode()),
    'wireMicCapture zero-fill detector must not use Math.abs'
  );
});

test('B10: wireMicCapture computes peak-to-peak via the shared peakToPeakInt16LE', () => {
  assert.match(
    micZerofill(),
    /peakToPeak\s*=\s*peakToPeakInt16LE\s*\(\s*chunk\s*\)/,
    'wireMicCapture must call the shared peakToPeakInt16LE rather than reimplementing the scan'
  );
  assert.match(
    main,
    /import\s*\{[^}]*peakToPeakInt16LE[^}]*\}\s*from\s*["']\.\/audio\/systemAudioHealthClassifier\.mjs["']/,
    'main.ts must import peakToPeakInt16LE from the classifier module'
  );
});

test('B10: wireMicCapture uses peakToPeak > 100 threshold', () => {
  assert.match(
    micZerofill(),
    /peakToPeak\s*>\s*100/,
    'wireMicCapture must latch on peakToPeak > 100'
  );
});

test('B10: wireMicCapture zero-fill emits sendAudioCaptureFailed with channel="mic" and mic-zero-fill', () => {
  // Restored after the detector refactor dropped it. This is the ONLY coverage
  // of the dead-mic banner's payload anywhere in the repo: without it a
  // refactor could delete the notification, flip the channel, or rename the
  // message key, and a user with a muted or TCC-denied mic would record a whole
  // meeting with no transcript and no explanation, with CI fully green.
  const block = micZerofill();

  assert.match(block, /this\.sendAudioCaptureFailed\s*\(/, 'the zero-fill branch must notify the renderer');
  assert.match(block, /channel:\s*'mic'/, "the notification must be attributed to the 'mic' channel");
  assert.match(
    block,
    /formatPermissionMessage\(\s*'mic-zero-fill'\s*\)/,
    "the message must come from the 'mic-zero-fill' permission key"
  );
  assert.match(
    block,
    /titleKey:\s*permissionTitleKey\(\s*'mic-zero-fill'\s*\)/,
    "the title must come from the 'mic-zero-fill' permission key"
  );
  assert.match(block, /stuck:\s*true/, 'the banner must be marked stuck so the UI keeps it visible');
});

// ---------------------------------------------------------------------------
// The meaningful-signal latch is one-way on both paths, so it needs more than
// a single chunk of evidence before it permanently disables silence reporting.
// ---------------------------------------------------------------------------
test('B10: wireMicCapture requires multiple loud chunks before latching', () => {
  const block = micZerofill();

  assert.match(
    block,
    /loudChunkCount\+\+/,
    'the mic path must count above-threshold chunks rather than latching on the first'
  );
  assert.match(
    block,
    /loudChunkCount\s*>=\s*ZEROFILL_LATCH_CHUNKS[\s\S]{0,40}?zerofillLatched\s*=\s*true/,
    'zerofillLatched must only be set once the chunk count is reached'
  );
  assert.match(
    micBody(),
    /ZEROFILL_LATCH_CHUNKS\s*=\s*[2-9]/,
    'the latch must require at least 2 chunks — 1 makes a lone transient permanently suppress the banner'
  );
});

test('B10: the classifier requires multiple loud chunks before latching', () => {
  assert.match(
    classifierCode,
    /DEFAULT_MEANINGFUL_CHUNK_COUNT\s*=\s*[2-9]/,
    'the system path must require at least 2 above-threshold chunks to latch'
  );
  assert.match(
    classifierCode,
    /this\.loudChunkCount\s*>=\s*this\.meaningfulChunkCount[\s\S]{0,40}?hasMeaningfulSignal\s*=\s*true/,
    'hasMeaningfulSignal must only be set once the chunk count is reached'
  );
});

test('B10: main.ts does not reintroduce an inline peak-to-peak scan', () => {
  assert.ok(
    !/maxS\s*-\s*minS/.test(mainCode),
    'the peak-to-peak scan must live only in systemAudioHealthClassifier.mjs — an inline copy in main.ts is how the two paths drifted before'
  );
});

// ---------------------------------------------------------------------------
// 5. Negative regression: the legacy `> 8` pattern is gone from any
//    zero-fill context. We define "zero-fill context" as within 3 lines of
//    the `zerofillLatched` marker in main.ts, and within the whole
//    peak-to-peak function in the classifier.
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

test('B10: legacy `> 8` threshold does not appear in the system-audio peak-to-peak detector', () => {
  assert.ok(
    !/>\s*8(?!\d)/.test(peakToPeakFnCode()),
    'peakToPeakInt16LE must not compare against the legacy abs-peak threshold of 8'
  );
});
