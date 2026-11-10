/**
 * Structure guard + call savers (2026-11-10). Live TI run on main+supersede fix:
 *  - "design a data structure that supports 3 operations." was answered, then answered
 *    again after "First… Second…", then again after "And third…": three answer
 *    generations for one ask. The judge prompt already forbids it; the model fires anyway.
 *  - "Say a node service is slowly running out of memory over a few days." was answered
 *    before "How would you go about debugging that?" arrived.
 *  - 5 of 9 superseded calls were asked on a final with no full stop ("We'll spend about")
 *    in a transcript that punctuates every finished sentence.
 *  - "First, insert a value." was ruled incomplete and re-judged byte-identical 1.7 s later.
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
const { SimpleAutoAnswerEngine, STABILITY_MS, EARLY_JUDGE_MS, STRUCTURE_GRACE_MS, PUNCTUATING_MIN_FINALS, awaitsStructure } = Simple;

const flush = () => new Promise((r) => setImmediate(r));
const YES = JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', answerability: 0.95, question_text: null });
const NO = JSON.stringify({ is_ask: false, directed_at_user: false, complete: true, act: 'statement', answerability: 0, question_text: null });
const INCOMPLETE = JSON.stringify({ is_ask: true, directed_at_user: true, complete: false, act: 'incomplete', answerability: 0.1, question_text: null });

function rig(judge = () => YES) {
  const clock = new FakeClock();
  const state = { calls: [], dispatched: [], prefetched: [], logs: [] };
  const host = {
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    answerStreamActive: () => false, recentTurns: () => [], offer() {}, cancelAutomaticAnswer: () => true,
    dispatch: (q) => state.dispatched.push(q.text), telemetry() {}, log: (l) => state.logs.push(l),
    prefetchAnswer: (id, text) => state.prefetched.push(text),
    speculativeSnapshot: () => ({ questionId: null, text: null }),
    judgeCandidate: async (req) => { state.calls.push(req.candidateText); return judge(req.candidateText, state.calls.length); },
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  const say = (text, final = true) => engine.ingest({ speaker: 'interviewer', text, final, timestamp: clock.now(), origin: 'stt' });
  const advance = async (ms) => { let left = ms; while (left > 0) { const s = Math.min(50, left); clock.advance(s); left -= s; await flush(); await flush(); } };
  return { engine, state, say, advance };
}

test('awaitsStructure: an announced count not yet delivered, or a scene with no ask', () => {
  for (const t of [
    'I want you to design a data structure that supports 3 operations.',
    'I want you to design a data structure that supports three operations. First, insert a value.',
    'It supports three operations. First, insert a value. Second, remove a value.',
    'I have two questions.',
    'There are a few things I want to cover.',
    'Design a class with the following methods:',
    'Say a node service in production is slowly running out of memory over a few days.',
    'Okay, so imagine you have a billion rows in one table.',
    'Let\'s say the cache goes down.',
  ]) assert.equal(awaitsStructure(t), true, `waits: ${t}`);
  for (const t of [
    'It supports three operations. First, insert a value. Second, remove a value. And third, get a random element.',
    'It supports three operations. First, insert. Finally, remove.',
    'I have two questions. What is a mutex? And how is it different from a semaphore?',
    'It supports three operations: insert, remove and get random.',
    'So just these 3 operations.',
    'Those are all three parts.',
    'What are the three operations?',
    'Say a node service is running out of memory. How would you debug that?',
    'Suppose the cache goes down, what happens to the read path?',
    'Imagine you are the on-call engineer, how would you respond?',
    'Why did you choose Postgres?',
    'Tell me about yourself.',
    'I want you to design a data structure that supports 3 operations. Does that make sense?',
  ]) assert.equal(awaitsStructure(t), false, `does not wait: ${t}`);
});

test('an announced list is judged ONCE, when it is delivered — no call and no prefetch on the announcement or its halves', async () => {
  const h = rig();
  h.say('I want you to design a data structure that supports 3 operations.');
  await h.advance(STABILITY_MS + 300);
  assert.equal(h.state.calls.length, 0, 'the announcement alone costs nothing');
  assert.equal(h.state.prefetched.length, 0, 'and starts no answer');
  await h.advance(1500);
  h.say('First, insert a value.');
  await h.advance(STABILITY_MS + 1500);
  h.say('Second, remove a value.');
  await h.advance(STABILITY_MS + 1500);
  assert.equal(h.state.calls.length, 0, 'two of three: still waiting');
  h.say('And third, get a random element where every element has the same probability.');
  await h.advance(STABILITY_MS + 300);
  assert.equal(h.state.calls.length, 1);
  assert.match(h.state.calls[0], /3 operations\. First, insert a value\. Second, remove a value\. And third/, 'the judge sees the whole spec');
  assert.equal(h.state.dispatched.length, 1, 'answered once');
});

test('a scene waits for its question, then one call carries both', async () => {
  const h = rig();
  h.say('Say a node service in production is slowly running out of memory over a few days.');
  await h.advance(STABILITY_MS + 1500);
  assert.equal(h.state.calls.length, 0);
  h.say('How would you go about debugging that?');
  await h.advance(STABILITY_MS + 300);
  assert.equal(h.state.calls.length, 1);
  assert.match(h.state.calls[0], /running out of memory.*How would you go about debugging that\?/);
  assert.equal(h.state.dispatched.length, 1);
});

test('nothing is lost: if the speaker stays quiet, the candidate is judged as it stands after the grace', async () => {
  const h = rig();
  h.say('I want you to design a data structure that supports 3 operations.');
  await h.advance(STRUCTURE_GRACE_MS - 200);
  assert.equal(h.state.calls.length, 0);
  await h.advance(400);
  assert.equal(h.state.calls.length, 1, 'judged after the grace');
  assert.equal(h.state.dispatched.length, 1, 'and answered if the judge says so');
});

test('the grace restarts when the interviewer keeps talking', async () => {
  const h = rig();
  h.say('Say the cache cluster goes down during peak traffic.');
  await h.advance(STRUCTURE_GRACE_MS - 500);
  h.say('and the', false);                                   // still talking
  await h.advance(1000);
  assert.equal(h.state.calls.length, 0, 'the old grace did not fire mid-speech');
});

test('an unterminated final is not asked early once the transcript has shown it punctuates', async () => {
  const h = rig(() => NO);
  for (let i = 0; i < PUNCTUATING_MIN_FINALS; i++) {
    h.say(`This is finished statement number ${i} about how the system behaves.`);
    await h.advance(STABILITY_MS + 200);
  }
  const before = h.state.calls.length;
  h.say('We will spend roughly forty five minutes');   // no full stop: the sentence is still going
  await h.advance(EARLY_JUDGE_MS + 200);
  assert.equal(h.state.calls.length, before, 'no early call');
  await h.advance(STABILITY_MS);
  assert.equal(h.state.calls.length, before + 1, 'a real stop is judged at the commit');
});

test('a transcript that never punctuates keeps its early ask', async () => {
  const h = rig(() => NO);
  for (let i = 0; i < PUNCTUATING_MIN_FINALS; i++) {
    h.say(`this is statement number ${i} about how the system behaves`);
    await h.advance(STABILITY_MS + 200);
  }
  const before = h.state.calls.length;
  h.say('why did you choose postgres over the alternatives');
  await h.advance(EARLY_JUDGE_MS + 60);
  assert.equal(h.state.calls.length, before + 1);
});

test('an "incomplete" verdict is not re-bought on the same words; more speech still re-judges', async () => {
  const h = rig((text, n) => (n === 1 ? INCOMPLETE : YES));
  h.say('Okay, so the thing I would like you to think about here.');
  await h.advance(EARLY_JUDGE_MS + 200);
  assert.equal(h.state.calls.length, 1);
  await h.advance(STABILITY_MS * 3);
  assert.equal(h.state.calls.length, 1, 'the commit does not ask again');
  h.say('How would you roll this out without downtime?');
  await h.advance(STABILITY_MS + 300);
  assert.equal(h.state.calls.length, 2);
  assert.equal(h.state.dispatched.length, 1);
});
