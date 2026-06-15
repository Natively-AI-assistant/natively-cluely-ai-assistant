// electron/llm/ProfileOutputValidator.ts
//
// Spec §7 / acceptance §12.9: deterministic POST-GENERATION validation of profile
// answers. The model is instructed at prompt time to follow the perspective and
// grounding rules, but instructions are not guarantees — this module VERIFIES the
// output and reports violations so the caller can repair or fall back.
//
// It is pure and content-free of any profile data: it inspects the generated
// answer text against the AnswerPlan (which carries answerType, perspective, and
// forbidden context layers) plus a small set of facts about what context was
// available. No LLM, no I/O — cheap enough for the live path.
//
// Failure modes it catches (all from the spec):
//   1. Wrong perspective: a profile answer that should be first-person ("My name
//      is...") but speaks in third person or as the assistant.
//   2. Assistant-identity leak: a profile/identity answer that says "I am
//      Natively" / "I'm an AI assistant" when the interviewer asked the CANDIDATE.
//   3. False "no access" / "no experience" refusal when the profile EXISTS.
//   4. Sensitive/salary leak in a non-salary answer.
//   5. Resume/JD leak in a generic coding/technical answer.

import type { AnswerPlan, AnswerType, OutputPerspective } from './AnswerPlanner';

export type ProfileViolationCode =
  | 'wrong_perspective_not_first_person'
  | 'assistant_identity_leak'
  | 'false_no_access_refusal'
  | 'false_no_experience_refusal'
  | 'sensitive_salary_leak'
  | 'profile_in_generic_answer'
  // Release 2026-06-07: a pure coding/technical/system-design answer (profile
  // FORBIDDEN) that leaked "Natively", the candidate name, a loaded project/company
  // name, or profile/JD/salary references. Flash-lite intermittently appends a
  // stray "Natively" mention to clean coding answers; this is the deterministic
  // catch + repair, not just a prompt instruction.
  | 'profile_token_in_coding_answer';

export interface ProfileViolation {
  code: ProfileViolationCode;
  /** Human-readable detail for telemetry/logs (no raw profile content). */
  detail: string;
  /** Whether this should trigger a repair/fallback (vs a soft warning). */
  severity: 'error' | 'warning';
}

export interface ProfileValidationInput {
  answer: string;
  plan: Pick<AnswerPlan, 'answerType' | 'outputPerspective' | 'forbiddenContextLayers'>;
  /** True when a candidate profile (resume/identity) is loaded and usable. */
  profileAvailable: boolean;
  /** True when the question is directed at the candidate (interviewer asking). */
  candidateDirected: boolean;
  /**
   * Loaded profile tokens (candidate first name, project names, company names) the
   * model must NOT mention in a profile-forbidden coding/technical answer. Optional
   * and content-free at rest — the caller passes only the bare proper nouns it
   * already has loaded; nothing is persisted. When absent, only the static
   * "Natively"/profile-marker check runs (release 2026-06-07).
   */
  profileTokens?: {
    firstName?: string;
    projects?: string[];
    companies?: string[];
  };
  /**
   * When true, the user EXPLICITLY invited the project/profile into a technical
   * answer ("use my Natively project as an example", "how did you implement this in
   * Natively?"). Suppresses the coding-leak check so an intentional reference is
   * allowed (release 2026-06-07 exception).
   */
  profileExplicitlyInvited?: boolean;
}

export interface ProfileValidationResult {
  ok: boolean;
  violations: ProfileViolation[];
  /** Convenience: the error-severity violation codes only. */
  errorCodes: ProfileViolationCode[];
}

// Answer types that speak AS the candidate (first person) when interviewer-directed.
const PROFILE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'profile_fact_answer', 'project_answer', 'project_followup_answer',
  'skills_answer', 'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
  'behavioral_interview_answer', 'negotiation_answer',
]);

const isProfileAnswerType = (t: AnswerType): boolean => PROFILE_ANSWER_TYPES.has(t);

