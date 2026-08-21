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

// ── Core ask shapes + confidence (unified by code review 2026-08-19) ────────
// These three regexes and the score table below were duplicated between the
// live extractor and the shadow ledger, and had already drifted: the ledger
// scored a bare '?' 0.85 vs the extractor's 0.8, treated UNKNOWN punctuation
// provenance as 'unavailable' (0.95 vs 0.8), and its lead alternation was
// missing the tell-me/walk-me/describe family the extractor folds in. Because
// askShape confidence feeds rankActiveAsks, and the ledger_parity /
// ledger_divergence telemetry is the stated evidence for promoting the ledger,
// that skew meant the promotion metric was partly measuring copy drift instead
// of the architectures it is supposed to compare. One definition, one table.

/** Terminal/inline question mark. */
export const QUESTION_MARK = /\?/;

/**
 * Interrogative lead in CLAUSE-INITIAL position: a wh-word, an auxiliary, or
 * the "tell me about…" family that opens an ask without one. ^-anchored on
 * purpose — it feeds confidence scoring, so a mid-sentence "what" ("tell me
 * WHAT you did") must not read as a fresh interrogative.
 *
 * NOTE: deliberately NOT `INTERROGATIVE_LEAD_CORE ∪ IMPERATIVE_ASK` — the
 * imperative family here omits "show me", which IMPERATIVE_ASK includes. That
 * asymmetry is the live extractor's long-standing behaviour and is preserved
 * verbatim; folding "show me" in would silently re-score every "show me your…"
 * turn. Keep the two lists in this file so any future change is visible.
 */
export const INTERROGATIVE_LEAD =
  /^(\s*)(what|who|why|where|when|which|how|whose|whom|can|could|would|will|do|did|does|are|is|were|was|have|has|had|tell me|walk me|describe|explain|give me|share|let'?s talk about|talk about|i'?d like to (hear|know)|i want to (hear|know))\b/i;

/** The "tell me about…" family, matched ANYWHERE — an imperative ask that may
 *  sit after a discourse prefix. Superset of the lead's imperative alternates
 *  (it also carries "show me"). */
export const IMPERATIVE_ASK =
  /\b(tell me|walk me|describe|explain|give me|show me|share|talk about|let'?s talk about|i'?d like to (hear|know)|i want to (hear|know))\b/i;

/**
 * The single ask-confidence table, shared by the live extractor and the shadow
 * ledger.
 *
 * Punctuation provenance (F9) is honoured exactly one way: a missing '?' is
 * real negative evidence only when the provider GUARANTEES punctuation, and
 * "guaranteed" means the source is explicitly `unavailable` or not. An UNKNOWN
 * provenance is treated as punctuating (the conservative reading), matching the
 * live extractor and the ledger's own clause-recovery gate — which already
 * required an explicit 'unavailable' while its scoring did not.
 *
 * Covers ONLY the mark/lead core — the part both callers genuinely share.
 * Returns null when neither signal is present, because the tails legitimately
 * differ (the extractor falls back to a 0.4 baseline plus a clause-interrogative
 * recovery branch; the ledger falls back to an imperative-ask score). Unifying
 * those would be a false equivalence, so each caller keeps its own.
 */
export function scoreAskShape(input: {
  hasMark: boolean;
  hasLead: boolean;
  punctuationSource: string | undefined;
}): number | null {
  const punctuationUnavailable = input.punctuationSource === 'unavailable';
  if (input.hasMark && input.hasLead) return 0.95;
  if (input.hasLead && punctuationUnavailable) return 0.95;
  if (input.hasMark || input.hasLead) return 0.8;
  return null;
}

/** Social-pleasantry chit-chat that is question-shaped but not a substantive
 *  ask ("did you have any trouble finding parking?", "how was your weekend?").
 *  CONTRACTIONS matter: live session A spoke "How's your day going so far?" and
 *  the un-contracted `how (was|is) your` alternation could not match it (it
 *  required a space before the copula), so the cap never applied and the
 *  pleasantry scored 0.95 — clearing both live gates.
 *  Anchored on the social TOPIC so a real question containing the word (e.g.
 *  "how did you architect the parking-lot allocation service?") is unaffected. */
