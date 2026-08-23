/**
 * AutoAnswerController — the wiring facade AppState talks to (V2 §24-§28,
 * §42-§46; V3 Amendments 1, 4, 6).
 *
 *   STT event → ingest() → TurnManager → commit
 *        → Detector (extractor + acts + answerability)
 *        → Dedup (normalized → Jaccard → embedding on survivors)
 *        → Policy (ternary auto | offer | silent, + wait/queue)
 *        → ChannelGate (user silent? boundary clean?) → hold or dispatch
 *        → host.dispatch(question) → existing What-to-Answer generation
 *
 * AppState owns lifecycle and plumbing only. The controller owns the state
 * machine (V2 §18), question identity (V2 §20), the generation guards (V2
 * §28/§46) and every skip reason (V2 §30). Telemetry (V2 §29) is structured
 * and carries NO transcript text.
 *
 * With the toggle OFF nothing here runs: `ingest` returns before touching any
 * state, no timer is armed, no telemetry fires — a test pins that.
 */

import type { TranscriptSegment } from '../../SessionTracker';
import type { TranscriptTurn } from '../../llm/transcriptCleaner';
import type { SpeechEdge } from '../../audio/speechEdge';
import type { Clock, ClockTimer } from './AutoAnswerClock';
import { systemClock } from './AutoAnswerClock';
import { AutoAnswerTurnManager } from './AutoAnswerTurnManager';
import { AutoAnswerDetector, scoreCandidate } from './AutoAnswerDetector';
import { AutoAnswerDedup, REUSE_THRESHOLD, type Embedder } from './AutoAnswerDedup';
import { AutoAnswerQueue, MAX_QUEUE_DEPTH } from './AutoAnswerQueue';
import { evaluateAutoAnswerPolicy, DEFAULT_THRESHOLDS, type AutoAnswerThresholds } from './AutoAnswerPolicy';
import { AutoAnswerChannelGate, type AutoAnswerChannelTuning } from './AutoAnswerChannelGate';
import type {
    AutoAnswerCandidate, AutoAnswerPace, AutoAnswerQuestion, AutoAnswerSkipReason, AutoAnswerState,
    AutoAnswerTelemetryEvent, TranscriptEndpointEvent,
} from './AutoAnswerTypes';

/** Retry cadence while a question waits for the engine (cooldown has no event). Unfitted placeholder. */
export const QUEUE_RETRY_MS = 500;

export interface SpeculativeSnapshot {
    /** The questionId the engine's speculative run was keyed on, if the controller supplied one. */
    questionId: string | null;
    text: string | null;
}

export interface AutoAnswerControllerHost {
    isEnabled(): boolean;
    isMeetingActive(): boolean;
    meetingGeneration(): number;
    /** IntelligenceEngine.canAutoAnswer(): mode idle/assist AND cooldown elapsed. */
    engineAccepting(): boolean;
    /** A MANUAL What-to-Answer is streaming. */
    manualAnswerActive(): boolean;
    /** The recent finalized turns + interim partial (LiveTranscriptBrain.getHotWindow). */
    recentTurns(): TranscriptTurn[];
    /** The engine's current speculative cache identity, for keyed reuse (V3 Amendment 6). */
    speculativeSnapshot?(): SpeculativeSnapshot;
    /** Tell the engine which candidate is current so a speculative run it starts is keyed to it. */
    noteCandidate?(questionId: string, candidateGeneration: number): void;
    dispatch(question: AutoAnswerQuestion, options: { reuseSpeculative: boolean }): void;
    /** Phase 6 renders the card; absent host → offers are telemetry only. */
    offer?(question: AutoAnswerQuestion): void;
    cancelAutomaticAnswer(reason: 'user_barge_in'): boolean;
    telemetry?(event: AutoAnswerTelemetryEvent): void;
    /** Verbose log line (reason codes only, never text). */
    log?(line: string): void;
}

