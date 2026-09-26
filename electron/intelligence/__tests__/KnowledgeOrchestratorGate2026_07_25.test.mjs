// electron/intelligence/__tests__/KnowledgeOrchestratorGate2026_07_25.test.mjs
//
// Phase 6 Slice 4 (context-rebuild): behavioral tests for
// electron/intelligence/knowledgeOrchestratorGate.ts — the additive type
// barrier at the premium submodule boundary (item 3). Uses the same
// mock-KnowledgeDatabaseManager pattern established this session
// (InterviewerPerspectiveGrounding.test.mjs /
// LeadershipGroundingFixBehavioral2026_07_25.test.mjs) for a real
// KnowledgeOrchestrator, plus resolveCanonicalTurn for a real CanonicalTurn.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { KnowledgeOrchestrator } = require('../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');
const { resolveCanonicalTurn } = require(path.resolve(repoRoot, 'dist-electron/electron/llm/resolveCanonicalTurn.js'));
const { processQuestionGated, projectAllowedSources } = require(path.resolve(repoRoot, 'dist-electron/electron/intelligence/knowledgeOrchestratorGate.js'));

const RESUME = {
  id: 1,
  type: 'resume',
  structured_data: {
    identity: { name: 'Sam Okafor', email: '', location: '', phone: '', links: [] },
    summary: '',
    skills: ['Go', 'Kafka'],
    experience: [{ company: 'Riverline', role: 'Backend Engineer', start_date: '2021-01', end_date: null, bullets: ['Built billing system'] }],
    projects: [], education: [], achievements: [], certifications: [], leadership: [],
  },
};

function makeOrchestrator(resume = RESUME) {
  const db = {
    initializeSchema() {},
    getDocumentByType(t) { return t === 'resume' ? resume : null; },
    getAllNodes() { return []; },
    getNodeCount() { return 0; },
    getIntro() { return null; },
    getGapAnalysis() { return null; },
    getNegotiationScript() { return null; },
    getMockQuestions() { return null; },
    getCultureMappings() { return null; },
  };
  const o = new KnowledgeOrchestrator(db);
  o.setKnowledgeMode(true);
  return o;
}

const AVAILABLE = { hasReferenceFiles: false, hasProfileFacts: true, hasJobDescription: false, hasLiveTranscript: true, hasMeetingRag: false };

function turnFor(question) {
  return resolveCanonicalTurn({
    answerInput: { question, source: 'manual_input', hasCandidateProfile: true, hasJobDescription: false },
    availability: AVAILABLE,
  });
}

describe('processQuestionGated', () => {
  test('bypasses (never calls the real orchestrator) for a coding question — resume forbidden', async () => {
    const o = makeOrchestrator();
    let realCallMade = false;
    const spy = { processQuestion: async (q) => { realCallMade = true; return o.processQuestion(q); } };
    const turn = turnFor('Explain BFS.');
    assert.equal(turn.answerPlan.answerType, 'technical_concept_answer');
    const result = await processQuestionGated(spy, 'Explain BFS.', turn);
    assert.equal(result.bypassed, true);
    assert.equal(result.result, null);
    assert.equal(realCallMade, false, 'the real orchestrator must never be called when bypassed');
    assert.match(result.reason, /forbidden/i);
  });

  test('calls through to the real orchestrator for a candidate-directed question — resume allowed', async () => {
    const o = makeOrchestrator();
    let realCallMade = false;
    const spy = { processQuestion: async (q) => { realCallMade = true; return o.processQuestion(q); } };
    const turn = turnFor('Tell me about your experience at Riverline.');
    assert.equal(isLayerAllowedForTurn(turn), true);
    const result = await processQuestionGated(spy, 'Tell me about your experience at Riverline.', turn);
    assert.equal(result.bypassed, false);
    assert.equal(realCallMade, true);
    assert.ok(result.result, 'expected a real processQuestion result');
  });

  test('accepts a narrower AllowedSourcesProjection directly, without a full CanonicalTurn', async () => {
    const o = makeOrchestrator();
    const spy = { processQuestion: (q) => o.processQuestion(q) };
    const forbidden = await processQuestionGated(spy, 'Explain BFS.', { resumeAllowed: false, jdAllowed: false });
    assert.equal(forbidden.bypassed, true);
    const allowed = await processQuestionGated(spy, 'Tell me about your experience.', { resumeAllowed: true, jdAllowed: false });
    assert.equal(allowed.bypassed, false);
  });

  test('projectAllowedSources correctly derives resumeAllowed/jdAllowed from a real CanonicalTurn', () => {
    const codingTurn = turnFor('Solve two sum.');
    const projection = projectAllowedSources(codingTurn);
    assert.equal(projection.resumeAllowed, false);
    assert.equal(projection.jdAllowed, false);

    const identityTurn = turnFor('Tell me about yourself.');
    const identityProjection = projectAllowedSources(identityTurn);
    assert.equal(identityProjection.resumeAllowed, true);
  });
});

function isLayerAllowedForTurn(turn) {
  return projectAllowedSources(turn).resumeAllowed;
}
