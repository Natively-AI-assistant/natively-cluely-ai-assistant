/**
 * Dynamic-judge INTEGRATION: the controller consulting `host.judgeCandidate`
 * between the heuristic detector and routing (fake judge, fake clock — no
 * network, no sleeps).
 *
 * Mutation probes (docs/autopilot/auto-answer-v3-progress.md, dynamic-judge phase):
 *   promote      → 'judge PROMOTES a heuristic statement…'
 *   veto         → 'judge VETOES a pattern-matched question…'
 *   deadline     → 'judge over deadline → heuristic verdict stands…'
 *   staleness    → 'a verdict for a superseded commit is DROPPED…'
 *   stop guard   → 'a verdict landing after meeting stop routes nothing'
 *   no-text      → 'judge telemetry carries no transcript text'
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeHarness, QUIET, HARD_CAP_MS, flush } from './harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Judge = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/AutoAnswerJudge.js'));
const { JUDGE_DEADLINE_MS } = Judge;

const verdict = (over = {}) => JSON.stringify({
  is_ask: true, directed_at_user: true, complete: true, act: 'question', answerability: 0.95, question_text: null, ...over,
});

/** Attach a fake judge; returns the calls it received. */
function withJudge(h, impl) {
  const calls = [];
  h.host.judgeCandidate = (req) => { calls.push(req); return impl(req, calls.length); };
  return calls;
}

// The Wordle task phrased a way NO detector regex matches (heuristic act: statement).
const NOVEL_TASK = "Alright, here is what we are looking for from you this afternoon: put together a small working prototype of our checkout flow, whatever framework feels natural.";
const Q = 'Why did you choose PostgreSQL?';

test('judge PROMOTES a heuristic statement into an ask — the dynamic win the regexes cannot deliver', async () => {
  const h = makeHarness();
  const calls = withJudge(h, async () => verdict({ act: 'coding_task', answerability: 0.95, question_text: null }));
  h.interviewerFinal(NOVEL_TASK, { punctuationSource: 'provider' });
  await h.advance(QUIET + 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].candidateText, NOVEL_TASK);
  assert.deepEqual(h.texts(), [NOVEL_TASK]);
  assert.equal(h.state.dispatched[0].question.dialogueAct, 'coding_question');
  // Sanity: WITHOUT the judge the same text stays silent (this is what "dynamic" buys).
  const g = makeHarness();
  g.interviewerFinal(NOVEL_TASK, { punctuationSource: 'provider' });
  await g.advance(HARD_CAP_MS + QUIET + 2000);
  assert.deepEqual(g.texts(), [], `heuristics alone must not fire this (skips: ${g.state.skips.join(',')})`);
});

test('judge VETOES a pattern-matched question (exposition with a “?”) — trusted in both directions', async () => {
  const h = makeHarness();
  withJudge(h, async () => verdict({ is_ask: false, act: 'statement', answerability: 0.1 }));
  h.interviewerFinal(Q, { punctuationSource: 'provider' });
  await h.advance(QUIET + 200);
  assert.deepEqual(h.texts(), []);
  assert.ok(h.state.skips.includes('not_question'), `skips: ${h.state.skips.join(',')}`);
  // Vetoed and closed: nothing fires later either.
  await h.advance(HARD_CAP_MS + 5000);
  assert.deepEqual(h.texts(), []);
});

test('judge over deadline → heuristic verdict stands (the question still fires), and no timer leaks', async () => {
  const h = makeHarness();
  withJudge(h, () => new Promise(() => {}));           // never resolves
  h.interviewerFinal(Q, { punctuationSource: 'provider' });
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), [], 'no decision before the deadline');
  await h.advance(JUDGE_DEADLINE_MS + 50);
  assert.deepEqual(h.texts(), [Q], 'deadline → fall back to the heuristic answer');
  const judged = h.state.events.find(e => e.name === 'auto_answer_judged');
  assert.equal(judged.judgeOutcome, 'timeout');
});

test('judge rejection and unparseable replies fall back to the heuristic verdict', async () => {
  for (const [impl, outcome] of [
    [async () => { throw new Error('quota'); }, 'error'],
    [async () => 'I think so?', 'unparseable'],
    [async () => null, 'unparseable'],
  ]) {
    const h = makeHarness();
    withJudge(h, impl);
    h.interviewerFinal(Q, { punctuationSource: 'provider' });
    await h.advance(QUIET + 200);
    assert.deepEqual(h.texts(), [Q], `${outcome}: heuristic must stand`);
    assert.equal(h.state.events.find(e => e.name === 'auto_answer_judged')?.judgeOutcome, outcome);
  }
});

