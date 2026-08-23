/**
 * The timer half of the Auto Answer trigger (Settings > General, default OFF).
 *
 * PR #497 put the debounce inline in AppState.scheduleAutoAnswer with a bare
 * setTimeout, which left two live bugs unreachable from a test:
 *
 *  1. STARVATION — every interviewer final restarted the 900 ms debounce with
 *     no ceiling, so a provider emitting finals faster than that never fired.
 *     `HARD_CAP_MS` bounds the wait from the FIRST final of an accumulation.
 *  2. TRANSIENT DROP — when the debounce fired while the engine was busy or
 *     cooling (a manual What-to-Answer still streaming, the 3 s trigger
 *     cooldown) the candidate was thrown away for good. A single-slot
 *     `PendingAutoAnswer` now survives until the engine idles, bounded by
 *     `PENDING_TTL_MS`, and is dropped the moment a newer candidate arrives or
 *     the meeting stops — a stale question must never fire after the
 *     conversation moved on.
 *
 * AppState keeps the wiring (STT events, lifecycle, dispatch); this owns the
 * clock. Every guard still runs through `evaluateAutoAnswerGate`, so the
 * existing gate tests keep their meaning. Phase 3 of the V3 campaign folds
 * this into AutoAnswerController; the constants survive as named inputs.
 */

import type { Clock, ClockTimer } from './autoAnswer/AutoAnswerClock';
import { systemClock } from './autoAnswer/AutoAnswerClock';
import { evaluateAutoAnswerGate, type AutoAnswerSkipReason } from './autoAnswerGate';
import type { SpeechEdge } from '../audio/speechEdge';

/** Quiet window after the last interviewer final; each new final restarts it. */
export const AUTO_ANSWER_DEBOUNCE_MS = 900;
/** Ceiling measured from the FIRST final of an accumulation. Unfitted placeholder (V3 Amendment 3/5). */
export const HARD_CAP_MS = 2500;
/** How long a transiently-rejected candidate may wait for the engine to idle. Unfitted placeholder. */
export const PENDING_TTL_MS = 6000;
/**
 * Fallback poll while a candidate is pending. The engine's `mode_changed →
 * idle` event is the fast path (AppState calls `noteEngineIdle`), but the
 * cooldown half of `canAutoAnswer` has no event of its own, so the slot is
 * also re-checked on this cadence until the TTL lapses.
 */
export const PENDING_RETRY_MS = 500;

// ── Dual-channel preconditions (V3 Amendment 1). All unfitted placeholders. ──
/** The user channel must have been silent this long before an automatic dispatch. */
export const USER_SILENCE_MS = 700;
/** Both channels active inside this window = the boundary is not clean; hold. */
export const OVERLAP_VETO_MS = 400;
/**
 * Total time a committed candidate may be HELD for user-silence / overlap
 * before it is dropped as `user_answering`. Holds re-arm the timer; this stops
 * a user who keeps talking from parking a candidate indefinitely.
 */
export const HOLD_BUDGET_MS = 2500;

export interface PendingAutoAnswer {
    /** The turn that was gated, verbatim. Rearm only while it is still the latest turn. */
    turn: string;
    queuedAt: number;
    /** `_meetingGeneration` when the candidate was gated. */
    generation: number;
}

export type AutoAnswerSchedulerSkipReason =
    | AutoAnswerSkipReason
    | 'pending_expired'
    | 'pending_superseded'
    /** The user started answering before the automatic dispatch (V3 Amendment 1). */
    | 'user_answering'
    /** The user spoke over a streaming automatic answer; the stream was cancelled. */
    | 'user_barge_in'
    /** The interviewer was still speaking through the whole hold budget; the next final re-arms. */
    | 'incomplete';

