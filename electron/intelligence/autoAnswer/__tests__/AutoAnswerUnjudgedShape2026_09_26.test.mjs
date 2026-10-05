/**
 * A question's SHAPE is read from the finals no verdict has ruled on
 * (live technical interview, 2026-09-26).
 *
 * Statements the judge rules silent stay in `pending` as context, so the next
 * candidate opens with them: "Great. So I'm Sarah, I lead the platform team…
 * Let's start with you. Tell me a little bit about yourself…". The shape tests
 * ran on the WHOLE candidate, so the lead-in was the lead:
 *  - the prefetch bypass (question-shaped asks skip the 25 s ration) missed
 *    "Tell me a little bit about yourself" — no head start, 10 s to first token;
 *  - the judge-failure fallback had no question to fall back on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Simple = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/SimpleAutoAnswer.js'));
const { SimpleAutoAnswerEngine, STABILITY_MS, JUDGE_DEADLINE_MS, isQuestionShaped } = { ...Simple, ...require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/AutoAnswerJudge.js')) };

const flush = () => new Promise((r) => setImmediate(r));
const NO = JSON.stringify({ is_ask: false, directed_at_user: false, complete: true, act: 'statement', answerability: 0.1, question_text: null });
const YES = JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'behavioral', answerability: 0.9, question_text: null });

function rig(judge, { punctuation = 'provider' } = {}) {
  const clock = new FakeClock();
  const state = { dispatched: [], prefetched: [], judgeCalls: 0 };
  const host = {
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [],
    dispatch: (q) => { state.dispatched.push(q.text); },
    prefetchAnswer: (id, text) => { state.prefetched.push(text); },
    speculativeSnapshot: () => ({ questionId: null, text: null }),
    judgeCandidate: (req) => { state.judgeCalls++; return judge(req, state.judgeCalls); },
    telemetry: () => {}, log: () => {},
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  const say = (text) => engine.ingest({ speaker: 'interviewer', text, final: true, timestamp: clock.now(), origin: 'stt', punctuationSource: punctuation });
  const advance = async (ms) => { let left = ms; while (left > 0) { const s = Math.min(100, left); clock.advance(s); left -= s; await flush(); await flush(); } };
  return { engine, state, say, advance };
}

test('isQuestionShaped reads each sentence, not just the candidate\'s lead', () => {
  assert.equal(isQuestionShaped("Let's start with you. Tell me a little bit about yourself."), true);
  assert.equal(isQuestionShaped('We use Postgres. Why did you pick it over MySQL?'), true);
  assert.equal(isQuestionShaped("Great. So I'm Sarah, I lead the platform team here."), false);
  assert.equal(isQuestionShaped("Take your time. And feel free to use whatever language you're comfortable with."), false);
});

test('after a statement ruled silent, a declarative ask gets its prefetch inside the ration window', async () => {
  const h = rig(async (_req, n) => (n === 1 ? NO : YES));
  h.say("Great. So I'm Sarah, I lead the platform team here, and we'll spend about forty five minutes today.");
  await h.advance(STABILITY_MS + 2000);
  assert.equal(h.state.prefetched.length, 1, 'the statement took the window\'s one rationed prefetch');
  h.say("Let's start with you. Tell me a little bit about yourself and what you've been working on recently.");
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.state.prefetched.length, 2, 'the ask is question-shaped even though the candidate opens with the statement');
});

test('a question that is still pending (never ruled) keeps counting — only RULED finals are skipped', async () => {
  // First stoppage: the judge says incomplete, so the ask stays open.
  const INCOMPLETE = JSON.stringify({ is_ask: true, directed_at_user: true, complete: false, act: 'incomplete', answerability: 0.2, question_text: null });
  const h = rig(async (req) => (/design/.test(req.candidateText) ? YES : INCOMPLETE));
  h.say('So how would you');
  await h.advance(STABILITY_MS + 2000);
  const before = h.state.prefetched.length;
  // The shape lives in the OPEN first part; the continuation alone has none.
  h.say('design the retry policy for the payment webhooks.');
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.state.prefetched.length, before + 1, 'an incomplete verdict leaves its words unjudged');
});

test('judge failure: a question after a silent lead-in still takes the fallback on a punctuation-less provider', async () => {
  // Punctuation-less provider (no '?'): the fallback is the interrogative lead,
  // and it now reads the sentences after the ruled lead-in.
  const h = rig(async (_req, n) => (n === 1 ? NO : new Promise(() => {})), { punctuation: 'none' });
  h.say('Great so I am Sarah and I lead the platform team here.');
  await h.advance(STABILITY_MS + 2000);
  h.say('How would you shard the sessions table');
  await h.advance(STABILITY_MS + JUDGE_DEADLINE_MS + 500);
  assert.equal(h.state.dispatched.length, 1, 'judge timed out and the question was not lost');
});

test('judge failure: a lead-in already ruled silent does not by itself fire the fallback', async () => {
  const h = rig(async (_req, n) => (n === 1 ? NO : new Promise(() => {})), { punctuation: 'none' });
  h.say('How we got here is a long story about the old monolith.');
  await h.advance(STABILITY_MS + 2000);
  h.say('and then we moved everything to the new cluster last year');
  await h.advance(STABILITY_MS + JUDGE_DEADLINE_MS + 500);
  assert.equal(h.state.dispatched.length, 0, 'the interrogative-looking lead was ruled a statement; nothing new asks');
});
