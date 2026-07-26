// Campaign 2 longsession run-039 script-a/c investigation (2026-07-19):
// live-path integration test for the unrecovered-scaffold-contamination
// fallback, wired into IntelligenceEngine.ts right after the existing
// detectAndExtractScaffoldMisfire block. Confirms the bounded regeneration
// actually reaches the user on the live WTA path, not just the pure
// hasUnrecoveredScaffoldContamination function (see
// electron/llm/__tests__/UnrecoveredScaffoldContamination_2026_07_19.test.mjs
// for those unit tests).
//
// Live repros A4/A5/C9 (see campaign2-log.md iteration 47) all carry the
// same coding-scaffold fingerprint detectAndExtractScaffoldMisfire already
// recovers in other shapes, but with real content sitting under a
// model-invented heading (e.g. "## STAR Story, Streaming Reconciliation at
// Stripe") none of that function's fixed extraction patterns match — so
// extraction returns null and the raw scaffold-and-meta-commentary text
// would otherwise ship untouched. This guard's fallback mirrors the
// answer-relevance guard's exact repair mechanics (bounded regeneration,
// re-check before accepting, fall through unchanged on repair failure).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

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

  session.addTranscript({
    speaker: 'system',
    text: question || 'Before Stripe, you were at Datadog — what did you own there?',
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

// A4's exact repro shape: real content under a model-invented "## STAR
// Story" heading detectAndExtractScaffoldMisfire's fixed patterns can't
// key off of.
const A4_UNRECOVERED_SCAFFOLD = `## Approach
- I want to land on a clear, structured answer that pulls directly from your Stripe work on the streaming reconciliation system, since that is the most defensible "recent impact" story.
- The framing should be tight: pick one project, own it end-to-end, then add one or two sharp metrics that prove scale.

## STAR Story, Streaming Reconciliation at Stripe
- **Situation:** I was the tech lead on Stripe's payment reconciliation. The legacy pipeline was a nightly Hadoop batch job that took 14 hours to close the books.
- **Task:** Replace it with a streaming pipeline that could keep the ledger in sync with the payments surface in near real time.
- **Action:**
  - Designed a Kafka-based ingestion layer with exactly-once semantics into Flink.

## Technique / Data Structure / Algorithm Used
- Kafka exactly-once ingestion, Flink stream processing, DynamoDB conditional writes for idempotency.`;

describe('unrecovered scaffold contamination fallback — bounded regeneration', () => {
  test('a scaffold-contaminated answer detectAndExtractScaffoldMisfire cannot recover is regenerated into a clean answer', async () => {
    const repaired = 'At Datadog I owned the tail-aggregation service for high-cardinality customer metrics, and re-architected it onto a sharded RocksDB store.';
    const { engine, session } = await makeEngineWithAnswer([A4_UNRECOVERED_SCAFFOLD], {
      repairChunks: [repaired],
    });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, repaired);
    assert.deepEqual(finals, [repaired]);
    assert.equal(
      session.getFullTranscript().some(segment => segment.text.includes('## Approach')),
      false,
      'the raw scaffold headings must never reach session history',
    );
  });

  test('a real, unscaffolded answer is never touched by the contamination guard (critical false-positive check)', async () => {
    const realAnswer = 'I owned the payments orchestration platform at Stripe, which sat between our internal services and the card networks.';
    const { engine } = await makeEngineWithAnswer([realAnswer]);
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, realAnswer);
    assert.deepEqual(finals, [realAnswer]);
  });

  test('a real answer legitimately discussing complexity (single O(1) mention, below the 2-heading threshold) is never touched', async () => {
    const realAnswer = 'Rate limiting with a token bucket gives you O(1) time complexity per check, since you are just comparing a counter against a threshold.';
    const { engine } = await makeEngineWithAnswer([realAnswer], {
      question: 'How would you design a rate limiter?',
    });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, realAnswer);
    assert.deepEqual(finals, [realAnswer]);
  });

  test('regeneration failure (repair also contaminated) falls through with the ORIGINAL answer unchanged, not a worse guess', async () => {
    // The repaired stream ALSO carries scaffold contamination — the guard
    // must reject this repair and keep the original raw text rather than
    // ship a second, still-bad guess (mirrors the answer-relevance guard's
    // own "never a worse guess" precedent).
    const stillContaminatedRepair = `## Approach
Still leaking the same planning-note shape.

## STAR Story, Another Invented Heading
Some content that still fails extraction.

## Technique / Data Structure / Algorithm Used
Still contaminated.`;
    const { engine, session } = await makeEngineWithAnswer([A4_UNRECOVERED_SCAFFOLD], {
      repairChunks: [stillContaminatedRepair],
    });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, A4_UNRECOVERED_SCAFFOLD);
    assert.deepEqual(finals, [A4_UNRECOVERED_SCAFFOLD]);
    assert.equal(
      session.getFullTranscript().some(segment => segment.text.includes('Another Invented Heading')),
      false,
      'a rejected repair must never reach session history',
    );
  });

  test('a regeneration that leaks an internal tag block is REJECTED even if it would otherwise pass the contamination check', async () => {
    const leakedRepair = '<resume>\nFabricated Person\nDistributed Systems Engineer\nGitHub: github.com/fake123\n\nOwned Datadog-style tail-aggregation systems.';
    const { engine, session } = await makeEngineWithAnswer([A4_UNRECOVERED_SCAFFOLD], {
      repairChunks: [leakedRepair],
    });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.notEqual(answer, leakedRepair);
    assert.equal(answer, A4_UNRECOVERED_SCAFFOLD);
    assert.equal(
      session.getFullTranscript().some(segment => segment.text.includes('Fabricated Person')),
      false,
      'the leaked regeneration must never be persisted into session history either',
    );
  });

  test('a case detectAndExtractScaffoldMisfire successfully extracts is not re-processed by this fallback (extraction wins, no second LLM call)', async () => {
    // The A10 shape (trailing --- separator) that the sibling extraction
    // guard already recovers cleanly — the fallback must not fire a second,
    // unnecessary regeneration on top of an already-clean extraction.
    const A10_RAW_SCAFFOLD = `## Approach
Surface the matching real signal from the candidate profile.

## Technique / Data Structure / Algorithm Used
Behavior-grounded answer assembly. No DSA needed for this prompt.

---

Polite opening: I'd love to throw out a range, but I want to make sure I'm doing it the right way for this role.`;
    const { engine } = await makeEngineWithAnswer([A10_RAW_SCAFFOLD], {
      question: "Good, now let's discuss compensation — what are your salary expectations?",
      repairChunks: ['this should never be requested — extraction already succeeded'],
    });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.match(answer, /love to throw out a range/);
    assert.doesNotMatch(answer, /## Approach/);
    assert.equal(finals.length, 1);
  });

  test('speculative-path contaminated answers are never regenerated or surfaced (auto-trigger prefetch must stay silent)', async () => {
    const { engine } = await makeEngineWithAnswer([A4_UNRECOVERED_SCAFFOLD], {
      repairChunks: ['this should never be requested'],
    });
    const events = [];
    engine.on('suggested_answer_token', token => events.push(['token', token]));
    engine.on('suggested_answer', answer => events.push(['final', answer]));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { speculative: true, skipCooldown: true });

    assert.equal(answer, A4_UNRECOVERED_SCAFFOLD);
    assert.deepEqual(events, []);
  });

  // Code-review 2026-07-19 HIGH fix #1: doc-grounded answer types (lecture_
  // answer, definitional_answer, list_answer, etc.) were NOT excluded from
  // this guard, unlike the sibling answer-relevance guard (which excludes
  // via isDocGroundedAnswerType for the identical reason — a correct,
  // validated doc-grounded answer legitimately echoing a source document's
  // own section names/headings can look scaffold-contaminated to this
  // guard's structural check, and this guard's repair prompt sends ZERO
  // retrieved document evidence, risking fabrication on the one surface
  // this codebase treats as zero-fabrication-sacred). Reviewer live-
  // reproduced a real doc-grounded answer (Approach/Complexity headings
  // describing a paper's own algorithm) tripping the guard for every
  // doc-grounded answer type. Fixed via isDocGroundedAnswerType exclusion;
  // this test forces the WTA path into a document-grounded custom mode
  // (activeMode.documentGroundedCustomModeActive = true routes AnswerPlanner
  // into lecture_answer/definitional_answer/etc. shapes per
  // AnswerPlanner.ts's documentGroundedCustomModeActive branch) and confirms
  // a scaffold-shaped doc-grounded answer is NEVER regenerated by this guard.
  test('a document-grounded custom-mode answer with scaffold-shaped headings never triggers this guard\'s repair stream (doc-grounded exclusion)', async () => {
    // NOTE: in a document-grounded custom mode, a SEPARATE, pre-existing
    // post-stream validator (validateDocumentGroundedAnswer) also runs and
    // may legitimately rewrite the answer for its OWN reasons (e.g. no
    // retrieved evidence matched in this synthetic no-retrieval test setup
    // — confirmed via a standalone repro that the real compiled engine
    // replaces this fixture's answer with its honest "I could not find that
    // in the retrieved sections of the document." fallback). That is
    // correct, unrelated behavior this test must not assert against. What
    // THIS test verifies is narrower and is the actual thing the review
    // finding was about: this guard's OWN repair stream (llmHelper.streamChat)
    // must never be invoked for a doc-grounded answer type, regardless of
    // what the doc-grounded validator separately does to the text.
    const docGroundedScaffoldAnswer = `## Approach
The paper's attention mechanism computes a weighted sum of values, with weights derived from a compatibility function between query and key.

## Technique / Data Structure / Algorithm Used
Scaled dot-product attention: $\\text{Attention}(Q,K,V) = \\text{softmax}(QK^T/\\sqrt{d_k})V$.

## Complexity
Time complexity is O(n^2 d) for sequence length n and dimension d, since every position attends to every other position.`;
    let repairStreamCalled = false;
    const { engine } = await makeEngineWithAnswer([docGroundedScaffoldAnswer], {
      question: 'What attention mechanism does the paper use?',
    });
    engine.llmHelper.streamChat = async function* () {
      repairStreamCalled = true;
      yield 'this should never be requested — doc-grounded types are excluded';
    };
    engine.getActiveModeInfo = () => ({ documentGroundedCustomModeActive: true });

    await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(repairStreamCalled, false, 'this guard\'s repair stream must never fire for a doc-grounded answer type');
  });

  // Code-review 2026-07-19 HIGH fix #2: `detectAndExtractScaffoldMisfire`'s
  // Pattern A (trailing `---` separator) only checks the recovered tail's
  // FIRST LINE isn't itself a scaffold heading — a live model output where
  // the recovered tail contains a SECOND scaffold block further down would
  // previously ship untouched (the old `!scaffoldExtractionRecovered` gate
  // unconditionally skipped this guard whenever extraction returned
  // non-null). Fixed by re-running hasUnrecoveredScaffoldContamination on
  // fullAnswer regardless of whether extraction already fired.
  test('a scaffold-misfire extraction whose recovered tail is ITSELF still contaminated is caught and regenerated by this guard', async () => {
    const doublyScaffolded = `## Approach
Surface the matching real signal from the candidate profile.

## Technique / Data Structure / Algorithm Used
Behavior-grounded answer assembly. No DSA needed for this prompt.

---

I owned the reconciliation pipeline at Stripe end to end.

## Approach
Actually let me restructure this — here is another scaffold block leaking into the supposedly-recovered tail.

## Complexity
Time O(n), Space O(1).`;
    const repaired = 'I owned the reconciliation pipeline at Stripe end to end, reducing latency from 14 hours to 38 minutes.';
    const { engine, session } = await makeEngineWithAnswer([doublyScaffolded], {
      question: 'What did you own at Stripe?',
      repairChunks: [repaired],
    });
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, repaired);
    assert.deepEqual(finals, [repaired]);
    assert.equal(
      session.getFullTranscript().some(segment => segment.text.includes('## Approach')),
      false,
      'the still-contaminated extracted tail must never reach session history',
    );
  });

  test('a stale repair from a superseded generation never overwrites fullAnswer or reaches session history', async () => {
    const { engine, session } = await makeEngineWithAnswer([A4_UNRECOVERED_SCAFFOLD]);
    engine.llmHelper.streamChat = async function* () {
      engine.currentGenerationId = (engine.currentGenerationId || 0) + 1;
      yield 'At Datadog I owned tail-aggregation for high-cardinality metrics.';
    };
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, A4_UNRECOVERED_SCAFFOLD);
    assert.equal(
      session.getFullTranscript().some(segment => segment.text.includes('tail-aggregation for high-cardinality')),
      false,
      'a repair from a superseded generation must never reach session history',
    );
  });
});
