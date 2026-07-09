// electron/services/knowledge/types.ts
//
// OKF Hybrid Knowledge System (Phase 2, 2026-07-01) — internal TypeScript
// types for "Knowledge Packs" (≈ OKF Knowledge Bundles) generated from
// uploaded reference files. See docs/investigations/okf-official-spec-notes.md
// for the official OKF v0.1 spec this maps to, and
// docs/investigations/knowledge-architecture-okf-upgrade-plan.md for the
// original design draft these types were drafted from.
//
// Naming: internally "Knowledge Pack"/"Knowledge Card", externally (exported
// Markdown) these map 1:1 to OKF's "Knowledge Bundle"/"Concept Document".

export type KnowledgeSourceType =
  | 'reference_file'
  | 'transcript_segment'
  | 'profile_fact'
  | 'hindsight_fact'
  // OKF Profile Intelligence upgrade (2026-07-02): a candidate resume or target
  // job description ingested through the premium KnowledgeOrchestrator, mapped
  // deterministically into profile OKF cards. Distinct source types so profile
  // packs are always identifiable as PII and never confused with document
  // reference-file packs.
  | 'profile_resume'
  | 'profile_jd';

export interface KnowledgeSource {
  id: string;
  type: KnowledgeSourceType;
  fileId?: string;
  modeId?: string;
  fileName?: string;
  sourceChecksum: string;
  contentHash: string;
  createdAt: string;
  indexedAt?: string;
  pageCount?: number;
  extractedPageCount?: number;
  indexVersion: string;
  embeddingSpace?: string;
}

export type KnowledgeCardType =
  | 'concept'
  | 'entity'
  | 'section'
  | 'qa_pair'
  | 'definition'
  | 'methodology'
  | 'result'
  | 'conclusion'
  // OKF Profile Intelligence card types (2026-07-02). Deterministic transform
  // of the premium engine's structured_data + AOT artifacts. Each maps to a
  // human-readable OKF `type` in OkfMarkdownExporter.
  | 'candidate_identity'
  | 'candidate_summary'
  | 'candidate_experience'
  | 'candidate_project'
  | 'candidate_education'
  | 'candidate_achievement'
  | 'candidate_leadership'
  | 'candidate_skills'
  | 'target_job_role'
  | 'target_job_requirements'
  | 'target_job_nice_to_haves'
  | 'target_job_keywords'
  | 'artifact_gap_analysis'
  | 'artifact_negotiation'
  | 'artifact_mock_questions'
  | 'artifact_culture_mapping'
  | 'artifact_intro';

export type KnowledgeCardConfidence = 'high' | 'medium' | 'low';

export type KnowledgeCardGeneratedFrom =
  | 'pdf_extraction'
  | 'docmap_derivation'
  | 'user_edit'
  | 'llm_synthesis'
  // OKF Profile Intelligence (2026-07-02): a pure deterministic transform of
  // the already-LLM-extracted structured_data / AOT artifacts — NO new LLM call.
  | 'structured_profile'
  | 'aot_artifact';

export type KnowledgeCardApprovalStatus = 'generated' | 'approved' | 'rejected' | 'needs_review';

export interface KnowledgeCardQuote {
  text: string;
  page: number;
  section?: string;
  chunkId?: string;
}

export interface KnowledgeCard {
  id: string;
  packId: string;
  sourceId: string;

  type: KnowledgeCardType;
  title: string;
  slug: string;
  /** Mirrors the OKF "Concept ID" — the bundle-relative path (no .md), e.g. "thesis/openvla-oft". */
  conceptId: string;

  body: string;
  bodyMarkdown?: string;

  sourcePages: number[];
  sourceSections: string[];
  sourceQuotes: KnowledgeCardQuote[];

  entities: string[];
  tags: string[];
  relatedCardIds: string[];

