// electron/intelligence/context-os/finalPromptValidation.ts
//
// Context OS — final factual-prompt validation.
//
// Runs at the LAST shared request boundary, AFTER userContent has been
// assembled and immediately before a provider is selected. It deliberately
// checks the RENDERED PROMPT and the EXACT EvidencePack identity TOGETHER:
// a retriever invocation or an intermediate pack is NOT evidence that a
// required source family reached the model.
//
// The provider-streaming layer can do many things between evidence selection
// and final userContent (token-budget trim, XML attribute escaping, recursive
// prompt composition). This validator closes the gap by:
//   1. Computing required/allowed/forbidden prompt-evidence families from
//      the same TurnSourceDecision the upstream gates used.
//   2. For each EvidencePack item with `authority: 'evidence'`, asserting
//      the rendered prompt still contains the exact `id="${item.evidenceId}"`
//      reference — i.e. the item survived transport.
//   3. Failing closed on: answer policy ask_clarification / refuse, missing
//      required families, or a forbidden family rendered into the prompt.
//
// When the canonical decision is null (production-default, Context-OS flags
// off) the validator is permissive — it has no required/forbidden family split
// to enforce. The legacy `validateAgainstSourceContract` path handles those
// turns.

import type { TurnSourceDecision, TurnEvidenceKind } from '../../llm/turnSourceDecision';
import type { EvidencePack } from './evidencePack';
import type { TurnContextContract } from './types';
import {
  RENDERED_EVIDENCE_FAMILIES,
  familyForTurnEvidenceKind,
  manifestIncludesSerializedEvidence,
  type RenderedEvidenceFamily,
  type RenderedEvidenceManifest,
} from './renderedEvidenceManifest';

export type PromptEvidenceFamily = RenderedEvidenceFamily;

export interface FinalPromptEvidenceValidation {
  ok: boolean;
  reason: string;
  requiredFamilies: PromptEvidenceFamily[];
  renderedFamilies: PromptEvidenceFamily[];
  forbiddenFamilies: PromptEvidenceFamily[];
  countsByFamily: Record<PromptEvidenceFamily, number>;
  serializedMarkerIntegrity: boolean;
}

export function familyForEvidenceKind(kind: TurnEvidenceKind): PromptEvidenceFamily {
  return familyForTurnEvidenceKind(kind);
}

/**
 * Validate the final payload against the same EvidencePack it was rendered from.
 * `finalUserPrompt` must contain every factual evidence ID counted below; this
 * prevents a token-budget trim or later transport adapter from silently removing
 * a required family after retrieval succeeded.
 */
export function validateFinalPromptEvidence(input: {
  decision?: TurnSourceDecision | null;
  contract: TurnContextContract;
  pack: EvidencePack;
  manifest: RenderedEvidenceManifest;
  /** Verification-only serialization integrity check. */
  finalUserPrompt?: string;
}): FinalPromptEvidenceValidation {
  const requiredFamilies = Array.from(new Set((input.decision?.requiredEvidenceKinds ?? [])
    .map(familyForEvidenceKind)));
  const allowedKinds = new Set(input.decision?.allowedEvidenceKinds ?? []);
  const allowedFamilies = new Set((input.decision?.allowedEvidenceKinds ?? [])
    .map(familyForEvidenceKind));
  const packEvidenceIds = new Set(input.pack.items
    .filter((item) => item.authority === 'evidence')
    .map((item) => item.evidenceId));
  const manifestIdsArePermitted = input.manifest.evidenceIds.every((id) => packEvidenceIds.has(id));
  const manifestIdsAreUnique = input.manifest.evidenceIds.length === new Set(input.manifest.evidenceIds).size;
  const serializedMarkerIntegrity = input.finalUserPrompt === undefined
    ? true
    : manifestIncludesSerializedEvidence(input.manifest, input.finalUserPrompt);
  const countsByFamily = input.manifest.countsByFamily;
  const renderedFamilies = RENDERED_EVIDENCE_FAMILIES.filter((family) => countsByFamily[family] > 0);
  const forbiddenFamilies = input.decision
    ? renderedFamilies.filter((family) => !allowedFamilies.has(family))
    : [];
  const forbiddenKinds = input.manifest.evidenceKinds.filter((kind) => {
    if (!input.decision) return false;
    const turnKind = kind === 'mode_reference_file' || kind === 'mode_reference_chunk' || kind === 'okf_document_card'
      ? 'reference_files'
      : kind === 'profile_project' || kind === 'profile_projects'
        ? 'projects'
        : kind === 'meeting_rag_chunk'
          ? 'meeting_rag'
          : kind as TurnEvidenceKind;
    return !allowedKinds.has(turnKind);
  });
  const missing = requiredFamilies.filter((family) => countsByFamily[family] === 0);

  const base = {
    requiredFamilies,
    renderedFamilies,
    forbiddenFamilies,
    countsByFamily,
    serializedMarkerIntegrity,
  };
  if (!manifestIdsArePermitted || !manifestIdsAreUnique) {
    return { ok: false, reason: 'rendered_manifest_invalid', ...base };
  }
  if (!serializedMarkerIntegrity) {
    return { ok: false, reason: 'serialized_evidence_marker_missing', ...base };
  }
  if (input.pack.answerPolicy === 'ask_clarification' || input.pack.answerPolicy === 'refuse_insufficient_evidence') {
    return { ok: false, reason: `answer_policy_${input.pack.answerPolicy}`, ...base };
  }
  if (missing.length > 0) {
    return { ok: false, reason: `missing_required_evidence_family:${missing.join(',')}`, ...base };
  }
  if (forbiddenKinds.length > 0 || forbiddenFamilies.length > 0) {
    const violation = forbiddenKinds.length > 0 ? forbiddenKinds.join(',') : forbiddenFamilies.join(',');
    return { ok: false, reason: `forbidden_evidence_rendered:${violation}`, ...base };
  }
  return { ok: true, reason: 'ok', ...base };
}
