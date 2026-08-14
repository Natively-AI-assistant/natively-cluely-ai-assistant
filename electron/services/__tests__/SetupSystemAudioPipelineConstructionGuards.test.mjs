// Regression test for B3 fix (2026-05-28): setupSystemAudioPipeline used to
// wrap the entire body — SystemAudioCapture ctor + wireSystemCapture +
// MicrophoneCapture ctor + wireMicCapture + STT init — in ONE outer
// try/catch. If `new SystemAudioCapture()` threw (native module failure,
// HAL exhaustion, NAPI throw), the catch logged to console and silently
// returned. The wrapper was left null, no watchdog was armed, no banner
// surfaced. The STT WebSocket later connected with no audio source, and
// the user saw "Listening for audio…" forever with no UI signal.
//
// Fix: wrap the SystemAudioCapture construction-and-wiring block and the
// MicrophoneCapture construction-and-wiring block each in their OWN
// try/catch. On throw: null the wrapper, emit a terminal
// sendAudioCaptureFailed for the correct channel, and FALL THROUGH so
// the other capture's construction still runs (a system-capture failure
// must not prevent mic capture from initializing, and vice versa).
//
// Regression we guard against: a future contributor consolidates the
// two inner try/catches back into the outer one (tempting cleanup: "this
// is repetitive"), or drops the sendAudioCaptureFailed terminal IPC
// (tempting: "we already console.error, the UI will figure it out"), or
// adds a `return`/`throw` inside one of the inner catches that aborts
// the other capture's initialization. Each of those silently restores
// the original bug.

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
  // Find the opening brace AFTER the signature match.
  let i = m.index + m[0].length;
  // The signature pattern is expected to end with `{`, but be lenient.
  if (src[i - 1] !== '{') {
    // Walk forward to the next `{`.
    while (i < src.length && src[i] !== '{') i++;
    if (i >= src.length) return null;
    i++;
  }
  const bodyStart = i;
  let depth = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = null; // holds the opening quote char if inside a string
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

