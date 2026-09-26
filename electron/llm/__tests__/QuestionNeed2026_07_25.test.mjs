// electron/llm/__tests__/QuestionNeed2026_07_25.test.mjs
//
// Phase 6 Slice 3 (context-rebuild): behavioral tests for
// electron/llm/questionNeed.ts's deriveQuestionNeed() — the pure derived
// label (target arch §3), never a gate, built on top of the real
// resolveCanonicalTurn() spine.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { resolveCanonicalTurn } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/resolveCanonicalTurn.js'));
const { deriveQuestionNeed } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/questionNeed.js'));

const AVAILABLE = {
  hasReferenceFiles: true,
  hasProfileFacts: true,
  hasJobDescription: true,
  hasLiveTranscript: true,
  hasMeetingRag: true,
};

const SOURCE_CONTRACT = {
  defaultOwner: 'reference_files',
  sourceAuthority: 'reference_files_primary',
  allowedExplicitSwitches: ['profile', 'job_description', 'transcript', 'reference_files'],
};

function turnFor(question, overrides = {}) {
  return resolveCanonicalTurn({
    answerInput: {
      question,
      source: 'manual_input',
      hasCandidateProfile: true,
      hasJobDescription: true,
    },
    sourceContract: SOURCE_CONTRACT,
    availability: AVAILABLE,
    ...overrides,
  });
}

describe('deriveQuestionNeed — real questions map to the spec\'s 8-value taxonomy', () => {
  test('"Tell me about yourself." -> candidate_specific', () => {
    assert.equal(deriveQuestionNeed(turnFor('Tell me about yourself.')), 'candidate_specific');
  });

  test('"What does the job require?" -> job_specific', () => {
    assert.equal(deriveQuestionNeed(turnFor('What does the job require?')), 'job_specific');
  });

  test('"Explain BFS." -> general_knowledge (technical/coding is general knowledge, not candidate-specific)', () => {
    assert.equal(deriveQuestionNeed(turnFor('Explain BFS.')), 'general_knowledge');
  });

  test('a résumé+JD fit question -> candidate_job_synthesis', () => {
    const turn = turnFor('Why are you a good fit for this role?');
    assert.equal(turn.answerPlan.answerType, 'jd_fit_answer');
    assert.equal(deriveQuestionNeed(turn), 'candidate_job_synthesis');
  });

  test('a bare, unresolved follow-up fragment -> follow_up', () => {
    const turn = turnFor('what about that?');
    assert.equal(turn.answerPlan.answerType, 'follow_up_answer');
    assert.equal(deriveQuestionNeed(turn), 'follow_up');
  });
});

describe('deriveQuestionNeed is a PURE function of CanonicalTurn — never reaches outside it', () => {
  test('is deterministic: same CanonicalTurn always yields the same label', () => {
    const turn = turnFor('Tell me about your projects.');
    assert.equal(deriveQuestionNeed(turn), deriveQuestionNeed(turn));
  });

  test('never throws on a turnPlanFailed=true CanonicalTurn (the safe-fallback shape)', () => {
    const brokenTurn = resolveCanonicalTurn({
      answerInput: { question: 'Have you used WebRTC?', source: 'manual_input', hasCandidateProfile: true, hasJobDescription: true },
      availability: null,
    });
    assert.equal(brokenTurn.turnPlanFailed, true);
    assert.doesNotThrow(() => deriveQuestionNeed(brokenTurn));
    assert.equal(deriveQuestionNeed(brokenTurn), 'candidate_specific');
  });
});

describe('mixed_selected_sources: multiple explicit source families requested', () => {
  test('an explicit multi-family request on a NON-synthesis answer type yields mixed_selected_sources', () => {
    // project_answer is not in SYNTHESIS_ANSWER_TYPES (that bucket is
    // specifically resume+JD fit/gap/intro types) — this scenario isolates
    // the mixed_selected_sources branch from the candidate_job_synthesis
    // one, which takes precedence for actual resume+JD fit questions
    // (a deliberate, narrower-label-wins choice: see the next test).
    const turn = turnFor('Which of your projects best matches what this job needs?', {
      explicitRequests: ['profile', 'reference_files'],
    });
    assert.equal(turn.answerPlan.answerType, 'project_answer');
    assert.ok((turn.turnSourceDecision?.explicitRequests?.length ?? 0) > 1, 'fixture must actually carry >1 explicit request');
    assert.equal(deriveQuestionNeed(turn), 'mixed_selected_sources');
  });

  test('candidate_job_synthesis takes precedence over mixed_selected_sources for actual resume+JD fit answer types', () => {
    const turn = turnFor('Why are you a good fit for this role?', {
      explicitRequests: ['profile', 'job_description'],
    });
    assert.equal(turn.answerPlan.answerType, 'jd_fit_answer');
    assert.ok((turn.turnSourceDecision?.explicitRequests?.length ?? 0) > 1);
    assert.equal(deriveQuestionNeed(turn), 'candidate_job_synthesis', 'the narrower, more specific label wins over the generic multi-source one');
  });
});
