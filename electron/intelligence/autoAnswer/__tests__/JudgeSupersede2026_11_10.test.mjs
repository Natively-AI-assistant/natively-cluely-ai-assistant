/**
 * Judge supersede economy (2026-11-10). Live TI run, 104 judge calls in 5.4 min:
 *  - 22 of 22 calls asked on a final that ended in a dash ("supports 3 operation—")
 *    were superseded: the speaker was mid-sentence, the early ask could never be used;
 *  - every superseded call was ABORTED, and the real host rejects an aborted call, so
 *    the "held verdict" path (an interim supersede keeps a positive verdict) never ran:
 *    the existing tests miss it because their fake judge ignores the signal;
 *  - stray speech after a finished question ("Put that down.", "Okay.") cancelled the
 *    verdict and paid for a new one each time; T08's answer sat ready 3.3 s.
 *
 * These tests use a judge that HONOURS the abort signal, as LLMHelper.generateJudgeVerdict does.
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
const { SimpleAutoAnswerEngine, STABILITY_MS, EARLY_JUDGE_MS, isInertUtterance, isCutOffEnding } = Simple;

const flush = () => new Promise((r) => setImmediate(r));
const YES = (over = {}) => JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', answerability: 0.95, question_text: null, ...over });
const NO = JSON.stringify({ is_ask: false, directed_at_user: false, complete: true, act: 'statement', answerability: 0, question_text: null });

/**
 * `calls[i]` = { req, signal, resolve, reject }. The judge rejects the moment its signal
 * aborts — the real host's behaviour ("judge aborted: superseded by newer speech").
 */
function makeHarness() {
  const clock = new FakeClock();
  const state = { turns: [], dispatched: [], skips: [], events: [], calls: [], logs: [] };
  const host = {
    isEnabled: () => true,
    isMeetingActive: () => true,
    meetingGeneration: () => 1,
    engineAccepting: () => true,
    answerStreamActive: () => false,
    recentTurns: () => state.turns,
    dispatch: (q) => { state.dispatched.push(q); },
    offer: () => {},
    cancelAutomaticAnswer: () => true,
    telemetry: (e) => { state.events.push(e); if (e.name === 'auto_answer_ignored') state.skips.push(e.skipReason); },
    log: (l) => state.logs.push(l),
    judgeCandidate: (req, signal) => new Promise((resolve, reject) => {
      const call = { req, signal, resolve, reject };
      state.calls.push(call);
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('judge aborted: superseded by newer speech'), { name: 'AbortError' })), { once: true });
    }),
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  const say = (text, final = true) => {
    if (final) state.turns.push({ role: 'interviewer', text, timestamp: clock.now() });
    engine.ingest({ speaker: 'interviewer', text, final, timestamp: clock.now(), origin: 'stt' });
  };
  const advance = async (ms) => { let left = ms; while (left > 0) { const s = Math.min(50, left); clock.advance(s); left -= s; await flush(); await flush(); } };
  const answer = async (i, raw) => { state.calls[i].resolve(raw); await flush(); await flush(); };
  return { engine, clock, state, say, advance, answer, texts: () => state.dispatched.map(d => d.text) };
}

// ── the classifier ────────────────────────────────────────────────────────

