// electron/services/knowledge/OkfExtractor.ts
//
// OKF Phase 2 — deterministic (no-LLM) extraction of section + concept +
// entity cards from a reference file's Document Map. Heuristic v1 per the
// migration plan: every real section becomes a card; capitalized/acronym
// phrases repeated across sections become entity cards. No LLM call —
// extraction must work even when every provider is unavailable.

import { buildDocumentMap, type DocumentMap, type DocumentSection } from '../modes/DocumentMap';
import { slugify, uniqueSlug, conceptIdFor } from './OkfSlugger';
import type { KnowledgeCard, KnowledgeCardType, KnowledgeEntity, KnowledgeEntityType } from './types';

const MAX_BODY_WORDS = 420;
const MAX_QUOTE_CHARS = 280;
const MAX_ENTITIES_PER_PACK = 100;

/** Capitalized multi-word phrases and ALLCAPS/MixedCase acronym-style tokens (OpenVLA-OFT, AutoGen, RLDS, VLA). */
const ENTITY_CANDIDATE_RE = /\b(?:[A-Z][a-z0-9]+(?:[-\s][A-Z][A-Za-z0-9]+){1,3}|[A-Z][a-zA-Z]*[A-Z][a-zA-Z0-9-]*|[A-Z]{2,6})\b/g;

const ENTITY_STOPLIST = new Set([
  'The', 'This', 'That', 'These', 'Those', 'It', 'In', 'On', 'At', 'For', 'With', 'From',
  'Figure', 'Table', 'Section', 'Chapter', 'Abstract', 'Introduction', 'Conclusion', 'References',
]);

function classifySectionType(heading: string, depth: number): KnowledgeCardType {
  const h = heading.toLowerCase();
  if (/abstract/.test(h)) return 'section';
  if (/conclusion|future work/.test(h)) return 'conclusion';
  if (/result|evaluation|benchmark|experiment/.test(h)) return 'result';
  if (/method|approach|implementation|design/.test(h)) return 'methodology';
  if (/definition|what is/.test(h)) return 'definition';
  return depth >= 2 ? 'concept' : 'section';
}

function truncateToWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ').trim() + '…';
}

/**
 * KNOWN LIMITATION (flagged in senior review, 2026-07-01): this always
 * samples from the START of the section body, independent of where
 * `truncateToWords`'s MAX_BODY_WORDS cutoff lands. For a section longer
 * than MAX_BODY_WORDS, any content past the truncation point is invisible
 * to BOTH the served card body and its self-citing quote — a card can be
 * generated whose title suggests full section coverage but whose actual
 * content structurally favors whatever appears first. Not fixed here: doing
 * so well (e.g. selecting a quote near high-signal terms rather than always
 * the opening) is a real behavior change to a working extraction pipeline
 * (50/51 real thesis cards currently pass OkfVerifier) and risks quote-
 * quality regressions without a corresponding benchmark to validate
 * against. Acceptable for heuristic v1 — the served body/quote should be
 * read as "the first part of this section," not "an exhaustive summary."
 */
function firstSentences(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (lastStop > 40 ? cut.slice(0, lastStop + 1) : cut).trim();
}

function extractEntityCandidates(text: string): string[] {
  const matches = text.match(ENTITY_CANDIDATE_RE) || [];
  const out = new Set<string>();
  for (const m of matches) {
    const t = m.trim();
    if (t.length < 2 || t.length > 40) continue;
    if (ENTITY_STOPLIST.has(t)) continue;
    out.add(t);
  }
  return [...out];
}

function inferEntityType(name: string): KnowledgeEntityType {
  if (/^[A-Z]{2,6}$/.test(name)) return 'concept'; // bare acronym (VLA, AGI, MSE)
  if (/model|net|vla/i.test(name)) return 'model';
  if (/framework|autogen|ros|unity/i.test(name)) return 'tool';
  if (/dataset|rlds/i.test(name)) return 'dataset';
  return 'other';
}

export interface ExtractedSectionCard {
  section: DocumentSection;
  type: KnowledgeCardType;
  title: string;
  body: string;
  quoteText: string;
  entities: string[];
}

/**
 * Step 4+5 of the ingestion pipeline (migration-plan naming): parse the
 * Document Map's sections into card drafts. Skips the bare "Preamble"
 * section (no num) since it rarely carries citable content; the Abstract is
 * usually its own numbered or title-detected section.
 */
export function parseToSections(map: DocumentMap): ExtractedSectionCard[] {
  const out: ExtractedSectionCard[] = [];
  for (const section of map.sections) {
    const body = section.body.trim();
    if (!body) continue;
    // Preamble (no section number) — only keep if it looks like a real
    // abstract/title page (has enough content), not boilerplate.
    if (!section.num && body.length < 200) continue;

    const title = section.num
      ? section.heading.replace(/^\d+(?:\.\d+)*\s+/, '').trim()
      : (section.heading === 'Preamble' ? 'Abstract' : section.heading);
    const type = classifySectionType(section.heading, section.depth);
    const truncatedBody = truncateToWords(body, MAX_BODY_WORDS);
    const quoteText = firstSentences(body, MAX_QUOTE_CHARS);
    const entities = extractEntityCandidates(body).slice(0, 12);

    out.push({ section, type, title, body: truncatedBody, quoteText, entities });
  }
  return out;
}

