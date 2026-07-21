// Regression test for the "GoogleSTT orphan language-change timer
// resumes stream after endMeeting" bug.
//
// Symptom: GoogleSTT.setRecognitionLanguage() debounces 250ms before
// applying the language change and calling stop()+start() if the stream
// is active. If the user changed language right before clicking Stop,
// stop() flipped isActive=false and tore down the gRPC stream — but did
// NOT clear pendingLanguageChange. The orphan 250ms timer fired AFTER
// endMeeting, ran its body, found isStreaming/isActive=false, and
// skipped the restart. But the timer slot lived in libuv until it
// fired, AND the closed-over `key` could leak language alternates into
// the next session under specific scheduling.
//
// Fix: stop() now clearTimeout(pendingLanguageChange) and sets the
// field undefined.
//
// Strategy: structural assertion against GoogleSTT.ts source — verify
// stop() clears pendingLanguageChange before any further work that
// might race a new session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gPath = path.resolve(__dirname, '../../../electron/audio/GoogleSTT.ts');
const gSource = readFileSync(gPath, 'utf8');

function extractMethodBody(methodName) {
  const re = new RegExp(`(?:^|\\n)\\s*(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const m = re.exec(gSource);
  assert.ok(m, `could not locate ${methodName} declaration in GoogleSTT.ts`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < gSource.length && depth > 0) {
    const ch = gSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return gSource.slice(start, i - 1);
}

const stopBody = extractMethodBody('stop');

test('GoogleSTT.stop() clears pendingLanguageChange', () => {
  assert.ok(
    /clearTimeout\s*\(\s*this\.pendingLanguageChange\s*\)/.test(stopBody),
    'BUG: GoogleSTT.stop() must clearTimeout(this.pendingLanguageChange) to prevent the 250ms language-change debounce body from firing after endMeeting.',
  );
  assert.ok(
    /this\.pendingLanguageChange\s*=\s*undefined/.test(stopBody),
    'BUG: GoogleSTT.stop() must set this.pendingLanguageChange = undefined after clearing — otherwise the field still holds a stale Timeout reference that confuses future debounce logic (the next setRecognitionLanguage call would clearTimeout an already-cleared handle, which is harmless, but leaving the field set is a code smell that the next refactor will misread).',
  );
});

test('pendingLanguageChange cleanup happens BEFORE the gRPC stream teardown in stop()', () => {
  const clearIdx = stopBody.search(/clearTimeout\s*\(\s*this\.pendingLanguageChange\s*\)/);
  const streamEndIdx = stopBody.search(/this\.stream\.end\s*\(\s*\)/);
  assert.ok(clearIdx >= 0, 'sanity: clearTimeout call exists');
  assert.ok(streamEndIdx >= 0, 'sanity: stream.end() call exists');
  assert.ok(
    clearIdx < streamEndIdx,
    'BUG: clearTimeout(pendingLanguageChange) must run BEFORE this.stream.end() in stop(). Otherwise, on a future refactor where stream.end() can throw, the catch would short-circuit and leave the orphan timer alive.',
  );
});

test('proactiveRestartTimer is also cleared in stop() (sanity — should already exist)', () => {
  // Pin the existing related invariant to avoid accidental removal.
  assert.ok(
    /clearTimeout\s*\(\s*this\.proactiveRestartTimer\s*\)/.test(stopBody),
    'sanity: stop() must keep its existing proactiveRestartTimer clearTimeout — companion to the new pendingLanguageChange clear.',
  );
});
