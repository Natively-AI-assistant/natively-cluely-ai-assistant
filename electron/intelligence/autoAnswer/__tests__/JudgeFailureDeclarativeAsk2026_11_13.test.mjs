/**
 * A judge timeout or error on a DECLARATIVE ask used to mean silence on a
 * punctuating provider: the fallback fired only on a '?' (pipeline forensics
 * 2026-11-13, F-ACC-07; A2 D5). "Walk me through how you would shard it." is
 * an ask with no question mark. The fallback now also takes a finished
 * sentence that directs the user to explain or produce something, and still
 * never answers a plain statement.
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
const { SimpleAutoAnswerEngine, STABILITY_MS } = Simple;
const { JUDGE_DEADLINE_MS } = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/AutoAnswerJudge.js'));

const flush = () => new Promise((r) => setImmediate(r));

function rig(judgeMode, punctuationSource = 'provider') {
  const clock = new FakeClock();
  const state = { dispatched: [] };
  const engine = new SimpleAutoAnswerEngine({
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [],
    dispatch: (q) => { state.dispatched.push(q.text); },
    judgeCandidate: judgeMode === 'hang' ? () => new Promise(() => {}) : async () => { throw new Error('judge down'); },
    telemetry: () => {}, log: () => {},
  }, clock);
  engine.onMeetingStart();
  const final = (text) => engine.ingest({ speaker: 'interviewer', text, final: true, timestamp: clock.now(), origin: 'stt', punctuationSource });
  const advance = async (ms) => { let left = ms; while (left > 0) { const s = Math.min(100, left); clock.advance(s); left -= s; await flush(); await flush(); } };
  return { state, final, advance };
}

const ASKS = [
  'Walk me through how you would shard it.',
  'Tell me about a time you disagreed with your manager.',
  'Okay, so explain how the cache gets invalidated.',
  'Your task is to build a rate limiter for this API.',
  'Go ahead and implement the merge function.',
  'Describe the architecture of your last project.',
];
const STATEMENTS = [
  'We shard the orders table by customer id.',
  'Design reviews happen every Friday afternoon.',
  'Let us move on to the next part of the interview.',
  'Take your time, there is no rush at all.',
  'Explain', // too short and not a finished directive
  'I want to walk you through how we do deploys here.',
];

for (const ask of ASKS) {
  test(`judge timeout on a declarative ask still answers: "${ask}"`, async () => {
    const h = rig('hang');
    h.final(ask);
    await h.advance(JUDGE_DEADLINE_MS + STABILITY_MS + 500);
    assert.deepEqual(h.state.dispatched, [ask]);
  });
}

test('judge ERROR on a declarative ask also takes the fallback', async () => {
  const h = rig('error');
  h.final(ASKS[0]);
  await h.advance(STABILITY_MS + 500);
  assert.deepEqual(h.state.dispatched, [ASKS[0]]);
});

for (const s of STATEMENTS) {
  test(`judge timeout on a statement stays silent: "${s}"`, async () => {
    const h = rig('hang');
    h.final(s);
    await h.advance(JUDGE_DEADLINE_MS + STABILITY_MS + 500);
    assert.deepEqual(h.state.dispatched, []);
  });
}

test('the directive must end the turn: a declarative ask followed by more non-inert speech is not guessed at', async () => {
  const h = rig('hang');
  h.final('Walk me through the design. But first we should talk about the budget for this quarter.');
  await h.advance(JUDGE_DEADLINE_MS + STABILITY_MS + 500);
  assert.deepEqual(h.state.dispatched, []);
});

test('the existing ? fallback is unchanged', async () => {
  const h = rig('hang');
  h.final('How would you shard the orders table?');
  await h.advance(JUDGE_DEADLINE_MS + STABILITY_MS + 500);
  assert.deepEqual(h.state.dispatched, ['How would you shard the orders table?']);
});
