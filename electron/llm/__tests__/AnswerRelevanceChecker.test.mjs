// electron/llm/__tests__/AnswerRelevanceChecker.test.mjs
//
// Campaign 2 longsession (2026-07-19): pure-function tests for
// checkAnswerRelevance against the exact known-bad/known-good corpus used to
// empirically tune ANSWER_RELEVANCE_THRESHOLD/HYPOTHESIS_TEMPLATE (see the
// doc comments in AnswerRelevanceChecker.ts for the full corpus scores and
// the rejected alternative framings this landed on). Runs the REAL compiled
// zero-shot classifier (Xenova/mobilebert-uncased-mnli) — no mocking — since
// the whole point of this guard is its behavior against the actual model,
// not a stubbed contract. Slow-ish (model load + inference per case) but
// this is the ground-truth regression pin for the threshold.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerRelevanceChecker.js');
const { checkAnswerRelevance } = await import(pathToFileURL(modPath).href);

// IntentClassifier.ts's shared ZeroShotClassifier singleton keeps its Worker
// thread alive (not unref'd) once loaded — by design, since the live app
// keeps it warm for the WTA path's whole lifetime. This test file is the
// first to actually complete a real model load end-to-end (sibling
// IntentClassifier tests only exercise the missing-asset/poison-latch paths,
// which never reach a successful load), so it's also the first to surface
// that the live worker outlives the test run. Force-exit once every test has
// finished rather than touching the shared singleton's lifecycle.
after(() => new Promise(resolve => setTimeout(() => { process.exit(0); resolve(); }, 200)));

// Same 9 known-bad repros collected from this campaign's real transcript
// history across runs 001-031 (see AnswerRelevanceChecker.ts's threshold
// comment for the exact score each produced during tuning).
const KNOWN_BAD = [
  ['Tell me about tinroof.', "I'm welcome, ready whenever you want to keep going."],
  ['What did you own at Datadog?', 'This turn appears empty.'],
  ['What scale have you operated Kubernetes at?', '(trajectory truncated; nothing captured yet)'],
  ['Tell me about your degree.', 'No input from you yet, what would you like help with?'],
  ['What was your most recent role?', "Hey Marcus, your phone's interviewer audio is coming through, but I haven't picked up any question yet. What's the next thing they asked?"],
  ['What was the biggest quantified win from that project?', "There's nothing captured to summarize yet."],
  ["What's your experience mentoring engineers?", "I don't see a current turn or question in the conversation, so there's nothing for me to clarify right now."],
  ['Tell me about your degree.', "The user hasn't asked anything yet, so I'll wait for the actual question."],
  ["What's your experience with Kafka and Flink specifically?", "The user's message was empty, there's no question to respond to yet. Without a prompt, I shouldn't fabricate a behavioral answer."],
];

const KNOWN_GOOD = [
  ['Tell me about tinroof.', 'Tinroof is an open-source library I built for distributed rate limiting, written in Go, used in production at my last company to handle burst traffic.'],
  ['What did you own at Datadog?', 'I owned the metrics tail-aggregation pipeline, rebuilding it from a legacy batch system into a real-time streaming architecture.'],
  ['Tell me about your degree.', "I have a Bachelor's in Computer Science from UC Berkeley, graduated in 2014."],
  ['What did you own at Datadog?', 'Metrics tail-aggregation.'],
  ['What was your most recent role?', "I'm currently a Staff Software Engineer at Stripe, focused on the payments orchestration platform."],
  ["What's your experience mentoring engineers?", "I've mentored 4 engineers through promotion to senior, and wrote the team's distributed-systems interview rubric."],
  ["What's your experience with Kafka and Flink specifically?", 'I rebuilt our legacy batch pipeline on Kafka and Flink to handle 4.2 billion ledger entries a day.'],
];

describe('checkAnswerRelevance — corpus regression pin (2026-07-19)', () => {
  test('all 7 known-good real answers are never flagged (zero false positives — the critical property)', async () => {
    for (const [q, a] of KNOWN_GOOD) {
      const r = await checkAnswerRelevance(q, a);
      assert.ok(r, `classifier must return a result for: ${a}`);
      assert.equal(r.relevant, true, `real answer incorrectly flagged as irrelevant (score ${r?.confidence}): ${a}`);
    }
  });

  test('at least 8 of 9 known-bad no-content hallucinations are flagged (one accepted miss, see threshold comment)', async () => {
    let flagged = 0;
    for (const [q, a] of KNOWN_BAD) {
      const r = await checkAnswerRelevance(q, a);
      assert.ok(r, `classifier must return a result for: ${a}`);
      if (!r.relevant) flagged++;
    }
    assert.ok(flagged >= 8, `expected at least 8/9 known-bad examples flagged, got ${flagged}/9`);
  });

  test('the specific unambiguous hallucinations (no plausible real-answer reading) are always flagged', async () => {
    const unambiguous = [
      ['What did you own at Datadog?', 'This turn appears empty.'],
      ['What scale have you operated Kubernetes at?', '(trajectory truncated; nothing captured yet)'],
      ['Tell me about your degree.', 'No input from you yet, what would you like help with?'],
    ];
    for (const [q, a] of unambiguous) {
      const r = await checkAnswerRelevance(q, a);
      assert.equal(r.relevant, false, `unambiguous hallucination not flagged (score ${r?.confidence}): ${a}`);
    }
  });

  test('returns null (never throws) on empty question or answer', async () => {
    assert.equal(await checkAnswerRelevance('', 'some answer'), null);
    assert.equal(await checkAnswerRelevance('some question', ''), null);
    assert.equal(await checkAnswerRelevance('', ''), null);
  });

  test('a long real answer past the char cap is still classified without throwing', async () => {
    const longAnswer = 'I led the migration of our reconciliation pipeline from a legacy nightly batch job to a real-time streaming architecture using Kafka and Flink. '.repeat(20);
    const r = await checkAnswerRelevance('What did you own at your last role?', longAnswer);
    assert.ok(r);
    assert.equal(typeof r.confidence, 'number');
  });

  // Code-review 2026-07-19 HIGH: a naive head-only truncation would penalize
  // a real answer whose specific content lands past the char cap after a
  // long, normal scene-setting preamble (a common MiniMax-M3 speaking
  // pattern). checkAnswerRelevance now scores head AND tail chunks and takes
  // the max, so a long-winded-but-real answer with its concrete facts at the
  // END must still be classified relevant — this test would have failed
  // against the original head-only implementation.
  test('a long real answer whose specific content lands only in the TAIL (past the head-only cap) is still recognized as relevant', async () => {
    const genericPreamble = 'So that\'s an interesting question, let me think about how best to walk through this for you. '.repeat(15);
    const specificTail = 'To answer directly: I owned the metrics tail-aggregation pipeline at Datadog, rebuilding it from a legacy nightly batch job into a real-time streaming architecture using Kafka and Flink, cutting p99 latency from fourteen hours to under forty minutes.';
    const longAnswer = genericPreamble + specificTail;
    // Confirm the setup actually exercises truncation and that the specific
    // content genuinely sits past the head-only cap.
    assert.ok(longAnswer.length > 1000, 'fixture must exceed the char cap to exercise head+tail scoring');
    const r = await checkAnswerRelevance('What did you own at Datadog?', longAnswer);
    assert.ok(r);
    assert.equal(r.relevant, true, `real answer with tail-only specific content incorrectly flagged as irrelevant (score ${r?.confidence})`);
  });
});
