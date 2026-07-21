// Regression test for the "endMeeting() returns while startMeeting()'s
// async audio init is still mid-await — racing the destroy paths" bug.
//
// Symptom: startMeeting() schedules its audio init via
// `setTimeout(async () => { … })` — a fire-and-forget IIFE whose
// promise nothing tracks. endMeeting() flips isMeetingActive=false and
// returns, but the init's `await this.reconfigureAudio(...)` is still
// running. Reconfigure constructs a fresh SystemAudioCapture /
// MicrophoneCapture and starts them — meanwhile endMeeting() has already
// scheduled destroy() on the OLD captures via setImmediate. Both the
// fresh and the dying instances grab the CoreAudio HAL property-listener
// lock at the same time, freezing the Electron main thread mid-paint.
//
// Fix:
//   1. startMeeting() now stores its async init body as
//      `this._audioInitPromise` and gates it on
//      `this._audioInitController.signal`.
//   2. The init body checks `audioInitSignal.aborted` in every existing
//      isCurrentMeeting() guard — those short-circuit when endMeeting
//      aborts.
//   3. endMeeting() calls `this._audioInitController.abort()` and AWAITS
//      `this._audioInitPromise` BEFORE the explicit watchdog disarm and
//      capture.stop() calls.
//
// Strategy: structural assertions against main.ts source. A behavioural
// test would require driving the full AppState through a fake meeting
// generation cycle with mocked captures / STT, which is a large fixture.
// The structural tests pin the load-bearing wiring so a future refactor
// that re-introduces the fire-and-forget pattern fails CI loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractMethodBody(methodName) {
  const re = new RegExp(`(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const m = re.exec(mainSource);
  assert.ok(m, `could not locate ${methodName} in main.ts`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return mainSource.slice(start, i - 1);
}

const startMeetingBody = extractMethodBody('startMeeting');
const endMeetingBody = extractMethodBody('endMeeting');

test('AppState declares _audioInitController and _audioInitPromise fields', () => {
  assert.ok(
    /private\s+_audioInitController\s*:\s*AbortController\s*\|\s*null\s*=\s*null/.test(mainSource),
    'BUG: AppState must declare `private _audioInitController: AbortController | null = null;` to track the in-flight audio init for endMeeting abort.',
  );
  assert.ok(
    /private\s+_audioInitPromise\s*:\s*Promise<void>\s*\|\s*null\s*=\s*null/.test(mainSource),
    'BUG: AppState must declare `private _audioInitPromise: Promise<void> | null = null;` so endMeeting can await the in-flight init.',
  );
});

test('startMeeting wraps the async audio init in this._audioInitPromise + AbortController', () => {
  assert.ok(
    /this\._audioInitController\s*=\s*audioInitController/.test(startMeetingBody),
    'BUG: startMeeting must assign a fresh AbortController to this._audioInitController so endMeeting has a handle to call abort() on.',
  );
  assert.ok(
    /this\._audioInitPromise\s*=\s*\(\s*async\s*\(\s*\)\s*=>\s*\{/.test(startMeetingBody),
    'BUG: startMeeting must wrap the async audio init body in an IIFE assigned to this._audioInitPromise. The old fire-and-forget `setTimeout(async () => { … }, 0)` cannot be awaited by endMeeting.',
  );
});

test('audio init isCurrentMeeting() includes !audioInitSignal.aborted', () => {
  assert.ok(
    /isCurrentMeeting\s*=\s*\(\s*\)\s*=>\s*this\.isMeetingActive\s*&&\s*this\._meetingGeneration\s*===\s*meetingGeneration\s*&&\s*!\s*audioInitSignal\.aborted/.test(startMeetingBody),
    'BUG: isCurrentMeeting() inside the audio init body must also check `!audioInitSignal.aborted` so endMeeting()-driven aborts short-circuit each isCurrentMeeting() guard.',
  );
});

test('audio init body has a finally that clears _audioInitController', () => {
  assert.ok(
    /finally\s*\{[\s\S]*?if\s*\(\s*this\._audioInitController\s*===\s*audioInitController\s*\)\s*\{[\s\S]*?this\._audioInitController\s*=\s*null/.test(startMeetingBody),
    'BUG: the audio init IIFE must include a finally that nulls this._audioInitController (with a strict reference check to avoid clobbering a newer init).',
  );
});

test('endMeeting aborts and awaits this._audioInitPromise BEFORE touching captures', () => {
  const abortIdx = endMeetingBody.search(/this\._audioInitController[\s\S]{0,40}\.abort\s*\(\s*\)/);
  const awaitIdx = endMeetingBody.search(/await\s+this\._audioInitPromise/);
  const disarmIdx = endMeetingBody.search(/__disarmStuckWatchdog/);
  // Capture teardown is now a snapshot-then-destroy: the live wrapper is
  // nulled synchronously and torn down via destroy() (see the second-meeting
  // freeze fix). The load-bearing ordering invariant is unchanged — this must
  // happen AFTER the _audioInitPromise await.
  const capStopIdx = endMeetingBody.search(/dyingSystemCapture\?\.\s*destroy\s*\(\s*\)/);

  assert.ok(abortIdx >= 0, 'BUG: endMeeting must call this._audioInitController.abort() to cancel the in-flight init.');
  assert.ok(awaitIdx >= 0, 'BUG: endMeeting must `await this._audioInitPromise` so the init body finishes (or its abort cleanup runs) before destroy.');
  assert.ok(disarmIdx >= 0, 'sanity: endMeeting must call __disarmStuckWatchdog later in the flow');
  assert.ok(capStopIdx >= 0, 'sanity: endMeeting must tear down systemAudioCapture (dyingSystemCapture?.destroy()) later in the flow');

  assert.ok(
    abortIdx < awaitIdx,
    'BUG: endMeeting must call abort() BEFORE the await — otherwise the await blocks indefinitely on a still-running init.',
  );
  assert.ok(
    awaitIdx < disarmIdx,
    'BUG: endMeeting must await this._audioInitPromise BEFORE the watchdog disarm — otherwise the init body can arm a fresh watchdog AFTER the disarm.',
  );
  assert.ok(
    awaitIdx < capStopIdx,
    'BUG: endMeeting must await this._audioInitPromise BEFORE tearing down the captures — otherwise the init body can construct a fresh capture AFTER teardown, leaving a dangling native handle.',
  );
});

test('endMeeting clears this._audioInitPromise after awaiting it', () => {
  // Look for: `await this._audioInitPromise` followed (later in the
  // method) by `this._audioInitPromise = null`. Allow the comment block
  // about expected abort errors between them.
  const awaitIdx = endMeetingBody.search(/await\s+this\._audioInitPromise/);
  const nullIdx  = endMeetingBody.search(/this\._audioInitPromise\s*=\s*null/);
  assert.ok(awaitIdx >= 0, 'sanity: endMeeting awaits this._audioInitPromise');
  assert.ok(
    nullIdx >= 0 && nullIdx > awaitIdx,
    'BUG: endMeeting must null this._audioInitPromise AFTER awaiting it (so the next meeting cycle starts with a clean slate).',
  );
});

test('audio init catch silences expected audio_init_aborted errors', () => {
  // The init body re-throws `audio_init_aborted` on signal-aborted; the
  // outer catch must NOT broadcast it as a real meeting-audio-error (that
  // would surface a misleading "Audio pipeline failed" banner to the user
  // for a Stop click they made themselves).
  assert.ok(
    /isAbort\s*=\s*\(err as Error\)\?\.message\s*===\s*['"]audio_init_aborted['"]/.test(startMeetingBody),
    'BUG: the init body\'s catch must recognise the `audio_init_aborted` sentinel and skip the meeting-audio-error broadcast.',
  );
  assert.ok(
    /if\s*\(\s*!isAbort\s*\)\s*\{[\s\S]*?broadcast\s*\(\s*['"]meeting-audio-error['"]/.test(startMeetingBody),
    'BUG: the meeting-audio-error broadcast must be gated on !isAbort.',
  );
});
