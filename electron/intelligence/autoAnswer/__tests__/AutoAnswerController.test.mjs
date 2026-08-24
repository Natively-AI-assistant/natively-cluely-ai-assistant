/**
 * AutoAnswerController — end-to-end over the subsystem with a fake clock.
 * Ports every Phase 1/2 scheduler scenario (hard cap, pending/queue, dedup,
 * generation, toggle-off, user-silence, barge-in, overlap) onto the
 * controller, and adds the V2 §18/§22/§23/§28/§46 invariants.
 *
 * Mutation probes (docs/autopilot/auto-answer-v3-progress.md, Phase 3):
 *   dedup            → 'dedup: a paraphrase of the question just answered does not answer again'
 *   generation       → 'generation guard: a stop→start between commit and dispatch drops silently'
 *                      'generation guard: a newer question supersedes the one awaiting dispatch'
 *   manual precedence→ 'manual precedence: a streaming manual answer is never superseded'
 *   user-silence     → 'user silent: the dispatch is held until USER_SILENCE_MS of silence'
 *   hard cap         → 'hard cap: finals faster than the quiet window still commit at HARD_CAP_MS'
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeHarness, QUIET, HARD_CAP_MS, USER_SILENCE_MS, OVERLAP_VETO_MS, HOLD_BUDGET_MS, QUEUE_TTL_MS, QUEUE_RETRY_MS,
  RHETORICAL_HOLD_MS,
} from './harness.mjs';

const Q = 'Why did you choose PostgreSQL?';
const CANDIDATE_GAP_PLUS = 4100;

// ── the baseline every case below breaks ──────────────────────────────────

test('a real question followed by the quiet window dispatches exactly once', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q);
  await h.advance(QUIET - 1);
  assert.deepEqual(h.texts(), [], 'not before the quiet window');
  await h.advance(1);
  assert.deepEqual(h.texts(), [Q]);
  assert.equal(h.controller.getState(), 'answering');
  const q = h.state.dispatched[0].question;
  assert.equal(q.id, '3-q1', 'meeting-local identity, not the text');
  assert.ok(q.answerability >= 0.88, `answerability ${q.answerability}`);
  assert.equal(q.dialogueAct, 'general_question');
  await h.advance(20_000);
  assert.equal(h.texts().length, 1, 'nothing fires again on its own');
});

test('toggle OFF: nothing is armed, nothing is evaluated, no telemetry', async () => {
  const h = makeHarness({ enabled: false });
  h.interviewerFinal(Q);
  h.partial('and more');
  h.edge('user', true);
  await h.advance(HARD_CAP_MS * 4);
  assert.deepEqual(h.texts(), []);
  assert.equal(h.clock.pendingCount(), 0, 'no timer exists');
  assert.deepEqual(h.state.events, [], 'no telemetry');
  assert.deepEqual(h.state.noted, [], 'the engine is not even told about a candidate');
});

test('draining after Stop: a final with the meeting inactive never arms', async () => {
  const h = makeHarness({ meetingActive: false });
  h.interviewerFinal(Q);
  await h.advance(HARD_CAP_MS * 2);
  assert.deepEqual(h.texts(), []);
  assert.equal(h.clock.pendingCount(), 0);
});

// ── turn reconstruction (V2 §6, §32 fragmented / continuation) ────────────

test('fragmented positive: three finals become ONE question and ONE trigger', async () => {
  const h = makeHarness();
  h.interviewerFinal('What was the hardest');
  await h.advance(450);
  h.interviewerFinal('technical problem');
  await h.advance(500);
  h.interviewerFinal('you had to solve?');
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), ['What was the hardest technical problem you had to solve?']);
  assert.equal(h.state.dispatched[0].question.sourceSegments.length, 3);
});

test('continuation: "How would you design" alone never answers; the completed question does, once', async () => {
  const h = makeHarness();
  h.interviewerFinal('How would you design');
  await h.advance(HARD_CAP_MS);                     // quiet window AND cap elapse on the stub
  assert.deepEqual(h.texts(), [], 'the stub is incomplete');
  assert.equal(h.controller.getState(), 'possible_question');
  h.interviewerFinal('the system if traffic increased 100x?');
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), ['How would you design the system if traffic increased 100x?']);
});

test('a partial restarts the quiet window (the interviewer is still talking)', async () => {
  const h = makeHarness();
  h.interviewerFinal('Tell me about your last project');
  await h.advance(QUIET - 100);
  h.partial('and what');
  await h.advance(200);
  assert.deepEqual(h.texts(), [], 'the partial pushed the window out');
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1);
});

test('hard cap: finals faster than the quiet window still commit at HARD_CAP_MS', async () => {
  const h = makeHarness();
  const t0 = h.clock.now();
  const committed = () => h.state.events.filter(e => e.name === 'auto_answer_candidate').length;
  const words = ['Tell me about', 'a time you', 'disagreed with', 'your manager', 'and what', 'you did', 'about it', 'in the end'];
  for (let i = 0; i < 40 && committed() === 0; i++) {
    h.interviewerFinal(words[i % words.length]);
    await h.advance(300);
  }
  assert.equal(committed(), 1, 'the window must not be starved: the candidate committed');
  const elapsed = h.clock.now() - t0;
  assert.ok(elapsed >= HARD_CAP_MS && elapsed < HARD_CAP_MS + 300, `committed at +${elapsed}ms`);
  // While the interviewer keeps talking nothing is dispatched (rhetorical hold
  // cancels on resume); once they stop, exactly one answer.
  assert.deepEqual(h.texts(), []);
  await h.advance(QUIET + RHETORICAL_HOLD_MS);
  assert.equal(h.texts().length, 1);
});

// ── negatives (V2 §32/§49) ────────────────────────────────────────────────

for (const text of [
  'Interesting.', 'Okay.', 'Yeah, exactly.', 'That makes sense.', 'Give me one second.', 'Let me think.',
  "I think that's the main reason.", 'We usually use Kafka.', "Wouldn't that be nice?", 'Can you hear me?',
  'Sounds good.', 'Companies often use Kafka when they need durable logs.',
]) {
  test(`negative: ${JSON.stringify(text)} never produces an automatic answer`, async () => {
    const h = makeHarness();
    h.interviewerFinal(text);
    await h.advance(HARD_CAP_MS);
    assert.deepEqual(h.texts(), []);
    assert.deepEqual(h.state.offered, [], 'not even an offer');
    assert.equal(h.state.skips.length, 1, 'exactly one machine-readable skip reason');
    assert.ok(['not_question', 'backchannel', 'social', 'rhetorical', 'pause_request', 'low_answerability'].includes(h.state.skips[0]), h.state.skips[0]);
  });
}

// ── positives (V2 §32/§49) ────────────────────────────────────────────────

for (const text of [
  'Tell me about your last project.', 'Walk me through the architecture.', 'Why did you choose PostgreSQL?',
  'How would you scale this to ten million users?', 'Tell me about a time you disagreed with your manager.',
  'Going back to what you mentioned earlier, why did you choose Kafka?',
  'One more question — tell me about your biggest failure.', 'Solve this using a hash map.',
  'how would you design this system',
]) {
  test(`positive: ${JSON.stringify(text)} dispatches`, async () => {
    const h = makeHarness();
    h.state.turns.push({ role: 'user', text: 'I led the migration to Postgres last year and we used Kafka for events.', timestamp: h.clock.now() - 5000 });
    h.interviewerFinal(text);
    await h.advance(QUIET);
    assert.deepEqual(h.texts(), [text]);
  });
}

test('follow-up: "And why?" after an answered question is detected as a follow-up and dispatched', async () => {
  const h = makeHarness();
  h.interviewerFinal('Why did you choose Redis?');
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1);
  h.controller.onEngineIdle();
  await h.advance(4000);
  h.userFinal('Because we needed sub-millisecond reads for session lookups.');
  await h.advance(4000);
  h.interviewerFinal('And why?');
  await h.advance(QUIET);
  assert.equal(h.texts().length, 2, 'the follow-up fires');
  const q = h.state.dispatched[1].question;
  assert.equal(q.text, 'And why?');
  assert.ok(q.isFollowUp || q.dialogueAct === 'follow_up_question', `act=${q.dialogueAct} fu=${q.isFollowUp}`);
});

// ── dedup (V2 §21) ────────────────────────────────────────────────────────

test('dedup: an unchanged last turn is not re-dispatched after the engine idles', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  h.controller.onEngineIdle();
  await h.advance(5000);
  h.interviewerFinal(Q);              // the provider re-emits / the interviewer repeats verbatim
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1);
  assert.ok(h.state.skips.includes('duplicate') || h.state.skips.includes('already_answered'), h.state.skips.join(','));
});

test('dedup: a paraphrase of the question just answered does not answer again', async () => {
  const h = makeHarness();
  h.interviewerFinal('What was your hardest technical problem?');
  await h.advance(QUIET);
  h.controller.onEngineIdle();
  await h.advance(5000);
  h.interviewerFinal('What was your hardest technical problem you faced?');
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1, 'token-similar rephrase is the same ask');
  assert.ok(h.state.skips.includes('duplicate'));
});

test('dedup layer 3: an embedding-similar paraphrase that the cheap layers cannot decide is caught', async () => {
  // A stub embedder: both "hard problem" phrasings map to one vector, the unrelated question to another.
  const embed = async (text) => /hardest|difficult/.test(text) ? [1, 0.1, 0] : [0, 0, 1];
  const h = makeHarness({}, { embed });
  h.interviewerFinal('What was your hardest technical problem?');
  await h.advance(QUIET);
  h.controller.onEngineIdle();
  await h.advance(5000);
  h.interviewerFinal('What was the most difficult technical challenge you faced?');
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1);
  assert.ok(h.state.events.some(e => e.name === 'auto_answer_deduplicated'));
  h.controller.onEngineIdle();
  await h.advance(5000);
  h.interviewerFinal('How would you scale this to ten million users?');
  await h.advance(QUIET);
  assert.equal(h.texts().length, 2, 'a genuinely new question still fires');
});

// ── queue / single-flight / manual precedence (V2 §22-§23) ────────────────

test('single-flight: a second real question during a streaming automatic answer queues, then fires when it ends', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1);
  h.state.accepting = false;          // engine busy with OUR answer
  await h.advance(3000);
  h.interviewerFinal('How would you scale this to ten million users?');
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1, 'never two concurrent automatic answers');
  assert.equal(h.controller.getState(), 'queued');
  assert.equal(h.controller.queueDepth(), 1);
  h.state.accepting = true;
  h.controller.onEngineIdle();
  await h.flush();
  assert.equal(h.texts().length, 2);
  assert.equal(h.texts()[1], 'How would you scale this to ten million users?');
});

test('queue: the engine cooldown rearms through the retry poll (no idle event)', async () => {
  const h = makeHarness({ accepting: false });
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), []);
  assert.equal(h.controller.queueDepth(), 1);
  h.state.accepting = true;
  await h.advance(QUEUE_RETRY_MS);
  assert.deepEqual(h.texts(), [Q]);
});

test('queue: a queued question expires after QUEUE_TTL_MS without firing', async () => {
  const h = makeHarness({ accepting: false });
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  await h.advance(QUEUE_TTL_MS + QUEUE_RETRY_MS);
  assert.equal(h.controller.queueDepth(), 0);
  assert.ok(h.state.skips.includes('pending_expired'));
  h.state.accepting = true;
  h.controller.onEngineIdle();
  await h.advance(10_000);
  assert.deepEqual(h.texts(), []);
});

test('queue: a newer question supersedes the queued one — only the NEW one ever fires', async () => {
  const h = makeHarness({ accepting: false });
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  assert.equal(h.controller.queueDepth(), 1);
  await h.advance(2000);
  h.interviewerFinal('Actually, skip that — how would you scale it?');
  await h.advance(QUIET);
  assert.equal(h.controller.queueDepth(), 1, 'single slot: replaced');
  h.state.accepting = true;
  h.controller.onEngineIdle();
  await h.flush();
  assert.deepEqual(h.texts(), ['Actually, skip that — how would you scale it?']);
  assert.ok(h.state.skips.includes('pending_superseded'));
});

test('manual precedence: a streaming manual answer is never superseded', async () => {
  const h = makeHarness({ manualActive: true, accepting: false });
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), []);
  assert.ok(h.state.skips.includes('manual_answer_active'));
  assert.equal(h.controller.queueDepth(), 0, 'not even queued behind the user\'s own request');
  h.state.manualActive = false; h.state.accepting = true;
  h.controller.onEngineIdle();
  await h.advance(10_000);
  assert.deepEqual(h.texts(), [], 'and it does not come back later');
});

// ── generation guards (V2 §28, §46) ───────────────────────────────────────

test('generation guard: a stop→start between commit and dispatch drops silently', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q);
  h.state.generation = 4;               // endMeeting/startMeeting bumped it mid-window
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), []);
  assert.ok(h.state.skips.includes('stale_generation'));
});

test('generation guard: a newer question supersedes the one awaiting dispatch (Q2 arrives, Q1 never answers)', async () => {
  // A long user-silence requirement keeps Q1 HELD long enough for Q2 to land and commit.
  const h = makeHarness({}, { channelTuning: { userSilenceMs: 3000, holdBudgetMs: 6000 } });
  h.edge('interviewer', true);
  await h.advance(300);
  h.edge('user', true);
  await h.advance(100);
  h.edge('interviewer', false);
  h.interviewerFinal('What was your hardest technical problem?');
  await h.advance(QUIET - 200);
  h.edge('user', false);               // user silent 200 ms before the window fires → Q1 held
  await h.advance(200);
  assert.deepEqual(h.texts(), []);
  assert.equal(h.controller.isHolding(), true);
  await h.advance(200);
  h.interviewerFinal('How would you scale this to ten million users?');   // Q2, during Q1's hold
  await h.advance(QUIET);              // Q2 commits and becomes current; Q1's hold timer now finds itself stale
  await h.advance(3000);               // user-silence requirement satisfied for whoever is current
  assert.deepEqual(h.texts(), ['How would you scale this to ten million users?'], 'Q1 is never answered after Q2');
});

test('stop/restart: no stale answer after stop; the old question never leaks into the new meeting', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q);
  await h.advance(QUIET - 1);
  h.controller.onMeetingStop();
  h.state.meetingActive = false;
  await h.advance(HARD_CAP_MS * 2);
  assert.deepEqual(h.texts(), []);
  assert.equal(h.clock.pendingCount(), 0, 'every timer cancelled');
  h.state.meetingActive = true; h.state.generation = 4; h.state.turns = [];
  h.controller.onMeetingStart();
  assert.equal(h.controller.getCurrentQuestion(), null);
  h.interviewerFinal('Tell me about your projects.');
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), ['Tell me about your projects.']);
  assert.equal(h.state.dispatched[0].question.id, '4-q1', 'sequence restarts with the new generation');
});

// ── dual-channel (V3 Amendment 1), ported from Phase 2 ────────────────────

test('user answers promptly: a user edge inside the window cancels the held/queued candidate', async () => {
  const h = makeHarness({ accepting: false });
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  assert.equal(h.controller.queueDepth(), 1);
  h.edge('user', true);
  assert.equal(h.controller.queueDepth(), 0);
  assert.ok(h.state.skips.includes('user_answering'));
  h.state.accepting = true;
  h.controller.onEngineIdle();
  await h.advance(10_000);
  assert.deepEqual(h.texts(), []);
});

test('user speaking when the gate fires: dropped as user_answering, never held', async () => {
  const h = makeHarness();
  h.edge('interviewer', true);
  await h.advance(1000);
  h.edge('interviewer', false);
  h.interviewerFinal(Q);
  await h.advance(200);
  h.edge('user', true);                 // began AFTER the interviewer stopped: answering
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), []);
  assert.ok(h.state.skips.includes('user_answering'));
  assert.equal(h.controller.isHolding(), false);
});

test('user speech that began while the interviewer was still talking is an overlap: held, then fires once they stop', async () => {
  const h = makeHarness();
  h.edge('interviewer', true);
  await h.advance(1000);
  h.edge('user', true);                 // talking over the last words
  await h.advance(100);
  h.edge('interviewer', false);
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), [], 'held while the overlap continues');
  assert.equal(h.controller.isHolding(), true);
  h.edge('user', false);
  await h.advance(USER_SILENCE_MS);
  assert.deepEqual(h.texts(), [Q]);
});

test('user silent: the dispatch is held until USER_SILENCE_MS of silence', async () => {
  const h = makeHarness();
  h.edge('interviewer', true);
  await h.advance(1000);
  h.edge('user', true);
  await h.advance(100);
  h.edge('interviewer', false);
  h.interviewerFinal(Q);
  await h.advance(QUIET - 200);
  h.edge('user', false);
  await h.advance(200);
  assert.deepEqual(h.texts(), [], 'held: only 200 ms of user silence');
  assert.equal(h.controller.isHolding(), true);
  await h.advance(USER_SILENCE_MS - 200 - 1);
  assert.deepEqual(h.texts(), []);
  await h.advance(1);
  assert.deepEqual(h.texts(), [Q], 'fires at exactly USER_SILENCE_MS of user silence');
});

test('overlap veto: both channels active at the boundary holds, then fires', async () => {
  const h = makeHarness({}, { channelTuning: { userSilenceMs: 0 } });
  h.edge('interviewer', true);
  await h.advance(1000);
  h.interviewerFinal(Q);
  await h.advance(QUIET - 200);
  h.edge('user', true, { userEdgesVadBacked: false });  // RMS-only mic edge while interviewer speaks: possible bleed
  assert.deepEqual(h.state.skips, []);
  await h.advance(150);
  h.edge('user', false);
  h.edge('interviewer', false);
  await h.advance(50);
  assert.deepEqual(h.texts(), [], 'held: the boundary was not clean');
  await h.advance(OVERLAP_VETO_MS);
  assert.deepEqual(h.texts(), [], 'overlap cleared; the rhetorical hold (600 ms from the interviewer end) still runs');
  await h.advance(RHETORICAL_HOLD_MS - OVERLAP_VETO_MS - 50);
  assert.deepEqual(h.texts(), [Q]);
});

test('hold budget: sustained overlap drops the candidate with a machine-readable reason', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q);
  h.edge('interviewer', true);
  h.edge('user', true, { userEdgesVadBacked: false });
  await h.advance(QUIET + HOLD_BUDGET_MS + OVERLAP_VETO_MS * 2);
  assert.deepEqual(h.texts(), []);
  assert.ok(h.state.skips.includes('user_answering'));
  assert.equal(h.controller.isHolding(), false);
});

test('barge-in: user speech during a streaming automatic answer cancels it', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1);
  await h.advance(800);
  h.edge('user', true);
  assert.deepEqual(h.state.cancelled, ['user_barge_in']);
  assert.ok(h.state.events.some(e => e.name === 'auto_answer_cancelled' && e.skipReason === 'user_barge_in'));
  h.controller.onEngineIdle();
  h.edge('user', false); h.edge('user', true);
  assert.equal(h.state.cancelled.length, 1, 'nothing to cancel once idle');
});

test('barge-in: an RMS-only user edge overlapping interviewer speech does not cancel', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  h.edge('interviewer', true);
  h.edge('user', true, { userEdgesVadBacked: false });
  assert.deepEqual(h.state.cancelled, []);
});

test('interviewer resuming inside the quiet window restarts it; the completed question fires once', async () => {
  const h = makeHarness();
  h.interviewerFinal('Why did you choose Kafka');
  await h.advance(QUIET - 300);
  h.edge('interviewer', true);          // "...and would you again?"
  await h.advance(300);
  assert.deepEqual(h.texts(), [], 'the VAD resume pushed the window');
  h.edge('interviewer', false);
  h.interviewerFinal('and would you again?');
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), ['Why did you choose Kafka and would you again?']);
});

// ── telemetry (V2 §29) ────────────────────────────────────────────────────

test('telemetry: every event is structured and none carries transcript text', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  h.controller.onEngineIdle();
  const names = h.state.events.map(e => e.name);
  for (const n of ['auto_answer_candidate', 'auto_answer_decision', 'auto_answer_committed', 'auto_answer_completed']) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  for (const e of h.state.events) {
    const blob = JSON.stringify(e).toLowerCase();
    assert.ok(!blob.includes('postgresql'), `transcript text leaked into ${e.name}`);
    assert.equal(typeof e.meetingGeneration, 'number');
  }
});

test('speculative reuse: a keyed speculative cache is reused without re-generating', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q);
  // The engine speculated on this very candidate (the controller keyed it).
  const id = h.state.noted.at(-1)?.id;
  assert.ok(id, 'the engine was told the candidate id');
  h.state.speculative = { questionId: id, text: 'Why did you choose' };
  await h.advance(QUIET);
  assert.equal(h.state.dispatched[0].reuseSpeculative, true);
});

test('generation guard (async path): a question superseded while the embedder is still running never dispatches', async () => {
  // The speculative cache is keyed to a DIFFERENT id with different text, so
  // dispatch must await the embedding cosine; Q2 commits during that await.
  const pending = [];
  const embed = (text) => new Promise((resolve) => { pending.push(() => resolve(text.includes('Kafka') ? [1, 0] : [0, 1])); });
  const releaseAll = () => { for (const r of pending.splice(0)) r(); };
  const h = makeHarness({ speculative: { questionId: '3-q0', text: 'Why did you pick Kafka' } }, { embed });
  h.interviewerFinal('Why did you choose Kafka?');
  await h.advance(QUIET);                 // Q1 commits → dispatchWithReuse awaits the embedder
  assert.deepEqual(h.texts(), [], 'still awaiting the embedder');
  await h.advance(CANDIDATE_GAP_PLUS);
  h.interviewerFinal('How would you scale this to ten million users?');
  await h.advance(QUIET);                 // Q2 is current now (its own dispatch also awaits)
  assert.ok(pending.length >= 1, 'Q1 is parked on the embedder');
  // The embedder resolves late (sequential requests: release, let the next one queue, release again…).
  for (let k = 0; k < 6; k++) { releaseAll(); for (let i = 0; i < 4; i++) await h.flush(); }
  assert.ok(!h.texts().includes('Why did you choose Kafka?'), 'Q1 must not dispatch after Q2 became current');
  assert.deepEqual(h.texts(), ['How would you scale this to ten million users?'], 'Q2 completes normally');
});

// ── Code-review findings (2026-08-24) ─────────────────────────────────────

test('review#1: a dispatch the engine answers with SILENCE (planner cooldown) must not latch Auto Answer busy forever', async () => {
  // The engine path for a silent planner decision never changes mode, so no
  // mode_changed→idle ever fires. The controller must learn the outcome from
  // the dispatch promise itself.
  const h = makeHarness();
  // Model the engine: dispatch resolves quickly having produced NO stream.
  h.host.dispatch = (q, o) => { h.state.dispatched.push({ question: q, reuseSpeculative: o.reuseSpeculative }); return Promise.resolve(null); };
  h.host.answerStreamActive = () => false;
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1, 'Q1 dispatched');
  // NOTE: no onEngineIdle — the planner stayed silent and no stream ever ran.
  await h.advance(5000);
  h.interviewerFinal('How would you scale this to ten million users?');
  await h.advance(QUIET);
  assert.equal(h.texts().length, 2, 'Q2 must dispatch: nothing is actually streaming');
  assert.equal(h.texts()[1], 'How would you scale this to ten million users?');
});

test('review#1: a dispatch whose promise settles while a stream RUNS (speculative accept) stays in flight until idle', async () => {
  const h = makeHarness();
  let streaming = false;
  h.host.dispatch = (q, o) => { h.state.dispatched.push({ question: q, reuseSpeculative: o.reuseSpeculative }); streaming = true; return Promise.resolve(null); };
  h.host.answerStreamActive = () => streaming;
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1);
  await h.advance(3000);
  h.interviewerFinal('How would you scale this to ten million users?');
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1, 'single-flight holds while the stream runs');
  assert.equal(h.controller.queueDepth(), 1);
  streaming = false;
  h.controller.onEngineIdle();
  await h.flush();
  assert.equal(h.texts().length, 2, 'the queued question fires when the stream really ends');
});

test('review#8: a meeting with transcripts but ZERO speech edges warns ONCE that the dual-channel gate is inert', async () => {
  const h = makeHarness();
  const logs = [];
  h.host.log = (l) => logs.push(l);
  h.interviewerFinal(Q);                       // no edge() calls at all
  await h.advance(QUIET);
  assert.equal(h.texts().length, 1, 'still dispatches (deterministic path)');
  assert.equal(logs.filter(l => l.includes('no speech_edge')).length, 1, 'warned');
  const cand = h.state.events.find(e => e.name === 'auto_answer_candidate');
  assert.equal(cand.channelEdgesSeen, false, 'telemetry marks the inert gate');
  h.controller.onEngineIdle();
  await h.advance(5000);
  h.interviewerFinal('How would you scale this to ten million users?');
  await h.advance(QUIET);
  assert.equal(logs.filter(l => l.includes('no speech_edge')).length, 1, 'once per meeting, not per candidate');

  const g = makeHarness();
  const glogs = [];
  g.host.log = (l) => glogs.push(l);
  g.edge('interviewer', true);
  await g.advance(500);
  g.edge('interviewer', false);
  g.interviewerFinal(Q);
  await g.advance(QUIET);
  assert.equal(glogs.filter(l => l.includes('no speech_edge')).length, 0, 'a healthy bridge never warns');
  assert.equal(g.state.events.find(e => e.name === 'auto_answer_candidate').channelEdgesSeen, true);
});

// ── Live-run repros (2026-08-24): a real YouTube mock interview, real texts ──

test('live#1: a directed question followed by ELABORATION ("…CoderPad? Because that\'s what we\'ll use…") must answer the question', async () => {
  // Verbatim from meeting 71a57234: the only real ask of the session was
  // classified rhetorical by the self-answered heuristic ("? Because").
  const h = makeHarness();
  h.interviewerFinal('Um, we\'re going to');
  await h.advance(600);
  h.interviewerFinal('probably just jump right into this interview. I');
  await h.advance(600);
  h.interviewerFinal("'m just curious: are you familiar with CoderPad? Because that's what we're going to be using throughout, I think it might be easiest to kind of share code.");
  await h.advance(QUIET + USER_SILENCE_MS + 2000);
  assert.equal(h.texts().length, 1, `skips: ${h.state.skips.join(',')}`);
  assert.ok(/are you familiar with CoderPad\?/i.test(h.texts()[0]), `the QUESTION is dispatched, not the whole turn: ${JSON.stringify(h.texts()[0])}`);
  assert.ok(!/easiest to kind of share code/i.test(h.texts()[0]), 'the elaboration stays out of the dispatched question');
});

test('live#1b: a NON-directed self-answered question still never fires (the fixture case)', async () => {
  const h = makeHarness();
  h.interviewerFinal('Why do we shard by user id? Because hot keys.');
  await h.advance(HARD_CAP_MS + QUIET + 2000);
  assert.deepEqual(h.texts(), []);
  assert.ok(h.state.skips.includes('rhetorical') || h.state.skips.includes('not_question'), h.state.skips.join(','));
});

test('live#2: a duplicate relay final does not double the question text', async () => {
  const h = makeHarness();
  h.interviewerFinal(Q);
  await h.advance(60);                          // the relay re-emits the same final ~60 ms later
  h.interviewerFinal(Q);
  await h.advance(QUIET + 100);
  assert.deepEqual(h.texts(), [Q], 'one clean question, not "…? …?" twice');
});

test('live#3: fourteen finals of screen-sharing logistics (meeting 54f832cc verbatim) produce ZERO answers and zero offers', async () => {
  const segs = [
    [0, 'Cool. All right, so'], [2049, "we're going to kind of just jump right into"], [4099, 'the problem.'],
    [6129, 'So for the purpose of this problem, and'], [8228, 'let me share— I just want to make sure you can'],
    [10209, "access this coder link, so I'm"], [12269, 'going to share this— and I'],
    [12847, 'recommend maybe sharing your screen or, um, I guess we also can just work off of this.'],
    [15947, 'So I should be able to see your— what you typed in.'],
    [21973, 'I opened the chat. I can'], [23994, "click on this link, and it'"], [26052, 'll take me to the coder pad.'],
    [28149, 'My name is Kylie, and'], [29588, "I will enter. And so, I can see that you're in this coder pad as well, and then—"],
  ];
  const h = makeHarness();
  let t = 0;
  for (const [at, text] of segs) { if (at > t) { await h.advance(at - t); t = at; } h.interviewerFinal(text); }
  await h.advance(HARD_CAP_MS + QUIET + 3000);
  assert.deepEqual(h.texts(), [], `dispatched: ${JSON.stringify(h.texts())}`);
  assert.deepEqual(h.state.offered, [], 'not even offered');
});

test('live#4: a system-design TASK statement (no "?", first-person framing, meeting 343d1321 verbatim) is an answer opportunity', async () => {
  // The canonical coding-round shape: the entire prompt is task-giving
  // statements. Verbatim finals with their real relative timings.
  const segs = [
    [0, 'And basically what we want to do to start this'],
    [161, 'problem off is that we need help designing the actual'],
    [162, 'app.'],
    [6288, 'We need help designing the'],
    [8250, 'code that could implement an online'],
    [10292, 'cloud reading application,'],
    [12352, "and there's a couple things that we're looking for"],
    [14374, ', and this is very open-ended. You can impl'],
    [16432, 'ement this how you want, but a f'],
    [16770, "ew things, and I'll paste these into the coder pad that we're looking for,"],
    [16775, '.'],
  ];
  const h = makeHarness();
  let t = 0;
  for (const [at, text] of segs) { if (at > t) { await h.advance(at - t); t = at; } h.interviewerFinal(text); }
  h.controller.onEngineIdle();
  await h.advance(HARD_CAP_MS + QUIET + 8000);
  assert.ok(h.texts().length >= 1, `the design task must fire (skips: ${h.state.skips.join(',')})`);
  assert.ok(h.texts().length <= 2, `but not for every fragment: ${JSON.stringify(h.texts())}`);
  assert.ok(/design/i.test(h.texts()[0]), h.texts()[0]);
  const cand = h.state.events.find(e => e.name === 'auto_answer_committed');
  assert.equal(cand.dialogueAct, 'coding_question');
});

test('live#4b: requirements listing and confirmations from the same session still never fire', async () => {
  for (const text of [
    'so a few things that you\'re looking for: users have a library of books that they can add to or remove from, users can set a book from their library as active,',
    'Is that correct? Correct.',
    'Right, so let me make this smaller. Over on this end so people can see all of this.',
  ]) {
    const h = makeHarness();
    h.interviewerFinal(text);
    await h.advance(HARD_CAP_MS + QUIET + 2000);
    assert.deepEqual(h.texts(), [], `${JSON.stringify(text.slice(0, 40))} must stay silent (skips: ${h.state.skips.join(',')})`);
  }
});

// ── Live-run repro (2026-08-24, session 3): speaker echo into the mic ─────

test('live#5: mic ECHO of the interviewer (speakers, no headphones) must not read as the user answering', async () => {
  // Observed live: every interviewer final has an identical-length twin on the
  // user channel ms later, and the mic VAD "speaks" whenever the video does.
  const h = makeHarness();
  const speakBoth = async (text, ms = 1500) => {
    h.edge('interviewer', true);
    h.edge('user', true);                     // bleed: the mic hears the speakers
    await h.advance(ms);
    h.edge('interviewer', false);
    h.edge('user', false);
    await h.advance(100);
    h.interviewerFinal(text);
    await h.advance(80);
    h.userFinal(text);                        // the echo transcript, verbatim
    await h.advance(120);
  };
  await speakBoth('Welcome to the interview. How are you doing today?');
  await h.advance(2500);
  h.controller.onEngineIdle();
  await speakBoth('Why did you choose PostgreSQL?');
  await h.advance(QUIET + USER_SILENCE_MS + HOLD_BUDGET_MS + 2000);
  assert.ok(
    h.texts().some(t => /PostgreSQL/.test(t)),
    `the echoed mic must not suppress the answer (dispatched: ${JSON.stringify(h.texts())}, skips: ${h.state.skips.join(',')})`,
  );
});

test('live#5b: GENUINE user speech (different words) still cancels as user_answering', async () => {
  const h = makeHarness();
  h.edge('interviewer', true);
  await h.advance(1200);
  h.edge('interviewer', false);
  h.interviewerFinal(Q);
  await h.advance(200);
  h.edge('user', true);
  await h.advance(150);
  h.userFinal('Well, mostly because of the ecosystem and the tooling around it.');
  await h.advance(QUIET + HOLD_BUDGET_MS + 2000);
  assert.deepEqual(h.texts(), []);
  assert.ok(h.state.skips.includes('user_answering'));
});

// ── Live-run repro (2026-08-24, session 4): meeting fd28a1af — Wordle-in-React
// coding round. V3 fired ZERO while legacy fired garbage constantly. The two
// real asking points are the "have you heard of wordle?" question and the task
// ("and your task Connor is / to recreate this game in Reac / t, …") delivered
// as unpunctuated statements split across finals. Root causes fixed here:
// name-interjected task frame + missing recreate verb (DESIGN_TASK), dangling
// "not" tails, and ignored UNPUNCTUATED statements closing the revision window
// so the rest of their own sentence came back as a fragment question.

/** All 58 finals of the meeting, verbatim, single (system-audio) channel. */
const WORDLE_MEETING = [
  [0, "interviewer", "Yes, I'm ready."],
  [5121, "interviewer", "Okay, have you heard of the popular word game called \"wordle\"?"],
  [7219, "interviewer", "Yeah, yeah, I've played it a few times."],
  [13316, "interviewer", "You've played it, okay, perfect,"],
  [15428, "interviewer", "so this is going to be very easy for you to understand"],
  [17412, "interviewer", ". I'm going to give you a link right now to the"],
  [19454, "interviewer", "world game, let me give it to you here."],
  [21612, "interviewer", "So this is on the New York Times webs"],
  [23532, "interviewer", "ite, and you can play around with it a little bit while"],
  [25565, "interviewer", "I explain to the viewers at home who might not"],
  [27662, "interviewer", "be familiar with the game what it's about"],
  [29650, "interviewer", ". Basically, every day a"],
  [31713, "interviewer", "five-letter word is picked"],
  [33805, "interviewer", "at random from some word bank"],
  [35785, "interviewer", ", and you, the player, have"],
  [37805, "interviewer", "to guess what that five-letter word is."],
  [39839, "interviewer", "The way that you guess it is you"],
  [41896, "interviewer", "have 6 tries, where you"],
  [43936, "interviewer", "basically type in a five-letter word"],
  [46013, "interviewer", ". And at every try, the"],
  [47998, "interviewer", "game is going to show, based on,"],
  [49439, "interviewer", "like, different colors, which letters of the guess that you"],
  [49472, "interviewer", "attempt."],
  [50208, "interviewer", "Which."],
  [54991, "interviewer", "Letters are actually found in the word that you have to find"],
  [54995, "interviewer", "."],
  [61100, "interviewer", "Which letters are not in that"],
  [63152, "interviewer", "word, and which letters are not"],
  [65229, "interviewer", "only found in that word but are at the"],
  [67214, "interviewer", "correct position, right?"],
  [69225, "interviewer", "So for example, if there's a W in position"],
  [71310, "interviewer", "1 of both the word"],
  [73323, "interviewer", "that you tried and the final"],
  [75373, "interviewer", "word, then it would tell you you have a cor"],
  [77470, "interviewer", "rect letter in the correct position."],
  [79449, "interviewer", "And so you have 6 tries to get the final"],
  [81494, "interviewer", "word, and that's the game. It"],
  [83584, "interviewer", "became super popular over the last few months, it"],
  [85674, "interviewer", "got acquired by the New York Times from the developer,"],
  [87601, "interviewer", "and your task Connor is"],
  [89627, "interviewer", "to recreate this game in Reac"],
  [91320, "interviewer", "t, and all that I'm going to be giving you is an API endpoint, so I'm going to actually give it to you right now. Here you go."],
  [91806, "interviewer", "Okay."],
  [97918, "interviewer", "It's hosted on the frontend expert web"],
  [100015, "interviewer", "site, and that API endpoint"],
  [102007, "interviewer", "is very simple: you hit it and you get"],
  [104033, "interviewer", "a list of five-letter"],
  [105485, "interviewer", "words back. That is going to be the list from which you pick a random word to"],
  [105490, "interviewer", "serve."],
  [111666, "interviewer", "The user as the word of the"],
  [113644, "interviewer", "game. And you have to recreate"],
  [115743, "interviewer", "\"wordle,\" you have the freed"],
  [117725, "interviewer", "om to, you know, kind of add your own creative"],
  [119762, "interviewer", "twist to it, not as far as the way"],
  [121859, "interviewer", "the game works, but more as far as, like, the lo"],
  [123626, "interviewer", "ok of it, you know, how users select letters or select words. I'll leave that up to you."],
  [124868, "interviewer", "Okay, sounds good."],
  [129473, "interviewer", "Cool, so this is just an array five-letter words, yep."],];

