// Campaign 2 longsession run-023 (2026-07-18): a candidate-voice answer that
// is ENTIRELY assistant-meta (e.g. the bare stock refusal "I can't share
// that information.") was silently shipped to the user unrepaired on the
// live WTA path. sanitizeCandidateAnswer() correctly detects this and
// returns needsFallback: true, but IntelligenceEngine.ts's call site had no
// `else` branch for that case — its own comment claimed "the non-answer-
// sentinel / live-fallback paths below handle the replacement", which was
// never true for a stock refusal (a different failure family from either
// isNonAnswerSentinel or isFalseNoContentClaim). The manual path
// (ipcHandlers.ts) already had the correct needsFallback branch; this
// mirrors it on the live path. Live-reproduced: run-023 presses A8/A9.
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

async function makeEngineWithAnswer(chunks, { question } = {}) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();

  session.addTranscript({
    speaker: 'system',
    text: question || "The JD calls for 8+ years and deep Go or Java expertise — how do you stack up there?",
    timestamp: Date.now(),
    final: true,
  });

  const engine = new IntelligenceEngine(makeHelper(), session);
  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
    },
  };

  return { engine, session };
}

const DETERMINISTIC_FALLBACK = "The model produced an invalid assistant-identity answer, so I won't guess from your profile. Please try again.";

test('a bare stock refusal on a candidate-voice answer gets a deterministic fallback, not shipped raw (A9 repro)', async () => {
  const { engine, session } = await makeEngineWithAnswer(["I can't share that information."]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, DETERMINISTIC_FALLBACK);
  assert.deepEqual(finals, [DETERMINISTIC_FALLBACK]);
  assert.equal(
    session.getFullTranscript().some(segment => segment.text === "I can't share that information."),
    false,
    'the raw stock refusal must never reach session history',
  );
});

test('a candidate-voice answer with real content plus an assistant-meta tail is still just stripped, not fully replaced', async () => {
  const realWithTail = "I have 8+ years of production Go, primary language for almost everything I've shipped in the last decade. I can't share that information.";
  const { engine } = await makeEngineWithAnswer([realWithTail]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.match(answer, /8\+ years of production Go/);
  assert.doesNotMatch(answer, /I can't share that information/);
  assert.deepEqual(finals, [answer]);
});

test('a real, substantive candidate-voice answer is never touched by the fallback branch', async () => {
  const realAnswer = "I have 8+ years of production Go, primary language for almost everything I've shipped in the last decade.";
  const { engine } = await makeEngineWithAnswer([realAnswer]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.deepEqual(finals, [realAnswer]);
});

// ── Code-review 2026-07-18 HIGH fix: sanitizeCandidateAnswer's needsFallback
//    used to be `text.length < 15` alone, with no check that anything was
//    actually stripped — so wiring the needsFallback branch into this live
//    path (the fix above) would have newly discarded genuine SHORT answers
//    like "Python." (a correct, complete answer to "what's your primary
//    language?"), which were previously left untouched by the pre-fix code
//    (no `else` branch existed at all). Fixed at the root in
//    ProfileOutputValidator.ts (needsFallback now requires removed.size > 0)
//    rather than only guarding this one call site, since the manual path
//    (ipcHandlers.ts) shares the exact same latent bug. ─────────────────────
test('a short but genuinely correct candidate-voice answer survives intact (no markers were ever stripped)', async () => {
  const shortRealAnswer = 'Python.';
  const { engine } = await makeEngineWithAnswer([shortRealAnswer], { question: "What's your primary programming language?" });
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, shortRealAnswer);
  assert.deepEqual(finals, [shortRealAnswer]);
});

test('another short genuine answer ("5 years.") is not replaced by the deterministic fallback', async () => {
  const shortRealAnswer = '5 years.';
  const { engine } = await makeEngineWithAnswer([shortRealAnswer], { question: 'How many years of Go experience do you have?' });
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, shortRealAnswer);
  assert.deepEqual(finals, [shortRealAnswer]);
});
