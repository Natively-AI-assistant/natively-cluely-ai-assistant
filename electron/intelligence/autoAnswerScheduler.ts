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
    | 'pending_superseded';

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
}

export class AutoAnswerScheduler {
    private timer: ClockTimer | null = null;
    private retryTimer: ClockTimer | null = null;
    /** First final of the current accumulation, or null when nothing is armed. */
    private firstFinalAt: number | null = null;
    private generationAtArm = 0;
    /** The turn already dispatched — the planner's cooldown alone would re-answer a stable last turn. */
    private lastAnsweredQuestion: string | null = null;
    private pending: PendingAutoAnswer | null = null;

    constructor(
        private readonly host: AutoAnswerSchedulerHost,
        private readonly clock: Clock = systemClock,
    ) {}

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
        if (this.pending) this.tryRearm();
    }

    /** Meeting stop/start or toggle off: nothing armed may survive. */
    cancel(): void {
        if (this.timer !== null) { this.clock.clearTimeout(this.timer); this.timer = null; }
        this.stopRetry();
        this.firstFinalAt = null;
        this.pending = null;
        this.lastAnsweredQuestion = null;
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
        this.commit(decision.question);
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
        this.commit(decision.question);
    }

    private commit(question: string): void {
        this.lastAnsweredQuestion = question;
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