export interface AutoAnswerControllerOptions {
    clock?: Clock;
    embed?: Embedder | null;
    thresholds?: AutoAnswerThresholds;
    channelTuning?: Partial<AutoAnswerChannelTuning>;
    pace?: AutoAnswerPace;
}

interface Committed {
    question: AutoAnswerQuestion;
    candidate: AutoAnswerCandidate;
    committedAt: number;
}

export class AutoAnswerController {
    private readonly clock: Clock;
    private readonly turns: AutoAnswerTurnManager;
    private readonly detector = new AutoAnswerDetector();
    private readonly dedup: AutoAnswerDedup;
    private readonly queue = new AutoAnswerQueue();
    private readonly channels: AutoAnswerChannelGate;
    private thresholds: AutoAnswerThresholds;

    private state: AutoAnswerState = 'idle';
    private questionSequence = 0;
    /** The latest committed question (the only one allowed to dispatch). */
    private current: Committed | null = null;
    /** startedAt of the accumulation behind `current`, to recognise a revision. */
    private currentStartedAt: number | null = null;
    private holdTimer: ClockTimer | null = null;
    private retryTimer: ClockTimer | null = null;
    private lastDispatchedText: string | null = null;
    private automaticAnswerInFlight = false;
    /** Monotonic token so an awaited dedup/dispatch can tell it was superseded. */
    private evaluation = 0;

    constructor(private readonly host: AutoAnswerControllerHost, options: AutoAnswerControllerOptions = {}) {
        this.clock = options.clock ?? systemClock;
        this.dedup = new AutoAnswerDedup(options.embed ?? null);
        this.channels = new AutoAnswerChannelGate(options.channelTuning);
        this.thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
        this.turns = new AutoAnswerTurnManager({
            onCommit: (c) => this.onCommit(c),
            onRevision: (c) => this.onRevision(c),
            onEndpointEvent: (e) => this.onEndpointEvent(e),
            onDiscard: (c, reason) => {
                // The user took the floor before the interviewer's turn was
                // judged: they did not need help. Machine-readable, never silent.
                this.skip(reason === 'user_turn' ? 'user_answering' : 'incomplete', undefined, { candidateWordCount: wordCount(c.text) });
                if (this.state === 'possible_question' || this.state === 'speculating') this.setState('listening');
            },
        }, this.clock, options.pace ?? 'balanced');
    }

    // ── lifecycle (AppState) ───────────────────────────────────────────────

    onMeetingStart(): void {
        this.resetAll();
        if (this.host.isEnabled()) this.setState('listening');
    }

    onMeetingStop(): void {
        this.resetAll();
        this.setState('idle');
    }

    /** The engine reported idle (`mode_changed → idle`). */
    onEngineIdle(): void {
        if (this.automaticAnswerInFlight) {
            this.automaticAnswerInFlight = false;
            this.emit({ name: 'auto_answer_completed', questionId: this.current?.question.id });
        }
        if (this.state === 'answering') this.setState(this.queue.depth() ? 'queued' : 'listening');
        this.tryDequeue();
    }

    setThresholds(thresholds: AutoAnswerThresholds): void { this.thresholds = thresholds; }
    setPace(pace: AutoAnswerPace): void { this.turns.setPace(pace); }
    getState(): AutoAnswerState { return this.state; }
    getCurrentQuestion(): AutoAnswerQuestion | null { return this.current?.question ?? null; }
    /** Test/diagnostic visibility. */
    queueDepth(): number { return this.queue.depth(); }
    isHolding(): boolean { return this.holdTimer !== null; }

    // ── inputs ────────────────────────────────────────────────────────────

    /** Every transcript segment (any speaker, partial or final). */
    ingest(segment: TranscriptSegment): void {
        if (!this.host.isEnabled()) return;
        if (!this.host.isMeetingActive()) return;
        if (this.state === 'idle') this.setState('listening');
        this.turns.ingest(segment, this.host.meetingGeneration());
    }

