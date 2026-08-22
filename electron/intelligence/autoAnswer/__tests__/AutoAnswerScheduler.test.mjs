/**
 * AutoAnswerScheduler — the timer half of the Auto Answer trigger, driven by
 * a fake clock (zero real sleeps).
 *
 * Guards under mutation probe (see docs/autopilot/auto-answer-v3-progress.md):
 *   HARD_CAP        → 'hard cap: finals faster than the debounce still fire at HARD_CAP_MS'
 *   PENDING TTL     → 'pending: expires after PENDING_TTL_MS without firing'
 *   PENDING NEWER   → 'pending: a newer interviewer final supersedes the parked candidate'
 *   PENDING STOP    → 'pending: meeting stop drops the parked candidate'
 *   DEDUP           → 'an unchanged last turn is not re-dispatched after the cooldown'
 *   GENERATION      → 'a stop→start inside the debounce window drops the timer'
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  AutoAnswerScheduler, AUTO_ANSWER_DEBOUNCE_MS, HARD_CAP_MS, PENDING_TTL_MS, PENDING_RETRY_MS,
} = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswerScheduler.js'));

/** A host in which a dispatch SHOULD happen; tests break one field at a time. */
function makeHost(overrides = {}) {
  const state = {
    enabled: true,
    meetingActive: true,
    generation: 7,
    lastTurn: 'Tell me about a time you disagreed with your manager.',
    accepting: true,
    dispatched: [],
    skips: [],
    ...overrides,
  };
  const host = {
    isEnabled: () => state.enabled,
    isMeetingActive: () => state.meetingActive,
    meetingGeneration: () => state.generation,
    lastInterviewerTurn: () => state.lastTurn,
    engineAccepting: () => state.accepting,
    dispatch: (q) => state.dispatched.push(q),
    onSkip: (r) => state.skips.push(r),
  };
  return { host, state };
}

function setup(overrides) {
  const clock = new FakeClock();
  const { host, state } = makeHost(overrides);
  const scheduler = new AutoAnswerScheduler(host, clock);
  return { clock, state, scheduler };
}

test('constants are the campaign placeholders', () => {
  assert.equal(AUTO_ANSWER_DEBOUNCE_MS, 900);
  assert.equal(HARD_CAP_MS, 2500);
  assert.equal(PENDING_TTL_MS, 6000);
  assert.ok(PENDING_RETRY_MS < PENDING_TTL_MS);
});

test('a single final dispatches exactly once after the debounce', () => {
  const { clock, state, scheduler } = setup();
  scheduler.noteInterviewerFinal();
  clock.advance(AUTO_ANSWER_DEBOUNCE_MS - 1);
  assert.deepEqual(state.dispatched, [], 'not before the quiet window');
  clock.advance(1);
  assert.deepEqual(state.dispatched, [state.lastTurn]);
  clock.advance(10_000);
  assert.equal(state.dispatched.length, 1, 'nothing fires again on its own');
});

test('each new final restarts the debounce (a fragmented question coalesces into one trigger)', () => {
  const { clock, state, scheduler } = setup();
  scheduler.noteInterviewerFinal();
  clock.advance(500);
  scheduler.noteInterviewerFinal();
  clock.advance(500);
  assert.deepEqual(state.dispatched, [], '500 ms after the second final the window has not elapsed');
  clock.advance(400);
  assert.equal(state.dispatched.length, 1);
});

test('hard cap: finals faster than the debounce still fire at HARD_CAP_MS', () => {
  const { clock, state, scheduler } = setup();
  const t0 = clock.now();
  // A chatty provider: a final every 300 ms, forever.
  for (let i = 0; i < 40; i++) {
    scheduler.noteInterviewerFinal();
    clock.advance(300);
    if (state.dispatched.length) break;
  }
  assert.equal(state.dispatched.length, 1, 'the debounce must not be starved');
  const elapsed = clock.now() - t0;
  // Fired at the cap, not at some later restart: the 300 ms stepping means the
  // dispatch is observed at the first step boundary >= HARD_CAP_MS.
  assert.ok(elapsed >= HARD_CAP_MS && elapsed < HARD_CAP_MS + 300, `fired at +${elapsed}ms`);
});

test('hard cap: the cap is measured from the FIRST final of an accumulation and resets after a fire', () => {
  const { clock, state, scheduler } = setup();
  scheduler.noteInterviewerFinal();
  clock.advance(2000);
  scheduler.noteInterviewerFinal(); // debounce alone would wait until +2900
  clock.advance(500);               // cap elapses at +2500
  assert.equal(state.dispatched.length, 1);

  // A fresh accumulation gets a fresh cap.
  state.lastTurn = 'Why did you choose PostgreSQL?';
  scheduler.noteInterviewerFinal();
  clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  assert.equal(state.dispatched.length, 2);
});

