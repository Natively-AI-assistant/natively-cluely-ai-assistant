// electron/services/knowledge/ProfilePackBuilder.ts
//
// OKF Profile Intelligence upgrade (2026-07-02) — the profile analogue of
// KnowledgeManager.generateForFile. Transforms the premium engine's already-
// extracted structured_data (StructuredResume / StructuredJD) + AOT artifacts
// into a persisted OKF Knowledge Pack, reusing the SHARED stack end to end:
//   - ProfileCardTemplates → deterministic card drafts (no LLM)
//   - OkfProfileVerifier    → grounding check (reject fabrication)
//   - OkfCardBuilder.linkRelatedCards → cross-links cards sharing an entity
//   - KnowledgePackStore    → the same knowledge_* tables document packs use
//   - KnowledgeCache        → the same pack/retrieval caches
//
// Privacy: profile packs are PII. Every card is stamped pii=true, and the pack
// hangs off the reserved '__profile_okf__' mode (migration v23) so it can never
// be surfaced by document-grounded retrieval's getPacksByModeId(userModeId).
//
// This module NEVER calls an LLM and NEVER throws to its caller — a generation
// failure returns {status:'failed'} so the premium ingest path can fire it
// fire-and-forget without any risk of failing or slowing the existing ingest.

import crypto from 'node:crypto';
import { isOkfProfilePacksEnabled, isOkfProfileGraphExpansionEnabled } from '../../intelligence/intelligenceFlags';
import { piTelemetry } from '../../llm/piTelemetry';
import { KnowledgePackStore } from './KnowledgePackStore';
import { buildResumeCardDrafts, buildJdCardDrafts, buildArtifactCardDrafts, type ProfileCardDraft } from './ProfileCardTemplates';
import { verifyProfileCards } from './OkfProfileVerifier';
import { linkRelatedCards } from './OkfCardBuilder';
import { extractProfileGraphRelations } from './ProfileGraphExtractor';
import { getCachedPack, setCachedPack, invalidatePackCache } from './KnowledgeCache';
import { DatabaseManager } from '../../db/DatabaseManager';
import type {
  KnowledgeCard, KnowledgeEntity, KnowledgePack, KnowledgeSource, KnowledgeSourceType,
} from './types';

/** The reserved mode every profile pack hangs off (migration v23). Never a user mode. */
export const PROFILE_OKF_MODE_ID = '__profile_okf__';
/**
 * Stable per-doc-type cache key. NOTE: this is ONLY the in-memory KnowledgeCache
 * key — it is NOT written to knowledge_sources.file_id. That column carries an FK
 * to mode_reference_files(id) (enforced at runtime once premium's
 * KnowledgeDatabaseManager sets PRAGMA foreign_keys = ON on the shared
 * connection), and a profile has NO reference-file row, so profile sources store
 * file_id = NULL and are looked up by (mode_id = reserved, type) instead.
 */
export const PROFILE_RESUME_FILE_ID = '__profile_resume__';
export const PROFILE_JD_FILE_ID = '__profile_jd__';

export type ProfileDocKind = 'resume' | 'jd';

export interface ProfileIngestInput {
  kind: ProfileDocKind;
  /**
   * The premium knowledge_documents row id. Reserved/provenance only — it is
   * deliberately NOT part of the content hash (a re-upload mints a new id, which
   * would defeat the unchanged-content short-circuit). Optional.
   */
  docId?: number | string;
  /** The structured_data JSON (StructuredResume or StructuredJD shape). */
  structuredData: any;
  /** Resume-only: precomputed total experience years, for the identity card. */
  totalExperienceYears?: number;
  /** JD-only: precomputed AOT artifacts (any subset present). */
  artifacts?: {
    gapAnalysis?: any;
    negotiationScript?: any;
    mockQuestions?: any;
    cultureMappings?: any;
    intro?: any;
  };
}

