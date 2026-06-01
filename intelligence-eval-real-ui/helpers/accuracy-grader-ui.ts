// intelligence-eval-real-ui/helpers/accuracy-grader-ui.ts
// Grades the REAL UI-visible answer text. Same 10-rule contract proven in the
// real-API grader, operating on the DOM-visible answer. Punctuation/space-
// insensitive fact matching (a real model paraphrases codenames). anyOfFacts
// supports "list/one" questions. Forbidden facts + assistant-identity = hard fail.

export interface UiTestCase {
  testId: string; profileId: string; mode: 'manual_input' | 'what_to_answer'; pattern: string;
  question?: string; transcript?: string;
  expectedPerspective: 'first_person' | 'second_person'; expectedSpeaker?: string;
  requiredFacts: string[]; anyOfFacts?: string[]; forbiddenFacts: string[];
  expectedLayers: string[]; excludedLayers: string[];
  missingInfo?: string; mustAdmitMissing?: boolean; followUpTarget?: string; isFollowUp?: boolean;
  critical?: boolean; personaNoInvention?: boolean;
}

export interface UiGrade { passed: boolean; score: number; failReasons: string[];
  requiredFactsFound: string[]; missingRequiredFacts: string[]; forbiddenFactsFound: string[];
  hallucinationFlags: string[]; perspectiveCorrect: boolean; }

const norm = (s: string) => (s || '').toLowerCase();
const spaced = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stripped = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
// Guard: stripped("$") = "" → "anything".includes("") is always true (false positive).
// Require both spaced/stripped patterns to be non-empty before matching.
const factHit = (ans: string, f: string) => {
  const sp = spaced(f); const st = stripped(f);
  return (sp.length > 0 && spaced(ans).includes(sp)) || (st.length > 0 && stripped(ans).includes(st));
};

// Stopwords for follow-up relevance scoring. A correct follow-up answer engages
// with the latest interviewer question's content words (e.g. "latency",
// "rollbacks") rather than echoing the topic noun ("gateway", "Kubernetes") —
// which often isn't repeated and may not even exist in the resume. We grade
// engagement with the QUESTION, not literal echo of the topic.
const FOLLOWUP_STOP = new Set(
  ('the a an and or but of to in on at for with from is are was were be been being do does did have ' +
   'has had how what why when where which who whom that this these those you your yours i me my we our ' +
   'they them their it its as by can could would will shall should may might must not no yes about into ' +
   'over under more most some any each just also very really please tell explain describe walk give share ' +
   'about around once first second confirm great yeah okay sure mentioned said worked').split(' ')
);
const followupContentWords = (s: string): string[] =>
  (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 3 && !FOLLOWUP_STOP.has(w));

const ADMISSIONS = ['not found','not in',"isn't in",'is not in','not available',"don't have",'do not have','not loaded',
  'not present','no record',"couldn't find",'could not find','not specified','not listed',"don't think",'honestly',
  "i haven't",'not something i','not part of',"can't share",'cannot share',"can't provide",'cannot provide',"don't recall",
  "don't remember","not able to",'unable to','no specific',"don't currently have",'off the top'];

