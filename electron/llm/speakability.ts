// electron/llm/speakability.ts
//
// SPEAKABILITY BUDGET (spoken-answer-quality sprint, 2026-06-15).
//
// A spoken answer is meant to be read aloud in an interview / sales call / meeting. The
// failure this fixes: grounded answers that are correct but TOO LONG to actually say —
// 150-word paragraphs, tutorial-length tech explanations. The rule is "the shortest
// COMPLETE answer the user can safely say aloud", NOT a blunt 100-word chop.
//
// This module is the deterministic backstop behind the prompt-side SPOKEN_ANSWER_CONTRACT:
//   - countSpokenWordsExcludingCode / estimateSpeakSeconds — measure the spoken length,
//     ignoring fenced code, inline code, and math (those aren't spoken).
//   - decideSpeakability — classify {wordCount, seconds, overBudget, exception, reason}.
//     An EXCEPTION means the answer is ALLOWED to be long (code / detail / system design /
//     lecture / step-by-step) and must never be trimmed.
//   - trimToSpeakable — a conservative tail-trimmer that ONLY fires above the HARD cap and
//     never when an exception applies, never on a fenced answer, never below 2 sentences,
//     and never drops the lead sentence. The prompt does the real shortening; this is the
//     rare safety net.
//
// Pure, deterministic, no LLM, no I/O, no profile strings.

import type { AnswerType } from './AnswerPlanner';
import type { AnswerStyle } from './answerStyle';

// Spoken-length thresholds. Soft target 45-85 words; SPOKEN_SHORT hard ceiling 100 words / 35s.
export const SOFT_MIN_WORDS = 45;
export const SOFT_MAX_WORDS = 85;
export const HARD_MAX_WORDS = 100;
export const HARD_MAX_SECONDS = 35;
// SPOKEN_FULL soft ceiling. A fuller spoken answer (negotiation, ethical, tradeoff, behavioral
// with context, multi-part) targets ~100-180 words. This is PROMPT-ONLY guidance: the
// deterministic trimmer never fires on SPOKEN_FULL (it would risk cutting a nuanced answer
// mid-thought). Only SPOKEN_SHORT is auto-trimmed (above HARD_MAX_WORDS).
export const SPOKEN_FULL_MAX_WORDS = 180;
// Average speaking rate for an interview/meeting answer (words per minute).
const WORDS_PER_MINUTE = 140;

// Global variants are used ONLY with .replace() (which self-resets lastIndex).
const FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const BLOCK_MATH_RE = /\$\$[\s\S]*?\$\$/g;
const INLINE_MATH_RE = /\$[^$\n]+\$/g;
// Non-global variant for .test() guards. A global regex's .test() advances lastIndex and
// leaks state across calls, which would make the fence guard nondeterministic and could
// let the trimmer/compressor mangle a code-bearing answer (code-review HIGH 2026-06-15).
const HAS_FENCE_RE = /```[\s\S]*?```/;

/** Strip everything that is NOT spoken aloud (code, inline code, math). */
function stripNonSpoken(text: string): string {
  return (text || '')
    .replace(FENCE_RE, ' ')
    .replace(BLOCK_MATH_RE, ' ')
    .replace(INLINE_CODE_RE, ' ')
    .replace(INLINE_MATH_RE, ' ');
}

/** Count the words a person would actually say, excluding code / math. */
export function countSpokenWordsExcludingCode(text: string): number {
  const prose = stripNonSpoken(text);
  const words = prose.match(/[A-Za-z0-9$%][A-Za-z0-9'’.+/-]*/g);
  return words ? words.length : 0;
}

/** Estimate how long the spoken portion takes to say aloud, in seconds. */
export function estimateSpeakSeconds(text: string): number {
  const words = countSpokenWordsExcludingCode(text);
  return Math.ceil((words / WORDS_PER_MINUTE) * 60);
}

// ── STRUCTURED_FULL signals (not a primarily-spoken paragraph) ────────────────
// These are the answer shapes whose long form is intentional and must never be
// length-trimmed: code, full DSA, system design, lecture notes, step-by-step, etc.

/** Answer TYPES whose output is structured rather than a spoken paragraph. */
const STRUCTURED_FULL_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer',
  'debugging_question_answer', 'lecture_answer', 'source_code_evidence_answer',
]);