test('live#6: Wordle coding round (meeting fd28a1af verbatim) fires EXACTLY on the two real asks and nothing else', async () => {
  const h = makeHarness();
  // Realistic engine: each dispatched answer streams ~6s, then the engine idles.
  let idleAt = null;
  const origDispatch = h.host.dispatch;
  h.host.dispatch = (q, o) => { origDispatch(q, o); idleAt = h.clock.now() + 6000; };
  let t = 0;
  for (const [at, , text] of WORDLE_MEETING) {
    let cur = t;
    while (cur < at) {
      const step = Math.min(500, at - cur);
      await h.advance(step); cur += step;
      if (idleAt !== null && h.clock.now() >= idleAt) { idleAt = null; h.controller.onEngineIdle(); }
    }
    t = at;
    h.interviewerFinal(text, { punctuationSource: 'provider' });
  }
  await h.advance(HARD_CAP_MS + QUIET + 8000);

  const dispatched = h.state.dispatched.map(d => d.question);
  assert.equal(dispatched.length, 2, `expected the 2 real asks, got: ${JSON.stringify(dispatched.map(q => q.text.slice(0, 60)))}`);
  assert.ok(/have you heard of the popular word game/.test(dispatched[0].text));
  assert.ok(/your task Connor is to recreate this game in Reac/.test(dispatched[1].text), `the TASK must fire (got ${JSON.stringify(dispatched[1].text.slice(0, 80))})`);
  assert.equal(dispatched[1].dialogueAct, 'coding_question');
  // No rule-explanation fragment ever fires or is offered.
  assert.deepEqual(h.state.offered, []);
});

