// electron/llm/longRangeTranscriptRecall.ts
//
// Campaign 2 (longsession, 2026-07-16) — fix for forensic-report.md H6.
//
// SessionMemory (SessionMemory.ts / sessionFollowupResolver.ts) only recalls
// EXPLICITLY-NOTED entities: proper nouns extracted by transcriptEntityExtractor
// (projects, companies, people, skills, a small fixed list of CS/algorithm
// TOPIC_RE terms). A free-text incident/story described in prose — "a memory
// leak in a long-running consumer process", "a disagreement about adopting
// GraphQL" — is never captured by that extractor (no CamelCase token, no cued
// proper noun, no skill/topic match), so when a LATER question paraphrases it
// back ("the memory leak you mentioned earlier"), entity-memory recall finds
// nothing and the live 180s answer window has long since evicted the original
// turn. Live-proven on the real MiniMax-M3 backend
// (traces2/forensic-report.md, H6 CONFIRMED): the model either emits an
// honest "the transcript does not contain that story" or — before fix#1 — a
// bare "nothing actionable" sentinel that silently discarded the whole
// response.
//
// This module is the FALLBACK layer: when the deterministic extractor already
// flagged the question as a follow-up (isFollowUp) but SessionMemory's
// entity recall found nothing, do a bounded LEXICAL (no LLM, no embeddings)
// keyword-overlap search over the DURABLE transcript window
// (SessionTracker.getDurableContext — survives the 120s contextItems
// eviction) for the turn(s) that best match the follow-up's own content
// words. If a plausible match is found, return it as a small labeled context
// block the caller can splice into the prompt — real transcript text, never
// a fabricated summary, so R5 (zero-hallucination) is preserved by
// construction: the model either gets the ACTUAL earlier turn or nothing.
//
// Pure + deterministic. No LLM, no I/O, no network. Bounded output (a
// constant char cap) so it can never blow the prompt's token budget.

export interface RecallTurn {
  role: 'interviewer' | 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface LongRangeRecallResult {
  /** The formatted context block to splice into the prompt, or '' if nothing matched. */
  block: string;
  /** How many candidate turns scored above the match threshold (diagnostics only). */
  matchCount: number;
  /** The best-matching turn's age in seconds relative to `nowMs`, or null if no match. */
  bestAgeSeconds: number | null;
}

// Generic stopwords + the follow-up MARKER words themselves (structural, not
// topical — "mentioned"/"earlier"/"going"/"back" appear in the QUESTION
// asking for the recall, not in the ORIGINAL turn being recalled, so they'd
// only add noise to the keyword match). Deliberately generic — NOT tuned to
// any one golden-trace sentence (skeptic-pass finding, 2026-07-16: an earlier
// draft included overfit entries like "cause"/"after"/"finding" that caused
// real, differently-phrased callbacks to silently miss; removed).
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can',
  'that', 'this', 'these', 'those', 'it', 'its', 'you', 'your', 'i', 'we', 'they', 'them',
  'what', 'when', 'where', 'which', 'who', 'why', 'how', 'about', 'with', 'for', 'from',
  'into', 'onto', 'over', 'under', 'again', 'then', 'than', 'there', 'here', 'more', 'most',
  'going', 'back', 'mentioned', 'earlier', 'before', 'said', 'previous',
  // Generic 4-letter filler words (needed now that MIN_KEYWORD_LEN was
  // lowered to 4 to catch real discriminating short words like "leak"/"bug").
  'time', 'took', 'long', 'team', 'ship', 'find', 'root', 'when', 'were',
  'been', 'have', 'that', 'this', 'from', 'with', 'they', 'them', 'what',
  'your', 'came', 'went', 'told', 'gave', 'made', 'kind', 'sort', 'part',
  'good', 'well', 'just', 'like', 'over', 'once', 'each', 'some', 'many',
]);

// Lowered from 5 → 4 (skeptic-pass finding, 2026-07-16): the real
// golden-trace discriminator between two candidate turns was "leak" (4
// chars) — "memory" alone (the only 5+ char overlap) was shared with enough
// unrelated content that requiring MIN_MATCH_SCORE=2 on 5+ char words alone
// under-recalled the correct turn. Widening to 4 chars + the stopword
// additions above keeps common short filler words out while letting real
// short discriminating nouns ("leak", "bug", "outage") count.
const MIN_KEYWORD_LEN = 4;
// Skeptic-pass finding (2026-07-16): a single shared 5+ char word is too weak
// a signal in a topic-diverse transcript — it can surface a WRONG earlier
// turn with high-confidence framing (silent misattribution, not fabrication,
// but still a confidently-wrong answer about the wrong incident). Requiring
// at least 2 overlapping content words is a much stronger signal that the
// SAME topic is being discussed, at the cost of failing safe (empty block →
// the pre-fix honest "I don't have that" behavior) on a genuinely thin
// callback. Fail-safe is the correct tradeoff for R5 (zero-hallucination).
const MIN_MATCH_SCORE = 2;
const MAX_BLOCK_CHARS = 500;
const MAX_MATCHED_TURNS = 2;

