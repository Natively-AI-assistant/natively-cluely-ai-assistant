// electron/intelligence/context-os/evidencePack.ts
//
// Context OS (Phase 1) — typed evidence. Every piece of retrieved material
// becomes an EvidenceItem with source kind, source id, authority, trust level
// and provenance pointer, so validators and the prompt renderer can reason
// about WHERE a fact came from instead of consuming an opaque string block.
//
// Distinct from the OKF-only `RetrievalEvidencePack`
// (electron/services/knowledge/RetrievalEvidencePack.ts): that one carries OKF
// retrieval tiers for the false-refusal repair gate. This EvidencePack is the
// cross-source, contract-scoped answer-time pack; Phase 4's orchestrator can
// wrap OKF results INTO EvidenceItems.

import type {
  EvidenceAuthority,
  RequestedProperty,
  SourceKind,
  SourceOwner,
  TrustLevel,
} from './types';

export interface EvidencePointer {
  page?: number;
  section?: string;
  timestampMs?: number;
  cardId?: string;
  chunkId?: string;
  fileId?: string;
  meetingId?: string;
  claimId?: string;
  speaker?: string;
}

export interface EvidenceItem {
  evidenceId: string;
  sourceKind: SourceKind;
  sourceId: string;
  sourceOwner: SourceOwner;
  authority: EvidenceAuthority;
  trustLevel: TrustLevel | string;
  text: string;
  pointer?: EvidencePointer;
  supports: {
    entity?: string;
    property: RequestedProperty;
    value?: string;
  };
  score: {
    lexical?: number;
    vector?: number;
    rerank?: number;
    propertyMatch?: number;
    final: number;
  };
  reasonIncluded: string;
}

export type EvidenceRejectionReason =
  | 'forbidden_source'
  | 'referent_only'
  | 'property_mismatch'
  | 'low_confidence'
  | 'wrong_entity'
  | 'stale'
  | 'unverified_memory';

export interface RejectedEvidenceItem {
  sourceKind: SourceKind;
  sourceId?: string;
  /** Short preview only — never the full content (privacy-safe traces). */
  textPreview?: string;
  reason: EvidenceRejectionReason;
}

export type AnswerPolicy =
  | 'answer'
  | 'answer_with_uncertainty'
  | 'refuse_insufficient_evidence'
  | 'ask_clarification';

export interface EvidenceConflict {
  leftEvidenceId: string;
  rightEvidenceId: string;
  conflictType: string;
  resolution: string;
}

export interface EvidenceCoverage {
  hasDirectEvidence: boolean;
  propertySatisfied: boolean;
  entityMatched: boolean;
  sourceOwnerSatisfied: boolean;
  confidence: number;
}

export interface EvidencePack {
  /**
   * Stable identity for THIS pack instance (Phase 6/M4). The exact pack used for
   * generation must be the exact pack used for post-generation validation —
   * `packId` lets a validator assert it is checking the same evidence the answer
   * was produced from, instead of a re-fetched block.
   */
  packId?: string;
  /** Regeneration lineage: an expanded pack increments version + links parent. */
  version?: number;
  parentPackId?: string;
  turnId: string;
  sourceOwner: SourceOwner;
  requestedProperty: RequestedProperty;
  items: EvidenceItem[];
  rejected: RejectedEvidenceItem[];
  coverage: EvidenceCoverage;
  conflicts: EvidenceConflict[];
  answerPolicy: AnswerPolicy;
}

// ── Small pure helpers ───────────────────────────────────────────────────────

/** Only items that may actually be cited as fact. */
export function evidenceOnlyItems(pack: Pick<EvidencePack, 'items'>): EvidenceItem[] {
  return pack.items.filter((i) => i.authority === 'evidence');
}

/** A privacy-safe preview for rejected-item traces (first 80 chars). */
export function previewText(text: string | undefined | null, max = 80): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** An empty pack for a turn whose answer policy is decided without retrieval. */
export function emptyEvidencePack(input: {
  turnId: string;
  sourceOwner: SourceOwner;
  requestedProperty: RequestedProperty;
  answerPolicy: AnswerPolicy;
}): EvidencePack {
  return {
    turnId: input.turnId,
    sourceOwner: input.sourceOwner,
    requestedProperty: input.requestedProperty,
    items: [],
    rejected: [],
    coverage: {
      hasDirectEvidence: false,
      propertySatisfied: false,
      entityMatched: false,
      sourceOwnerSatisfied: false,
      confidence: 0,
    },
    conflicts: [],
    answerPolicy: input.answerPolicy,
  };
}
