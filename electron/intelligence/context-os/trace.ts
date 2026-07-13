// electron/intelligence/context-os/trace.ts
//
// Context OS (Phase 1) — the privacy-safe per-turn trace. This is how a
// developer answers "why was source X allowed/blocked on this turn?" without
// dumping resume or document contents into logs.
//
// Privacy rules (Apple-style auditability without content exfiltration):
//   • questionPreview capped at 80 chars.
//   • Evidence appears as source kinds + coverage booleans, never full text.
//   • Rejected sources carry a reason code, not content.

import type { EvidencePack } from './evidencePack';
import type { SourceKind, TurnContextContract } from './types';

export type FinalAction =
  | 'answer'
  | 'refuse_insufficient_evidence'
  | 'clarify'
  | 'fallback';

export interface ContextOsTrace {
  turnId: string;
  surface: string;
  questionPreview: string;
  activeModeId: string | null;
  sourceAuthority: string;
  sourceOwner: string;
  requestedProperty: string;
  answerShape: string;
  enforcement: string;
  allowedSources: string[];
  forbiddenSources: string[];
  referentOnlySources: string[];
  usedSources: string[];
  rejectedSources: Array<{ sourceKind: string; reason: string }>;
  evidenceCoverage: {
    hasDirectEvidence: boolean;
    propertySatisfied: boolean;
    entityMatched: boolean;
    sourceOwnerSatisfied: boolean;
    confidence: number;
  };
  packId?: string;
  packVersion?: number;
  resolutionStrategy?: string;
  answerPolicy?: string;
  selectedEvidenceCount: number;
  candidateEvidenceCount: number;
  finalAction: FinalAction;
}

/** Build the privacy-safe trace from a contract (+ optional pack + outcome). */
export function buildContextOsTrace(input: {
  contract: TurnContextContract;
  sourceAuthority: string;
  question: string;
  evidencePack?: EvidencePack | null;
  usedSources?: SourceKind[];
  finalAction: FinalAction;
}): ContextOsTrace {
  const { contract, evidencePack } = input;
  return {
    turnId: contract.turnId,
    surface: contract.surface,
    questionPreview: String(input.question || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    activeModeId: contract.activeModeId,
    sourceAuthority: input.sourceAuthority,
    sourceOwner: contract.sourceOwner,
    requestedProperty: contract.requestedProperty,
    answerShape: contract.answerShape,
    enforcement: contract.enforcement,
    allowedSources: contract.allowedSources.map((c) => c.sourceKind),
    forbiddenSources: [...contract.forbiddenSources],
    referentOnlySources: [...contract.referentOnlySources],
    usedSources: (input.usedSources
      ?? (evidencePack ? [...new Set(evidencePack.items.map((i) => i.sourceKind))] : [])) as string[],
    rejectedSources: (evidencePack?.rejected ?? []).map((r) => ({
      sourceKind: r.sourceKind,
      reason: r.reason,
    })),
    evidenceCoverage: {
      hasDirectEvidence: evidencePack?.coverage.hasDirectEvidence ?? false,
      propertySatisfied: evidencePack?.coverage.propertySatisfied ?? false,
      entityMatched: evidencePack?.coverage.entityMatched ?? false,
      sourceOwnerSatisfied: evidencePack?.coverage.sourceOwnerSatisfied ?? false,
      confidence: evidencePack?.coverage.confidence ?? 0,
    },
    packId: evidencePack?.packId,
    packVersion: evidencePack?.version,
    resolutionStrategy: evidencePack?.resolver?.strategy,
    answerPolicy: evidencePack?.answerPolicy,
    selectedEvidenceCount: evidencePack?.selection?.selectedEvidenceIds.length ?? evidencePack?.items.length ?? 0,
    candidateEvidenceCount: evidencePack?.selection?.candidateEvidenceIds.length ?? evidencePack?.items.length ?? 0,
    finalAction: input.finalAction,
  };
}

/**
 * Emit the trace. Follows the [SOURCE-ARBITER] convention: a single JSON line,
 * gated by the caller (usually the `trace` intelligence flag or a contextOs
 * flag) — this function itself never gates so tests can call it directly.
 */
export function logContextOsTrace(trace: ContextOsTrace): void {
  try {
    console.log('[CONTEXT-OS]', JSON.stringify(trace));
  } catch { /* tracing must never break an answer */ }
}
