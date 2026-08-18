// electron/llm/questionShapes.ts
//
// SHARED question-shape patterns (WTA audit, 2026-08-18). These regexes were
// duplicated between transcriptQuestionExtractor.ts (the live selector) and
// questionLedger.ts (the shadow state model), and the audit repeatedly
// flagged copy drift as a hazard — the extractor/ledger MUST agree on what
// counts as small talk, a pause request, or an unpunctuated interrogative,
// or shadow parity numbers measure regex skew instead of architecture.
// Single source of truth; both consumers import from here. The Phase-3 E/I
// segmenter eventually replaces the lot.

/** Social-pleasantry chit-chat that is question-shaped but not a substantive
 *  ask ("did you have any trouble finding parking?", "how was your weekend?").
 *  Anchored on the social TOPIC so a real question containing the word (e.g.
 *  "how did you architect the parking-lot allocation service?") is unaffected. */
export const SOCIAL_PLEASANTRY = /\b(trouble |any (trouble|problem)s? )?(finding|find) (the office|us|parking|the parking|your way|this place|the building)\b|\bfind (us|the office|parking|the building|your way|this place)\s+(ok(ay)?|alright|all right)\b|\bhow (was|is|'?s) your (weekend|day|morning|week|commute|drive|trip|flight)\b|\bhow (are|'?re) you (doing|feeling|holding up)\b|\bhow'?s the weather\b|\bdid you (get|grab|have) (any |some )?(coffee|water|tea|lunch)\b|\b(traffic|parking|weather|commute) (was|is|been)\b|\bhow was the (traffic|commute|drive|trip|flight|parking)\b/i;

/** Wait/hold idioms — pause REQUESTS, not asks ("give me one second", "bear
 *  with me"). The lookahead keeps "give me a second OPINION/chance/example…"
 *  out of the idiom. */
export const WAIT_IDIOM = /\b(give (me|us) (a|one|two|just a) (sec(ond)?s?|minutes?|moments?|mins?)\b(?!\s+(opinion|chance|example|reason|thought|look))|bear with me|hold on a (sec(ond)?|minute|moment)|one (moment|sec(ond)?),? please)\b/i;

// ── Clause-level interrogatives for UNPUNCTUATED providers (F9/Phase 3) ─────
// With no '?'/comma from the STT provider, a prefix clause hides the wh/aux
// lead mid-string ("just to confirm what should i call you"). Consulted ONLY
// when the turn's punctuationSource === 'unavailable' — on punctuating
// providers, missing punctuation stays real negative evidence.

/** wh-word + auxiliary/degree word anywhere in the turn ("how strong is",
 *  "what should i", "how ready are", "why did you"). */
export const CLAUSE_INTERROGATIVE = /\b(what|why|how|when|where|which|who|whose|whom)\s+(should|would|could|can|do|did|does|is|are|was|were|am|have|has|had|will|many|much|long|soon|often|strong|ready|good|comfortable|confident|familiar|experienced|about)\b/i;

/** auxiliary + second person anywhere ("can you", "did you", "are you"). */
export const AUX_SECOND_PERSON = /\b(can|could|would|will|do|did|does|are|were|have|has)\s+you\b/i;

/** trailing wh-fragment: why/what-about + a 1-2 word object at the very END
 *  ("…engineering-heavy why data"). */
export const TRAILING_WH_FRAGMENT = /\b(why|what about|how about)\s+[\w'-]+( [\w'-]+)?$/i;

/** bare topic-shift fragment ("and sql", "and python frameworks") — "and" is
 *  too common for an anywhere rule, so callers must ALSO require the whole
 *  turn be the fragment (≤4 words). */
export const SHORT_TOPIC_SHIFT = /^and\s+[\w'-]+( [\w'-]+){0,2}$/i;
