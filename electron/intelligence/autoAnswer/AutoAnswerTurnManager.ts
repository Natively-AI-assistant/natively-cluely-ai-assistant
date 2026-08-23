/**
 * AutoAnswerTurnManager — turn accumulation and endpoint reasoning (V2 §5-§8).
 *
 * Receives EVERY interviewer transcript event (partials and finals) plus the
 * speech-edge and provider-endpoint hooks, reconstructs the complete utterance
 * from its finalized fragments (V2 §6: "What was the hardest" + "technical
 * problem" + "you had to solve?" is ONE candidate), and commits it when the
 * adaptive quiet window expires — never on a single `isFinal` (V2 §2).
 *
 * Timing (all named constants, unfitted until the audio corpus exists):
 *   - quiet window: pace preset (V2 §8), restarted by every interviewer
 *     final, partial and speech-start;
 *   - HARD_CAP_MS from the FIRST final of the accumulation (V3 Amendment 3):
 *     a chatty provider can never starve the timer (the Phase 1 fix, folded);
 *   - a user final, or CANDIDATE_GAP_MS of nothing, closes the accumulation
 *     so the next interviewer final starts a fresh candidate.
 *
 * Phase 5 adds provider EOT / TurnPredictor fusion on top of the same commit
 * path (`commit(source, confidence)`); the window stays the floor.
 */

import type { TranscriptSegment } from '../../SessionTracker';
import type { Clock, ClockTimer } from './AutoAnswerClock';
import { systemClock } from './AutoAnswerClock';
import type { AutoAnswerCandidate, AutoAnswerEndpointSource, AutoAnswerPace, TranscriptEndpointEvent } from './AutoAnswerTypes';

/** Quiet-window presets (V2 §8 / V3 Amendment 3). Unfitted placeholders. */
export const QUIET_WINDOW_MS: Record<AutoAnswerPace, number> = {
    fast: 700,
    balanced: 1100,
    relaxed: 1800,
};
/** Ceiling from the first final of an accumulation (V3 Amendment 3). Unfitted placeholder. */
export const HARD_CAP_MS = 2500;
/** Silence after which the next interviewer final is a NEW candidate, not a continuation. Unfitted placeholder. */
export const CANDIDATE_GAP_MS = 4000;

// ── Endpoint fusion (V3 Amendment 3). Starting values, tuned only via the harness. ──
/** p >= CONFIDENT_ENDPOINT_P → commit after CONFIRM_HIGH_MS of continued silence. */
export const CONFIDENT_ENDPOINT_P = 0.90;
export const CONFIRM_HIGH_MS = 250;
/** LIKELY_ENDPOINT_P <= p < CONFIDENT_ENDPOINT_P → CONFIRM_MID_MS. */
export const LIKELY_ENDPOINT_P = 0.70;
export const CONFIRM_MID_MS = 600;
/** POSSIBLE_ENDPOINT_P <= p < LIKELY_ENDPOINT_P → the pace preset; below → hold (the hard cap still applies). */
export const POSSIBLE_ENDPOINT_P = 0.45;
/** Provider signals that carry no confidence of their own (Deepgram speech_final / UtteranceEnd, Soniox <end>). */
export const DEFAULT_ENDPOINT_CONFIDENCE: Record<'provider' | 'speech_final' | 'utterance_end', number> = {
    provider: 0.80,
    speech_final: 0.85,
    utterance_end: 0.75,
};

/** The adaptive wait after an endpoint signal of confidence `p` (ms), or null for "hold" (no shortening). */
export function confirmBudgetMs(p: number, pace: AutoAnswerPace): number | null {
    if (p >= CONFIDENT_ENDPOINT_P) return CONFIRM_HIGH_MS;
    if (p >= LIKELY_ENDPOINT_P) return CONFIRM_MID_MS;
    if (p >= POSSIBLE_ENDPOINT_P) return QUIET_WINDOW_MS[pace];
    return null;
}
/**
 * A final landing this soon after a commit that has NOT been dispatched yet is
 * a revision of the same question (V2 §22 rule 2), not a second question.
 */
export const REVISION_WINDOW_MS = 1500;

