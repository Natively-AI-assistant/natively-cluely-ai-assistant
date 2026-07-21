// Regression test for the "false '0 chunks in 8s' warning after meeting end"
// bug.
//
// Symptom: the 8s stuck-capture watchdog inside wireSystemCapture and
// wireMicCapture used to be cleared ONLY by the capture's 'stop' event
// listener. That works today because MicrophoneCapture.stop /
// SystemAudioCapture.stop emit 'stop' synchronously before scheduling the
// deferred native teardown. But if a future refactor moves the emit into
// the setImmediate body (a reasonable change for ordering correctness with
// pre-warm), the watchdog would remain armed for another ~8s after the
// user hit Stop — at which point the timer would fire and broadcast the
// misleading "produced 0 chunks in 8s" UI banner for a capture the user
// already shut down. The body's own `!this.isMeetingActive` guard would
// catch it post-endMeeting, but abortStaleAudioInit() running BEFORE the
// meeting flag flips (during a cancellation that never made the meeting
// "active" to the user) is not covered by that guard.
//
// Fix: each wire* method now attaches a `__disarmStuckWatchdog` closure on
// the capture instance, and both endMeeting() and abortStaleAudioInit()
// call it explicitly — synchronously, before stop()/destroy() — so the
// watchdog cannot fire after either path. The capture.on('stop') listener
// still calls the same disarm function, which is fine: clearTimeout(null)
// is a no-op.
//
// Strategy: structural assertions against main.ts source. We pin three
// invariants:
//   1. wireSystemCapture attaches `__disarmStuckWatchdog` on the capture.
//   2. wireMicCapture attaches the same field.
//   3. endMeeting calls __disarmStuckWatchdog on both captures BEFORE the
//      stop() calls.
//   4. abortStaleAudioInit calls __disarmStuckWatchdog before destroy().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractMethodBody(methodName) {
  const methodRe = new RegExp(`(?:public|private)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)[^{]*\\{`);
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

const wireSystemBody = extractMethodBody('wireSystemCapture');
const wireMicBody    = extractMethodBody('wireMicCapture');
const endMeetingBody = extractMethodBody('endMeeting');
const startMeetingBody = extractMethodBody('startMeeting');

