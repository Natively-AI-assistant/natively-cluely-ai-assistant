/**
 * Dual-channel preconditions on the Auto Answer trigger (V3 Amendment 1),
 * driven through the scheduler with a fake clock and synthetic speech edges
 * shaped exactly like the native tracker's SpeechEdgeEvent.
 *
 * Mutation probes (see docs/autopilot/auto-answer-v3-progress.md):
 *   USER_SILENCE guard  → 'user silent: a question followed by dual-channel silence fires after USER_SILENCE_MS'
 *                          + 'user answers promptly: a user edge inside the window cancels the candidate'
 *   OVERLAP veto        → 'overlap veto: both channels active at the boundary holds the dispatch'
 *   BARGE-IN            → 'barge-in: user speech during a streaming automatic answer cancels it'
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
  AutoAnswerScheduler, AUTO_ANSWER_DEBOUNCE_MS, USER_SILENCE_MS, OVERLAP_VETO_MS, HOLD_BUDGET_MS,
} = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswerScheduler.js'));

function setup(overrides = {}, tuning = {}) {
  const clock = new FakeClock();
  const state = {
    enabled: true, meetingActive: true, generation: 3,
    lastTurn: 'Why did you choose Kafka?', accepting: true,
    dispatched: [], skips: [], cancelled: [],
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
    cancelAutomaticAnswer: (reason) => { state.cancelled.push(reason); return true; },
  };
  const scheduler = new AutoAnswerScheduler(host, clock, tuning);
  // Edge factory on the same timeline as the clock.
  const edge = (channel, speaking, extra = {}) => scheduler.noteSpeechEdge({
    channel, speaking, joint: 'neither', atMs: clock.now(), msSinceOtherEdge: -1, userEdgesVadBacked: true, ...extra,
  });
  return { clock, state, scheduler, edge };
}

/** Interviewer speaks, stops, the final lands — the common shape every case starts from. */
function interviewerAsks({ scheduler, edge, clock }) {
  edge('interviewer', true);
  clock.advance(1500);
  edge('interviewer', false);
  clock.advance(100);
  scheduler.noteInterviewerFinal();
}

test('user silent: a question followed by dual-channel silence fires after the debounce', () => {
  const s = setup();
  interviewerAsks(s);
  s.clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  assert.deepEqual(s.state.dispatched, ['Why did you choose Kafka?']);
  assert.deepEqual(s.state.skips, []);
});

test('user silent: a question followed by dual-channel silence fires after USER_SILENCE_MS', () => {
  // The user was talking just before the question ended (last user edge 200 ms before the final).
  const s = setup();
  s.edge('user', true);
  s.clock.advance(400);
  s.edge('interviewer', true);
  s.clock.advance(300);
  s.edge('user', false);                 // user stops; interviewer still speaking
  s.clock.advance(200);
  s.edge('interviewer', false);
  s.scheduler.noteInterviewerFinal();    // user ended 200 ms ago
  s.clock.advance(AUTO_ANSWER_DEBOUNCE_MS);   // 1100 ms since the user stopped >= USER_SILENCE_MS → fires
  assert.equal(s.state.dispatched.length, 1);

  // Now the tight case: user stopped only 100 ms before the debounce fires.
  const t = setup();
  t.edge('interviewer', true);
  t.clock.advance(300);
  t.edge('interviewer', false);
  t.scheduler.noteInterviewerFinal();
  t.clock.advance(AUTO_ANSWER_DEBOUNCE_MS - 300);
  t.edge('user', true);
  t.clock.advance(100);
  t.edge('user', false);                // user ended 200 ms before the debounce fires
  t.clock.advance(200);
  assert.deepEqual(t.state.dispatched, [], 'the gate fired but the user has only been silent 200 ms');
  assert.ok(t.state.skips.includes('user_answering'), 'the user edge cancelled the armed candidate');
});