export interface TurnManagerEvents {
    /** The quiet window / cap / endpoint committed a candidate. */
    onCommit(candidate: AutoAnswerCandidate): void;
    /** New interviewer evidence arrived while a candidate existed (partials included). */
    onRevision?(candidate: AutoAnswerCandidate): void;
    /** Normalized endpoint event, for telemetry and Phase 5 fusion. */
    onEndpointEvent?(event: TranscriptEndpointEvent): void;
    /** An accumulation with finals was abandoned without a commit (a user turn closed it). */
    onDiscard?(candidate: AutoAnswerCandidate, reason: 'user_turn' | 'gap'): void;
}

interface Accumulation {
    meetingGeneration?: number;
    segments: TranscriptSegment[];
    startedAt: number;
    firstFinalAt: number | null;
    lastUpdatedAt: number;
    generation: number;
    latestPartial: string;
    punctuationSource?: string;
    sttProvider?: string;
}

export class AutoAnswerTurnManager {
    private acc: Accumulation | null = null;
    private timer: ClockTimer | null = null;
    /** Which tier owns the current deadline; a lower tier never overrides a higher one (provider > local > window). */
    private deadlineTier: 'window' | 'local' | 'provider' = 'window';
    private deadlineAt: number | null = null;
    private pendingSource: AutoAnswerEndpointSource = 'quiet_window';
    private pendingConfidence: number | undefined;
    private pace: AutoAnswerPace;
    private generationCounter = 0;
    /** Last committed candidate, kept so a fast follow-on final can revise it. */
    private lastCommit: { candidate: AutoAnswerCandidate; at: number; dispatched: boolean; openUntil: number } | null = null;

    constructor(
        private readonly events: TurnManagerEvents,
        private readonly clock: Clock = systemClock,
        pace: AutoAnswerPace = 'balanced',
    ) {
        this.pace = pace;
    }

    setPace(pace: AutoAnswerPace): void { this.pace = pace; }
    getPace(): AutoAnswerPace { return this.pace; }

    /** The candidate under construction (finals only), or null. */
    getCandidate(): AutoAnswerCandidate | null {
        if (!this.acc || this.acc.segments.length === 0) return null;
        return this.snapshot(this.acc, 'quiet_window');
    }

    isArmed(): boolean { return this.timer !== null; }

    /** Mark the last commit as dispatched: a later final is a NEW question, not a revision. */
    markDispatched(): void {
        if (this.lastCommit) this.lastCommit.dispatched = true;
    }

    /**
     * The detector judged the last commit INCOMPLETE ("How would you…"): keep
     * it open for continuation for a full CANDIDATE_GAP_MS instead of the
     * short revision window, so the rest of the question glues onto it.
     */
    holdOpen(): void {
        if (this.lastCommit && !this.lastCommit.dispatched) {
            this.lastCommit.openUntil = this.clock.now() + CANDIDATE_GAP_MS;
        }
    }

    /** Every transcript segment, any speaker. Non-interviewer finals close the accumulation. */
    ingest(segment: TranscriptSegment, meetingGeneration?: number): void {
        const now = this.clock.now();
        if (segment.speaker !== 'interviewer') {
            if (segment.final && (segment.text ?? '').trim()) this.closeAccumulation('user_turn');
            return;
        }
        const text = (segment.text ?? '').trim();
        if (!text) return;

        if (!segment.final) {
            this.events.onEndpointEvent?.({ type: 'partial', timestamp: now });
            if (this.acc) {
                this.acc.latestPartial = text;
                this.acc.lastUpdatedAt = now;
                this.acc.generation = ++this.generationCounter;
                this.events.onRevision?.(this.snapshot(this.acc, 'quiet_window'));
                this.arm(now);
            }
            return;
        }

        this.events.onEndpointEvent?.({ type: 'segment_final', timestamp: now });

        // A fast follow-on to an undispatched commit revises it in place —
        // unless the committed text already ended as a sentence, in which case
        // this final is the interviewer's NEXT question, never a continuation.
        if (!this.acc && this.lastCommit && !this.lastCommit.dispatched
            && now <= this.lastCommit.openUntil
            && looksLikeContinuation(this.lastCommit.candidate.text, text)) {
            const prev = this.lastCommit.candidate;
            this.acc = {
                meetingGeneration: prev.meetingGeneration,
                segments: [...prev.segments],
                startedAt: prev.startedAt,
                firstFinalAt: now, // the cap re-measures from this continuation's first final
                lastUpdatedAt: now,
                generation: prev.generation,
                latestPartial: '',
                punctuationSource: prev.punctuationSource,
                sttProvider: prev.sttProvider,
            };
            this.lastCommit = null;
        }

        if (this.acc && now - this.acc.lastUpdatedAt > CANDIDATE_GAP_MS) this.closeAccumulation('gap');
        if (!this.acc) {
            this.acc = {
                meetingGeneration,
                segments: [],
                startedAt: now,
                firstFinalAt: null,
                lastUpdatedAt: now,
                generation: 0,
                latestPartial: '',
            };
        }
        const acc = this.acc;
        if (acc.firstFinalAt === null) acc.firstFinalAt = now;
        acc.segments.push(segment);
        acc.latestPartial = '';
        acc.lastUpdatedAt = now;
        acc.generation = ++this.generationCounter;
        acc.punctuationSource = segment.punctuationSource ?? acc.punctuationSource;
        acc.sttProvider = segment.sttProvider ?? acc.sttProvider;
        this.events.onRevision?.(this.snapshot(acc, 'quiet_window'));
        this.arm(now);
    }