    onSpeechEdge(edge: SpeechEdge): void {
        if (!this.host.isEnabled()) return;
        const significance = this.channels.noteEdge(edge);
        if (edge.channel === 'interviewer') {
            if (edge.speaking) this.turns.onSpeechStarted('interviewer', edge.atMs);
            else this.turns.onSpeechEnded('interviewer', edge.atMs);
            return;
        }
        // 'overlap' (the user began while the interviewer was still talking) is
        // a hold for the channel gate at dispatch time, never a cancellation.
        if (significance !== 'user_speech') return;

        if (this.automaticAnswerInFlight && this.host.cancelAutomaticAnswer('user_barge_in')) {
            this.automaticAnswerInFlight = false;
            this.emit({ name: 'auto_answer_cancelled', questionId: this.current?.question.id, skipReason: 'user_barge_in' });
            this.setState('listening');
        }
        // The user is answering: whatever is held or queued is theirs now.
        if (this.holdTimer !== null || this.queue.depth() > 0) {
            this.clearHold();
            const dropped = this.queue.depth();
            this.queue.clear();
            this.stopRetry();
            this.skip('user_answering', this.current?.question, { queueDepth: dropped });
            this.setState('listening');
        }
        // A candidate still accumulating is the interviewer's; the turn manager keeps it.
    }

    /** Provider endpoint signals (Phase 5 adapters). */
    onProviderEndpoint(event: TranscriptEndpointEvent): void {
        if (!this.host.isEnabled()) return;
        this.turns.onProviderEndpoint(event);
    }

    // ── pipeline ──────────────────────────────────────────────────────────

    private onRevision(candidate: AutoAnswerCandidate): void {
        if (this.state === 'listening' || this.state === 'idle') this.setState('possible_question');
        // Keep the engine's speculative prefetch keyed to this candidate.
        const id = this.idFor(candidate);
        this.host.noteCandidate?.(id, candidate.generation);
        if (this.state === 'possible_question' && candidate.segments.length > 0) {
            const scores = this.safeScore(candidate, id);
            if (scores && scores.answerability >= this.thresholds.speculationThreshold) {
                this.setState('speculating');
                this.emit({
                    name: 'auto_answer_speculative', questionId: id,
                    questionConfidence: scores.questionConfidence, answerability: scores.answerability,
                    dialogueAct: scores.dialogueAct, candidateWordCount: wordCount(candidate.text),
                });
            }
        }
    }

    private onEndpointEvent(event: TranscriptEndpointEvent): void {
        if (event.type === 'partial' || event.type === 'segment_final') return;
        this.emit({ name: 'auto_answer_endpoint', endpointSource: event.type === 'speech_started' ? 'vad' : event.type === 'speech_final' ? 'speech_final' : event.type === 'utterance_end' ? 'utterance_end' : 'provider' });
    }

    private onCommit(candidate: AutoAnswerCandidate): void {
        const now = this.clock.now();
        // The generation the accumulation STARTED under: a stop→start inside
        // the quiet window must read as stale at dispatch (V2 §28).
        const meetingGeneration = candidate.meetingGeneration ?? this.host.meetingGeneration();
        const id = this.idFor(candidate);
        this.clearHold();

        let decision;
        try {
            decision = this.detector.detect({
                candidate,
                recentTurns: this.turnsBefore(candidate),
                endpointSource: candidate.endpointSource,
                punctuationSource: candidate.punctuationSource,
                questionId: id,
                candidateGeneration: candidate.generation,
                meetingGeneration,
                now,
            });
        } catch (err) {
            this.host.log?.(`[AutoAnswer] detector failed: ${(err as Error)?.message ?? err}`);
            return;
        }
        const question = decision.question!;
        this.emit({
            name: 'auto_answer_candidate', questionId: id, provider: candidate.sttProvider,
            dialogueAct: question.dialogueAct, questionConfidence: question.confidence,
            completionConfidence: question.completionConfidence, answerability: question.answerability,
            endpointSource: question.endpointSource, candidateWordCount: wordCount(candidate.text),
            msFromLastSpeechToDecision: now - candidate.lastUpdatedAt,
        });

        if (decision.action === 'wait' && decision.reason === 'incomplete') {
            // Not finished: the turn manager's revision window will extend it.
            this.current = { question, candidate, committedAt: now };
            this.currentStartedAt = candidate.startedAt;
            this.turns.holdOpen();
            this.setState('possible_question');
            this.emit({ name: 'auto_answer_decision', questionId: id, action: 'wait', skipReason: 'incomplete' });
            return;
        }
        if (decision.action === 'ignore') {
            this.current = { question, candidate, committedAt: now };
            this.currentStartedAt = candidate.startedAt;
            this.turns.markDispatched(); // an ignored statement is closed; the next final is a new candidate
            this.skip(decision.reason as AutoAnswerSkipReason, question);
            this.setState('listening');
            return;
        }

        this.current = { question, candidate, committedAt: now };
        this.currentStartedAt = candidate.startedAt;
        this.setState('question_complete');
        this.evaluate(++this.evaluation);
    }

