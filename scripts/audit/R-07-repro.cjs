#!/usr/bin/env node
/**
 * R-07 repro — F-304's regex fallback diverged from the planner it claims to mirror.
 *
 * deriveQuestionKind only reaches the regex block when answerType is absent or
 * unmapped (general_meeting_answer, lecture_answer, unknown_answer, ...).
 * Within that scope F-304 made two parity claims, and both were wrong:
 *
 *  (a) It gated JD on RE_JD_SUMMARY, a narrow "(this|the) (job|role|...)" noun
 *      phrase. The gate resolveJdSourceType actually uses is
 *      AnswerPlanner's JD_REFERENCE_CUE_RE, which ALSO matches a bare "JD" and
 *      "job description". So "What are the key responsibilities in this JD?"
 *      fell through to `general` — losing JD grounding entirely, which is worse
 *      than landing in the wrong family.
 *
 *  (b) It promoted the WHOLE of RE_CODING above the JD gate. AnswerPlanner's
 *      veto is only hasWriteCodeVerb = /(write|implement|code|program|solve)/;
 *      RE_CODING additionally matches algorithm/big-o/system-design/dsa/debug,
 *      so JD questions containing those words were vetoed into the coding family.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-07-repro.cjs
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { planTurn } = require(path.join(REPO, 'dist-electron', 'electron', 'llm', 'TurnPlanner.js'));

let failures = 0;
const kindOf = (question) => {
  // answerType left unmapped so the regex fallback is the path under test.
  const plan = planTurn({
    question,
    answerType: 'general_meeting_answer',   // unmapped -> falls through to the regex probe
    availability: { hasProfileFacts: true, hasJobDescription: true, hasReferenceFiles: true },
  });
  return plan.questionKind;
};

const CASES = [
  // (a) JD framing the old regex could not see.
  ['What are the key responsibilities in this JD?',                          'jd_question'],
  ['Does the job description mention Kubernetes?',                           'jd_question'],
  ['What qualifications does this job require?',                             'jd_question'],
  ['What are the responsibilities of this role?',                            'jd_question'],
  // (b) JD questions that topic-only coding words were stealing.
  ['Tell me about the algorithm experience required for this position',      'jd_question'],
  // NOT a JD route, and correctly so: AnswerPlanner's own JD_REFERENCE_CUE_RE
  // requires adjacency ("for this role"), which "for this system design role"
  // breaks — so the planner would not call this JD either. Parity with
  // AnswerPlanner is this fallback's contract, so matching its blind spot is the
  // correct behaviour here; diverging to "improve" it would recreate the drift
  // F-304 set out to remove. Left as a known residual instead.
  ['What are the duties for this system design role?',                       'coding_question'],
  // The coding veto AnswerPlanner really applies must still win.
  ['Write a function that returns the required buffer size',                 'coding_question'],
  ['Implement a binary search over the sorted duties list',                  'coding_question'],
  // Topic-only coding words with NO JD framing still route to coding.
  ['Walk me through the big-O of this approach',                             'coding_question'],
  ['How would you debug a memory leak?',                                     'coding_question'],
  // Non-JD, non-coding still general.
  ['What did the customer say about pricing?',                               'general'],
];

for (const [q, expected] of CASES) {
  const actual = kindOf(q);
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`[R-07] ${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(q).padEnd(62)} -> ${actual} (expected ${expected})`);
}

if (failures) {
  console.error(`[R-07] FAIL: ${failures} question(s) route to the wrong family, losing JD grounding.`);
  process.exit(1);
}
console.log('[R-07] PASS: JD framing is recognised, and only write-verbs veto the JD route.');
