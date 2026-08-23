/**
 * Ternary dispatch and the offer card (V3 Amendment 4).
 *
 * Mutation probes (docs/autopilot/auto-answer-v3-progress.md, Phase 6):
 *   auto requires user silent → 'auto requires the user channel clear: a speaking user turns auto into a hold/drop, never a fire'
 *   auto requires engine idle → 'auto requires an idle engine: a busy engine queues, it never fires'
 *   per-mode thresholds      → 'per-mode thresholds: the same question is auto in an interview mode and an offer in a meeting mode'
 *   offer TTL                → 'offer card: expires after OFFER_TTL_MS'
 *   offer replace            → 'offer card: a newer candidate replaces it in place'
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeHarness, QUIET, Controller, Policy, USER_SILENCE_MS } from './harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const registry = require(path.resolve(__dirname, '../../../../dist-electron/electron/context-intelligence/policies/mode-policy-registry.js'));
const { resolveAutoAnswerThresholds, MODE_POLICIES, AUTO_ANSWER_DEFAULT_THRESHOLDS } = registry;
const { OFFER_TTL_MS } = Controller;
const { evaluateAutoAnswerPolicy } = Policy;

const Q = 'Why did you choose PostgreSQL?';

function withOffers(overrides = {}, options = {}) {
  const h = makeHarness(overrides, options);
  h.state.retracted = [];
  h.host.retractOffer = (id, reason) => h.state.retracted.push({ id, reason });
  return h;
}

// ── per-mode thresholds (stored next to the retrieval policy) ─────────────

test('every built-in mode carries Auto Answer thresholds next to its retrieval policy; interview < meeting < listening', () => {
  for (const [id, policy] of Object.entries(MODE_POLICIES)) {
    assert.ok(policy.autoAnswer, `${id} has no autoAnswer thresholds`);
    assert.ok(policy.retrievalPolicy, `${id} has no retrieval policy`);
    const t = policy.autoAnswer;
    assert.ok(t.offerThreshold < t.speculationThreshold && t.speculationThreshold <= t.autoThreshold, `${id}: ${JSON.stringify(t)}`);
  }
  const interview = resolveAutoAnswerThresholds('technical-interview');
  const meeting = resolveAutoAnswerThresholds('general');
  const listening = resolveAutoAnswerThresholds('lecture');
  assert.ok(interview.autoThreshold < meeting.autoThreshold, 'Interview mode has the lower bar');
  assert.ok(meeting.autoThreshold < listening.autoThreshold);
  assert.deepEqual(resolveAutoAnswerThresholds('looking-for-work'), interview);
  assert.deepEqual(resolveAutoAnswerThresholds('some-custom-mode'), AUTO_ANSWER_DEFAULT_THRESHOLDS, 'unknown → the stricter meeting bar');
  assert.deepEqual(resolveAutoAnswerThresholds(null), AUTO_ANSWER_DEFAULT_THRESHOLDS);
});

test('per-mode thresholds: the same question is auto in an interview mode and an offer in a meeting mode', async () => {
  // "Tell me about your last project." scores ~0.90 on the composite: above the
  // interview auto bar (0.88), below the meeting one (0.94).
  const text = 'Tell me about your last project.';
  const interview = withOffers({}, { thresholds: resolveAutoAnswerThresholds('technical-interview') });
  interview.interviewerFinal(text);
  await interview.advance(QUIET);
  assert.deepEqual(interview.texts(), [text]);
  assert.deepEqual(interview.state.offered, []);

  const meeting = withOffers({}, { thresholds: resolveAutoAnswerThresholds('general') });
  meeting.interviewerFinal(text);
  await meeting.advance(QUIET);
  assert.deepEqual(meeting.texts(), [], 'meeting mode does not auto-fire at this answerability');
  assert.equal(meeting.state.offered.length, 1, 'it offers instead');
  assert.equal(meeting.state.offered[0].text, text);
  assert.equal(meeting.controller.getActiveOffer()?.text, text);

  // setThresholds at runtime (mode switch mid-meeting) takes effect on the next commit.
  meeting.controller.setThresholds(resolveAutoAnswerThresholds('technical-interview'));
  await meeting.advance(5000);
  meeting.interviewerFinal('Walk me through the architecture.');
  await meeting.advance(QUIET);
  assert.deepEqual(meeting.texts(), ['Walk me through the architecture.']);
});

test('policy: below the offer bar is silent, between the bars is offer, at/above auto is auto', () => {
  const base = {
    enabled: true, meetingActive: true, generationAtCommit: 1, generationNow: 1,
    engineAccepting: true, manualAnswerActive: false, automaticAnswerActive: false,
    duplicate: false, lastAnsweredText: null, queueDepth: 0, maxQueueDepth: 1, userChannelClear: true,
    thresholds: { autoThreshold: 0.9, offerThreshold: 0.6, speculationThreshold: 0.8 },
  };
  const q = (a) => ({ id: '1-q1', text: 'Why did you choose Kafka?', answerability: a, dialogueAct: 'general_question', meetingGeneration: 1 });
  assert.equal(evaluateAutoAnswerPolicy({ ...base, question: q(0.59) }).action, 'silent');
  assert.equal(evaluateAutoAnswerPolicy({ ...base, question: q(0.60) }).action, 'offer');
  assert.equal(evaluateAutoAnswerPolicy({ ...base, question: q(0.89) }).action, 'offer');
  assert.equal(evaluateAutoAnswerPolicy({ ...base, question: q(0.90) }).action, 'auto');
});

// ── auto additionally requires user silent AND engine idle ────────────────

test('auto requires the user channel clear: a speaking user turns auto into a hold/drop, never a fire', async () => {
  const h = withOffers();
  h.edge('interviewer', true); await h.advance(800); h.edge('interviewer', false);
  h.interviewerFinal(Q);
  await h.advance(200);
  h.edge('user', true);                 // answering
  await h.advance(QUIET + USER_SILENCE_MS + 3000);
  assert.deepEqual(h.texts(), []);
  assert.ok(h.state.skips.includes('user_answering'));
  assert.deepEqual(h.state.offered, [], 'an auto-band question that the user is answering is not even offered');
});

test('auto requires an idle engine: a busy engine queues, it never fires', async () => {
  const h = withOffers({ accepting: false });
  h.interviewerFinal(Q);
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), []);
  assert.equal(h.controller.getState(), 'queued');
  assert.equal(h.controller.queueDepth(), 1);
  h.state.accepting = true;
  h.controller.onEngineIdle();
  await h.flush();
  assert.deepEqual(h.texts(), [Q]);
});

// ── offer card lifecycle ──────────────────────────────────────────────────

const MEETING = { thresholds: resolveAutoAnswerThresholds('general') };
const OFFER_Q = 'Tell me about your last project.';

test('offer card: shown once with the detected question; telemetry carries no text', async () => {
  const h = withOffers({}, MEETING);
  h.interviewerFinal(OFFER_Q);
  await h.advance(QUIET);
  assert.equal(h.state.offered.length, 1);
  assert.equal(h.state.offered[0].text, OFFER_Q);
  const offered = h.state.events.find(e => e.name === 'auto_answer_offered');
  assert.ok(offered);
  assert.ok(!JSON.stringify(offered).toLowerCase().includes('project'));
  assert.equal(h.controller.getState(), 'listening');
});

test('offer card: expires after OFFER_TTL_MS', async () => {
  const h = withOffers({}, MEETING);
  h.interviewerFinal(OFFER_Q);
  await h.advance(QUIET);
  assert.ok(h.controller.getActiveOffer());
  await h.advance(OFFER_TTL_MS - 1);
  assert.ok(h.controller.getActiveOffer(), 'still up one ms before the TTL');
  assert.deepEqual(h.state.retracted, []);
  await h.advance(1);
  assert.equal(h.controller.getActiveOffer(), null);
  assert.deepEqual(h.state.retracted.map(r => r.reason), ['expired']);
});

test('offer card: a newer candidate replaces it in place', async () => {
  const h = withOffers({}, MEETING);
  h.interviewerFinal(OFFER_Q);
  await h.advance(QUIET);
  const first = h.controller.getActiveOffer();
  await h.advance(4500);
  h.interviewerFinal('Walk me through the architecture.');
  await h.advance(QUIET);
  assert.equal(h.state.offered.length, 2);
  assert.equal(h.controller.getActiveOffer()?.text, 'Walk me through the architecture.');
  assert.deepEqual(h.state.retracted.map(r => [r.id, r.reason]), [[first.id, 'topic_change']]);
  // Only ONE card is ever live, and its TTL restarted with the replacement.
  await h.advance(OFFER_TTL_MS - 1);
  assert.ok(h.controller.getActiveOffer());
  await h.advance(1);
  assert.equal(h.controller.getActiveOffer(), null);
});

test('offer card: topic change — an auto-band question retracts a standing offer and fires', async () => {
  const h = withOffers({}, MEETING);
  h.interviewerFinal(OFFER_Q);
  await h.advance(QUIET);
  await h.advance(4500);
  h.interviewerFinal('Why did you choose PostgreSQL?');   // ~1.0: auto even in meeting mode
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), ['Why did you choose PostgreSQL?']);
  assert.equal(h.controller.getActiveOffer(), null);
  assert.ok(h.state.retracted.some(r => r.reason === 'topic_change'));
});

test('offer card: the What-to-Answer hotkey / click commits it', async () => {
  const h = withOffers({}, MEETING);
  h.interviewerFinal(OFFER_Q);
  await h.advance(QUIET);
  assert.ok(h.controller.getActiveOffer());
  h.controller.onManualAnswerStarted();
  assert.equal(h.controller.getActiveOffer(), null);
  assert.deepEqual(h.state.retracted.map(r => r.reason), ['committed']);
  await h.advance(OFFER_TTL_MS * 2);
  assert.equal(h.state.retracted.length, 1, 'no double retraction from the dead TTL timer');
});

test('offer card: the user starting to answer, or the meeting stopping, takes the card down', async () => {
  const h = withOffers({}, MEETING);
  h.interviewerFinal(OFFER_Q);
  await h.advance(QUIET);
  h.edge('user', true);
  assert.equal(h.controller.getActiveOffer(), null);
  assert.deepEqual(h.state.retracted.map(r => r.reason), ['user_answering']);

  const g = withOffers({}, MEETING);
  g.interviewerFinal(OFFER_Q);
  await g.advance(QUIET);
  g.controller.onMeetingStop();
  assert.deepEqual(g.state.retracted.map(r => r.reason), ['meeting_stop']);
  assert.equal(g.clock.pendingCount(), 0);
});

test('offer card: an offered question is remembered for dedup — repeating it does not offer twice', async () => {
  const h = withOffers({}, MEETING);
  h.interviewerFinal(OFFER_Q);
  await h.advance(QUIET);
  await h.advance(OFFER_TTL_MS + 100);
  h.interviewerFinal(OFFER_Q);
  await h.advance(QUIET);
  assert.equal(h.state.offered.length, 1);
  assert.ok(h.state.skips.includes('duplicate') || h.state.skips.includes('already_answered'));
});
