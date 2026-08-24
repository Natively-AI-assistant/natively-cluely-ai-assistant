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
import {
    JUDGE_DEADLINE_MS, JUDGE_CONTEXT_TURNS, shouldConsultJudge, parseJudgeVerdict, routeForVerdict,
    type JudgeRequest,
} from './AutoAnswerJudge';
import { AutoAnswerDedup, REUSE_THRESHOLD, type Embedder } from './AutoAnswerDedup';
import { speculativeQuestionSimilarity } from '../../llm/speculativeSimilarity';
import { AutoAnswerQueue, MAX_QUEUE_DEPTH } from './AutoAnswerQueue';
import { evaluateAutoAnswerPolicy, DEFAULT_THRESHOLDS, type AutoAnswerThresholds } from './AutoAnswerPolicy';
import { AutoAnswerChannelGate, type AutoAnswerChannelTuning } from './AutoAnswerChannelGate';
import type {
    AutoAnswerCandidate, AutoAnswerPace, AutoAnswerQuestion, AutoAnswerSkipReason, AutoAnswerState,
    AutoAnswerTelemetryEvent, TranscriptEndpointEvent,
    AutoAnswerDecision,
} from './AutoAnswerTypes';
import type { AsyncTurnPredictor, TurnPredictor } from './AutoAnswerTurnPredictor';

/** Retry cadence while a question waits for the engine (cooldown has no event). Unfitted placeholder. */
export const QUEUE_RETRY_MS = 500;

// ── Mic echo detection (live-run 2026-08-24, session 3). Unfitted placeholders. ──
/** A user final matching an interviewer final this recent is the speakers echoing into the mic. */
export const ECHO_WINDOW_MS = 5000;
/** Token similarity at or above which a user final is that echo. */
export const ECHO_SIMILARITY = 0.8;
/** Echo mode engages when at least this many of the last ECHO_FLAG_WINDOW user finals were echoes. */
export const ECHO_ACTIVATE_COUNT = 2;
export const ECHO_FLAG_WINDOW = 4;
/**
 * Post-commit rhetorical hold (V3 Amendment 3): measured from the
 * interviewer's end of speech, cancelled if they resume ("Why do we do it
 * that way? Well, because…"). A quiet-window commit has usually waited this
 * long already; an instant provider/predictor commit pays it. Unfitted placeholder.
 */
export const RHETORICAL_HOLD_MS = 600;
/** An offer card auto-expires after this (V3 Amendment 4: "~10 s or on topic change"). Unfitted placeholder. */
export const OFFER_TTL_MS = 10_000;