/** Answer STYLES that explicitly requested a longer / structured answer. */
const STRUCTURED_FULL_STYLES: ReadonlySet<AnswerStyle> = new Set<AnswerStyle>([
  'detailed', 'code_only', 'bullets', 'exam', 'notes', 'approach_first', 'star',
]);

/** The question explicitly asks for a long/structured answer. */
const DETAIL_REQUEST_RE =
  /\b(in\s+detail|in[- ]depth|walk\s+me\s+through|step[- ]by[- ]step|deep[- ]dive|elaborate|full\s+(?:answer|solution|code)|system\s+design|write\s+(?:the\s+)?code|lecture\s+notes|explain\s+(?:the\s+)?(?:approach|each|every)\b)/i;

export interface SpeakabilityDecision {
  wordCount: number;
  seconds: number;
  /** The pre-generation length tier this answer was classified into. */
  target: SpeakabilityTarget;
  /** Over the SPOKEN_SHORT ceiling (100 words OR 35s) — only meaningful for SPOKEN_SHORT. */
  overBudget: boolean;
  /** Over the soft 85-word target (telemetry only — not enforced). */
  overSoftTarget: boolean;
  /** True when the answer is ALLOWED to be long (never trim): SPOKEN_FULL or STRUCTURED_FULL. */
  exception: boolean;
  /** Why it's allowed to be long / how it was classified (or '' for a plain SPOKEN_SHORT). */
  exceptionReason: string;
}

/**
 * Coarse, marker-only classification of a spoken answer's length — for telemetry
 * (the spoken-answer-quality spec's `speakability_class` field). No raw content.
 *   - 'exempt'      : allowed to be long (SPOKEN_FULL or STRUCTURED_FULL — never trimmed)
 *   - 'over_budget' : a SPOKEN_SHORT answer over the 100-word / 35s ceiling (would trim)
 *   - 'over_soft'   : a SPOKEN_SHORT answer over the 85-word soft target, under the ceiling
 *   - 'standard'    : within the soft target
 */
export type SpeakabilityClass = 'exempt' | 'over_budget' | 'over_soft' | 'standard';

/** Map a decision to its coarse class. Pure. */
export function classifySpeakability(decision: SpeakabilityDecision): SpeakabilityClass {
  if (decision.exception) return 'exempt';
  if (decision.overBudget) return 'over_budget';
  if (decision.overSoftTarget) return 'over_soft';
  return 'standard';
}

/**
 * Pre-generation target for the answer shape. This is NOT the same thing as
 * `SpeakabilityClass` above: the target says how the answer should be shaped before
 * the model speaks; `SpeakabilityClass` measures what actually came back after
 * generation. This target is telemetry / soft prompt guidance only — the verified
 * post-generation budget below remains the enforcement backstop.
 */
export type SpeakabilityTarget = 'SPOKEN_SHORT' | 'SPOKEN_FULL' | 'STRUCTURED_FULL';

// SPOKEN_FULL question SIGNALS — these are NOT a closed category list. The PRINCIPLE is:
// a fuller spoken answer is warranted whenever a short one would be incomplete, misleading,
// unsafe, or unusable. These regexes are heuristics for that principle (multi-part asks,
// comparisons/tradeoffs, "expand/justify/defend", asks for context or caveats), not an
// exhaustive enumeration — the prompt carries the real judgment.
// NOTE: a bare "and"/"or" + "?" is NOT a multi-part signal — it over-matches ordinary short
// questions ("Coffee or tea?", "what is SQL and NoSQL?") and would wrongly exempt them from
// trimming (code-review HIGH 2026-06-15). We only treat a conjunction as multi-part when it
// joins a second IMPERATIVE ask ("explain X and justify Y", "list the steps and the tradeoffs").
const MULTI_PART_REQUEST_RE =
  /\b(?:compare|comparison|tradeoffs?|trade[- ]offs?|pros\s+and\s+cons|versus|vs\.?|defend|justify|reconcile|weigh|expand\s+on|elaborate|go\s+deeper|more\s+detail|in\s+more\s+detail|walk\s+(?:me\s+)?through\s+(?:your\s+)?(?:thinking|reasoning|logic)|multiple\s+(?:options|approaches)|several\s+(?:options|approaches))\b|\b(?:and|or)\s+(?:also\s+|then\s+)?(?:explain|describe|walk|justify|compare|list|cover|include|defend|weigh|why|how)\b/i;

