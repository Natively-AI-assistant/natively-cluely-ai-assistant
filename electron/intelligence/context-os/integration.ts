// electron/intelligence/context-os/integration.ts
//
// Context OS (Phase 7/8) — the thin adapter between the legacy planning layer
// (AnswerPlanner's AnswerType, buildCustomModeExecutionContract's
// sourceAuthority) and the SourceAuthorityKernel. All the "map legacy value X
// to canonical value Y" logic lives HERE so the IPC handler / engine diffs
// stay small and reviewable.
//
// Everything is flag-gated: `buildTurnContractIfEnabled` returns null unless
// contextOsEnabled + the surface flag are on, so wiring it into a hot path is
// behavior-neutral until the flags flip.

import { isIntelligenceFlagEnabled } from '../intelligenceFlags';
import { SourceAuthorityKernel, type BuildTurnContractInput } from './SourceAuthorityKernel';
import type {
  AnswerShape,
  EnforcementMode,
  SourceAuthority,
  TurnContextContract,
  TurnSurface,
  VoicePerspective,
} from './types';

// ── AnswerType → AnswerShape (the shape axis of the 3-way split) ─────────────

/**
 * Extract the SHAPE axis from a legacy AnswerType. This never carries source
 * or voice — those axes come from the kernel and the planner respectively.
 */
export function mapAnswerTypeToAnswerShape(answerType: string | null | undefined): AnswerShape {
  switch (answerType) {
    case 'list_answer':
    case 'skills_answer':
    case 'jd_requirements_answer':
      return 'list';
    case 'definitional_answer':
    case 'technical_concept_answer':
      return 'definition';
    case 'jd_fit_answer':
    case 'resume_jd_fit_answer':
    case 'resume_jd_gap_answer':
    case 'gap_analysis_answer':
      return 'comparison';
    case 'exact_numeric_answer':
      return 'numeric';
    case 'system_design_answer':
    case 'coding_question_answer':
    case 'dsa_question_answer':
    case 'debugging_question_answer':
      return 'methodology';
    case 'document_followup_answer':
    case 'follow_up_answer':
    case 'project_followup_answer':
      return 'follow_up';
    case 'document_absent_fact_refusal':
    case 'ethical_usage_answer':
      return 'refusal';
    default:
      return 'general';
  }
}

// ── Planner voice → canonical voice ──────────────────────────────────────────

export function mapPlannerVoice(voice: string | null | undefined): VoicePerspective {
  switch (voice) {
    case 'first_person_candidate':
    case 'second_person_user':
    case 'third_person_summary':
      return voice;
    case 'student_presenter':
      return 'student_presenter';
    case 'assistant_explanation':
    default:
      return 'assistant_explanation';
  }
}

// ── Surface flag gating ──────────────────────────────────────────────────────

const SURFACE_FLAG: Partial<Record<TurnSurface, 'contextOsManualChatEnabled' | 'contextOsWtaEnabled' | 'contextOsRecapFollowupEnabled'>> = {
  manual_chat: 'contextOsManualChatEnabled',
  phone_mirror: 'contextOsManualChatEnabled', // phone mirror rides the manual path
  what_to_answer: 'contextOsWtaEnabled',
  suggestion: 'contextOsWtaEnabled',
  recap: 'contextOsRecapFollowupEnabled',
  follow_up: 'contextOsRecapFollowupEnabled',
  meeting_summary: 'contextOsRecapFollowupEnabled',
};

export function isContextOsEnabledForSurface(surface: TurnSurface): boolean {
  if (!isIntelligenceFlagEnabled('contextOsEnabled')) return false;
  const flag = SURFACE_FLAG[surface];
  return flag ? isIntelligenceFlagEnabled(flag) : false;
}

/** The rollout stage for Context OS decisions on this turn. */
export function contextOsEnforcementMode(): EnforcementMode {
  if (isIntelligenceFlagEnabled('contextOsEnforceSourceCapabilities')) return 'enforce';
  return 'observe';
}

// ── One-call contract builder for the IPC/engine wiring ─────────────────────

const kernel = new SourceAuthorityKernel();