test('live#6b: the name-interjected task frame fires; near-misses stay silent', async () => {
  // "your task Connor is to recreate…" — the ask, verbatim.
  const h = makeHarness();
  h.interviewerFinal("it got acquired by the New York Times from the developer, and your task Connor is to recreate this game in React, and all that I'm going to be giving you is an API endpoint.", { punctuationSource: 'provider' });
  await h.advance(HARD_CAP_MS + QUIET + 2000);
  assert.equal(h.texts().length, 1, `skips: ${h.state.skips.join(',')}`);
  assert.equal(h.state.dispatched[0].question.dialogueAct, 'coding_question');

  // Near-misses that must NOT fire: a status-meeting "task list", and the
  // RESTATEMENT of an already-given task (firing twice would be a duplicate).
  for (const text of [
    'Your task list is getting long and we should prioritize it together in the next sprint planning session.',
    'And you have to recreate "wordle," you have the freedom to, you know, kind of add your own creative twist to it.',
  ]) {
    const g = makeHarness();
    g.interviewerFinal(text, { punctuationSource: 'provider' });
    await g.advance(HARD_CAP_MS + QUIET + 2000);
    assert.deepEqual(g.texts(), [], `${JSON.stringify(text.slice(0, 40))} must stay silent`);
  }
});