    /** Interviewer speech resumed (native VAD): the quiet window restarts. */
    onSpeechStarted(channel: 'interviewer' | 'user', timestamp: number): void {
        if (channel !== 'interviewer') return;
        this.events.onEndpointEvent?.({ type: 'speech_started', timestamp });
        if (this.acc && this.timer !== null) this.arm(this.clock.now());
    }

    /** Interviewer speech stopped (native VAD). Recorded for telemetry; the window is already running. */
    onSpeechEnded(_channel: 'interviewer' | 'user', _timestamp: number): void {
        // Phase 5: feeds the TurnPredictor. Nothing to do on the deterministic path.
    }

    /**
     * A provider endpoint (Deepgram speech_final / UtteranceEnd, Flux EndOfTurn,
     * AssemblyAI end_of_turn, Soniox <end>). Tier 1 of the fusion: its
     * confidence sets the confirm budget and overrides any local/window deadline.
     */
    onProviderEndpoint(event: TranscriptEndpointEvent): void {
        this.events.onEndpointEvent?.(event);
        // Only the two END signals propose a deadline; speech_started / partial /
        // segment_final are resumes or evidence, handled by ingest/onSpeechStarted.
        if (event.type !== 'speech_final' && event.type !== 'utterance_end') return;
        const source: AutoAnswerEndpointSource = event.type;
        const p = event.confidence ?? DEFAULT_ENDPOINT_CONFIDENCE[source];
        this.proposeEndpoint('provider', source, p);
    }

    /**
     * Tier 2 of the fusion: the local TurnPredictor's endpoint probability for
     * the current silence (Smart Turn on the interviewer audio). Never
     * overrides a provider deadline; shortens the window when confident.
     */
    onLocalPrediction(pEndpoint: number): void {
        this.proposeEndpoint('local', 'semantic', pEndpoint);
    }

    private proposeEndpoint(tier: 'provider' | 'local', source: AutoAnswerEndpointSource, p: number): void {
        // Deterministic floor: an endpoint with no finals yet is noise.
        if (!this.acc || this.acc.segments.length === 0 || this.acc.firstFinalAt === null) return;
        const rank = { window: 0, local: 1, provider: 2 } as const;
        if (this.deadlineAt !== null && rank[tier] < rank[this.deadlineTier]) return;
        const budget = confirmBudgetMs(p, this.pace);
        const now = this.clock.now();
        if (budget === null) {
            // "Hold": do not shorten; the quiet window / hard cap already armed stand.
            return;
        }
        const capRemaining = HARD_CAP_MS - (now - this.acc.firstFinalAt);
        const delay = Math.max(0, Math.min(budget, capRemaining));
        // Only ever move the deadline EARLIER within a tier; a later proposal of
        // the same tier must not extend a confident one.
        const proposedAt = now + delay;
        if (this.deadlineAt !== null && rank[tier] === rank[this.deadlineTier] && proposedAt > this.deadlineAt) return;
        this.setDeadline(proposedAt, tier, source, p);
    }

    /** Meeting stop/start: nothing armed may survive. */
    reset(): void {
        this.disarm();
        this.acc = null;
        this.lastCommit = null;
    }

