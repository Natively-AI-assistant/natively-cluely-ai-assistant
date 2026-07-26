// src/lib/__tests__/DoubledQuestionMergeRace2026_07_24.test.mjs
//
// Phase 3 (context-rebuild) live-repro test for docs/context-rebuild
// hypothesis #4 (00_BASELINE_AND_REPRODUCTION.md §3.6 "doubled question text
// artifact"): a client-side STT final/partial race in
// src/components/NativelyInterface.tsx (the voice-dictation "Answer Now"
// flow) produced the observed doubled-question artifact:
//
//   "What is a race condition? Show howWhat is a race condition? Show how
//   you would diagnose and prevent one in a concurrent backend service. you
//   would diagnose and prevent one in a concurrent backend service."
//   (NATIVELY_CONTEXT_SYSTEM_SIMPLIFICATION_PROMPT.md line 2521; the
//   duplication is confirmed to have happened BEFORE the model saw it,
//   because [SOURCE-ARBITER]'s own `questionSnippet` at line 1372 already
//   shows the same duplicated text — i.e. it's a client-side
//   input-construction artifact, not a model artifact.)
//
// Phase 6 Slice 0 item 2 fix: the two accumulation sites
// (NativelyInterface.tsx's onNativeAudioTranscript final-event handler and
// handleAnswerNow's submit-time join) now both call the SAME shared,
// overlap-aware merge helper — src/lib/transcriptMerge.mjs's
// mergeTranscriptChunks — instead of duplicating its arithmetic. This file
// therefore imports and exercises the REAL production module (no verbatim
// copy), unlike the pre-fix version of this file.
//
// Finding on the "both renderer flows" question (03_LIVE_REPRO_FINDINGS.md
// item 4's "bonus finding" that handleAnswerNow and handleManualSubmit both
// tag `surface: 'manual_chat'` on the same IPC channel): handleManualSubmit
// is driven entirely by `inputValue` (typed-input React state) and never
// reads `voiceInputRef`/`manualTranscriptRef` — confirmed by reading
// NativelyInterface.tsx's handleManualSubmit in full. It already has its own,
// separate exact-duplicate-resubmission guard (shouldDedupeManualSubmit,
// src/lib/overlaySubmitDedup.mjs), which addresses a different failure mode
// (re-submitting the identical text twice within a time window), not
// overlapping-STT-chunk merging. So this specific race is NOT shared across
// both renderer flows: handleManualSubmit has zero exposure to it. This is a
// finding, not a gap in this fix's coverage.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTranscriptChunks } from '../transcriptMerge.mjs';

const FULL_QUESTION =
  'What is a race condition? Show how you would diagnose and prevent one in a concurrent backend service.';

const OBSERVED_CORPUS_STRING =
  'What is a race condition? Show howWhat is a race condition? Show how you would diagnose and prevent one in a concurrent backend service. you would diagnose and prevent one in a concurrent backend service.';

describe('Phase 3 item 4 / Phase 6 Slice 0 item 2: doubled-question client-side merge race', () => {
  test('baseline: a single partial followed by one final produces the clean, undoubled question', () => {
    let voiceInput = '';
    const manualTranscript = '';
    voiceInput = mergeTranscriptChunks(voiceInput, FULL_QUESTION);
    const result = mergeTranscriptChunks(voiceInput, manualTranscript).trim();
    assert.equal(result, FULL_QUESTION);
  });

  test('double-final accumulation: an early sub-segment final followed by a corrected complete final no longer duplicates', () => {
    // Some streaming ASR backends emit an early, VAD-triggered "final" for a
    // sub-segment (a mid-utterance pause), then re-transcribe and emit a
    // SECOND, complete "final" for the whole utterance. The fixed
    // accumulator detects that the second final is a corrected, more-
    // complete rewrite starting the same way as the first, and REPLACES
    // rather than concatenates.
    let voiceInput = '';
    voiceInput = mergeTranscriptChunks(voiceInput, 'What is a race condition? Show how');
    voiceInput = mergeTranscriptChunks(voiceInput, FULL_QUESTION);
    assert.equal(voiceInput, FULL_QUESTION);
  });

  test('stale trailing partial: a final commits, then a leftover partial (user kept talking) is dropped, not appended', () => {
    // If the user's speech continues briefly after the utterance the app
    // treated as "final" but before Answer Now is clicked, manualTranscript
    // can hold a non-final tail fragment that duplicates words already
    // committed into voiceInput. The fixed submit-time join detects that
    // the leftover fragment is already present at the end of voiceInput and
    // drops it instead of appending it.
    const voiceInput = mergeTranscriptChunks('', FULL_QUESTION);
    const manualTranscript = 'you would diagnose and prevent one in a concurrent backend service.';
    const result = mergeTranscriptChunks(voiceInput, manualTranscript).trim();
    assert.equal(result, FULL_QUESTION);
  });

  test('combined double-final + stale-partial sequence now reproduces the observed corpus scenario with ZERO duplication', () => {
    // Chain both races in one event sequence: an early final, a corrected
    // full final, then a stale trailing partial left over at submit time.
    // Before the fix, this combined sequence produced the OBSERVED_CORPUS_STRING
    // (byte-exact modulo one separator character). After the fix, both
    // merge points independently collapse their overlap, so the end-to-end
    // result is the clean, undoubled question — not a near-miss of the bug.
    let voiceInput = '';
    voiceInput = mergeTranscriptChunks(voiceInput, 'What is a race condition? Show how');
    voiceInput = mergeTranscriptChunks(voiceInput, FULL_QUESTION);
    const manualTranscript = 'you would diagnose and prevent one in a concurrent backend service.';
    const result = mergeTranscriptChunks(voiceInput, manualTranscript).trim();

    assert.equal(result, FULL_QUESTION);
    assert.notEqual(result, OBSERVED_CORPUS_STRING);
  });

  test('genuinely new, non-overlapping speech still concatenates (no false-positive drop)', () => {
    let voiceInput = '';
    voiceInput = mergeTranscriptChunks(voiceInput, 'What is a race condition?');
    voiceInput = mergeTranscriptChunks(voiceInput, 'Show how you would diagnose one.');
    assert.equal(voiceInput, 'What is a race condition? Show how you would diagnose one.');
  });

  test('partial word-boundary overlap (tail of base repeats at head of addition) collapses once instead of duplicating', () => {
    const result = mergeTranscriptChunks(
      'the quick brown fox jumps over',
      'jumps over the lazy dog',
    );
    assert.equal(result, 'the quick brown fox jumps over the lazy dog');
  });
});
