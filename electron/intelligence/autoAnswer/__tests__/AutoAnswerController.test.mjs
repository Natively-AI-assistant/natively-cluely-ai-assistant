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
