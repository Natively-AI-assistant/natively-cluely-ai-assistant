// intelligence-eval/scripts/grade-intelligence-result.ts
//
// Deterministic grader for one intelligence e2e result. Implements the spec's
// 10 grading rules as hard assertions. LLM-as-judge is intentionally NOT used
// here (no live keys in CI, and the release gate must be deterministic);
// qualitative tone checks are left to an optional separate pass.
//
// A test PASSES only when every applicable rule passes. failReasons lists each
// violated rule so the summary can rank failures.

export interface TestCase {
  testId: string;
  profileId: string;
  mode: 'manual_input' | 'what_to_answer';
  pattern: string;
  question?: string;
  transcript?: string;
  expectedPerspective: 'first_person' | 'second_person';
  expectedSpeaker?: string;
  requiredFacts: string[];
  forbiddenFacts: string[];
  expectedLayers: string[];
  excludedLayers: string[];
  expectedIntentLike?: string;
  critical?: boolean;
  missingInfo?: string;
  mustAdmitMissing?: boolean;
  followUpTarget?: string;
  isFollowUp?: boolean;
  isolationCheck?: boolean;
  personaNoInvention?: boolean;
  noHallucinationWatch?: boolean;
}

export interface RunOutput {
  answer: string;                 // the composed/streamed answer text
  detectedSpeaker: string;        // candidate | interviewer | user | unknown
  detectedIntent: string;
  selectedContextLayers: string[];
  excludedContextLayers: string[];
  groundedFacts: string[];        // discrete facts the routing layer surfaced (resume-derived)
  groundingFound: boolean;        // did routing find ANY grounding for the question?
  rawContextBlock: string;        // the orchestrator's actual contextBlock (for leak checks)
  latency: {
    questionExtractionMs: number;
    firstTokenMs: number;
    totalResponseMs: number;
  };
}

export interface LatencyBudget {
  firstTokenP95Ms: number;        // category budget (per-test soft check; aggregate enforced separately)
  questionExtractionP95Ms?: number;
}

export interface GradeResult {
  passed: boolean;
  score: number;                  // 0..1
  failReasons: string[];
}

const norm = (s: string) => (s || '').toLowerCase();

// Honest-missing admission phrases (deterministic detection).
const MISSING_ADMISSIONS = [
  'not found', 'not in', "isn't in", 'is not in', 'not available', "don't have",
  'do not have', "wasn't", 'was not', 'not loaded', 'not present', 'no record',
  "couldn't find", 'could not find', 'not specified', "isn't listed", 'not listed',
  'not something', 'not part of', 'no information', 'unable to find',
];

