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

async function makeEngineWithAnswer(chunks) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(), session);

  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
    },
  };

  return { engine, session };
}

// Campaign 2 (longsession, 2026-07-16): a MANUAL (non-speculative) press that
// hits the "nothing actionable" sentinel now gets an honest, visible fallback
// message instead of a silent null — see IntelligenceEngine.ts's
// isNonAnswerSentinel branch, [FIX:longsession-nonanswer-fallback]. Live-proven
// on the real backend: a well-formed prompt for a real interviewer question
// (a long-range follow-up whose referent had been evicted from the transcript
// window) produced the sentinel, and the prior silent-null behavior was
// indistinguishable from a greeting-failure/no-op to the user. The SPECULATIVE
// path (auto-trigger prefetch on ambient chatter) is intentionally unchanged —
// see the tests further below.
const LONGSESSION_NONANSWER_FALLBACK = "I don't have enough from the conversation to answer that specific point yet.";

test('runWhatShouldISay gives an honest fallback for a manual nothing-actionable sentinel', async () => {
  const { engine, session } = await makeEngineWithAnswer(['Nothing ', 'actionable right now.']);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay('anything actionable?', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, LONGSESSION_NONANSWER_FALLBACK);
  assert.deepEqual(events, [['final', LONGSESSION_NONANSWER_FALLBACK]]);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.text.includes('Nothing actionable')), false);
  assert.equal(session.getFullTranscript().some(segment => segment.text === LONGSESSION_NONANSWER_FALLBACK), true);
});

test('runWhatShouldISay gives an honest fallback for a manual nothing-to-capture sentinel', async () => {
  const { engine, session } = await makeEngineWithAnswer([' Nothing to capture right now.\n']);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay('anything to capture?', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, LONGSESSION_NONANSWER_FALLBACK);
  assert.deepEqual(events, [['final', LONGSESSION_NONANSWER_FALLBACK]]);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.text.includes('Nothing to capture')), false);
  assert.equal(session.getFullTranscript().some(segment => segment.text === LONGSESSION_NONANSWER_FALLBACK), true);
});

test('runWhatShouldISay gives an honest fallback for normalized sentinel variants (manual press)', async () => {
  const { engine, session } = await makeEngineWithAnswer(['  NOTHING ACTIONABLE RIGHT NOW!!!  ']);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay('anything actionable?', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, LONGSESSION_NONANSWER_FALLBACK);
  assert.deepEqual(events, [['final', LONGSESSION_NONANSWER_FALLBACK]]);
  assert.deepEqual(session.getFullUsage(), []);
});

test('runWhatShouldISay does not suppress near-match real answers', async () => {
  const nearMatch = 'Nothing actionable right now, but I can ask a clarifying question.';
  const { engine, session } = await makeEngineWithAnswer([nearMatch]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay('anything actionable?', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, nearMatch);
  assert.deepEqual(finals, [nearMatch]);
  assert.equal(session.getFullUsage()[0].answer, nearMatch);
});

test('runWhatShouldISay suppresses speculative sentinel output', async () => {
  const { engine, session } = await makeEngineWithAnswer(['Nothing to capture right now.']);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay('speculative trigger', 0.9, undefined, { speculative: true, skipCooldown: true });

  assert.equal(answer, null);
  assert.deepEqual(events, []);
  assert.deepEqual(session.getFullUsage(), []);
});

test('runWhatShouldISay hides speculative real answers from renderer and history', async () => {
  const realAnswer = 'I would explain the tradeoff clearly and ask which constraint matters most.';
  const { engine, session } = await makeEngineWithAnswer(['I would explain ', 'the tradeoff clearly ', 'and ask which constraint matters most.']);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay('speculative trigger', 0.9, undefined, { speculative: true, skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.deepEqual(events, []);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.text === realAnswer), false);
});

test('runWhatShouldISay hides speculative fallback answers from renderer and history', async () => {
  const fallbackAnswer = 'I would start with the invariant and then walk through edge cases.';
  const { engine, session } = await makeEngineWithAnswer([]);
  engine.whatToAnswerLLM = null;
  engine.answerLLM = {
    async generate() {
      return fallbackAnswer;
    },
  };
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay('speculative fallback', 0.9, undefined, { speculative: true, skipCooldown: true });

  assert.equal(answer, fallbackAnswer);
  assert.deepEqual(finals, []);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.text === fallbackAnswer), false);
});

test('runWhatShouldISay still emits and stores real answers', async () => {
  const realAnswer = 'I would explain the tradeoff clearly and ask which constraint matters most.';
  const { engine, session } = await makeEngineWithAnswer(['I would explain ', 'the tradeoff clearly ', 'and ask which constraint matters most.']);
  const tokens = [];
  const finals = [];
  engine.on('suggested_answer_token', token => tokens.push(token));
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay('how should I answer?', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.deepEqual(tokens, [realAnswer]);
  assert.deepEqual(finals, [realAnswer]);
  assert.equal(session.getFullUsage().length, 1);
  assert.equal(session.getFullUsage()[0].answer, realAnswer);
  assert.equal(session.getFullTranscript().some(segment => segment.text === realAnswer), true);
});
