// electron/intelligence/context-os/types.ts
//
// Context OS (Phase 1) — canonical type layer for the Source Authority Kernel.
//
// The core architectural split this module encodes (current-state report §7):
// the legacy `AnswerType` collapses three independent axes — the SHAPE of the
// answer, the SOURCE it draws from, and the VOICE it speaks in — into one
// string. The Context OS separates them:
//
//   answerShape       — list / definition / numeric / methodology / …
//   sourceOwner       — which knowledge universe owns THIS turn
//   requestedProperty — what KIND of evidence proves the answer (funding ≠ collaboration)
//   voicePerspective  — first-person candidate / assistant explanation / …
//
// plus SourceCapability — the least-privilege grant that makes a wrong source
// IMPOSSIBLE to retrieve, not merely discouraged in prompt text.
//
// Phase 1 is types only: nothing here is wired into a live path. Downstream
// phases (kernel → orchestrator → prompt renderer → IPC) consume these.

import type { SourceKind } from './sourceKinds';

export type { SourceKind } from './sourceKinds';

// ── Answer shape (pure form, no source, no voice) ───────────────────────────

export type AnswerShape =
  | 'list'
  | 'definition'
  | 'comparison'
  | 'numeric'
  | 'methodology'
  | 'result'
  | 'follow_up'
  | 'refusal'
  | 'general';

// ── Source owner (which knowledge universe owns this turn) ──────────────────
//
// NOTE: richer than the legacy `sourceOwnership.SourceOwner` (5 values): adds
// 'reference_files' split from meeting_rag, plus first-class 'clarify' (the
// legacy resolver expresses clarify as a boolean side-channel).

export type SourceOwner =
  | 'reference_files'
  | 'profile'
  | 'transcript'
  | 'meeting_rag'
  | 'screen_context'
  | 'browser_dom'
  | 'long_term_memory'
  | 'mixed'
  | 'clarify'
  | 'unknown';

// ── Evidence authority (what a granted source may DO in the prompt) ─────────

export type EvidenceAuthority =
  | 'evidence'       // may be quoted / cited / used as fact
  | 'referent_only'  // may resolve pronouns; never a fact source
  | 'instruction'    // shapes behavior; never a fact source
  | 'style'          // tone/voice only
  | 'forbidden';     // must not enter the model call at all

// ── Requested property (what KIND of evidence proves the answer) ────────────

export type RequestedProperty =
  | 'phase_or_stage'
  | 'funding_source'
  | 'cost_or_price'
  | 'processor_or_controller'
  | 'dataset_size'
  | 'training_time'
  | 'cloud_provider'
  | 'human_participants'
  | 'methodology'
  | 'result_metric'
  | 'hardware_component'
  | 'software_stack'
  | 'candidate_project'
  | 'candidate_experience'
  | 'candidate_identity'
  | 'role_requirement'
  | 'document_structure'
  | 'document_metadata'
  | 'unknown';

// ── Voice perspective ────────────────────────────────────────────────────────

export type VoicePerspective =
  | 'first_person_candidate'
  | 'second_person_user'
  | 'student_presenter'
  | 'assistant_explanation'
  | 'third_person_summary';

// ── Trust levels ─────────────────────────────────────────────────────────────

export type TrustLevel =
  | 'system'
  | 'user_uploaded'
  | 'profile_verified'
  | 'profile_unverified'
  | 'transcript_observed'
  | 'memory_unverified'
  | 'memory_verified'
  | 'screen_untrusted'
  | 'browser_untrusted'
  | 'assistant_generated';

// ── Source capability (least-privilege grant, issued only by the kernel) ────

export interface SourceCapability {
  sourceKind: SourceKind;
  /** Scope the grant to one mode / meeting / file where applicable. */
  scopeId: string | null;
  authority: EvidenceAuthority;
  permissions: {
    retrieve: boolean;
    quote: boolean;
    useAsEvidence: boolean;
    useForReferentResolution: boolean;
    writeBackToMemory: boolean;
  };
  trustLevel: TrustLevel;
  pii: boolean;
  issuedBy: 'SourceAuthorityKernel';
  reason: string;
}

