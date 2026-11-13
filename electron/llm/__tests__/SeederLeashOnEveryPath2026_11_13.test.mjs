// F-ACC-12 (live-pipeline forensics, 2026-11-13): the anti-fabrication seeder
// leash (TurnPlanner: seed the candidate's background only for profile / JD
// questions) was fixed in core, but
//   1. the WTA JIT fallback used `?? true` when planTurn failed, so a failed
//      plan re-armed the seeder for every question, and
//   2. premium KnowledgeOrchestrator still seeded the experience pack on ANY
//      zero-node retrieval, unleashed.
// Both now use the same leash: core TurnPlanner.seedsCandidateBackground.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const { seedsCandidateBackground, planTurn } = require(path.join(root, 'dist-electron/electron/llm/TurnPlanner.js'));

describe('seedsCandidateBackground is the TurnPlanner leash', () => {
  const cases = [
    ['Why should we hire you?', undefined],
    ["What's your name?", 'identity_answer'],
    ["What's your salary expectation?", 'negotiation_answer'],
    ['How does a B-tree split a node?', undefined],
    ['Write a function that reverses a list', undefined],
    ['what does the job description say about on-call?', undefined],
  ];
  for (const [question, answerType] of cases) {
    test(`agrees with planTurn for "${question}"`, () => {
      const expected = planTurn({
        question, answerType,
        availability: { hasReferenceFiles: false, hasProfileFacts: true, hasJobDescription: true, hasLiveTranscript: true },
      }).answerDirectives.seedCandidateBackground;
      assert.equal(seedsCandidateBackground({ question, answerType }), expected);
    });
  }
  test('a salary question and a general technical question never seed', () => {
    assert.equal(seedsCandidateBackground({ question: "What's your salary expectation?", answerType: 'negotiation_answer' }), false);
    assert.equal(seedsCandidateBackground({ question: 'How does a B-tree split a node?' }), false);
  });
  test('never throws; a bad input does not seed', () => {
    assert.equal(seedsCandidateBackground(null), false);
  });
});

describe('every seeder site is leashed (source pins)', () => {
  test('WTA JIT fallback: a failed plan does not seed', () => {
    const ie = fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');
    assert.doesNotMatch(ie, /seedCandidateBackground: \(_c3TurnPlan\?\.answerDirectives\?\.seedCandidateBackground \?\? true\)/);
    assert.match(ie, /seedCandidateBackground: \(_c3TurnPlan\?\.answerDirectives\?\.seedCandidateBackground \?\? false\)/);
  });
  const ko = path.join(root, 'premium/electron/knowledge/KnowledgeOrchestrator.ts');
  test('premium zero-node seeder asks the same leash', { skip: !fs.existsSync(ko) && 'premium absent (OSS build)' }, () => {
    const src = fs.readFileSync(ko, 'utf8');
    assert.match(src, /relevantNodes\.length === 0 && !wantsPreciseValue && this\.activeResume\.structured_data\s*&& seedsCandidateBackground\(\{ question/);
  });
});