  confidence: KnowledgeCardConfidence;
  generatedFrom: KnowledgeCardGeneratedFrom;
  sourceChecksum: string;
  userEdited: boolean;
  approvalStatus: KnowledgeCardApprovalStatus;
  updatedAt: string;
  cardVersion: number;
  /**
   * OKF Profile Intelligence (2026-07-02): true when this card contains
   * personally-identifiable candidate data (every profile card). Persisted as
   * knowledge_cards.pii (migration v23). Reference-file cards default false.
   * Emitted as `pii: true` frontmatter on export so downstream tooling can
   * filter PII. Optional so every existing reference-file card constructor
   * (which never sets it) stays valid — absent ≡ false.
   */
  pii?: boolean;
}

export type KnowledgeEntityType = 'concept' | 'tool' | 'model' | 'method' | 'person' | 'organization' | 'dataset' | 'other';

export interface KnowledgeEntity {
  id: string;
  packId: string;
  slug: string;
  name: string;
  type: KnowledgeEntityType;
  aliases: string[];
  description: string;
  sourceCardIds: string[];
  sourcePages: number[];
  firstSeenAt: string;
}

export type RelationPredicate =
  | 'uses'
  | 'extends'
  | 'based_on'
  | 'improves_over'
  | 'is_part_of'
  | 'is_a'
  | 'contrasts_with'
  | 'implements'
  | 'evaluates'
  | 'authored_by'
  | 'cites';

export interface KnowledgeRelation {
  id: string;
  packId: string;
  subjectId: string;
  subjectType: 'entity' | 'card';
  predicate: RelationPredicate;
  objectId: string;
  objectType: 'entity' | 'card';
  sourceCardIds: string[];
  sourcePages: number[];
  confidence: KnowledgeCardConfidence;
  createdAt: string;
}

export interface KnowledgePackStats {
  cardCount: number;
  entityCount: number;
  relationCount: number;
  sourcePages: number;
  sourceSections: number;
  avgConfidence: number;
  extractionMs: number;
}

export interface KnowledgePack {
  id: string;
  sourceId: string;
  modeId: string;
  fileName: string;

  cards: KnowledgeCard[];
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
  indexMd: string;

  stats: KnowledgePackStats;

  packVersion: number;
  generatedBy: 'okf_extractor_v1';
  updatedAt: string;
}

export type KnowledgeIndexStatus = 'pending' | 'indexing' | 'ready' | 'failed' | 'stale';

export interface KnowledgeIndexVersion {
  id: string;
  sourceId: string;
  packId?: string;
  packVersion: number;
  contentHash: string;
  embeddingSpace?: string;
  status: KnowledgeIndexStatus;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

/** A single evidence unit surfaced to the unified retrieval layer (Phase 3). */
export interface KnowledgeEvidence {
  id: string;
  sourceId: string;
  type: 'chunk' | 'card' | 'triple';
  refId: string;
  text: string;
  score: number;
  rerankScore?: number;
  page?: number;
  section?: string;
  chunkIndex?: number;
  cardId?: string;
}

/** A snapshot of a card's prior state, captured before every edit/approve/reject (Phase 6). */
export interface KnowledgeCardVersion {
  id: string;
  cardId: string;
  cardVersion: number;
  title: string;
  body: string;
  entities: string[];
  tags: string[];
  confidence: KnowledgeCardConfidence;
  editedBy: string;
  editReason?: string;
  createdAt: string;
}

/** Verification result for a single card (OkfVerifier output). */
export interface CardVerificationResult {
  cardId: string;
  ok: boolean;
  /** Downgraded confidence (if verification found weak support but didn't reject). */
  downgradedConfidence?: KnowledgeCardConfidence;
  rejected: boolean;
  reasons: string[];
}

/** OKF v0.1 conformance check result for an exported bundle (OkfConformance output). */
export interface ConformanceResult {
  conformant: boolean;
  totalFiles: number;
  violations: Array<{ path: string; reason: string }>;
}
