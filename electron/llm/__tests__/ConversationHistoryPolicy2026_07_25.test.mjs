// electron/llm/__tests__/ConversationHistoryPolicy2026_07_25.test.mjs
//
// Phase 6 Slice 2 (context-rebuild): behavioral tests for
// electron/llm/conversationHistoryPolicy.ts — resolveHistoryGrant,
// stripPriorAssistantTurns, applyHistoryGrant. Also reproduces RC3's exact
// benchmark shape (two sequential, non-overlapping manual-chat turns) as the
// slice's third pre-required test.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { resolveHistoryGrant, stripPriorAssistantTurns, applyHistoryGrant } =
  cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/conversationHistoryPolicy.js'));
const { requiredLayersFor, forbiddenLayersFor } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/AnswerPlanner.js'));

function buildPlan(answerType, documentGroundedCustomModeActive = false) {
  return {
    answerType,
    requiredContextLayers: requiredLayersFor(answerType, documentGroundedCustomModeActive),
    forbiddenContextLayers: forbiddenLayersFor(answerType),
    documentGroundedCustomModeActive,
  };
}

describe('resolveHistoryGrant', () => {
  test('coding_question_answer: NOT included (RC3)', () => {
    const grant = resolveHistoryGrant(buildPlan('coding_question_answer'));
    assert.equal(grant.included, false);
    assert.match(grant.reason, /forbidden/i);
  });

  test('project_followup_answer: included (legitimate continuation)', () => {
    const grant = resolveHistoryGrant(buildPlan('project_followup_answer'));
    assert.equal(grant.included, true);
    assert.match(grant.reason, /allowed/i);
  });

  test('reason string never contains turn content — content-free by construction (only answerType + allow/forbid)', () => {
    const grant = resolveHistoryGrant(buildPlan('identity_answer'));
    assert.equal(typeof grant.reason, 'string');
    assert.ok(grant.reason.length < 100);
  });
});

describe('stripPriorAssistantTurns', () => {
  test('removes ASSISTANT (PREVIOUS SUGGESTION) blocks, keeps ME/INTERVIEWER turns', () => {
    const snapshot = [
      '[INTERVIEWER]: What is a race condition?',
      '[ASSISTANT (PREVIOUS SUGGESTION)]: A race condition is when...',
      '[INTERVIEWER]: What about deadlocks?',
    ].join('\n');
    const stripped = stripPriorAssistantTurns(snapshot);
    assert.ok(!stripped.includes('A race condition is when'));
    assert.ok(stripped.includes('What is a race condition?'));
    assert.ok(stripped.includes('What about deadlocks?'));
  });

  test('a multi-line assistant block is fully removed, not just its first line', () => {
    const snapshot = [
      '[INTERVIEWER]: Explain the architecture.',
      '[ASSISTANT (PREVIOUS SUGGESTION)]: The system has three tiers.',
      'Tier one handles ingestion.',
      'Tier two handles processing.',
      '[ME]: Can you go deeper on tier two?',
    ].join('\n');
    const stripped = stripPriorAssistantTurns(snapshot);
    assert.ok(!stripped.includes('three tiers'));
    assert.ok(!stripped.includes('Tier one'));
    assert.ok(!stripped.includes('Tier two handles processing'));
    assert.ok(stripped.includes('Can you go deeper on tier two?'));
  });
});

describe('applyHistoryGrant', () => {
  const snapshotWithAssistant = [
    '[INTERVIEWER]: What is a race condition?',
    '[ASSISTANT (PREVIOUS SUGGESTION)]: A race condition is when two threads access shared state unsynchronized.',
  ].join('\n');

  test('when included, the snapshot passes through unchanged', () => {
    const grant = { included: true, reason: 'test' };
    assert.equal(applyHistoryGrant(snapshotWithAssistant, grant), snapshotWithAssistant);
  });

  test('when not included, the snapshot is stripped', () => {
    const grant = { included: false, reason: 'test' };
    const result = applyHistoryGrant(snapshotWithAssistant, grant);
    assert.ok(!result.includes('two threads access shared state'));
  });
});

describe('RC3 exact benchmark shape: two sequential, non-overlapping manual-chat turns', () => {
  // Reproduces the Baseline benchmark's observed topic-collapse shape: turn A
  // is a résumé/JD-fit answer for persona X; turn B, 30s later, is an
  // unrelated coding_question_answer. Before Slice 2, turn B's assembled
  // context could still carry turn A's content (RC3). This test simulates
  // the ACTUAL production consumer shape: a rolling snapshot containing both
  // turns, filtered through resolveHistoryGrant + applyHistoryGrant for turn
  // B's plan.
  test('turn B\'s filtered snapshot contains NO trace of turn A\'s résumé/JD-fit content', () => {
    const rollingSnapshot = [
      '[INTERVIEWER]: Why are you a good fit for this senior backend role?',
      '[ASSISTANT (PREVIOUS SUGGESTION)]: I have 6 years building distributed systems at Acme Corp, directly matching the JD\'s requirement for large-scale backend experience.',
      '[INTERVIEWER]: Can you explain how you would design a rate limiter?',
    ].join('\n');

    const turnBPlan = buildPlan('coding_question_answer');
    const grant = resolveHistoryGrant(turnBPlan);
    const filtered = applyHistoryGrant(rollingSnapshot, grant);

    assert.equal(grant.included, false);
    assert.ok(!filtered.includes('6 years building distributed systems'));
    assert.ok(!filtered.includes('Acme Corp'));
    assert.ok(!filtered.includes('JD'), 'no trace of the JD-fit answer content should survive into the coding turn\'s context');
    // The interviewer's own utterances (including turn A's question) remain —
    // stripping is scoped to the ASSISTANT's own prior answer text, not the
    // interviewer's turns, which is the documented, narrower invariant.
    assert.ok(filtered.includes('Can you explain how you would design a rate limiter?'));
  });

  test('contrast: a legitimate project follow-up turn KEEPS the prior assistant content it needs', () => {
    const rollingSnapshot = [
      '[INTERVIEWER]: Tell me about your most impressive project.',
      '[ASSISTANT (PREVIOUS SUGGESTION)]: I built Natively, an AI-powered interview copilot with real-time transcription.',
      '[INTERVIEWER]: How did you build that?',
    ].join('\n');

    const turnBPlan = buildPlan('project_followup_answer');
    const grant = resolveHistoryGrant(turnBPlan);
    const filtered = applyHistoryGrant(rollingSnapshot, grant);

    assert.equal(grant.included, true);
    assert.ok(filtered.includes('Natively'), 'project_followup_answer must retain the prior turn\'s content to resolve "that"');
  });
});
