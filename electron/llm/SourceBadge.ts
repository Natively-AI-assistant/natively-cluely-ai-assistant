// electron/llm/SourceBadge.ts
//
// Campaign-3 (fix/answer-policy-engine, 2026-07-19, founder §2.6):
// Source badge helper for the overlay. Every answer carries a visible
// source label so the user can tell at a glance whether the model is
// reading from their reference files, from the resume/JD, from a
// combination, or from general knowledge.
//
// This module is PURE: no I/O, no IPC, no DOM. The renderer (overlay,
// console) consumes the rendered string.

import type { TurnPlan } from './TurnPlanner';

/** The label-string categories the overlay understands. */
export type SourceLabel =
  | 'From: Resume'
  | 'From: Job description'
  | 'From: Reference files'
  | 'Mixed: Resume + Job description'
  | 'Mixed: Resume + Reference files'
  | 'Mixed: Job description + Reference files'
  | 'General knowledge'
  // Seminar mode (founder §2.3): off-document questions get this preamble
  // instead of a refusal.
  | 'Not in your reference files — from general knowledge:';

export interface SourceBadgeInput {
  /** The TurnPlan produced by `planTurn` for this turn (the source-of-truth). */
  turnPlan?: Pick<TurnPlan, 'questionKind' | 'evidenceSourcesToProbe' | 'groundingProfile' | 'answerDirectives'> | null;
  /** Whether the live evidence probe actually returned items (turn-time fact). */
  evidenceFound?: boolean;
  /** Optional override: an explicit label to force (e.g. when the renderer
   *  is composing a different presentation). */
  forceLabel?: SourceLabel;
}

/**
 * Compute the source badge for an answer, per the behavior matrix:
 *
 *   profile_question + STRONG profile evidence      → 'From: Resume'
 *   profile_question + NO profile + Seminar profile → 'Not in your reference files — from general knowledge:'
 *   profile_question + NO profile + default         → 'General knowledge'
 *   jd_question      + STRONG jd evidence           → 'From: Job description'
 *   jd_question      + profile + jd evidence        → 'Mixed: Resume + Job description'
 *   doc_question     + STRONG reference evidence    → 'From: Reference files'
 *   coding_question + ANY                         → 'General knowledge'
 *   general         + ANY                         → 'General knowledge'
 *   seminar + off-doc                              → 'Not in your reference files — from general knowledge:'
 *
 * Falls back to `forceLabel` if provided (UI override).
 */
/**
 * Compute the source badge for an answer, per the behavior matrix
 * (founder §2.6 + §5).
 *
 * The matrix maps {question_kind × evidence_found × profile} to one of
 * 7 label strings:
 *   profile_question + STRONG profile evidence      → 'From: Resume'
 *   profile_question + NO profile + Seminar profile → 'Not in your reference files — from general knowledge:'
 *   profile_question + NO profile + default         → 'General knowledge'
 *   jd_question      + STRONG jd evidence           → 'From: Job description'
 *   jd_question      + profile + jd evidence        → 'Mixed: Resume + Job description'
 *   doc_question     + STRONG reference evidence    → 'From: Reference files'
 *   coding_question + ANY                         → 'General knowledge'
 *   general         + ANY                         → 'General knowledge'
 *   seminar + off-doc                              → 'Not in your reference files — from general knowledge:'
 *
 * Falls back to `forceLabel` if provided (UI override).
 *
 * @example
 *   // Profile question, evidence found, default profile
 *   computeSourceBadge({
 *     turnPlan: tp('profile_question', { probes: ['profile_resume'] }),
 *     evidenceFound: true,
 *   });
 *   // → 'From: Resume'
 *
 * @example
 *   // Seminar Mode, off-document question → the explicit preamble
 *   computeSourceBadge({
 *     turnPlan: {
 *       questionKind: 'general',
 *       evidenceSourcesToProbe: ['reference_files'],
 *       groundingProfile: { evidencePreference: 'required', onNoEvidence: 'say_not_found_then_answer_general', labelStyle: 'badge' },
 *       answerDirectives: { ... },
 *     },
 *     evidenceFound: false,
 *   });
 *   // → 'Not in your reference files — from general knowledge:'
 *
 * @param input - `turnPlan` (optional; null/undefined → 'General knowledge'),
 *   `evidenceFound` (default true; conservative per founder §2.6),
 *   `forceLabel` (optional UI override).
 * @returns The source label string for the overlay badge.
 * @see traces3/SEMINAR.md — the Seminar Mode user guide
 * @see {@link computeEngineSourceLabel} — the defensive wrapper consumed
 *   by the engine's primary WTA emit site
 */
