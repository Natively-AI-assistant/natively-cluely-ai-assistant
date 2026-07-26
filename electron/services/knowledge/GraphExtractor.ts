// electron/services/knowledge/GraphExtractor.ts
//
// OKF Phase 4 — deterministic (no-LLM) relation extraction from OKF cards.
// Official OKF links are plain Markdown links; OKF itself does not require
// typed relationships (see docs/investigations/okf-official-spec-notes.md,
// "Links" section). This module is a Natively EXTENSION on top of that —
// internal typed (subject, predicate, object) triples derived from card
// text, used only to expand retrieval (Phase 4 goal), never to override
// direct card/chunk evidence.
//
// Extraction strategy: pattern-match relation-indicating phrases inside each
// card's body against the OTHER entity names known to the pack (so we never
// invent an entity that isn't already extracted). Every emitted relation
// carries the source card's id + pages + a confidence derived from how
// specific the matched pattern is.

import crypto from 'node:crypto';
import type { KnowledgeCard, KnowledgeEntity, KnowledgeRelation, RelationPredicate } from './types';

function shortId(prefix: string, seed: string): string {
  return `${prefix}_${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}

/**
 * Predicate patterns, ordered most-specific-first (checked in order; first
 * match wins per subject/object pair so "improves over" doesn't also get
 * counted as a generic "uses"). Each pattern captures loosely — the object
 * span is then matched against known entity names (word-boundary,
 * case-insensitive) rather than trusted verbatim, so we never fabricate an
 * entity name from prose.
 */
const RELATION_PATTERNS: Array<{ predicate: RelationPredicate; re: RegExp; confidence: 'high' | 'medium' | 'low' }> = [
  { predicate: 'improves_over', re: /\bimproves?\s+(?:on|over|upon)\b/i, confidence: 'high' },
  { predicate: 'extends', re: /\bextends?\b|\ban improved (?:version|variant) of\b|\bbuilt on top of\b/i, confidence: 'high' },
  { predicate: 'based_on', re: /\bbased on\b|\bbuilt on\b|\bdeveloped from\b/i, confidence: 'high' },
  { predicate: 'implements', re: /\bimplements?\b|\bimplemented (?:using|with)\b/i, confidence: 'medium' },
  // 'uses' and 'evaluates' are downgraded to 'low' confidence (rather than
  // 'medium' like the other patterns) — they are the most generic triggers
  // and, per the negation/proximity guards below, the ones most likely to
  // still produce a coincidental co-occurrence rather than a real relation.
  { predicate: 'uses', re: /\buses?\b|\butiliz(?:es?|ing)\b|\bleverages?\b|\bemploys?\b|\bintegrat(?:es?|ing)\b|\bcombin(?:es?|ing)\b(?:.{0,20}\bwith\b)?/i, confidence: 'low' },
  { predicate: 'is_part_of', re: /\bis (?:a )?(?:part|component|module) of\b|\bwithin the\b/i, confidence: 'medium' },
  { predicate: 'evaluates', re: /\bevaluat(?:es?|ing)\b|\bbenchmarks?\b(?!\s+result)/i, confidence: 'low' },
  { predicate: 'contrasts_with', re: /\bcompared (?:to|with)\b|\bunlike\b|\bin contrast to\b|\bversus\b|\bvs\.?\b/i, confidence: 'medium' },
  { predicate: 'cites', re: /\[\d+\]/, confidence: 'low' },
];

/**
 * Negation/contrast cues that, if found between the subject entity mention
 * and the chosen object entity mention, invalidate an otherwise-matched
 * relation. Catches sentences like "The Mercury X1 team, unrelated to the
 * OpenVLA project, uses a standard laptop..." — without this guard, the
 * generic 'uses' pattern would fire on "uses a standard laptop" and the
 * OpenVLA entity mention earlier in the same sentence would be picked up as
 * a false-positive object, even though the sentence explicitly says the two
 * are unrelated and "uses" refers to something else entirely.
 */
const NEGATION_CUE_RE = /\b(?:unrelated to|not related to|no relation to|nothing to do with|no connection to|not connected to|in no way connected|bears no relationship to|has no bearing on|should not be confused with|independent of|separate from|distinct from|different from|as opposed to|in contrast to|in contrast with|compared to|in comparison to|far removed from|excluding|except for|rather than|instead of|not\b|unlike|without)\b/i;

/** Matches parenthetical/bracketed asides: "(...)" or "[...]" spans, inclusive of the delimiters. */
const PARENTHETICAL_RE = /\([^()]*\)|\[[^[\]]*\]/g;

/** Returns the [start, end) index ranges of every parenthetical aside in the sentence. */
function findParentheticalSpans(sentence: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(PARENTHETICAL_RE);
  while ((m = re.exec(sentence)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

function isInsideAnySpan(index: number, spans: Array<{ start: number; end: number }>): boolean {
  return spans.some((s) => index >= s.start && index < s.end);
}

function findEntitySpans(text: string, entityNames: string[]): Array<{ name: string; index: number }> {
  const spans: Array<{ name: string; index: number }> = [];
  for (const name of entityNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      spans.push({ name, index: m.index });
      if (spans.length > 200) break; // pathological-input guard
    }
  }
  return spans.sort((a, b) => a.index - b.index);
}

/** Returns the index range [start, end) of any negation/contrast cue in the sentence, or null if none. */
function findNegationSpan(sentence: string): { start: number; end: number } | null {
  const m = NEGATION_CUE_RE.exec(sentence);
  if (!m) return null;
  return { start: m.index, end: m.index + m[0].length };
}

/**
 * For each sentence in a card's body, find entity mentions; for each pair of
 * DISTINCT entities in the same sentence, check whether a relation pattern
 * occurs BETWEEN them (subject before predicate before object) with no
 * negation/contrast cue in between. Confidence is set per-pattern in
 * RELATION_PATTERNS ('uses'/'evaluates' — the most generic triggers — are
 * 'low'; specific patterns like 'improves_over'/'extends' are 'high').
 *
 * Proximity + negation guards (fixed 2026-07-01 after a confirmed false
 * positive: "The Mercury X1 team, unrelated to the OpenVLA project, uses a
 * standard laptop... with the OpenVLA researchers" previously produced
 * `Mercury X1 --uses--> OpenVLA`, even though the sentence explicitly says
 * the two are unrelated and "uses" refers to a laptop):
 *   1. The object entity mention must be the CLOSEST entity mention after
 *      the predicate match, not just "any entity mentioned after the
 *      predicate anywhere in the sentence" — bounds how far the pattern can
 *      reach past intervening clauses.
 *   2. If a negation/contrast cue (NEGATION_CUE_RE) appears between the
 *      subject entity's own mention and the object span, the relation is
 *      discarded — the sentence is explicitly disclaiming a connection.
 */
function extractRelationsFromCard(
  card: KnowledgeCard,
  entityNamesExcludingSelf: string[],
): Array<{ predicate: RelationPredicate; objectName: string; confidence: 'high' | 'medium' | 'low'; snippet: string }> {
  const out: Array<{ predicate: RelationPredicate; objectName: string; confidence: 'high' | 'medium' | 'low'; snippet: string }> = [];
  const sentences = card.body.split(/(?<=[.!?])\s+/);
  const escapedTitle = card.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const subjectNameRes = [new RegExp(`\\b${escapedTitle}\\b`, 'i'), ...card.entities.map((e) => new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'))];

  for (const sentence of sentences) {
    const entitySpans = findEntitySpans(sentence, entityNamesExcludingSelf);
    if (entitySpans.length === 0) continue;

    // Locate the subject's own mention (card title or one of its known
    // entity aliases) — needed both to confirm the card IS the subject of
    // this sentence and as the left boundary for the negation-window check.
    let subjectIndex = -1;
    for (const re of subjectNameRes) {
      const m = re.exec(sentence);
      if (m && (subjectIndex === -1 || m.index < subjectIndex)) subjectIndex = m.index;
    }
    if (subjectIndex === -1) continue; // card is not the subject of this sentence — skip

    const negationSpan = findNegationSpan(sentence);
    const parentheticalSpans = findParentheticalSpans(sentence);

    for (const { predicate, re, confidence } of RELATION_PATTERNS) {
      const patMatch = re.exec(sentence);
      if (!patMatch) continue;
      // Object = the CLOSEST distinct entity mention after the predicate
      // match, EXCLUDING entity mentions inside a parenthetical aside —
      // bounds reach across unrelated intervening clauses AND avoids
      // picking up an entity that's only mentioned incidentally for
      // comparison/clarification. Fixed 2026-07-01 after a confirmed
      // false-positive repro: "Mercury X1 extends, in a manner reminiscent
      // of AutoGen (a completely separate agent framework mentioned only
      // for comparison), the core architecture originally introduced by
      // OpenVLA." previously picked AutoGen (closer, but inside an aside
      // discussing something else) instead of OpenVLA (the actual object,
      // farther away) — a silently WRONG high-confidence relation, worse
      // than a missed one since nothing flags it as suspect. Falls back to
      // the closest entity mention anywhere in the sentence (still
      // excluding parentheticals) only when nothing non-parenthetical
      // follows the predicate (e.g. the object precedes the verb, as in
      // passive voice).
      // An entity immediately followed by an opening paren ("AutoGen (a
      // separate framework...)") is the SUBJECT of a parenthetical
      // clarification about itself, not a candidate object — the
      // parenthetical-span exclusion above only catches mentions INSIDE the
      // parens, not the entity name that immediately precedes and
      // introduces them. Both must be excluded for the "X (description)"
      // pattern to be fully handled.
      const precedesParenthetical = (s: { name: string; index: number }) => {
        const afterEnd = s.index + s.name.length;
        const tail = sentence.slice(afterEnd, afterEnd + 3);
        return /^\s*[([]/.test(tail);
      };
      const isRealCandidate = (s: { name: string; index: number }) =>
        s.name.toLowerCase() !== card.title.toLowerCase() && !isInsideAnySpan(s.index, parentheticalSpans) && !precedesParenthetical(s);
      const candidatesAfter = entitySpans.filter((s) => s.index > patMatch.index && isRealCandidate(s));
      const objectSpan = candidatesAfter.length > 0
        ? candidatesAfter.reduce((closest, s) => (s.index < closest.index ? s : closest))
        : entitySpans.filter(isRealCandidate)
            .reduce((closest: { name: string; index: number } | null, s) => (closest === null || Math.abs(s.index - patMatch.index) < Math.abs(closest.index - patMatch.index) ? s : closest), null);
      if (!objectSpan) continue;

      // Negation guard: discard if a negation/contrast cue sits between the
      // subject mention and the object mention (in either order — the cue
      // may precede or follow the predicate).
      //
      // EXCEPTION (senior review MEDIUM, 2026-07-01): several contrast
      // phrases ("compared to", "in contrast to/with", "in comparison to",
      // "unlike") are BOTH negation cues AND the very trigger for the
      // `contrasts_with` predicate. If the negation cue overlaps the
      // predicate match that produced THIS relation, it is the relation
      // signal, not a disclaimer — cancelling on it would make the entire
      // `contrasts_with` predicate class dead (only bare "versus"/"vs" could
      // ever survive). So only treat the cue as negation when it does NOT
      // coincide with the predicate span.
      if (negationSpan) {
        const predStart = patMatch.index;
        const predEnd = patMatch.index + patMatch[0].length;
        const cueCoincidesWithPredicate = negationSpan.start < predEnd && negationSpan.end > predStart;
        if (!cueCoincidesWithPredicate) {
          const lo = Math.min(subjectIndex, objectSpan.index);
          const hi = Math.max(subjectIndex, objectSpan.index);
          if (negationSpan.start >= lo && negationSpan.start <= hi) continue;
        }
      }

      out.push({ predicate, objectName: objectSpan.name, confidence, snippet: sentence.trim().slice(0, 200) });
      break; // one relation per sentence — avoids near-duplicate low-confidence spam
    }
  }
  return out;
}

/**
 * Extract typed relations across an entire pack's cards. Depth is implicitly
 * 1 (direct card → entity mentions) — graph EXPANSION to depth 2 happens at
 * query time in GraphRetriever, not during extraction.
 */
export function extractGraphRelations(cards: KnowledgeCard[], entities: KnowledgeEntity[]): KnowledgeRelation[] {
  const entityByNameLower = new Map(entities.map((e) => [e.name.toLowerCase(), e]));
  const cardByTitleLower = new Map(cards.map((c) => [c.title.toLowerCase(), c]));
  const allEntityNames = entities.map((e) => e.name);
  const nowIso = new Date().toISOString();

  const seen = new Set<string>();
  const relations: KnowledgeRelation[] = [];

  for (const card of cards) {
    const entityNamesExcludingSelf = allEntityNames.filter((n) => n.toLowerCase() !== card.title.toLowerCase());
    const extracted = extractRelationsFromCard(card, entityNamesExcludingSelf);

    for (const rel of extracted) {
      const objectEntity = entityByNameLower.get(rel.objectName.toLowerCase());
      const objectCard = cardByTitleLower.get(rel.objectName.toLowerCase());
      // Prefer entity as the object (entities are the durable graph nodes);
      // fall back to a card reference when the object name only matches a
      // card title, not a separately-tracked entity.
      const objectId = objectEntity?.id || objectCard?.id;
      const objectType: 'entity' | 'card' = objectEntity ? 'entity' : 'card';
      if (!objectId) continue;

      const subjectEntity = card.entities.length > 0
        ? entityByNameLower.get(card.entities[0].toLowerCase())
        : undefined;
      const subjectId = subjectEntity?.id || card.id;
      const subjectType: 'entity' | 'card' = subjectEntity ? 'entity' : 'card';

      if (subjectId === objectId) continue; // no self-relations

      const dedupeKey = `${subjectId}|${rel.predicate}|${objectId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      relations.push({
        id: shortId('rel', dedupeKey),
        packId: card.packId,
        subjectId,
        subjectType,
        predicate: rel.predicate,
        objectId,
        objectType,
        sourceCardIds: [card.id],
        sourcePages: card.sourcePages,
        confidence: rel.confidence,
        createdAt: nowIso,
      });
    }
  }

  return relations;
}
