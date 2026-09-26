// electron/llm/resolveCanonicalTurn.ts
//
// The migration seam for a canonical interview-answer turn: composes the
// existing answer classifier, source-policy resolver, and TurnPlanner once
// from a request snapshot. As of Phase 6 Slice 1 it has a real production
// call site (IntelligenceEngine.ts's WTA path, "observe-only for this first
// migration") — the header comment previously said "no production call
// sites yet"; that is now stale and corrected here (found during Slice 3,
// context-rebuild, 2026-07-25).
//
// Important: this is not another source authority. `planAnswer` remains the
// answer-type classifier and `resolveTurnSourceDecision` remains the source
// authority. This facade freezes their one-time outputs so later retrieval and
// execution phases cannot recompute or widen a turn after dispatch starts.
//
// Phase 6 Slice 3 additions (context-rebuild, target arch §0 items 1/3):
//   - `turnId`: accepts the caller's TurnIdentity.turnId instead of minting
//     its own, mirroring SourceAuthorityKernel.build's Slice 1 fix — so a
//     CanonicalTurn's turnId and a TurnContextContract's turnId are, by
//     construction, the same value for the same turn.
//   - `resolvedQuestionKind`/`resolvedQuestionKindSource`: the explicit
//     precedence rule between `answerPlan.answerType` and
//     `turnPlan.questionKind` (03_ROUTING_AND_RETRIEVAL_AUDIT.md §A.5 item 3
//     confirmed these two fields can disagree with no stated tie-break).
//     Rule: `turnPlan.questionKind` wins whenever `planTurn` computes
//     successfully (it already reconciles with `answerType` internally, see
//     TurnPlanner.ts's `deriveQuestionKind`); `answerPlan.answerType`
//     (mapped to the same coarse bucket via `mapAnswerTypeToQuestionKind`)
//     is authoritative only when `planTurn` throws — the exact failure mode
//     its WTA `try/catch` precedent exists for. `planTurn` is now called
//     inside a try/catch HERE (not duplicated at every call site) so every
//     consumer of `resolveCanonicalTurn` — including the existing WTA call
//     site, which was calling this function completely unguarded before
//     this fix — gets the same protection automatically.

import {
  planAnswer,
  type AnswerPlan,
  type PlanAnswerInput,
} from './AnswerPlanner';
import {
  planTurn,
  mapAnswerTypeToQuestionKind,
  DEFAULT_GROUNDING_PROFILE,
  type TurnPlan,
  type TurnPlanInput,
  type QuestionKind,
} from './TurnPlanner';
import {
  resolveTurnSourceDecision,
  type ExplicitSourceSwitch,
  type TurnEvidenceKind,
  type TurnSourceAvailability,
  type TurnSourceDecision,
} from './turnSourceDecision';
import type { ModeSourceAuthority, ModeSourceContract, ModeSourceSwitch } from '../services/modeSourceContract';
import { mintTurnId, type TurnId } from './turnIdentity';

/**
 * The snapshot-safe inputs needed to derive a canonical decision. Callers own
 * parsing explicit source requests and reading persisted mode data; this
 * module reads neither settings nor singleton state.
 */
export interface CanonicalTurnInput {
  /** Complete input for the established answer-type classifier. */
  answerInput: PlanAnswerInput;
  /**
   * Persisted source policy. Its absence deliberately preserves the legacy
   * no-contract path: no source decision is invented by this facade.
   */
  sourceContract?: (
    Pick<ModeSourceContract,
      'defaultOwner' | 'sourceAuthority' | 'groundingProfile'>
    & { readonly allowedExplicitSwitches: readonly ModeSourceSwitch[]; templateType?: string }
  ) | null;
  /** Explicit source family already parsed by the caller. */
  explicitRequest?: ExplicitSourceSwitch;
  /** All explicit source families for a comparison/synthesis request. */
  explicitRequests?: Exclude<ExplicitSourceSwitch, null>[];
  /** Complete source availability snapshot, including meeting RAG. */
  availability: TurnSourceAvailability;
  /**
   * Phase 6 Slice 3 (context-rebuild, 2026-07-25): the caller's own
   * TurnIdentity.turnId (electron/llm/turnIdentity.ts). When supplied,
   * used verbatim instead of minting a fresh one — mirrors
   * SourceAuthorityKernel.build's Slice 1 fix. Optional — existing callers
   * (the WTA observe-only path) keep getting a freshly-minted turnId until
   * updated.
   */
  turnId?: TurnId;
}

