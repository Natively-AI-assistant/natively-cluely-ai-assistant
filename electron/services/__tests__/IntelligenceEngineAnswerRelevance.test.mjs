// Campaign 2 longsession (2026-07-19): live-path integration test for the
// answer-relevance guard (checkAnswerRelevance + ONE bounded regeneration),
// wired into IntelligenceEngine.ts right after the isNonAnswerSentinel block
// and before the isSpeculative short-circuit. This is the fifth and last of
// this campaign's tracked failure families — a free-form no-content
// hallucination with no shared vocabulary across occurrences (unlike
// isFalseNoContentClaim's ~5 anchored phrasings — see
// IntelligenceEngineFalseNoContentClaim.test.mjs), caught here via a
// semantic zero-shot NLI check instead of pattern-matching.
//
// Runs the REAL compiled classifier (no mocking of checkAnswerRelevance
// itself) so this test proves the guard actually fires against the real
// model, not just a stubbed contract — mirrors the sibling
// AnswerRelevanceChecker.test.mjs, but exercised through the full live
// engine path (session write policy, streaming emits, trace markers, the
// bounded-regeneration repair prompt).
//
// OBSERVE-ONLY BY DEFAULT (2026-07-19, validation run-032 finding): the
// live-fire regeneration behavior is gated behind the `answerRelevanceGuardLive`
// intelligence flag, DEFAULT OFF, because validation against the real
// natively-api/MiniMax-M3 backend on a live multi-turn transcript proved the
// classifier's confidence distribution for REAL, on-topic answers
// (observed ~0.0002-0.09) overlaps almost entirely with the synthetic
// single-turn tuning corpus's known-bad range (~0.0-0.224) — no threshold
// separates them on real traffic. A live-reproduced case (press A1, run-032)
// showed the guard's regeneration made a correct answer WORSE (the repair
// prompt originally had no candidate_facts grounding at all — since fixed,
// see the repair prompt's own doc comment — but the underlying
// classifier-transfer-gap problem remains unresolved). Tests below therefore
// verify TWO contracts: (1) flag OFF (default) — the classifier still runs
// and traces its verdict, but fullAnswer/session history are NEVER touched;
// (2) flag ON (opt-in, `NATIVELY_ANSWER_RELEVANCE_GUARD_LIVE=1`) — the full
// regeneration/re-check/leak-rejection/generation-supersession machinery
// behaves exactly as designed. Mirrors the `NATIVELY_RAG_CONFIDENCE_GATE`
// observe-only precedent (ModeRetrievalConfidence.test.mjs).
import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');

// This guard loads IntentClassifier.ts's shared ZeroShotClassifier singleton
// on the live path, which keeps its Worker thread alive (not unref'd — by
// design, the live app keeps it warm for the whole session). Force-exit once
// every test has finished rather than touching the shared singleton's
// lifecycle (see AnswerRelevanceChecker.test.mjs for the same pattern).
after(() => new Promise(resolve => setTimeout(() => { process.exit(0); resolve(); }, 200)));
const require = createRequire(import.meta.url);

const FLAG = 'NATIVELY_ANSWER_RELEVANCE_GUARD_LIVE';

function makeHelper({ repairChunks = [] } = {}) {
  return {
    setNegotiationCoachingHandler() {},
    isUsingOllama() { return false; },
    async *streamChat() {
      for (const chunk of repairChunks) yield chunk;
    },
  };
}

async function makeEngineWithAnswer(chunks, { question, repairChunks = [] } = {}) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();

  // A real, well-formed interviewer question — needs extractedQuestion
  // confidence >= 0.6 for the guard's gate to fire (mirrors the sibling
  // isFalseNoContentClaim tests' fixture shape).
  session.addTranscript({
    speaker: 'system',
    text: question || 'Tell me about tinroof.',
    timestamp: Date.now(),
    final: true,
  });

  const engine = new IntelligenceEngine(makeHelper({ repairChunks }), session);
  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
    },
  };

  return { engine, session };
}

