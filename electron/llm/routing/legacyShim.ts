// electron/llm/routing/legacyShim.ts
//
// IntentFrame down to the legacy eight intents, so the existing Answer Shape
// prompts keep working while the router is proved.
//
// PR 11 removes the legacy table. Until then every consumer downstream of
// `classifyIntent` expects an `IntentResult`, and the router has to be able to
// produce one or it cannot be switched on without rewriting the prompt layer at
// the same time. Two risky changes at once is how a regression becomes
// unattributable.
//
// THE MAPPING IS LOSSY IN ONE DIRECTION AND AMBIGUOUS IN THE OTHER.
//
// The legacy label is one flat value carrying several independent decisions,
// which is the fault the campaign exists to fix. Going from the frame back down
// to it therefore throws information away, and worse, several legacy intents
// collapse onto the same pair of frame axes:
//
//   clarification and deep_dive      both mean task=explain, answer_form=explanation
//   follow_up and general            both mean task=answer,  answer_form=explanation
//   behavioral and example_request   both mean task=answer,  answer_form=example
//
// So task and answer_form alone cannot recover the legacy label, and a shim
// that pretended otherwise would silently pick one of each pair and look
// correct. `mode_intent` is what separates them, because it is the axis that
// knows a `behavioral_star` from an `example_request` and a `dsa_problem` from
// a `new_concept`. Where mode_intent does not resolve it, the shim returns the
// more common member of the pair and says so through `ambiguous`, rather than
// implying a confidence it does not have.

import type { IntentFrame } from './IntentFrame';

/** The legacy eight. Kept as a literal union so a typo cannot compile. */
export type LegacyIntent =
    | 'coding' | 'clarification' | 'follow_up' | 'deep_dive'
    | 'behavioral' | 'example_request' | 'summary_probe' | 'general';

export interface LegacyMapping {
    intent: LegacyIntent;
    confidence: number;
    /**
     * True when task and answer_form alone could not separate the legacy label
     * from its twin and mode_intent did not resolve it either. The caller gets a
     * usable answer and an honest flag rather than a fabricated certainty.
     */
    ambiguous: boolean;
    /** Which axis decided, for the shadow run's disagreement analysis. */
    via: 'answer_form' | 'mode_intent' | 'task' | 'default';
}

/**
 * mode_intent values that pin a legacy label directly.
 *
 * Only entries that are genuinely unambiguous are listed. A mode_intent that
 * could reasonably be two legacy labels is deliberately absent, so it falls
 * through to the task rules and is reported as ambiguous rather than being
 * resolved by a guess encoded here.
 */
const MODE_INTENT_TO_LEGACY: Record<string, LegacyIntent> = {
    // Coding, in the modes that have it.
    dsa_problem: 'coding',
    system_design: 'coding',
    code_review_hint: 'coding',
    optimization_probe: 'coding',
    complexity_probe: 'coding',
    coding_question: 'coding',
    in_file_question: 'clarification',

    // Behavioural storytelling, which is not the same as asking for an example.
    behavioral_star: 'behavioral',
    behavioral_in_tech_round: 'behavioral',
    tell_me_about_yourself: 'behavioral',
    interview_answer: 'behavioral',

    // Explanation of something new, which is deep_dive rather than clarification.
    new_concept: 'deep_dive',
    formula: 'deep_dive',
    lecture_concept: 'deep_dive',
    role_technical: 'deep_dive',

    // Asking what something meant.
    clarification_request: 'clarification',
    problem_restatement: 'clarification',
    clarifying_answer_from_interviewer: 'clarification',

    // Worked examples.
    worked_example: 'example_request',

    // Summarising.
    meeting_capture: 'summary_probe',
    action_item: 'summary_probe',
    decision: 'summary_probe',
};

/**
 * Map a frame to the legacy intent.
 *
 * `answer_form = code` wins outright, because that is the one legacy label the
 * downstream prompt contract genuinely changes shape for: the six-section DSA
 * contract keys off it. Everything else is a matter of emphasis.
 */
export function toLegacyIntent(frame: Pick<IntentFrame, 'task' | 'answer_form' | 'mode_intent' | 'confidence'>): LegacyMapping {
    const conf = frame.confidence?.task ?? frame.confidence?.needs_response ?? 0.5;

    if (frame.answer_form === 'code' || frame.task === 'debug' || frame.task === 'create') {
        return { intent: 'coding', confidence: conf, ambiguous: false, via: 'answer_form' };
    }

    const byMode = frame.mode_intent ? MODE_INTENT_TO_LEGACY[frame.mode_intent] : undefined;
    if (byMode) return { intent: byMode, confidence: conf, ambiguous: false, via: 'mode_intent' };

    if (frame.task === 'summarize' || frame.answer_form === 'summary') {
        return { intent: 'summary_probe', confidence: conf, ambiguous: false, via: 'task' };
    }
    if (frame.answer_form === 'example') {
        // behavioral or example_request. example_request is the more common of
        // the pair outside the two interview modes, and mode_intent already
        // caught the behavioral cases above.
        return { intent: 'example_request', confidence: conf, ambiguous: true, via: 'task' };
    }
    if (frame.task === 'explain') {
        // clarification or deep_dive. deep_dive is the more common, and the
        // clarification cases that matter are pinned by mode_intent above.
        return { intent: 'deep_dive', confidence: conf, ambiguous: true, via: 'task' };
    }

    // follow_up or general. The production prior is decisive here: follow_up is
    // 0.2% of live traffic against general's 37.5%, measured over 32,919 turns
    // in docs/natively-router-production-priors-2026-09.md. Returning follow_up
    // on a coin flip would misroute roughly one turn in three.
    return { intent: 'general', confidence: conf, ambiguous: true, via: 'default' };
}

/**
 * Every legacy intent this shim can actually produce.
 *
 * `follow_up` is absent, and that is not an oversight. Nothing in the frame
 * distinguishes it from `general`: both are task=answer with
 * answer_form=explanation, no mode_intent separates them, and it is 0.2% of
 * live traffic. Emitting it would be a guess. PR 11 removes the label; until
 * then a turn that would once have been follow_up is routed as general, which
 * is what the two share an answer shape for anyway.
 */
export const SHIM_REACHABLE_INTENTS: readonly LegacyIntent[] = [
    'coding', 'clarification', 'deep_dive', 'behavioral',
    'example_request', 'summary_probe', 'general',
] as const;
