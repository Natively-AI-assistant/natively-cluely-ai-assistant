// electron/intelligence/LiveMomentRouter.ts
//
// A single moment-level router for live answers. This is authoritative for the
// NEW surface area — the live_moment_action taxonomy, speakability target, and
// marker-only telemetry — while deliberately delegating the fine-grained
// AnswerType to the existing, benchmark-green planAnswer cascade so profile
// grounding, voice, and leak boundaries stay byte-identical.
//
// Pure, deterministic, no I/O, no profile strings.

import type { IntentResult } from '../llm/IntentClassifier';
import {
  planAnswer,
  detectExplicitCodingContract,
  isCodingContinuation,
  isRefinementFollowUp,
  classifyTargetSpeakability,
  type AnswerPlan,
  type AnswerSource,
  type AnswerType,
  type ContextLayer,
  type ExplicitCodingContract,
  type SpeakerPerspective,
  type SpeakabilityTarget,
} from '../llm';
import type { ExtractedQuestion } from '../llm/transcriptQuestionExtractor';
import type { ActiveModeInfo } from '../llm/modeProfiles';

export type LiveMomentAction =
  | 'DIRECT_ANSWER'
  | 'WHAT_TO_SAY'
  | 'CODING_OR_SCREEN_PROBLEM'
  | 'TECHNICAL_EXPLANATION'
  | 'BEHAVIORAL_OR_PROFILE_ANSWER'
  | 'OBJECTION_OR_NEGOTIATION'
  | 'FOLLOW_UP_OR_REFINEMENT'
  | 'TERM_OR_CONTEXT_CLARIFICATION'
  | 'MEETING_MEMORY_OR_RECAP'
  | 'LECTURE_OR_NOTES'
  | 'UI_OR_STEP_BY_STEP_HELP'
  | 'PASSIVE_OR_UNCLEAR';

export type SpokenOrStructured = 'spoken' | 'structured';

export interface LiveMomentRouteInput {
  question: string;
  source: AnswerSource;
  speakerPerspective: SpeakerPerspective;
  extractedQuestion?: ExtractedQuestion;
  intentResult?: IntentResult;
  hasCandidateProfile?: boolean;
  activeMode?: ActiveModeInfo | null;
}

export interface LiveMomentDecision {
  action: LiveMomentAction;
  confidence: number;
  answerType: AnswerType;
  answerStyle: AnswerPlan['answerStyle'];
  speakabilityTarget: SpeakabilityTarget;
  spokenOrStructured: SpokenOrStructured;
  explicitCodingContract: ExplicitCodingContract;
  isCodingContinuation: boolean;
  isRefinement: boolean;
  activeMode: string;
  reason: string;
  contextLayersHint: ContextLayer[];
  intentSignal?: string;
  /** Future seam for a true answerType override; intentionally dark in v1. */
  answerTypeOverride?: AnswerType;
}

const PROFILE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set([
  'identity_answer', 'profile_fact_answer', 'project_answer', 'skills_answer',
  'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
  'gap_analysis_answer', 'behavioral_interview_answer', 'project_followup_answer',
  'product_candidate_mix_answer', 'project_about_answer',
]);

const CODING_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer', 'debugging_question_answer',
]);

const STRUCTURED_TARGETS: ReadonlySet<SpeakabilityTarget> = new Set(['STRUCTURED_FULL']);

function modeLabel(activeMode?: ActiveModeInfo | null): string {
  return activeMode?.templateType || activeMode?.id || 'none';
}

function actionForAnswerType(answerType: AnswerType, isRefinement: boolean): LiveMomentAction {
  if (CODING_ANSWER_TYPES.has(answerType)) return 'CODING_OR_SCREEN_PROBLEM';
  if (answerType === 'technical_concept_answer') return 'TECHNICAL_EXPLANATION';
  if (PROFILE_ANSWER_TYPES.has(answerType)) return 'BEHAVIORAL_OR_PROFILE_ANSWER';
  if (answerType === 'negotiation_answer' || answerType === 'sales_answer') return 'OBJECTION_OR_NEGOTIATION';
  if (answerType === 'lecture_answer') return 'LECTURE_OR_NOTES';
  if (answerType === 'follow_up_answer') return isRefinement ? 'FOLLOW_UP_OR_REFINEMENT' : 'DIRECT_ANSWER';
  if (answerType === 'general_meeting_answer') return 'MEETING_MEMORY_OR_RECAP';
  if (answerType === 'project_link_answer' || answerType === 'source_code_evidence_answer' || answerType === 'ethical_usage_answer') return 'DIRECT_ANSWER';
  if (answerType === 'unknown_answer') return 'PASSIVE_OR_UNCLEAR';
  return 'DIRECT_ANSWER';
}

function spokenOrStructuredFor(target: SpeakabilityTarget): SpokenOrStructured {
  return STRUCTURED_TARGETS.has(target) ? 'structured' : 'spoken';
}

function contextLayersFor(plan: AnswerPlan): ContextLayer[] {
  return Array.from(new Set(plan.requiredContextLayers || []));
}

export function routeLiveMoment(input: LiveMomentRouteInput): LiveMomentDecision {
  const question = input.question || '';
  const plan = planAnswer({
    question,
    source: input.source,
    speakerPerspective: input.speakerPerspective,
    extractedQuestion: input.extractedQuestion,
    intentResult: input.intentResult,
    hasCandidateProfile: input.hasCandidateProfile,
    activeMode: input.activeMode || undefined,
  });
  const explicitCodingContract = detectExplicitCodingContract(question);
  const refinement = isRefinementFollowUp(question);
  const codingContinuation = isCodingContinuation(question);
  const target = classifyTargetSpeakability(plan.answerType, plan.answerStyle, question);
  const action = actionForAnswerType(plan.answerType, refinement);

  return {
    action,
    confidence: plan.confidence,
    answerType: plan.answerType,
    answerStyle: plan.answerStyle,
    speakabilityTarget: target,
    spokenOrStructured: spokenOrStructuredFor(target),
    explicitCodingContract,
    isCodingContinuation: codingContinuation,
    isRefinement: refinement,
    activeMode: modeLabel(input.activeMode),
    reason: input.intentResult ? `answer_type:${plan.answerType};intent:${input.intentResult.intent}` : `answer_type:${plan.answerType}`,
    contextLayersHint: contextLayersFor(plan),
    intentSignal: input.intentResult?.intent,
  };
}

export function promoteForCodingFollowup(
  base: LiveMomentDecision,
  opts: { priorCodingTurnExists: boolean; isOriginalProblemQuery: boolean; explicitCodingContract?: ExplicitCodingContract },
): LiveMomentDecision {
  if (!opts.priorCodingTurnExists) return base;
  const explicitCodingContract = opts.isOriginalProblemQuery ? 'explain_only' : (opts.explicitCodingContract ?? base.explicitCodingContract);
  const target: SpeakabilityTarget = explicitCodingContract === 'explain_only' ? 'SPOKEN_SHORT' : 'STRUCTURED_FULL';
  return {
    ...base,
    action: 'CODING_OR_SCREEN_PROBLEM',
    speakabilityTarget: target,
    spokenOrStructured: spokenOrStructuredFor(target),
    explicitCodingContract,
    reason: opts.isOriginalProblemQuery ? 'coding_original_problem_recall' : 'coding_followup_prior_problem',
    contextLayersHint: Array.from(new Set([...base.contextLayersHint, 'prior_assistant_responses' as ContextLayer])),
  };
}