    // ── internals ─────────────────────────────────────────────────────────

    /** New interviewer evidence: back to the window tier (a TurnResumed wipes any endpoint proposal). */
    private arm(now: number): void {
        this.disarm();
        const acc = this.acc;
        if (!acc || acc.firstFinalAt === null) return; // partials alone never commit
        const capRemaining = HARD_CAP_MS - (now - acc.firstFinalAt);
        const delay = Math.max(0, Math.min(QUIET_WINDOW_MS[this.pace], capRemaining));
        this.setDeadline(now + delay, 'window', 'quiet_window', undefined);
    }

    private setDeadline(at: number, tier: 'window' | 'local' | 'provider', source: AutoAnswerEndpointSource, confidence: number | undefined): void {
        if (this.timer !== null) { this.clock.clearTimeout(this.timer); this.timer = null; }
        this.deadlineAt = at;
        this.deadlineTier = tier;
        this.pendingSource = source;
        this.pendingConfidence = confidence;
        const delay = Math.max(0, at - this.clock.now());
        this.timer = this.clock.setTimeout(() => {
            this.timer = null;
            this.deadlineAt = null;
            this.commit(this.pendingSource, this.pendingConfidence);
        }, delay);
    }

    private disarm(): void {
        if (this.timer !== null) { this.clock.clearTimeout(this.timer); this.timer = null; }
        this.deadlineAt = null;
        this.deadlineTier = 'window';
        this.pendingSource = 'quiet_window';
        this.pendingConfidence = undefined;
    }

    private commit(source: AutoAnswerEndpointSource, confidence?: number): void {
        const acc = this.acc;
        if (!acc || acc.segments.length === 0) return;
        this.disarm();
        const candidate = this.snapshot(acc, source, confidence);
        this.acc = null;
        const at = this.clock.now();
        this.lastCommit = { candidate, at, dispatched: false, openUntil: at + REVISION_WINDOW_MS };
        this.events.onCommit(candidate);
    }

    private closeAccumulation(reason: 'user_turn' | 'gap'): void {
        this.disarm();
        const acc = this.acc;
        this.acc = null;
        if (acc && acc.segments.length > 0) this.events.onDiscard?.(this.snapshot(acc, 'quiet_window'), reason);
        // A user turn means the previous commit is answered/abandoned; no revision after it.
        if (this.lastCommit) this.lastCommit.dispatched = true;
    }

    private snapshot(acc: Accumulation, source: AutoAnswerEndpointSource, confidence?: number): AutoAnswerCandidate {
        return {
            text: joinFinals(acc.segments.map(s => s.text)),
            segments: [...acc.segments],
            startedAt: acc.startedAt,
            lastUpdatedAt: acc.lastUpdatedAt,
            generation: acc.generation,
            endpointSource: source,
            ...(confidence !== undefined ? { endpointConfidence: confidence } : {}),
            ...(acc.punctuationSource ? { punctuationSource: acc.punctuationSource } : {}),
            ...(acc.sttProvider ? { sttProvider: acc.sttProvider } : {}),
            ...(acc.meetingGeneration !== undefined ? { meetingGeneration: acc.meetingGeneration } : {}),
        };
    }
}

/**
 * Does `next` continue `prev`? A sentence that already closed with terminal
 * punctuation is finished; anything after it is a new turn. Without
 * punctuation (providers that never guarantee it) a lowercase or
 * conjunction-led start is the only continuation evidence we have, and a
 * capitalised interrogative start is evidence of a new question.
 */
export function looksLikeContinuation(prev: string, next: string): boolean {
    if (/[.?!]\s*$/.test(prev)) return false;
    if (/^(and|or|but|so|because|which|that|if|when|where|to|of|for|with|the|a|an)\b/i.test(next)) return true;
    if (/^[a-z]/.test(next)) return true;
    if (/^(how|what|why|when|where|which|who|tell|walk|explain|describe|can|could|would|do|did)\b/i.test(next)) return false;
    return true;
}

/**
 * Join finalized fragments into one utterance. Providers split on their own
 * boundaries, so fragments rarely carry terminal punctuation; a single space
 * is the only safe joiner (V2 §6 example).
 */
export function joinFinals(parts: string[]): string {
    return parts.map(p => p.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