export function computeSourceBadge(input: SourceBadgeInput): SourceLabel {
  if (input.forceLabel) return input.forceLabel;
  const tp = input.turnPlan;
  if (!tp) return 'General knowledge';

  const evidenceFound = input.evidenceFound ?? false;
  const seminar =
    tp.groundingProfile?.onNoEvidence === 'say_not_found_then_answer_general';

  // Seminar profile: off-doc questions get the not-in-files preamble even
  // if the user didn't load any reference files.
  if (seminar && !evidenceFound) {
    return 'Not in your reference files — from general knowledge:';
  }

  switch (tp.questionKind) {
    case 'profile_question':
      // Single source vs mixed based on what was probed AND found.
      const probed = new Set(tp.evidenceSourcesToProbe ?? []);
      if (probed.has('profile_resume') && probed.has('profile_jd')) {
        return evidenceFound ? 'Mixed: Resume + Job description' : 'General knowledge';
      }
      if (probed.has('profile_resume')) {
        return evidenceFound ? 'From: Resume' : 'General knowledge';
      }
      return 'General knowledge';

    case 'jd_question':
      const probedJ = new Set(tp.evidenceSourcesToProbe ?? []);
      if (probedJ.has('profile_jd') && probedJ.has('profile_resume')) {
        return evidenceFound ? 'Mixed: Resume + Job description' : 'General knowledge';
      }
      if (probedJ.has('profile_jd')) {
        return evidenceFound ? 'From: Job description' : 'General knowledge';
      }
      if (probedJ.has('reference_files')) {
        return 'From: Reference files';
      }
      return 'General knowledge';

    case 'doc_question':
      return evidenceFound ? 'From: Reference files' : 'General knowledge';

    case 'coding_question':
    case 'general':
    default:
      return 'General knowledge';
  }
}

/**
 * Render the badge string for display in the overlay. Currently returns
 * the label verbatim; future work can add styling tokens (e.g. a
 * `color: 'green' | 'amber'` discriminator for "grounded" vs "general").
 */
export function renderSourceBadge(label: SourceLabel): string {
  return label;
}

/**
 * Campaign-3 (2026-07-19): safe wrapper consumed by the engine's primary
 * WTA emit site. Returns 'General knowledge' for null/missing inputs so
 * the engine never throws at the emit boundary. PURE so it can be unit
 * tested in isolation without spinning up Electron / LLMHelper.
 *
 * `evidenceFound` defaults to `true` (conservative): the engine doesn't
 * currently carry the post-resolve `candidateEvidenceCount` at the emit
 * site, and showing "From: Resume" when actually general is an honest
 * degradation, not a fabrication (founder §2.6).
 */
/**
 * Safe wrapper consumed by the engine's primary WTA emit site
 * (IntelligenceEngine.ts:2227).
 *
 * Returns 'General knowledge' for null/missing inputs so the engine
 * never throws at the emit boundary. PURE so it can be unit-tested in
 * isolation without spinning up Electron / LLMHelper.
 *
 * `evidenceFound` defaults to `true` (conservative): the engine
 * doesn't currently carry the post-resolve `candidateEvidenceCount`
 * at the emit site, and showing "From: Resume" when actually general
 * is an honest degradation, not a fabrication (founder §2.6).
 *
 * @example
 *   // Typical engine emit — TurnPlan already computed upstream
 *   const label = computeEngineSourceLabel({
 *     turnPlan: _c3TurnPlan,
 *     evidenceFound: true,
 *   });
 *   // → 'From: Resume' | 'Mixed: Resume + Job description' | 'General knowledge' |
 *   //   'Not in your reference files — from general knowledge:' (seminar)
 *   // Always returns a valid SourceLabel; never throws.
 *
 * @example
 *   // null turnPlan — defensive fallback
 *   computeEngineSourceLabel({ turnPlan: null });
 *   // → 'General knowledge'
 *
 * @param input - `turnPlan` (optional Partial<TurnPlan> or null/undefined —
 *   safe-fallback to 'General knowledge'); `evidenceFound` (default true).
 * @returns The source label string for the overlay badge.
 * @see {@link computeSourceBadge} — the matrix implementation
 * @see traces3/SEMINAR.md — the Seminar Mode user guide
 */
export function computeEngineSourceLabel(input: {
  turnPlan?: Partial<TurnPlan> | null;
  evidenceFound?: boolean;
}): SourceLabel {
  try {
    if (!input.turnPlan) return 'General knowledge';
    return computeSourceBadge({
      turnPlan: input.turnPlan as TurnPlan,
      evidenceFound: input.evidenceFound ?? true,
    });
  } catch {
    return 'General knowledge';
  }
}