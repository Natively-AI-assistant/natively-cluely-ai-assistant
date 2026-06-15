// electron/llm/modeProfiles.ts
//
// MODE-AWARE ROUTING PRIOR (Profile Intelligence v3, W1).
//
// The active ModesManager mode ("sales", "lecture", "technical-interview", …)
// is a strong PRIOR on what an AMBIGUOUS turn is about: an unmatched question
// in a sales call is almost certainly a sales question, not a meeting recap.
// Until now `planAnswer` was mode-blind — every fallthrough landed on
// unknown_answer / general_meeting_answer regardless of the live setting, which
// is exactly the "doesn't answer / answers generically" failure mode.
//
// DESIGN RULE (leak-safety invariant): the mode is a prior, NEVER an override.
// Explicit answer-type signals (coding verbs, negotiation words, identity asks,
// profile probes, …) always win — this module is consulted ONLY on the final
// classification fallthrough, after every explicit pattern has had its chance.
// Redirecting the fallthrough TYPE is the whole mechanism: the per-type
// required/forbidden layer tables in AnswerPlanner then apply automatically
// (sales_answer already forbids resume/jd/negotiation, lecture_answer already
// requires reference_files, …), so no layer rule is ever relaxed here.
//
// Pure data + pure functions. No I/O, no LLM, no imports with side effects —
// trivially testable and safe on the hot path.

import type { AnswerType, AnswerSource } from './AnswerPlanner';

/** Mirror of ModesManager's ModeTemplateType (kept local so this module stays
 *  pure and AnswerPlanner never imports from services/). Structurally identical
 *  string union — a drift would surface as a type error at the call sites. */
export type ModeTemplateType =
    | 'general'
    | 'looking-for-work'
    | 'sales'
    | 'recruiting'
    | 'team-meet'
    | 'lecture'
    | 'technical-interview';

/** The slice of the active mode the planner needs. Built by
 *  ModesManager.getActiveModeInfo() (cached) and threaded through
 *  PlanAnswerInput.activeMode. */
export interface ActiveModeInfo {
    id: string;
    templateType: ModeTemplateType;
    name: string;
    /** A user-created mode (custom name/content on the 'general' template, or a
     *  renamed template mode) — surfaced so prompt builders can name it. */
    isCustom: boolean;
}

export interface ModeContextProfile {
    /**
     * Where an ambiguous LIVE turn (what_to_answer / transcript) lands when no
     * explicit pattern matched. `null` keeps the planner's existing fallthrough
     * (the profile-aware fallback → general_meeting_answer floor).
     */
    fallbackLiveAnswerType: AnswerType | null;
    /**
     * Where an ambiguous MANUAL question lands when no explicit pattern matched
     * (and the profile-aware fallback didn't claim it). `null` keeps the
     * existing unknown_answer floor.
     */
    fallbackManualAnswerType: AnswerType | null;
}

const NEUTRAL: ModeContextProfile = {
    fallbackLiveAnswerType: null,
    fallbackManualAnswerType: null,
};

/**
 * The priors table. Notes per mode:
 * - sales: ambiguous turns are sales conversation → sales_answer (which already
 *   forbids resume/jd/negotiation and requires custom_context+reference_files —
 *   exactly the "sales call doesn't need the resume" contract).
 * - lecture: ambiguous turns are about the material → lecture_answer (requires
 *   reference_files, forbids resume/jd/negotiation).
 * - team-meet / recruiting: ambiguous turns stay conversation-scoped →
 *   general_meeting_answer EXPLICITLY for manual too (no profile dump in a
 *   meeting context).
 * - technical-interview / looking-for-work / general: NEUTRAL — the planner's
 *   existing profile-aware fallback already routes candidate-directed questions
 *   to profile types (resume/JD grounded), which is the right behavior in an
 *   interview context; forcing a type here would only lose information.
 */
export const MODE_CONTEXT_PROFILES: Record<ModeTemplateType, ModeContextProfile> = {
    'general': NEUTRAL,
    'technical-interview': NEUTRAL,
    'looking-for-work': NEUTRAL,
    'sales': {
        fallbackLiveAnswerType: 'sales_answer',
        fallbackManualAnswerType: 'sales_answer',
    },
    'lecture': {
        fallbackLiveAnswerType: 'lecture_answer',
        fallbackManualAnswerType: 'lecture_answer',
    },
    'recruiting': {
        fallbackLiveAnswerType: 'general_meeting_answer',
        fallbackManualAnswerType: 'general_meeting_answer',
    },
    'team-meet': {
        fallbackLiveAnswerType: 'general_meeting_answer',
        fallbackManualAnswerType: 'general_meeting_answer',
    },
};

/** The two floor types the classification chain can fall through to. The mode
 *  prior may ONLY rewrite these — any other type came from an explicit signal. */
const FALLTHROUGH_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
    'unknown_answer',
    'general_meeting_answer',
]);

/**
 * Apply the active mode's prior to a fallthrough classification. Returns the
 * (possibly rewritten) answer type.
 *
 * Contract:
 * - `fellThrough` must be true ONLY when the classification chain reached its
 *   final else (no explicit pattern matched). Explicit general_meeting matches
 *   (e.g. a recap ask "what were the action items?") pass `fellThrough=false`
 *   and are never rewritten — a recap in a sales call is still a recap.
 * - Only unknown_answer/general_meeting_answer are ever rewritten.
 */
export function applyModeFallback(
    answerType: AnswerType,
    fellThrough: boolean,
    source: AnswerSource,
    activeMode: ActiveModeInfo | null | undefined,
): AnswerType {
    if (!fellThrough || !activeMode) return answerType;
    if (!FALLTHROUGH_TYPES.has(answerType)) return answerType;
    const profile = MODE_CONTEXT_PROFILES[activeMode.templateType];
    if (!profile) return answerType;
    const fallback = source === 'manual_input'
        ? profile.fallbackManualAnswerType
        : profile.fallbackLiveAnswerType;
    return fallback ?? answerType;
}