/**
 * The immutable semantic/source decision that later canonical phases consume.
 * The narrow source projections prevent downstream callers from rediscovering
 * allow/require sets from a different authority.
 */
export interface CanonicalTurn {
  /** Phase 6 Slice 3: same value as the caller's TurnIdentity.turnId when supplied, else freshly minted. */
  readonly turnId: TurnId;
  readonly answerPlan: AnswerPlan;
  readonly turnSourceDecision: TurnSourceDecision | null;
  readonly turnPlan: TurnPlan;
  /** True when `planTurn` threw and `turnPlan` below is the safe fallback default, not a real computation. */
  readonly turnPlanFailed: boolean;
  readonly sourceAuthority: ModeSourceAuthority | null;
  readonly allowedEvidenceKinds: readonly TurnEvidenceKind[];
  readonly requiredEvidenceKinds: readonly TurnEvidenceKind[];
  /**
   * The precedence-resolved question-kind label (target arch §0 item 3) — a
   * PURE LABEL for telemetry/UI (electron/llm/questionNeed.ts), never a gate:
   * no retrieval/generation decision may branch on this field directly.
   */
  readonly resolvedQuestionKind: QuestionKind;
  /** Which signal `resolvedQuestionKind` came from — content-free, safe to log. */
  readonly resolvedQuestionKindSource: 'turn_plan' | 'answer_plan_fallback';
}

function copyAnswerPlan(plan: AnswerPlan): AnswerPlan {
  return {
    ...plan,
    requiredContextLayers: [...plan.requiredContextLayers],
    forbiddenContextLayers: [...plan.forbiddenContextLayers],
  };
}

function copyTurnSourceDecision(decision: TurnSourceDecision): TurnSourceDecision {
  return {
    ...decision,
    allowedExplicitSwitches: [...decision.allowedExplicitSwitches],
    explicitRequests: [...decision.explicitRequests],
    allowedEvidenceKinds: [...decision.allowedEvidenceKinds],
    requiredEvidenceKinds: [...decision.requiredEvidenceKinds],
  };
}

function copyTurnPlan(plan: TurnPlan): TurnPlan {
  return {
    ...plan,
    evidenceSourcesToProbe: [...plan.evidenceSourcesToProbe],
    groundingProfile: { ...plan.groundingProfile },
    answerDirectives: { ...plan.answerDirectives },
  };
}

/** Freeze a cloned result without freezing caller input or module defaults. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const nested = (value as Record<PropertyKey, unknown>)[key];
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function toTurnPlannerSourceContract(
  sourceContract: CanonicalTurnInput['sourceContract'],
): TurnPlanInput['sourceContract'] {
  if (!sourceContract) return null;
  return {
    sourceAuthority: sourceContract.sourceAuthority,
    groundingProfile: sourceContract.groundingProfile,
    templateType: sourceContract.templateType,
  };
}

/**
 * Resolve the existing pure decision helpers exactly once from one request
 * snapshot. This intentionally does not build Context OS or custom-mode
 * execution contracts yet: those remain compatibility adapters until their
 * live callers migrate to this frozen seam.
 */
