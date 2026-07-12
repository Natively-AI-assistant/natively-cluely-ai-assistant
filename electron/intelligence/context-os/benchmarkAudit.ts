// Context OS benchmark-only provenance ring.
//
// Enabled exclusively by NATIVELY_CONTEXT_OS_BENCHMARK_AUDIT=1 alongside
// NATIVELY_E2E=1. It intentionally retains IDs, counts, and source metadata —
// never question text, evidence text, prompts, credentials, or provider headers.

import type { EvidencePack } from './evidencePack';
import type { TurnContextContract } from './types';

export interface ContextOsBenchmarkAuditRecord {
  turnId: string;
  sourceOwner: string;
  sourceAuthority: string;
  requestedProperty: string;
  answerPolicy: string | null;
  pack: {
    packId: string | null;
    version: number | null;
    selectedEvidenceIds: string[];
    candidateEvidenceIds: string[];
    excludedEvidenceIds: string[];
    items: Array<{
      evidenceId: string;
      sourceId: string;
      sourceKind: string;
      page: number | null;
      section: string | null;
    }>;
  } | null;
  promptSources: string[];
  providerDispatch: boolean;
  terminal: 'dispatch' | 'clarify' | 'refuse' | 'error';
}

const enabled = (): boolean => process.env.NATIVELY_E2E === '1'
  && process.env.NATIVELY_CONTEXT_OS_BENCHMARK_AUDIT === '1';

const toSafePack = (pack: EvidencePack | null | undefined): ContextOsBenchmarkAuditRecord['pack'] => {
  if (!pack) return null;
  return {
    packId: pack.packId ?? null,
    version: pack.version ?? null,
    selectedEvidenceIds: [...(pack.selection?.selectedEvidenceIds ?? pack.items.map((item) => item.evidenceId))],
    candidateEvidenceIds: [...(pack.selection?.candidateEvidenceIds ?? pack.items.map((item) => item.evidenceId))],
    excludedEvidenceIds: [...(pack.selection?.excludedEvidenceIds ?? [])],
    items: pack.items.map((item) => ({
      evidenceId: item.evidenceId,
      sourceId: item.sourceId,
      sourceKind: item.sourceKind,
      page: item.pointer?.page ?? null,
      section: item.pointer?.section ?? null,
    })),
  };
};

export const recordContextOsBenchmarkAudit = (input: {
  contract: TurnContextContract;
  sourceAuthority: string;
  pack?: EvidencePack | null;
  providerDispatch: boolean;
  terminal: ContextOsBenchmarkAuditRecord['terminal'];
  promptSources?: string[];
}): void => {
  if (!enabled()) return;
  const globalState = globalThis as typeof globalThis & { __contextOsBenchmarkAudit?: ContextOsBenchmarkAuditRecord[] };
  const records = globalState.__contextOsBenchmarkAudit ||= [];
  records.push({
    turnId: input.contract.turnId,
    sourceOwner: input.contract.sourceOwner,
    sourceAuthority: input.sourceAuthority,
    requestedProperty: input.contract.requestedProperty,
    answerPolicy: input.pack?.answerPolicy ?? null,
    pack: toSafePack(input.pack),
    promptSources: [...new Set(input.promptSources ?? [])],
    providerDispatch: input.providerDispatch,
    terminal: input.terminal,
  });
  if (records.length > 200) records.splice(0, records.length - 200);
};

export const getContextOsBenchmarkAudit = (): ContextOsBenchmarkAuditRecord[] => {
  const globalState = globalThis as typeof globalThis & { __contextOsBenchmarkAudit?: ContextOsBenchmarkAuditRecord[] };
  return [...(globalState.__contextOsBenchmarkAudit ?? [])];
};

export const clearContextOsBenchmarkAudit = (): void => {
  const globalState = globalThis as typeof globalThis & { __contextOsBenchmarkAudit?: ContextOsBenchmarkAuditRecord[] };
  globalState.__contextOsBenchmarkAudit = [];
};
