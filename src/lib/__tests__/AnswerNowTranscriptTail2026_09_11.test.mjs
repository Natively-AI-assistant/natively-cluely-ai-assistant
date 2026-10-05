// src/lib/__tests__/AnswerNowTranscriptTail2026_09_11.test.mjs
//
// Live-reproduced 2026-09-11 (isolated profile, local parakeet STT, spoken
// audio through the speakers): pressing Answer → speaking a 1.8s question →
// pressing Stop the moment the speech ended produced
//   "⚠️ No speech detected. Try speaking closer to your microphone."
// while the main log showed the user's FINAL transcript ("what is a linked
// list", 21 chars) landing one line AFTER "[Main] Finalizing STT". Pressing
// Stop 4s after the speech captured and answered the same question.
//
// Root cause (src/components/NativelyInterface.tsx, handleAnswerNow):
//   1. `isRecordingRef.current = false` ran BEFORE the finalize wait, and the
//      onNativeAudioTranscript handler drops every user chunk while that ref is
//      false — so any transcript that arrived during the wait was discarded.
//   2. The wait itself was a fixed 750ms cap on an IPC that resolves
//      immediately (finalizeMicSTT is synchronous in main), not a wait for the
//      transcript. Cloud finals land 0.5–2s after speech ends; local models
//      1.5–7s (issue #540's log: moonshine p50 7160ms). Both lose the tail.
//
// Fix: a small event-driven waiter (answerTailWait.mjs) — the recording ref
// stays open until a FINAL user chunk lands or a bounded window elapses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTranscriptTailWaiter, TAIL_WAIT_MS, TAIL_GRACE_MS } from '../answerTailWait.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const interfaceSource = fs.readFileSync(
  path.resolve(dirname, '../../components/NativelyInterface.tsx'),
  'utf8',
);

function section(startMarker, endMarker) {
  const start = interfaceSource.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = interfaceSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return interfaceSource.slice(start, end);
}

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = nextId++; pending.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { pending.delete(id); },
    async advance(ms) {
      now += ms;
      for (const [id, t] of [...pending.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) { pending.delete(id); t.fn(); }
      }
      await Promise.resolve();
    },
    pendingCount: () => pending.size,
  };
}

test('nothing captured yet: waits the full tail window and resolves early on a final', async () => {
  const timers = fakeTimers();
  const waiter = createTranscriptTailWaiter(timers);
  let outcome = null;
  const p = waiter.wait({ hasCapturedFinal: false, hasPendingInterim: false }).then((r) => { outcome = r; });
  await timers.advance(TAIL_WAIT_MS - 1);
  assert.equal(outcome, null, 'must still be waiting inside the window');
  waiter.notifyFinal();
  await p;
  assert.equal(outcome, 'final');
  assert.equal(timers.pendingCount(), 0, 'the timeout must be cleared once a final lands');
});

test('nothing captured and nothing arrives: resolves timeout at the window edge', async () => {
  const timers = fakeTimers();
  const waiter = createTranscriptTailWaiter(timers);
  const p = waiter.wait({ hasCapturedFinal: false, hasPendingInterim: false });
  await timers.advance(TAIL_WAIT_MS);
  assert.equal(await p, 'timeout');
});

test('a final already captured with no interim pending: only a short grace, not the full window', async () => {
  const timers = fakeTimers();
  const waiter = createTranscriptTailWaiter(timers);
  const p = waiter.wait({ hasCapturedFinal: true, hasPendingInterim: false });
  await timers.advance(TAIL_GRACE_MS);
  assert.equal(await p, 'timeout');
  assert.ok(TAIL_GRACE_MS < TAIL_WAIT_MS);
});

test('an interim pending means speech is still in flight: full window even though a final exists', async () => {
  const timers = fakeTimers();
  const waiter = createTranscriptTailWaiter(timers);
  let outcome = null;
  waiter.wait({ hasCapturedFinal: true, hasPendingInterim: true }).then((r) => { outcome = r; });
  await timers.advance(TAIL_GRACE_MS + 1);
  assert.equal(outcome, null, 'grace alone must not end the wait while an interim is pending');
  await timers.advance(TAIL_WAIT_MS);
  assert.equal(outcome, 'timeout');
});