test('user silent after a hold: the dispatch is delayed exactly until USER_SILENCE_MS of silence', () => {
  // The user was already talking (over the interviewer's last words, VAD-backed
  // mic) BEFORE the final armed the timer, so no start-edge cancellation
  // happens; they stop 200 ms before the debounce fires → HOLD for the
  // remaining 500 ms, then dispatch.
  const s = setup();
  s.edge('interviewer', true);
  s.clock.advance(1000);
  s.edge('user', true);                  // joint both, before anything is armed
  s.clock.advance(100);
  s.edge('interviewer', false);
  s.scheduler.noteInterviewerFinal();    // t0: debounce fires at t0+900
  s.clock.advance(700);
  s.edge('user', false);                 // t0+700: user silent from here
  s.clock.advance(200);                  // t0+900: fire → only 200 ms of user silence → hold 500
  assert.deepEqual(s.state.dispatched, [], 'held, not dispatched');
  assert.deepEqual(s.state.skips, [], 'a hold is not a skip');
  assert.equal(s.scheduler.isArmed(), true);
  s.clock.advance(USER_SILENCE_MS - 200 - 1);
  assert.deepEqual(s.state.dispatched, [], 'one ms short of USER_SILENCE_MS');
  s.clock.advance(1);
  assert.deepEqual(s.state.dispatched, ['Why did you choose Kafka?'], 'fires at exactly USER_SILENCE_MS of user silence');
});

test('user still speaking when the gate fires: dropped as user_answering, never held', () => {
  const s = setup();
  s.edge('interviewer', true);
  s.clock.advance(1000);
  s.edge('user', true);                  // started before the timer existed
  s.clock.advance(100);
  s.edge('interviewer', false);
  s.scheduler.noteInterviewerFinal();
  s.clock.advance(AUTO_ANSWER_DEBOUNCE_MS); // user still talking
  assert.deepEqual(s.state.dispatched, []);
  assert.deepEqual(s.state.skips, ['user_answering']);
  assert.equal(s.scheduler.isArmed(), false, 'dropped, not re-armed');
});

test('user answers promptly: a user edge inside the window cancels the candidate', () => {
  const s = setup();
  interviewerAsks(s);
  s.clock.advance(400);           // inside the 900 ms quiet window
  s.edge('user', true);           // the user starts answering
  assert.deepEqual(s.state.skips, ['user_answering']);
  assert.equal(s.scheduler.isArmed(), false);
  s.clock.advance(10_000);
  assert.deepEqual(s.state.dispatched, [], 'never fires: the user did not need help');
});

test('user answers promptly: a parked (engine-busy) candidate is dropped too', () => {
  const s = setup({ accepting: false });
  interviewerAsks(s);
  s.clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  assert.ok(s.scheduler.getPending(), 'parked');
  s.edge('user', true);
  assert.equal(s.scheduler.getPending(), null);
  assert.ok(s.state.skips.includes('user_answering'));
  s.state.accepting = true;
  s.scheduler.noteEngineIdle();
  assert.deepEqual(s.state.dispatched, []);
});

test('overlap veto: both channels active at the boundary holds the dispatch', () => {
  // Isolate the veto from the user-silence rule (which at the default 700 ms
  // always dominates the 400 ms veto) by zeroing userSilenceMs.
  const s = setup({}, { userSilenceMs: 0 });
  s.edge('interviewer', true);
  s.clock.advance(1000);
  s.scheduler.noteInterviewerFinal();       // fires at +900
  s.clock.advance(700);
  s.edge('user', true, { userEdgesVadBacked: false }); // RMS-only mic edge while interviewer speaks: not a clean user start
  assert.deepEqual(s.state.skips, [], 'not treated as user_answering: could be speaker bleed');
  s.clock.advance(150);
  s.edge('user', false);                    // 'both' ended at +850
  s.edge('interviewer', false);
  s.clock.advance(50);                      // +900: both ended 50 ms ago → HOLD (veto window 400)
  assert.deepEqual(s.state.dispatched, [], 'held: the boundary was not clean');
  assert.equal(s.scheduler.isArmed(), true);
  s.clock.advance(OVERLAP_VETO_MS - 50 - 1);
  assert.deepEqual(s.state.dispatched, []);
  s.clock.advance(1);
  assert.deepEqual(s.state.dispatched, ['Why did you choose Kafka?'], 'fires once the veto window has elapsed');
});

