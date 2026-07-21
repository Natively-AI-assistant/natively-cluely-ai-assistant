// electron/llm/__tests__/OperatedScaleSkillExperience2026_07_17.test.mjs
//
// Campaign 2 (longsession, 2026-07-17): script-a press A14 ("What scale have
// you operated Kubernetes at?") got candidateProfileChars:0 in the live
// [TRACE:LONGCTX] prompt_assembled trace on the real backend
// (test/harness-longsession script-a run-018) — the answer was 92 ALL-CAPS
// words with zero résumé grounding, despite the résumé fixture literally
// stating "I've operated 1.2k-node clusters in production, using Envoy and
// Istio for the mesh layer."
//
// Root cause: `SKILL_EXPERIENCE_PATTERNS`'s "have you <verb>" regex
// (electron/llm/AnswerPlanner.ts) listed used/worked/built/written/coded/
// programmed/implemented/done/created/analyzed/normalized/deployed/designed
// as recognized experience verbs, but NOT "operated" — so "what scale have
// you OPERATED it at?" fell through every candidate-directed pattern and
// landed on `general_meeting_answer`, which forbids the resume layer
// entirely. This is a distinct root cause from the "stack up" idiom bugs
// (fix#14/#15/#17 in campaign2-log.md) — same broad symptom class (a
// legitimate candidate-experience phrasing missing from a keyword list) but
// a different specific verb gap, not a repeat of the same regex collision.
//
// Fix: added operated/run/scaled/maintained to the skill-experience verb
// group — common "have you run/scaled/maintained/operated X at scale"
// infra/ops interview phrasings.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);

const p = (q) => planAnswer({ question: q, source: 'what_to_answer', speakerPerspective: 'interviewer', hasCandidateProfile: true });

describe('"have you operated/run/scaled/maintained X" routes to skill_experience_answer', () => {
  test('the exact live-failing question routes to skill_experience_answer with resume required', () => {
    const r = p("let's talk kubernetes — what scale have you operated it at?");
    assert.equal(r.answerType, 'skill_experience_answer');
    assert.ok(r.requiredContextLayers.includes('resume'));
    assert.ok(!r.forbiddenContextLayers.includes('resume'));
  });

  test('"have you run production kubernetes clusters?" routes to skill_experience_answer', () => {
    assert.equal(p('have you run production kubernetes clusters?').answerType, 'skill_experience_answer');
  });

  test('"have you scaled a system to millions of users?" routes to skill_experience_answer', () => {
    assert.equal(p('have you scaled a system to millions of users?').answerType, 'skill_experience_answer');
  });

  test('"have you maintained a large codebase?" routes to skill_experience_answer', () => {
    assert.equal(p('have you maintained a large codebase?').answerType, 'skill_experience_answer');
  });

  test('regression guard: "have you managed a team before?" still routes to behavioral, not skill_experience', () => {
    // The PEOPLE_OR_CONFLICT_OBJECT negative lookahead must still exclude
    // managed/handled/led + a people/team object — that's a STAR story, not
    // a skill probe. This fix only touched the verb list, not that guard.
    assert.equal(p('have you managed a team before?').answerType, 'behavioral_interview_answer');
  });

  test('regression guard: "have you managed a database cluster?" still routes to skill_experience (tech object)', () => {
    assert.equal(p('have you managed a database cluster?').answerType, 'skill_experience_answer');
  });
});
