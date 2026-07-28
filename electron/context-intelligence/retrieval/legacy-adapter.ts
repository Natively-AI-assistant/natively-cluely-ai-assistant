// electron/context-intelligence/retrieval/legacy-adapter.ts
//
// Phase 5 — adapter from the EXISTING storage/retrieval output into the V3
// evidence contract.
//
// SCOPE NOTE: the owner chose "decision + orchestration layer only", so
// ingestion, embeddings, VectorStore and chunking are reused as-is. Phase 5 is
// therefore NOT a schema rewrite — it is this adapter plus two additive type
// widenings. See 08_MIGRATION_PLAN.md §2.
//
// The two widenings this file performs, and why each is load-bearing:
//
//  1. scopeId  — EvidenceItem has none today (F19), so user/meeting/version
//     isolation cannot be ASSERTED on evidence, only inferred from which
//     retriever happened to run. Phase 2 measured a 54.8% stale-version
//     retrieval rate, so this is the single most consequential missing field.
//
//  2. answerabilityScore / rerankScore — ModeHybridRetriever COMPUTES these on
//     its internal ChunkCandidate and then DROPS them at the ModeRetrievedChunk
//     boundary. Structural and property-aware matching is calculated and thrown
//     away before any consumer can see it. Carrying them through is free: the
//     values already exist at the return site.

import type { EvidenceItem, ClaimType, SourceType, EvidenceScope } from '../contracts/types';
import { scopeKey } from '../contracts/types';
import { authorityOf } from '../policies/source-authority-policy';

/** The legacy shape returned by ModeHybridRetriever.retrieve(). The four
 *  optional fields are the ones the legacy public type drops. */
export interface LegacyChunk {
  sourceId: string;
  fileName?: string;
  text: string;
  chunkIndex?: number;
  score?: number;
  ftsScore?: number;
  vectorScore?: number;
  trustLevel?: string;
  // present on the internal candidate, absent from the public type
  rerankScore?: number;
  answerabilityScore?: number;
  section?: string;
  headingPath?: string[];
}

export interface AdaptOptions {
  scope: EvidenceScope;
  /** sourceId -> SourceType. The adapter must NOT guess: mislabelling a JD as a
   *  resume would defeat the entire source-authority layer. */
  sourceTypes: Map<string, SourceType>;
  /** sourceId -> active versionId. A chunk whose version is absent here is
   *  treated as superseded and REJECTED, not silently admitted. */
  activeVersions: Map<string, string>;
  /** sourceId -> versionId the chunk actually came from, when the store knows. */
  chunkVersions?: Map<string, string>;
}

export interface AdaptResult {
  evidence: EvidenceItem[];
  rejected: Array<{ sourceId: string; reason: 'UNKNOWN_SOURCE_TYPE' | 'SUPERSEDED_VERSION' | 'NO_ACTIVE_VERSION' }>;
}

/**
 * Convert legacy chunks into EvidenceItems, applying scope/version rules.
 *
 * Fails CLOSED: a chunk whose source type or active version cannot be
 * established is rejected with a reason rather than admitted with a guess. The
 * legacy path does the opposite — it passes text through and lets the prompt
 * sort it out, which is how a superseded resume reaches the model.
 */
export function adaptLegacyChunks(chunks: LegacyChunk[], opts: AdaptOptions): AdaptResult {
  const sid = scopeKey(opts.scope);
  const evidence: EvidenceItem[] = [];
  const rejected: AdaptResult['rejected'] = [];

  for (const [i, c] of chunks.entries()) {
    const sourceType = opts.sourceTypes.get(c.sourceId);
    if (!sourceType) { rejected.push({ sourceId: c.sourceId, reason: 'UNKNOWN_SOURCE_TYPE' }); continue; }

    const active = opts.activeVersions.get(c.sourceId);
    if (!active) { rejected.push({ sourceId: c.sourceId, reason: 'NO_ACTIVE_VERSION' }); continue; }

    const chunkVersion = opts.chunkVersions?.get(c.sourceId) ?? active;
    if (chunkVersion !== active) {
      rejected.push({ sourceId: c.sourceId, reason: 'SUPERSEDED_VERSION' });
      continue;
    }

    const authority = authorityOf(sourceType);

    evidence.push({
      evidenceId: `ev-${c.sourceId}-${c.chunkIndex ?? i}`,
      sourceType,
      sourceId: c.sourceId,
      versionId: active,
      scopeId: sid,
      documentTitle: c.fileName,
      section: c.section,
      headingPath: c.headingPath,
      chunkIndex: c.chunkIndex,
      content: c.text,

      semanticScore: c.vectorScore,
      keywordScore: c.ftsScore,
      rerankerScore: c.rerankScore,
      answerabilityScore: c.answerabilityScore,
      finalScore: c.score ?? 0,

      authorityFor: authority,
      // Retrieved document text is a direct quotation of a source, never an
      // inference drawn from one.
      isDirectFact: true,
      isInferred: false,
      metadata: {},

      // Literal, not a variable: similarity never confers trust. Retrieved text
      // is DATA and must never be executed as instructions (§23).
      trustLevel: 'untrusted_reference',
      acceptedFor: authority,
    });
  }

  return { evidence, rejected };
}

/**
 * Filter evidence to what may actually support a claim.
 *
 * Authorization (may this mode read the source?) and authority (may this source
 * evidence THIS claim?) are different questions, and conflating them is what
 * lets a JD answer "does the candidate have Postgres experience?".
 */
export function evidenceForClaim(evidence: EvidenceItem[], claim: ClaimType): EvidenceItem[] {
  return evidence.filter((e) => e.authorityFor.includes(claim));
}
