// electron/services/modePolicy.ts
//
// Phase 6 (context-rebuild) — `ModePolicy`, per `04_TARGET_ARCHITECTURE.md`
// §2. A NEW, thin, PURE projection over two modules the Responsibility
// Matrix already recommends retaining as-is: `modeSourceContract.ts` (§7,
// "retain as-is... not itself part of the three-decision-maker
// contradiction") and the persona/mode-config surface `ContextRouter.ts`
// already reads. No retrieval, no LLM call — resolveModePolicy is a pure
// function of its two inputs.
//
// BUILT STANDALONE, NOT WIRED anywhere in this pass: this is the missing
// foundation Slice 7's items 2/3 (rewiring `memoryReadPolicy`'s read source
// to `CanonicalTurn`/`ModePolicy`) were blocked on — no `ModePolicy` object
// existed anywhere in the codebase before this file. Building it here
// unblocks a FUTURE promotion pass; it does not itself change any live
// behavior, mirroring the exact "build the pure function, test it, defer
// wiring" precedent already established for `promptComposer.ts` (Slice 2)
// and `questionNeed.ts` (Slice 3).
//
// Its job is purely naming/shape consolidation: downstream components
// (QuestionNeedClassifier, PromptComposer) get one typed read instead of
// reading `ModeSourceContract` and mode-config separately with ad hoc
// field mapping at each call site. It does NOT decide per-question
// relevance — that remains QuestionNeedClassifier's job.

import {
  documentGroundedFromContract,
  type ModeSourceAuthority,
  type ModeSourceContract,
  type ModeSourceSwitch,
} from './modeSourceContract';
import { DEFAULT_GROUNDING_PROFILE, SEMINAR_GROUNDING_PROFILE, type GroundingProfile } from '../llm/TurnPlanner';
import type { SourceKind } from '../intelligence/context-os/sourceKinds';

export interface ModePolicy {
  modeId: string;
  modeName: string;
  isCustomMode: boolean;
  documentGroundedCustomModeActive: boolean;

  /** Persisted mode-level default — does NOT vary per question. */
  sourceAuthority: ModeSourceAuthority;
  allowedExplicitSwitches: readonly ModeSourceSwitch[];

  /** Coarse allow-list, derived from sourceAuthority; NOT per-question relevance. */
  allowedSourceKinds: readonly SourceKind[];

  generalKnowledgeAllowed: boolean;
  personaPrompt?: string;
  referenceOnly: boolean;

  /** Per-mode strictness for "no evidence found" behavior (Campaign-3 TurnPlanner). */
  groundingProfile: GroundingProfile;
}

/**
 * Coarse, mode-level source-kind allow-list for a given `sourceAuthority`.
 * Deliberately conservative and NOT per-question — a downstream retrieval
 * stage still applies its own finer-grained (`isLayerAllowed`,
 * per-question) gate; this is only the mode's static ceiling.
 */
function allowedSourceKindsFor(sourceAuthority: ModeSourceAuthority): readonly SourceKind[] {
  switch (sourceAuthority) {
    case 'reference_files_only':
      return ['mode_reference_file', 'mode_reference_chunk', 'okf_document_card'];
    case 'reference_files_primary':
    case 'reference_files_plus_transcript':
      return [
        'mode_reference_file', 'mode_reference_chunk', 'okf_document_card',
        'live_transcript', 'meeting_rag_chunk',
      ];
    case 'profile_only':
      return [
        'profile_resume', 'profile_project', 'profile_jd', 'profile_persona',
        'custom_profile_notes', 'okf_profile_card',
      ];
    case 'profile_plus_transcript':
      return [
        'profile_resume', 'profile_project', 'profile_jd', 'profile_persona',
        'custom_profile_notes', 'okf_profile_card',
        'live_transcript', 'meeting_rag_chunk',
      ];
    case 'transcript_only':
      return ['live_transcript', 'meeting_rag_chunk'];
    case 'general_mixed':
    case 'ask_if_ambiguous':
    default:
      return [
        'profile_resume', 'profile_project', 'profile_jd', 'profile_persona',
        'custom_profile_notes', 'okf_profile_card',
        'mode_reference_file', 'mode_reference_chunk', 'okf_document_card',
        'live_transcript', 'meeting_rag_chunk',
      ];
  }
}

/**
 * A mode's `sourceAuthority` permits answering from the model's own general
 * knowledge (as opposed to strictly requiring uploaded/profile evidence)
 * unless it is one of the reference-file-only/transcript-only authorities
 * that this codebase's own strict-isolation invariant (docGroundedStrictIsolation)
 * treats as evidence-required.
 */
function generalKnowledgeAllowedFor(sourceAuthority: ModeSourceAuthority): boolean {
  return sourceAuthority !== 'reference_files_only'
    && sourceAuthority !== 'transcript_only';
}

/**
 * Mirrors TurnPlanner.groundingProfileFor's resolution order EXACTLY
 * (explicit contract override → seminar templateType → default) — see that
 * function's own doc comment for the full precedence rationale. `templateType`
 * is NOT a `ModeSourceContract` field (confirmed: TurnPlanInput's own
 * `sourceContract` shape supplies it as a sibling of `Pick<ModeSourceContract,
 * 'sourceAuthority'>`, not from the contract itself), so it is threaded
 * through via `mode.templateType` here, matching that established shape.
 */
function resolveGroundingProfile(
  contract: Pick<ModeSourceContract, 'groundingProfile'>,
  mode: { templateType?: string },
): GroundingProfile {
  if (contract.groundingProfile) return contract.groundingProfile;
  if (mode.templateType === 'seminar') return SEMINAR_GROUNDING_PROFILE;
  return DEFAULT_GROUNDING_PROFILE;
}

export interface ResolveModePolicyModeInput {
  id: string;
  name: string;
  isCustom: boolean;
  personaPrompt?: string;
  hasReferenceFiles?: boolean;
  /** Campaign-3 seminar-template signal — see resolveGroundingProfile's doc comment. */
  templateType?: string;
}

/** Pure projection — no retrieval, no LLM call. */
export function resolveModePolicy(
  contract: ModeSourceContract,
  mode: ResolveModePolicyModeInput,
): ModePolicy {
  const allowedSourceKinds = allowedSourceKindsFor(contract.sourceAuthority);
  return {
    modeId: mode.id,
    modeName: mode.name,
    isCustomMode: mode.isCustom,
    documentGroundedCustomModeActive: documentGroundedFromContract(contract, Boolean(mode.hasReferenceFiles)),
    sourceAuthority: contract.sourceAuthority,
    allowedExplicitSwitches: contract.allowedExplicitSwitches,
    allowedSourceKinds,
    generalKnowledgeAllowed: generalKnowledgeAllowedFor(contract.sourceAuthority),
    personaPrompt: mode.personaPrompt,
    referenceOnly: contract.sourceAuthority === 'reference_files_only',
    groundingProfile: resolveGroundingProfile(contract, mode),
  };
}
