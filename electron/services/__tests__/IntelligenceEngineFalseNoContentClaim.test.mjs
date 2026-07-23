// Campaign 2 longsession run-022 (2026-07-18): MiniMax-M3 spontaneously
// claimed no question was captured on several presses despite a real,
// correctly-extracted interviewer question being present in the exact
// prompt it was given (verified via [TRACE:LONGCTX] question_extracted /
// prompt_assembled on the live repro). This is distinct from
// isNonAnswerSentinel's INTENTIONALLY PROMPTED "Nothing actionable right
// now." escape hatch for a genuinely empty transcript (see
// IntelligenceEngineSentinel.test.mjs) — that phrase can be TRUE and must
// keep working. isFalseNoContentClaim + its call-site gate on
// extractedQuestion only fire when extraction proves the claim false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

function makeHelper() {
  return {
    setNegotiationCoachingHandler() {},
  };
}

async function makeEngineWithAnswer(chunks, { withRealQuestion = true } = {}) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();

  if (withRealQuestion) {
    // A real, well-formed interviewer question landing in the rolling
    // transcript window — mirrors A2's exact repro shape ("Walk me through
    // your most recent role — what you owned and the team setup.").
    session.addTranscript({
      speaker: 'system',
      text: "Walk me through your most recent role — what you owned and the team setup.",
      timestamp: Date.now(),
      final: true,
    });
  }

  const engine = new IntelligenceEngine(makeHelper(), session);
  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
    },
  };

  return { engine, session };
}

const HONEST_FALLBACK = "I don't have enough from the conversation to answer that specific point yet.";

test('a false "no question captured" claim is caught when a real question was extracted', async () => {
  const { engine, session } = await makeEngineWithAnswer([
    "Hey Marcus, your phone's interviewer audio is coming through, but I haven't picked up any question yet. What's the next thing they asked?",
  ]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, HONEST_FALLBACK);
  assert.deepEqual(finals, [HONEST_FALLBACK]);
  assert.equal(
    session.getFullTranscript().some(segment => segment.text.includes("haven't picked up any question")),
    false,
    'the false raw claim must never reach session history',
  );
});

test('the "nothing captured to summarize yet" false-claim variant is also caught (A3/A7 repro)', async () => {
  const { engine, session } = await makeEngineWithAnswer(["There's nothing captured to summarize yet."]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, HONEST_FALLBACK);
  assert.deepEqual(finals, [HONEST_FALLBACK]);
});

test('the "don\'t have a specific question" false-claim variant is also caught (A12 repro)', async () => {
  const { engine } = await makeEngineWithAnswer([
    "I don't have a specific question or topic to clarify from what's captured right now.",
  ]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, HONEST_FALLBACK);
  assert.deepEqual(finals, [HONEST_FALLBACK]);
});

test('a genuinely empty transcript keeps the legitimate "nothing captured" claim untouched', async () => {
  // No real question was ever added to the session — the claim is TRUE here,
  // so the guard's extraction-evidence gate must NOT fire, and the ORIGINAL
  // sentinel-fallback path (unrelated to this fix) still applies.
  const { engine } = await makeEngineWithAnswer(["There's nothing captured to summarize yet."], { withRealQuestion: false });
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  // Falls through to isNonAnswerSentinel's own honest-fallback substitution
  // (a DIFFERENT phrase never matches the literal sentinel, so without a real
  // extracted question this exact string just passes through as a real,
  // if unhelpful, model answer — proving the guard did not fire).
  assert.equal(answer, "There's nothing captured to summarize yet.");
  assert.deepEqual(finals, ["There's nothing captured to summarize yet."]);
});

test('a real, substantive answer is never touched by the false-claim guard', async () => {
  const realAnswer = 'I owned the merchant settlement reconciliation pipeline end to end, leading a team of four.';
  const { engine } = await makeEngineWithAnswer([realAnswer]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.deepEqual(finals, [realAnswer]);
});

test('speculative false-claim answers are still silently discarded, not surfaced', async () => {
  const { engine } = await makeEngineWithAnswer([
    "There's nothing captured to summarize yet.",
  ]);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { speculative: true, skipCooldown: true });

  assert.equal(answer, null);
  assert.deepEqual(events, []);
});

// ── Code-review 2026-07-18 CRITICAL fix: the guard must NEVER discard a real,
//    substantive answer that merely OPENS with a "no X right now" disclaimer
//    before pivoting to real content — this is the standard, extremely common
//    candidate response to "do you have any questions for us?" and an earlier
//    draft's unanchored regex silently discarded it end-to-end (verified live
//    against the compiled engine before this fix). ──────────────────────────
test('a real "questions for us" answer that opens with "I don\'t have a specific question right now" survives intact', async () => {
  const realAnswer = "I don't have a specific question right now, but I'd love to hear more about how success is measured in the first quarter.";
  const { engine } = await makeEngineWithAnswer([realAnswer]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.deepEqual(finals, [realAnswer]);
});

test('a real answer that opens with "no question has been asked yet, but..." survives intact', async () => {
  const realAnswer = 'No question has been asked yet about the on-call rotation, but I do want to ask about it before we finish.';
  const { engine } = await makeEngineWithAnswer([realAnswer]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.deepEqual(finals, [realAnswer]);
});

test('a real answer at the 220-char length-guard boundary is never touched', async () => {
  // 221 chars — one over the length guard, and not a match on any anchored
  // pattern regardless; pins the boundary explicitly rather than relying on
  // the length check alone.
  const realAnswer = 'I led the migration of our reconciliation pipeline from a legacy nightly batch job to a real-time streaming architecture using Kafka and Flink, which reduced end-to-end latency from fourteen hours down to under forty minutes at p99 percentile overall.';
  const { engine } = await makeEngineWithAnswer([realAnswer]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.deepEqual(finals, [realAnswer]);
});

test('extraction confidence just under the 0.6 gate does not suppress a true "nothing captured" claim', async () => {
  // A bare, low-confidence interviewer turn (no question mark, no lead-in
  // verb) — extractLatestQuestion assigns confidence well under 0.6 for
  // this shape. The guard's extraction-evidence gate must not fire, so the
  // claim (arguably still true here) passes through untouched exactly like
  // the "genuinely empty transcript" case above.
  const { engine, session } = await makeEngineWithAnswer([], { withRealQuestion: false });
  session.addTranscript({
    speaker: 'system',
    text: 'okay',
    timestamp: Date.now(),
    final: true,
  });
  engine.whatToAnswerLLM = {
    async *generateStream() {
      yield "There's nothing captured to summarize yet.";
    },
  };
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, "There's nothing captured to summarize yet.");
  assert.deepEqual(finals, ["There's nothing captured to summarize yet."]);
});
