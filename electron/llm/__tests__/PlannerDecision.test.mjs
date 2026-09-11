import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const plannerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/PlannerDecision.js');

async function loadPlanner() {
  return import(pathToFileURL(plannerPath).href);
}

function decide(input) {
  return loadPlanner().then(({ planNextAssistantAction }) => planNextAssistantAction({
    confidence: 0.9,
    now: 10_000,
    lastTriggerTime: 0,
    cooldownMs: 3000,
    ...input,
  }));
}

test('PlannerDecision stays silent for low-confidence non-visual triggers', async () => {
  const decision = await decide({ triggerQuestion: 'maybe something', confidence: 0.3 });

  assert.equal(decision.kind, 'silent');
  assert.equal(decision.reason, 'low_confidence');
});

test('PlannerDecision stays silent during cooldown', async () => {
  const decision = await decide({
    triggerQuestion: 'How should I answer this?',
    // The utterance the cooldown is guarding against re-triggering on.
    lastTriggerQuestion: 'How should I answer this',
    now: 10_000,
    lastTriggerTime: 9_000,
  });

  assert.equal(decision.kind, 'silent');
  assert.equal(decision.reason, 'cooldown');
});

// 2026-09-11: with NO previous question text on record, a question-shaped
// utterance inside the window is a real turn; a bare fragment is still silenced.
test('PlannerDecision: a question-shaped turn passes the cooldown when the last trigger carried no text', async () => {
  const decision = await decide({
    triggerQuestion: 'can you summarise the meeting so far',
    now: 10_000,
    lastTriggerTime: 9_000,
  });
  assert.notEqual(decision.reason, 'cooldown');
});

test('PlannerDecision: a bare fragment inside the cooldown is still silenced with no previous text', async () => {
  const decision = await decide({
    triggerQuestion: 'the thing',
    now: 10_000,
    lastTriggerTime: 9_000,
  });
  assert.equal(decision.kind, 'silent');
  assert.equal(decision.reason, 'cooldown');
});

test('PlannerDecision routes answerable questions to answer', async () => {
  const decision = await decide({ triggerQuestion: 'How should I explain the implementation tradeoff?' });

  assert.equal(decision.kind, 'answer');
  assert.equal(decision.reason, 'answerable_question');
});

test('PlannerDecision routes explicit recap requests to recap', async () => {
  const decision = await decide({ triggerQuestion: 'Can you recap the key points so far?' });

  assert.equal(decision.kind, 'recap');
  assert.equal(decision.reason, 'recap_request');
});

test('PlannerDecision routes follow-up question requests', async () => {
  const decision = await decide({ triggerQuestion: 'What follow-up questions should I ask next?' });

  assert.equal(decision.kind, 'follow_up_questions');
  assert.equal(decision.reason, 'follow_up_questions_request');
});

test('PlannerDecision routes clarify requests', async () => {
  const decision = await decide({ triggerQuestion: 'This is ambiguous, ask a clarifying question about constraints.' });

  assert.equal(decision.kind, 'clarify');
  assert.equal(decision.reason, 'clarify_request');
});

test('PlannerDecision answers ordinary questions that merely contain "constraint" or "scope" (2026-09-07)', async () => {
  // Measured through the real engine: "constraint" alone routed this to the
  // CLARIFY action (runClarify), and no answer was ever emitted.
  for (const q of [
    'What constraint does the array problem place on the input array?',
    'What is the scope of the statement of work?',
    'What are the constraints on the input size?',
  ]) {
    const decision = await decide({ triggerQuestion: q });
    assert.equal(decision.kind, 'answer', `${q} → ${decision.kind}/${decision.reason}`);
  }
});

test('PlannerDecision routes incomplete technical restatements to clarify', async () => {
  const decision = await decide({
    triggerQuestion: 'Sorry let me restate, given an array and the thing should return the output but constraints are unclear',
    intentResult: { intent: 'coding', confidence: 0.92, answerShape: 'coding' },
  });

  assert.equal(decision.kind, 'clarify');
  assert.equal(decision.reason, 'incomplete_technical_restatement');
});

test('PlannerDecision still answers complete restated technical questions', async () => {
  const decision = await decide({
    triggerQuestion: 'Sorry let me restate, given an array of integers, return the indices of two numbers that add up to target.',
    intentResult: { intent: 'coding', confidence: 0.92, answerShape: 'coding' },
  });

  assert.equal(decision.kind, 'answer');
  assert.equal(decision.reason, 'answerable_question');
});

test('PlannerDecision routes strategy and visual problem context to brainstorm', async () => {
  const strategyDecision = await decide({ triggerQuestion: 'Brainstorm possible solutions and tradeoffs.' });
  const visualDecision = await decide({ triggerQuestion: '', confidence: 0.1, hasImages: true });

  assert.equal(strategyDecision.kind, 'brainstorm');
  assert.equal(strategyDecision.reason, 'strategy_request');
  assert.equal(visualDecision.kind, 'brainstorm');
  assert.equal(visualDecision.reason, 'visual_problem_context');
});
