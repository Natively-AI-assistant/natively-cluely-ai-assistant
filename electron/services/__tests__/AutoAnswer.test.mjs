/**
 * Auto Answer (Settings > General, default OFF).
 *
 * Two halves are covered here:
 *   1. evaluateAutoAnswerGate — every guard AppState consults when the debounce
 *      fires. Pure, so each guard gets an isolated case plus a mutation probe
 *      proving the case is not vacuous.
 *   2. IntelligenceEngine.canAutoAnswer — the mode + cooldown gate that stops an
 *      auto-trigger from superseding an in-flight manual What-to-Answer press.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gatePath = path.resolve(__dirname, '../../../dist-electron/electron/intelligence/autoAnswerGate.js');
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

const { evaluateAutoAnswerGate } = require(gatePath);

/** The world in which a dispatch SHOULD happen. Each case below breaks one field. */
function healthyInput(overrides = {}) {
  return {
    enabled: true,
    meetingActive: true,
    generationAtSchedule: 7,
    generationNow: 7,
    lastQuestion: 'Tell me about a time you disagreed with your manager.',
    lastAnsweredQuestion: null,
    engineAccepting: true,
    ...overrides,
  };
}

test('the healthy baseline dispatches — otherwise every case below is vacuous', () => {
  const decision = evaluateAutoAnswerGate(healthyInput());
  assert.equal(decision.dispatch, true);
  assert.equal(decision.question, 'Tell me about a time you disagreed with your manager.');
});

test('the toggle is the master switch: off means the hotkey stays the only path', () => {
  assert.deepEqual(
    evaluateAutoAnswerGate(healthyInput({ enabled: false })),
    { dispatch: false, reason: 'disabled' },
  );
});

test('a meeting that has stopped produces no answer, even mid-drain', () => {
  // The transcript handler keeps running during the post-Stop `_isDraining`
  // window so trailing finals are not lost; those finals must not answer.
  assert.deepEqual(
    evaluateAutoAnswerGate(healthyInput({ meetingActive: false })),
    { dispatch: false, reason: 'meeting_inactive' },
  );
});

test('a timer armed by a previous meeting cannot fire into the next one', () => {
  assert.deepEqual(
    evaluateAutoAnswerGate(healthyInput({ generationAtSchedule: 7, generationNow: 8 })),
    { dispatch: false, reason: 'stale_generation' },
  );
});

test('no final interviewer turn yet means nothing to answer', () => {
  for (const lastQuestion of [null, undefined, '', '   ']) {
    assert.deepEqual(
      evaluateAutoAnswerGate(healthyInput({ lastQuestion })),
      { dispatch: false, reason: 'no_question' },
      `expected no_question for ${JSON.stringify(lastQuestion)}`,
    );
  }
});

test('an unchanged turn is answered once, not once per cooldown lapse', () => {
  const question = 'What is your greatest weakness?';
  const first = evaluateAutoAnswerGate(healthyInput({ lastQuestion: question }));
  assert.equal(first.dispatch, true);

  // AppState records the dispatched turn; the same final arriving again (the
  // interviewer thinking out loud, no new question) must not re-answer.
  assert.deepEqual(
    evaluateAutoAnswerGate(healthyInput({ lastQuestion: question, lastAnsweredQuestion: question })),
    { dispatch: false, reason: 'already_answered' },
  );

  // A genuinely new question still gets through.
  assert.equal(
    evaluateAutoAnswerGate(healthyInput({
      lastQuestion: 'And how did you resolve it?',
      lastAnsweredQuestion: question,
    })).dispatch,
    true,
  );
});

test('dedup compares the trimmed turn, matching what AppState stores', () => {
  assert.deepEqual(
    evaluateAutoAnswerGate(healthyInput({
      lastQuestion: '  Why this role?  ',
      lastAnsweredQuestion: 'Why this role?',
    })),
    { dispatch: false, reason: 'already_answered' },
  );
});

test('a busy or cooling engine defers — this is what protects a manual answer', () => {
  assert.deepEqual(
    evaluateAutoAnswerGate(healthyInput({ engineAccepting: false })),
    { dispatch: false, reason: 'engine_busy_or_cooling' },
  );
});

// ── IntelligenceEngine.canAutoAnswer ────────────────────────────────────────

async function makeEngine() {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
  return engine;
}

test('canAutoAnswer accepts an idle engine', async () => {
  const engine = await makeEngine();
  engine.lastTriggerTime = 0;
  assert.equal(engine.canAutoAnswer(), true);
});

test('canAutoAnswer refuses while a What-to-Answer stream is live', async () => {
  const engine = await makeEngine();
  engine.lastTriggerTime = 0;

  // runWhatShouldISay opens with whatToAnswerCancellationToken.abort('superseded'),
  // so dispatching here would kill the answer the user asked for by hand.
  engine.activeMode = 'what_to_say';
  assert.equal(engine.canAutoAnswer(), false);

  // 'assist' is passive observation — the same state maybeSpeculate treats as free.
  engine.activeMode = 'assist';
  assert.equal(engine.canAutoAnswer(), true);
});

test('canAutoAnswer refuses inside the trigger cooldown and recovers after it', async () => {
  const engine = await makeEngine();
  engine.activeMode = 'idle';

  engine.lastTriggerTime = Date.now();
  assert.equal(engine.canAutoAnswer(), false, 'a trigger just fired');

  // triggerCooldown is 3000ms; step just past it without sleeping.
  engine.lastTriggerTime = Date.now() - 3001;
  assert.equal(engine.canAutoAnswer(), true, 'cooldown elapsed');
});