// Answer TYPES that, by their nature, usually need caveats / context / nuance to be safe and
// complete — so they default to SPOKEN_FULL (still spoken, just allowed more room). Behavioral
// and negotiation only escalate when the question carries a "needs context" signal (below).
const SPOKEN_FULL_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'ethical_usage_answer', // safety/ethics answers need room for caveats — never chop to 100
]);

// Behavioral/negotiation question signals that a fuller, contextual answer is needed. Includes
// the leadership/ownership verbs ("led a team", "built", "shipped") that mark a real story
// (code-review LOW 2026-06-16) plus the "ever/tell me about" recall openers.
const CONTEXTUAL_PRESSURE_RE =
  /\b(?:story|example|situation|time\s+(?:you|when)|ever|tell\s+me\s+about|describe\s+a|pressure|conflict|negotiate|negotiation|salary|comp(?:ensation)?|counter[- ]?offer|lowball|convince|push\s?back|objection|hard|honest|tough|difficult|defend|justify|trade[- ]?off|led|lead|managed|built|shipped|launched|owned|delivered)\b/i;

/**
 * Classify the intended answer shape BEFORE generation. Pure, no content access.
 *
 * The decision is principle-based, not a fixed exception list: an answer is allowed to be
 * longer whenever brevity would make it incomplete, misleading, unsafe, or unusable.
 *   - STRUCTURED_FULL: not a primarily-spoken paragraph (code / DSA / system design / lecture
 *     notes / step-by-step / explicit "in detail"). Uncapped.
 *   - SPOKEN_FULL: still spoken, but a short answer would be unreliable — negotiation,
 *     ethical/safety with caveats, tradeoffs/comparisons, behavioral with real context,
 *     multi-part, or "expand/justify/defend" follow-ups. ~100-180 (prompt-only ceiling).
 *   - SPOKEN_SHORT: the default. <=100 words.
 */
export function classifyTargetSpeakability(
  answerType: AnswerType,
  answerStyle: AnswerStyle | undefined,
  question: string,
): SpeakabilityTarget {
  const q = question || '';
  // Structured output (not a spoken paragraph) → uncapped.
  if (STRUCTURED_FULL_TYPES.has(answerType)) return 'STRUCTURED_FULL';
  if (answerStyle && STRUCTURED_FULL_STYLES.has(answerStyle)) return 'STRUCTURED_FULL';
  if (DETAIL_REQUEST_RE.test(q)) return 'STRUCTURED_FULL';

  // Fuller spoken answer needed for reliability/safety → SPOKEN_FULL.
  if (SPOKEN_FULL_TYPES.has(answerType)) return 'SPOKEN_FULL';
  // A behavioral interview answer is a STAR story by its nature — the planner only types a
  // question behavioral when it wants a situation/action/result, which never fits a 15s reply.
  // So the TYPE itself is the signal (2026-06-16): no question-wording gate needed.
  if (answerType === 'behavioral_interview_answer') return 'SPOKEN_FULL';
  if (MULTI_PART_REQUEST_RE.test(q)) return 'SPOKEN_FULL';
  // Negotiation can be a quick tactical reply OR a fuller push-back — gate on a pressure cue.
  if (answerType === 'negotiation_answer' && CONTEXTUAL_PRESSURE_RE.test(q)) {
    return 'SPOKEN_FULL';
  }

  return 'SPOKEN_SHORT';
}

// ── Adaptive SPOKEN_SHORT length band (15-30s) ────────────────────────────────
// Most spoken answers should NOT default to ~30s. Within SPOKEN_SHORT (still <=100 words),
// pick a 15-30s band from the question's intent so a yes/no or factual question lands ~15s
// and a normal interview/concept answer lands ~20-25s. This is PROMPT-GUIDANCE only — the
// deterministic trimmer is unchanged (only the 100-word ceiling is hard-enforced). The model
// gauges WITHIN the band using the meeting context it already has in the prompt.
//
// At ~140 wpm: 15s≈35 words, 20s≈47, 25s≈58, 30s≈70.
export type ShortLengthBand = 'BRIEF' | 'STANDARD' | 'FULLER';

