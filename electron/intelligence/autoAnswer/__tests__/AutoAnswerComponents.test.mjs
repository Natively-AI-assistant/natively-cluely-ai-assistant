/**
 * Unit tests per component (V2 §5-§8 TurnManager, §9-§17 Detector, §22 Queue,
 * §40 Policy, §18 state machine), all on the fake clock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock } from './fakeClock.mjs';
import {
  makeHarness, TurnManager, Detector, Policy, Queue, ChannelGate, QUIET, HARD_CAP_MS,
} from './harness.mjs';

const { AutoAnswerTurnManager, joinFinals, looksLikeContinuation, CANDIDATE_GAP_MS, REVISION_WINDOW_MS } = TurnManager;
const { scoreCandidate, AutoAnswerDetector, ANSWER_THRESHOLD, WAIT_THRESHOLD, SPECULATION_THRESHOLD } = Detector;
const { evaluateAutoAnswerPolicy, DEFAULT_THRESHOLDS } = Policy;
const { AutoAnswerQueue, MAX_QUEUE_DEPTH, QUEUE_TTL_MS } = Queue;

// ── TurnManager ───────────────────────────────────────────────────────────

function makeTurns(pace = 'balanced') {
  const clock = new FakeClock();
  const commits = [];
  const revisions = [];
  const tm = new AutoAnswerTurnManager({ onCommit: (c) => commits.push(c), onRevision: (c) => revisions.push(c) }, clock, pace);
  const final = (text) => tm.ingest({ speaker: 'interviewer', text, final: true, timestamp: clock.now() }, 7);
  const partial = (text) => tm.ingest({ speaker: 'interviewer', text, final: false, timestamp: clock.now() }, 7);
  const user = (text) => tm.ingest({ speaker: 'user', text, final: true, timestamp: clock.now() }, 7);
  return { clock, tm, commits, revisions, final, partial, user };
}

test('TurnManager: joinFinals reconstructs the V2 §6 example with single spaces', () => {
  assert.equal(joinFinals(['What was the hardest ', ' technical problem', 'you had to solve?']), 'What was the hardest technical problem you had to solve?');
  assert.equal(joinFinals(['', '  ', 'x']), 'x');
});

test('TurnManager: a partial alone never commits (finals only build a candidate)', () => {
  const t = makeTurns();
  t.partial('Tell me about');
  t.clock.advance(HARD_CAP_MS * 2);
  assert.deepEqual(t.commits, []);
  assert.equal(t.tm.isArmed(), false);
});

test('TurnManager: every final and partial restarts the quiet window; commit carries the joined text and generation', () => {
  const t = makeTurns();
  t.final('What was the hardest');
  t.clock.advance(500);
  t.partial('technical');
  t.clock.advance(500);
  t.final('technical problem');
  t.clock.advance(QUIET - 1);
  assert.equal(t.commits.length, 0);
  t.clock.advance(1);
  assert.equal(t.commits.length, 1);
  assert.equal(t.commits[0].text, 'What was the hardest technical problem');
  assert.equal(t.commits[0].segments.length, 2);
  assert.equal(t.commits[0].meetingGeneration, 7);
  assert.ok(t.commits[0].generation >= 3, 'two finals + one partial bumped the generation');
  assert.equal(t.commits[0].endpointSource, 'quiet_window');
});

test('TurnManager: the hard cap is measured from the FIRST final and survives restarts', () => {
  const t = makeTurns();
  const t0 = t.clock.now();
  for (let i = 0; i < 20 && t.commits.length === 0; i++) { t.final('w' + i); t.clock.advance(300); }
  assert.equal(t.commits.length, 1);
  assert.ok(t.clock.now() - t0 >= HARD_CAP_MS && t.clock.now() - t0 < HARD_CAP_MS + 300);
});

test('TurnManager: a user final closes the accumulation; the next interviewer final is a NEW candidate', () => {
  const t = makeTurns();
  t.final('Why did you choose Kafka?');
  t.clock.advance(QUIET);
  assert.equal(t.commits.length, 1);
  t.clock.advance(200);
  t.user('Because of durability.');
  t.clock.advance(200);
  t.final('And why not RabbitMQ?');   // inside REVISION_WINDOW_MS of the commit, but a user turn intervened
  t.clock.advance(QUIET);
  assert.equal(t.commits.length, 2);
  assert.equal(t.commits[1].text, 'And why not RabbitMQ?');
});

test('TurnManager: an undispatched commit is revised by a fast continuation, not by a new sentence', () => {
  const t = makeTurns();
  t.final('How would you design');
  t.clock.advance(QUIET);
  assert.equal(t.commits.length, 1);
  t.clock.advance(REVISION_WINDOW_MS - 100);
  t.final('the system if traffic increased 100x?');
  t.clock.advance(QUIET);
  assert.equal(t.commits.length, 2);
  assert.equal(t.commits[1].text, 'How would you design the system if traffic increased 100x?', 'revised in place');
  assert.equal(t.commits[1].startedAt, t.commits[0].startedAt, 'same question identity');

  t.tm.markDispatched();
  t.clock.advance(200);
  t.final('Tell me about your projects.');
  t.clock.advance(QUIET);
  assert.equal(t.commits[2].text, 'Tell me about your projects.', 'after dispatch a new final is a new candidate');
});

test('TurnManager: holdOpen() keeps an incomplete commit open for CANDIDATE_GAP_MS', () => {
  const t = makeTurns();
  t.final('How would you design');
  t.clock.advance(QUIET);
  t.tm.holdOpen();
  t.clock.advance(CANDIDATE_GAP_MS - 10);       // far beyond REVISION_WINDOW_MS
  t.final('the system if traffic increased 100x?');
  t.clock.advance(QUIET);
  assert.equal(t.commits[1].text, 'How would you design the system if traffic increased 100x?');
});

test('TurnManager: looksLikeContinuation', () => {
  assert.equal(looksLikeContinuation('What was your hardest technical problem?', 'How would you scale this?'), false);
  assert.equal(looksLikeContinuation('How would you design', 'the system if traffic increased?'), true);
  assert.equal(looksLikeContinuation('how would you design', 'What about latency'), false, 'capitalised interrogative = new turn');
  assert.equal(looksLikeContinuation('tell me about', 'your last project'), true);
});

test('TurnManager: CANDIDATE_GAP_MS of silence separates two questions even without a user turn', () => {
  const t = makeTurns();
  t.final('Why did you choose Kafka');
  t.clock.advance(HARD_CAP_MS);
  t.tm.markDispatched();
  t.clock.advance(CANDIDATE_GAP_MS + 1);
  t.final('and what about Redis?');
  t.clock.advance(QUIET);
  assert.equal(t.commits.length, 2);
  assert.equal(t.commits[1].text, 'and what about Redis?');
});

test('TurnManager: pace presets are the quiet window; reset() cancels everything', () => {
  const fast = makeTurns('fast');
  fast.final('Why did you choose Kafka?');
  fast.clock.advance(TurnManager.QUIET_WINDOW_MS.fast);
  assert.equal(fast.commits.length, 1);
  const relaxed = makeTurns('relaxed');
  relaxed.final('Why did you choose Kafka?');
  relaxed.clock.advance(TurnManager.QUIET_WINDOW_MS.balanced);
  assert.equal(relaxed.commits.length, 0);
  relaxed.tm.reset();
  relaxed.clock.advance(HARD_CAP_MS * 2);
  assert.equal(relaxed.commits.length, 0);
  assert.equal(relaxed.clock.pendingCount(), 0);
});

test('TurnManager: a provider endpoint commits after its confidence budget, with its source and confidence', () => {
  const t = makeTurns();
  t.final('Why did you choose Kafka?');
  t.clock.advance(100);
  t.tm.onProviderEndpoint({ type: 'speech_final', timestamp: t.clock.now(), confidence: 0.93 });
  t.clock.advance(TurnManager.CONFIRM_HIGH_MS - 1);
  assert.equal(t.commits.length, 0);
  t.clock.advance(1);
  assert.equal(t.commits.length, 1);
  assert.equal(t.commits[0].endpointSource, 'speech_final');
  assert.equal(t.commits[0].endpointConfidence, 0.93);
  assert.equal(t.tm.isArmed(), false);

  // No confidence → the per-source default (speech_final 0.85 → CONFIRM_MID_MS).
  const u = makeTurns();
  u.final('Why did you choose Kafka?');
  u.tm.onProviderEndpoint({ type: 'speech_final', timestamp: u.clock.now() });
  u.clock.advance(TurnManager.CONFIRM_MID_MS - 1);
  assert.equal(u.commits.length, 0);
  u.clock.advance(1);
  assert.equal(u.commits.length, 1);
});

// ── Detector ──────────────────────────────────────────────────────────────

function score(text, { turns = [], source = 'quiet_window', punct } = {}) {
  const punctuationSource = punct ?? (/[.?!]$/.test(text) ? 'provider' : 'unavailable');
  return scoreCandidate({
    candidate: { text, segments: [{ timestamp: 1000 }], startedAt: 1000, lastUpdatedAt: 1000, generation: 1, endpointSource: source, punctuationSource },
    recentTurns: turns, endpointSource: source, punctuationSource, questionId: '1-q1', candidateGeneration: 1, meetingGeneration: 1, now: 2000,
  });
}

test('Detector: thresholds are ordered and on the extractor scale', () => {
  assert.ok(WAIT_THRESHOLD < SPECULATION_THRESHOLD && SPECULATION_THRESHOLD < ANSWER_THRESHOLD);
  assert.equal(ANSWER_THRESHOLD, 0.88);
  assert.equal(SPECULATION_THRESHOLD, 0.82);
});

test('Detector: V2 §16 example acts', () => {
  assert.equal(score('Tell me about your last project.').dialogueAct, 'answerable_question');
  const ctx = [{ role: 'interviewer', text: 'Tell me about the cache layer.', timestamp: 1 }, { role: 'user', text: 'We used Redis in front of Postgres.', timestamp: 2 }];
  assert.equal(score('How would you scale that?', { turns: ctx }).dialogueAct, 'follow_up_question');
  assert.equal(score('Interesting.').dialogueAct, 'backchannel');
  assert.equal(score('Give me one second.').dialogueAct, 'pause_request');
  assert.equal(score('Can you hear me?').dialogueAct, 'confirmation');
  assert.equal(score("Wouldn't that be nice?").dialogueAct, 'rhetorical');
  assert.equal(score('How would you').dialogueAct, 'incomplete');
  assert.equal(score('Yeah, exactly.').dialogueAct, 'backchannel');
  assert.equal(score('Solve this using a hash map.').dialogueAct, 'coding_question');
  assert.equal(score('Tell me about a time you disagreed with your manager.').dialogueAct, 'behavioral_question');
});

test('Detector: directedness separates exposition from a question about the same topic (V2 §17)', () => {
  const expo = score('Companies often use Kafka when they need durable logs.');
  const ask = score('Why did you choose Kafka?');
  assert.ok(expo.directedness <= 0.2 && ask.directedness >= 1.0);
  assert.ok(expo.answerability < WAIT_THRESHOLD && ask.answerability >= ANSWER_THRESHOLD);
});

test('Detector: per-source completion — a provider endpoint scores higher completion than a quiet window', () => {
  assert.ok(score('Why did you choose Kafka?', { source: 'provider' }).completionConfidence > score('Why did you choose Kafka?').completionConfidence);
  assert.ok(score('How would you').completionConfidence <= 0.3);
});

test('Detector: no punctuation — a real question without "?" still reaches the answer band', () => {
  assert.ok(score('how would you design this system').answerability >= ANSWER_THRESHOLD);
  // …but a dangling conjunction on a punctuating provider is incomplete.
  assert.equal(score('How would you design the system and', { punct: 'provider' }).dialogueAct, 'incomplete');
});

test('Detector: declarative question ("So you own that service now.") is below the band — expectedFail until the audio model (V3 Amendment 9)', () => {
  // Audio-dependent: the question lives in pitch. The text path is expected
  // NOT to answer it; the replay fixture carries expectedFail: true.
  assert.ok(score('So you own that service now.').answerability < ANSWER_THRESHOLD);
});

test('Detector: decide() maps bands to actions', () => {
  const d = new AutoAnswerDetector();
  const mk = (text) => d.detect({
    candidate: { text, segments: [{ timestamp: 1 }], startedAt: 1, lastUpdatedAt: 1, generation: 1, endpointSource: 'quiet_window', punctuationSource: 'provider' },
    recentTurns: [], questionId: '1-q1', candidateGeneration: 1, meetingGeneration: 1, now: 2,
  });
  assert.equal(mk('Why did you choose Kafka?').action, 'answer');
  assert.equal(mk('How would you').action, 'wait');
  assert.equal(mk('Interesting.').action, 'ignore');
  assert.equal(mk('Give me one second.').reason, 'pause_request');
});

// ── Queue ─────────────────────────────────────────────────────────────────

test('Queue: single slot, same-id replaces in place, oldest evicted, TTL honoured', () => {
  const q = new AutoAnswerQueue();
  const mk = (id, gen = 1) => ({ id, text: id, meetingGeneration: gen });
  assert.equal(MAX_QUEUE_DEPTH, 1);
  assert.equal(q.enqueue(mk('a'), 0), null);
  assert.equal(q.enqueue(mk('a'), 10), null, 'revision of the same question replaces');
  assert.equal(q.depth(), 1);
  const evicted = q.enqueue(mk('b'), 20);
  assert.equal(evicted.question.id, 'a', 'the oldest goes');
  assert.equal(q.peek().question.id, 'b');
  assert.deepEqual(q.evictStale(2, 30).map(e => e.question.id), ['b'], 'other meeting generation');
  q.enqueue(mk('c'), 100);
  assert.equal(q.dequeue(100 + QUEUE_TTL_MS + 1), null, 'expired');
  q.enqueue(mk('d'), 200);
  assert.equal(q.replace('d', mk('d'), 201), true);
  assert.equal(q.remove('d'), true);
  assert.equal(q.depth(), 0);
});

// ── Policy ────────────────────────────────────────────────────────────────

function policyInput(over = {}) {
  return {
    enabled: true, meetingActive: true, generationAtCommit: 3, generationNow: 3,
    question: { id: '3-q1', text: 'Why did you choose Kafka?', answerability: 0.95, dialogueAct: 'general_question', meetingGeneration: 3 },
    engineAccepting: true, manualAnswerActive: false, automaticAnswerActive: false,
    duplicate: false, lastAnsweredText: null, queueDepth: 0, maxQueueDepth: 1, userChannelClear: true,
    thresholds: DEFAULT_THRESHOLDS, ...over,
  };
}

test('Policy: healthy input is auto; each guard flips it with its own reason', () => {
  assert.equal(evaluateAutoAnswerPolicy(policyInput()).action, 'auto');
  const cases = [
    [{ enabled: false }, 'silent', 'disabled'],
    [{ meetingActive: false }, 'silent', 'meeting_inactive'],
    [{ generationNow: 4 }, 'silent', 'stale_generation'],
    [{ question: null }, 'silent', 'no_question'],
    [{ lastAnsweredText: 'Why did you choose Kafka?' }, 'silent', 'already_answered'],
    [{ duplicate: true }, 'silent', 'duplicate'],
    [{ manualAnswerActive: true }, 'silent', 'manual_answer_active'],
    [{ automaticAnswerActive: true }, 'queue', 'ok'],
    [{ automaticAnswerActive: true, queueDepth: 1 }, 'queue', 'queue_full'],
    [{ engineAccepting: false }, 'queue', 'cooldown'],
    [{ userChannelClear: false }, 'wait', 'user_answering'],
    [{ question: { ...policyInput().question, answerability: 0.7 } }, 'offer', 'ok'],
    [{ question: { ...policyInput().question, answerability: 0.5 } }, 'silent', 'low_answerability'],
    [{ question: { ...policyInput().question, dialogueAct: 'pause_request' } }, 'silent', 'pause_request'],
    [{ question: { ...policyInput().question, dialogueAct: 'rhetorical' } }, 'silent', 'rhetorical'],
    [{ question: { ...policyInput().question, dialogueAct: 'incomplete' } }, 'wait', 'incomplete'],
  ];
  for (const [over, action, reason] of cases) {
    const d = evaluateAutoAnswerPolicy(policyInput(over));
    assert.equal(d.action, action, JSON.stringify(over));
    assert.equal(d.reason, reason, JSON.stringify(over));
  }
});

test('Policy: manual precedence beats queueing — a manual stream is never waited behind', () => {
  const d = evaluateAutoAnswerPolicy(policyInput({ manualAnswerActive: true, engineAccepting: false }));
  assert.equal(d.action, 'silent');
  assert.equal(d.reason, 'manual_answer_active');
});

test('Policy: thresholds are per-caller (Phase 6 per-mode) — a stricter mode turns auto into offer', () => {
  const strict = { ...DEFAULT_THRESHOLDS, autoThreshold: 0.99 };
  assert.equal(evaluateAutoAnswerPolicy(policyInput({ thresholds: strict })).action, 'offer');
});

// ── State machine (V2 §18) ────────────────────────────────────────────────

test('state machine: idle → listening → possible_question → (speculating) → question_complete → answering → listening', async () => {
  const h = makeHarness();
  assert.equal(h.controller.getState(), 'listening');
  h.interviewerFinal('Why did you');
  assert.ok(['possible_question', 'speculating'].includes(h.controller.getState()));
  h.interviewerFinal('choose Kafka?');
  assert.equal(h.controller.getState(), 'speculating', 'a strong partial candidate marks speculation');
  await h.advance(QUIET);
  assert.equal(h.controller.getState(), 'answering');
  h.controller.onEngineIdle();
  assert.equal(h.controller.getState(), 'listening');
  h.controller.onMeetingStop();
  assert.equal(h.controller.getState(), 'idle');
});

test('state machine: new transcript evidence invalidates an incomplete candidate (QUESTION_COMPLETE → POSSIBLE_QUESTION)', async () => {
  const h = makeHarness();
  h.interviewerFinal('How would you');
  await h.advance(HARD_CAP_MS);
  assert.equal(h.controller.getState(), 'possible_question');
  h.interviewerFinal('scale this to ten million users?');
  await h.advance(QUIET);
  assert.equal(h.controller.getState(), 'answering');
  assert.deepEqual(h.texts(), ['How would you scale this to ten million users?']);
});

test('channel gate: a meeting reset drops derived timestamps but not the live tracker flags', () => {
  const g = new ChannelGate.AutoAnswerChannelGate();
  g.noteEdge({ channel: 'user', speaking: true, atMs: 0, userEdgesVadBacked: true });
  g.noteEdge({ channel: 'user', speaking: false, atMs: 100, userEdgesVadBacked: true });
  assert.equal(g.verdict(200).kind, 'hold');
  g.reset();
  assert.equal(g.verdict(200).kind, 'dispatch');
});
