/**
 * The decision half of the Auto Answer trigger (Settings > General, default OFF).
 *
 * Split out of AppState so every guard is reachable from a test. AppState owns
 * the timer and the STT wiring; this owns "given the world at the moment the
 * debounce fired, do we dispatch?" — which is where the failure modes are.
 *
 * See AppState.scheduleAutoAnswer for why the trigger is a FINAL interviewer
 * transcript and not the native VAD's `speech_ended`.
 */

export interface AutoAnswerGateInput {
    /** Settings > General → Auto Answer. Off means the hotkey is the only path. */
    enabled: boolean;
    /** False once Stop is pressed. The transcript handler still runs during the
     *  post-Stop drain window, and a finished meeting must not produce an answer. */
    meetingActive: boolean;
    /** `_meetingGeneration` read when the debounce was armed... */
    generationAtSchedule: number;
    /** ...and read again now. A stop→start inside the debounce window changes it,
     *  and the pending timer belongs to the meeting that is over. */
    generationNow: number;
    /** `getLastInterviewerTurn()` — always a FINAL turn (SessionTracker.addTranscript
     *  returns null on !final), so an empty value means no question has landed yet. */
    lastQuestion: string | null | undefined;
    /** The turn already dispatched, or null. */
    lastAnsweredQuestion: string | null;
    /** IntelligenceEngine.canAutoAnswer() — mode + cooldown. */
    engineAccepting: boolean;
}

export type AutoAnswerSkipReason =
    | 'disabled'
    | 'meeting_inactive'
    | 'stale_generation'
    | 'no_question'
    | 'already_answered'
    | 'engine_busy_or_cooling';

export type AutoAnswerGateDecision =
    | { dispatch: true; question: string }
    | { dispatch: false; reason: AutoAnswerSkipReason };

/**
 * Pure. Order matters only for which reason is reported; every guard is
 * independently sufficient to skip.
 */
export function evaluateAutoAnswerGate(input: AutoAnswerGateInput): AutoAnswerGateDecision {
    if (!input.enabled) return { dispatch: false, reason: 'disabled' };
    if (!input.meetingActive) return { dispatch: false, reason: 'meeting_inactive' };
    if (input.generationNow !== input.generationAtSchedule) {
        return { dispatch: false, reason: 'stale_generation' };
    }

    const question = (input.lastQuestion ?? '').trim();
    if (!question) return { dispatch: false, reason: 'no_question' };

    // Without this the planner's 3 s cooldown would let one unchanged final turn
    // be re-answered every time the cooldown lapsed — an interviewer who asks a
    // question and then thinks out loud would collect a new answer every 3 s.
    if (question === input.lastAnsweredQuestion) {
        return { dispatch: false, reason: 'already_answered' };
    }

    if (!input.engineAccepting) return { dispatch: false, reason: 'engine_busy_or_cooling' };

    return { dispatch: true, question };
}