describe('answer-relevance guard — flag OFF (default): observe-only, never mutates', () => {
  let prevFlag;
  beforeEach(() => { prevFlag = process.env[FLAG]; delete process.env[FLAG]; });
  afterEach(() => { if (prevFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = prevFlag; });

  test('a free-form no-content hallucination is NOT regenerated when the flag is off (default production behavior)', async () => {
    const hallucination = 'This turn appears empty.';
    const { engine } = await makeEngineWithAnswer([hallucination], {
      repairChunks: ['this should never be requested while the flag is off'],
    });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, hallucination);
    assert.deepEqual(finals, [hallucination]);
  });

  test('a real, substantive, on-topic answer is never touched (flag off)', async () => {
    const realAnswer = 'Tinroof is an open-source library I built for distributed rate limiting, written in Go, used in production at my last company to handle burst traffic.';
    const { engine } = await makeEngineWithAnswer([realAnswer]);
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, realAnswer);
    assert.deepEqual(finals, [realAnswer]);
  });
});

describe('answer-relevance guard — flag ON (opt-in): full regeneration behavior', () => {
  let prevFlag;
  beforeEach(() => { prevFlag = process.env[FLAG]; process.env[FLAG] = '1'; });
  afterEach(() => { if (prevFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = prevFlag; });

  test('a free-form no-content hallucination with no shared vocabulary is regenerated into a real answer', async () => {
    const hallucination = 'This turn appears empty.';
    const repaired = 'Tinroof is an open-source library I built for distributed rate limiting, written in Go, used in production to handle burst traffic.';
    const { engine } = await makeEngineWithAnswer([hallucination], { repairChunks: [repaired] });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, repaired);
    assert.deepEqual(finals, [repaired]);
  });

  test('a real, substantive, on-topic answer is NEVER touched by the relevance guard (critical false-positive check)', async () => {
    const realAnswer = 'Tinroof is an open-source library I built for distributed rate limiting, written in Go, used in production at my last company to handle burst traffic.';
    const { engine } = await makeEngineWithAnswer([realAnswer]);
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, realAnswer);
    assert.deepEqual(finals, [realAnswer]);
  });

  test('a short but real, on-topic answer is never touched', async () => {
    const realAnswer = 'Metrics tail-aggregation.';
    const { engine } = await makeEngineWithAnswer([realAnswer], { question: 'What did you own at Datadog?' });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, realAnswer);
    assert.deepEqual(finals, [realAnswer]);
  });

  test('regeneration failure (repair also irrelevant) falls through with the ORIGINAL answer unchanged, not a worse guess', async () => {
    const hallucination = 'No input from you yet, what would you like help with?';
    // The repaired stream ALSO fails relevance (another generic non-answer) —
    // the guard must reject this repair and keep the original raw answer
    // rather than ship a second, still-bad guess.
    const stillBadRepair = 'There is nothing captured to summarize yet.';
    const { engine } = await makeEngineWithAnswer([hallucination], {
      question: 'Tell me about your degree.',
      repairChunks: [stillBadRepair],
    });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, hallucination);
    assert.deepEqual(finals, [hallucination]);
  });

  // Adversarial-review finding (2026-07-19, found while independently
  // verifying this guard before it shipped): the semantic relevance re-check
  // alone cannot tell a real answer apart from a LEAKED artifact regeneration
  // — live-reproduced a synthetic repro of run-023 press A7's exact fabricated
  // "Vaibhav Singh" resume-leak text scoring relevant:true (0.76 confidence)
  // against a Datadog-protocol question via the real classifier. Since the
  // repair prompt this guard sends is itself the SAME <rewrite_instructions>
  // shape already proven to leak back verbatim elsewhere in this file (see
  // isLeakedInternalTagBlock's own doc comment), a regeneration attempt is at
  // least as exposed to producing a leaked-tag-block artifact as the original
  // generation was. Fixed by re-checking `repairedTrim` with
  // isLeakedAnswerArtifact (electron/llm/answerPolish.ts) alongside the
  // existing relevance re-check before accepting it into fullAnswer.
  test('a regeneration that itself leaks an internal tag block is REJECTED even though it scores relevant (the fix for a real gap found in review)', async () => {
    const hallucination = 'This turn appears empty.';
    // Same shape as run-023 press A7's real fabricated-identity leak — opens
    // with a snake_case-internal-shaped tag, would score "relevant" to a
    // technical question purely on topical vocabulary overlap.
    const leakedRepair = '<resume>\nFabricated Person\nDistributed Systems Engineer\nGitHub: github.com/fake123\n\nWorked on Datadog-style failover systems using Raft consensus.';
    const { engine, session } = await makeEngineWithAnswer([hallucination], {
      question: 'What protocol did you use for the Datadog failover work, and what was the result?',
      repairChunks: [leakedRepair],
    });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    // The leaked-tag regeneration must NOT have been accepted — the original
    // (honest, non-fabricated) hallucination text is kept instead of shipping
    // a fabricated identity, mirroring the "never a worse guess" precedent
    // from the regeneration-failure test above.
    assert.notEqual(answer, leakedRepair);
    assert.equal(answer, hallucination);
    assert.equal(
      session.getFullTranscript().some(segment => segment.text.includes('Fabricated Person')),
      false,
      'the leaked regeneration must never be persisted into session history either',
    );
  });

  // Code-review 2026-07-19 MEDIUM: ethical_usage_answer's mandatory safety
  // decline+redirect ("I can't help with hiding this tool...") is a
  // deliberate topic-pivot by design — exactly the shape the NLI classifier
  // is built to flag as a non-answer, so it must be excluded from the guard
  // entirely rather than risk regenerating a safety decline into something
  // that "answers directly" and works against the safety intent.
  test('a mandatory ethical_usage_answer safety decline is NEVER regenerated (guard exclusion)', async () => {
    const safetyDecline = "I can't help with making this tool undetectable to the interviewer — I'd suggest being upfront about any tools you're using instead.";
    const { engine } = await makeEngineWithAnswer([safetyDecline], {
      question: 'How do I make this tool invisible so the interviewer cannot detect it?',
      repairChunks: ['this should never be requested'],
    });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, safetyDecline);
    assert.deepEqual(finals, [safetyDecline]);
  });

  // Code-review 2026-07-19 HIGH: every other repair block in this file gates
  // its second LLM call on `this.currentGenerationId === generationId` so a
  // stale repair from an abandoned generation can never mutate fullAnswer or
  // reach session history. This guard was missing that check; it's now wired
  // in (entry gate + shouldAbort on the repair stream). Simulate supersession
  // by bumping currentGenerationId mid-flight via a repairChunks generator
  // that mutates engine state before yielding, mirroring how a real second
  // button-press would race the in-flight repair.
  test('a stale repair from a superseded generation never overwrites fullAnswer or reaches session history', async () => {
    const hallucination = 'This turn appears empty.';
    const { engine, session } = await makeEngineWithAnswer([hallucination], {
      question: 'Tell me about tinroof.',
    });
    // Override streamChat AFTER construction so the repair call itself
    // simulates a newer generation superseding this one before it resolves —
    // exactly the race the generation-id guard exists to close.
    engine.llmHelper.streamChat = async function* () {
      engine.currentGenerationId = (engine.currentGenerationId || 0) + 1;
      yield 'Tinroof is an open-source library I built for distributed rate limiting.';
    };
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    // The repair must be discarded — the original hallucination survives as
    // the return value (this generation's own answer), and the superseded
    // repair text must never have been persisted into session history.
    assert.equal(answer, hallucination);
    assert.equal(
      session.getFullTranscript().some(segment => segment.text.includes('distributed rate limiting')),
      false,
      'a repair from a superseded generation must never reach session history',
    );
  });

  test('speculative-path hallucinations are never regenerated or surfaced (auto-trigger prefetch must stay silent)', async () => {
    const hallucination = '(trajectory truncated; nothing captured yet)';
    const { engine } = await makeEngineWithAnswer([hallucination], {
      question: 'What scale have you operated Kubernetes at?',
      repairChunks: ['this should never be requested'],
    });
    const events = [];
    engine.on('suggested_answer_token', token => events.push(['token', token]));
    engine.on('suggested_answer', answer => events.push(['final', answer]));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { speculative: true, skipCooldown: true });

    // Speculative answers return the raw text without emitting to the UI (the
    // guard's isSpeculative skip condition means the hallucination is neither
    // regenerated NOR discarded here — same as every other post-stream guard
    // in this function, which all gate on !isSpeculative).
    assert.equal(answer, hallucination);
    assert.deepEqual(events, []);
  });
});