test('a verdict for a SUPERSEDED commit is DROPPED — only the latest consult routes, with the revised text', async () => {
  const h = makeHarness();
  const resolvers = [];
  withJudge(h, () => new Promise((r) => resolvers.push(r)));
  h.interviewerFinal('Tell me why you chose PostgreSQL over the alternatives', { punctuationSource: 'provider' });
  await h.advance(QUIET + 100);                        // commit 1 → judge call 1 (in flight)
  h.interviewerFinal('and how you migrated the data.', { punctuationSource: 'provider' });
  await h.advance(QUIET + 100);                        // revision → judge call 2
  assert.equal(resolvers.length, 2, 'the revision re-judges');
  resolvers[0](verdict({ answerability: 0.99 }));      // STALE verdict arrives late
  await flush(); await flush();
  assert.deepEqual(h.texts(), [], 'the stale verdict must not dispatch the half question');
  assert.ok(h.state.events.some(e => e.name === 'auto_answer_judged' && e.judgeOutcome === 'stale'));
  resolvers[1](verdict({ answerability: 0.95 }));
  await flush(); await flush();
  assert.equal(h.texts().length, 1);
  assert.ok(/migrated/.test(h.texts()[0]), `dispatches the REVISED text (got ${JSON.stringify(h.texts())})`);
});

test('a verdict landing after meeting stop routes nothing', async () => {
  const h = makeHarness();
  const resolvers = [];
  withJudge(h, () => new Promise((r) => resolvers.push(r)));
  h.interviewerFinal(Q, { punctuationSource: 'provider' });
  await h.advance(QUIET + 100);
  assert.equal(resolvers.length, 1);
  h.controller.onMeetingStop();
  h.state.meetingActive = false;
  resolvers[0](verdict());
  await flush(); await flush();
  assert.deepEqual(h.texts(), []);
  assert.equal(h.clock.pendingCount(), 0, 'no timer survives the stop');
});

test('judge telemetry carries no transcript text; prompts do carry the hot window', async () => {
  const h = makeHarness();
  const calls = withJudge(h, async () => verdict());
  h.interviewerFinal('Earlier context sentence for the window.', { punctuationSource: 'provider' });
  await h.advance(HARD_CAP_MS + QUIET + 1000);
  h.interviewerFinal(Q, { punctuationSource: 'provider' });
  await h.advance(QUIET + 200);
  const judged = h.state.events.filter(e => e.name === 'auto_answer_judged');
  assert.ok(judged.length >= 1);
  for (const e of judged) {
    const s = JSON.stringify(e).toLowerCase();
    assert.ok(!s.includes('postgresql') && !s.includes('context sentence'), `text leaked into telemetry: ${s}`);
  }
  const last = calls[calls.length - 1];
  assert.ok(last.recentTurns.some(t => /Earlier context sentence/.test(t.text)), 'judge sees the hot window');
  assert.ok(!last.recentTurns.some(t => t.text === Q), 'but not the candidate itself as a turn');
});

test('the judge never sees incomplete fragments or tiny backchannels (prefilter)', async () => {
  for (const text of ['How would you', 'Cool.']) {     // incomplete stub / backchannel
    const h = makeHarness();
    const calls = withJudge(h, async () => verdict());
    h.interviewerFinal(text, { punctuationSource: 'provider' });
    await h.advance(HARD_CAP_MS + QUIET + 2000);
    assert.equal(calls.length, 0, `no consult for ${JSON.stringify(text)} (got ${calls.length})`);
    assert.deepEqual(h.texts(), []);
  }
});

test('after a dispatch, later judge calls carry the answered text (semantic dedup of restatements)', async () => {
  const h = makeHarness();
  const calls = withJudge(h, async () => verdict({ act: 'coding_task' }));
  h.interviewerFinal(NOVEL_TASK, { punctuationSource: 'provider' });
  await h.advance(QUIET + 200);
  assert.equal(h.texts().length, 1);
  assert.equal(calls[0].lastAnsweredText ?? null, null, 'nothing answered before the first consult');
  h.controller.onEngineIdle();
  await h.advance(6000);
  h.interviewerFinal('And again, what we want from you is that checkout flow prototype we talked about.', { punctuationSource: 'provider' });
  await h.advance(QUIET + 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].lastAnsweredText, NOVEL_TASK, 'the judge sees what was already answered');
});

test('no judge hook → byte-identical heuristic pipeline (no judged telemetry at all)', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q, { punctuationSource: 'provider' });
  await h.advance(QUIET + 100);
  assert.deepEqual(h.texts(), [Q]);
  assert.equal(h.state.events.filter(e => e.name === 'auto_answer_judged').length, 0);
});
