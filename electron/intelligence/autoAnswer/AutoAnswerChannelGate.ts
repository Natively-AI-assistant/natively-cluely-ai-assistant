/**
 * Dual-channel precondition for an automatic dispatch (V3 Amendment 1).
 *
 * Consumes the joint-state transitions from the native tracker
 * (native-module/src/channel_state.rs via SystemAudioCapture/MicrophoneCapture
 * 'speech_edge') and answers one question at the moment every other guard has
 * passed: may we dispatch NOW, must we HOLD (and for how long), or is the
 * candidate dead because the user is answering it themselves?
 *
 * Pure apart from the injected clock; the controller owns the timers.
 */

import type { SpeechEdge } from '../../audio/speechEdge';

/** The user channel must have been silent this long before an automatic dispatch. Unfitted placeholder. */
export const USER_SILENCE_MS = 700;
/** Both channels active inside this window = the boundary is not clean; hold. Unfitted placeholder. */
export const OVERLAP_VETO_MS = 400;
/**
 * Total time a committed candidate may be HELD for user-silence / overlap /
 * interviewer-resume before it is dropped. Stops a talker from parking a
 * candidate indefinitely. Unfitted placeholder.
 */
export const HOLD_BUDGET_MS = 2500;

export interface AutoAnswerChannelTuning {
    userSilenceMs: number;
    overlapVetoMs: number;
    holdBudgetMs: number;
}

export const DEFAULT_CHANNEL_TUNING: AutoAnswerChannelTuning = {
    userSilenceMs: USER_SILENCE_MS,
    overlapVetoMs: OVERLAP_VETO_MS,
    holdBudgetMs: HOLD_BUDGET_MS,
};

export type ChannelVerdict =
    | { kind: 'dispatch' }
    | { kind: 'hold'; holdMs: number }
    | { kind: 'drop'; reason: 'user_answering' | 'incomplete' };

/** What a user START edge means for whatever is currently armed or streaming. */
export type UserStartSignificance = 'user_speech' | 'possible_bleed';

export class AutoAnswerChannelGate {
    private readonly tuning: AutoAnswerChannelTuning;
    private userSpeaking = false;
    private interviewerSpeaking = false;
    private lastUserEndedAt: number | null = null;
    private lastBothEndedAt: number | null = null;
    private userEdgesVadBacked = true;
    /** When the current candidate first entered a hold, or null. Reset by the controller per candidate. */
    private holdStartedAt: number | null = null;

    constructor(tuning: Partial<AutoAnswerChannelTuning> = {}) {
        this.tuning = { ...DEFAULT_CHANNEL_TUNING, ...tuning };
    }

    isUserSpeaking(): boolean { return this.userSpeaking; }
    isInterviewerSpeaking(): boolean { return this.interviewerSpeaking; }

    /**
     * Record a transition. Returns the significance of a USER START edge
     * (null for every other edge) so the controller can cancel armed work or
     * a streaming automatic answer.
     *
     * A user edge that begins while the interviewer is still speaking only
     * counts as the user when the mic edge is VAD-backed: on the RMS-only
     * Windows mic, interviewer audio bleeding back through the speakers looks
     * exactly like that. Such overlaps fall to the overlap veto (a hold).
     */
    noteEdge(edge: SpeechEdge): UserStartSignificance | null {
        const wasBoth = this.userSpeaking && this.interviewerSpeaking;
        this.userEdgesVadBacked = edge.userEdgesVadBacked;
        if (edge.channel === 'user') {
            this.userSpeaking = edge.speaking;
            if (!edge.speaking) this.lastUserEndedAt = edge.atMs;
        } else {
            this.interviewerSpeaking = edge.speaking;
        }
        const isBoth = this.userSpeaking && this.interviewerSpeaking;
        if (wasBoth && !isBoth) this.lastBothEndedAt = edge.atMs;

        if (edge.channel !== 'user' || !edge.speaking) return null;
        const clean = !this.interviewerSpeaking || edge.userEdgesVadBacked;
        return clean ? 'user_speech' : 'possible_bleed';
    }

    /** Start a fresh hold budget (a new candidate was committed). */
    resetHold(): void { this.holdStartedAt = null; }

    /** Drop derived timestamps on meeting stop; live flags are re-reported by the tracker on the next start. */
    reset(): void {
        this.holdStartedAt = null;
        this.lastUserEndedAt = null;
        this.lastBothEndedAt = null;
    }

    /** Evaluate at the moment of dispatch. */
    verdict(now: number): ChannelVerdict {
        const { userSilenceMs, overlapVetoMs, holdBudgetMs } = this.tuning;
        const cleanUserSpeech = this.userSpeaking && (!this.interviewerSpeaking || this.userEdgesVadBacked);
        if (cleanUserSpeech) {
            this.holdStartedAt = null;
            return { kind: 'drop', reason: 'user_answering' };
        }
        let holdMs = 0;
        const both = this.userSpeaking && this.interviewerSpeaking;
        // The interviewer resumed inside the quiet window: the question may not
        // be over. Re-check on the veto cadence; the next final restarts the
        // quiet window properly. Precision over latency.
        if (this.interviewerSpeaking) holdMs = Math.max(holdMs, overlapVetoMs);
        if (both) {
            holdMs = Math.max(holdMs, overlapVetoMs);
        } else if (this.lastBothEndedAt !== null) {
            holdMs = Math.max(holdMs, overlapVetoMs - (now - this.lastBothEndedAt));
        }
        if (this.lastUserEndedAt !== null) {
            holdMs = Math.max(holdMs, userSilenceMs - (now - this.lastUserEndedAt));
        }
        if (holdMs <= 0) {
            this.holdStartedAt = null;
            return { kind: 'dispatch' };
        }
        if (this.holdStartedAt === null) this.holdStartedAt = now;
        const budgetLeft = holdBudgetMs - (now - this.holdStartedAt);
        if (budgetLeft <= 0) {
            this.holdStartedAt = null;
            return { kind: 'drop', reason: this.userSpeaking ? 'user_answering' : 'incomplete' };
        }
        return { kind: 'hold', holdMs: Math.max(1, Math.min(holdMs, budgetLeft)) };
    }
}
