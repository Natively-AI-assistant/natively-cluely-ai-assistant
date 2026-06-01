import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractMethodBody(methodName) {
  const methodRe = new RegExp(`public\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)[^{]*\\{`);
  const match = methodRe.exec(mainSource);
  assert.ok(match, `could not locate ${methodName}`);
  let i = match.index + match[0].length;
  let depth = 1;
  const start = i;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces while extracting ${methodName}`);
  return mainSource.slice(start, i - 1);
}

const startMeetingBody = extractMethodBody('startMeeting');
const endMeetingBody = extractMethodBody('endMeeting');

test('meeting start captures a generation token and endMeeting invalidates it', () => {
  assert.ok(
    /private\s+_meetingGeneration\s*=\s*0/.test(mainSource),
    'BUG: AppState must track a meeting generation token for async start/stop race guards.',
  );
  assert.ok(
    /const\s+meetingGeneration\s*=\s*\+\+this\._meetingGeneration;[\s\S]*this\.isMeetingActive\s*=\s*true/.test(startMeetingBody),
    'BUG: startMeeting must increment and capture _meetingGeneration before the meeting becomes active.',
  );
  assert.ok(
    /this\.isMeetingActive\s*=\s*false;[\s\S]*this\._meetingGeneration\+\+/.test(endMeetingBody),
    'BUG: endMeeting must invalidate in-flight deferred audio init by incrementing _meetingGeneration.',
  );
});

test('deferred audio init aborts and destroys stale captures after awaited setup', () => {
  // Anchor on the new audio-init IIFE introduced in Issue 11. The previous
  // shape was `setTimeout(async () => { … }, 0)` (fire-and-forget). The
  // current shape is `this._audioInitPromise = (async () => { … })()` so
  // endMeeting can abort + await it.
  const newAnchor = startMeetingBody.indexOf('this._audioInitPromise = (async () => {');
  const oldAnchor = startMeetingBody.indexOf('setTimeout(async () => {');
  const timeoutIndex = newAnchor >= 0 ? newAnchor : oldAnchor;
  assert.ok(timeoutIndex >= 0, 'could not locate deferred audio init IIFE (looked for both the new this._audioInitPromise shape and the old setTimeout(async) shape)');
  const deferredInit = startMeetingBody.slice(timeoutIndex);

  assert.ok(
    /const\s+isCurrentMeeting\s*=\s*\(\)\s*=>\s*this\.isMeetingActive\s*&&\s*this\._meetingGeneration\s*===\s*meetingGeneration/.test(deferredInit),
    'BUG: deferred audio init must verify both isMeetingActive and the captured meetingGeneration.',
  );
  assert.ok(
    /let\s+systemCaptureOwnedByInit\s*=\s*this\.systemAudioCapture/.test(deferredInit) &&
      /let\s+microphoneCaptureOwnedByInit\s*=\s*this\.microphoneCapture/.test(deferredInit),
    'BUG: deferred audio init must track capture references owned by this init path.',
  );
  assert.ok(
    /if\s*\(\s*this\.systemAudioCapture\s*===\s*systemCaptureOwnedByInit\s*\)\s*\{[\s\S]*this\.systemAudioCapture\?\.destroy\s*\(\s*\)[\s\S]*this\.systemAudioCapture\s*=\s*null[\s\S]*if\s*\(\s*this\.microphoneCapture\s*===\s*microphoneCaptureOwnedByInit\s*\)\s*\{[\s\S]*this\.microphoneCapture\?\.destroy\s*\(\s*\)[\s\S]*this\.microphoneCapture\s*=\s*null/.test(deferredInit),
    'BUG: stale deferred audio init must destroy only captures still owned by this stale init path.',
  );
  assert.ok(
    /let\s+systemSttStartedByInit\s*=\s*false/.test(deferredInit) &&
      /let\s+userSttStartedByInit\s*=\s*false/.test(deferredInit) &&
      /let\s+liveIndexingStartedByInit\s*=\s*false/.test(deferredInit),
    'BUG: deferred audio init must track whether this init path started STT/RAG work.',
  );
  assert.ok(
    /if\s*\(\s*systemSttStartedByInit\s*\)\s*\{[\s\S]*this\.googleSTT\?\.stop\s*\(\s*\)/.test(deferredInit) &&
      /if\s*\(\s*userSttStartedByInit\s*\)\s*\{[\s\S]*this\.googleSTT_User\?\.stop\s*\(\s*\)/.test(deferredInit) &&
      /if\s*\(\s*liveIndexingStartedByInit\s*\)\s*\{[\s\S]*this\.ragManager\?\.stopLiveIndexing\?\.\(\s*\)/.test(deferredInit),
    'BUG: stale deferred audio init must not stop STT/RAG work unless this stale init started it.',
  );
  assert.ok(
    /this\.googleSTT\?\.start\s*\(\s*\);[\s\S]*systemSttStartedByInit\s*=\s*true/.test(deferredInit) &&
      /this\.googleSTT_User\?\.start\s*\(\s*\);[\s\S]*userSttStartedByInit\s*=\s*true/.test(deferredInit) &&
      /this\.ragManager\.startLiveIndexing\s*\([^)]*\);[\s\S]*liveIndexingStartedByInit\s*=\s*true/.test(deferredInit),
    'BUG: deferred audio init must set STT/RAG ownership flags immediately after starting those resources.',
  );
  assert.ok(
    /await\s+this\.reconfigureAudio\s*\([^)]*\);[\s\S]*systemCaptureOwnedByInit\s*=\s*this\.systemAudioCapture;[\s\S]*microphoneCaptureOwnedByInit\s*=\s*this\.microphoneCapture;[\s\S]*if\s*\(\s*!isCurrentMeeting\s*\(\s*\)\s*\)\s*\{[\s\S]*abortStaleAudioInit\s*\(\s*\);[\s\S]*return;[\s\S]*\}/.test(deferredInit),
    'BUG: deferred audio init must refresh owned capture refs and check generation immediately after reconfigureAudio resolves.',
  );
  assert.ok(
    /await\s+this\.setupSystemAudioPipeline\s*\(\s*\);[\s\S]*systemCaptureOwnedByInit\s*=\s*this\.systemAudioCapture;[\s\S]*microphoneCaptureOwnedByInit\s*=\s*this\.microphoneCapture;[\s\S]*if\s*\(\s*!isCurrentMeeting\s*\(\s*\)\s*\)\s*\{[\s\S]*abortStaleAudioInit\s*\(\s*\);[\s\S]*return;[\s\S]*\}/.test(deferredInit),
    'BUG: deferred audio init must refresh owned capture refs and check generation immediately after setupSystemAudioPipeline resolves.',
  );
  assert.ok(
    /this\.startDefaultOutputWatcher\s*\(\s*\)/.test(deferredInit),
    'sanity check: deferred init region should include default output watcher startup.',
  );
  assert.ok(
    deferredInit.indexOf('if (!isCurrentMeeting())') < deferredInit.indexOf('this.startDefaultOutputWatcher()'),
    'BUG: deferred audio init must re-check generation before starting the default output watcher.',
  );
});