export interface BuiltCardDraft {
  type: KnowledgeCardType;
  title: string;
  slug: string;
  conceptId: string;
  body: string;
  sourcePages: number[];
  sourceSections: string[];
  sourceQuotes: Array<{ text: string; page: number; section?: string }>;
  entities: string[];
}

/** Step 5: turn section drafts into card drafts with stable slugs/conceptIds. */
export function extractConceptCards(sections: ExtractedSectionCard[], bundleDir: string): BuiltCardDraft[] {
  const takenSlugs = new Set<string>();
  const out: BuiltCardDraft[] = [];
  for (const s of sections) {
    const slug = uniqueSlug(s.title, takenSlugs);
    const conceptId = conceptIdFor(bundleDir, slug);
    out.push({
      type: s.type,
      title: s.title,
      slug,
      conceptId,
      body: s.body,
      sourcePages: s.section.pageStart === s.section.pageEnd ? [s.section.pageStart] : [s.section.pageStart, s.section.pageEnd],
      sourceSections: s.section.num ? [`${s.section.num} ${s.title}`] : [s.title],
      sourceQuotes: [{ text: s.quoteText, page: s.section.pageStart, section: s.section.num || undefined }],
      entities: s.entities,
    });
  }
  return out;
}

export interface BuiltEntityDraft {
  slug: string;
  name: string;
  type: KnowledgeEntityType;
  sourceCardConceptIds: string[];
  sourcePages: number[];
}

/**
 * Step 6: aggregate entities across all card drafts, capped at
 * MAX_ENTITIES_PER_PACK.
 *
 * Dedup key MUST be `slugify(name)` — the same normalization
 * OkfCardBuilder.buildKnowledgeEntities uses to derive each entity's DB
 * primary key (`shortId('ent', packId:slug)`). Deduping here by
 * `name.toLowerCase()` instead (the bug this fixed, 2026-07-01) let two
 * names that are DISTINCT under toLowerCase but collide under slugify
 * (slugify strips a leading stopword like "The " — "Mercury X1" and "The
 * Mercury X1" both slugify to "mercury-x1") survive as two separate
 * BuiltEntityDraft objects here, which then collided on `id` at INSERT time
 * in DatabaseManager.replaceKnowledgeEntities (a bare INSERT with no
 * ON CONFLICT clause), throwing "UNIQUE constraint failed:
 * knowledge_entities.id" and aborting the entire generateForFile call after
 * cards had already committed — entities/relations silently ended up empty
 * for that pack. Repro: "Mercury X1"/"The Mercury X1" and "Meta
 * Quest"/"The Meta Quest" in the real thesis PDF, both collision pairs.
 * Deduping by slug merges them under one canonical entity, matching what
 * the DB layer treats as "the same entity" — the correct fix, since a
 * slug collision on OKF's own Concept-ID scheme means two entity mentions
 * ARE meant to resolve to the same node.
 */
export function extractEntityCards(cards: BuiltCardDraft[]): BuiltEntityDraft[] {
  const bySlug = new Map<string, BuiltEntityDraft>();
  for (const card of cards) {
    for (const name of card.entities) {
      const slug = slugify(name);
      let existing = bySlug.get(slug);
      if (!existing) {
        existing = { slug, name, type: inferEntityType(name), sourceCardConceptIds: [], sourcePages: [] };
        bySlug.set(slug, existing);
      } else if (name.length < existing.name.length) {
        // Prefer the SHORTER surface form as the canonical display name —
        // "Mercury X1" over "The Mercury X1" — since the stripped stopword
        // prefix carries no distinguishing information.
        existing.name = name;
      }
      existing.sourceCardConceptIds.push(card.conceptId);
      existing.sourcePages.push(...card.sourcePages);
    }
  }
  // Only keep entities mentioned by >=1 card (always true here) — sort by
  // mention count descending so the most-referenced entities survive the cap.
  const all = [...bySlug.values()];
  all.sort((a, b) => b.sourceCardConceptIds.length - a.sourceCardConceptIds.length);
  return all.slice(0, MAX_ENTITIES_PER_PACK).map((e) => ({
    ...e,
    sourceCardConceptIds: [...new Set(e.sourceCardConceptIds)],
    sourcePages: [...new Set(e.sourcePages)].sort((a, b) => a - b),
  }));
}

/** Full Phase-2 extraction entry point: PDF content → section drafts → card drafts → entity drafts. */
export function extractFromContent(content: string, bundleDir: string): {
  map: DocumentMap;
  cards: BuiltCardDraft[];
  entities: BuiltEntityDraft[];
} {
  const map = buildDocumentMap(content);
  const sections = parseToSections(map);
  const cards = extractConceptCards(sections, bundleDir);
  const entities = extractEntityCards(cards);
  return { map, cards, entities };
}