    /**
     * Dedup → policy → channel gate → dispatch/hold/queue. The cheap dedup
     * layers decide synchronously (deterministic timing); only an ambiguous
     * pair awaits the embedder, after which the generation token is re-checked.
     */
    private evaluate(token: number): void {
        const committed = this.current;
        if (!committed) return;
        const { question } = committed;

        let cheap;
        try { cheap = this.dedup.checkCheap(question.text); } catch { cheap = { duplicate: false, layer: 'none' } as const; }
        if (cheap !== 'ambiguous') {
            if (cheap.duplicate) this.emit({ name: 'auto_answer_deduplicated', questionId: question.id, skipReason: 'duplicate' });
            this.decide(committed, cheap.duplicate);
            return;
        }
        void (async () => {
            let duplicate = false;
            try {
                const verdict = await this.dedup.check(question.id, question.text);
                duplicate = verdict.duplicate;
            } catch { /* dedup must never block a decision */ }
            if (token !== this.evaluation || this.current !== committed) return; // superseded while awaiting
            if (duplicate) this.emit({ name: 'auto_answer_deduplicated', questionId: question.id, skipReason: 'duplicate' });
            this.decide(committed, duplicate);
        })();
    }

    private decide(committed: Committed, duplicate: boolean): void {
        const { question } = committed;
        const now = this.clock.now();
        const policy = evaluateAutoAnswerPolicy({
            enabled: this.host.isEnabled(),
            meetingActive: this.host.isMeetingActive(),
            generationAtCommit: question.meetingGeneration,
            generationNow: this.host.meetingGeneration(),
            question,
            engineAccepting: this.host.engineAccepting(),
            manualAnswerActive: this.host.manualAnswerActive(),
            automaticAnswerActive: this.automaticAnswerInFlight,
            duplicate,
            lastAnsweredText: this.lastDispatchedText,
            queueDepth: this.queue.depth(),
            maxQueueDepth: MAX_QUEUE_DEPTH,
            userChannelClear: !this.channels.isUserSpeaking(),
            thresholds: this.thresholds,
        });
        this.emit({ name: 'auto_answer_decision', questionId: question.id, action: policy.action, skipReason: policy.reason === 'ok' ? undefined : policy.reason, answerability: question.answerability });

        switch (policy.action) {
            case 'silent':
                this.turns.markDispatched();
                this.skip(policy.reason as AutoAnswerSkipReason, question);
                this.setState('listening');
                return;
            case 'offer':
                this.turns.markDispatched();
                this.dedup.remember({ id: question.id, text: question.text, committedAt: now, meetingGeneration: question.meetingGeneration });
                this.emit({ name: 'auto_answer_offered', questionId: question.id, answerability: question.answerability, dialogueAct: question.dialogueAct });
                this.host.offer?.(question);
                this.setState('listening');
                return;
            case 'queue': {
                const evicted = this.queue.enqueue(question, now);
                if (evicted) this.skip('pending_superseded', evicted.question);
                this.emit({ name: 'auto_answer_queued', questionId: question.id, queueDepth: this.queue.depth() });
                this.setState('queued');
                this.startRetry();
                return;
            }
            case 'wait':
                if (policy.reason === 'incomplete') { this.setState('possible_question'); return; }
                this.gateAndDispatch(committed);
                return;
            case 'auto':
                this.gateAndDispatch(committed);
                return;
            case 'speculate':
                return;
        }
    }