export function grade(tc: TestCase, out: RunOutput, budget?: LatencyBudget): GradeResult {
  const failReasons: string[] = [];
  const a = norm(out.answer);

  // Rule 1: required facts present.
  for (const fact of tc.requiredFacts || []) {
    if (fact && !a.includes(norm(fact))) {
      failReasons.push(`missing_required_fact:${fact}`);
    }
  }

  // Rule 2: forbidden facts absent — checked against BOTH the composed answer
  // AND the orchestrator's raw contextBlock. Checking the raw grounding is what
  // makes context-isolation real: if routing leaked JD/salary into the context
  // the model would see, that fails even if the composed answer happened not to
  // echo it. (Previously only the answer was checked, which let isolation cases
  // pass vacuously — flagged by test-engineer review.)
  const ctx = norm(out.rawContextBlock || '');
  for (const fact of tc.forbiddenFacts || []) {
    if (!fact) continue;
    const f = norm(fact);
    if (a.includes(f)) failReasons.push(`forbidden_fact_in_answer:${fact}`);
    else if (ctx.includes(f)) failReasons.push(`forbidden_fact_in_grounding:${fact}`);
  }

  // Rule 3: correct perspective.
  // first_person → uses "I"/"my"/"I'm" and NOT "your name is"; second_person →
  // manual "Your X is ...". Assistant identity in either is a hard fail.
  if (/\b(i'?m natively|i am natively|as an ai assistant|i'?m an ai)\b/.test(a)) {
    failReasons.push('assistant_identity_confusion');
  }
  if (tc.expectedPerspective === 'first_person') {
    // A first-person interview answer should not address the user in 2nd person
    // ("your name is"). Allow "your" generically (e.g. "your team") but flag the
    // tell-tale manual phrasing.
    if (/\byour name is\b/.test(a)) failReasons.push('wrong_perspective:second_person_in_live_mode');
  } else if (tc.expectedPerspective === 'second_person') {
    // Manual identity should read as "Your name is X", not first-person roleplay.
    if (tc.pattern === 'identity_manual' && /\bmy name is\b/.test(a)) {
      failReasons.push('wrong_perspective:first_person_in_manual_mode');
    }
  }

  // Rule 3b: speaker detection (for transcript mode).
  if (tc.expectedSpeaker && out.detectedSpeaker !== tc.expectedSpeaker) {
    failReasons.push(`wrong_speaker:expected_${tc.expectedSpeaker}_got_${out.detectedSpeaker}`);
  }

  // Rule 4: correct context layers selected (every expected layer present).
  for (const layer of tc.expectedLayers || []) {
    if (!out.selectedContextLayers.includes(layer)) {
      failReasons.push(`missing_context_layer:${layer}`);
    }
  }

  // Rule 5: irrelevant context layers excluded (no excluded layer was selected).
  for (const layer of tc.excludedLayers || []) {
    if (out.selectedContextLayers.includes(layer)) {
      failReasons.push(`forbidden_context_layer_selected:${layer}`);
    }
  }

  // Rule 6: not vague when exact context exists. If requiredFacts exist and
  // grounding was found, the answer must not be a generic deflection.
  if ((tc.requiredFacts || []).length > 0) {
    if (/\b(what would you like|how can i help|i have your background loaded)\b/.test(a)) {
      failReasons.push('vague_answer_when_facts_exist');
    }
  }

  // Rule 7: no hallucinated facts. For unknown/guarded cases, the answer must
  // NOT assert the missing datum. We detect this conservatively: when the case
  // declares missingInfo, the answer must not contain a fabricated number/name
  // pattern AND must admit missing (Rule 8). Watched cases also fail if they
  // emit a specific percentage/dollar figure that the fixture didn't supply.
  if (tc.missingInfo) {
    // Fabricated specifics: a standalone percentage or $amount is a red flag for
    // a "what was the exact X" question whose answer isn't in the fixture.
    // Checked in BOTH the answer AND the orchestrator's raw grounding — if the
    // orchestrator surfaced a number for a datum that isn't a structured field,
    // that's the real hallucination signal (not just the composed text).
    const fabPattern = /\b\d{1,3}(\.\d+)?%/;
    const dollarPattern = /\$\s?\d/;
    if (fabPattern.test(out.answer) || dollarPattern.test(out.answer)) {
      failReasons.push(`hallucinated_specific_in_answer:${tc.missingInfo}`);
    } else if (fabPattern.test(out.rawContextBlock || '') || dollarPattern.test(out.rawContextBlock || '')) {
      failReasons.push(`hallucinated_specific_in_grounding:${tc.missingInfo}`);
    }
  }

  // Rule 8: missing information handled honestly.
  if (tc.mustAdmitMissing) {
    const admits = MISSING_ADMISSIONS.some(p => a.includes(p));
    if (!admits) failReasons.push(`missing_not_admitted:${tc.missingInfo || 'unknown'}`);
  }

  // Rule 9: response format matches mode (already covered by perspective +
  // assistant-identity). Extra: live answers should be speakable (no markdown
  // headers / bullet dumps for a spoken answer) — soft check, not release-block.

  // Rule 9b: follow-up target resolved correctly.
  if (tc.isFollowUp && tc.followUpTarget) {
    // The grounded answer should relate to the follow-up target topic, not an
    // unrelated project. We check the answer references the target token OR the
    // routing surfaced grounding (the orchestrator was asked about the target).
    if (!out.groundingFound && !a.includes(norm(tc.followUpTarget))) {
      failReasons.push(`follow_up_target_unresolved:${tc.followUpTarget}`);
    }
  }

  // Rule 10: latency within budget (soft per-test; aggregate p95 enforced in runner).
  if (budget && out.latency.firstTokenMs > budget.firstTokenP95Ms * 3) {
    // Only flag egregious per-test outliers (3× the p95 budget) here; the
    // aggregate p50/p95 gate is the real check.
    failReasons.push(`latency_outlier:firstToken_${out.latency.firstTokenMs.toFixed(0)}ms`);
  }

  // Persona must not invent facts: when personaNoInvention, the answer must not
  // claim experience absent from grounding. Deterministic proxy: no fabricated
  // company names beyond the fixture's grounded facts is hard to verify without
  // an LLM, so we at least ensure no assistant-identity and no invented metrics.
  if (tc.personaNoInvention) {
    if (/\b\d{1,3}(\.\d+)?%/.test(out.answer) && !out.groundedFacts.some(f => /\d/.test(f))) {
      failReasons.push('persona_invented_metric');
    }
  }

  const passed = failReasons.length === 0;
  // Score: fraction of rule-groups passed (coarse but monotone). 1.0 when clean.
  const totalChecks = 6 + (tc.expectedSpeaker ? 1 : 0) + (tc.mustAdmitMissing ? 1 : 0) + (tc.isFollowUp ? 1 : 0);
  const score = passed ? 1 : Math.max(0, 1 - failReasons.length / Math.max(1, totalChecks));
  return { passed, score, failReasons };
}
