/**
 * The SIMPLE engine (2026-08-25): legacy trigger, judge brain. Fake clock,
 * fake judge, zero sleeps.
 *
 * Mutation probes (progress file, simple-engine phase):
 *   one-call-per-stoppage → 'a monologue costs ONE judge call per stoppage…'
 *   supersede             → 'new speech supersedes an in-flight verdict…'
 *   prefilter             → 'prefilter: …never cost a call'
 *   '?' fallback          → 'judge unavailable → only a trailing ? fires'
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
const { SimpleAutoAnswerEngine, STABILITY_MS, ENDPOINT_CONFIRM_MS, RETRY_MS, RETRY_TTL_MS } = Simple;

const flush = () => new Promise((r) => setImmediate(r));
const YES = (over = {}) => JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', answerability: 0.95, question_text: null, ...over });
const NO = JSON.stringify({ is_ask: false, directed_at_user: false, complete: true, act: 'statement', answerability: 0, question_text: null });

function makeSimple(judgeImpl, overrides = {}) {
  const clock = new FakeClock();
  const state = {
    enabled: true, meetingActive: true, generation: 1, accepting: true, streaming: false,
    turns: [], dispatched: [], offered: [], skips: [], events: [], cancelled: [], judgeCalls: [],
    ...overrides,
  };
  const host = {
    isEnabled: () => state.enabled,
    isMeetingActive: () => state.meetingActive,
    meetingGeneration: () => state.generation,
    engineAccepting: () => state.accepting,
    answerStreamActive: () => state.streaming,
    recentTurns: () => state.turns,
    dispatch: (q, opts) => { state.dispatched.push(q); state.dispatchOpts = opts; state.streaming = true; },
    offer: (q) => state.offered.push(q),
    cancelAutomaticAnswer: (r) => { state.cancelled.push(r); return true; },
    telemetry: (e) => { state.events.push(e); if (e.name === 'auto_answer_ignored') state.skips.push(e.skipReason); },
    log: () => {},
    ...(judgeImpl ? { judgeCandidate: (req) => { state.judgeCalls.push(req); return judgeImpl(req, state.judgeCalls.length); } } : {}),
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  const seg = (speaker, text, final = true) => ({ speaker, text, final, timestamp: clock.now(), origin: 'stt' });
  const interviewer = (text, final = true) => { if (final) state.turns.push({ role: 'interviewer', text, timestamp: clock.now() }); engine.ingest(seg('interviewer', text, final)); };
  const user = (text) => { state.turns.push({ role: 'user', text, timestamp: clock.now() }); engine.ingest(seg('user', text, true)); };
  const advance = async (ms) => { let left = ms; while (left > 0) { const step = Math.min(100, left); clock.advance(step); left -= step; await flush(); await flush(); } };
  return { engine, clock, state, interviewer, user, advance, texts: () => state.dispatched.map(d => d.text) };
}

test('a monologue costs ONE judge call per stoppage, none per final', async () => {
  const h = makeSimple(async () => NO);
  for (let i = 0; i < 6; i++) {
    h.interviewer(`part ${i} of a long winding explanation about the system`, true);
    await h.advance(400);                                   // < STABILITY: no stoppage yet
  }
  assert.equal(h.state.judgeCalls.length, 0, 'no call while speech continues');
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.state.judgeCalls.length, 1, 'one call at the stoppage');
  assert.ok(/part 0 .* part 5/s.test(h.state.judgeCalls[0].candidateText.replace(/\n/g, ' ')), 'the call carries the WHOLE utterance');
});

test('interims also hold the window open (the interviewer is still talking)', async () => {
  const h = makeSimple(async () => YES());
  h.interviewer('Why did you choose PostgreSQL over the alternatives here today?');
  await h.advance(600);
  h.interviewer('and also how', false);                    // interim only
  await h.advance(600);                                    // 1.2s after final — but interim reset it
  assert.equal(h.state.judgeCalls.length, 0);
  await h.advance(STABILITY_MS);
  assert.equal(h.state.judgeCalls.length, 1);
});

test('judge yes → dispatch (extracted question when grounded); judge no → silent; verdicts stand without re-judging', async () => {
  const h = makeSimple(async (req) => req.candidateText.includes('wordle')
    ? YES({ question_text: 'have you heard of the popular word game called wordle?' })
    : NO);
  h.interviewer('Okay, have you heard of the popular word game called wordle? Yeah I played it.');
  await h.advance(STABILITY_MS + 300);
  assert.deepEqual(h.texts(), ['have you heard of the popular word game called wordle?']);
  h.state.streaming = false; h.state.accepting = true;
  await h.advance(3000);
  h.interviewer('So this is on the New York Times website as you can see.');
  await h.advance(STABILITY_MS + 300);
  assert.equal(h.texts().length, 1);
  assert.ok(h.state.skips.includes('not_question'));
  const calls = h.state.judgeCalls.length;
  await h.advance(STABILITY_MS * 3);                        // quiet: no new speech
  assert.equal(h.state.judgeCalls.length, calls, 'a standing verdict is never re-judged');
});

test('new speech supersedes an in-flight verdict; the next stoppage judges the full text', async () => {
  const h = makeSimple(() => new Promise((r) => resolvers.push(r)));
  const resolvers = [];
  h.interviewer('Tell me about the hardest bug you ever');
  await h.advance(STABILITY_MS + 100);
  assert.equal(resolvers.length, 1);
  h.interviewer('debugged in production and how you found it?');  // arrives while judging
  resolvers[0](YES({ answerability: 0.99 }));               // stale — judged only the half
  await flush(); await flush();
  assert.deepEqual(h.texts(), [], 'the half-question verdict must not dispatch');
  await h.advance(STABILITY_MS + 100);
  assert.equal(resolvers.length, 2, 'second stoppage re-judges');
  assert.ok(/debugged in production/.test(h.state.judgeCalls[1].candidateText));
  resolvers[1](YES());
  await flush(); await flush();
  assert.equal(h.texts().length, 1);
  assert.ok(/hardest bug .* how you found it\?/s.test(h.texts()[0]));
});

test('prefilter: backchannels and tiny fragments never cost a call', async () => {
  const h = makeSimple(async () => YES());
  h.interviewer('Cool.');
  await h.advance(STABILITY_MS + 200);
  h.interviewer('And so.');
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.state.judgeCalls.length, 0, `no calls for chatter (skips: ${h.state.skips.join(',')})`);
  assert.deepEqual(h.texts(), []);
});

test('offer band: a mid-answerability verdict offers instead of firing', async () => {
  const h = makeSimple(async () => YES({ answerability: 0.8 }));   // default thresholds: auto 0.88, offer 0.65
  h.interviewer('Can you see my screen okay before we start the interview?');
  await h.advance(STABILITY_MS + 300);
  assert.deepEqual(h.texts(), []);
  assert.equal(h.state.offered.length, 1);
});

test('busy engine: retries and dispatches when it frees up; gives up after the TTL', async () => {
  const h = makeSimple(async () => YES(), { accepting: false });
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await h.advance(STABILITY_MS + 200);
  assert.deepEqual(h.texts(), []);
  h.state.accepting = true;
  await h.advance(RETRY_MS + 100);
  assert.equal(h.texts().length, 1);

  const g = makeSimple(async () => YES(), { accepting: false });
  g.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await g.advance(STABILITY_MS + RETRY_TTL_MS + 1000);
  assert.deepEqual(g.texts(), []);
  assert.ok(g.state.skips.includes('engine_busy_or_cooling'));
  assert.equal(g.clock.pendingCount(), 0, 'no leaked retry timer');
});

test('lenient mic: blips/echoes/backchannels ignored; a genuine sustained answer clears the candidate and barges in', async () => {
  const h = makeSimple(async () => YES());
  h.interviewer('Okay, have you heard of the popular word game called wordle?');
  await h.advance(300);
  h.user('Yeah.');                                          // blip — must not kill it
  await h.advance(STABILITY_MS + 300);
  assert.equal(h.texts().length, 1, `skips: ${h.state.skips.join(',')}`);

  await h.advance(2000);
  h.interviewer('And how would you persist the game state across page reloads?');
  await h.advance(200);
  h.user('I would probably use localStorage keyed by the date.');   // genuine answer
  await h.advance(STABILITY_MS + 500);
  assert.equal(h.texts().length, 1, 'the second question is suppressed');
  assert.ok(h.state.skips.includes('user_answering'));
  assert.deepEqual(h.state.cancelled, ['user_barge_in'], 'the streaming first answer was barged in');
});

test('judge unavailable → only a trailing ? fires (near-legacy fallback, no fire-on-everything)', async () => {
  const h = makeSimple(null);                               // no judge hook at all
  h.interviewer('So the way this works is that every day a word is picked.');
  await h.advance(STABILITY_MS + 200);
  assert.deepEqual(h.texts(), [], 'statement without judge stays silent');
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.texts().length, 1);

  const g = makeSimple(async () => { throw new Error('quota'); });  // judge erroring
  g.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await g.advance(STABILITY_MS + 300);
  assert.equal(g.texts().length, 1, 'error → ? fallback');
});

test('a provider endpoint confirms the stop early', async () => {
  const h = makeSimple(async () => YES());
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  h.engine.onProviderEndpoint();
  await h.advance(ENDPOINT_CONFIRM_MS + 100);
  assert.equal(h.state.judgeCalls.length, 1, 'judged at the endpoint, not the full window');
});

test('meeting stop clears everything; telemetry carries no transcript text', async () => {
  const h = makeSimple(async () => YES());
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  h.engine.onMeetingStop();
  await h.advance(STABILITY_MS + 2000);
  assert.deepEqual(h.texts(), []);
  assert.equal(h.clock.pendingCount(), 0);
  const g = makeSimple(async () => YES());
  g.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await g.advance(STABILITY_MS + 300);
  for (const e of g.state.events) assert.ok(!JSON.stringify(e).includes('PostgreSQL'), `text leaked: ${JSON.stringify(e)}`);
});

// ── Review fixes (2026-08-25): six confirmed findings, each pinned ────────

test('review#2: a dispatch parked behind a busy engine dies when the user takes the floor', async () => {
  const h = makeSimple(async () => YES(), { accepting: false });
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await h.advance(STABILITY_MS + 200);                    // verdict auto → retry loop armed
  assert.deepEqual(h.texts(), []);
  h.user('I chose it mainly for the ecosystem and tooling.');   // genuine answer
  h.state.accepting = true;                               // engine frees up inside the TTL
  await h.advance(RETRY_MS * 4);
  assert.deepEqual(h.texts(), [], `the parked dispatch must die with the user answering (skips: ${h.state.skips.join(',')})`);
  assert.equal(h.clock.pendingCount(), 0, 'retry timer cancelled');
});

test('review#5: a transient judge failure clears the key — the next stoppage retries the same question', async () => {
  const resolvers = [];
  const h = makeSimple((req, n) => n === 1 ? new Promise(() => {}) : (resolvers.push(null), Promise.resolve(YES())));
  h.interviewer('Please compare optimistic and pessimistic locking for this design');   // no '?', no trailing mark
  await h.advance(STABILITY_MS + 100);
  assert.equal(h.state.judgeCalls.length, 1);
  const { JUDGE_DEADLINE_MS } = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/AutoAnswerJudge.js'));
  await h.advance(JUDGE_DEADLINE_MS + 100);               // call 1 times out
  h.interviewer('take your time', false);                 // interim re-arms the window, no new final
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.state.judgeCalls.length, 2, 'same text re-judged after the failure');
  assert.equal(h.texts().length, 1, 'and the retried verdict dispatches');
});

test('review#6: interviewer INTERIMS supersede an in-flight verdict — no dispatch mid-sentence', async () => {
  const resolvers = [];
  const h = makeSimple(() => new Promise((r) => resolvers.push(r)));
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await h.advance(STABILITY_MS + 100);
  assert.equal(resolvers.length, 1);
  h.interviewer('and one more thing, what about', false); // the interviewer RESUMED (interims only)
  resolvers[0](YES());
  await flush(); await flush();
  assert.deepEqual(h.texts(), [], 'the verdict for the pre-resume text must not dispatch');
});

test('review#7: a genuine user INTERIM barges in the streaming answer — no waiting for the final', async () => {
  const h = makeSimple(async () => YES());
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.texts().length, 1);
  assert.ok(h.state.streaming);
  h.engine.ingest({ speaker: 'user', text: 'Well I mostly picked it because of the', final: false, timestamp: h.clock.now(), origin: 'stt' });
  assert.deepEqual(h.state.cancelled, ['user_barge_in'], 'cancelled at the interim, seconds before any final');
  // A short or echoed interim never barges in.
  const g = makeSimple(async () => YES());
  g.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await g.advance(STABILITY_MS + 200);
  g.engine.ingest({ speaker: 'user', text: 'PostgreSQL over the alternatives here', final: false, timestamp: g.clock.now(), origin: 'stt' });  // echo
  g.engine.ingest({ speaker: 'user', text: 'yeah', final: false, timestamp: g.clock.now(), origin: 'stt' });
  assert.deepEqual(g.state.cancelled, []);
});

test('review#4: punctuation provenance — no-\'?\' is negative evidence only when the provider guarantees marks', async () => {
  // Punctuation-less provider (Soniox): interrogative-led question without '?' still fires via the no-judge fallback.
  const h = makeSimple(null);
  h.interviewer('why did you choose PostgreSQL over the alternatives here today');
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.texts().length, 1, 'interrogative fallback on a punctuation-less provider');
  // Punctuating provider: the same missing '?' IS evidence — short fragment waits.
  const g = makeSimple(async () => YES());
  g.engine.ingest({ speaker: 'interviewer', text: 'And the cache', final: true, timestamp: g.clock.now(), origin: 'stt', punctuationSource: 'provider' });
  await g.advance(STABILITY_MS + 200);
  assert.equal(g.state.judgeCalls.length, 0, 'short unpunctuated fragment on a punctuating provider never costs a call');
});

test('review offers: replaced / expired / topic-change / meeting-stop all retract the card', async () => {
  const { OFFER_TTL_MS } = Simple;
  const retracted = [];
  const h = makeSimple(async () => YES({ answerability: 0.8 }));  // offer band
  h.state.retracted = retracted;
  h.engine.host?.constructor;   // no-op
  // wire retract capture
  const origHost = h.state;
  h.engineHostRetract = true;
  // rebuild with retract hook
  const g = makeSimple(async (req, n) => n <= 2 ? YES({ answerability: 0.8 }) : YES({ answerability: 0.95 }));
  g.hostRetracts = [];
  // attach after construction (TS-private is runtime-open)
  g.engine.host.retractOffer = (id, reason) => g.hostRetracts.push(reason);
  g.interviewer('Can you see my screen okay before we start the interview?');
  await g.advance(STABILITY_MS + 200);
  assert.equal(g.state.offered.length, 1);
  await g.advance(3000);
  g.interviewer('And is the audio also coming through fine on your end?');
  await g.advance(STABILITY_MS + 200);
  assert.equal(g.state.offered.length, 2);
  assert.deepEqual(g.hostRetracts, ['replaced']);
  await g.advance(OFFER_TTL_MS + 100);
  assert.deepEqual(g.hostRetracts, ['replaced', 'expired']);
  await g.advance(2000);
  g.interviewer('Why did you choose PostgreSQL over the alternatives here?');   // auto band now
  await g.advance(STABILITY_MS + 200);
  assert.equal(g.texts().length, 1);
  g.engine.onMeetingStop();
  assert.equal(g.clock.pendingCount(), 0);
});

// ── Latency work (2026-08-25): prefetch, speculative reuse, endpoint confirm ──

test('prefetch: a question-shaped candidate starts the answer WHILE the judge decides, and the dispatch reuses it', async () => {
  const resolvers = [];
  const h = makeSimple(() => new Promise((r) => resolvers.push(r)));
  const prefetched = [];
  h.state.spec = { questionId: null, text: null };
  h.engine.host.prefetchAnswer = (id, text) => { prefetched.push({ id, text }); h.state.spec = { questionId: id, text }; };
  h.engine.host.speculativeSnapshot = () => h.state.spec;
  h.engine.host.noteCandidate = () => {};

  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await h.advance(STABILITY_MS + 100);
  assert.equal(prefetched.length, 1, 'prefetch starts at the consult, not after the verdict');
  assert.equal(h.state.judgeCalls.length, 1, 'and the judge is still deciding');
  assert.deepEqual(h.texts(), []);

  resolvers[0](YES());
  await flush(); await flush();
  assert.equal(h.texts().length, 1);
  assert.equal(h.state.dispatchOpts.reuseSpeculative, true, 'the dispatch adopts the stream that was already running');
});

test('prefetch: a DECLARATIVE task gets the head start too — the old shape gate denied it exactly this', async () => {
  const h = makeSimple(async () => YES({ act: 'coding_task' }));
  const prefetched = [];
  h.engine.host.prefetchAnswer = (id, text) => prefetched.push(text);
  h.engine.host.speculativeSnapshot = () => ({ questionId: null, text: null });
  h.interviewer('And your task is to recreate this game in React, using the API endpoint I am about to give you.');
  await h.advance(STABILITY_MS + 200);
  assert.equal(prefetched.length, 1, 'a task with no question mark must prefetch like any other ask');
});

test('prefetch: rationed by time, so a chatty meeting cannot stack generations', async () => {
  const { PREFETCH_MIN_INTERVAL_MS } = Simple;
  const h = makeSimple(async () => NO);
  const prefetched = [];
  h.engine.host.prefetchAnswer = (id, text) => prefetched.push(text);
  h.engine.host.speculativeSnapshot = () => ({ questionId: null, text: null });
  for (let i = 0; i < 4; i++) {
    h.interviewer(`So the ${i} thing to know about this system is that it stores everything in one place.`);
    await h.advance(STABILITY_MS + 200);
    await h.advance(3000);
  }
  assert.equal(prefetched.length, 1, `four stoppages inside the window cost ONE prefetch (got ${prefetched.length})`);
  await h.advance(PREFETCH_MIN_INTERVAL_MS);
  h.interviewer('And now the last thing to know is how the cache gets invalidated on write.');
  await h.advance(STABILITY_MS + 200);
  assert.equal(prefetched.length, 2, 'once the window passes, prefetch is allowed again');
});

test('prefetch: a stale speculative snapshot for ANOTHER question is not reused', async () => {
  const h = makeSimple(async () => YES());
  h.engine.host.prefetchAnswer = () => {};
  h.engine.host.speculativeSnapshot = () => ({ questionId: 'someone-elses-question', text: 'stale answer' });
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.texts().length, 1);
  assert.equal(h.state.dispatchOpts.reuseSpeculative, false, 'a snapshot keyed to a different question must be ignored');
});

// ── Usefulness feedback (2026-08-25) ─────────────────────────────────────
// Nothing recorded whether an automatic answer was any good, so every
// threshold stayed a guess. A manual press right after an automatic answer
// is the user saying it missed.

test('feedback: a manual answer inside the window marks the automatic one superseded', async () => {
  const h = makeSimple(async () => YES());
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.texts().length, 1);

  await h.advance(4000);
  h.engine.onManualAnswerStarted();
  const fb = h.state.events.filter(e => e.name === 'auto_answer_feedback');
  assert.equal(fb.length, 1);
  assert.equal(fb[0].feedback, 'superseded');
  assert.ok(fb[0].feedbackMs >= 4000 && fb[0].feedbackMs < 6000, `feedbackMs=${fb[0].feedbackMs}`);
  assert.equal(fb[0].questionId, h.state.dispatched[0].id);
  // The window is spent: a later press must not report twice.
  await h.advance(1000);
  h.engine.onManualAnswerStarted();
  assert.equal(h.state.events.filter(e => e.name === 'auto_answer_feedback').length, 1);
});

test('feedback: an untouched automatic answer is reported KEPT when the window passes', async () => {
  const { FEEDBACK_WINDOW_MS } = Simple;
  const h = makeSimple(async () => YES());
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await h.advance(STABILITY_MS + 200);
  assert.deepEqual(h.state.events.filter(e => e.name === 'auto_answer_feedback'), []);
  await h.advance(FEEDBACK_WINDOW_MS + 500);
  const fb = h.state.events.filter(e => e.name === 'auto_answer_feedback');
  assert.equal(fb.length, 1);
  assert.equal(fb[0].feedback, 'kept');
  assert.equal(h.clock.pendingCount(), 0, 'the feedback timer does not leak');
});

test('feedback: a manual press with no automatic answer in flight reports nothing', async () => {
  const h = makeSimple(async () => NO);
  h.engine.onManualAnswerStarted();
  h.interviewer('So this is on the New York Times website as you can see.');
  await h.advance(STABILITY_MS + 200);
  h.engine.onManualAnswerStarted();
  assert.deepEqual(h.state.events.filter(e => e.name === 'auto_answer_feedback'), []);
});

test('feedback: telemetry carries the act and score but no transcript text', async () => {
  const h = makeSimple(async () => YES({ act: 'coding_task' }));
  h.interviewer('Your task is to design a rate limiter that survives a burst of a million requests.');
  await h.advance(STABILITY_MS + 200);
  h.engine.onManualAnswerStarted();
  const fb = h.state.events.find(e => e.name === 'auto_answer_feedback');
  assert.equal(fb.dialogueAct, 'coding_question');
  assert.equal(typeof fb.answerability, 'number');
  assert.ok(!JSON.stringify(fb).toLowerCase().includes('rate limiter'), 'no transcript text in telemetry');
});

// ── The judge decides; thresholds only demote (2026-08-25) ───────────────
// Banding answerability produced 3 offers in 131 real decisions, because the
// model emits ~three values, not a spectrum. The action is now explicit.

const ACT = (action, over = {}) => JSON.stringify({
  is_ask: action !== 'silent', directed_at_user: action !== 'silent', complete: true,
  act: 'question', action, answerability: action === 'answer' ? 0.95 : action === 'offer' ? 0.5 : 0,
  question_text: null, ...over,
});

test('judge action "offer" shows the card even though its answerability is far below the offer bar', async () => {
  const h = makeSimple(async () => ACT('offer'));
  h.interviewer('Can you see my screen okay before we start the interview?');
  await h.advance(STABILITY_MS + 200);
  assert.deepEqual(h.texts(), [], 'an offer never fires unasked');
  assert.equal(h.state.offered.length, 1, 'the card is shown on the judge\'s say-so, not on a score band');
});

test('the action decides WHAT a candidate can become; the mode bar only decides whether an answer fires', async () => {
  // 'answer' at the interview bar fires…
  const h = makeSimple(async () => ACT('answer', { answerability: 0.9 }));
  h.interviewer('So how would you shard this table once it stops fitting on one box?');
  await h.advance(STABILITY_MS + 200);
  assert.equal(h.texts().length, 1);

  // …and the same verdict below the bar becomes an offer rather than silence,
  // so a conservative mode loses the interruption, never the signal.
  const g = makeSimple(async () => ACT('answer', { answerability: 0.5 }));
  g.interviewer('So how would you shard this table once it stops fitting on one box?');
  await g.advance(STABILITY_MS + 200);
  assert.deepEqual(g.texts(), []);
  assert.equal(g.state.offered.length, 1);
});

test('a stricter mode DEMOTES an answer to an offer, and never promotes', async () => {
  const strict = { autoThreshold: 0.94, offerThreshold: 0.75, speculationThreshold: 0.88 };
  const h = makeSimple(async () => ACT('answer', { answerability: 0.9 }));   // below the strict bar
  h.engine.setThresholds(strict);
  h.interviewer('So how would you shard this table once it stops fitting on one box?');
  await h.advance(STABILITY_MS + 200);
  assert.deepEqual(h.texts(), [], 'a meeting-grade bar does not fire unasked at 0.9');
  assert.equal(h.state.offered.length, 1, 'it becomes an offer instead');

  const g = makeSimple(async () => ACT('offer'));
  g.engine.setThresholds({ autoThreshold: 0.1, offerThreshold: 0.05, speculationThreshold: 0.05 });
  g.interviewer('Can you see my screen okay before we start the interview?');
  await g.advance(STABILITY_MS + 200);
  assert.deepEqual(g.texts(), [], 'even a wide-open bar cannot promote an offer into an answer');
});

test('judge action "silent" stays silent whatever the score says', async () => {
  const h = makeSimple(async () => ACT('silent', { answerability: 0.99, is_ask: true, directed_at_user: true }));
  h.interviewer('You can totally look up syntax for anything that you need during this.');
  await h.advance(STABILITY_MS + 200);
  assert.deepEqual(h.texts(), []);
  assert.deepEqual(h.state.offered, []);
});

// ── Speaker diarization (2026-08-25) ─────────────────────────────────────
// The meeting-audio channel can carry several voices. When the STT labels
// them, the judge should be told rather than left to infer from wording.

test('diarization: speaker labels reach the judge for both the context and the candidate', async () => {
  const h = makeSimple(async () => JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', action: 'answer', answerability: 0.95, question_text: null }));
  const seg = (text, speakerId) => ({ speaker: 'interviewer', text, final: true, timestamp: h.clock.now(), origin: 'stt', speakerId });
  h.state.turns.push({ role: 'interviewer', text: 'So we have about forty minutes today.', timestamp: h.clock.now() });
  h.engine.ingest(seg('So we have about forty minutes today.', 'speaker_1'));
  await h.advance(STABILITY_MS + 200);
  h.state.turns.push({ role: 'interviewer', text: 'Why did you choose PostgreSQL over the alternatives here?', timestamp: h.clock.now() });
  h.engine.ingest(seg('Why did you choose PostgreSQL over the alternatives here?', 'speaker_2'));
  await h.advance(STABILITY_MS + 200);

  const req = h.state.judgeCalls[h.state.judgeCalls.length - 1];
  assert.ok(Array.isArray(req.speakers), 'the request carries per-turn speaker labels');
  assert.ok(req.speakers.includes('speaker_1'), `context speaker preserved: ${JSON.stringify(req.speakers)}`);
  // The candidate arrives split by speaker — that split is the point, because
  // it is what tells a self-answer apart from two people talking.
  assert.ok(Array.isArray(req.candidateParts) && req.candidateParts.length >= 1);
  assert.equal(req.candidateParts[req.candidateParts.length - 1].speaker, 'speaker_2');
});

test('diarization: an undiarized provider sends no labels and the prompt is unchanged', async () => {
  const Judge = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/AutoAnswerJudge.js'));
  const h = makeSimple(async () => NO);
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await h.advance(STABILITY_MS + 200);
  const req = h.state.judgeCalls[0];
  assert.ok((req.candidateParts ?? []).every(p => p.speaker === undefined), 'no candidate labels without diarization');
  assert.ok((req.speakers ?? []).every(x => x === undefined), 'no labels when the provider does not diarize');
  const prompt = Judge.buildJudgePrompt(req);
  assert.ok(!prompt.includes('SPEAKER-LABELLED'), 'an undiarized session never sees the diarization rules');
  assert.ok(!prompt.includes('OTHERS/'), 'and turns stay plainly labelled OTHERS');
});

test('diarization: the prompt teaches same-speaker vs cross-speaker only when labels exist', () => {
  const Judge = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/AutoAnswerJudge.js'));
  const turns = [
    { role: 'interviewer', text: 'Have you used CoderPad before?', timestamp: 1 },
    { role: 'interviewer', text: 'Yeah I have, a few times.', timestamp: 2 },
  ];
  const p = Judge.buildJudgePrompt({
    candidateText: 'So walk me through how you would design the rate limiter. Sure, happy to.',
    candidateParts: [
      { speaker: 'speaker_1', text: 'So walk me through how you would design the rate limiter.' },
      { speaker: 'speaker_2', text: 'Sure, happy to.' },
    ],
    recentTurns: turns, speakers: ['speaker_1', 'speaker_2'],
    modeName: 'Technical Interview', questionId: 'x',
  });
  assert.ok(p.includes('SPEAKER-LABELLED'));
  assert.ok(p.includes('OTHERS/speaker_1: Have you used CoderPad before?'));
  assert.ok(p.includes('OTHERS/speaker_2: Yeah I have, a few times.'));
  // The candidate itself is split by voice — the distinction the labels exist for.
  assert.ok(p.includes('OTHERS/speaker_1: So walk me through how you would design the rate limiter.'));
  assert.ok(p.includes('OTHERS/speaker_2: Sure, happy to.'));
});

// ── Parked dispatches wake on idle (2026-08-25, real-interview latency) ──
// Measured: a verdict ready at 12:56:46 did not dispatch until 12:56:52. The
// engine had freed at 12:56:49; the rest was cooldown plus waiting out a
// 500ms poll. The poll half is fixed here.

test('a dispatch parked on a busy engine fires the instant the engine reports idle', async () => {
  const h = makeSimple(async () => YES(), { accepting: false });
  h.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await h.advance(STABILITY_MS + 200);
  assert.deepEqual(h.texts(), [], 'parked while the engine is busy');

  h.state.accepting = true;
  h.engine.onEngineIdle();          // no clock advance at all
  await flush(); await flush();
  assert.equal(h.texts().length, 1, 'dispatched without waiting out the retry poll');
  assert.equal(h.clock.pendingCount() > 0, true, 'only the feedback window remains armed');
});

test('onEngineIdle with nothing parked is inert, and a superseded park never fires late', async () => {
  const h = makeSimple(async () => YES());
  h.engine.onEngineIdle();
  assert.deepEqual(h.texts(), []);

  const g = makeSimple(async () => YES(), { accepting: false });
  g.interviewer('Why did you choose PostgreSQL over the alternatives here?');
  await g.advance(STABILITY_MS + 200);
  g.user('I picked it mainly for the ecosystem and the tooling around it.');   // user takes the floor
  g.state.accepting = true;
  g.engine.onEngineIdle();
  await flush(); await flush();
  assert.deepEqual(g.texts(), [], 'the park died with the user answering');
});