// "I am Natively" / "I'm an AI assistant" — the assistant identity leaking into a
// candidate answer. Distinct from the candidate legitimately saying "I" or stating
// a real job title ("I'm an AI Engineer", "I'm an AI & Full Stack Engineer"): the
// "an AI" clause requires it NOT be followed by an engineering/role word, so a job
// title is not a false positive (Issue 2).
const ASSISTANT_IDENTITY_RE =
  /\bI(?:'m| am)\s+Natively\b|\bI(?:'m| am)\s+an?\s+(?:AI\s+)?(?:assistant|language model|chat\s?bot)\b|\bI(?:'m| am)\s+an\s+AI\b(?!\s*(?:and|engineer|developer|intern|specialist|enthusiast)\b)(?![\s]*[&/,])|\bas\s+an\s+AI(?:\s+(?:language\s+)?model)?,?\s+I\b/i;
const NATIVELY_SELF_RE = /\b(?:I am|I'm|as)\s+Natively\b/i;

// "I don't have access to your..." / "I don't know your name" / "I can't share
// that information" / "I don't have your resume/profile/JD loaded" — false-refusal
// failures when the profile IS present (benchmark 2026-06-05 what-to-answer mode).
const NO_ACCESS_RE =
  /\bI\s+(?:do(?:n'?t| not)|cannot|can'?t)\s+(?:have\s+access\s+to|access)\b|\bI\s+do(?:n'?t| not)\s+(?:have|know)\s+(?:your|the user'?s|that)\b|\bno\s+access\s+to\s+(?:your|the user'?s|personal)\b|\bI\s+(?:cannot|can'?t)\s+share\s+(?:that|this|your|personal)\b|\bI\s+do(?:n'?t| not)\s+have\s+(?:the\s+)?(?:specific\s+)?(?:job\s+description|jd|resume|profile|past\s+experience)\b(?:\s+loaded)?|\bI\s+do(?:n'?t| not)\s+have\s+(?:specific\s+)?past\s+experience\s+loaded\b/i;

// "I don't have personal experience" / "as an AI I haven't" / "I don't have a
// story loaded" / "if that matches my background" — false no-experience phrasings
// banned when the profile contains experience (Issue 6, spec ban-list).
const NO_EXPERIENCE_RE =
  /\bI\s+do(?:n'?t| not)\s+have\s+(?:personal\s+|any\s+|a\s+)?(?:experience|projects?|a\s+resume|a\s+background|story)\b|\bI\s+have\s+no\s+personal\s+experience\b|\bas\s+an\s+AI[, ].{0,40}\b(?:experience|cannot|can'?t)\b|\bif\s+that\s+matches\s+my\s+background\b|\bI\s+do(?:n'?t| not)\s+have\s+a\s+story\s+loaded\b/i;

// Salary/comp figures + negotiation strategy language that must not appear outside
// a negotiation answer.
const SALARY_FIGURE_RE = /(?:\$|₹|€|£)\s?\d|(?:\b\d{2,3}\s?k\b)|\b\d+\s?lpa\b|\bCTC\b/i;
const NEGOTIATION_STRATEGY_RE = /\b(counter[- ]?offer|walk\s?away|batna|anchor (?:high|to)|leverage point|minimum acceptable|target range)\b/i;

// Resume/JD leakage markers for generic (coding/technical/sales/lecture) answers.
const PROFILE_LEAK_RE = /\b(my resume|the candidate'?s resume|job description|the JD|candidate_profile|target_job)\b/i;

// Answer types where the profile is FORBIDDEN and the answer is a pure technical /
// coding / design / lecture / sales output — these must never name the product
// (Natively), the candidate, a loaded project/company, or reference the
// profile/JD/salary (release 2026-06-07: residual patterns #3/#4).
const PROFILE_FORBIDDEN_OUTPUT_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'technical_concept_answer',
  'system_design_answer', 'debugging_question_answer', 'sales_answer',
  'product_candidate_mix_answer', 'lecture_answer', 'general_meeting_answer',
  'ethical_usage_answer',
]);
// The PRODUCT "Natively" vs the English ADVERB "natively" ("Python natively
// supports heapq", "runs natively on the GPU"). The product is a CAPITALIZED proper
// noun OR a lowercase mention preceded by a reference cue (in/the/a/using/built/
// from/my/your natively). The bare lowercase adverb is NOT a leak (release
// 2026-06-07: "X natively supports Y" in coding answers was a false positive). This
// is CASE-SENSITIVE — do not add the /i flag.
const PRODUCT_NATIVELY_RE = /\bNativel?y\b|\b(?:[Ii]n|[Tt]he|[Aa]|[Aa]n|[Uu]sing|[Uu]sed?|[Bb]uilt?|[Ff]rom|[Vv]ia|[Ww]ith|[Mm]y|[Yy]our)\s+nativel?y\b|\bnativly\b/;
// Helper: does the text reference the PRODUCT (not the adverb) or any case-
// insensitive profile/comp marker?
const PROFILE_MARKER_NON_PRODUCT_RE = /\b(my|your|the candidate'?s) (resume|profile|cv|background|experience)\b|\bbased on (my|your) (experience|profile|resume|background)\b|\b(my|your) JD\b|\bjob description\b|\b(salary|compensation|ctc|lpa)\b/i;
const codingProfileMarkerHit = (s: string): boolean => PRODUCT_NATIVELY_RE.test(s) || PROFILE_MARKER_NON_PRODUCT_RE.test(s);
// The user explicitly invited the project/profile into a technical answer.
const PROFILE_INVITE_RE = /\b(use|using|with|in|from)\s+(my|your|the)\s+(natively|project|portfolio|own (project|code))\b|\bhow (did|do) you (implement|build|use)\s+(this|that|it)\s+in\s+(natively|your project)\b|\bin natively\b|\b(my|your) natively project\b|\bas an example from\b/i;

function firstPersonPresent(answer: string): boolean {
  return /\b(I|I'?m|I'?ve|I'?d|I'?ll|my|mine|myself|me)\b/i.test(answer);
}

function thirdPersonAboutUser(answer: string): boolean {
  // WRONG-PERSON voice for a candidate answer: either THIRD person about the user
  // ("the candidate's experience", "their projects") OR SECOND person ("your
  // name is", "you are <name>", "your experience includes") — a what-to-answer
  // candidate answer must say what the candidate says aloud, never address them.
  return /\b(the user'?s?|the candidate'?s?|their\s+(?:name|experience|background|projects?|skills?))\b/i.test(answer)
    || /\byour\s+(?:name\s+is|experience\s+(?:includes|is)|background\s+is|projects?\s+(?:include|are)|skills?\s+(?:include|are))\b/i.test(answer)
    || /\byou\s+are\s+[A-Z][a-z]+/i.test(answer); // "You are Evin ..."
}

/**
 * Validate a generated profile answer against the spec's output rules.
 * Returns ok:true with no violations when the answer is compliant.
 */
export function validateProfileOutput(input: ProfileValidationInput): ProfileValidationResult {
  const { answer, plan, profileAvailable, candidateDirected } = input;
  const text = (answer || '').trim();
  const violations: ProfileViolation[] = [];

  // Nothing to validate on an empty answer.
  if (!text) {
    return { ok: true, violations: [], errorCodes: [] };
  }

  const isProfile = isProfileAnswerType(plan.answerType);
  const wantsFirstPerson = plan.outputPerspective === 'first_person_candidate';

  // 1 & 3 & 4: profile/identity answers must never refuse access or claim no
  // experience when the profile exists, and (for identity) never claim to be
  // the assistant.
  if (isProfile && profileAvailable) {
    if (NO_ACCESS_RE.test(text)) {
      violations.push({
        code: 'false_no_access_refusal',
        detail: `${plan.answerType} answered "no access" though a profile is loaded`,
        severity: 'error',
      });
    }
    if (NO_EXPERIENCE_RE.test(text)) {
      violations.push({
        code: 'false_no_experience_refusal',
        detail: `${plan.answerType} claimed no personal experience though a profile is loaded`,
        severity: 'error',
      });
    }
  }

  // 2: assistant-identity leak — only an error when the candidate is being asked
  // (interviewer-directed identity/profile). A normal assistant chat saying "I'm
  // Natively" is fine, so gate on candidateDirected + profile answer type.
  if (isProfile && candidateDirected && (ASSISTANT_IDENTITY_RE.test(text) || NATIVELY_SELF_RE.test(text))) {
    violations.push({
      code: 'assistant_identity_leak',
      detail: `${plan.answerType} answered as the assistant ("I am Natively / an AI") instead of the candidate`,
      severity: 'error',
    });
  }

  // 1: wrong perspective — a first-person-required answer that uses third person
  // about the user and lacks first-person voice.
  if (isProfile && wantsFirstPerson) {
    if (!firstPersonPresent(text) && thirdPersonAboutUser(text)) {
      violations.push({
        code: 'wrong_perspective_not_first_person',
        detail: `${plan.answerType} should be first-person but spoke in third person about the user`,
        severity: 'error',
      });
    }
  }

  // 4: sensitive/salary leak in a NON-salary answer.
  if (plan.answerType !== 'negotiation_answer') {
    const forbidsNegotiation = plan.forbiddenContextLayers.includes('negotiation');
    if (forbidsNegotiation && NEGOTIATION_STRATEGY_RE.test(text)) {
      violations.push({
        code: 'sensitive_salary_leak',
        detail: `${plan.answerType} leaked negotiation strategy language in a non-salary answer`,
        severity: 'error',
      });
    }
    // Bare salary figures are only flagged for clearly non-financial profile/coding
    // answers (identity, skills, coding) where a number is almost certainly a leak.
    const figureSensitiveTypes: AnswerType[] = [
      'identity_answer', 'skills_answer', 'skill_experience_answer',
    ];
    if (figureSensitiveTypes.includes(plan.answerType) && SALARY_FIGURE_RE.test(text)) {
      violations.push({
        code: 'sensitive_salary_leak',
        detail: `${plan.answerType} contained a salary/comp figure where none belongs`,
        severity: 'warning',
      });
    }
  }

  // 5: resume/JD leak in a generic coding/technical/sales/lecture answer.
  if (plan.forbiddenContextLayers.includes('resume') && PROFILE_LEAK_RE.test(text)) {
    violations.push({
      code: 'profile_in_generic_answer',
      detail: `${plan.answerType} referenced resume/JD in a profile-forbidden answer`,
      severity: 'error',
    });
  }

  // 6 (release 2026-06-07): a pure coding/technical/design/lecture/sales answer
  // must not name the product (Natively), the candidate, a loaded project/company,
  // or reference the profile/JD/salary — UNLESS the user explicitly invited it.
  if (PROFILE_FORBIDDEN_OUTPUT_TYPES.has(plan.answerType) && !input.profileExplicitlyInvited) {
    const dynamicTokens = [
      input.profileTokens?.firstName,
      ...(input.profileTokens?.projects || []),
      ...(input.profileTokens?.companies || []),
      // Exclude single-word names that collide with common technical vocabulary, so a
      // project/company called "Search"/"Stack"/"Node" doesn't flag legitimate coding
      // prose as a leak (code-review 2026-06-07).
    ].filter((t): t is string => typeof t === 'string' && t.trim().length >= 3 && !isCommonTechWord(t));
    // A profile leak lives in PROSE, not in EXECUTABLE code. Two extraction levels:
    //  • `prose` keeps inline-code spans — a product/project NAME formatted as
    //    `Natively` is still a reference/leak, just styled as code.
    //  • `proseNoInlineCode` also drops inline spans — used ONLY for the generic
    //    comp-word marker (salary/ctc), so a SQL `salary` COLUMN or a `salary`
    //    variable isn't a false leak.
    // Both drop FENCED code blocks but KEEP code COMMENTS ("-- as used in Natively"),
    // the one place prose hides in a block (release 2026-06-07: SQL-salary column,
    // code-comment leak, AND inline-code project name).
    const dropFenced = (s: string) => s.replace(/```[\s\S]*?```/g, (block) =>
      block.split('\n').filter(line => /^\s*(--|\/\/|#|\*|\/\*)/.test(line)).join('\n'));
    const prose = dropFenced(text);
    const proseNoInlineCode = prose.replace(/`[^`]*`/g, ' ');
    const tokenHit = dynamicTokens.find(tok => {
      // "Natively" the product is handled case-sensitively by PRODUCT_NATIVELY_RE
      // below — skip it here so the dynamic (case-insensitive) check doesn't match
      // the English adverb "natively".
      if (/^nativel?y$/i.test(tok)) return false;
      // A token whose lowercase form is a real English word (e.g. a project literally
      // named "Apex"/"Vertex") must match CASE-SENSITIVELY so the common word isn't a
      // false leak; CamelCase/multi-word/unusual tokens stay case-insensitive.
      const looksLikeCommonWord = /^[A-Z][a-z]+$/.test(tok.trim());
      const flags = looksLikeCommonWord ? '' : 'i';
      try { return new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, flags).test(prose); }
      catch { return prose.includes(tok); }
    });
    // Proper-noun / profile-reference markers: test on prose WITH inline code (a
    // `Natively` reference counts). Comp words: test WITHOUT inline code (a `salary`
    // identifier doesn't).
    // Proper-noun / profile-reference markers (product name is case-sensitive via
    // PRODUCT_NATIVELY_RE so the adverb "natively" is not a false leak): test on
    // prose WITH inline code (a `Natively` reference counts).
    const NAME_MARKER_RE = /\b(my|your|the candidate'?s) (resume|profile|cv|background|experience)\b|\bbased on (my|your) (experience|profile|resume|background)\b|\b(my|your) JD\b|\bjob description\b/i;
    const COMP_MARKER_RE = /\b(salary|compensation|ctc|lpa)\b/i;
    if (PRODUCT_NATIVELY_RE.test(prose) || NAME_MARKER_RE.test(prose) || COMP_MARKER_RE.test(proseNoInlineCode) || tokenHit) {
      violations.push({
        code: 'profile_token_in_coding_answer',
        detail: `${plan.answerType} leaked a profile/product token (${tokenHit ? 'loaded-name' : 'static-marker'}) into a profile-forbidden answer`,
        severity: 'error',
      });
    }
  }

  const errorCodes = violations.filter(v => v.severity === 'error').map(v => v.code);
  return { ok: errorCodes.length === 0, violations, errorCodes };
}

/**
 * Deterministic repair for a `profile_token_in_coding_answer` leak: remove the
 * sentence(s) / line(s) that mention the forbidden token, preserving fenced code
 * blocks verbatim (a stray "Natively" almost always lands in prose, not code).
 * Returns the cleaned answer; the caller decides whether the result is still
 * usable or whether to regenerate. Content-free of profile data beyond the tokens
 * the caller already supplied.
 */
export function stripProfileTokensFromCoding(answer: string, tokens: string[]): string {
  if (!answer) return answer;
  const markers = [PRODUCT_NATIVELY_RE, /\b(my|your) (resume|profile|cv|JD)\b/i,
    /\bbased on (my|your) (experience|profile|resume|background)\b/i, /\bjob description\b/i,
    // Loaded project/company tokens — but exclude single-word names that collide
    // with common technical vocabulary (a project literally named "Search"/"Stack"/
    // "Node" must NOT delete legitimate algorithm prose). code-review 2026-06-07.
    // "Natively" is handled case-sensitively by PRODUCT_NATIVELY_RE above; a token
    // whose lowercase form is a real English word matches case-sensitively so the
    // adverb / common word isn't stripped from legitimate prose.
    ...tokens.filter(t => typeof t === 'string' && t.trim().length >= 3 && !isCommonTechWord(t) && !/^nativel?y$/i.test(t))
      .map(t => { const flags = /^[A-Z][a-z]+$/.test(t.trim()) ? '' : 'i'; try { return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, flags); } catch { return /$^/; } })];
  const hits = (s: string) => markers.some(re => re.test(s));
  // Split into fenced-code vs prose segments; only scrub prose. Preserve newlines
  // (and the blank lines that bracket a ``` fence) so the repaired answer still
  // renders its code blocks — drop offending SENTENCES but keep LINE structure.
  const parts = answer.split(/(```[\s\S]*?```)/g);
  const cleaned = parts.map(seg => {
    if (seg.startsWith('```')) {
      // Keep CODE intact, but a profile token can still leak via a COMMENT line
      // inside the block ("-- as used in Natively", "// from my resume"). Scrub
      // comment lines that hit a marker; leave executable code untouched (release
      // 2026-06-07: SQL/JS comment leak the prose-only strip missed).
      return seg.split('\n').map(line => {
        const isComment = /^\s*(--|\/\/|#|\*|\/\*)/.test(line);
        return (isComment && hits(line)) ? '' : line;
      }).filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');
    }
    // Per line: drop only the offending sentence(s), keep the line break.
    return seg.split('\n').map(line => {
      if (!line.trim()) return line; // preserve blank lines (fence spacing)
      const kept = line.split(/(?<=[.!?])\s+/).filter(sentence => !hits(sentence)).join(' ');
      return kept;
    }).join('\n');
  }).join('');
  return cleaned.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

// ── Final candidate-answer sanitizer (release 2026-06-07c) ──────────────────
// A candidate-facing answer (identity/experience/project/skills/jd-fit/behavioral/
// negotiation, delivered in candidate/interview/WTA voice) must NOT contain
// assistant-meta — "as an AI assistant", "I'm Natively", "I can't share", "I don't
// have your resume". Flash-lite occasionally TAIL-APPENDS such a sentence to an
// otherwise-valid answer. This deterministically strips the offending sentence(s)
// while preserving the valid content before it. Pure; no LLM; content-free of profile
// data. The caller decides whether the cleaned result is usable or to fall back.

/** Candidate-facing answer types the sanitizer applies to. */
export const CANDIDATE_VOICE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'profile_fact_answer', 'experience_answer', 'project_answer',
  'project_followup_answer', 'project_about_answer', 'skills_answer',
  'skill_experience_answer', 'jd_fit_answer', 'gap_analysis_answer',
  'behavioral_interview_answer', 'negotiation_answer',
]);

// Assistant-meta / false-refusal markers that must never appear in a candidate answer.
// Each is a SENTENCE-level signal — a sentence containing one is dropped. These are
// tightened (code-review 2026-06-07c) to require genuine ASSISTANT-META, never a bare
// verb phrase, so legitimate candidate content is preserved: an NDA caveat ("I cannot
// share the exact revenue figure"), a real "AI Researcher/Scientist/Lead" title, a
// product description ("I provide a resume-screening feature"), and an honest "I don't
// have ratings YET" must all survive.
const CANDIDATE_META_MARKERS: RegExp[] = [
  // "as an AI (model/assistant), I …" — the assistant framing, not a bare "as an AI".
  /\bas an AI(?:\s+(?:language\s+)?(?:model|assistant))\b/i,
  /\bas an AI,?\s+I\s+(?:cannot|can'?t|do(?:n'?t| not)|am|was)\b/i,
  // The model calling the CANDIDATE "an AI assistant" — "as your AI assistant", "a
  // reliable AI assistant for your team", "I would be a valuable AI assistant". This
  // is the model leaking its OWN identity into the candidate's voice. EXCLUDES "AI
  // assistant product/app/tool/feature/platform" (a legitimate product the candidate
  // built/sells) so a real product description survives (code-review release
  // 2026-06-07c). Requires a self-referential frame (as/your/be a/me a … AI assistant)
  // NOT immediately followed by a product noun.
  /\b(?:as your|as an?|as the|be an?|be the|me an?|i(?:'m| am) an?|i(?:'m| am) the|being (?:your|an?|the)|a (?:reliable|helpful|valuable|capable|dedicated|great|strong)|the (?:right|best|ideal|perfect|ultimate))\s+(?:\w+\s+)?AI\s+assistant\b(?!\s+(?:product|app|application|tool|platform|feature|service|company|startup|space|domain|market|that|which|called|like))/i,
  // "I'm an AI assistant / language model / chatbot" — the assistant identity. A real
  // job title ("AI Engineer/Researcher/Scientist/Lead/…") is NOT matched because the
  // noun after "AI" must be a model/assistant word.
  /\bI(?:'m| am)\s+an?\s+(?:AI\s+)?(?:assistant|language model|chat\s?bot)\b/i,
  /\bI(?:'m| am)\s+an\s+AI\s+(?:model|assistant|language model|chatbot)\b/i,
  /\bI(?:'m| am)\s+Natively\b/i,
  /\bNatively\s+(?:assistant|AI)\b/i,
  // Refusal that names the PROFILE/PERSONAL data, OR the bare assistant-stock phrase
  // "I can't share that information" (a non-answer). But NOT "I can't share the exact
  // revenue figure / the specific number" — those name a concrete business object
  // under NDA and are legitimate candidate content.
  /\bI\s+(?:cannot|can\s?not|can'?t)\s+share\s+(?:your\s+(?:resume|profile|personal|private)|personal information|that information\b(?!\s+about\s+(?:the|that|our|my)\b))\b/i,
  /\bI\s+(?:cannot|can\s?not|can'?t)\s+share\s+that\s*\.?\s*$/i,
  /\bI\s+do(?:n'?t| not)\s+have\s+(?:access\s+to\s+)?your\s+(?:resume|profile|cv|past experience|background|information)\b/i,
  /\bI\s+do(?:n'?t| not)\s+have\s+(?:the\s+)?(?:specific\s+)?(?:job\s+description|jd|resume|profile)\s+(?:loaded|available|in (?:my )?context)\b/i,
  /\bI\s+do(?:n'?t| not)\s+have\s+(?:specific\s+)?(?:past\s+)?experience\s+loaded\b/i,
  // The skill-rating AI refusal — but NOT "I don't have ratings yet, but I'm learning"
  // (an honest self-assessment). Require the AI-refusal framing.
  /\b(?:as an AI|I(?:'m| am) an AI)[^.?!]*\bdo(?:n'?t| not)\s+assign\s+(?:numerical\s+)?ratings?\b/i,
  /\bI\s+do(?:n'?t| not)\s+assign\s+(?:numerical\s+)?ratings?\s+to\s+(?:skills|myself|people)\b/i,
  // An IMPERATIVE request directed at the user to provide their docs (a whole-sentence
  // ask), not an embedded clause like "I provide the resume screening feature".
  /^\s*(?:please\s+)?(?:upload|paste|provide|share|attach)\s+(?:your|the)\s+(?:resume|cv|profile|job description|jd)\b/i,
];

// PERSPECTIVE REPAIR (2026-06-14, A09 fix). A candidate-voice answer must speak AS the
// candidate ("I have 5 years…"), not ABOUT them ("You have 5 years…"). The LLM sometimes
// addresses the candidate in the second person on factual questions ("How many years of
// experience do you have?" → "You have roughly 0.4 years"). This flips the candidate-
// addressing second person to first person. Conservative: only verb-anchored "you/your"
// forms, applied per-sentence to prose (fenced code is preserved by the caller's split).
// We do NOT touch a trailing question to the user, generic "you can/you should" advice,
// or "thank you", so an interviewer-facing aside isn't mangled.
const SECOND_PERSON_REPAIRS: Array<[RegExp, string]> = [
  [/\byou have\b/gi, 'I have'],
  [/\byou'?ve\b/gi, "I've"],
  [/\byou had\b/gi, 'I had'],
  [/\byou are\b/gi, 'I am'],
  [/\byou'?re\b/gi, "I'm"],
  [/\byou were\b/gi, 'I was'],
  [/\byou worked\b/gi, 'I worked'],
  [/\byou built\b/gi, 'I built'],
  [/\byou led\b/gi, 'I led'],
  [/\byou bring\b/gi, 'I bring'],
  [/\byou possess\b/gi, 'I possess'],
  [/\byour experience\b/gi, 'my experience'],
  [/\byour background\b/gi, 'my background'],
  [/\byour skills?\b/gi, 'my skill'],
  [/\byour projects?\b/gi, 'my project'],
  [/\byour strongest\b/gi, 'my strongest'],
  [/\byour role\b/gi, 'my role'],
];
// A sentence we must NOT flip: a direct question/instruction to the user, or generic
// advice. If the sentence is itself a question addressed outward, leave it alone.
const ADDRESSES_USER_RE = /\?\s*$|\b(?:you can|you could|you should|you might|you may|you'?ll want|let me know|feel free)\b|\bthank you\b/i;

function repairCandidatePerspective(sentence: string): { text: string; changed: boolean } {
  if (!/\byou(?:'?(?:ve|re|ll|d))?\b|\byour\b/i.test(sentence)) return { text: sentence, changed: false };
  if (ADDRESSES_USER_RE.test(sentence)) return { text: sentence, changed: false };
  let out = sentence;
  for (const [re, rep] of SECOND_PERSON_REPAIRS) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => (m[0] === m[0].toUpperCase() ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep));
  }
  return { text: out, changed: out !== sentence };
}

export interface CandidateSanitizeResult {
  text: string;
  /** True when at least one offending sentence was removed OR a perspective flip applied. */
  repaired: boolean;
  /** True when stripping left nothing usable — caller MUST use a deterministic fallback. */
  needsFallback: boolean;
  /** Marker codes that fired (telemetry only; no raw content). */
  removedMarkers: string[];
}

/**
 * Strip trailing/embedded assistant-meta sentences from a candidate-facing answer.
 * Splits on sentence boundaries (preserving fenced code, though candidate answers
 * rarely have any), drops any sentence that trips a meta marker, keeps the rest.
 * Returns `needsFallback: true` when the result is empty/too short so the caller
 * substitutes a deterministic profile-grounded answer instead.
 */
export function sanitizeCandidateAnswer(answer: string): CandidateSanitizeResult {
  const original = String(answer || '');
  if (!original.trim()) return { text: original, repaired: false, needsFallback: true, removedMarkers: [] };
  const removed = new Set<string>();
  let perspectiveFlipped = false;
  const markerHit = (s: string): boolean => {
    let hit = false;
    for (let i = 0; i < CANDIDATE_META_MARKERS.length; i++) {
      if (CANDIDATE_META_MARKERS[i].test(s)) { removed.add(`m${i}`); hit = true; }
    }
    return hit;
  };
  // Preserve fenced code blocks verbatim; scrub prose between them.
  const parts = original.split(/(```[\s\S]*?```)/g);
  const cleaned = parts.map(seg => {
    if (seg.startsWith('```')) return seg;
    return seg.split('\n').map(line => {
      if (!line.trim()) return line;
      const kept = line.split(/(?<=[.!?])\s+/)
        .filter(sentence => !markerHit(sentence))
        // A09 fix: flip candidate-addressing 2nd person ("You have…") to 1st ("I have…").
        .map(sentence => {
          const r = repairCandidatePerspective(sentence);
          if (r.changed) perspectiveFlipped = true;
          return r.text;
        })
        .join(' ');
      return kept;
    }).join('\n');
  }).join('');
  const text = cleaned.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  const repaired = (removed.size > 0 || perspectiveFlipped) && text !== original.trim();
  // If stripping emptied the answer (the whole thing was assistant-meta) or left a
  // fragment too short to be useful, the caller must fall back deterministically.
  const needsFallback = text.length < 15;
  return { text, repaired, needsFallback, removedMarkers: Array.from(removed) };
}

// Single-word profile tokens that are ALSO common technical vocabulary — excluded
// from the dynamic leak-token check so a project/company name like "Search" or
// "Node" can't delete or flag legitimate coding prose (code-review 2026-06-07).
const COMMON_TECH_WORDS = new Set([
  'search', 'data', 'stack', 'queue', 'node', 'graph', 'tree', 'heap', 'cache', 'cloud',
  'core', 'base', 'edge', 'flow', 'grid', 'hash', 'index', 'key', 'list', 'map', 'net',
  'path', 'pool', 'port', 'proxy', 'query', 'set', 'sort', 'sync', 'table', 'task',
  'vertex', 'apex', 'array', 'async', 'batch', 'buffer', 'byte', 'cluster', 'event',
  'frame', 'group', 'layer', 'loop', 'object', 'page', 'route', 'scope', 'shell',
  'state', 'stream', 'string', 'thread', 'token', 'value', 'view', 'worker',
]);
function isCommonTechWord(t: string): boolean {
  const w = t.trim().toLowerCase();
  return !w.includes(' ') && COMMON_TECH_WORDS.has(w);
}

/**
 * Build a terse corrective instruction the caller can append to a regeneration
 * prompt when validation fails. Content-free of profile data — names the rule to
 * fix, not the data. Returns '' when there are no error-severity violations.
 */
export function buildProfileRepairInstruction(result: ProfileValidationResult): string {
  if (result.ok) return '';
  const lines: string[] = [];
  for (const code of new Set(result.errorCodes)) {
    switch (code) {
      case 'false_no_access_refusal':
        lines.push('- You DO have the user\'s profile. Answer the question directly from it; never say you lack access to their information.');
        break;
      case 'false_no_experience_refusal':
        lines.push('- The user\'s real experience is in the profile. Answer from it; never claim you have no personal experience.');
        break;
      case 'assistant_identity_leak':
        lines.push('- Answer AS the candidate in first person ("My name is ...", "I worked on ..."). Never say you are Natively or an AI.');
        break;
      case 'wrong_perspective_not_first_person':
        lines.push('- Use first person ("I", "my"). Do not describe the user in third person.');
        break;
      case 'sensitive_salary_leak':
        lines.push('- Remove all salary, compensation, and negotiation-strategy details; they do not belong in this answer.');
        break;
      case 'profile_in_generic_answer':
        lines.push('- This is a technical answer. Remove any mention of the resume, job description, or personal profile.');
        break;
      case 'profile_token_in_coding_answer':
        lines.push('- This is a PURE technical/coding answer. Do NOT mention Natively, the candidate, any project or company name, the resume/profile/JD, or salary. Answer the algorithm/concept only, from general knowledge.');
        break;
    }
  }
  return lines.length
    ? `Your previous answer broke these rules. Regenerate, fixing ONLY these:\n${lines.join('\n')}`
    : '';
}