export interface AutoAnswerSchedulerHost {
    isEnabled(): boolean;
    isMeetingActive(): boolean;
    meetingGeneration(): number;
    /** `IntelligenceManager.getLastInterviewerTurn()` — always a FINAL turn. */
    lastInterviewerTurn(): string | null | undefined;
    /** `IntelligenceManager.canAutoAnswer()` — mode + cooldown. */
    engineAccepting(): boolean;
    dispatch(question: string): void;
    onSkip?(reason: AutoAnswerSchedulerSkipReason): void;
    /**
     * Abort the AUTOMATIC answer currently streaming, if any. Must be a no-op
     * for a manual What-to-Answer (the user's own request is never killed by
     * their own speech). Returns whether a stream was cancelled.
     */
    cancelAutomaticAnswer?(reason: 'user_barge_in'): boolean;
}

/** What the two VAD channels are doing, as last reported by the native tracker. */
interface ChannelView {
    userSpeaking: boolean;
    interviewerSpeaking: boolean;
    /** Epoch ms of the user channel's last speech→silence edge, or null. */
    lastUserEndedAt: number | null;
    /** Epoch ms when the joint state last LEFT 'both', or null. */
    lastBothEndedAt: number | null;
    userEdgesVadBacked: boolean;
}

/** The dual-channel tuning, injectable so a test can isolate each rule. Defaults are the placeholders above. */
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

export class AutoAnswerScheduler {
    private readonly tuning: AutoAnswerChannelTuning;
    private timer: ClockTimer | null = null;
    private retryTimer: ClockTimer | null = null;
    /** First final of the current accumulation, or null when nothing is armed. */
    private firstFinalAt: number | null = null;
    private generationAtArm = 0;
    /** The turn already dispatched — the planner's cooldown alone would re-answer a stable last turn. */
    private lastAnsweredQuestion: string | null = null;
    private pending: PendingAutoAnswer | null = null;
    private channels: ChannelView = {
        userSpeaking: false,
        interviewerSpeaking: false,
        lastUserEndedAt: null,
        lastBothEndedAt: null,
        userEdgesVadBacked: true,
    };
    /** When the current candidate first entered a user-silence/overlap hold, or null. */
    private holdStartedAt: number | null = null;
    /** An automatic answer was dispatched and the engine has not reported idle since. */
    private automaticAnswerInFlight = false;

    constructor(
        private readonly host: AutoAnswerSchedulerHost,
        private readonly clock: Clock = systemClock,
        tuning: Partial<AutoAnswerChannelTuning> = {},
    ) {
        this.tuning = { ...DEFAULT_CHANNEL_TUNING, ...tuning };
    }

    /** A FINAL interviewer transcript segment landed. */
    noteInterviewerFinal(): void {
        if (!this.host.isEnabled()) return;
        // The transcript handler also runs during the post-Stop drain window; a
        // meeting that is over must not produce a new answer.
        if (!this.host.isMeetingActive()) return;

        // A newer candidate exists: whatever was waiting for the engine is stale.
        if (this.pending) this.dropPending('pending_superseded');

        const now = this.clock.now();
        if (this.firstFinalAt === null) this.firstFinalAt = now;
        this.generationAtArm = this.host.meetingGeneration();

        if (this.timer !== null) this.clock.clearTimeout(this.timer);
        const capRemaining = HARD_CAP_MS - (now - this.firstFinalAt);
        const delay = Math.max(0, Math.min(AUTO_ANSWER_DEBOUNCE_MS, capRemaining));
        this.timer = this.clock.setTimeout(() => this.fire(), delay);
    }

    /** The engine reported idle (`mode_changed → idle`). Rearm a pending candidate, if any. */
    noteEngineIdle(): void {
        this.automaticAnswerInFlight = false;
        if (this.pending) this.tryRearm();
    }

