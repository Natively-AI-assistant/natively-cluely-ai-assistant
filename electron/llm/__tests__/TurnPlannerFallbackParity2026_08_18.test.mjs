// F-304 regression test (audit/autopilot-2026-08-18).
//
// TurnPlanner's regex fallback declares it "MUST stay in sync with
// AnswerPlanner's IDENTITY_PATTERNS / JD_*_CUE_RE so a route through the
// planner is equivalent to a route through AnswerPlanner." AnswerPlanner
// reaches its JD cue only behind two gates in resolveJdSourceType — a coding
// verb ALWAYS vetoes, and no JD framing means no JD route — and the fallback
// had neither, while evaluating the JD cue FIRST. RE_JD_REQUIREMENTS matches
// the bare words required/qualifications/duties anywhere, so
// "Write a function that returns the required buffer size" routed jd_question:
// probing profile_jd/profile_resume, never reference_files, and switching ON
// seedCandidateBackground for a coding question.
//
// Same class as the documented technical_concept_answer defect, left open on
// the text-fallback branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planTurn } = await import(
  path.resolve(__dirname, '../../../dist-electron/electron/llm/TurnPlanner.js'));

const availability = {
  hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true,
  hasLiveTranscript: true, hasMeetingRag: false,
};
// answerType omitted on purpose: that is exactly when deriveQuestionKind
// falls through to the regex probe.
const plan = (question) => planTurn({ question, availability });

test('a coding verb vetoes the JD cue', () => {
  for (const q of [
    'Write a function that returns the required buffer size',
    'Implement a retry policy that satisfies the duties of the worker',
  ]) {
    const p = plan(q);
    assert.equal(p.questionKind, 'coding_question', `"${q}" must route coding (F-304)`);
    assert.notEqual(p.answerDirectives?.seedCandidateBackground, true,
      'a coding question must not seed candidate background');
  }
});

test('explicit doc framing beats a bare JD word', () => {
  assert.equal(plan('According to the doc, what are the qualifications?').questionKind, 'doc_question');
});

test('genuine JD questions still route to JD', () => {
  assert.equal(plan('What are the requirements for this role?').questionKind, 'jd_question');
  assert.equal(plan('Tell me about this position').questionKind, 'jd_question');
});

test('a bare requirement word with no JD framing is not a JD question', () => {
  const p = plan('What are the qualifications needed to make the tests pass?');
  assert.notEqual(p.questionKind, 'jd_question',
    'without JD framing the JD route must not fire (AnswerPlanner gate 2) (F-304)');
});