test('live#6c: an ignored UNPUNCTUATED statement stays revisable — its own continuation never becomes a fragment question', async () => {
  // Meeting fd28a1af verbatim: "The way that you guess it is you" committed as
  // a statement, then "have 6 tries, where you" arrived 2s later and — with
  // the revision window closed — fired as a 0.9 general_question.
  const h = makeHarness();
  h.interviewerFinal('The way that you guess it is you', { punctuationSource: 'provider' });
  await h.advance(QUIET + 100);            // commits, skipped as a statement
  h.interviewerFinal('have 6 tries, where you', { punctuationSource: 'provider' });
  await h.advance(HARD_CAP_MS + QUIET + 2000);
  assert.deepEqual(h.texts(), [], `the sentence's own tail must not fire (skips: ${h.state.skips.join(',')})`);

  // A PUNCTUATED ignored statement is still closed: the next final is a new
  // candidate, judged on its own (and a real question fires).
  const g = makeHarness();
  g.interviewerFinal("That's the game.", { punctuationSource: 'provider' });
  await g.advance(QUIET + 100);
  g.interviewerFinal('Why did you choose PostgreSQL?', { punctuationSource: 'provider' });
  await g.advance(HARD_CAP_MS + QUIET + 2000);
  assert.deepEqual(g.texts(), ['Why did you choose PostgreSQL?']);
});