    /**
     * A joint-state transition from the native dual-channel tracker. The
     * user's channel is a first-class input: the user starting to answer
     * cancels an armed/parked candidate (`user_answering`) and cancels a
     * streaming automatic answer (`user_barge_in`).
     *
     * A user edge that begins while the interviewer is still speaking is NOT
     * treated as the user answering unless the mic edge is VAD-backed: on
     * Windows the mic is RMS-only and interviewer audio bleeding back through
     * the speakers looks exactly like that. Such overlaps fall to the overlap
     * veto (a hold) instead, which costs latency rather than a wrong drop.
     */
    noteSpeechEdge(edge: SpeechEdge): void {
        const wasBoth = this.channels.userSpeaking && this.channels.interviewerSpeaking;
        this.channels.userEdgesVadBacked = edge.userEdgesVadBacked;
        if (edge.channel === 'user') {
            this.channels.userSpeaking = edge.speaking;
            if (!edge.speaking) this.channels.lastUserEndedAt = edge.atMs;
        } else {
            this.channels.interviewerSpeaking = edge.speaking;
        }
        const isBoth = this.channels.userSpeaking && this.channels.interviewerSpeaking;
        if (wasBoth && !isBoth) this.channels.lastBothEndedAt = edge.atMs;

        if (edge.channel !== 'user' || !edge.speaking) return;
        const cleanUserStart = !this.channels.interviewerSpeaking || edge.userEdgesVadBacked;
        if (!cleanUserStart) return;

        if (this.automaticAnswerInFlight && this.host.cancelAutomaticAnswer?.('user_barge_in')) {
            this.automaticAnswerInFlight = false;
            this.host.onSkip?.('user_barge_in');
        }
        if (this.timer !== null || this.pending !== null) {
            if (this.timer !== null) { this.clock.clearTimeout(this.timer); this.timer = null; }
            this.firstFinalAt = null;
            this.holdStartedAt = null;
            this.pending = null;
            this.stopRetry();
            this.host.onSkip?.('user_answering');
        }
    }

    /** Meeting stop/start or toggle off: nothing armed may survive. */
    cancel(): void {
        if (this.timer !== null) { this.clock.clearTimeout(this.timer); this.timer = null; }
        this.stopRetry();
        this.firstFinalAt = null;
        this.holdStartedAt = null;
        this.pending = null;
        this.lastAnsweredQuestion = null;
        this.automaticAnswerInFlight = false;
        // Channel flags are owned by the native tracker, which re-reports on the
        // next capture start; only the derived timestamps are ours to drop.
        this.channels.lastUserEndedAt = null;
        this.channels.lastBothEndedAt = null;
    }

    /** Test/diagnostic visibility only. */
    getPending(): PendingAutoAnswer | null { return this.pending; }
    isArmed(): boolean { return this.timer !== null; }

    private fire(): void {
        this.timer = null;
        this.firstFinalAt = null;
        const generation = this.generationAtArm;
        const decision = evaluateAutoAnswerGate({
            enabled: this.host.isEnabled(),
            meetingActive: this.host.isMeetingActive(),
            generationAtSchedule: generation,
            generationNow: this.host.meetingGeneration(),
            lastQuestion: this.host.lastInterviewerTurn(),
            lastAnsweredQuestion: this.lastAnsweredQuestion,
            engineAccepting: this.host.engineAccepting(),
        });
        if (!decision.dispatch) {
            if (decision.reason === 'engine_busy_or_cooling') {
                // Every other guard passed (the gate checks the engine last), so
                // the turn is real and current — park it.
                this.pending = {
                    turn: (this.host.lastInterviewerTurn() ?? '').trim(),
                    queuedAt: this.clock.now(),
                    generation,
                };
                this.startRetry();
            }
            this.host.onSkip?.(decision.reason);
            return;
        }
        if (!this.channelsPermitDispatch()) return;
        this.commit(decision.question);
    }