test('wireSystemCapture attaches __disarmStuckWatchdog on the capture instance', () => {
  assert.ok(
    /\(\s*capture\s+as\s+any\s*\)\.\s*__disarmStuckWatchdog\s*=\s*disarmStuckWatchdog/.test(wireSystemBody),
    'BUG: wireSystemCapture must expose a synchronous __disarmStuckWatchdog closure on the capture instance so endMeeting/abortStaleAudioInit can cancel the 8s watchdog without relying on the on("stop") event firing synchronously.',
  );
  assert.ok(
    /capture\.on\(\s*['"]stop['"]\s*,\s*disarmStuckWatchdog\s*\)/.test(wireSystemBody),
    'sanity: the on("stop") listener should also call the same disarm closure (so destroy paths that go through stop still clean up).',
  );
});

test('wireMicCapture attaches __disarmStuckWatchdog on the capture instance', () => {
  assert.ok(
    /\(\s*capture\s+as\s+any\s*\)\.\s*__disarmStuckWatchdog\s*=\s*disarmStuckWatchdog/.test(wireMicBody),
    'BUG: wireMicCapture must mirror wireSystemCapture — same __disarmStuckWatchdog mechanism on the mic capture instance.',
  );
  assert.ok(
    /capture\.on\(\s*['"]stop['"]\s*,\s*disarmStuckWatchdog\s*\)/.test(wireMicBody),
    'sanity: the mic capture on("stop") listener should also call the same disarm closure.',
  );
});

test('endMeeting disarms watchdogs BEFORE stopping captures', () => {
  const sysDisarmIdx = endMeetingBody.search(/\(\s*this\.systemAudioCapture\s+as\s+any\s*\)\?\.\s*__disarmStuckWatchdog\?\.\(\s*\)/);
  const micDisarmIdx = endMeetingBody.search(/\(\s*this\.microphoneCapture\s+as\s+any\s*\)\?\.\s*__disarmStuckWatchdog\?\.\(\s*\)/);
  // Capture teardown is now a snapshot-then-destroy (the live wrappers are
  // nulled synchronously and torn down via destroy(), which internally calls
  // stop()). The watchdog disarm must still precede that teardown.
  const sysStopIdx   = endMeetingBody.search(/dyingSystemCapture\?\.\s*destroy\s*\(\s*\)/);
  const micStopIdx   = endMeetingBody.search(/dyingMicrophoneCapture\?\.\s*destroy\s*\(\s*\)/);

  assert.ok(sysDisarmIdx >= 0, 'BUG: endMeeting() must call __disarmStuckWatchdog on systemAudioCapture.');
  assert.ok(micDisarmIdx >= 0, 'BUG: endMeeting() must call __disarmStuckWatchdog on microphoneCapture.');
  assert.ok(sysStopIdx >= 0, 'sanity: endMeeting() should still tear down the system capture (dyingSystemCapture?.destroy()).');
  assert.ok(micStopIdx >= 0, 'sanity: endMeeting() should still tear down the mic capture (dyingMicrophoneCapture?.destroy()).');

  assert.ok(
    sysDisarmIdx < sysStopIdx,
    'BUG: endMeeting() must disarm the system-audio watchdog BEFORE the capture teardown — ordering matters because destroy() schedules a deferred native teardown, and any future refactor that moves the on("stop") emit into that deferred body would leave the watchdog armed past Stop without this explicit disarm.',
  );
  assert.ok(
    micDisarmIdx < micStopIdx,
    'BUG: endMeeting() must disarm the mic watchdog BEFORE the capture teardown for the same ordering reason as the system path.',
  );
});

test('abortStaleAudioInit disarms watchdogs BEFORE destroy', () => {
  // abortStaleAudioInit is an inner closure inside startMeeting's deferred
  // init body. After Issue 4 it became async (returns Promise<void>) so it
  // can `await` destroy(). Match both shapes — sync `() =>` and async
  // `async (): Promise<void> =>` — so this test does not break the next
  // time the signature evolves.
  const abortStartRe = /const\s+abortStaleAudioInit\s*=\s*(?:async\s*)?\([^)]*\)(?:\s*:\s*Promise<void>)?\s*=>\s*\{/;
  const abortMatch = abortStartRe.exec(startMeetingBody);
  assert.ok(abortMatch, 'could not locate abortStaleAudioInit closure');
  const abortStart = abortMatch.index;
  // Walk braces to find the body bounds.
  let i = abortStart + abortMatch[0].length;
  let depth = 1;
  const bodyStart = i;
  while (i < startMeetingBody.length && depth > 0) {
    const ch = startMeetingBody[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  const abortBody = startMeetingBody.slice(bodyStart, i - 1);

  const sysDisarmIdx = abortBody.search(/\(\s*this\.systemAudioCapture\s+as\s+any\s*\)\?\.\s*__disarmStuckWatchdog\?\.\(\s*\)/);
  const micDisarmIdx = abortBody.search(/\(\s*this\.microphoneCapture\s+as\s+any\s*\)\?\.\s*__disarmStuckWatchdog\?\.\(\s*\)/);
  const sysDestroyIdx = abortBody.search(/this\.systemAudioCapture\?\.\s*destroy\s*\(\s*\)/);
  const micDestroyIdx = abortBody.search(/this\.microphoneCapture\?\.\s*destroy\s*\(\s*\)/);

  assert.ok(sysDisarmIdx >= 0, 'BUG: abortStaleAudioInit must call __disarmStuckWatchdog on systemAudioCapture.');
  assert.ok(micDisarmIdx >= 0, 'BUG: abortStaleAudioInit must call __disarmStuckWatchdog on microphoneCapture.');
  assert.ok(sysDestroyIdx >= 0, 'sanity: abortStaleAudioInit should call systemAudioCapture.destroy().');
  assert.ok(micDestroyIdx >= 0, 'sanity: abortStaleAudioInit should call microphoneCapture.destroy().');

  assert.ok(
    sysDisarmIdx < sysDestroyIdx,
    'BUG: abortStaleAudioInit must disarm the system watchdog BEFORE destroy() — destroy schedules deferred native teardown; the watchdog must be neutered synchronously.',
  );
  assert.ok(
    micDisarmIdx < micDestroyIdx,
    'BUG: abortStaleAudioInit must disarm the mic watchdog BEFORE destroy() for the same ordering reason.',
  );
});

test('stuck watchdog timer body still has __isMeetingActive__ defense-in-depth guard', () => {
  // Even after the explicit disarms, the in-timer guard is the last line of
  // defense against any orphan that slips past disarm (e.g. between arm and
  // the disarm call from endMeeting in a future code path). Pin both copies.
  assert.ok(
    /if\s*\(\s*!this\.isMeetingActive\s*\)\s*return;\s*\/\/ meeting ended/.test(wireSystemBody),
    'sanity: wireSystemCapture watchdog must keep the !isMeetingActive guard as defense in depth.',
  );
  assert.ok(
    /if\s*\(\s*!this\.isMeetingActive\s*\)\s*return;/.test(wireMicBody),
    'sanity: wireMicCapture watchdog must keep the !isMeetingActive guard as defense in depth.',
  );
});
