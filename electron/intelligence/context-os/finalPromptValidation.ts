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

export type PromptEvidenceFamily =
  | 'reference_files'
  | 'resume'
  | 'projects'
  | 'job_description'
  | 'transcript'
  | 'meeting_rag';

export interface FinalPromptEvidenceValidation {
  ok: boolean;
  reason: string;
  requiredFamilies: PromptEvidenceFamily[];
  renderedFamilies: PromptEvidenceFamily[];
  forbiddenFamilies: PromptEvidenceFamily[];
  countsByFamily: Record<PromptEvidenceFamily, number>;
}

const FAMILIES: PromptEvidenceFamily[] = [
  'reference_files', 'resume', 'projects', 'job_description', 'transcript', 'meeting_rag',
];

export function familyForEvidenceKind(kind: TurnEvidenceKind): PromptEvidenceFamily {
  switch (kind) {
    case 'profile_resume': return 'resume';
    case 'projects': return 'projects';
    case 'profile_jd': return 'job_description';
    case 'live_transcript': return 'transcript';
    case 'meeting_rag': return 'meeting_rag';
    case 'reference_files': return 'reference_files';
  }
}

function familyForSourceKind(kind: string): PromptEvidenceFamily | null {
  if (kind === 'mode_reference_file' || kind === 'mode_reference_chunk' || kind === 'okf_document_card') return 'reference_files';
  if (kind === 'profile_resume') return 'resume';
  if (kind === 'profile_project' || kind === 'profile_projects') return 'projects';
  if (kind === 'profile_jd') return 'job_description';
  if (kind === 'live_transcript') return 'transcript';
  if (kind === 'meeting_rag_chunk') return 'meeting_rag';
  return null;
}

function emptyCounts(): Record<PromptEvidenceFamily, number> {
  return Object.fromEntries(FAMILIES.map((family) => [family, 0])) as Record<PromptEvidenceFamily, number>;
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
  finalUserPrompt: string;
}): FinalPromptEvidenceValidation {
  const countsByFamily = emptyCounts();
  const requiredFamilies = Array.from(new Set((input.decision?.requiredEvidenceKinds ?? [])
    .map(familyForEvidenceKind)));
  const allowedFamilies = new Set((input.decision?.allowedEvidenceKinds ?? [])
    .map(familyForEvidenceKind));

  for (const item of input.pack.items) {
    if (item.authority !== 'evidence') continue;
    // The final text assertion is deliberate: a pack item is not sufficient if
    // prompt assembly or a provider adapter later dropped it.
    if (!input.finalUserPrompt.includes(`id="${item.evidenceId}"`)) continue;
    const family = familyForSourceKind(item.sourceKind);
    if (family) countsByFamily[family] += 1;
  }

  const renderedFamilies = FAMILIES.filter((family) => countsByFamily[family] > 0);
  const forbiddenFamilies = input.decision
    ? renderedFamilies.filter((family) => !allowedFamilies.has(family))
    : [];
  const missing = requiredFamilies.filter((family) => countsByFamily[family] === 0);

  if (input.pack.answerPolicy === 'ask_clarification' || input.pack.answerPolicy === 'refuse_insufficient_evidence') {
    return {
      ok: false,
      reason: `answer_policy_${input.pack.answerPolicy}`,
      requiredFamilies,
      renderedFamilies,
      forbiddenFamilies,
      countsByFamily,
    };
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `missing_required_evidence_family:${missing.join(',')}`,
      requiredFamilies,
      renderedFamilies,
      forbiddenFamilies,
      countsByFamily,
    };
  }
  if (forbiddenFamilies.length > 0) {
    return {
      ok: false,
      reason: `forbidden_evidence_family_rendered:${forbiddenFamilies.join(',')}`,
      requiredFamilies,
      renderedFamilies,
      forbiddenFamilies,
      countsByFamily,
    };
  }
  return {
    ok: true,
    reason: 'ok',
    requiredFamilies,
    renderedFamilies,
    forbiddenFamilies,
    countsByFamily,
  };
}
