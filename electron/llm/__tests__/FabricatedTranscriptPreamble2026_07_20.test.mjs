/**
 * Regression for the fabricated-transcript-tag leak (campaign2 longsession,
 * iteration 52, 2026-07-19/20). The model echoes back a bracket-labeled
 * speaker line ("[INTERVIEWER]: ...", "[ME]: ...", "[ASSISTANT]: ...") as
 * if continuing the app's own live transcript-formatting convention (real
 * prompt formatting — see ipcHandlers.ts's `[ME]:`/`[INTERVIEWER]:`
 * transcript turns), instead of producing a plain spoken answer. Confirmed
 * live across 6 separate runs spanning the whole campaign (run-006 B13,
 * run-012 C10, run-028 A13, run-039 C8, run-044 A13/A17).
 *
 * stripFabricatedTranscriptPreamble removes leading fabricated-speaker
 * blocks when real content follows (with special handling for an
 * `[ASSISTANT]:` marker, which is where the real answer typically starts);
 * isFabricatedTranscriptOnly flags the case where the WHOLE answer is
 * fabricated dialogue with no real content, for isLeakedAnswerArtifact to
 * reject a regeneration that produces only this shape.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/answerPolish.js');
const { stripFabricatedTranscriptPreamble, isFabricatedTranscriptOnly, cleanAnswerArtifacts, isLeakedAnswerArtifact } = await import(pathToFileURL(modPath).href);

describe('stripFabricatedTranscriptPreamble — live repros', () => {
  test('run-044 A13 shape: fabricated [INTERVIEWER] re-quote then fabricated [ASSISTANT] wrapping the real answer', () => {
    const input = `[INTERVIEWER]: going back to what you said earlier about your most recent role, you mentioned replacing a legacy hadoop batch job with a streaming pipeline. what made that migration challenging?

[ASSISTANT]: The core challenge was correctness during the cutover. Hadoop gave us exactly-once batch semantics at file boundaries, and streaming never does that for free. We had to redesign idempotency at the consumer layer using a checkpointed offset store plus a dedup key in the events, so replaying a window didn't double-count transactions.

The second piece was operational trust. The batch job had run for six years, and the finance team had monthly close rituals built around it.`;
    const out = stripFabricatedTranscriptPreamble(input);
    assert.ok(out.startsWith('The core challenge was correctness'), 'both fabricated blocks removed, real answer kept intact');
    assert.doesNotMatch(out, /\[INTERVIEWER\]/);
    assert.doesNotMatch(out, /\[ASSISTANT\]/);
  });

  test('run-006 B13 shape: TWO consecutive fabricated [INTERVIEWER] re-quotes, real content follows', () => {
    const input = `[INTERVIEWER]: let's switch gears and look at some code on your screen.

[INTERVIEWER]: earlier you told me the model uses 8 attention heads with 64-dimensional projections each, walk me through why that specific split keeps computational cost similar to single-head attention.

That answer was correct on the mechanism but skipped the actual FLOPs comparison. Multi-head attention with h heads costs the same total FLOPs as single-head attention because the per-head multiplies scale down proportionally to h, and you do h of them.`;
    const out = stripFabricatedTranscriptPreamble(input);
    assert.ok(out.startsWith('That answer was correct'), 'both fabricated re-quotes removed');
    assert.doesNotMatch(out, /\[INTERVIEWER\]/);
  });

  test('run-044 A17 shape: fabricated internal-tag + multi-turn [ME]/[INTERVIEWER]/[ASSISTANT] exchange, real content follows', () => {
    const input = `[earlier_context note="the candidate's earlier turn is the most relevant grounding"]
[ME]: Levee is an open-source circuit-breaker library for Go with adaptive thresholds based on a rolling EWMA of error rates.
[INTERVIEWER]: Can you explain how its adaptive threshold works?
[ASSISTANT]: Most circuit breakers trip on a fixed error rate, like 50%. Levee keeps a rolling EWMA of error rates per dependency, then trips when the current rate deviates significantly from that baseline. The adaptive part is that the threshold tracks each dependency's natural error rate instead of using one global number.`;
    // The leading `[earlier_context ...]` line is NOT a bracket-bare-word
    // speaker label (it's a real prompt-structure-shaped tag, snake_case
    // with an attribute) — isLeakedInternalTagBlock's territory, not this
    // function's. This function only strips the [ME]/[INTERVIEWER]/
    // [ASSISTANT] bare-word labels that follow it.
    const out = stripFabricatedTranscriptPreamble(input);
    assert.ok(out.includes('Most circuit breakers trip'), 'real content survives');
  });

  test('run-012 C10 shape (whole-answer fabricated, no real content): left UNCHANGED by the strip function, not silently emptied', () => {
    const input = '[ASSISTANT]: what would you like help with?';
    assert.equal(stripFabricatedTranscriptPreamble(input), input);
  });

  test('a real answer that opens with a bracketed mid-sentence aside (not a leading speaker tag) is never touched', () => {
    const input = 'I owned the payments platform [after the 2022 reorg] and reduced reconciliation latency significantly.';
    assert.equal(stripFabricatedTranscriptPreamble(input), input);
  });

  test('a real answer opening with a bracketed citation reference (no colon) is never touched', () => {
    const input = '[1] This refers to the Stripe payments infrastructure I owned for three years.';
    assert.equal(stripFabricatedTranscriptPreamble(input), input);
  });

  test('a clean, unbracketed real answer is never touched', () => {
    const input = 'I owned the payments orchestration platform at Stripe, which sat between our internal services and the card networks.';
    assert.equal(stripFabricatedTranscriptPreamble(input), input);
  });

  test('a fabricated preamble whose remaining content is real but too short (<60 chars) is left UNCHANGED, not truncated to a fragment', () => {
    const input = '[INTERVIEWER]: tell me more.\n\nShort answer here.';
    assert.equal(stripFabricatedTranscriptPreamble(input), input);
  });
});

describe('isFabricatedTranscriptOnly — whole-answer detector', () => {
  test('run-012 C10 shape: flagged true (no real content after the label)', () => {
    assert.equal(isFabricatedTranscriptOnly('[ASSISTANT]: what would you like help with?'), true);
  });

  test('a fabricated re-quote followed by a real, substantive answer is flagged false', () => {
    const input = `[INTERVIEWER]: what made that migration challenging?

The core challenge was correctness during the cutover, since Hadoop gave us exactly-once batch semantics that streaming never provides for free.`;
    assert.equal(isFabricatedTranscriptOnly(input), false);
  });

  test('a real answer with no bracket at all is flagged false', () => {
    assert.equal(isFabricatedTranscriptOnly('I owned the payments platform at Stripe.'), false);
  });

  test('empty/blank input is flagged false', () => {
    assert.equal(isFabricatedTranscriptOnly(''), false);
    assert.equal(isFabricatedTranscriptOnly('   '), false);
  });
});

describe('isLeakedAnswerArtifact — fabricated-transcript-only integration', () => {
  test('a fabricated-transcript-only regeneration is rejected as a leaked artifact', () => {
    assert.equal(isLeakedAnswerArtifact('[ASSISTANT]: what would you like help with?'), true);
  });

  test('a real answer with a fabricated re-quote preamble is NOT flagged as a leaked artifact (cleanAnswerArtifacts handles that case, not rejection)', () => {
    const input = `[INTERVIEWER]: what made that migration challenging?

The core challenge was correctness during the cutover, since Hadoop gave us exactly-once batch semantics that streaming never provides for free.`;
    assert.equal(isLeakedAnswerArtifact(input), false);
  });
});

describe('cleanAnswerArtifacts — fabricated-transcript integration', () => {
  test('strips a fabricated [INTERVIEWER]/[ASSISTANT] wrapper and keeps the real answer', () => {
    const input = `[INTERVIEWER]: going back to what you said earlier, what made that migration challenging?

[ASSISTANT]: The core challenge was correctness during the cutover. We had to redesign idempotency at the consumer layer using a checkpointed offset store.`;
    const out = cleanAnswerArtifacts(input);
    assert.ok(out.startsWith('The core challenge was correctness'));
    assert.doesNotMatch(out, /\[INTERVIEWER\]/);
    assert.doesNotMatch(out, /\[ASSISTANT\]/);
  });

  test('a genuine coding-scaffold-fingerprinted answer with a fabricated preamble strips only the preamble, leaving the scaffold for the OTHER guard (hasUnrecoveredScaffoldContamination) to catch', () => {
    // Mirrors the real C8 repro's layered shape: this function's job is
    // narrowly scoped to the fabricated speaker-tag preamble only — it must
    // NOT also try to fix the coding-scaffold contamination underneath,
    // which is a separate guard's responsibility (electron/llm/AnswerValidator.ts).
    const input = `[INTERVIEWER]: let's cover the jd requirements, tell me about your Go depth.

## Approach
The interviewer is asking about Go depth specifically.

## Technique / Data Structure / Algorithm Used
No code or DSA question here.`;
    const out = cleanAnswerArtifacts(input);
    assert.doesNotMatch(out, /\[INTERVIEWER\]/);
    assert.match(out, /## Approach/, 'the scaffold itself is left for the sibling guard, not silently discarded here');
  });
});
