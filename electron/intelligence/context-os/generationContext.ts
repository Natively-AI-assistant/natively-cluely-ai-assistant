// electron/intelligence/context-os/generationContext.ts
//
// Context OS (H1 / Phase 3) — the single immutable per-turn object passed into
// the provider assembly layer so the typed EvidencePack GOVERNS the factual
// prompt. One turnId, one packId, one mode snapshot — carried into generation,
// validation, and claim persistence so they can never diverge.
//
// This is intentionally a THIN carrier: it holds the contract + a way to obtain
// the typed pack from an already-retrieved evidence block (no double
// retrieval). The renderer + orchestrator live in their own modules.

import type { TurnContextContract } from './types';
import type { EvidencePack } from './evidencePack';
import { parseModeSnippets } from './EvidenceOrchestrator';
import { textCanProveProperty } from './requestedProperty';
import { renderContractForPrompt, renderEvidenceUseRule, renderEvidencePackForPrompt } from './promptRenderer';

export interface ContextOsModeSnapshot {
  modeId: string | null;
  modeName: string | null;
  sourceAuthority: string;
}

export interface ContextOsGenerationContext {
  contract: TurnContextContract;
  /** Immutable user question. Provider packets must never be reused as this value. */
  turnQuestion?: string;
  /** The pack governing THIS generation. May be built lazily from the retrieved block. */
  evidencePack: EvidencePack | null;
  modeSnapshot: ContextOsModeSnapshot;
  /** Whether the typed pack should REPLACE the legacy factual block in the prompt. */
  govern: boolean;
}

/**
 * Build a typed EvidencePack from an ALREADY-RETRIEVED document evidence block
 * (the `<active_mode_retrieved_context>` XML the mode retriever produced). This
 * is the no-double-retrieval bridge: one retrieval execution supplies both the
 * legacy string (flag-off) and this typed pack (flag-on). Reference-file
 * evidence only — profile/Hindsight/transcript are governed by the contract's
 * capability gates upstream and never enter this pack.
 */
export function buildDocumentEvidencePackFromBlock(
  contract: TurnContextContract,
  rawEvidenceBlock: string,
): EvidencePack {
  const snippets = parseModeSnippets(rawEvidenceBlock);
  const texts = snippets.length > 0 ? snippets : [];
  const items = (texts.length > 0
    ? texts.map((s, i) => ({ text: s.text, sourceId: s.sourceId, fileName: s.fileName, chunkIndex: s.chunkIndex, ftsScore: s.ftsScore, vectorScore: s.vectorScore, score: s.score, idx: i }))
    : (rawEvidenceBlock.trim() ? [{ text: rawEvidenceBlock, sourceId: undefined, fileName: undefined, chunkIndex: undefined, ftsScore: undefined, vectorScore: undefined, score: undefined, idx: 0 }] : [])
  ).map((s) => {
    const canProve = textCanProveProperty(s.text, contract.requestedProperty);
    return {
      evidenceId: `${contract.turnId}:doc:${s.idx}`,
      sourceKind: 'mode_reference_chunk' as const,
      sourceId: s.sourceId ?? contract.activeModeId ?? 'active-mode',
      sourceOwner: 'reference_files' as const,
      authority: 'evidence' as const,
      trustLevel: 'user_uploaded',
      text: s.text,
      pointer: {
        fileId: s.sourceId,
        chunkId: (s.sourceId != null && s.chunkIndex != null) ? `${s.sourceId}:${s.chunkIndex}` : undefined,
        section: s.fileName,
      },
      supports: { property: canProve ? contract.requestedProperty : 'unknown' as const },
      score: { lexical: s.ftsScore, vector: s.vectorScore, propertyMatch: canProve ? 1 : 0, final: s.score ?? 0.5 },
      reasonIncluded: 'document evidence (typed pack governs prompt)',
    };
  });

  const factual = items;
  const propertySatisfied = contract.requestedProperty === 'unknown'
    ? factual.length > 0
    : factual.some((i) => i.supports.property === contract.requestedProperty);

  return {
    packId: `${contract.turnId}:pack:1`,
    version: 1,
    turnId: contract.turnId,
    sourceOwner: contract.sourceOwner,
    requestedProperty: contract.requestedProperty,
    items,
    rejected: [],
    coverage: {
      hasDirectEvidence: factual.length > 0,
      propertySatisfied,
      entityMatched: factual.length > 0,
      sourceOwnerSatisfied: factual.every((i) => i.sourceOwner === contract.sourceOwner),
      confidence: factual.length > 0 ? Math.max(...factual.map((i) => i.score.final)) : 0,
    },
    conflicts: [],
    answerPolicy: factual.length === 0 ? 'refuse_insufficient_evidence' : propertySatisfied ? 'answer' : 'answer_with_uncertainty',
  };
}

/**
 * Render the typed pack as the factual block that REPLACES the raw retrieval
 * block in the provider prompt. Contract + evidence-use rule + typed pack.
 * Returns '' when there are no evidence items (caller then fails safe).
 */
export function renderGoverningFactualBlock(ctx: ContextOsGenerationContext): string {
  if (!ctx.evidencePack || ctx.evidencePack.items.length === 0) return '';
  return [
    renderContractForPrompt(ctx.contract),
    renderEvidenceUseRule(ctx.contract),
    renderEvidencePackForPrompt(ctx.evidencePack),
  ].join('\n\n');
}