// Extract the body of a `try { ... }` block whose opening `try {` lives
// at byte offset `tryOffset` in `src`. Returns the contents between the
// braces (excluding the braces themselves), or null on parse failure.
function extractTryBlockBody(src, tryOffset) {
  // Walk to the first `{` after `try`.
  let i = tryOffset;
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

// Given a body string, find each `catch (...) {` block and return its
// inner contents. The `precedingMatcher` regex must match a substring
// of the corresponding `try` block — we use that to associate each
// catch with its protected construction.
function findCatchAfter(body, precedingMatcher) {
  const m = precedingMatcher.exec(body);
  if (!m) return null;
  // Find the next `catch` keyword after this match.
  const catchRe = /catch\s*\([^)]*\)\s*\{/g;
  catchRe.lastIndex = m.index;
  const cm = catchRe.exec(body);
  if (!cm) return null;
  // Extract the catch block body via balanced-brace walk on `body`.
  return extractTryBlockBody(body, cm.index);
}

// Pre-flight: extract the function body once. Many assertions reuse it.
const fnBody = extractFunctionBody(
  source,
  String.raw`private\s+async\s+setupSystemAudioPipeline\s*\(\s*\)\s*:\s*Promise<void>\s*\{`,
);

describe('B3: setupSystemAudioPipeline construction guards', () => {
  it('1. setupSystemAudioPipeline function exists in electron/main.ts', () => {
    assert.ok(
      /private\s+async\s+setupSystemAudioPipeline\s*\(\s*\)\s*:\s*Promise<void>\s*\{/.test(source),
      'BUG: setupSystemAudioPipeline signature not found. ' +
        'If you renamed or restructured the function, update this test to match — ' +
        'the construction-guard regression contract still applies.',
    );
    assert.ok(
      fnBody !== null && fnBody.length > 0,
      'BUG: could not extract setupSystemAudioPipeline body via balanced-brace parse. ' +
        'Either the signature changed shape or the body is malformed.',
    );
  });

  it('2. setupSystemAudioPipeline body contains at least THREE try blocks (outer + 2 inner)', () => {
    // Strip nested function bodies first? No — there are no nested
    // function declarations inside setupSystemAudioPipeline. A plain
    // count of `try {` occurrences inside the function body suffices.
    const tryMatches = fnBody.match(/\btry\s*\{/g) || [];
    assert.ok(
      tryMatches.length >= 3,
      `BUG: expected >= 3 \`try {\` blocks inside setupSystemAudioPipeline (one outer + one per capture-construction), found ${tryMatches.length}. ` +
        'B3 fix requires the SystemAudioCapture and MicrophoneCapture constructions to each have their OWN inner try/catch — ' +
        'consolidating them back into the outer try silently restores the original bug ' +
        '(thrown ctor leaves wrapper null, no UI signal, "Listening for audio…" forever).',
    );
  });

  it('3. SystemAudioCapture construction is protected by a try/catch that emits terminal channel:\'system\' failure', () => {
    // Find the inner catch associated with `new SystemAudioCapture()`.
    const catchBody = findCatchAfter(fnBody, /new\s+SystemAudioCapture\s*\(/);
    assert.ok(
      catchBody !== null,
      'BUG: could not locate a `catch` block following `new SystemAudioCapture()`. ' +
        'The SystemAudioCapture ctor must be wrapped in its own try/catch — ' +
        'see B3 fix (2026-05-28). Without it, a native-module throw silently nulls the wrapper.',
    );
    assert.ok(
      /sendAudioCaptureFailed\s*\(/.test(catchBody),
      'BUG: SystemAudioCapture-construction catch no longer calls sendAudioCaptureFailed. ' +
        'console.error alone is invisible to users; the catch MUST emit the terminal IPC ' +
        'so the renderer banner surfaces.',
    );
    assert.ok(
      /channel\s*:\s*['"]system['"]/.test(catchBody),
      'BUG: SystemAudioCapture-construction catch emits sendAudioCaptureFailed but with the wrong channel. ' +
        'It must be `channel: \'system\'` so the renderer routes the failure to the system-audio surface.',
    );
    assert.ok(
      /terminal\s*:\s*true/.test(catchBody),
      'BUG: SystemAudioCapture-construction catch is missing `terminal: true` in the IPC payload. ' +
        'A ctor failure is one-shot — without `terminal: true` the renderer gates this out as transient recovery ' +
        '(see B1: handler requires `payload.terminal || payload.stuck`).',
    );
  });

  it('4. MicrophoneCapture construction is protected by a try/catch that emits terminal channel:\'mic\' failure', () => {
    const catchBody = findCatchAfter(fnBody, /new\s+MicrophoneCapture\s*\(/);
    assert.ok(
      catchBody !== null,
      'BUG: could not locate a `catch` block following `new MicrophoneCapture()`. ' +
        'The MicrophoneCapture ctor must be wrapped in its own try/catch.',
    );
    assert.ok(
      /sendAudioCaptureFailed\s*\(/.test(catchBody),
      'BUG: MicrophoneCapture-construction catch no longer calls sendAudioCaptureFailed.',
    );
    assert.ok(
      /channel\s*:\s*['"]mic['"]/.test(catchBody),
      'BUG: MicrophoneCapture-construction catch emits sendAudioCaptureFailed with the wrong channel — ' +
        'must be `channel: \'mic\'`.',
    );
    assert.ok(
      /terminal\s*:\s*true/.test(catchBody),
      'BUG: MicrophoneCapture-construction catch is missing `terminal: true`.',
    );
  });

  it('5. Neither construction catch emits sendSystemAudioPermissionDenied (wrong IPC for ctor failure)', () => {
    const sysCatch = findCatchAfter(fnBody, /new\s+SystemAudioCapture\s*\(/);
    const micCatch = findCatchAfter(fnBody, /new\s+MicrophoneCapture\s*\(/);
    assert.ok(sysCatch && micCatch, 'both construction catches must exist (see previous tests)');
    assert.ok(
      !/sendSystemAudioPermissionDenied/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch calls sendSystemAudioPermissionDenied. ' +
        'That IPC is reserved for TCC denial (screen-recording permission), NOT generic ctor failure. ' +
        'Routing native-module throws through the permission-denied surface confuses the user with a misleading banner.',
    );
    assert.ok(
      !/sendSystemAudioPermissionDenied/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch calls sendSystemAudioPermissionDenied. Wrong IPC for ctor failure.',
    );
  });

  it('6. Construction catches do NOT contain `return` or `throw` that aborts the rest of the pipeline', () => {
    const sysCatch = findCatchAfter(fnBody, /new\s+SystemAudioCapture\s*\(/);
    const micCatch = findCatchAfter(fnBody, /new\s+MicrophoneCapture\s*\(/);
    assert.ok(sysCatch && micCatch, 'both construction catches must exist');

    // A bare `return;` or `return ...;` would skip the microphone block,
    // recreating "system fails → mic also silently absent" symptom.
    assert.ok(
      !/\breturn\b/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch contains `return`. ' +
        'A system-capture failure must NOT abort microphone-capture initialization — ' +
        'the user expects mic-only fallback when system audio fails (mic-only meetings).',
    );
    assert.ok(
      !/\bthrow\b/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch re-throws. ' +
        'Throwing escalates to the outer catch and skips the microphone block.',
    );
    assert.ok(
      !/\breturn\b/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch contains `return`. ' +
        'Even though mic is the last capture-init step, an early return would skip STT init below it.',
    );
    assert.ok(
      !/\bthrow\b/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch re-throws — skips STT init and broadcast.',
    );
  });

  it('7. Both catches null the wrapper (`this.systemAudioCapture = null` and `this.microphoneCapture = null`)', () => {
    const sysCatch = findCatchAfter(fnBody, /new\s+SystemAudioCapture\s*\(/);
    const micCatch = findCatchAfter(fnBody, /new\s+MicrophoneCapture\s*\(/);
    assert.ok(sysCatch && micCatch, 'both construction catches must exist');
    assert.ok(
      /this\.systemAudioCapture\s*=\s*null/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch does not null `this.systemAudioCapture`. ' +
        'Without this, a partially-constructed instance (or a stale assignment from a prior attempt) ' +
        'survives the catch and downstream null-guards (`if (!this.systemAudioCapture)`) misfire.',
    );
    assert.ok(
      /this\.microphoneCapture\s*=\s*null/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch does not null `this.microphoneCapture`. ' +
        'Same hazard as above — stale wrapper state defeats the downstream existence guards.',
    );
  });

  it('8. Both catches use terminal payload shape (`attempt: 0, maxAttempts: 0`)', () => {
    const sysCatch = findCatchAfter(fnBody, /new\s+SystemAudioCapture\s*\(/);
    const micCatch = findCatchAfter(fnBody, /new\s+MicrophoneCapture\s*\(/);
    assert.ok(sysCatch && micCatch, 'both construction catches must exist');

    // Ctor failures are one-shot terminal events, not retry attempts.
    // `attempt: 0, maxAttempts: 0` is the contractual shape that
    // distinguishes them from in-flight recovery emissions
    // (attempt: N, maxAttempts: M where M > 0).
    assert.ok(
      /attempt\s*:\s*0/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch missing `attempt: 0`. ' +
        'Ctor failure is one-shot — non-zero attempt implies in-flight recovery, which is a category error here.',
    );
    assert.ok(
      /maxAttempts\s*:\s*0/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch missing `maxAttempts: 0`. See above.',
    );
    assert.ok(
      /attempt\s*:\s*0/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch missing `attempt: 0`.',
    );
    assert.ok(
      /maxAttempts\s*:\s*0/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch missing `maxAttempts: 0`.',
    );
  });
});
