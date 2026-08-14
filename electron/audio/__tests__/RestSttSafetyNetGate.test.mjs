// Regression test for the "RestSTT keeps uploading audio to Whisper after
// the meeting has ended" bug.
//
// Symptom: RestSTT.flushAndUpload() had no isActive gate at entry. The
// `finally` block at the end re-enters flushAndUpload when flushPending
// was set during an in-flight upload. If stop() ran while an upload was
// in flight (common pattern: user clicks Stop just as the speech-ended
// callback fired), stop() set isActive=false + cleared safetyNetTimer +
// called flushAndUpload() (which queued flushPending=true because
// isUploading was still true). When the in-flight upload completed, its
// `finally` re-entered flushAndUpload — and there was no guard against
// proceeding. The function would then re-arm a fresh setInterval if any
// safetyNetTimer slot had become non-null in any race window, and most
// importantly it would upload another batch of audio to Whisper / Groq /
// ElevenLabs for the rest of the process lifetime.
//
// Fix: `if (!this.isActive) return;` at the very top of flushAndUpload.
// This:
//   - Blocks the upload-after-stop leak (no more REST POSTs).
//   - Prevents the re-arm setInterval from creating an orphaned safety-net
//     timer that nothing ever clears.
//   - Belt-and-braces: the re-arm block also has its own isActive check.
//
// Strategy: structural assertion against RestSTT.ts. Behavioural test is
// hard because flushAndUpload requires axios, multipart/form-data, and a
// fake HTTP server. Structural pins the invariant so a future refactor
// that splits flushAndUpload or removes the guard will fail loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const restPath = path.resolve(__dirname, '../../../electron/audio/RestSTT.ts');
const restSource = readFileSync(restPath, 'utf8');

function extractMethodBody(methodName) {
  // Match a method DECLARATION (not an invocation like `monitor?.stop()`).
  // Anchor on the access modifier so the prefix is mandatory.
  const re = new RegExp(`(?:^|\\n)\\s*(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const m = re.exec(restSource);
  assert.ok(m, `could not locate ${methodName} declaration in RestSTT.ts`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < restSource.length && depth > 0) {
    const ch = restSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return restSource.slice(start, i - 1);
}

const flushBody = extractMethodBody('flushAndUpload');

test('flushAndUpload guards on isActive at entry', () => {
  // First non-comment line of the body must be the isActive guard, or at
  // least appear BEFORE any other state mutation / heavy work. Easiest
  // robust check: the first `if (!this.isActive) return;` exists, and
  // it appears before any reference to `this.chunks` or `this.safetyNetTimer`.
  const guardIdx = flushBody.search(/if\s*\(\s*!\s*this\.isActive\s*\)\s*return/);
  assert.ok(
    guardIdx >= 0,
    'BUG: flushAndUpload must guard on `if (!this.isActive) return;` to prevent post-stop uploads and orphaned setInterval re-arms.',
  );

  const chunksIdx = flushBody.indexOf('this.chunks');
  const safetyNetIdx = flushBody.indexOf('this.safetyNetTimer');
  assert.ok(
    guardIdx < chunksIdx,
    'BUG: the isActive guard must appear BEFORE any reference to this.chunks — otherwise an inactive flush can still process buffered data.',
  );
  assert.ok(
    guardIdx < safetyNetIdx,
    'BUG: the isActive guard must appear BEFORE the re-arm block (this.safetyNetTimer = setInterval...) so a stopped instance cannot resurrect a fresh interval.',
  );
});

test('re-arm setInterval block is itself gated on this.isActive (defense in depth)', () => {
  // Even if a future caller invokes flushAndUpload from a path that bypasses
  // the entry guard, the re-arm block must not create a new setInterval on
  // an inactive instance.
  const reArmBlock = /if\s*\(\s*this\.safetyNetTimer\s*&&\s*this\.isActive\s*\)\s*\{[\s\S]*?clearInterval[\s\S]*?this\.safetyNetTimer\s*=\s*setInterval/;
  assert.ok(
    reArmBlock.test(flushBody),
    'BUG: the re-arm block must check `this.safetyNetTimer && this.isActive` so a flush from any path cannot resurrect the safety net on a stopped instance.',
  );
});

test('stop() clears safetyNetTimer before any further flush logic', () => {
  const stopBody = extractMethodBody('stop');
  const clearIdx = stopBody.search(/clearInterval\s*\(\s*this\.safetyNetTimer\s*\)/);
  const nullIdx  = stopBody.search(/this\.safetyNetTimer\s*=\s*null/);
  const finalFlushIdx = stopBody.search(/this\.flushAndUpload\s*\(\s*\)/);

  assert.ok(clearIdx >= 0, 'sanity: stop() must clearInterval the safetyNetTimer');
  assert.ok(nullIdx  >= 0, 'sanity: stop() must null safetyNetTimer after clearing');
  assert.ok(finalFlushIdx >= 0, 'sanity: stop() should still call flushAndUpload() to drain trailing audio');

  assert.ok(
    clearIdx < finalFlushIdx,
    'BUG: stop() must clear safetyNetTimer BEFORE the final flushAndUpload(); otherwise the final flush would re-arm a fresh interval against the stopping session.',
  );
});
