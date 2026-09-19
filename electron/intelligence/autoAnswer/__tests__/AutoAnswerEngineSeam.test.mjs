/**
 * Regression coverage for the SimpleAutoAnswer -> IntelligenceEngine seam.
 * The controller's 0.30 answerability floor is deliberately lower than the
 * generic native trigger's 0.50 confidence floor; an approved automatic answer
 * must not be judged a second time by that unrelated gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

test('judge-approved 0.31 answerability reaches the UI through the real engine seam', async () => {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
  const answer = 'I would use health checks, multiple availability zones, and tested failover procedures.';
  let plannerTrigger;
  const finals = [];

  engine.lastTriggerTime = 0;
  engine.planSuggestionTrigger = async (trigger) => {
    plannerTrigger = trigger;
    return { kind: 'answer', reason: 'answerable_question', confidence: 0.9 };
  };
  engine.whatToAnswerLLM = {
    async *generateStream() { yield answer; },
  };
  engine.on('suggested_answer', (text) => finals.push(text));

  await engine.runAutoAnswer({
    id: 'q-low-band',
    text: 'How would you make this deployment resilient?',
    confidence: 0.31,
    answerability: 0.31,
    dialogueAct: 'technical_question',
    isFollowUp: false,
    endpointSource: 'quiet_window',
    candidateGeneration: 1,
  }, { reuseSpeculative: false, context: '' });

  assert.equal(plannerTrigger.confidence, undefined, 'Auto Answer must not forward answerability into the generic confidence gate');
  assert.deepEqual(finals, [answer]);
  assert.equal(session.getFullUsage().at(-1)?.answer, answer);
  engine.reset();
});
