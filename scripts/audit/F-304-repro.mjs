// F-304 repro: TurnPlanner's regex fallback diverged from AnswerPlanner and
// hijacked coding/doc questions onto the JD route.
//
// The fallback's own comment says it "MUST stay in sync with AnswerPlanner's
// IDENTITY_PATTERNS / JD_*_CUE_RE so a route through the planner is equivalent
// to a route through AnswerPlanner." But AnswerPlanner reaches its JD cue only
// behind two gates in resolveJdSourceType — a coding verb ALWAYS vetoes, and
// no JD framing means no JD route — and the fallback had neither, while
// evaluating the JD cue FIRST. RE_JD_REQUIREMENTS matches the bare words
// required/qualifications/duties anywhere.
//
// Consequences of a wrong jd_question kind (planTurn): probeOrderFor probes
// profile_jd then profile_resume and never reference_files, and
// seedCandidateBackground is switched ON for a coding question.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planTurn } = await import(path.resolve(__dirname, '../../dist-electron/electron/llm/TurnPlanner.js'));

const availability = {
  hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true,
  hasLiveTranscript: true, hasMeetingRag: false,
};
// answerType deliberately omitted / outside the four sets, which is exactly
// when deriveQuestionKind falls through to the regex probe.
const kindOf = (question) => planTurn({ question, availability });

const cases = [
  { q: 'Write a function that returns the required buffer size', want: 'coding_question', why: 'a coding verb must veto the JD cue' },
  { q: 'Implement a retry policy that satisfies the duties of the worker', want: 'coding_question', why: 'coding verb beats a bare JD word' },
  { q: 'According to the doc, what are the qualifications?', want: 'doc_question', why: 'explicit doc framing must win over a bare JD word' },
  { q: 'What are the requirements for this role?', want: 'jd_question', why: 'a genuine JD question must STILL route to JD' },
  { q: 'Tell me about this position', want: 'jd_question', why: 'JD framing alone still routes JD' },
];

let bad = false;
for (const c of cases) {
  const plan = kindOf(c.q);
  const got = plan.questionKind;
  const seeds = plan.answerDirectives?.seedCandidateBackground;
  const ok = got === c.want;
  console.log(`[F-304] ${ok ? 'ok ' : 'BAD'} "${c.q}" → ${got} (want ${c.want}, seedCandidateBackground=${seeds})`);
  if (!ok) { console.error(`        ${c.why}`); bad = true; }
  if (c.want === 'coding_question' && seeds === true) {
    console.error('        a coding question must NOT seed candidate background'); bad = true;
  }
}

if (bad) { console.error('[F-304] FAIL (F-304 reproduced).'); process.exit(1); }
console.log('[F-304] PASS: the fallback matches AnswerPlanner — coding/doc win, genuine JD questions still route JD.');
process.exit(0);