test('isInertUtterance: short finished non-asks are inert; anything that could change the ask is not', () => {
  for (const t of ['Okay.', 'Put that down.', 'Just put it down.', 'Take your time.', 'Mm-hmm.', 'Uh.', 'That\'s lovely.', 'Sounds good.']) {
    assert.equal(isInertUtterance(t, true), true, `inert: ${t}`);
  }
  for (const t of [
    'Why?',                                   // a question
    'And how you resolved it.',               // continues the ask
    'So what would you change?',              // a question with a lead
    'Now implement it in Python.',            // a new task
    'Show me.',                               // an imperative ask
    'Explain the trade-off.',                 // an imperative ask
    'Use three threads.',                     // a constraint
    'In O of 1 time.',                        // a constraint (continuation lead)
    'All three should run in average constant time.',   // too long to be sure
    'Our biggest pain is the weekend escalations.',     // report-shaped
    'Put that down',                          // a final with no full stop: unfinished
    'Second—',                                // cut off
    'First, insert a value.',                 // a list item of the spec (live T08)
    'Second, remove a value.',
    'Finally, keep it thread safe.',
    'The input is sorted.',                   // a constraint stated as a fact
    'A value can repeat.',
  ]) {
    assert.equal(isInertUtterance(t, true), false, `not inert: ${t}`);
  }
  // An interim is still being spoken, so it needs no full stop to stay inert, but the same leads disqualify it.
  assert.equal(isInertUtterance('uh', false), true);
  assert.equal(isInertUtterance('Put that', false), true);
  assert.equal(isInertUtterance('and also how', false), false);
  assert.equal(isInertUtterance('what about', false), false);
});

test('isCutOffEnding: a dash, ellipsis, comma or a dangling function word means mid-sentence', () => {
  for (const t of ['I want you to design a data structure that supports 3 operation—', 'Second—', 'First, insert a value-', 'So the thing is…', 'and then the', 'which is,']) {
    assert.equal(isCutOffEnding(t), true, `cut off: ${t}`);
  }
  for (const t of ['What is the time complexity?', 'Tell me about yourself.', 'Walk me through it', 'Let\'s do that.']) {
    assert.equal(isCutOffEnding(t), false, `not cut off: ${t}`);
  }
});

// ── a cut-off final is not asked early ─────────────────────────────────────

test('a final that ends mid-sentence is not asked early — the commit still judges if the speaker really stopped', async () => {
  const h = makeHarness();
  h.say('I want you to design a data structure that supports 3 operation—');
  await h.advance(EARLY_JUDGE_MS + 100);
  assert.equal(h.state.calls.length, 0, 'no early call on a cut-off final (22 of 22 were wasted live)');
  await h.advance(STABILITY_MS);
  assert.equal(h.state.calls.length, 1, 'a real stop is still judged at the commit');
});

test('a finished question is still asked early (no latency lost on real asks)', async () => {
  const h = makeHarness();
  h.say('What is the time complexity of your remove operation?');
  await h.advance(EARLY_JUDGE_MS + 60);
  assert.equal(h.state.calls.length, 1);
});

// ── an interim no longer throws the verdict away ───────────────────────────

test('an inert INTERIM keeps the call alive: the verdict is held and applied, one call (abort-honouring judge)', async () => {
  const h = makeHarness();
  h.say('Why did you choose PostgreSQL over the alternatives on that project?');
  await h.advance(EARLY_JUDGE_MS + 60);
  assert.equal(h.state.calls.length, 1);
  h.say('uh', false);
  assert.equal(h.state.calls[0].signal.aborted, false, 'a filler interim cannot change the ask: keep paying for the verdict we will use');
  await h.answer(0, YES());
  assert.deepEqual(h.texts(), [], 'never dispatched while the interviewer is audibly there');
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.state.calls.length, 1, 'no second call');
  assert.equal(h.texts().length, 1, 'the held verdict dispatches at the quiet point');
});

test('an interim that starts a new ask still aborts the call', async () => {
  const h = makeHarness();
  h.say('Why did you choose PostgreSQL over the alternatives on that project?');
  await h.advance(EARLY_JUDGE_MS + 60);
  h.say('And what about', false);
  assert.equal(h.state.calls[0].signal.aborted, true);
});

test('an interim that grows past inert aborts the call then', async () => {
  const h = makeHarness();
  h.say('Why did you choose PostgreSQL over the alternatives on that project?');
  await h.advance(EARLY_JUDGE_MS + 60);
  h.say('You need', false);
  assert.equal(h.state.calls[0].signal.aborted, false);
  h.say('You need to get out of here right now', false);
  assert.equal(h.state.calls[0].signal.aborted, true, 'eight words is past what can be ruled inert');
});

// ── inert growth after a finished question (the T08 case) ──────────────────