export interface ShortBandTarget {
  /** Lower word target for the band. */ min: number;
  /** Upper word target for the band (always <= SOFT_MAX_WORDS). */ max: number;
  /** Approximate spoken seconds at ~140 wpm. */ seconds: number;
  /** One-line guidance appended to the prompt's length directive. */ guidance: string;
}

const SHORT_BAND_TARGETS: Record<ShortLengthBand, ShortBandTarget> = {
  BRIEF:    { min: 25, max: 40, seconds: 15, guidance: 'a tight, direct answer — lead with the point and stop' },
  STANDARD: { min: 40, max: 60, seconds: 22, guidance: 'a normal spoken answer — the point plus one supporting line' },
  FULLER:   { min: 55, max: 85, seconds: 30, guidance: 'a slightly fuller answer — the point, a reason, and one concrete detail' },
};

/** Target words/seconds for a SPOKEN_SHORT band. All maxes stay within SOFT_MAX_WORDS (85). */
export function shortBandTargetWords(band: ShortLengthBand): ShortBandTarget {
  return SHORT_BAND_TARGETS[band];
}

// BRIEF signals: the question is answered in a sentence or two — yes/no, a bare factual recall,
// a definition ("what is X"), or a quick acknowledgement/clarification.
const BRIEF_QUESTION_RE =
  /^\s*(?:do|does|did|is|are|was|were|can|could|would|will|should|have|has|had|am)\b/i // yes/no openers
  ;