export type OfferRetractReason = 'expired' | 'replaced' | 'committed' | 'topic_change' | 'meeting_stop' | 'user_answering';

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
    /**
     * Start the automatic answer. The returned promise (if any) must settle
     * when the engine has fully decided the trigger — after the stream when
     * one ran, quickly when the planner stayed silent. The controller clears
     * its in-flight state on settle when `answerStreamActive()` is false,
     * because a silent planner decision never changes the engine mode and no
     * `mode_changed → idle` ever fires (review#1, 2026-08-24).
     */
    dispatch(question: AutoAnswerQuestion, options: { reuseSpeculative: boolean }): void | Promise<unknown>;
    /** A What-to-Answer stream is live right now (engine mode === 'what_to_say'). */
    answerStreamActive?(): boolean;
    /** Render the ONE offer card (replaces any previous one). Absent host → offers are telemetry only. */
    offer?(question: AutoAnswerQuestion): void;
    /** Remove the offer card (expired / replaced / committed / topic change / meeting stop). */
    retractOffer?(questionId: string, reason: OfferRetractReason): void;
    cancelAutomaticAnswer(reason: 'user_barge_in'): boolean;
    /**
     * The DYNAMIC judge (2026-08-24, user override of spec V2 §36): a small
     * fast LLM judges the committed candidate — "complete ask, directed at the
     * user, worth answering now?". Returns the model's RAW reply; parsing and
     * validation live in AutoAnswerJudge. Absent hook, rejection, null, or the
     * deadline → the heuristic detector's verdict stands, byte-identical to
     * the pre-judge pipeline.
     */
    judgeCandidate?(req: JudgeRequest): Promise<string | null>;
    /** Current mode's display name — judge-prompt context only. */
    modeName?(): string | null;
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
    /**
     * Tier-2 endpoint evidence (V3 Amendment 2/3). Optional: absent → the
     * provider endpoint + quiet window decide, exactly as before.
     */
    turnPredictor?: TurnPredictor | AsyncTurnPredictor | null;
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
    /** A post-commit rhetorical hold is running for `current` (distinct from channel holds for telemetry). */
    private rhetoricalHold = false;
    private retryTimer: ClockTimer | null = null;
    private readonly predictor: TurnPredictor | AsyncTurnPredictor | null;
    /** The single live offer card, if any (V3 Amendment 4: one card, replaced in place). */
    private activeOffer: { question: AutoAnswerQuestion; timer: ClockTimer } | null = null;
    private unsubscribePredictor: (() => void) | null = null;
    /** Epoch ms the interviewer last started speaking (for the predictor's speechDurationMs). */
    private interviewerSpeechStartedAt: number | null = null;
    private lastDispatchedText: string | null = null;
    private automaticAnswerInFlight = false;
    /** Monotonic token so an awaited dedup/dispatch can tell it was superseded. */
    private evaluation = 0;
    /** Monotonic token so an awaited judge verdict can tell it was superseded. */
    private judgeSeq = 0;
    /** speech_edge events received this meeting; zero at commit time = the dual-channel gate is inert. */
    private edgesSeen = 0;
    private noEdgesWarned = false;
    /**
     * Mic echo (speakers without headphones): the user channel transcribes the
     * SAME words as the interviewer channel ms later, and its VAD "speaks"
     * whenever the video does. While active, user-channel signals are
     * untrusted — they are the interviewer (live-run 2026-08-24, session 3).
     */
    private recentInterviewerFinals: Array<{ text: string; at: number }> = [];
    private recentUserEchoFlags: boolean[] = [];
    private micEchoActive = false;
    private micEchoWarned = false;

    constructor(private readonly host: AutoAnswerControllerHost, options: AutoAnswerControllerOptions = {}) {
        this.clock = options.clock ?? systemClock;
        this.dedup = new AutoAnswerDedup(options.embed ?? null);
        this.channels = new AutoAnswerChannelGate(options.channelTuning);
        this.thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
        this.predictor = options.turnPredictor ?? null;
        if (this.predictor && isAsyncPredictor(this.predictor)) {
            this.unsubscribePredictor = this.predictor.subscribe((prediction) => {
                if (!this.host.isEnabled()) return;
                this.turns.onLocalPrediction(prediction.pEndpoint);
            });
        }
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
    getThresholds(): AutoAnswerThresholds { return this.thresholds; }
    /** The user pressed the What-to-Answer hotkey / clicked: whatever was offered is committed by them. */
    onManualAnswerStarted(): void { this.retractOffer('committed'); }
    /** Test/diagnostic visibility. */
    getActiveOffer(): AutoAnswerQuestion | null { return this.activeOffer?.question ?? null; }
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
        const text = (segment.text ?? '').trim();
        if (segment.speaker === 'interviewer' && text) {
            this.cancelRhetoricalHold();
            if (segment.final) {
                this.recentInterviewerFinals.push({ text, at: this.clock.now() });
                while (this.recentInterviewerFinals.length > 8) this.recentInterviewerFinals.shift();
            }
        } else if (segment.speaker !== 'interviewer' && segment.final && text) {
            // Echo check: a user final that mirrors a recent interviewer final
            // is the speakers bleeding into the mic, not the user answering.
            const now = this.clock.now();
            const isEcho = this.recentInterviewerFinals.some(f =>
                now - f.at <= ECHO_WINDOW_MS && speculativeQuestionSimilarity(f.text, text) >= ECHO_SIMILARITY);
            this.recentUserEchoFlags.push(isEcho);
            while (this.recentUserEchoFlags.length > ECHO_FLAG_WINDOW) this.recentUserEchoFlags.shift();
            const echoes = this.recentUserEchoFlags.filter(Boolean).length;
            const wasActive = this.micEchoActive;
            this.micEchoActive = echoes >= ECHO_ACTIVATE_COUNT;
            if (this.micEchoActive && !wasActive) {
                this.channels.clearUserSpeech();
                if (!this.micEchoWarned) {
                    this.micEchoWarned = true;
                    this.host.log?.('[AutoAnswer] mic echo detected — the user channel mirrors the interviewer (speakers without headphones?). User-channel gating suspended until genuine user speech.');
                }
            }
            if (!this.micEchoActive && wasActive) this.host.log?.('[AutoAnswer] mic echo cleared — user-channel gating restored.');
            if (isEcho) {
                // The echo is the INTERVIEWER's audio: it must neither close the
                // accumulation nor count as the user taking the floor.
                this.emit({ name: 'auto_answer_ignored', skipReason: 'not_interviewer' });
                return;
            }
        }
        this.turns.ingest(segment, this.host.meetingGeneration());
    }

    onSpeechEdge(edge: SpeechEdge): void {
        if (!this.host.isEnabled()) return;
        this.edgesSeen++;
        // In echo mode the mic's edges ARE the interviewer's audio: ignore them
        // for gating and barge-in. Genuine user speech re-enables the channel
        // through the transcript-level echo check (different words → not echo).
        if (edge.channel === 'user' && this.micEchoActive) return;
        const significance = this.channels.noteEdge(edge);
        if (edge.channel === 'interviewer') {
            if (edge.speaking) {
                this.interviewerSpeechStartedAt = edge.atMs;
                if (this.predictor && isAsyncPredictor(this.predictor)) this.predictor.onInterviewerSpeechStart(edge.atMs);
                this.turns.onSpeechStarted('interviewer', edge.atMs);
                this.cancelRhetoricalHold();
            } else {
                this.turns.onSpeechEnded('interviewer', edge.atMs);
                this.consultPredictor(edge.atMs);
            }
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
        // The user is answering: whatever is held, queued or offered is theirs now.
        if (this.activeOffer) this.retractOffer('user_answering');
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
        // The interviewer moved on: a standing offer for an OLDER question is stale.
        if (this.activeOffer && this.activeOffer.question.id !== id) this.retractOffer('topic_change');

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
        // A meeting that has produced transcripts but not a single speech_edge
        // means the native bridge is not delivering them (stale .node binary
        // that ignores the third start() callback?). The dual-channel gate is
        // then INERT — no user-silence hold, no barge-in — and without this
        // line the degradation is indistinguishable from the gated path (review#8).
        if (this.edgesSeen === 0 && !this.noEdgesWarned) {
            this.noEdgesWarned = true;
            this.host.log?.('[AutoAnswer] no speech_edge events received this meeting — dual-channel gating (user-silence, overlap veto, barge-in) is INACTIVE. Rebuild the native module (npm run build:native)?');
        }
        this.emit({
            name: 'auto_answer_candidate', questionId: id, provider: candidate.sttProvider, channelEdgesSeen: this.edgesSeen > 0,
            dialogueAct: question.dialogueAct, questionConfidence: question.confidence,
            completionConfidence: question.completionConfidence, answerability: question.answerability,
            endpointSource: question.endpointSource, candidateWordCount: wordCount(candidate.text),
            msFromLastSpeechToDecision: now - candidate.lastUpdatedAt,
        });

        this.current = { question, candidate, committedAt: now };
        this.currentStartedAt = candidate.startedAt;

        // The dynamic judge sits between the heuristic detector and routing.
        // Incomplete fragments never go (a judge cannot finish half a
        // sentence — the revision window handles them), trivial backchannels
        // never go (cost); everything else — including heuristic "statements",
        // which is where live tasks hid — is judged, with the heuristic
        // decision as the deadline/error fallback.
        if (this.host.judgeCandidate && decision.reason !== 'incomplete'
            && shouldConsultJudge(question.dialogueAct, candidate.text)) {
            this.consultJudge(id, candidate, question, decision);
            return;
        }
        this.routeHeuristic(id, candidate, question, decision);
    }

    /** The pre-judge routing, byte-identical to the pipeline before the judge existed. */
    private routeHeuristic(id: string, candidate: AutoAnswerCandidate, question: AutoAnswerQuestion, decision: AutoAnswerDecision): void {
        if (decision.action === 'wait' && decision.reason === 'incomplete') {
            this.holdIncomplete(id);
            return;
        }
        if (decision.action === 'ignore') {
            this.ignoreCandidate(candidate, question, decision.reason as AutoAnswerSkipReason);
            return;
        }
        this.setState('question_complete');
        this.evaluate(++this.evaluation);
    }

    /** Not finished: the turn manager's revision window will extend it. */
    private holdIncomplete(id: string): void {
        this.turns.holdOpen();
        this.setState('possible_question');
        this.emit({ name: 'auto_answer_decision', questionId: id, action: 'wait', skipReason: 'incomplete' });
    }

    private ignoreCandidate(candidate: AutoAnswerCandidate, question: AutoAnswerQuestion, reason: AutoAnswerSkipReason): void {
        // An ignored statement that ended as a SENTENCE is closed; the next
        // final is a new candidate. Without terminal punctuation the
        // "statement" may be half a sentence the provider split — leave it
        // revisable so a fast lowercase continuation merges instead of
        // becoming a fragment question ("have 6 tries, where you" fired as
        // a 0.9 general_question on live meeting fd28a1af, 2026-08-24).
        if (/[.?!]\s*$/.test(candidate.text)) this.turns.markDispatched();
        this.skip(reason, question);
        this.setState('listening');
    }

    /**
     * Ask the judge, race the deadline on the injected clock, then route. A
     * newer commit/revision, a meeting stop, or a generation change while
     * awaiting makes the verdict STALE — dropped, never applied (the newer
     * commit runs its own judge).
     */
    private consultJudge(id: string, candidate: AutoAnswerCandidate, question: AutoAnswerQuestion, decision: AutoAnswerDecision): void {
        const seq = ++this.judgeSeq;
        const startedAt = this.clock.now();
        const generation = question.meetingGeneration;
        this.setState('possible_question');
        let timer: ClockTimer | null = null;
        let timedOut = false;
        void (async () => {
            let raw: string | null = null;
            let outcome: 'verdict' | 'timeout' | 'error' | 'unparseable' = 'verdict';
            try {
                raw = await Promise.race([
                    this.host.judgeCandidate!({
                        candidateText: candidate.text,
                        recentTurns: this.turnsBefore(candidate).slice(-JUDGE_CONTEXT_TURNS),
                        modeName: this.host.modeName?.() ?? null,
                        questionId: id,
                    }),
                    new Promise<null>((resolve) => {
                        timer = this.clock.setTimeout(() => { timedOut = true; resolve(null); }, JUDGE_DEADLINE_MS);
                    }),
                ]);
                if (timedOut) outcome = 'timeout';
            } catch {
                outcome = 'error';
            } finally {
                if (timer !== null) this.clock.clearTimeout(timer);
            }
            const judgeMs = this.clock.now() - startedAt;
            // Staleness: only the LATEST consult may route, and only while the
            // world it judged still exists.
            if (seq !== this.judgeSeq || !this.host.isMeetingActive()
                || this.host.meetingGeneration() !== generation
                || this.current?.question.id !== id) {
                this.emit({ name: 'auto_answer_judged', questionId: id, judgeOutcome: 'stale', judgeMs });
                return;
            }
            const verdict = outcome === 'verdict' ? parseJudgeVerdict(raw, candidate.text) : null;
            if (!verdict) {
                if (outcome === 'verdict') outcome = 'unparseable';
                this.emit({ name: 'auto_answer_judged', questionId: id, judgeOutcome: outcome, judgeMs });
                this.host.log?.(`[AutoAnswer] judge ${outcome} after ${judgeMs}ms — heuristic verdict stands`);
                this.routeHeuristic(id, candidate, question, decision);
                return;
            }
            this.emit({
                name: 'auto_answer_judged', questionId: id, judgeOutcome: 'verdict', judgeMs,
                judgeIsAsk: verdict.isAsk, judgeDirectedAtUser: verdict.directedAtUser,
                dialogueAct: verdict.act, answerability: verdict.answerability,
            });
            const route = routeForVerdict(verdict);
            if (route.route === 'wait_incomplete') {
                this.holdIncomplete(id);
                return;
            }
            if (route.route === 'ignore') {
                this.ignoreCandidate(candidate, question, route.reason);
                return;
            }
            // The judge is trusted in BOTH directions: it promotes heuristic
            // statements into asks and vetoes pattern-matched "questions".
            question.answerability = route.answerability;
            question.dialogueAct = route.act;
            if (route.questionText) question.text = route.questionText;
            this.setState('question_complete');
            this.evaluate(++this.evaluation);
        })();
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
                this.showOffer(question);
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

    /** The dual-channel gate, then the rhetorical hold: dispatch now, hold, or drop. */
    private gateAndDispatch(committed: Committed): void {
        const now = this.clock.now();
        const verdict = this.channels.verdict(now);
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
        // Post-commit rhetorical hold (V3 Amendment 3), measured from the last
        // evidence of interviewer activity — the later of the VAD end and the
        // last transcript update — so a quiet-window commit (already ≥ 1100 ms
        // past that) pays nothing and only an instant endpoint commit waits.
        const endedAt = Math.max(this.channels.getLastInterviewerEndedAt() ?? 0, committed.candidate.lastUpdatedAt);
        const rhetoricalRemaining = RHETORICAL_HOLD_MS - (now - endedAt);
        if (rhetoricalRemaining > 0) {
            this.clearHold();
            this.rhetoricalHold = true;
            this.holdTimer = this.clock.setTimeout(() => {
                this.holdTimer = null;
                this.rhetoricalHold = false;
                if (this.current !== committed) return;
                this.decide(committed, false);
            }, rhetoricalRemaining);
            return;
        }
        this.dispatch(committed);
    }

    /** The interviewer resumed inside the rhetorical hold: the question was not for us (yet). */
    private cancelRhetoricalHold(): void {
        if (!this.rhetoricalHold || this.holdTimer === null) return;
        this.clearHold();
        this.rhetoricalHold = false;
        const q = this.current?.question;
        this.skip('rhetorical', q);
        // The commit stays undispatched, so a continuation revises it in place
        // and a self-answer ("…? Because hot keys.") is re-judged as rhetorical.
        this.turns.holdOpen();
        this.setState('possible_question');
    }

    /** Ask the local TurnPredictor about this silence (Tier 2). Audio predictors answer via subscribe(). */
    private consultPredictor(atMs: number): void {
        if (!this.predictor) return;
        try {
            if (isAsyncPredictor(this.predictor)) this.predictor.onInterviewerSpeechStop(atMs);
            const candidate = this.turns.getCandidate();
            const prediction = this.predictor.predict({
                partialTranscript: candidate?.text ?? '',
                recentTranscript: this.turnsBefore(candidate ?? { text: '', segments: [], startedAt: atMs, lastUpdatedAt: atMs, generation: 0, endpointSource: 'vad' }),
                speechDurationMs: this.interviewerSpeechStartedAt !== null ? Math.max(0, atMs - this.interviewerSpeechStartedAt) : 0,
                silenceMs: 0,
            });
            if (prediction) this.turns.onLocalPrediction(prediction.pEndpoint);
        } catch { /* the predictor must never break the deterministic path (V2 §38) */ }
    }

    private dispatch(committed: Committed): void {
        const { question } = committed;
        const now = this.clock.now();
        // Generation guards (V2 §46): meeting, question identity, candidate generation.
        if (question.meetingGeneration !== this.host.meetingGeneration()) { this.skip('stale_generation', question); return; }
        if (this.current !== committed) { this.skip('stale_generation', question); return; }
        if (!this.host.isMeetingActive()) { this.skip('meeting_inactive', question); return; }

        question.committedAt = now;
        if (this.activeOffer) this.retractOffer('committed');
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
            const result = this.host.dispatch(question, { reuseSpeculative });
            // The engine can conclude the trigger WITHOUT ever streaming (the
            // planner returns 'silent' inside its cooldown, or the engine's own
            // throttle drops it). No mode change fires then, so the settle of
            // the dispatch promise is the only signal — without this the
            // in-flight latch sticks for the rest of the meeting (review#1).
            void Promise.resolve(result)
                .catch((err) => { this.host.log?.(`[AutoAnswer] dispatch rejected: ${(err as Error)?.message ?? err}`); })
                .then(() => this.onDispatchSettled(question));
        } catch (err) {
            this.host.log?.(`[AutoAnswer] dispatch failed: ${(err as Error)?.message ?? err}`);
            this.automaticAnswerInFlight = false;
            this.setState('listening');
        }
    }

    /** The engine finished deciding/answering `question` (or a speculative stream is still carrying it). */
    private onDispatchSettled(question: AutoAnswerQuestion): void {
        if (!this.automaticAnswerInFlight) return;                 // idle event already handled it
        if (this.current?.question.id !== question.id) return;      // a newer dispatch owns the flag
        // A live stream (accepted speculative run) keeps carrying the answer;
        // its completion arrives as mode_changed → idle.
        try { if (this.host.answerStreamActive?.()) return; } catch { /* treat as not streaming */ }
        this.automaticAnswerInFlight = false;
        this.emit({ name: 'auto_answer_completed', questionId: question.id });
        if (this.state === 'answering') this.setState(this.queue.depth() ? 'queued' : 'listening');
        this.tryDequeue();
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
        this.rhetoricalHold = false;
    }

    private showOffer(question: AutoAnswerQuestion): void {
        if (this.activeOffer) this.retractOffer('replaced');
        const timer = this.clock.setTimeout(() => {
            if (this.activeOffer?.question.id === question.id) this.retractOffer('expired');
        }, OFFER_TTL_MS);
        this.activeOffer = { question, timer };
        this.emit({ name: 'auto_answer_offered', questionId: question.id, answerability: question.answerability, dialogueAct: question.dialogueAct });
        try { this.host.offer?.(question); } catch (err) { this.host.log?.(`[AutoAnswer] offer failed: ${(err as Error)?.message ?? err}`); }
    }

    private retractOffer(reason: OfferRetractReason): void {
        const offer = this.activeOffer;
        if (!offer) return;
        this.activeOffer = null;
        this.clock.clearTimeout(offer.timer);
        this.emit({ name: 'auto_answer_cancelled', questionId: offer.question.id, action: 'offer', skipReason: reason === 'user_answering' ? 'user_answering' : undefined });
        try { this.host.retractOffer?.(offer.question.id, reason); } catch { /* never break the pipeline */ }
    }

    /** Release the predictor subscription (tests / teardown). */
    dispose(): void {
        this.unsubscribePredictor?.();
        this.unsubscribePredictor = null;
        this.resetAll();
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
        if (this.activeOffer) this.retractOffer('meeting_stop');
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
        this.edgesSeen = 0;
        this.noEdgesWarned = false;
        this.recentInterviewerFinals = [];
        this.recentUserEchoFlags = [];
        this.micEchoActive = false;
        this.micEchoWarned = false;
        this.questionSequence = 0;
        this.evaluation++;
        this.judgeSeq++;
    }
}

function isAsyncPredictor(p: TurnPredictor | AsyncTurnPredictor): p is AsyncTurnPredictor {
    return typeof (p as AsyncTurnPredictor).subscribe === 'function';
}

function wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}