test('stray short speech after a finished question: no re-judge, no cancel; the question is answered once', async () => {
  const h = makeHarness();
  h.say('All three should run in average constant time. How would you build it?');
  await h.advance(EARLY_JUDGE_MS + 60);
  assert.equal(h.state.calls.length, 1);
  h.say('Put', false);
  h.say('Put that down.');                                   // stray speech, a final
  assert.equal(h.state.calls[0].signal.aborted, false, 'the verdict in flight still answers the same ask');
  await h.advance(400);
  await h.answer(0, YES({ question_text: 'How would you build it?' }));
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.state.calls.length, 1, 'the grown candidate is not re-judged');
  assert.deepEqual(h.texts(), ['How would you build it?']);
  assert.ok(h.state.events.some(e => e.judgeOutcome === 'held_applied'));
});

test('the stoppage after inert growth waits for the call in flight instead of starting another', async () => {
  const h = makeHarness();
  h.say('How would you shard the users table once it outgrows one box?');
  await h.advance(EARLY_JUDGE_MS + 60);
  h.say('Okay.');
  await h.advance(STABILITY_MS + 200);                        // the commit window passes while the judge is out
  assert.equal(h.state.calls.length, 1, 'no second call while the first can still answer');
  await h.answer(0, YES());
  assert.equal(h.texts().length, 1, 'applied as soon as it lands, since the speaker has already stopped');
});

test('a silent verdict with inert growth stays silent and costs no second call', async () => {
  const h = makeHarness();
  h.say('So that is roughly how the ingestion pipeline is put together today.');
  await h.advance(EARLY_JUDGE_MS + 60);
  h.say('Okay.');
  await h.answer(0, NO);
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.state.calls.length, 1);
  assert.deepEqual(h.texts(), []);
});

test('a failed call with inert growth is retried on the grown text — nothing goes unjudged', async () => {
  const h = makeHarness();
  h.say('How would you shard the users table once it outgrows one box?');
  await h.advance(EARLY_JUDGE_MS + 60);
  h.say('Okay.');
  await h.advance(STABILITY_MS + 200);
  h.state.calls[0].reject(new Error('provider 503'));
  await flush(); await flush();
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.state.calls.length, 2, 'the grown candidate is judged after the failure');
  assert.ok(/shard the users table.*Okay\./s.test(h.state.calls[1].req.candidateText));
});

// ── growth that can change the ask still re-judges ─────────────────────────

for (const [label, growth] of [
  ['a follow-up question', 'Why?'],
  ['a continuation', 'And how you resolved it.'],
  ['a new task', 'Now implement it in Python.'],
  ['a long sentence', 'A man who killed my wife is still out there.'],
]) {
  test(`growth that can change the ask re-judges and cancels the old call: ${label}`, async () => {
    const h = makeHarness();
    h.say('Tell me about a time you disagreed with a teammate on a technical decision.');
    await h.advance(EARLY_JUDGE_MS + 60);
    h.say(growth);
    assert.equal(h.state.calls[0].signal.aborted, true, 'the old verdict is not about the current ask');
    await h.advance(STABILITY_MS + 200);
    assert.equal(h.state.calls.length, 2);
    assert.ok(h.state.calls[1].req.candidateText.includes(growth.replace(/\.$/, '')));
  });
}

test('an unfinished question is never carried over, however short the growth', async () => {
  const h = makeHarness();
  h.say('Tell me about the hardest bug you ever');
  await h.advance(STABILITY_MS + 100);
  assert.equal(h.state.calls.length, 1);
  h.say('fixed.');
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.state.calls.length, 2, 'the growth may complete the question: re-judge');
});

test('a STATEMENT\'s call is still cancelled by an interim — finishing it rarely pays (replay: 12 of 17 such verdicts went unused)', async () => {
  const h = makeHarness();
  h.say('So that is roughly how the ingestion pipeline is put together today.');
  await h.advance(EARLY_JUDGE_MS + 60);
  assert.equal(h.state.calls.length, 1);
  h.say('uh', false);
  assert.equal(h.state.calls[0].signal.aborted, true);
});