// Single-fact lookups (a name/number/date/place). Deliberately EXCLUDES "what are your …"
// (e.g. "what are your main skills" is a normal STANDARD answer, not a one-liner).
const FACTUAL_LOOKUP_RE =
  /\b(?:which|who(?:'s| is| are)|when(?:'s| is)|where(?:'s| is)|how many|how much|how long|how old)\b/i;
// A bare definition: "what is X" / "what's X" / "what is a hash map" — the noun phrase (up to
// ~3 short tokens) and nothing else trailing.
const DEFINITION_RE = /\bwhat(?:'s| is)\s+(?:a |an |the )?(?:[\w-]+\s+){0,2}[\w-]+\??\s*$/i;
// A POSSESSIVE self-reflection question ("what is your biggest weakness", "what's your
// management style") is NOT a definition — it's a classic interview question that needs a point
// plus a mitigation/example (~STANDARD), so exclude it from BRIEF (code-review HIGH 2026-06-16).
// Covers both "what is your" and "what are your".
const POSSESSIVE_WHAT_RE = /\bwhat(?:'s| is| are)\s+(?:your|my|our|their|his|her|its)\b/i;
// A behavioral story/recall cue. A yes/no question carrying one of these ("Did you EVER…",
// "…and what happened?") needs a 3-4 sentence story, so it must NOT collapse to BRIEF.
const STORY_OPENER_RE = /\b(?:ever|time\s+(?:you|when)|tell\s+me\s+about|describe\s+a|what\s+happened|walk\s+me\s+through\s+a)\b/i;

// FULLER signals: the question invites a touch more REASONING depth — "how would you approach",
// a comparison/choice rationale ("why X over Y"), an opinion/take, or "walk me through your
// thinking". A bare "why" (e.g. "why should we hire you", "why this role") is a STANDARD answer,
// NOT the maximum — only escalate "why" when it asks to weigh a choice ("why X over/instead of/
// rather than Y", "why not Z"). Behavioral STAR stories are SPOKEN_FULL, handled upstream.
const FULLER_QUESTION_RE =
  /\bhow\s+would\s+you\b|\bhow\s+do\s+you\s+(?:approach|decide|handle|think\s+about)\b|\bwhat(?:'s| is)\s+your\s+(?:take|view|opinion|approach|reasoning)\b|\bwhat\s+do\s+you\s+think\b|\bwalk\s+me\s+through\s+(?:your\s+)?(?:thinking|approach|reasoning)\b|\btalk\s+me\s+through\b|\bwhy\b[^?]*\b(?:over|instead\s+of|rather\s+than|versus|vs\.?|not)\b/i;

/**
 * Choose the SPOKEN_SHORT length band from the question's intent. Signal-based (NOT a closed
 * per-question list) — the principle is "pick the shortest length that fully answers": a yes/no
 * or factual/definition question is BRIEF (~15s), a reasoning/opinion question is FULLER (~30s),
 * and everything else is the STANDARD ~20-25s default. Only meaningful when the tier is
 * SPOKEN_SHORT; callers gate on that. `answerStyle` brevity cues win when present.
 */
export function classifyShortBand(
  answerType: AnswerType,
  answerStyle: AnswerStyle | undefined,
  question: string,
): ShortLengthBand {
  // Explicit brevity cues already detected upstream take precedence.
  if (answerStyle === 'one_liner' || answerStyle === 'short' || answerStyle === 'beginner') return 'BRIEF';

  const q = (question || '').trim();
  if (!q) return 'STANDARD';

  // A short factual/yes-no/definition question → BRIEF. Guard on length so a long, qualified
  // question that merely starts with "is"/"what" isn't forced brief. A yes/no opener that
  // ALSO carries a story/recall cue ("Did you EVER…", "…and what happened?") is a behavioral
  // story, not a one-liner — exclude it from BRIEF (code-review MEDIUM 2026-06-16). (Behavioral-
  // typed questions are already diverted to SPOKEN_FULL upstream; this covers the case where a
  // story question lands on a non-behavioral answerType.)
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  const looksBrief =
    (
      (BRIEF_QUESTION_RE.test(q) && wordCount <= 14) ||
      (DEFINITION_RE.test(q) && !POSSESSIVE_WHAT_RE.test(q)) ||
      (FACTUAL_LOOKUP_RE.test(q) && wordCount <= 9)
    ) && !STORY_OPENER_RE.test(q);
  // A reasoning / opinion / "how would you" question → FULLER (still SPOKEN_SHORT).
  const looksFuller = FULLER_QUESTION_RE.test(q);

  // FULLER wins over BRIEF when both somehow match (a "why is X..." reasoning question).
  if (looksFuller) return 'FULLER';
  if (looksBrief) return 'BRIEF';
  return 'STANDARD';
}

/**
 * Classify a spoken answer's length tier and whether the deterministic trimmer may touch it.
 *
 * The tier (classifyTargetSpeakability) decides everything:
 *   - STRUCTURED_FULL / SPOKEN_FULL → `exception` (never trimmed). SPOKEN_FULL's ~180-word
 *     ceiling is PROMPT-ONLY (user-confirmed "soft 180, never trim"): the trimmer leaves a
 *     nuanced negotiation/ethical/tradeoff answer whole rather than risk a mid-thought cut.
 *   - SPOKEN_SHORT → trimmable above the 100-word / 35s ceiling.
 *
 * `isCoding` forces STRUCTURED_FULL when the caller already knows the answer is code, and a
 * fenced code block in `text` does the same (defence in depth — code is never spoken prose).
 */
export function decideSpeakability(
  text: string,
  answerType: AnswerType,
  answerStyle: AnswerStyle | undefined,
  question: string,
  isCoding = false,
): SpeakabilityDecision {
  const wordCount = countSpokenWordsExcludingCode(text);
  const seconds = estimateSpeakSeconds(text);

  // A code-bearing answer is always STRUCTURED_FULL regardless of the classifier inputs.
  const codeBearing = isCoding || HAS_FENCE_RE.test(text || '');
  const target: SpeakabilityTarget = codeBearing
    ? 'STRUCTURED_FULL'
    : classifyTargetSpeakability(answerType, answerStyle, question);

  // SPOKEN_FULL and STRUCTURED_FULL are both "never trim". Only SPOKEN_SHORT is enforced.
  const exception = target !== 'SPOKEN_SHORT';
  // The reason carries the tier PLUS the specific cause, for telemetry/debugging:
  //   "target:STRUCTURED_FULL:is_coding" / ":contains_code_block" / ":answer_type:lecture_answer"
  //   / ":answer_style:detailed" / ":detail_requested"; "target:SPOKEN_FULL" for the spoken tier.
  let exceptionReason = '';
  if (exception) {
    let cause = '';
    if (isCoding) cause = ':is_coding';
    else if (HAS_FENCE_RE.test(text || '')) cause = ':contains_code_block';
    else if (STRUCTURED_FULL_TYPES.has(answerType)) cause = `:answer_type:${answerType}`;
    else if (answerStyle && STRUCTURED_FULL_STYLES.has(answerStyle)) cause = `:answer_style:${answerStyle}`;
    else if (DETAIL_REQUEST_RE.test(question || '')) cause = ':detail_requested';
    exceptionReason = `target:${target}${cause}`;
  }

  const overSoftTarget = wordCount > SOFT_MAX_WORDS;
  const overBudget = target === 'SPOKEN_SHORT' && (wordCount > HARD_MAX_WORDS || seconds > HARD_MAX_SECONDS);

  return { wordCount, seconds, target, overBudget, overSoftTarget, exception, exceptionReason };
}

// ── (removed) deterministic tail-trimmer ─────────────────────────────────────
// REMOVED 2026-06-16 (user decision). It dropped whole tail sentences from an over-100-word
// SPOKEN_SHORT answer to force it under the cap. But a spoken answer's CONCLUSION usually lives
// in the last sentence ("...so I'd be productive within a couple of weeks"), so cutting the tail
// silently amputated the most important half of the answer. Length is now entirely the model's
// job (the prompt's 15-30s band + the SPOKEN_SHORT/FULL/STRUCTURED tiers); no deterministic pass
// ever cuts a response. There is NO hard length cap on output — a longer answer is allowed when
// the question needs it. applySpeakabilityBudget (below) measures only.
export interface TrimResult {
  text: string;
  changed: boolean;
}

/**
 * @deprecated No-op since 2026-06-16. The deterministic trimmer was removed because it cropped
 * the end (the conclusion) off long spoken answers. Always returns the text unchanged. Retained
 * only so existing imports resolve; new code should not call it. Length is controlled by the
 * prompt, not by trimming.
 */
export function trimToSpeakable(text: string, _decision: SpeakabilityDecision): TrimResult {
  return { text, changed: false };
}

// ── Generic technical-concept brevity post-check ──────────────────────────────

/** A long analogy sentence ("Think of it like…", "It's similar to…"). */
const ANALOGY_RE = /\b(?:think\s+of\s+it\s+(?:like|as)|imagine\s+(?:a|an|that)|it'?s\s+(?:like|similar\s+to)|picture\s+(?:a|an|this)|analogy)\b/i;

/**
 * Split prose into sentences keeping terminal punctuation. A `.`/`!`/`?` is a sentence end
 * ONLY when it is NOT inside a dotted technical token ("Node.js", ".NET"), a decimal ("3.14"),
 * a version ("v2.0"), or a glob ("*.ts") — i.e. the terminator must be followed by whitespace
 * then a capital/quote/digit, or end-of-string. This matters because this helper feeds the
 * technical-concept compressor, where dotted tokens are everyday vocabulary (code-review HIGH
 * 2026-06-16: the old `.match()` splitter turned "Node.js" into "Node. js").
 */
function splitProseSentences(text: string): string[] {
  const out: string[] = [];
  // A real sentence boundary: terminator(s) + optional closing quote/bracket, then either
  // whitespace followed by a sentence-starting char, or end of string. A `.` flanked by word
  // chars or digits (Node.js, 3.14) does NOT match because what follows is a lowercase letter
  // with no intervening space.
  const BOUNDARY = /([.!?]+["')\]]*)(\s+(?=["'(]?[A-Z0-9])|\s*$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = BOUNDARY.exec(text)) !== null) {
    const end = m.index + m[1].length;
    const piece = text.slice(last, end).trim();
    if (piece) out.push(piece);
    last = BOUNDARY.lastIndex;
    if (last <= m.index) BOUNDARY.lastIndex = m.index + 1; // guard against zero-width loops
  }
  const tail = text.slice(last).trim();
  if (tail) out.push(tail);
  return out.length ? out : (text.trim() ? [text.trim()] : []);
}

/**
 * FLATTEN a generic technical-concept answer out of doc-shape into one spoken paragraph (user
 * decision 2026-06-16: "flatten only, NO cap"). Small models ignore the "be brief" prompt for
 * generic concepts ("what is CORS?") and emit doc-style tutorials (## headers, bullet lists,
 * tables, an embedded code example). This strips that STRUCTURE so the answer reads like
 * something a person says aloud — but it NEVER truncates: all the prose content is kept, just
 * reshaped. Length is the prompt's job (the blunt no-tutorial template). Consistent with the
 * project-wide rule that no answer of any type is ever cut.
 *   - Drops fenced code blocks (a code example is never spoken; real coding answers are a
 *     different answerType this never runs on).
 *   - Flattens ATX/bold headers, bullet/numbered list markers, and table rows to prose.
 *   - Drops a long analogy sentence UNLESS `simpleRequested` (the user asked for simple terms).
 * Conservative: only meaningful changes flip `changed`; a clean prose answer comes back untouched.
 */
export function compressTechnicalConcept(
  text: string,
  simpleRequested: boolean,
): { text: string; changed: boolean } {
  if (!text) return { text, changed: false };
  let out = text;

  // 1. Drop fenced code blocks — a code example in a SPOKEN concept answer is never spoken.
  //    Closed fences first, then a trailing UNCLOSED fence (a truncated tutorial code block).
  out = out.replace(/```[\s\S]*?```/g, ' ').replace(/```[\s\S]*$/g, ' ');

  // 2. Flatten ALL remaining markdown structure to prose, line by line.
  out = out
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+.+?[ \t]*$/gm, '')                            // ATX header → DROP (a label, not prose)
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/gm, '') // table separator rows
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, cells) => String(cells).split('|').map((c) => c.trim()).filter(Boolean).join(', ') + '.') // table data rows → prose
    .replace(/^[ \t]*\*\*([^*\n]{1,60}?):\*\*[ \t]*/gm, '$1: ')                    // bold pseudo-header → plain label
    .replace(/^[ \t]*\*\*([^*\n]{1,60}?)\*\*[ \t]*:?[ \t]*$/gm, '$1: ')            // standalone bold heading line
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')                                         // numbered list markers
    .replace(/^[ \t]*[-*•+][ \t]+/gm, '');                                         // bullet markers
  // Strip remaining inline emphasis markers (bold/italic) — they read as doc formatting.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1');
  // Collapse the now-blank lines into one flowing paragraph.
  out = out.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  out = out.replace(/\s+([.,])/g, '$1').replace(/\.{2,}/g, '.').trim();

  // 3. Drop a long analogy sentence unless the user asked for simple terms. (Style cleanup, not
  //    a length cap — it removes a padding analogy, never real content.) NO length cap: the
  //    whole flattened answer is kept.
  if (!simpleRequested && ANALOGY_RE.test(out)) {
    const sentences = splitProseSentences(out);
    const kept = sentences.filter((s) => !ANALOGY_RE.test(s) || s.trim().split(/\s+/).length <= 12);
    if (kept.length >= 1 && kept.length < sentences.length) {
      out = kept.join(' ').replace(/\s+/g, ' ').trim();
    }
  }

  // Guard: never return an empty / trivially short result.
  if (out.length < 20) return { text: text.trim(), changed: false };
  return { text: out, changed: out !== text.trim() };
}

/**
 * MEASURE-ONLY length budget. It NEVER trims the answer (2026-06-16, user decision): a
 * deterministic tail-trim cropped the END of an over-100-word answer, and a spoken answer's
 * conclusion ("...so I'd be productive within a couple of weeks") often lives in the last
 * sentence — dropping it silently mangled the answer. Length is now 100% the model's job via
 * the prompt (the 15-30s band + the SPOKEN_SHORT/FULL/STRUCTURED tiers); nothing here ever cuts
 * a response. This function is retained ONLY to measure the answer for telemetry (word count,
 * seconds, the coarse class) — `text` is returned verbatim and `speakability_budget_applied` is
 * always false, so both call sites (which guard on that flag) become no-ops on the answer text.
 */
export function applySpeakabilityBudget(
  text: string,
  answerType: AnswerType,
  answerStyle: AnswerStyle | undefined,
  question: string,
  isCoding = false,
): {
  text: string;
  changed: boolean;
  spoken_word_count: number;
  estimated_speak_seconds: number;
  /** Always false — the budget no longer trims. Kept for the call sites' guard. */
  speakability_budget_applied: boolean;
  length_exception_reason: string;
  /** Coarse marker for telemetry (spec's speakability_class). No raw content. */
  speakability_class: SpeakabilityClass;
} {
  const decision = decideSpeakability(text, answerType, answerStyle, question, isCoding);
  return {
    text,                                  // verbatim — never trimmed
    changed: false,
    spoken_word_count: decision.wordCount,
    estimated_speak_seconds: decision.seconds,
    speakability_budget_applied: false,    // measure-only
    length_exception_reason: decision.exceptionReason,
    speakability_class: classifySpeakability(decision),
  };
}
