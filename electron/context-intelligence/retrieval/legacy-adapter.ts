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
  /** Structured flags a port declares about its own chunk (e.g. the profile
   *  port's `completeInventory`). Carried through verbatim — the adapter never
   *  invents metadata, and consumers must treat it as the PORT's claim. */
  metadata?: Record<string, unknown>;
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
  /**
   * sourceId -> the scopeId the SOURCE belongs to.
   *
   * Without this, scope isolation does not exist. The adapter stamps every
   * admitted item with `scopeKey(opts.scope)` — the scope of the TURN — and never
   * compares it against anything, so a chunk from another user or another meeting
   * is admitted and then labelled as though it belonged to the current scope.
   * `filterByScopeAndVersion` implements the comparison and has no callers (F25a).
   *
   * 06_SOURCE_AUTHORITY_SPEC §4 requires this specifically for cross-meeting
   * isolation: the previous and current meeting transcripts are written with high
   * lexical overlap so that similarity ranking CANNOT separate them, and only a
   * `scopeId = currentMeetingId` filter can.
   */
  sourceScopes?: Map<string, EvidenceScope>;
  /**
   * Admit a chunk whose source scope is UNKNOWN. Same rationale, and the same
   * fail-open hazard, as `assumeCurrentWhenVersionUnknown`: the legacy
   * mode-reference store has no scope column, so the wired surface must opt in,
   * and a harness that simply forgets to declare scopes must fail loudly instead
   * of measuring an inert filter as a pass.
   */
  assumeInScopeWhenUnknown?: boolean;
  /**
   * Admit a chunk whose own version is UNKNOWN, treating it as current.
   *
   * This must be opted into. The legacy mode-reference store has no version
   * concept at all, so the wired production surface genuinely needs it
   * (ipcHandlers.ts stamps one synthetic version for every file) — but it is a
   * fail-OPEN decision and this module's contract is fail-closed, so it may not
   * be the silent default.
   *
   * It was: `chunkVersions?.get(id) ?? active` admitted anything unregistered as
   * current. A harness that simply forgot to pass `chunkVersions` therefore
   * measured version filtering as a clean pass while the filter was inert.
   * Defaulting to false makes that mistake fail loudly instead.
   */
  assumeCurrentWhenVersionUnknown?: boolean;
}

export interface AdaptResult {
  evidence: EvidenceItem[];
  rejected: Array<{
    sourceId: string;
    reason: 'UNKNOWN_SOURCE_TYPE' | 'SUPERSEDED_VERSION' | 'NO_ACTIVE_VERSION'
      | 'UNKNOWN_CHUNK_VERSION' | 'OUT_OF_SCOPE' | 'UNKNOWN_SOURCE_SCOPE';
  }>;
}

/**
 * Is a source visible from this turn's scope?
 *
 * CONTAINMENT, not equality. A user-level document — a résumé — must stay visible
 * inside a meeting turn, because narrowing to a meeting does not revoke the
 * user's own material. Comparing scope KEYS as strings gets this exactly
 * backwards: `u:alice` !== `u:alice|m:sept`, so the user's résumé would be
 * rejected from every meeting turn.
 *
 * A qualifier the source declares must match; a qualifier it leaves open does
 * not restrict it. So the June transcript (`m:m-june`) is rejected from a
 * September turn, while the résumé (no meeting) is admitted to both.
 */
export function scopeAdmits(turn: EvidenceScope, source: EvidenceScope): boolean {
  if (source.userId !== turn.userId) return false;
  const narrows = (a?: string, b?: string) => a !== undefined && a !== b;
  if (narrows(source.meetingId, turn.meetingId)) return false;
  if (narrows(source.profileId, turn.profileId)) return false;
  if (narrows(source.sessionId, turn.sessionId)) return false;
  if (narrows(source.workspaceId, turn.workspaceId)) return false;
  return true;
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

    // Scope BEFORE version: a chunk from another meeting is not "a stale version
    // of this meeting", and reporting it as one would misattribute the rejection.
    const sourceScope = opts.sourceScopes?.get(c.sourceId);
    if (sourceScope === undefined && !opts.assumeInScopeWhenUnknown) {
      rejected.push({ sourceId: c.sourceId, reason: 'UNKNOWN_SOURCE_SCOPE' });
      continue;
    }
    if (sourceScope !== undefined && !scopeAdmits(opts.scope, sourceScope)) {
      rejected.push({ sourceId: c.sourceId, reason: 'OUT_OF_SCOPE' });
      continue;
    }

    const known = opts.chunkVersions?.get(c.sourceId);
    if (known === undefined && !opts.assumeCurrentWhenVersionUnknown) {
      rejected.push({ sourceId: c.sourceId, reason: 'UNKNOWN_CHUNK_VERSION' });
      continue;
    }
    const chunkVersion = known ?? active;
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
      retrievedVersionId: chunkVersion,
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
      metadata: c.metadata ?? {},

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