export const SOCIAL_PLEASANTRY = /\b(trouble |any (trouble|problem)s? )?(finding|find) (the office|us|parking|the parking|your way|this place|the building)\b|\bfind (us|the office|parking|the building|your way|this place)\s+(ok(ay)?|alright|all right)\b|\bhow(?:\s+(?:was|is)|\s*['’]?s)\s+your\s+(weekend|day|morning|week|commute|drive|trip|flight)\b|\bhow(?:\s+are|\s*['’]?re)\s+you\s+(doing|feeling|holding up)\b|\bhow'?s the weather\b|\bdid you (get|grab|have) (any |some )?(coffee|water|tea|lunch)\b|\b(traffic|parking|weather|commute) (was|is|been)\b|\bhow was the (traffic|commute|drive|trip|flight|parking)\b/i;

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

/**
 * wh-word + a NOUN + auxiliary — the shape CLAUSE_INTERROGATIVE misses because
 * an object sits between the wh-word and the verb ("What DATABASE is under
 * it?", "Which APPROACH would you take?"). Live session A produced exactly
 * this on an unpunctuated turn ("…more basic question first What database is
 * under it") which scored 0.3 and lost profile grounding.
 *
 * Like its siblings this is consulted ONLY when punctuationSource is
 * 'unavailable', where a missing '?' carries no evidential weight — the same
 * pattern inside a punctuated statement ("I know what database is under it")
 * keeps its terminal '.' and is judged on that.
 */
export const WH_NOUN_AUX = /\b(what|which|whose)\s+[\w'-]+\s+(is|are|was|were|do|did|does|will|would|should|can|could|has|have|had)\b/i;

/**
 * Task directives — imperative-mood asks that carry no '?', no clause-initial
 * wh/aux lead, and no member of the tell-me IMPERATIVE_ASK family: "Rate your
 * SQL out of ten", "Convince me you're right for this role", "Solve two sum".
 *
 * Anchored to the clause START (imperative position), a comma boundary
 * ("…this is a data analyst role, connect it for me") or a SENTENCE boundary
 * ("Let's do a quick exercise, nothing scary. Solve two sum.") so declarative
 * uses of the same verbs ("We DESIGN for scale", "our team SOLVES these
 * problems") do not match.
 *
 * Provenance-independent by design: an imperative directive is imperative
 * whether or not the provider punctuates, so unlike the clause-recovery
 * patterns above this one is consulted unconditionally. Shared because the
 * shadow ledger found the gap first (9 of 10 of its no-ask windows) and live
 * session A then proved the live extractor had the identical hole.
 */
export const TASK_DIRECTIVE = /(?:^|[,.!?]\s*)(?:(?:ok(?:ay)?|so|now|next|alright|great|please)[,.!]?\s+)*(?:please\s+)?(solve|write|implement|rate|rank|convince|design|build|debug|code|optimi[sz]e|refactor|estimate|compare|sketch|whiteboard|connect|reverse|check|find|print|sort)\b/i;

/** auxiliary + second person anywhere ("can you", "did you", "are you"). */
export const AUX_SECOND_PERSON = /\b(can|could|would|will|do|did|does|are|were|have|has)\s+you\b/i;

/** trailing wh-fragment: why/what-about + a 1-2 word object at the very END
 *  ("…engineering-heavy why data"). */
export const TRAILING_WH_FRAGMENT = /\b(why|what about|how about)\s+[\w'-]+( [\w'-]+)?$/i;

/** bare topic-shift fragment ("and sql", "and python frameworks") — "and" is
 *  too common for an anywhere rule, so callers must ALSO require the whole
 *  turn be the fragment (≤4 words). */
export const SHORT_TOPIC_SHIFT = /^and\s+[\w'-]+( [\w'-]+){0,2}$/i;