export interface BuildTurnContractForSurfaceInput {
  surface: TurnSurface;
  question: string;
  activeModeId: string | null;
  activeModeName?: string | null;
  /** From buildCustomModeExecutionContract(...).sourceAuthority. */
  sourceAuthority: string | null | undefined;
  answerType: string | null | undefined;
  plannerVoicePerspective?: string | null;
  hasReferenceFiles: boolean;
  hasProfileFacts: boolean;
  hasLiveTranscript: boolean;
  userExplicitSource?: BuildTurnContractInput['userExplicitSource'];
}

function normalizeSourceAuthority(value: string | null | undefined): SourceAuthority {
  switch (value) {
    case 'reference_files_only':
    case 'reference_files_plus_transcript':
    case 'transcript_only':
    case 'profile_only':
    case 'profile_plus_transcript':
    case 'general_mixed':
    case 'ask_if_ambiguous':
      return value;
    default:
      return 'ask_if_ambiguous';
  }
}

/** Build the contract unconditionally (tests + shadow comparisons). */
export function buildTurnContractForSurface(input: BuildTurnContractForSurfaceInput): TurnContextContract {
  return kernel.build({
    surface: input.surface,
    question: input.question,
    activeModeId: input.activeModeId,
    activeModeName: input.activeModeName ?? null,
    sourceAuthority: normalizeSourceAuthority(input.sourceAuthority),
    answerShape: mapAnswerTypeToAnswerShape(input.answerType),
    voicePerspective: mapPlannerVoice(input.plannerVoicePerspective),
    enforcement: contextOsEnforcementMode(),
    hasReferenceFiles: input.hasReferenceFiles,
    hasProfileFacts: input.hasProfileFacts,
    hasLiveTranscript: input.hasLiveTranscript,
    userExplicitSource: input.userExplicitSource ?? null,
  });
}

/**
 * Flag-gated builder for hot paths: null when Context OS is off for this
 * surface, so callers can fall through to legacy behavior with `if (!c)`.
 * Never throws (a kernel bug must not break an answer).
 */
export function buildTurnContractIfEnabled(input: BuildTurnContractForSurfaceInput): TurnContextContract | null {
  try {
    if (!isContextOsEnabledForSurface(input.surface)) return null;
    return buildTurnContractForSurface(input);
  } catch {
    return null;
  }
}

/**
 * True when the contract should actively BLOCK (not just log) a forbidden
 * path. observe mode never blocks; enforce blocks.
 */
export function contractBlocks(contract: Pick<TurnContextContract, 'enforcement'> | null | undefined): boolean {
  return Boolean(contract && contract.enforcement === 'enforce');
}

// ── Authority-contradiction guard (real-custom-mode-repair, Phase 4/7) ──────
//
// The incident investigation found an apparent contradiction in the trace:
// `sourceOwner=clarify` next to `finalAction=answer` on the same turn. Root
// cause turned out to be a MISLEADING TRACE (a hardcoded provisional value
// logged before the clarification decision ran — fixed at the ipcHandlers.ts
// call site), not a genuine three-way authority disagreement — see
// docs/context-os/real-custom-mode-repair/04_AUTHORITY_CONFLICT_REPORT.md.
//
// This assertion is a development/test-only tripwire against a REAL
// regression of that class: it fires when enforcement is armed AND the
// kernel decided `sourceOwner === 'clarify'` AND the caller nonetheless
// recorded `finalAction === 'answer'` — i.e. a turn where Context OS
// determined a clarification was required, enforcement was ON, and the
// pipeline answered anyway. Never called in production hot paths; wire it
// into tests and dev-only post-turn checks.
export interface AuthorityContradictionCheck {
  contract: Pick<TurnContextContract, 'sourceOwner' | 'enforcement'>;
  finalAction: 'answer' | 'refuse_insufficient_evidence' | 'clarify' | 'fallback';
}

export function assertNoAuthorityContradiction(check: AuthorityContradictionCheck): void {
  const { contract, finalAction } = check;
  if (contract.enforcement === 'enforce' && contract.sourceOwner === 'clarify' && finalAction === 'answer') {
    throw new Error(
      '[CONTEXT-OS] authority contradiction: sourceOwner=clarify under enforce, but finalAction=answer. '
      + 'A clarify decision under enforcement must never fall through to answer — see '
      + 'docs/context-os/real-custom-mode-repair/04_AUTHORITY_CONFLICT_REPORT.md',
    );
  }
}