export interface ProfilePackResult {
  status: 'generated' | 'skipped_flag_off' | 'skipped_empty' | 'failed';
  pack?: KnowledgePack;
  error?: string;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
function shortId(prefix: string, seed: string): string {
  return `${prefix}_${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}

function sourceTypeFor(kind: ProfileDocKind): KnowledgeSourceType {
  return kind === 'resume' ? 'profile_resume' : 'profile_jd';
}
/** In-memory cache key only — see PROFILE_RESUME_FILE_ID doc. Never written to file_id. */
function cacheKeyFor(kind: ProfileDocKind): string {
  return kind === 'resume' ? PROFILE_RESUME_FILE_ID : PROFILE_JD_FILE_ID;
}

/**
 * The text OkfProfileVerifier grounds cards against — a stable serialization of
 * exactly the fields ProfileCardTemplates reads. Using the same field universe
 * (not a raw JSON.stringify with keys/braces) keeps the token-overlap check
 * meaningful.
 */
function buildSourceText(input: ProfileIngestInput): string {
  const parts: string[] = [];
  const sd = input.structuredData || {};
  if (input.kind === 'resume') {
    const id = sd.identity || {};
    parts.push(id.name, id.summary, id.location, id.email, id.github, id.linkedin);
    for (const e of (sd.experience || [])) {
      parts.push(e?.company, e?.role, e?.start_date, e?.end_date, ...(e?.bullets || []));
    }
    for (const p of (sd.projects || [])) {
      parts.push(p?.name, p?.description, ...(p?.technologies || []));
    }
    for (const ed of (sd.education || [])) {
      parts.push(ed?.institution, ed?.degree, ed?.field, ed?.gpa);
    }
    for (const a of (sd.achievements || [])) parts.push(a?.title, a?.description);
    const skills = sd.skills || {};
    for (const cat of Object.keys(skills)) parts.push(cat, ...(skills[cat] || []));
  } else {
    parts.push(sd.title, sd.company, sd.location, sd.description_summary, sd.level);
    parts.push(...(sd.requirements || []), ...(sd.nice_to_haves || []), ...(sd.responsibilities || []));
    parts.push(...(sd.keywords || []), ...(sd.technologies || []));
  }
  // AOT artifacts ground themselves — append their JSON so artifact cards verify.
  if (input.artifacts) parts.push(JSON.stringify(input.artifacts));
  return parts.filter((x) => typeof x === 'string' && x.trim()).join(' \n ');
}

/** Mint full KnowledgeCards from drafts (ids/checksums/pii), stamping pii=true. */
function cardsFromDrafts(
  drafts: ProfileCardDraft[],
  params: { packId: string; sourceId: string; sourceChecksum: string; nowIso: string },
): KnowledgeCard[] {
  return drafts.map((d) => ({
    id: shortId('pcard', `${params.sourceId}:${d.conceptId}`),
    packId: params.packId,
    sourceId: params.sourceId,
    type: d.type,
    title: d.title,
    slug: d.slug,
    conceptId: d.conceptId,
    body: d.body,
    sourcePages: [] as number[],
    sourceSections: [d.sourceCategory],
    sourceQuotes: d.sourceQuotes,
    entities: d.entities,
    tags: d.tags,
    relatedCardIds: [] as string[],
    confidence: d.confidence,
    generatedFrom: d.generatedFrom,
    sourceChecksum: params.sourceChecksum,
    userEdited: false,
    approvalStatus: 'generated' as const,
    updatedAt: params.nowIso,
    cardVersion: 1,
    pii: true,
  }));
}

function entitiesFromCards(cards: KnowledgeCard[], packId: string, nowIso: string): KnowledgeEntity[] {
  const byName = new Map<string, KnowledgeEntity>();
  for (const card of cards) {
    for (const name of card.entities) {
      const key = name.toLowerCase();
      if (!key) continue;
      const existing = byName.get(key);
      if (existing) {
        if (!existing.sourceCardIds.includes(card.id)) existing.sourceCardIds.push(card.id);
      } else {
        byName.set(key, {
          id: shortId('pent', `${packId}:${key}`),
          packId,
          slug: key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entity',
          name,
          type: 'other',
          aliases: [],
          description: '',
          sourceCardIds: [card.id],
          sourcePages: [],
          firstSeenAt: nowIso,
        });
      }
    }
  }
  return [...byName.values()];
}

export class ProfilePackBuilder {
  private static instance: ProfilePackBuilder | null = null;
  private store: KnowledgePackStore;

  private constructor() {
    this.store = new KnowledgePackStore();
  }
  static getInstance(): ProfilePackBuilder {
    if (!ProfilePackBuilder.instance) ProfilePackBuilder.instance = new ProfilePackBuilder();
    return ProfilePackBuilder.instance;
  }

  /**
   * The persisted profile KnowledgeSource for a doc kind, found by (reserved
   * mode, source type). Profile sources store file_id = NULL (no reference-file
   * FK parent), so they are keyed by mode+type rather than by fileId like
   * document sources.
   */
  private findProfileSource(kind: ProfileDocKind): KnowledgeSource | null {
    const wantType = sourceTypeFor(kind);
    const sources = this.store.getSourcesByModeId(PROFILE_OKF_MODE_ID);
    return sources.find((s) => s.type === wantType) || null;
  }

  /**
   * Generate + persist a profile Knowledge Pack. Deterministic, no LLM, never
   * throws. Idempotent — unchanged structured_data (same contentHash) is a
   * no-op re-persist that bumps nothing user-visible.
   */
  generateForProfile(input: ProfileIngestInput, force = false): ProfilePackResult {
    if (!isOkfProfilePacksEnabled()) return { status: 'skipped_flag_off' };

    const sourceText = buildSourceText(input);
    if (!sourceText.trim()) return { status: 'skipped_empty' };

    const t0 = Date.now();
    try {
      const kind = input.kind;
      const cacheKey = cacheKeyFor(kind);
      // Content-only hash (NO docId): a re-upload of identical resume/JD content
      // gets a NEW knowledge_documents autoincrement id, so folding docId in here
      // would make every re-ingest look "changed" and needlessly regenerate the
      // pack. Keying on (kind + extracted content) means an unchanged re-upload
      // correctly short-circuits (status 'generated', cached pack returned).
      // totalExperienceYears is folded in too: it feeds the identity card body
      // ("Approximately N years…") and, while derived from the (hashed) experience
      // dates, the premium engine could recompute it independently — including it
      // closes the "resume text identical but recomputed year count" staleness gap.
      const contentHash = sha256(`${kind}:${input.totalExperienceYears ?? ''}:${sourceText}`);
      const existingSource = this.findProfileSource(kind);
      if (!force && existingSource && existingSource.contentHash === contentHash) {
        const cached = this.store.getPackBySourceId(existingSource.id);
        return { status: 'generated', pack: cached ?? undefined };
      }

      const sourceId = existingSource?.id || shortId('psrc', `${PROFILE_OKF_MODE_ID}:${kind}`);
      const packId = shortId('ppack', `${PROFILE_OKF_MODE_ID}:${kind}`);
      const nowIso = new Date().toISOString();
      const sourceChecksum = contentHash;

      const drafts: ProfileCardDraft[] = kind === 'resume'
        ? buildResumeCardDrafts(input.structuredData, { totalExperienceYears: input.totalExperienceYears })
        : [...buildJdCardDrafts(input.structuredData), ...buildArtifactCardDrafts(input.artifacts || {})];

      let cards = cardsFromDrafts(drafts, { packId, sourceId, sourceChecksum, nowIso });
      const { accepted, rejected } = verifyProfileCards(cards, sourceText);
      cards = linkRelatedCards(accepted);

      const entities = entitiesFromCards(cards, packId, nowIso);
      const relations = isOkfProfileGraphExpansionEnabled()
        ? extractProfileGraphRelations(cards, entities)
        : [];

      const confScore = { high: 1, medium: 0.6, low: 0.3 } as const;
      const confSum = cards.reduce((s, c) => s + confScore[c.confidence], 0);

      const pack: KnowledgePack = {
        id: packId,
        sourceId,
        modeId: PROFILE_OKF_MODE_ID,
        fileName: kind === 'resume' ? 'Candidate Resume' : 'Target Job Description',
        cards,
        entities,
        relations,
        indexMd: '',
        stats: {
          cardCount: cards.length,
          entityCount: entities.length,
          relationCount: relations.length,
          sourcePages: 0,
          sourceSections: new Set(cards.flatMap((c) => c.sourceSections)).size,
          avgConfidence: cards.length > 0 ? confSum / cards.length : 0,
          extractionMs: Date.now() - t0,
        },
        packVersion: (this.store.getPackBySourceId(sourceId)?.packVersion || 0) + 1,
        generatedBy: 'okf_extractor_v1',
        updatedAt: nowIso,
      };

      const source: KnowledgeSource = {
        id: sourceId,
        type: sourceTypeFor(kind),
        // fileId intentionally omitted (stored NULL): profile has no
        // mode_reference_files row, and file_id carries a runtime-enforced FK.
        modeId: PROFILE_OKF_MODE_ID,
        fileName: pack.fileName,
        sourceChecksum,
        contentHash,
        createdAt: existingSource?.createdAt || nowIso,
        indexedAt: nowIso,
        indexVersion: 'profile_pack_v1',
      };

      DatabaseManager.getInstance().runInTransaction(() => {
        this.store.saveSource(source);
        this.store.savePack(pack, sourceChecksum);
        this.store.saveIndexVersion({
          id: shortId('pkiv', sourceId),
          sourceId, packId, packVersion: pack.packVersion, contentHash,
          status: 'ready', createdAt: nowIso, updatedAt: nowIso,
        });
      });

      const persisted = this.store.getPackBySourceId(sourceId);
      if (persisted) setCachedPack(cacheKey, persisted, contentHash);

      piTelemetry.emit('pi_okf_profile_pack_generated', {
        docType: kind, cardCount: cards.length, entityCount: entities.length,
        relationCount: relations.length, rejectedCount: rejected.length,
        packVersion: pack.packVersion, generatedMs: Date.now() - t0,
      });

      return { status: 'generated', pack: persisted ?? pack };
    } catch (err: any) {
      // Never throw to the caller — ingest must never fail because of the OKF layer.
      console.error('[ProfilePackBuilder] generateForProfile failed:', err?.message || err);
      return { status: 'failed', error: String(err?.message || err) };
    }
  }

  /** The persisted pack for a profile doc kind, or null. Cache-first. */
  getProfilePack(kind: ProfileDocKind): KnowledgePack | null {
    const source = this.findProfileSource(kind);
    if (!source) return null;
    const cacheKey = cacheKeyFor(kind);
    const cached = getCachedPack(cacheKey, source.contentHash);
    if (cached) return cached;
    const pack = this.store.getPackBySourceId(source.id);
    if (pack) setCachedPack(cacheKey, pack, source.contentHash);
    return pack;
  }

  /** Both profile packs (resume + JD), whichever exist. */
  getAllProfilePacks(): KnowledgePack[] {
    const packs: KnowledgePack[] = [];
    for (const kind of ['resume', 'jd'] as ProfileDocKind[]) {
      const p = this.getProfilePack(kind);
      if (p) packs.push(p);
    }
    return packs;
  }

  /** Delete one profile doc kind's pack (used by re-ingest / partial clear). */
  deleteProfilePack(kind: ProfileDocKind): void {
    const source = this.findProfileSource(kind);
    if (source) this.store.deleteSource(source.id);
    invalidatePackCache(cacheKeyFor(kind));
    piTelemetry.emit('pi_okf_profile_pack_invalidated', { docType: kind });
  }

  /** Delete ALL profile packs (wired into profile:clear). */
  deleteAllProfilePacks(): void {
    // deleteProfilePack already invalidatePackCache(cacheKeyFor(kind)) per kind,
    // which drops both the pack-cache entry AND any retrieval-cache entries keyed
    // to it — so a global clearAllPackCache() here would needlessly thrash every
    // DOCUMENT mode's pack cache too. Per-key invalidation is sufficient.
    for (const kind of ['resume', 'jd'] as ProfileDocKind[]) this.deleteProfilePack(kind);
  }
}
