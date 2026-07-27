// electron/llm/questionNeed.ts
//
// Phase 6 Slice 3 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
// "Slice 3"; design: 04_TARGET_ARCHITECTURE.md §3): a PURE derived label for
// telemetry/UI, never a gate. The spec's 8-value need taxonomy already
// exists, split across `AnswerPlanner.answerType` (~38 values) and
// `TurnPlanner.QuestionKind` (5 coarse buckets) — this is not a ninth
// taxonomy, it's a projection of `CanonicalTurn`'s ALREADY-RESOLVED fields
// (`resolvedQuestionKind`, from Slice 3's precedence rule) into the spec's
// named categories.
//
// Callers that need "may this turn use resume" ask
// isLayerAllowed(canonicalTurn.answerPlan, 'resume') (contextRoute.ts) —
// NEVER deriveQuestionNeed(...) === 'candidate_specific'. This separation is
// the discipline that was missing when KnowledgeOrchestrator's own intent
// taxonomy (IntentType.GENERAL/TECHNICAL/INTRO/...) was allowed to
// independently gate retrieval instead of being a label — see Slice 4's
// planned work retiring that gate.

import type { CanonicalTurn } from './resolveCanonicalTurn';

export type QuestionNeed =
  | 'general_knowledge'
  | 'candidate_specific'
  | 'job_specific'
  | 'candidate_job_synthesis'
  | 'reference_specific'
  | 'mixed_selected_sources'
  | 'follow_up'
  | 'unsupported';

// Résumé+JD synthesis answer types — both sources ground the SAME answer,
// in separate labelled blocks (never merged into candidate claims).
const SYNTHESIS_ANSWER_TYPES = new Set([
  'resume_jd_fit_answer',
  'resume_jd_gap_answer',
  'resume_jd_intro_answer',
  'jd_fit_answer',
  'gap_analysis_answer',
]);

const FOLLOW_UP_ANSWER_TYPES = new Set(['follow_up_answer', 'project_followup_answer']);

/**
 * Pure label derived from CanonicalTurn's already-computed fields. Never
 * itself consulted as a gate — see isLayerAllowed for the real gate.
 */
export function deriveQuestionNeed(canonicalTurn: CanonicalTurn): QuestionNeed {
  const answerType = canonicalTurn.answerPlan.answerType;

  if (FOLLOW_UP_ANSWER_TYPES.has(answerType)) return 'follow_up';
  if (answerType === 'unknown_answer') return 'unsupported';
  if (SYNTHESIS_ANSWER_TYPES.has(answerType)) return 'candidate_job_synthesis';

  // A comparison/synthesis turn that explicitly requested more than one
  // source family (e.g. "compare my resume to the JD requirements") — a
  // real, observed shape (resolveTurnSourceDecision's explicitRequests can
  // hold >1 entry) that the coarse questionKind bucket alone can't express.
  const explicitRequestCount = canonicalTurn.turnSourceDecision?.explicitRequests?.length ?? 0;
  if (explicitRequestCount > 1) return 'mixed_selected_sources';

  switch (canonicalTurn.resolvedQuestionKind) {
    case 'profile_question':
      return 'candidate_specific';
    case 'jd_question':
      return 'job_specific';
    case 'doc_question':
      return 'reference_specific';
    case 'coding_question':
    case 'general':
    default:
      return 'general_knowledge';
  }
}
