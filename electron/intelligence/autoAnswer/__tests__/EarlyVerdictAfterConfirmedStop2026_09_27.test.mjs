// A positive EARLY verdict must not be lost when the stop was already confirmed.
//
// Live 2026-09-27 (looking for work, DeepSeek judge ~0.7 s): the final landed,
// the local VAD confirmed the stop (ENDPOINT_CONFIRM_MS) and that commit ran
// while the judge was still out. The verdict — answer, a=0.9 — arrived under
// STABILITY_MS after the last word, so it was HELD "for the commit timer",
// which had already fired. Nothing re-applied it: the question went unanswered
// until the next interviewer speech replaced it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { SimpleAutoAnswerEngine, STABILITY_MS, EARLY_JUDGE_MS } = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/SimpleAutoAnswer.js'));

const flush = () => new Promise((r) => setImmediate(r));
const YES = JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'follow_up', answerability: 0.9, question_text: null });

function rig(judgeMs) {
  const clock = new FakeClock();
  const state = { dispatched: [] };
  const host = {
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [], dispatch: (q) => { state.dispatched.push({ text: q.text, at: clock.now() }); },
    judgeCandidate: () => new Promise((resolve) => clock.setTimeout(() => resolve(YES), judgeMs)),
    telemetry: () => {}, log: () => {},
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  const advance = async (ms) => { let left = ms; while (left > 0) { const s = Math.min(20, left); clock.advance(s); left -= s; await flush(); await flush(); } };
  return { engine, clock, state, advance };
}

test('fast judge + confirmed stop: the answer is dispatched when the verdict lands', async () => {
  const h = rig(650);                                   // DeepSeek-fast
  const t0 = h.clock.now();
  h.engine.ingest({ speaker: 'interviewer', text: 'Tell me more about the payout service rewrite on your resume.', final: true, timestamp: t0, origin: 'stt', punctuationSource: 'provider' });
  await h.advance(10);
  h.engine.onLocalSpeechEnd();                          // local VAD confirms the stop → 350 ms commit
  await h.advance(EARLY_JUDGE_MS + 650 + 100);          // the early ask's verdict arrives < STABILITY_MS after the final
  assert.ok(h.clock.now() - t0 < STABILITY_MS, 'the scenario: the verdict lands inside the stability window');
  assert.equal(h.state.dispatched.length, 1, 'the verdict must dispatch, not wait for a commit that already ran');
  await h.advance(5000);
  assert.equal(h.state.dispatched.length, 1, 'and exactly once');
});

test('without a confirmed stop, an early verdict still waits out the stability window (unchanged)', async () => {
  const h = rig(300);
  const t0 = h.clock.now();
  h.engine.ingest({ speaker: 'interviewer', text: 'Tell me more about the payout service rewrite on your resume.', final: true, timestamp: t0, origin: 'stt', punctuationSource: 'provider' });
  await h.advance(EARLY_JUDGE_MS + 300 + 60);
  assert.equal(h.state.dispatched.length, 0, 'held: only ~0.5 s of quiet so far');
  await h.advance(STABILITY_MS);
  assert.equal(h.state.dispatched.length, 1, 'applied by the commit stoppage');
});
