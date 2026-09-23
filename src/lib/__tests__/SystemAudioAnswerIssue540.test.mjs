// src/lib/__tests__/SystemAudioAnswerIssue540.test.mjs
//
// Regression tests for Issue #540:
// [Bug]: macOS USB/Bluetooth system audio is captured by SCK but never triggers “What to answer?”
//
// 1. RollingTranscript: isNormal indicator must be active/true when interviewerChannel
//    is 'connected', even if microphoneChannel is still 'awaiting-audio' (e.g. user wearing headphones).
// 2. NativelyInterface handleAnswerNow: if no user mic speech was captured, it must fall back
//    to interviewer speech captured during recording or recent interviewer question from rollingTranscript
//    instead of failing with "No speech detected. Try speaking closer to your microphone."
// 3. NativelyInterface handleWhatToSay: forwards visible rollingTranscript interviewer request to
//    generateWhatToSay even when directAssist is false.
// 4. electron/main.ts finalizeMicSTT: flushes both user and interviewer STT providers if present.

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

describe('Issue #540: RollingTranscript readiness with headphone/system audio', () => {
  test('RollingTranscript.tsx isNormal allows interviewer connected while mic is awaiting-audio', () => {
    // The previous implementation had:
    //   const anyAwaitingAudio = intStatus === 'awaiting-audio' || micStatus === 'awaiting-audio';
    //   const isNormal = intStatus === 'connected' && micStatus === 'connected' && !anyAwaitingAudio;
    // which blocked the green indicator whenever mic was awaiting-audio.
    assert.doesNotMatch(
      rollingTranscriptSource,
      /const anyAwaitingAudio\s*=\s*intStatus === ['"]awaiting-audio['"] \|\| micStatus === ['"]awaiting-audio['"]/,
      'RollingTranscript must not block readiness just because one channel is awaiting-audio',
    );

    // Verify isNormal evaluates to true when interviewer is connected and mic is awaiting-audio
    assert.match(
      rollingTranscriptSource,
      /const isNormal\s*=\s*\(intStatus === ['"]connected['"]\s*\|\|\s*micStatus === ['"]connected['"]\)/,
      'isNormal must allow either channel to be connected',
    );
  });
});

describe('Issue #540: handleAnswerNow system audio fallback', () => {
  test('onNativeAudioTranscript tracks interviewer speech and wakes tail waiter during manual recording', () => {
    assert.match(
      interfaceSource,
      /interviewerRecordingInputRef/,
      'NativelyInterface must track interviewer audio arriving during manual recording',
    );
  });

  test('handleAnswerNow falls back to interviewer transcript when mic captured no speech', () => {
    const handleAnswerNowBlock = interfaceSource.slice(
      interfaceSource.indexOf('const handleAnswerNow = async () => {'),
      interfaceSource.indexOf('const selectSkill = useCallback'),
    );
    assert.match(
      handleAnswerNowBlock,
      /interviewerRecordingInputRef/,
      'handleAnswerNow must check interviewer speech captured during recording',
    );
    assert.match(
      handleAnswerNowBlock,
      /rollingTranscript/,
      'handleAnswerNow must check rollingTranscript when mic speech is empty',
    );
  });
});

describe('Issue #540: handleWhatToSay forwards rolling transcript to generateWhatToSay', () => {
  test('handleWhatToSay passes interviewerRequest to generateWhatToSay when directAssist is disabled', () => {
    const handleWhatToSayBlock = interfaceSource.slice(
      interfaceSource.indexOf('const handleWhatToSay = async (promptInstruction?: string | React.MouseEvent) => {'),
      interfaceSource.indexOf('const handleClarify = async () => {'),
    );
    assert.match(
      handleWhatToSayBlock,
      /generateWhatToSay\(\s*interviewerRequest/,
      'handleWhatToSay must forward interviewerRequest from rolling transcript to generateWhatToSay',
    );
  });
});

describe('Issue #540: main.ts finalizeMicSTT finalizes interviewer STT as well', () => {
  test('finalizeMicSTT checks both googleSTT_User and googleSTT (interviewer)', () => {
    const mainSourceUpdated = fs.readFileSync(
      path.resolve(root, 'electron/main.ts'),
      'utf8',
    );
    const finalizeBlock = mainSourceUpdated.slice(
      mainSourceUpdated.indexOf('public finalizeMicSTT(): { pending: boolean } {'),
      mainSourceUpdated.indexOf('public finalizeMicSTT(): { pending: boolean } {') + 500,
    );
    assert.match(
      finalizeBlock,
      /this\.googleSTT\?\.finalize/,
      'finalizeMicSTT must flush interviewer STT provider (this.googleSTT) if available',
    );
    assert.match(
      finalizeBlock,
      /this\.googleSTT_User\?\.finalize/,
      'finalizeMicSTT must flush user STT provider (this.googleSTT_User) if available',
    );
  });
});
