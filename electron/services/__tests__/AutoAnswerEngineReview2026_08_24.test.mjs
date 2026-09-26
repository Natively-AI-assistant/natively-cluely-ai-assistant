/**
 * Engine-side repro/regression tests for the 2026-08-24 code-review findings
 * on the Auto Answer V3 branch. Each test models the exact engine state the
 * finding describes, using the REAL synchronous prefix of runWhatShouldISay /
 * handleSuggestionTrigger (the same poke-the-instance pattern as
 * AutoAnswer.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

async function makeEngine() {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  return new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
}

test('review#2: a SPECULATIVE run is not "a manual answer" — isManualAnswerActive stays false, isAnswerStreaming true', async () => {
  const engine = await makeEngine();
  engine.lastTriggerTime = 0;
  assert.equal(engine.isManualAnswerActive(), false, 'idle engine');
  // Fire the real speculative path. Its synchronous prefix mints a generation,
  // stamps identities and sets mode 'what_to_say' before the first await.
  const run = engine.runWhatShouldISay('Why did you choose Kafka?', 0.8, undefined, { speculative: true })
    .catch(() => { /* provider calls fail in this harness; irrelevant to the sync prefix */ });
  assert.equal(engine.getActiveMode(), 'what_to_say', 'the speculative stream is live');
  assert.equal(engine.isAnswerStreaming(), true);
  assert.equal(
    engine.isManualAnswerActive(), false,
    'the engine\'s own prefetch must not read as a manual press — it silences every committed question while speculation runs',
  );
  engine.reset();
  await run;
});

test('review#2: a real MANUAL run still reads as manual', async () => {
  const engine = await makeEngine();
  engine.lastTriggerTime = 0;
  const run = engine.runWhatShouldISay('Why did you choose Kafka?', 0.8, undefined, { skipCooldown: true })
    .catch(() => { /* provider failure irrelevant */ });
  assert.equal(engine.isManualAnswerActive(), true, 'a manual press is untouchable');
  engine.reset();
  await run;
});

test('review#2: an AUTOMATIC run reads as neither manual nor speculative', async () => {
  const engine = await makeEngine();
  engine.lastTriggerTime = 0;
  // What handleSuggestionTrigger does for trigger.automatic before calling runWhatShouldISay:
  engine.nextRunIsAutomatic = true;
  const run = engine.runWhatShouldISay('Why did you choose Kafka?', 0.8, undefined, { skipCooldown: true })
    .catch(() => { /* provider failure irrelevant */ });
  assert.equal(engine.isManualAnswerActive(), false, 'an automatic run may be superseded/queued behind');
  assert.equal(engine.cancelAutomaticAnswer('user_barge_in'), true, 'and barge-in can cancel it');
  engine.reset();
  await run;
});

test('review#3: barge-in lands while the automatic trigger is still at the planner (mode idle) — it must still cancel', async () => {
  const engine = await makeEngine();
  engine.lastTriggerTime = 0;
  let plannerRelease;
  let wtaCalled = false;
  engine.planSuggestionTrigger = () => new Promise((resolve) => { plannerRelease = () => resolve({ kind: 'answer', reason: 'answerable_question', confidence: 0.9 }); });
  const origWta = engine.runWhatShouldISay.bind(engine);
  engine.runWhatShouldISay = async (...args) => { wtaCalled = true; return origWta(...args).catch(() => null); };

  const trigger = engine.handleSuggestionTrigger({ context: '', lastQuestion: 'Why did you choose Kafka?', confidence: 0.9, automatic: true });
  await new Promise((r) => setImmediate(r));            // parked at the planner await; mode is still 'idle'
  assert.equal(engine.getActiveMode(), 'idle');
  assert.equal(engine.cancelAutomaticAnswer('user_barge_in'), true, 'the pending automatic trigger is cancellable');
  plannerRelease();
  await trigger;
  assert.equal(wtaCalled, false, 'the cancelled trigger must not stream an answer over the user\'s own speech');
  engine.reset();
});

test('review#3: without a barge-in the pending trigger proceeds normally', async () => {
  const engine = await makeEngine();
  engine.lastTriggerTime = 0;
  let plannerRelease;
  let wtaCalled = false;
  engine.planSuggestionTrigger = () => new Promise((resolve) => { plannerRelease = () => resolve({ kind: 'answer', reason: 'answerable_question', confidence: 0.9 }); });
  engine.runWhatShouldISay = async () => { wtaCalled = true; return null; };
  const trigger = engine.handleSuggestionTrigger({ context: '', lastQuestion: 'Why did you choose Kafka?', confidence: 0.9, automatic: true });
  await new Promise((r) => setImmediate(r));
  plannerRelease();
  await trigger;
  assert.equal(wtaCalled, true);
  engine.reset();
});
