// src/lib/__tests__/SystemAudioAnswerIssue540.test.mjs
//
// Regression tests for Issue #540:
// [Bug]: macOS USB/Bluetooth system audio is captured by SCK but never triggers “What to answer?”
//
// 1. RollingTranscript: isNormal indicator must be active/true when interviewerChannel
//    is 'connected', even if microphoneChannel is still 'awaiting-audio' (e.g. user wearing headphones).
// 2. handleAnswerNow: a healthy but silent mic hands off to What to Answer (main's
//    speaker-labelled transcript) instead of "No speech detected". A failed or
//    reconnecting mic keeps its diagnostic.
// 3. Only USER chunks may wake the Answer/Stop tail waiter (AnswerNowTranscriptTail2026_09_11):
//    an interviewer final landing first closed the gate and truncated or replaced the
//    dictated question.
// 4. handleWhatToSay's legacy path keeps passing `undefined`: main extracts the question.
//    A rolling-bar blob as `question` skipped the user-asked-last repair and follow-up
//    resolution, and became the retrieval query.
// 5. electron/main.ts finalizeMicSTT flushes ONLY the user mic.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '../../..');

const rollingTranscriptSource = fs.readFileSync(
  path.resolve(root, 'src/components/ui/RollingTranscript.tsx'),
  'utf8',
);
const interfaceSource = fs.readFileSync(
  path.resolve(root, 'src/components/NativelyInterface.tsx'),
  'utf8',
);
const mainSource = fs.readFileSync(
  path.resolve(root, 'electron/main.ts'),
  'utf8',
);

// Slice [start, end) and fail loudly when a marker moves, so a renamed anchor
// cannot turn these guards into vacuous passes.
function between(source, startMarker, endMarker) {
  const from = source.indexOf(startMarker);
  assert.ok(from >= 0, `marker not found: ${startMarker}`);
  const to = source.indexOf(endMarker, from + startMarker.length);
  assert.ok(to > from, `end marker not found after start: ${endMarker}`);
  return source.slice(from, to);
}

describe('Issue #540: RollingTranscript readiness with headphone/system audio', () => {
  test('RollingTranscript.tsx isNormal allows interviewer connected while mic is awaiting-audio', () => {
    assert.doesNotMatch(
      rollingTranscriptSource,
      /const anyAwaitingAudio\s*=\s*intStatus === ['"]awaiting-audio['"] \|\| micStatus === ['"]awaiting-audio['"]/,
      'RollingTranscript must not block readiness just because one channel is awaiting-audio',
    );
    assert.match(
      rollingTranscriptSource,
      /const isNormal\s*=\s*\(intStatus === ['"]connected['"]\s*\|\|\s*micStatus === ['"]connected['"]\)/,
      'isNormal must allow either channel to be connected',
    );
  });
});

describe('Issue #540: a silent mic on Answer/Stop hands off to What to Answer', () => {
  const handleAnswerNowBlock = between(
    interfaceSource,
    'const handleAnswerNow = async () => {',
    'const selectSkill = useCallback',
  );
  const emptyBranch = between(
    handleAnswerNowBlock,
    'if (!question && currentAttachments.length === 0) {',
    'const userMessageId = genMessageId();',
  );

  test('the question still comes from the user mic only', () => {
    assert.match(
      handleAnswerNowBlock,
      /const question = mergeTranscriptChunks\(\s*voiceInputRef\.current,\s*manualTranscriptRef\.current,\s*\)\.trim\(\);/,
    );
    assert.doesNotMatch(interfaceSource, /interviewerRecording/);
  });

  test('failed and reconnecting diagnostics come first, the handoff is the last branch', () => {
    const failedAt = emptyBranch.indexOf("sttUserStatus === 'failed'");
    const reconnectingAt = emptyBranch.indexOf("sttUserStatus === 'reconnecting'");
    const handoffAt = emptyBranch.indexOf('void handlersRef.current.handleWhatToSay();');
    assert.ok(failedAt >= 0 && reconnectingAt > failedAt, 'mic diagnostics are kept');
    assert.ok(handoffAt > reconnectingAt, 'the handoff runs only when the mic is healthy');
    assert.doesNotMatch(emptyBranch, /No speech detected/);
  });

  test('the handoff reads the latest handler and does not hold the Answer lock', () => {
    // A bare `handleWhatToSay()` here would be the Stop-press closure, captured
    // before the multi-second tail wait; `await` would keep 'answer_now' in flight
    // for the whole What to Answer generation.
    assert.doesNotMatch(emptyBranch, /await\s+handlersRef\.current\.handleWhatToSay/);
    assert.doesNotMatch(emptyBranch, /(?<!\.)\bhandleWhatToSay\(/);
  });
});

describe('Issue #540: only user chunks wake the Stop tail waiter', () => {
  test('notifyFinal is called once, from the user-recording branch', () => {
    const calls = interfaceSource.match(/answerTailWaiterRef\.current!\.notifyFinal\(\)/g) ?? [];
    assert.equal(calls.length, 1);
    const userBranch = between(
      interfaceSource,
      "if (isRecordingRef.current && transcript.speaker === 'user') {",
      '// Ignore user mic transcripts when not recording',
    );
    assert.match(userBranch, /answerTailWaiterRef\.current!\.notifyFinal\(\)/);
  });

  test('the Stop tail wait is sized by the user channel only', () => {
    const waitArgs = between(interfaceSource, 'await answerTailWaiterRef.current!.wait({', '});');
    assert.match(waitArgs, /hasCapturedFinal: voiceInputRef\.current\.trim\(\)\.length > 0,/);
    assert.doesNotMatch(waitArgs, /interviewer/i);
  });
});

describe('Issue #540: handleWhatToSay legacy path still lets main extract the question', () => {
  test('generateWhatToSay receives undefined, not a rolling-bar blob', () => {
    const runWhatToSayBlock = between(
      interfaceSource,
      'const runWhatToSay = async (promptInstruction?: string | React.MouseEvent) => {',
      'const handleWhatToSay = async',
    );
    assert.match(runWhatToSayBlock, /generateWhatToSay\(\s*undefined,/);
    assert.doesNotMatch(runWhatToSayBlock, /generateWhatToSay\(\s*interviewerRequest/);
  });
});

describe('Issue #540: main.ts finalizeMicSTT flushes the user mic only', () => {
  test('finalizeMicSTT never force-finalizes the interviewer channel', () => {
    const finalizeBlock = between(
      mainSource,
      'public finalizeMicSTT(): { pending: boolean } {',
      '\n  }\n',
    );
    assert.match(finalizeBlock, /this\.googleSTT_User\?\.finalize/);
    assert.doesNotMatch(finalizeBlock, /this\.googleSTT\??\.finalize/);
  });
});