// ── Surfaces (every user-question lifecycle) ─────────────────────────────────

export type TurnSurface =
  | 'manual_chat'
  | 'what_to_answer'
  | 'suggestion'
  | 'phone_mirror'
  | 'recap'
  | 'follow_up'
  | 'meeting_summary';

// ── Mode source authority (mirrors the legacy SourceArbiter values 1:1 so the
//    kernel can be driven by the SAME sourceAuthority the 2026-07-06 contract
//    already computes — the two systems agree by construction) ───────────────

export type SourceAuthority =
  | 'reference_files_only'
  /** Real-custom-mode-repair: reference files own ambiguous nouns by default,
   *  but explicit résumé/JD/transcript switches are allowed for this turn
   *  (unlike `reference_files_only`, which forbids them). Mirrors
   *  ModeSourceContract.sourceAuthority in electron/services/modeSourceContract.ts. */
  | 'reference_files_primary'
  | 'reference_files_plus_transcript'
  | 'transcript_only'
  | 'profile_only'
  | 'profile_plus_transcript'
  | 'general_mixed'
  | 'ask_if_ambiguous';

export type ConflictPolicy =
  | 'reference_files_win'
  | 'profile_wins'
  | 'transcript_wins'
  | 'newest_timestamp_wins'
  | 'ask_clarification';

export type EnforcementMode = 'observe' | 'shadow_block' | 'enforce';

// ── The turn contract — one immutable object per user question ──────────────

export interface TurnContextContract {
  turnId: string;
  surface: TurnSurface;

  activeModeId: string | null;
  activeModeName?: string | null;

  answerShape: AnswerShape;
  sourceOwner: SourceOwner;
  requestedProperty: RequestedProperty;
  voicePerspective: VoicePerspective;

  allowedSources: SourceCapability[];
  forbiddenSources: SourceKind[];
  referentOnlySources: SourceKind[];

  conflictPolicy: ConflictPolicy;

  memoryReadPolicy: {
    allowHindsight: boolean;
    allowPriorAssistantFacts: boolean;
    allowPriorAssistantReferents: boolean;
  };

  memoryWritePolicy: {
    allowAssistantMessage: boolean;
    allowVerifiedClaims: boolean;
    allowUnverifiedClaims: boolean;
  };

  enforcement: EnforcementMode;
  reason: string;
}

// ── Contract helpers (pure; unit-tested in Phase 1) ──────────────────────────

/** The capability granted for a kind, or null when the contract forbids it. */
export function capabilityFor(
  contract: Pick<TurnContextContract, 'allowedSources'>,
  kind: SourceKind,
): SourceCapability | null {
  return contract.allowedSources.find((c) => c.sourceKind === kind) ?? null;
}

/** May `kind` be used as factual evidence under this contract? */
export function allowsEvidence(
  contract: Pick<TurnContextContract, 'allowedSources'>,
  kind: SourceKind,
): boolean {
  const cap = capabilityFor(contract, kind);
  return Boolean(cap && cap.authority === 'evidence' && cap.permissions.useAsEvidence);
}

/** May `kind` be retrieved at all (evidence OR referent OR instruction/style)? */
export function allowsRetrieval(
  contract: Pick<TurnContextContract, 'allowedSources'>,
  kind: SourceKind,
): boolean {
  const cap = capabilityFor(contract, kind);
  return Boolean(cap && cap.permissions.retrieve);
}

/** Is `kind` referent-only (pronoun resolution but never a fact source)? */
export function isReferentOnly(
  contract: Pick<TurnContextContract, 'allowedSources'>,
  kind: SourceKind,
): boolean {
  const cap = capabilityFor(contract, kind);
  return Boolean(cap && cap.authority === 'referent_only');
}