    /** The dual-channel gate: dispatch now, hold, or drop. */
    private gateAndDispatch(committed: Committed): void {
        const verdict = this.channels.verdict(this.clock.now());
        if (verdict.kind === 'drop') {
            this.turns.markDispatched();
            this.skip(verdict.reason, committed.question);
            this.setState('listening');
            return;
        }
        if (verdict.kind === 'hold') {
            this.clearHold();
            this.holdTimer = this.clock.setTimeout(() => {
                this.holdTimer = null;
                if (this.current !== committed) return; // a newer commit owns the slot
                this.decide(committed, false);
            }, verdict.holdMs);
            return;
        }
        this.dispatch(committed);
    }

    private dispatch(committed: Committed): void {
        const { question } = committed;
        const now = this.clock.now();
        // Generation guards (V2 §46): meeting, question identity, candidate generation.
        if (question.meetingGeneration !== this.host.meetingGeneration()) { this.skip('stale_generation', question); return; }
        if (this.current !== committed) { this.skip('stale_generation', question); return; }
        if (!this.host.isMeetingActive()) { this.skip('meeting_inactive', question); return; }

        question.committedAt = now;
        this.lastDispatchedText = question.text;
        this.dedup.remember({ id: question.id, text: question.text, committedAt: now, meetingGeneration: question.meetingGeneration });
        this.turns.markDispatched();
        this.channels.resetHold();
        this.emit({
            name: 'auto_answer_committed', questionId: question.id, dialogueAct: question.dialogueAct,
            answerability: question.answerability, endpointSource: question.endpointSource,
            msFromLastSpeechToDecision: now - committed.candidate.lastUpdatedAt, queueDepth: this.queue.depth(),
        });
        this.dispatchWithReuse(committed);
    }

    /**
     * Speculative reuse keyed by questionId (synchronous), else embedding
     * cosine (V3 Amendment 6, awaits the embedder and re-checks staleness),
     * else the engine's own Jaccard fallback decides.
     */
    private dispatchWithReuse(committed: Committed): void {
        const { question } = committed;
        let snap: SpeculativeSnapshot | undefined;
        try { snap = this.host.speculativeSnapshot?.(); } catch { snap = undefined; }
        if (snap?.questionId && snap.questionId === question.id) { this.callDispatch(question, true); return; }
        if (!snap?.text || !snap.questionId) { this.callDispatch(question, false); return; }
        const { questionId: snapId, text: snapText } = snap;
        void (async () => {
            let reuse = false;
            try {
                const cos = await this.dedup.similarity(snapId, snapText, question.id, question.text);
                reuse = cos !== null && cos >= REUSE_THRESHOLD;
            } catch { reuse = false; }
            if (this.current !== committed || question.meetingGeneration !== this.host.meetingGeneration()) return; // stale after await
            this.callDispatch(question, reuse);
        })();
    }

    private callDispatch(question: AutoAnswerQuestion, reuseSpeculative: boolean): void {
        // In-flight is marked HERE, at the real dispatch, never before an await:
        // a question dropped as stale after the embedder resolves must not
        // leave the controller believing an answer is streaming.
        this.automaticAnswerInFlight = true;
        this.setState('answering');
        try {
            this.host.dispatch(question, { reuseSpeculative });
        } catch (err) {
            this.host.log?.(`[AutoAnswer] dispatch failed: ${(err as Error)?.message ?? err}`);
            this.automaticAnswerInFlight = false;
            this.setState('listening');
        }
    }