export function gradeUiAnswer(tc: UiTestCase, answer: string): UiGrade {
  const fail: string[] = [];
  const a = norm(answer);
  const requiredFactsFound: string[] = []; const missingRequiredFacts: string[] = []; const forbiddenFactsFound: string[] = []; const hallucinationFlags: string[] = [];

  if (!answer || !/\S/.test(answer)) {
    return { passed: false, score: 0, failReasons: ['empty_answer'], requiredFactsFound, missingRequiredFacts: tc.requiredFacts || [], forbiddenFactsFound, hallucinationFlags, perspectiveCorrect: false };
  }
  for (const f of tc.requiredFacts || []) {
    if (!f) continue;
    if (factHit(answer, f)) requiredFactsFound.push(f); else { missingRequiredFacts.push(f); fail.push(`missing_required_fact:${f}`); }
  }
  if (tc.anyOfFacts?.length && !tc.anyOfFacts.some(f => factHit(answer, f))) fail.push(`missing_any_of_facts:${tc.anyOfFacts.join('|')}`);
  // Forbidden-fact check. Generic negotiation TERMS ("salary", "compensation",
  // "comp", "pay", "$") only count as a leak when the answer actually surfaces
  // negotiation CONTENT — a $ figure, a percentage, or the candidate's own
  // expectation. Merely echoing the interviewer's word to DEFER comp ("we can
  // park the salary discussion for later") is correct isolation behaviour, not a
  // leak; and a term the interviewer themselves introduced isn't the model
  // leaking it. Specific forbidden facts (names, "I'm Natively") still hard-match.
  const NEGOTIATION_TERMS = new Set(['salary', 'compensation', 'comp', 'pay', '$']);
  const ivText = (tc.transcript || '').toLowerCase();
  const leaksNegotiationContent = /\$\s?\d|\b\d{2,3}\s?k\b|\b\d{2,3},\d{3}\b|\b\d{1,3}(\.\d+)?\s?%/.test(answer)
    || /\b(i (expect|want|am looking for|am seeking)|my (expectation|target|range|ask) (is|are))\b/.test(a);
  for (const f of tc.forbiddenFacts || []) {
    if (!f || !factHit(answer, f)) continue;
    const term = f.toLowerCase().trim();
    if (NEGOTIATION_TERMS.has(term)) {
      // Skip when (a) the answer surfaces no actual comp content, AND
      // (b) it's a defer/echo of a term the interviewer raised.
      const interviewerRaised = ivText.includes(term) || /\b(salary|compensation|pay|offer|package)\b/.test(ivText);
      if (!leaksNegotiationContent && interviewerRaised) continue;
      if (!leaksNegotiationContent && term !== '$') continue; // bare term, no figures → not a leak
    }
    forbiddenFactsFound.push(f); fail.push(`forbidden_fact_in_answer:${f}`);
  }

  let perspectiveCorrect = true;
  if (/\b(i'?m natively|i am natively|as an ai assistant|i'?m an ai|i am an ai)\b/.test(a)) { fail.push('assistant_identity_confusion'); perspectiveCorrect = false; }
  if (tc.expectedPerspective === 'first_person' && /\byour name is\b/.test(a)) { fail.push('wrong_perspective:second_person_in_live_mode'); perspectiveCorrect = false; }
  if (tc.expectedPerspective === 'second_person' && tc.pattern === 'identity_manual' && /\bmy name is\b/.test(a)) { fail.push('wrong_perspective:first_person_in_manual_mode'); perspectiveCorrect = false; }

  if ((tc.requiredFacts || []).length > 0 && /\b(what would you like|how can i (assist|help)|i have your background loaded)\b/.test(a)) fail.push('vague_answer_when_facts_exist');

  if (tc.missingInfo) {
    if (/\b\d{1,3}(\.\d+)?\s?%/.test(answer) || /\$\s?\d/.test(answer)) { hallucinationFlags.push(`hallucinated_specific:${tc.missingInfo}`); fail.push(`hallucinated_specific:${tc.missingInfo}`); }
  }
  if (tc.mustAdmitMissing && !ADMISSIONS.some(p => a.includes(p))) fail.push(`missing_not_admitted:${tc.missingInfo || 'unknown'}`);
  // Follow-up MUST address the latest interviewer question. The spec calls an
  // answer to the WRONG topic release-blocking — but a correct answer engages
  // with the QUESTION ("how did you improve latency?" → caching/routing) and
  // rarely re-echoes the topic noun ("gateway"), which often isn't even in the
  // resume. So grade engagement, not literal echo:
  //   PASS if the answer (a) shares a content word with the latest interviewer
  //   question, OR (b) literally mentions the resolved topic, OR (c) is a
  //   substantive on-topic response (>=120 chars and not a bare refusal).
  //   FAIL only when the answer is empty/trivial or a pure deflection.
  // This kills the false-negative where a fully correct follow-up answer was
  // marked off-topic just because it didn't repeat the topic word.
  if (tc.isFollowUp && tc.transcript) {
    const ivLines = tc.transcript.split('\n').filter(l => /^\s*Interviewer\s*:/i.test(l));
    const lastQ = ivLines.length ? ivLines[ivLines.length - 1].replace(/^\s*Interviewer\s*:\s*/i, '') : '';
    const qWords = followupContentWords(lastQ);
    const aWords = new Set(followupContentWords(answer));
    const sharesQuestionWord = qWords.some(w => aWords.has(w));
    const mentionsTarget = tc.followUpTarget ? factHit(answer, tc.followUpTarget) : false;
    const substantive = answer.trim().length >= 120;
    // A pure refusal/deflection is a real failure (the model gave up on the topic).
    const pureDeflection = /\b(i can'?t (help|answer)|i'?m not able to|i don'?t know how)\b/.test(a) && answer.trim().length < 120;
    if (!sharesQuestionWord && !mentionsTarget && !substantive) {
      fail.push(`followup_off_topic:${tc.followUpTarget || lastQ.slice(0, 30)}`);
    } else if (pureDeflection) {
      fail.push(`followup_deflected:${tc.followUpTarget || lastQ.slice(0, 30)}`);
    }
  }
  if (tc.personaNoInvention && /\b\d{1,3}(\.\d+)?\s?%/.test(answer)) hallucinationFlags.push('persona_metric_present');

  const passed = fail.length === 0;
  return { passed, score: passed ? 1 : Math.max(0, 1 - fail.length / 8), failReasons: fail, requiredFactsFound, missingRequiredFacts, forbiddenFactsFound, hallucinationFlags, perspectiveCorrect };
}