test('a final arriving after the window closed is a no-op for the stale waiter', async () => {
  const timers = fakeTimers();
  const waiter = createTranscriptTailWaiter(timers);
  const p = waiter.wait({ hasCapturedFinal: false, hasPendingInterim: false });
  await timers.advance(TAIL_WAIT_MS);
  assert.equal(await p, 'timeout');
  assert.doesNotThrow(() => waiter.notifyFinal());
});

test('source: handleAnswerNow keeps the recording ref open until the tail wait resolves', () => {
  const body = section('const handleAnswerNow = async () => {', 'const selectSkill = useCallback');
  const clearRef = body.indexOf('isRecordingRef.current = false');
  const tailWait = body.indexOf('answerTailWaiterRef.current!.wait(');
  assert.ok(tailWait >= 0, 'BUG: handleAnswerNow does not wait for the transcript tail');
  assert.ok(
    clearRef > tailWait,
    'BUG: the recording ref is cleared before the tail wait, so a user FINAL that lands after the Stop press is dropped → "No speech detected"',
  );
  // The snapshot of the captured text must happen after the ref is cleared, never before the wait.
  const snapshot = body.indexOf('const question = mergeTranscriptChunks(');
  assert.ok(snapshot > clearRef, 'the question snapshot must follow the tail wait');
  // The fixed 750ms cap on the IPC is fine; it must not be the ONLY wait.
  assert.match(body, /window\.electronAPI\.finalizeMicSTT\(\)/);
  // The button must keep reading "Stop" while the gate is open — flipping it
  // early created a window where a press was silently ignored.
  const flip = body.indexOf('setIsManualRecording(false)');
  assert.ok(flip > tailWait, 'setIsManualRecording(false) must follow the tail wait');
  // A local model's multi-second tail is selected by main's `pending` report,
  // not guessed from the interim preview alone.
  assert.match(body, /providerReportsPending/);
  assert.match(body, /hasPendingInterim: manualTranscriptRef\.current\.trim\(\)\.length > 0 \|\| providerReportsPending/);
});

test('source: a session reset clears the dictation refs, not only the React state', () => {
  const reset = section("window.electronAPI.onSessionReset(() => {", 'analytics.trackConversationStarted();');
  assert.match(reset, /voiceInputRef\.current = ''/, 'BUG: the merge reads voiceInputRef, so a stale ref prepends the previous meeting to the next question');
  assert.match(reset, /isRecordingRef\.current = false/);
  assert.match(reset, /answerStopInFlightRef\.current = false/);
});

test('source: the transcript handler wakes the tail waiter on a FINAL user chunk', () => {
  const handler = section(
    'window.electronAPI.onNativeAudioTranscript((transcript) => {',
    '// Ignore user mic transcripts when not recording',
  );
  const finalBranch = handler.indexOf('if (transcript.final) {');
  const wake = handler.indexOf('answerTailWaiterRef.current!.notifyFinal()');
  const partialBranch = handler.indexOf('} else {', finalBranch);
  assert.ok(finalBranch >= 0 && wake > finalBranch && wake < partialBranch,
    'BUG: notifyFinal must be called inside the final-transcript branch (never for partials)');
  // The ref must be written synchronously BEFORE the wake — a write inside the
  // setVoiceInput updater runs lazily on React's next render, after the woken
  // Stop press has already snapshotted the ref (live-reproduced: waiter resolved
  // 'final' with voice "").
  const finalBody = handler.slice(finalBranch, wake);
  const refWrite = finalBody.indexOf('voiceInputRef.current = updated');
  assert.ok(refWrite >= 0, 'BUG: the final branch must assign voiceInputRef.current');
  assert.doesNotMatch(finalBody, /setVoiceInput\(\(prev\)\s*=>/,
    'BUG: the merge must not live inside a lazy state updater');
  assert.match(finalBody, /const updated = mergeTranscriptChunks\(voiceInputRef\.current, transcript\.text\)/);
});

test('source: a new recording cannot start while the previous Stop is still collecting its tail', () => {
  const body = section('const handleAnswerNow = async () => {', 'const selectSkill = useCallback');
  const startBranch = body.slice(body.lastIndexOf('} else {'));
  assert.match(startBranch, /answerStopInFlightRef\.current/,
    'BUG: a second Answer press during the tail wait would reset voiceInput mid-snapshot');
});