    private tryDequeue(): void {
        const now = this.clock.now();
        for (const dropped of this.queue.evictStale(this.host.meetingGeneration(), now)) {
            this.skip('pending_expired', dropped.question);
        }
        const head = this.queue.peek();
        if (!head) { this.stopRetry(); return; }
        if (this.automaticAnswerInFlight || !this.host.engineAccepting() || this.host.manualAnswerActive()) return;
        // Only the CURRENT question may leave the queue: the interviewer has
        // moved past anything else.
        this.queue.dequeue(now);
        if (!this.current || this.current.question.id !== head.question.id) {
            this.skip('pending_superseded', head.question);
            this.tryDequeue();
            return;
        }
        this.stopRetry();
        this.gateAndDispatch(this.current);
    }

    // ── plumbing ──────────────────────────────────────────────────────────

    private idFor(candidate: AutoAnswerCandidate): string {
        if (this.current && this.currentStartedAt === candidate.startedAt) return this.current.question.id;
        if (this.pendingId && this.pendingIdStartedAt === candidate.startedAt) return this.pendingId;
        this.pendingId = `${this.host.meetingGeneration()}-q${++this.questionSequence}`;
        this.pendingIdStartedAt = candidate.startedAt;
        return this.pendingId;
    }
    private pendingId: string | null = null;
    private pendingIdStartedAt: number | null = null;

    private safeScore(candidate: AutoAnswerCandidate, id: string) {
        try {
            return scoreCandidate({
                candidate, recentTurns: this.turnsBefore(candidate), questionId: id,
                candidateGeneration: candidate.generation, meetingGeneration: this.host.meetingGeneration(), now: this.clock.now(),
            });
        } catch { return null; }
    }

    /**
     * The hot window WITHOUT the candidate's own finals (they are already in
     * the session by commit time and would otherwise appear twice when the
     * detector appends the reconstructed utterance as the last turn).
     */
    private turnsBefore(candidate: AutoAnswerCandidate): TranscriptTurn[] {
        let turns: TranscriptTurn[];
        try { turns = this.host.recentTurns() ?? []; } catch { return []; }
        const cutoff = candidate.segments[0]?.timestamp ?? candidate.startedAt;
        return turns.filter(t => !(t.role === 'interviewer' && t.timestamp >= cutoff));
    }

    private skip(reason: AutoAnswerSkipReason, question?: AutoAnswerQuestion, extra: Partial<AutoAnswerTelemetryEvent> = {}): void {
        this.emit({ name: 'auto_answer_ignored', questionId: question?.id, skipReason: reason, dialogueAct: question?.dialogueAct, answerability: question?.answerability, ...extra });
        this.host.log?.(`[AutoAnswer] skipped: ${reason}${question ? ` (${question.id})` : ''}`);
    }

    private emit(partial: Omit<AutoAnswerTelemetryEvent, 'meetingGeneration'>): void {
        try {
            this.host.telemetry?.({ meetingGeneration: this.host.meetingGeneration(), state: this.state, ...partial });
        } catch { /* telemetry must never break the pipeline */ }
    }

    private setState(next: AutoAnswerState): void {
        this.state = next;
    }

    private clearHold(): void {
        if (this.holdTimer !== null) { this.clock.clearTimeout(this.holdTimer); this.holdTimer = null; }
    }

    private startRetry(): void {
        this.stopRetry();
        this.retryTimer = this.clock.setTimeout(() => {
            this.retryTimer = null;
            this.tryDequeue();
            if (this.queue.depth() > 0) this.startRetry();
        }, QUEUE_RETRY_MS);
    }

    private stopRetry(): void {
        if (this.retryTimer !== null) { this.clock.clearTimeout(this.retryTimer); this.retryTimer = null; }
    }

    private resetAll(): void {
        this.turns.reset();
        this.clearHold();
        this.stopRetry();
        this.queue.clear();
        this.dedup.clear();
        this.channels.reset();
        this.current = null;
        this.currentStartedAt = null;
        this.pendingId = null;
        this.pendingIdStartedAt = null;
        this.lastDispatchedText = null;
        this.automaticAnswerInFlight = false;
        this.questionSequence = 0;
        this.evaluation++;
    }
}

function wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}