// Safe fallback TurnPlan when `planTurn` throws (target arch §0 item 3's
// "answerPlan.answerType is authoritative when turnPlan computation failed"
// branch). Mirrors the WTA try/catch precedent's own `_c3TurnPlan = null`
// pattern, but a fully-shaped, never-null object — every `CanonicalTurn`
// consumer can read `canonicalTurn.turnPlan.*` unconditionally, checking
// `turnPlanFailed` only if it cares WHY the plan is the safe default.
function safeFallbackTurnPlan(question: string): TurnPlan {
  return {
    question,
    questionKind: 'general',
    evidenceSourcesToProbe: [],
    groundingProfile: { ...DEFAULT_GROUNDING_PROFILE },
    answerDirectives: {
      candidateIdentityOverride: null,
      labelGeneral: true,
      seminarNotFoundPreamble: false,
      seedCandidateBackground: false,
    },
    sourceAuthoritySignal: null,
    reasonCode: 'turn_plan_failed_safe_fallback',
  };
}

export function resolveCanonicalTurn(input: CanonicalTurnInput): CanonicalTurn {
  const answerPlan = planAnswer(input.answerInput);
  const turnSourceDecision = input.sourceContract
    ? resolveTurnSourceDecision({
      sourceContract: {
        ...input.sourceContract,
        allowedExplicitSwitches: [...input.sourceContract.allowedExplicitSwitches],
      },
      explicitRequest: input.explicitRequest,
      explicitRequests: input.explicitRequests,
      availability: input.availability,
    })
    : null;

  // Precedence rule (target arch §0 item 3): planTurn is called inside a
  // try/catch HERE so every consumer of resolveCanonicalTurn is protected —
  // not just a new call site that duplicates its own guard. On success,
  // turnPlan.questionKind already reconciles with answerType internally
  // (TurnPlanner.ts's deriveQuestionKind) and wins outright. On failure, the
  // safe fallback's questionKind is 'general' by construction — the REAL
  // fallback signal is resolvedQuestionKind below, derived independently
  // from answerPlan.answerType via mapAnswerTypeToQuestionKind.
  let turnPlan: TurnPlan;
  let turnPlanFailed = false;
  try {
    turnPlan = planTurn({
      question: answerPlan.question,
      answerType: answerPlan.answerType,
      intent: input.answerInput.intentResult?.intent ?? null,
      turnSourceDecision,
      sourceContract: toTurnPlannerSourceContract(input.sourceContract),
      availability: {
        hasReferenceFiles: input.availability.hasReferenceFiles,
        hasProfileFacts: input.availability.hasProfileFacts,
        hasJobDescription: input.availability.hasJobDescription,
        hasLiveTranscript: input.availability.hasLiveTranscript,
      },
    });
  } catch {
    turnPlanFailed = true;
    turnPlan = safeFallbackTurnPlan(answerPlan.question);
  }

  const resolvedQuestionKind: QuestionKind = turnPlanFailed
    ? (mapAnswerTypeToQuestionKind(answerPlan.answerType) ?? 'general')
    : turnPlan.questionKind;
  const resolvedQuestionKindSource: 'turn_plan' | 'answer_plan_fallback' =
    turnPlanFailed ? 'answer_plan_fallback' : 'turn_plan';

  const canonicalTurn: CanonicalTurn = {
    turnId: input.turnId ?? mintTurnId(),
    answerPlan: copyAnswerPlan(answerPlan),
    turnSourceDecision: turnSourceDecision ? copyTurnSourceDecision(turnSourceDecision) : null,
    turnPlan: copyTurnPlan(turnPlan),
    turnPlanFailed,
    sourceAuthority: turnSourceDecision?.sourceAuthority ?? turnPlan.sourceAuthoritySignal,
    allowedEvidenceKinds: [...(turnSourceDecision?.allowedEvidenceKinds ?? [])],
    requiredEvidenceKinds: [...(turnSourceDecision?.requiredEvidenceKinds ?? [])],
    resolvedQuestionKind,
    resolvedQuestionKindSource,
  };

  return deepFreeze(canonicalTurn);
}
