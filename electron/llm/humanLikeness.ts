// electron/llm/humanLikeness.ts
//
// HUMAN-LIKENESS GUARD (task Phase 12 + the 2026-06-15 humanization sprint). Real-session
// answers were grounded but read as corporate/LinkedIn boilerplate ("a unique blend of",
// "drive business objectives", "data-driven mindset", "leveraging my technical rigor to
// deliver actionable intelligence"). This module:
//   1. Adds a prompt DIRECTIVE (form-only) for interview / looking-for-work / sales
//      answer types so the model speaks like a person, not a brochure.
//   2. Provides a deterministic DETECTOR for corporate filler (telemetry/attribution/tests).
//   3. Provides a deterministic FINAL-PASS REWRITER (humanizeSpokenAnswer) that strips the
//      residual corporate idiom / source narration / "the candidate" framing a model still
//      ships despite the prompt. Style-only, fact-preserving, fence-safe. NOTE (2026-06-15):
//      it no longer strips mid-sentence **bold** — sparing key-term bold is kept as a
//      deliberate on-screen scanning aid (bold is never spoken, so spoken quality is intact).
//
// Applied ONLY to spoken candidate/sales answers, never to code, lecture notes, diagrams,
// search results, or technical explanations where structure/precision matters.
//
// Pure, deterministic, no LLM, no profile-specific strings.

import type { AnswerType } from './AnswerPlanner';

/** Answer types spoken aloud as a person (interview / job-seeking / sales). The PROMPT
 *  DIRECTIVE (humanizeDirectiveFor) is added only for this core set, keeping the up-front
 *  directive narrow. */
const HUMANIZE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'experience_answer', 'project_answer', 'project_followup_answer',
  'skills_answer', 'skill_experience_answer', 'jd_fit_answer', 'gap_analysis_answer',
  'behavioral_interview_answer', 'negotiation_answer', 'sales_answer',
  'product_candidate_mix_answer',
]);

/** Answer types that must KEEP their structure/precision and are NEVER humanized (the
 *  deterministic rewriter would risk their code/precision). This is the DENYLIST the
 *  rewriter gates on: any spoken answer that is NOT one of these gets the final pass,
 *  because real sessions showed corporate filler arriving on profile_fact_answer,
 *  follow_up_answer, unknown_answer, general_meeting_answer, etc., not just the curated
 *  set above. */
const STRUCTURE_PRESERVED_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer',
  'debugging_question_answer', 'technical_concept_answer', 'lecture_answer',
  'project_link_answer', 'source_code_evidence_answer', 'ethical_usage_answer',
]);

/** Should the PROMPT DIRECTIVE be added? (narrow curated set, up-front prevention.) */
export function shouldHumanize(answerType: AnswerType): boolean {
  if (STRUCTURE_PRESERVED_TYPES.has(answerType)) return false;
  return HUMANIZE_ANSWER_TYPES.has(answerType);
}

/** Should the deterministic FINAL-PASS rewriter run? (broad denylist, last-mile cleanup
 *  of any spoken answer, since filler shows up on more types than the curated directive
 *  set). Code / lecture / technical / link / source / ethical answers are excluded. */
export function shouldHumanizeOutput(answerType: AnswerType): boolean {
  return !STRUCTURE_PRESERVED_TYPES.has(answerType);
}