    /**
     * The dual-channel precondition, evaluated at the moment every other guard
     * has passed. Returns true to dispatch now. Otherwise either re-arms the
     * timer for the remaining hold (user silent for < USER_SILENCE_MS, or both
     * channels active inside OVERLAP_VETO_MS) or drops the candidate as
     * `user_answering` (the user is talking, or the hold budget is spent).
     */
    private channelsPermitDispatch(): boolean {
        const now = this.clock.now();
        const c = this.channels;
        const { userSilenceMs, overlapVetoMs, holdBudgetMs } = this.tuning;
        const cleanUserSpeech = c.userSpeaking && (!c.interviewerSpeaking || c.userEdgesVadBacked);
        if (cleanUserSpeech) {
            this.dropHeld('user_answering');
            return false;
        }
        let holdMs = 0;
        const both = c.userSpeaking && c.interviewerSpeaking;
        // The interviewer resumed inside the quiet window: the question may not
        // be over. Re-check on the veto cadence; the next final restarts the
        // debounce properly. Precision over latency.
        if (c.interviewerSpeaking) holdMs = Math.max(holdMs, overlapVetoMs);
        if (both) {
            holdMs = Math.max(holdMs, overlapVetoMs);
        } else if (c.lastBothEndedAt !== null) {
            holdMs = Math.max(holdMs, overlapVetoMs - (now - c.lastBothEndedAt));
        }
        if (c.lastUserEndedAt !== null) {
            holdMs = Math.max(holdMs, userSilenceMs - (now - c.lastUserEndedAt));
        }
        if (holdMs <= 0) {
            this.holdStartedAt = null;
            return true;
        }
        if (this.holdStartedAt === null) this.holdStartedAt = now;
        const budgetLeft = holdBudgetMs - (now - this.holdStartedAt);
        if (budgetLeft <= 0) {
            this.dropHeld(c.userSpeaking ? 'user_answering' : 'incomplete');
            return false;
        }
        this.timer = this.clock.setTimeout(() => this.fire(), Math.max(1, Math.min(holdMs, budgetLeft)));
        return false;
    }

    private dropHeld(reason: AutoAnswerSchedulerSkipReason): void {
        this.holdStartedAt = null;
        this.host.onSkip?.(reason);
    }

    private tryRearm(): void {
        const pending = this.pending;
        if (!pending) return;
        if (this.clock.now() - pending.queuedAt > PENDING_TTL_MS) {
            this.dropPending('pending_expired');
            return;
        }
        const decision = evaluateAutoAnswerGate({
            enabled: this.host.isEnabled(),
            meetingActive: this.host.isMeetingActive(),
            generationAtSchedule: pending.generation,
            generationNow: this.host.meetingGeneration(),
            lastQuestion: this.host.lastInterviewerTurn(),
            lastAnsweredQuestion: this.lastAnsweredQuestion,
            engineAccepting: this.host.engineAccepting(),
        });
        if (!decision.dispatch) {
            if (decision.reason === 'engine_busy_or_cooling') return; // keep waiting, retry timer is running
            this.dropPending(decision.reason);
            return;
        }
        // The conversation moved on since the candidate was parked: the newer
        // turn armed (or will arm) its own timer, and this slot must not fire
        // the question the interviewer has already left behind.
        if (decision.question !== pending.turn) {
            this.dropPending('pending_superseded');
            return;
        }
        this.pending = null;
        this.stopRetry();
        if (!this.channelsPermitDispatch()) return;
        this.commit(decision.question);
    }

    private commit(question: string): void {
        this.lastAnsweredQuestion = question;
        this.automaticAnswerInFlight = true;
        this.host.dispatch(question);
    }

    private dropPending(reason: AutoAnswerSchedulerSkipReason): void {
        this.pending = null;
        this.stopRetry();
        this.host.onSkip?.(reason);
    }

    private startRetry(): void {
        this.stopRetry();
        this.retryTimer = this.clock.setTimeout(() => {
            this.retryTimer = null;
            if (!this.pending) return;
            this.tryRearm();
            if (this.pending) this.startRetry();
        }, PENDING_RETRY_MS);
    }

    private stopRetry(): void {
        if (this.retryTimer !== null) { this.clock.clearTimeout(this.retryTimer); this.retryTimer = null; }
    }
}