// ── Live-run repro (2026-08-24, session 5): meeting 680519c8 — mic-caught
// FRAGMENTS. The speakers-into-mic echo returned as short fragments spanning
// interviewer finals ("Every day.", "It was 6 tries where you basically—"),
// too dissimilar pairwise for the round-3 twin check; they killed candidates
// as user_answering. Fragments are token-SUBSETS of recent interviewer speech.

test('live#7: mic-caught fragments of interviewer speech are echo, not the user answering (meeting 680519c8 verbatim)', async () => {
  const h = makeHarness();
  h.interviewerFinal('ite, and you can play around with it a little bit while', { punctuationSource: 'provider' });
  await h.advance(150);
  h.userFinal('A little bit.');                        // verbatim mic fragment
  await h.advance(300);
  h.interviewerFinal('. Basically, every day a', { punctuationSource: 'provider' });
  await h.advance(150);
  h.userFinal('Every day.');                           // second fragment → echo mode arms
  await h.advance(2000);
  h.interviewerFinal('Why did you choose PostgreSQL?', { punctuationSource: 'provider' });
  await h.advance(HARD_CAP_MS + QUIET + 2000);
  assert.ok(h.texts().includes('Why did you choose PostgreSQL?'),
    `fragments must not suppress the answer (dispatched: ${JSON.stringify(h.texts())}, skips: ${h.state.skips.join(',')})`);
  assert.ok(!h.state.skips.includes('user_answering'), `no user_answering from echo fragments (skips: ${h.state.skips.join(',')})`);
});

test('live#7b: GENUINE user speech (words not in recent interviewer speech) still reads as answering', async () => {
  const h = makeHarness();
  h.interviewerFinal('Why did you choose PostgreSQL?', { punctuationSource: 'provider' });
  await h.advance(200);
  h.userFinal('Well mostly because of the ecosystem and the tooling around it.');
  await h.advance(HARD_CAP_MS + QUIET + 2000);
  assert.deepEqual(h.texts(), []);
  assert.ok(h.state.skips.includes('user_answering'));
});
