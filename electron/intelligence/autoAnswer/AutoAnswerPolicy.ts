/**
 * AutoAnswerPolicy — the pure dispatch decision (V2 §40, V3 Amendment 4).
 *
 * Evolution of `autoAnswerGate.ts`, which stays in place and is CALLED here
 * for the lifecycle half (enabled / meeting / generation / dedup-by-text /
 * engine) so its eleven tests keep their exact meaning. On top of that this
 * layer applies the question-quality half and emits the ternary action:
 *
 *   answerability >= autoThreshold  AND user channel clear AND engine idle -> 'auto'
 *   answerability >= offerThreshold                                        -> 'offer'
 *   otherwise                                                              -> 'silent'
 *
 * 'wait' / 'speculate' / 'queue' remain orthogonal (V2 §19, §22). Phase 6
 * stores the per-mode thresholds next to the mode config; until then the
 * defaults below are the placeholders and every caller passes them in.
 */

import { evaluateAutoAnswerGate } from '../autoAnswerGate';
import type { AutoAnswerPolicyDecision, AutoAnswerQuestion, AutoAnswerSkipReason } from './AutoAnswerTypes';
import { ANSWER_THRESHOLD, SPECULATION_THRESHOLD, WAIT_THRESHOLD } from './AutoAnswerDetector';

export interface AutoAnswerThresholds {
    /** Fire an automatic answer at or above this answerability. */
    autoThreshold: number;
    /** Render the offer card at or above this answerability (below autoThreshold). */
    offerThreshold: number;
    /** Start speculative preparation at or above this (pre-commit). */
    speculationThreshold: number;
}

/** Placeholders (V2 §12/§19). Phase 6 replaces these with per-mode values. */
export const DEFAULT_THRESHOLDS: AutoAnswerThresholds = {
    autoThreshold: ANSWER_THRESHOLD,
    offerThreshold: WAIT_THRESHOLD,
    speculationThreshold: SPECULATION_THRESHOLD,
};

export interface AutoAnswerPolicyInput {
    enabled: boolean;
    meetingActive: boolean;
    /** meetingGeneration at candidate commit vs now. */
    generationAtCommit: number;
    generationNow: number;

    question: AutoAnswerQuestion | null;

    /** IntelligenceEngine.canAutoAnswer(): mode idle/assist AND cooldown elapsed. */
    engineAccepting: boolean;
    /** A MANUAL What-to-Answer is streaming (never superseded by us). */
    manualAnswerActive: boolean;
    /** An AUTOMATIC answer is streaming (a new real question may queue). */
    automaticAnswerActive: boolean;

    /** Dedup verdict from the controller (3-layer). */
    duplicate: boolean;
    /** Text of the last question dispatched, for the gate's exact-string layer. */
    lastAnsweredText: string | null;
    queueDepth: number;
    maxQueueDepth: number;

    /** The dual-channel gate said the boundary is clean right now. */
    userChannelClear: boolean;

    thresholds?: AutoAnswerThresholds;
}

export function evaluateAutoAnswerPolicy(input: AutoAnswerPolicyInput): AutoAnswerPolicyDecision {
    const t = input.thresholds ?? DEFAULT_THRESHOLDS;

    // Lifecycle guards, through the PR #497 gate so its semantics are the single source of truth.
    const gate = evaluateAutoAnswerGate({
        enabled: input.enabled,
        meetingActive: input.meetingActive,
        generationAtSchedule: input.generationAtCommit,
        generationNow: input.generationNow,
        lastQuestion: input.question?.text ?? null,
        lastAnsweredQuestion: input.lastAnsweredText,
        // The engine half is decided below with richer state; pass true here.
        engineAccepting: true,
    });
    if (!gate.dispatch) return { action: 'silent', reason: gate.reason as AutoAnswerSkipReason };

    const question = input.question!;
    if (input.duplicate) return { action: 'silent', reason: 'duplicate', question };

    const act = question.dialogueAct;
    if (act === 'incomplete') return { action: 'wait', reason: 'incomplete', question };
    if (act === 'pause_request') return { action: 'silent', reason: 'pause_request', question };
    if (act === 'rhetorical') return { action: 'silent', reason: 'rhetorical', question };
    if (act === 'backchannel') return { action: 'silent', reason: 'backchannel', question };
    if (act === 'social') return { action: 'silent', reason: 'social', question };
    if (act === 'confirmation' || act === 'statement') return { action: 'silent', reason: 'not_question', question };

    if (question.answerability < t.offerThreshold) return { action: 'silent', reason: 'low_answerability', question };

    // Manual precedence (V2 §23): never supersede the user's own request.
    if (input.manualAnswerActive) return { action: 'silent', reason: 'manual_answer_active', question };

    if (question.answerability < t.autoThreshold) return { action: 'offer', reason: 'ok', question };

    // An automatic answer is streaming: a genuinely new question queues (single-flight, V2 §22).
    if (input.automaticAnswerActive) {
        if (input.queueDepth >= input.maxQueueDepth) return { action: 'queue', reason: 'queue_full', question };
        return { action: 'queue', reason: 'ok', question };
    }
    if (!input.engineAccepting) return { action: 'queue', reason: 'cooldown', question };

    if (!input.userChannelClear) return { action: 'wait', reason: 'user_answering', question };

    return { action: 'auto', reason: 'ok', question };
}