test('hold budget: a user who keeps talking over the boundary drops the candidate as user_answering', () => {
  const s = setup();
  s.edge('interviewer', true);
  s.clock.advance(500);
  s.scheduler.noteInterviewerFinal();
  // The user talks continuously with the interviewer from before the final
  // through the whole hold budget (joint 'both' the entire time; RMS-only mic).
  s.edge('user', true, { userEdgesVadBacked: false });
  s.clock.advance(AUTO_ANSWER_DEBOUNCE_MS);     // fire → both → hold
  assert.deepEqual(s.state.dispatched, []);
  s.clock.advance(HOLD_BUDGET_MS + OVERLAP_VETO_MS);
  assert.deepEqual(s.state.dispatched, [], 'never dispatched under sustained overlap');
  assert.ok(s.state.skips.includes('user_answering'), 'dropped with a machine-readable reason');
  assert.equal(s.scheduler.isArmed(), false, 'no timer left behind');
});

test('barge-in: user speech during a streaming automatic answer cancels it', () => {
  const s = setup();
  interviewerAsks(s);
  s.clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  assert.equal(s.state.dispatched.length, 1, 'automatic answer dispatched');
  s.clock.advance(800);
  s.edge('user', true);            // the user starts speaking mid-stream
  assert.deepEqual(s.state.cancelled, ['user_barge_in']);
  assert.ok(s.state.skips.includes('user_barge_in'));
  // Engine goes idle after the abort; a later user edge must not cancel again.
  s.scheduler.noteEngineIdle();
  s.edge('user', false);
  s.edge('user', true);
  assert.equal(s.state.cancelled.length, 1);
});

test('barge-in: nothing to cancel once the engine reported idle (a manual answer is never touched here)', () => {
  const s = setup();
  interviewerAsks(s);
  s.clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  s.scheduler.noteEngineIdle();    // automatic answer finished
  s.edge('user', true);
  assert.deepEqual(s.state.cancelled, [], 'the host cancel hook is not even consulted');
});

test('barge-in: a user edge that overlaps interviewer speech on an RMS-only mic does not cancel', () => {
  const s = setup();
  interviewerAsks(s);
  s.clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  s.edge('interviewer', true);     // interviewer keeps talking while the answer streams
  s.edge('user', true, { userEdgesVadBacked: false });  // likely speaker bleed on Windows
  assert.deepEqual(s.state.cancelled, [], 'weak evidence: no cancel');
  s.edge('user', false);
  s.edge('user', true, { userEdgesVadBacked: true });   // macOS VAD-backed edge: real speech
  assert.deepEqual(s.state.cancelled, ['user_barge_in']);
});

test('interviewer resuming during the quiet window holds the dispatch until they stop', () => {
  const s = setup();
  interviewerAsks(s);
  s.clock.advance(400);
  s.edge('interviewer', true);        // "...and also — " the question was not over
  assert.deepEqual(s.state.skips, [], 'an interviewer edge is never a user event');
  s.clock.advance(600);               // debounce fires → interviewer speaking → hold
  assert.deepEqual(s.state.dispatched, []);
  s.clock.advance(300);
  s.edge('interviewer', false);
  s.state.lastTurn = 'Why did you choose Kafka, and would you again?';
  s.scheduler.noteInterviewerFinal();  // the completed question restarts the debounce
  s.clock.advance(AUTO_ANSWER_DEBOUNCE_MS);
  assert.deepEqual(s.state.dispatched, ['Why did you choose Kafka, and would you again?'], 'one dispatch, the COMPLETE question');
});

test('interviewer who never stops: the hold budget drops the candidate as incomplete, not user_answering', () => {
  const s = setup();
  s.scheduler.noteInterviewerFinal();
  s.edge('interviewer', true);
  s.clock.advance(AUTO_ANSWER_DEBOUNCE_MS + HOLD_BUDGET_MS + OVERLAP_VETO_MS);
  assert.deepEqual(s.state.dispatched, []);
  assert.ok(s.state.skips.includes('incomplete'));
  assert.ok(!s.state.skips.includes('user_answering'));
});