test('pending: a busy engine parks the candidate and it fires when the engine idles', () => {
  const { clock, state, scheduler } = setup({ accepting: false });
  scheduler.noteInterviewerFinal();
  clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  assert.deepEqual(state.dispatched, []);
  assert.deepEqual(state.skips, ['engine_busy_or_cooling']);
  assert.ok(scheduler.getPending(), 'the candidate is parked');

  state.accepting = true;
  scheduler.noteEngineIdle();
  assert.deepEqual(state.dispatched, [state.lastTurn]);
  assert.equal(scheduler.getPending(), null);
});

test('pending: the retry poll rearms without an idle event (cooldown has no event of its own)', () => {
  const { clock, state, scheduler } = setup({ accepting: false });
  scheduler.noteInterviewerFinal();
  clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  state.accepting = true;
  clock.advance(PENDING_RETRY_MS);
  assert.deepEqual(state.dispatched, [state.lastTurn]);
});

test('pending: expires after PENDING_TTL_MS without firing', () => {
  const { clock, state, scheduler } = setup({ accepting: false });
  scheduler.noteInterviewerFinal();
  clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  clock.advance(PENDING_TTL_MS + PENDING_RETRY_MS);
  assert.equal(scheduler.getPending(), null, 'slot released');
  assert.ok(state.skips.includes('pending_expired'));

  // The engine idling afterwards must not resurrect it.
  state.accepting = true;
  scheduler.noteEngineIdle();
  clock.advance(10_000);
  assert.deepEqual(state.dispatched, []);
});

test('pending: a newer interviewer final supersedes the parked candidate', () => {
  const { clock, state, scheduler } = setup({ accepting: false });
  scheduler.noteInterviewerFinal();
  clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  assert.ok(scheduler.getPending());

  // The interviewer moves on while the engine is still busy.
  state.lastTurn = 'Actually, skip that — how would you scale it?';
  scheduler.noteInterviewerFinal();
  assert.equal(scheduler.getPending(), null, 'the old slot is dropped immediately');
  assert.ok(state.skips.includes('pending_superseded'));

  clock.advance(AUTO_ANSWER_DEBOUNCE_MS); // new candidate gated → parked
  state.accepting = true;
  scheduler.noteEngineIdle();
  assert.deepEqual(state.dispatched, ['Actually, skip that — how would you scale it?'], 'only the NEW question ever fires');
});

test('pending: the slot does not fire if the latest turn changed underneath it', () => {
  const { clock, state, scheduler } = setup({ accepting: false });
  scheduler.noteInterviewerFinal();
  clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  // A turn landed that never reached noteInterviewerFinal (e.g. toggle-off/on race).
  state.lastTurn = 'A different question?';
  state.accepting = true;
  scheduler.noteEngineIdle();
  assert.deepEqual(state.dispatched, [], 'the parked text no longer matches the live turn');
  assert.ok(state.skips.includes('pending_superseded'));
});

test('pending: meeting stop drops the parked candidate', () => {
  const { clock, state, scheduler } = setup({ accepting: false });
  scheduler.noteInterviewerFinal();
  clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  assert.ok(scheduler.getPending());
  scheduler.cancel();
  assert.equal(scheduler.getPending(), null);
  state.accepting = true;
  scheduler.noteEngineIdle();
  clock.advance(PENDING_TTL_MS);
  assert.deepEqual(state.dispatched, []);
});

test('cancel() clears an armed debounce', () => {
  const { clock, state, scheduler } = setup();
  scheduler.noteInterviewerFinal();
  assert.equal(scheduler.isArmed(), true);
  scheduler.cancel();
  assert.equal(scheduler.isArmed(), false);
  clock.advance(HARD_CAP_MS * 2);
  assert.deepEqual(state.dispatched, []);
});

test('a stop→start inside the debounce window drops the timer', () => {
  const { clock, state, scheduler } = setup();
  scheduler.noteInterviewerFinal();
  state.generation = 8; // endMeeting/startMeeting bumped it (cancel() is also called there, but the gate is the backstop)
  clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  assert.deepEqual(state.dispatched, []);
  assert.deepEqual(state.skips, ['stale_generation']);
});

test('an unchanged last turn is not re-dispatched after the cooldown', () => {
  const { clock, state, scheduler } = setup();
  scheduler.noteInterviewerFinal();
  clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  assert.equal(state.dispatched.length, 1);
  // The same final re-delivered (e.g. a provider re-emits; or an interviewer pause → same last turn).
  scheduler.noteInterviewerFinal();
  clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  assert.equal(state.dispatched.length, 1);
  assert.deepEqual(state.skips, ['already_answered']);
});

test('toggle OFF: nothing is armed and nothing fires', () => {
  const { clock, state, scheduler } = setup({ enabled: false });
  scheduler.noteInterviewerFinal();
  assert.equal(scheduler.isArmed(), false);
  clock.advance(HARD_CAP_MS * 2);
  assert.deepEqual(state.dispatched, []);
  assert.deepEqual(state.skips, [], 'off is silent — no timer, no gate evaluation');
});

test('draining after Stop: a final with the meeting inactive never arms', () => {
  const { clock, state, scheduler } = setup({ meetingActive: false });
  scheduler.noteInterviewerFinal();
  clock.advance(HARD_CAP_MS * 2);
  assert.deepEqual(state.dispatched, []);
});
