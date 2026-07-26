// electron/llm/resolveCanonicalTurn.ts
//
// The migration seam for a canonical interview-answer turn. This facade is
// intentionally pure and has no production call sites yet: it proves that the
// existing answer classifier, source-policy resolver, and TurnPlanner can be
// composed once from a request snapshot before any live surface is migrated.
//
// Important: this is not another source authority. `planAnswer` remains the
// answer-type classifier and `resolveTurnSourceDecision` remains the source
// authority. This facade freezes their one-time outputs so later retrieval and
// execution phases cannot recompute or widen a turn after dispatch starts.

import {
  planAnswer,
  type AnswerPlan,
  type PlanAnswerInput,
} from './AnswerPlanner';
import {
  planTurn,
  type TurnPlan,
  type TurnPlanInput,
} from './TurnPlanner';
import {
  resolveTurnSourceDecision,
  type ExplicitSourceSwitch,
  type TurnEvidenceKind,
  type TurnSourceAvailability,
  type TurnSourceDecision,
} from './turnSourceDecision';
import type { ModeSourceAuthority, ModeSourceContract, ModeSourceSwitch } from '../services/modeSourceContract';

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
}

/**
 * The immutable semantic/source decision that later canonical phases consume.
 * The narrow source projections prevent downstream callers from rediscovering
 * allow/require sets from a different authority.
 */
export interface CanonicalTurn {
  readonly answerPlan: AnswerPlan;
  readonly turnSourceDecision: TurnSourceDecision | null;
  readonly turnPlan: TurnPlan;
  readonly sourceAuthority: ModeSourceAuthority | null;
  readonly allowedEvidenceKinds: readonly TurnEvidenceKind[];
  readonly requiredEvidenceKinds: readonly TurnEvidenceKind[];
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
  const turnPlan = planTurn({
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

  const canonicalTurn: CanonicalTurn = {
    answerPlan: copyAnswerPlan(answerPlan),
    turnSourceDecision: turnSourceDecision ? copyTurnSourceDecision(turnSourceDecision) : null,
    turnPlan: copyTurnPlan(turnPlan),
    sourceAuthority: turnSourceDecision?.sourceAuthority ?? turnPlan.sourceAuthoritySignal,
    allowedEvidenceKinds: [...(turnSourceDecision?.allowedEvidenceKinds ?? [])],
    requiredEvidenceKinds: [...(turnSourceDecision?.requiredEvidenceKinds ?? [])],
  };

  return deepFreeze(canonicalTurn);
}