// Corporate-filler phrases users flagged as robotic. Word-boundary, case-insensitive.
const CORPORATE_FILLER_PATTERNS: ReadonlyArray<RegExp> = [
  /\bunique blend\b/i,
  /\bdrive business (?:objectives|outcomes|value|results|growth)\b/i,
  /\bbusiness objectives\b/i,
  /\b(?:decisive|significant|key|distinct)? ?competitive advantage\b/i,
  /\bdata[- ]driven (?:mindset|approach|professional|individual)\b/i,
  /\btechnical rigor\b/i,
  /\bactionable intelligence\b/i,
  /\bactionable insights?\b/i,
  /\bhigh[- ]impact solutions?\b/i,
  /\bscalable solutions?\b/i,
  /\bmove the needle\b/i,
  /\bbridge the gap\b/i,
  /\bstrategic mindset\b/i,
  /\brobust and scalable\b/i,
  /\bseamless experience\b/i,
  /\bdeep expertise\b/i,
  /\bleverage(?:s|d|ing)?\s+my\b/i,
  /\bsynerg(?:y|ies|istic)\b/i,
  /\bbest[- ]in[- ]class\b/i,
  /\bresults?[- ]oriented\b/i,
  /\bproven track record\b/i,
  /\bpassionate about (?:leveraging|driving|delivering)\b/i,
  /\bspearhead(?:ed|ing)?\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bdeep dive into\b/i,
  /\bvalue proposition\b/i,
  /\bcutting[- ]edge\b/i,
  // Reference-to-the-source tells ("based on the provided context", "the candidate").
  /\bbased on the provided (?:context|resume|information)\b/i,
  /\baccording to (?:the|my) resume\b/i,
  /\bthe candidate('s)?\b/i,
];

export interface CorporateFillerVerdict {
  hasFiller: boolean;
  /** Count of distinct filler phrases matched (no raw content beyond the phrase label). */
  count: number;
  /** The matched filler phrases (these are GENERIC labels, not user/profile content). */
  matches: string[];
}

/**
 * Detect corporate/LinkedIn filler in an answer. Returns the matched generic phrases
 * (safe to log, they're boilerplate, not profile content). Used for telemetry +
 * attribution + tests. Does NOT modify the answer.
 */
export function detectCorporateFiller(answer: string): CorporateFillerVerdict {
  const text = answer || '';
  const matches: string[] = [];
  for (const re of CORPORATE_FILLER_PATTERNS) {
    const m = text.match(re);
    if (m) matches.push(m[0].toLowerCase());
  }
  return { hasFiller: matches.length > 0, count: matches.length, matches };
}

/**
 * The HUMANIZE directive appended to the answer contract for spoken candidate/sales
 * answers. Form-only, never changes grounding, voice perspective, or leak boundaries.
 */
export const HUMANIZE_DIRECTIVE =
  'HUMAN VOICE: Speak like a real person in conversation, not a resume or a brochure. ' +
  'Short, spoken, specific, first-person. Lead with the concrete point. ' +
  'BAN these corporate phrases: "unique blend", "drive business objectives", "competitive advantage", ' +
  '"data-driven mindset", "technical rigor", "actionable intelligence/insights", "leverage", "synergy", ' +
  '"best-in-class", "results-oriented", "proven track record", "cutting-edge", "seamless", "spearheaded". ' +
  'Never say "based on the provided context", "according to the resume", or "the candidate", just answer as yourself. ' +
  'Prefer fewer, plainer words. It is fine to sound a little less polished if it sounds more real.';

/**
 * Return the humanize directive for this answer type, or '' when it must not apply
 * (code / lecture / diagram / technical / search). Callers append this to the prompt.
 */
export function humanizeDirectiveFor(answerType: AnswerType): string {
  return shouldHumanize(answerType) ? HUMANIZE_DIRECTIVE : '';
}

// ----------------------------------------------------------------------------
// DETERMINISTIC FINAL-PASS REWRITER (task Phase 6).
//
// The prompt directive + HUMAN_SPOKEN_ANSWER_CONTRACT do the real work UP FRONT. This is
// the last-mile backstop: when a model still ships a corporate idiom or an internal label
// despite the prompt, this pass removes it deterministically. NO LLM, NO network, NO
// profile knowledge.
//
// HARD SAFETY RULES (why this is conservative on purpose):
//   - STYLE-ONLY. It never adds, removes, or alters a FACT. It only swaps a fixed idiom
//     for a plainer synonym that is a grammatical drop-in, strips a label, or normalises
//     punctuation/formatting.
//   - FENCE-SAFE: fenced code blocks, inline `code` spans, and $math$ are pulled out, left
//     byte-for-byte untouched, and restored. A coding/diagram answer should never reach
//     here anyway (shouldHumanizeOutput == false); this is defence in depth.
//   - Every phrase swap is chosen so the replacement slots into the SAME grammatical
//     position as the original (noun phrase -> noun phrase, verb -> verb, adjective ->
//     adjective). We deliberately do NOT attempt sentence-level semantic rewrites, which
//     risk breaking grammar/meaning. The contract handles the deep rewrite; this handles
//     the mechanical residue.
//   - Meaning-preserving and idempotent: running it twice yields the same text.
// ----------------------------------------------------------------------------

/** Keep the matched fragment's leading capitalisation on the replacement. */
const withCase = (match: string, replacement: string): string =>
  /^[A-Z]/.test(match) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;

/**
 * Generic, style-only corporate-idiom -> plain-speech map. ORDER MATTERS: longer / more
 * specific phrases first so "turn raw data into actionable intelligence" is caught before
 * "actionable intelligence". Each `to` is a grammatical drop-in for the matched `re`
 * (same part of speech / phrase head). NONE of these encode profile facts.
 */
const PHRASE_REWRITES: ReadonlyArray<{ re: RegExp; to: string }> = [
  // whole-phrase cliches (must precede their component words)
  { re: /\bturn(?:ing|s|ed)?\s+raw\s+data\s+into\s+actionable\s+intelligence\b/gi, to: 'turn messy data into something useful' },
  { re: /\brobust\s+and\s+scalable\b/gi, to: 'reliable' },
  { re: /\bmove\s+the\s+needle\b/gi, to: 'make a real difference' },
  { re: /\bbridge\s+the\s+gap\b/gi, to: 'close the gap' },
  // NOTE: every replacement that can sit directly after "a"/"an" starts with a CONSONANT
  // sound, so the preceding article stays grammatical (no "a edge").
  { re: /\bproven\s+track\s+record\b/gi, to: 'track record' },
  { re: /\bunique\s+blend\b/gi, to: 'mix' },
  { re: /\bactionable\s+intelligence\b/gi, to: 'useful information' },
  { re: /\bactionable\s+insights\b/gi, to: 'useful takeaways' },
  { re: /\bactionable\s+insight\b/gi, to: 'useful takeaway' },
  { re: /\bbusiness\s+objectives\b/gi, to: 'goals' },
  { re: /\bhigh[- ]impact\s+solutions?\b/gi, to: 'solutions that matter' },
  { re: /\bscalable\s+solutions?\b/gi, to: 'solutions that hold up as things grow' },
  // The optional adjective AND its trailing space live INSIDE the group, so when no
  // adjective is present the leading space before "competitive" is NOT consumed (avoids
  // "a competitive advantage" -> "aleg up"). code-review HIGH 2026-06-15.
  { re: /\b(?:(?:decisive|distinct|significant|key)\s+)?competitive\s+advantage\b/gi, to: 'leg up' },
  { re: /\btechnical\s+rigor\b/gi, to: 'careful engineering' },
  { re: /\bdata[- ]driven\s+mindset\b/gi, to: 'habit of checking the numbers' },
  { re: /\bstrategic\s+mindset\b/gi, to: 'sense of priorities' },
  { re: /\bdeep\s+expertise\b/gi, to: 'real experience' },
  { re: /\bseamless\s+experience\b/gi, to: 'smooth experience' },
  // bare adjective "seamless"/"seamlessly" (a top AI tell) -> "smooth"/"smoothly".
  // Consonant-sound drop-in, so a preceding article stays correct.
  { re: /\bseamlessly\b/gi, to: 'smoothly' },
  { re: /\bseamless\b/gi, to: 'smooth' },
  { re: /\bresults[- ]oriented\b/gi, to: 'practical' },
  { re: /\bbest[- ]in[- ]class\b/gi, to: 'strong' },
  // VERB "leverage" (a top AI tell) -> "use". The -ing/-s/-ed inflections are
  // unambiguously verbs. The BASE form is also a NOUN ("financial leverage", "more
  // leverage in the deal") which is COMMON in sales/negotiation answers (in scope), so we
  // only rewrite the base form when it is NOT preceded by a determiner/adjective that
  // marks the noun sense. code-review HIGH 2026-06-15.
  { re: /\bleveraging\b/gi, to: 'using' },
  { re: /\bleverages\b/gi, to: 'uses' },
  { re: /\bleveraged\b/gi, to: 'used' },
  { re: /(?<!\b(?:the|a|an|my|our|your|his|her|their|its|more|less|some|no|any|financial|main|real|extra|added|negotiating|bargaining)\s)\bleverage\b(?=\s+\w)/gi, to: 'use' },
];

/** Sentence-initial source-narration that can be cut cleanly (grammar-safe deletion). */
const SOURCE_NARRATION_RE =
  /\b(?:based\s+on\s+(?:my|your|the)\s+(?:resume|profile|background|cv|provided\s+context|context)|according\s+to\s+(?:the|my|your)\s+(?:jd|job\s+description|resume|profile))\s*,?\s*/gi;

/** "the candidate <aux/copula>" -> first person. ONLY safe verb frames (no agreement risk). */
const CANDIDATE_NARRATION_REWRITES: ReadonlyArray<{ re: RegExp; to: string }> = [
  { re: /\bthe\s+candidate's\b/gi, to: 'my' },
  { re: /\bthe\s+candidate\s+has\b/gi, to: 'I have' },
  { re: /\bthe\s+candidate\s+is\b/gi, to: "I'm" },
  { re: /\bthe\s+candidate\s+was\b/gi, to: 'I was' },
  { re: /\bthe\s+candidate\s+will\b/gi, to: 'I will' },
  { re: /\bthe\s+candidate\s+can\b/gi, to: 'I can' },
  { re: /\bthe\s+candidate\s+would\b/gi, to: 'I would' },
  { re: /\bthe\s+candidate\s+brings\b/gi, to: 'I bring' },
];

const HFENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const BLOCK_MATH_RE = /\$\$[\s\S]*?\$\$/g;
// Inline math ONLY: a $...$ span whose body looks mathematical (a backslash command, ^, _,
// or braces), NOT a plain currency amount like "$20k" or a "$5M to $20M" pair. This keeps
// salary/sales dollar figures out of the math protector so they are neither mis-paired as
// one span nor shielded from spacing normalization. code-review MEDIUM 2026-06-15.
const INLINE_MATH_RE = /\$(?=[^$\n]*[\\^_{}])[^$\n]+\$/g;

// Collision-resistant placeholder sentinels: Unicode private-use-area open/close chars a
// model's own output cannot contain, so a literal "PROT0" in the answer can never be
// mistaken for a protected slot. The sentinel carries no surrounding spaces, so restoring
// it never swallows an adjacent space. code-review MEDIUM 2026-06-15.
const SENT_OPEN = String.fromCharCode(0xe000);
const SENT_CLOSE = String.fromCharCode(0xe001);
const SENT_RESTORE_RE = new RegExp(`${SENT_OPEN}(\\d+)${SENT_CLOSE}`, 'g');

/**
 * Deterministically rewrite a SPOKEN answer toward plain human speech. Style-only,
 * fact-preserving, fence/code/math-safe, idempotent. Callers gate on shouldHumanizeOutput()
 * (and never call it for code-only / lecture / technical / search / json output).
 *
 * Returns the original string unchanged when nothing matches.
 */
export function humanizeSpokenAnswer(answer: string): string {
  if (!answer || typeof answer !== 'string') return answer;

  // 1. Pull out everything we must never touch, in priority order. The placeholder is a
  //    PUA sentinel pair with NO surrounding spaces, so a literal "PROT0" in the answer
  //    can't collide and restoring it can't swallow an adjacent space. As defence in
  //    depth, strip any pre-existing PUA sentinel chars from the input first so a model's
  //    own (astronomically unlikely) U+E000/U+E001 bytes can never be read as a slot.
  const protectedChunks: string[] = [];
  let text = answer.split(SENT_OPEN).join('').split(SENT_CLOSE).join('');
  const protect = (re: RegExp) => {
    text = text.replace(re, (m) => {
      protectedChunks.push(m);
      return `${SENT_OPEN}${protectedChunks.length - 1}${SENT_CLOSE}`;
    });
  };
  protect(HFENCE_RE);
  protect(BLOCK_MATH_RE);
  protect(INLINE_CODE_RE);
  protect(INLINE_MATH_RE);

  // 2. Drop sentence-initial source narration ("Based on your resume, ...").
  text = text.replace(SOURCE_NARRATION_RE, '');

  // 3. "the candidate <verb>" -> first person (safe frames only).
  for (const { re, to } of CANDIDATE_NARRATION_REWRITES) {
    text = text.replace(re, (m) => withCase(m, to));
  }

  // 4. Corporate-idiom -> plain-speech swaps (grammatical drop-ins, longest first).
  for (const { re, to } of PHRASE_REWRITES) {
    text = text.replace(re, (m) => withCase(m, to));
  }

  // 5. Punctuation that reads as an AI tell in spoken prose.
  //    em/en dash between digits -> hyphen (keep numeric ranges like 5-10).
  text = text.replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2');
  //    em/en dash between words -> comma.
  text = text.replace(/\s*[—–]\s*/g, ', ');
  //    spaced double-hyphen used as a dash -> comma.
  text = text.replace(/\s+--\s+/g, ', ');
  //    semicolon -> split into a new sentence (capitalise the next word).
  text = text.replace(/;\s+(\w)/g, (_m, c: string) => '. ' + c.toUpperCase());
  text = text.replace(/;\s*$/gm, '.');

  // 6. (Removed 2026-06-15) Mid-sentence **bold** is now KEPT. Sparing bold of the 1-3
  //    load-bearing key terms is a deliberate scanning aid so the user can recreate the
  //    line at a glance when they can't read the whole answer off-screen. Bold is never
  //    spoken aloud, so it doesn't hurt spoken quality; the prompt caps it to a few terms
  //    (never LinkedIn-style over-bolding). Headers/bullets in a spoken answer are still
  //    discouraged by the prompt, but this deterministic pass no longer strips bold.

  // 7. Article repair, SCOPED to our own replacement words only (so untouched text is
  //    never altered): every PHRASE_REWRITES replacement is consonant-SOUND-initial, so a
  //    preceding "an" left over from the original phrase (e.g. "an actionable insight" ->
  //    "an useful takeaway") must become "a". We only rewrite "an" when it directly
  //    precedes one of the known replacement heads. A global a->an fixer is deliberately
  //    avoided; it would wrongly "correct" untouched prose like "a useful tool".
  text = text.replace(
    /\b([Aa])n\s+(mix|track\s+record|leg\s+up|useful|reliable|real\s+experience|smooth\s+experience|habit\s+of|solutions?\b|goals?\b)/g,
    (_m, a: string, head: string) => `${a} ${head}`,
  );

  // 8. If a deletion left a lowercase sentence start at the very top, fix it.
  text = text.replace(/^(\s*)([a-z])/, (_m, ws: string, c: string) => ws + c.toUpperCase());

  // 9. Tidy the artifacts the swaps/deletions leave behind. This runs while code/math are
  //    STILL placeholders (PUA sentinels), so the whitespace rules can never reflow code
  //    block contents. The sentinel carries no surrounding spaces, so adjacency
  //    ("price is $20k", "see `foo` now") survives the tidy + restore.
  text = text
    .replace(/[ \t]{2,}/g, ' ')           // collapse runs of spaces/tabs (in prose only)
    .replace(/ +([,.!?])/g, '$1')         // no space before punctuation (spaces only)
    .replace(/,\s*,/g, ',')               // doubled commas
    .replace(/\n[ \t]+/g, '\n')           // leading indent on wrapped lines
    .replace(/\n{3,}/g, '\n\n');

  // 10. Restore protected chunks LAST (byte-for-byte), after all prose normalization.
  text = text.replace(SENT_RESTORE_RE, (_m, i: string) => protectedChunks[Number(i)] ?? '');

  return text.trim();
}

/**
 * Convenience wrapper for the call sites: apply humanizeSpokenAnswer ONLY when the answer
 * type is a spoken (non-structured) type. Returns the input unchanged otherwise, so a
 * caller can use it unconditionally. Reports whether anything changed so the caller can
 * decide to send a corrected final frame. Gated on the BROAD denylist (shouldHumanizeOutput)
 * so filler is cleaned on profile_fact / follow_up / unknown / general spoken answers too,
 * not just the curated directive set.
 */
export function humanizeForAnswerType(
  answerType: AnswerType,
  answer: string,
): { text: string; changed: boolean } {
  if (!shouldHumanizeOutput(answerType)) return { text: answer, changed: false };
  const out = humanizeSpokenAnswer(answer);
  return { text: out, changed: out !== answer };
}