// Skeptic-pass finding (2026-07-16, HIGH severity): SessionMemory.recall()
// enforces mode-aware boundaries — e.g. compensation figures are recallable
// ONLY in `negotiation` mode (COMP_KINDS gating in SessionMemory.ts). This
// lexical fallback operates on raw transcript text with no such awareness by
// default, so without an explicit check it could inject a comp/negotiation
// turn into an unrelated technical/coding answer whenever it shares 2+
// keywords — a real, reproduced privacy/correctness regression relative to
// the proven entity-recall path's invariant. Mirror the SAME value-level
// guard SessionMemory.add() uses (electron/llm/SessionMemory.ts) so a
// candidate turn that LOOKS like compensation is excluded unless the
// effective mode is 'negotiation', regardless of keyword score.
const COMP_VALUE_RE = /\b\d{2,3}\s?k\b|\b\d{1,3}\s?(?:lpa|lakh|lakhs)\b|[$£€]\s?\d|\b\d{3,}\s?(?:per|\/)\s?(?:year|yr|annum|month)\b|\b(?:base salary|expected (?:salary|comp|ctc|package)|total comp(?:ensation)?|equity grant|rsus?|signing bonus|ctc)\b/i;

function extractKeywords(text: string): Set<string> {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= MIN_KEYWORD_LEN && !STOPWORDS.has(w));
  return new Set(words);
}

/**
 * Search the DURABLE transcript window for the turn(s) whose content words
 * best overlap with the follow-up question's own content words. Excludes
 * turns already present in the recent/live window (no point re-surfacing
 * content the model can already see) and the question itself.
 *
 * @param latestQuestion The follow-up question to resolve.
 * @param durableTurns The full durable window (SessionTracker.getDurableContext()).
 * @param recentWindowCutoffMs Turns at/after this timestamp are already in the
 *   live answer window — excluded from the search (they're redundant).
 * @param nowMs Current time, for age computation.
 * @param isNegotiationMode Mirrors SessionMemory's comp gate: when false (the
 *   default — every mode except negotiation), any candidate turn whose text
 *   LOOKS like a compensation figure is excluded from recall entirely,
 *   regardless of keyword score. This is NOT a redesign of the mode-boundary
 *   system — it is the same value-level guard SessionMemory.add() already
 *   applies, so a comp turn discussed outside negotiation still cannot leak
 *   into an unrelated technical/coding/general answer via this fallback path
 *   (skeptic-pass finding, 2026-07-16).
 */
export function recallLongRangeContext(
  latestQuestion: string,
  durableTurns: RecallTurn[],
  recentWindowCutoffMs: number,
  nowMs: number,
  isNegotiationMode: boolean = false,
): LongRangeRecallResult {
  const empty: LongRangeRecallResult = { block: '', matchCount: 0, bestAgeSeconds: null };
  const qKeywords = extractKeywords(latestQuestion);
  if (qKeywords.size === 0) return empty;

  const latestLc = (latestQuestion || '').trim().toLowerCase();
  const candidates = (durableTurns || []).filter(t =>
    t.timestamp < recentWindowCutoffMs
    && t.role !== 'assistant'
    && (t.text || '').trim().toLowerCase() !== latestLc
    && (t.text || '').trim().length > 15
    // Comp gate: a candidate turn that looks like a salary/comp figure is
    // never eligible for recall outside negotiation mode, regardless of how
    // well it otherwise matches the question's keywords.
    && (isNegotiationMode || !COMP_VALUE_RE.test(t.text || ''))
  );
  if (candidates.length === 0) return empty;

  const scored = candidates.map(t => {
    const turnKeywords = extractKeywords(t.text);
    let score = 0;
    for (const kw of qKeywords) if (turnKeywords.has(kw)) score++;
    return { turn: t, score };
  }).filter(s => s.score >= MIN_MATCH_SCORE);

  if (scored.length === 0) return empty;

  // Highest score wins; tie-break toward the MOST RECENT match (the active
  // topic is more likely the latest mention of it, mirroring
  // SessionMemory.recall's recency tie-break).
  scored.sort((a, b) => (b.score - a.score) || (b.turn.timestamp - a.turn.timestamp));
  const top = scored.slice(0, MAX_MATCHED_TURNS);

  const lines = top
    .sort((a, b) => a.turn.timestamp - b.turn.timestamp) // chronological for readability
    .map(({ turn }) => {
      const label = turn.role === 'interviewer' ? 'INTERVIEWER' : 'ME';
      return `[${label}]: ${turn.text}`;
    });
  let body = lines.join('\n');
  if (body.length > MAX_BLOCK_CHARS) body = body.slice(0, MAX_BLOCK_CHARS) + '…';

  const block = `<earlier_context note="the interviewer's question refers back to something said earlier in this conversation; this is the most relevant earlier turn found, verbatim">\n${body}\n</earlier_context>`;

  const bestAgeSeconds = Math.max(0, Math.floor((nowMs - top[0].turn.timestamp) / 1000));
  return { block, matchCount: scored.length, bestAgeSeconds };
}
