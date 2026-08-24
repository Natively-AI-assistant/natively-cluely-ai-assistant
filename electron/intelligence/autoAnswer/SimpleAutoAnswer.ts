/**
 * SIMPLE Auto Answer engine (user decision 2026-08-25) — "legacy trigger,
 * judge brain".
 *
 * Six live rounds showed the V3 candidate machinery (quiet windows, revision
 * re-judging, act heuristics, channel state machine) eating real questions
 * before the judge — which was never wrong — could rule. This engine is the
 * requested middle ground:
 *
 *   interviewer speech STOPS (stability window, endpoint-shortened)
 *     → cheap local prefilter (dup / backchannel / too short — zero cost)
 *       → ONE judge call ("autoanswer yes/no" + the extracted question)
 *         → dispatch | offer | silent.
 *
 * Cost/latency discipline:
 *  - one call per STOPPAGE, never per final (V3 judged one utterance 6×);
 *  - interims and finals both restart the stability window, so the call fires
 *    only when the interviewer has actually stopped — and the window overlaps
 *    the LLM latency the user must wait through anyway;
 *  - a call is superseded (never applied) when new interviewer speech arrives
 *    while it is in flight — the next stoppage re-judges with more context;
 *  - the judge prompt's static prefix enables implicit provider caching.
 *
 * Mic policy is LENIENT (2026-08-24 decision): only a genuine sustained
 * answer in the user's own words suppresses; echoes, fragments and
 * backchannels are ignored. Judge unavailable → almost-legacy fallback:
 * dispatch only when the stopped speech ends with '?'.
 */

import type { TranscriptSegment } from '../../SessionTracker';
import type { TranscriptTurn } from '../../llm/transcriptCleaner';
import type { Clock, ClockTimer } from './AutoAnswerClock';
import { systemClock } from './AutoAnswerClock';
import {
    JUDGE_DEADLINE_MS, JUDGE_CONTEXT_TURNS, parseJudgeVerdict, routeForVerdict, type JudgeRequest,
} from './AutoAnswerJudge';
import { normalizeForCompare, tokenContainment } from './AutoAnswerDetector';
import { speculativeQuestionSimilarity } from '../../llm/speculativeSimilarity';
import type { AutoAnswerThresholds } from './AutoAnswerPolicy';
import { DEFAULT_THRESHOLDS } from './AutoAnswerPolicy';
import {
    ECHO_WINDOW_MS, ECHO_SIMILARITY, ECHO_FRAGMENT_CONTAINMENT, ECHO_FRAGMENT_MIN_WORDS,
    USER_BACKCHANNEL, GENUINE_ANSWER_MIN_WORDS,
} from './AutoAnswerController';
import type { AutoAnswerQuestion, AutoAnswerTelemetryEvent } from './AutoAnswerTypes';

/** The interviewer must be quiet this long before the judge is consulted. Unfitted placeholder. */
export const STABILITY_MS = 900;
/** A provider endpoint (speech_final / <end>) confirms the stop: shorten the wait. */
export const ENDPOINT_CONFIRM_MS = 350;
/** Below this many NEW words (and no '?') we wait for more speech instead of calling. */
export const MIN_NEW_WORDS = 4;
/** Offer card lifetime (mirrors V3's OFFER_TTL_MS). Unfitted placeholder. */
export const OFFER_TTL_MS = 10_000;
/** Judge-unavailable fallback on punctuation-less providers: interrogative-led utterances. */
export const FALLBACK_INTERROGATIVE = /^(?:(?:ok(?:ay)?|so|and|now|alright|well)[,.!\s]+)*(?:how|what|why|when|where|which|who|whose|can|could|would|should|do|does|did|are|is|will|have you|tell me|tell us|walk me|walk us|explain|describe)\b/i;
/** Busy-engine retry cadence and give-up. */
export const RETRY_MS = 500;
export const RETRY_TTL_MS = 8000;
/**
 * Pending interviewer finals older than this no longer belong to the current
 * thought. Raised 30s -> 90s on 2026-08-25: a coding-interview problem
 * statement runs 45-60 s ("design a class that supports these three
 * operations…"), and a 30 s cap silently dropped its opening, so the answer
 * was drafted against two thirds of the spec. Unfitted placeholder.
 */
export const PENDING_MAX_AGE_MS = 90_000;

export interface SimpleAutoAnswerHost {
    isEnabled(): boolean;
    isMeetingActive(): boolean;
    meetingGeneration(): number;
    engineAccepting(): boolean;
    answerStreamActive?(): boolean;
    /** Hot window for judge context (finalized turns, both speakers). */
    recentTurns(): TranscriptTurn[];
    dispatch(question: AutoAnswerQuestion, options: { reuseSpeculative: boolean }): void | Promise<unknown>;
    offer?(question: AutoAnswerQuestion): void;
    retractOffer?(questionId: string, reason: string): void;
    cancelAutomaticAnswer?(reason: 'user_barge_in'): boolean;
    /** The judge call (same hook as V3): raw model reply, parsed here. */
    judgeCandidate?(req: JudgeRequest): Promise<string | null>;
    modeName?(): string | null;
    telemetry?(event: AutoAnswerTelemetryEvent): void;
    log?(line: string): void;
}

export class SimpleAutoAnswerEngine {
    private pending: Array<{ text: string; at: number }> = [];
    private recentInterviewerFinals: Array<{ text: string; at: number }> = [];
    private timer: ClockTimer | null = null;
    private retryTimer: ClockTimer | null = null;
    private judgeSeq = 0;
    private sequence = 0;
    private lastJudgedKey = '';
    private lastAnsweredText: string | null = null;
    /** Punctuation provenance of the latest interviewer final ('provider' family = a missing '?' means something). */
    private punctuationGuaranteed = false;
    private activeOffer: { id: string; timer: ClockTimer } | null = null;
    private thresholds: AutoAnswerThresholds;

    constructor(
        private readonly host: SimpleAutoAnswerHost,
        private readonly clock: Clock = systemClock,
        thresholds: AutoAnswerThresholds = DEFAULT_THRESHOLDS,
    ) {
        this.thresholds = thresholds;
    }

    setThresholds(t: AutoAnswerThresholds): void { this.thresholds = t; }

    onMeetingStart(): void { this.reset(); }
    onMeetingStop(): void { this.reset(); }
    onEngineIdle(): void { /* the retry timer already polls engineAccepting */ }

    /** Provider says the interviewer's turn ended: confirm the stop sooner. */
    onProviderEndpoint(): void {
        if (!this.host.isEnabled() || this.pending.length === 0) return;
        this.arm(ENDPOINT_CONFIRM_MS);
    }

    ingest(segment: TranscriptSegment & { speaker: string; final: boolean }): void {
        if (!this.host.isEnabled() || !this.host.isMeetingActive()) return;
        const text = (segment.text ?? '').trim();
        const now = this.clock.now();

        if (segment.speaker === 'interviewer') {
            if (!segment.final) {
                // Still talking: every interim pushes the stoppage out — and
                // supersedes any in-flight verdict (review 2026-08-25: a
                // verdict resolving after the interviewer RESUMED must not
                // dispatch mid-sentence; the next stoppage re-judges).
                if (this.pending.length > 0 || text) {
                    if (text) this.judgeSeq++;
                    this.arm(STABILITY_MS);
                }
                return;
            }
            if (!text) return;
            this.recentInterviewerFinals.push({ text, at: now });
            while (this.recentInterviewerFinals.length > 8) this.recentInterviewerFinals.shift();
            this.punctuationGuaranteed = (segment as { punctuationSource?: string }).punctuationSource === 'provider' ||
                (segment as { punctuationSource?: string }).punctuationSource === 'provider_final';
            this.pending.push({ text, at: now });
            this.judgeSeq++;            // supersede any in-flight verdict: it judged less than this
            this.arm(STABILITY_MS);
            return;
        }

        // ── user channel: LENIENT (2026-08-24) ────────────────────────────
        if (!text) return;
        const recent = this.recentInterviewerFinals.filter(f => now - f.at <= ECHO_WINDOW_MS);
        const words = text.split(/\s+/).filter(Boolean).length;
        const isEcho = recent.some(f => speculativeQuestionSimilarity(f.text, text) >= ECHO_SIMILARITY)
            || (words >= ECHO_FRAGMENT_MIN_WORDS && recent.length > 0
                && tokenContainment(text, recent.map(f => f.text).join(' ')) >= ECHO_FRAGMENT_CONTAINMENT);
        const genuine = !isEcho && !USER_BACKCHANNEL.test(text) && words >= GENUINE_ANSWER_MIN_WORDS;
        if (!segment.final) {
            // Early barge-in (review 2026-08-25): V3 cancelled at the VAD
            // edge; here a genuine-looking user INTERIM cancels the streaming
            // answer seconds before its final would — still text-validated,
            // so speaker bleed cannot trigger it.
            if (genuine && this.host.answerStreamActive?.()) this.host.cancelAutomaticAnswer?.('user_barge_in');
            return;
        }
        if (!genuine) {
            this.emit({ name: 'auto_answer_ignored', skipReason: 'backchannel' });
            return;
        }
        // A genuine sustained answer: the user took the floor. This must also
        // kill anything in flight — the judge verdict being awaited AND a
        // dispatch parked behind a busy engine both belong to a question the
        // user is now answering themselves (review 2026-08-25).
        if (this.host.answerStreamActive?.()) this.host.cancelAutomaticAnswer?.('user_barge_in');
        this.judgeSeq++;
        this.clearRetry();
        this.retractOffer('user_answering');
        if (this.pending.length > 0 || this.timer !== null) {
            this.disarm();
            this.pending = [];
            this.lastJudgedKey = '';
            this.emit({ name: 'auto_answer_ignored', skipReason: 'user_answering' });
        }
    }

    // ── the stoppage ──────────────────────────────────────────────────────

    private arm(ms: number): void {
        this.disarm();
        this.timer = this.clock.setTimeout(() => { this.timer = null; this.onStoppage(); }, ms);
    }

    private disarm(): void {
        if (this.timer !== null) { this.clock.clearTimeout(this.timer); this.timer = null; }
    }

    private onStoppage(): void {
        if (!this.host.isEnabled() || !this.host.isMeetingActive()) return;
        const now = this.clock.now();
        this.pending = this.pending.filter(p => now - p.at <= PENDING_MAX_AGE_MS);
        if (this.pending.length === 0) return;
        const candidate = this.pending.map(p => p.text).join(' ').replace(/\s+/g, ' ').trim();
        const key = normalizeForCompare(candidate);

        // Zero-cost prefilter — the ONLY heuristics left in the hot path.
        if (key === this.lastJudgedKey) return;                     // verdict already stands
        const words = candidate.split(/\s+/).filter(Boolean).length;
        // A short candidate waits for more speech unless it already looks
        // like a question: a literal '?' (always positive evidence) or an
        // interrogative lead (which needs no punctuation, per the
        // punctuationProvenance absence-is-NEUTRAL contract).
        const tooShort = words < MIN_NEW_WORDS && !candidate.includes('?') && !FALLBACK_INTERROGATIVE.test(candidate);
        if (tooShort) {
            this.emit({ name: 'auto_answer_ignored', skipReason: 'incomplete', candidateWordCount: words });
            return;
        }
        if (USER_BACKCHANNEL.test(candidate)) {
            this.emit({ name: 'auto_answer_ignored', skipReason: 'backchannel', candidateWordCount: words });
            return;
        }
        if (this.lastAnsweredText && normalizeForCompare(this.lastAnsweredText) === key) {
            this.emit({ name: 'auto_answer_ignored', skipReason: 'duplicate' });
            return;
        }

        const id = `${this.host.meetingGeneration()}-q${++this.sequence}`;
        this.emit({
            name: 'auto_answer_candidate', questionId: id,
            candidateWordCount: words, endpointSource: 'quiet_window',
        });
        this.lastJudgedKey = key;
        void this.consult(id, candidate, now);
    }

    private async consult(id: string, candidate: string, committedAt: number): Promise<void> {
        const seq = this.judgeSeq;
        const generation = this.host.meetingGeneration();
        let timer: ClockTimer | null = null;
        let timedOut = false;
        let raw: string | null = null;
        let outcome: 'verdict' | 'timeout' | 'error' | 'unparseable' | 'absent' = 'verdict';
        if (!this.host.judgeCandidate) {
            outcome = 'absent';
        } else {
            try {
                raw = await Promise.race([
                    this.host.judgeCandidate({
                        candidateText: candidate,
                        recentTurns: this.turnsBefore(committedAt),
                        modeName: this.host.modeName?.() ?? null,
                        questionId: id,
                        lastAnsweredText: this.lastAnsweredText,
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
        }
        const judgeMs = this.clock.now() - committedAt;
        // Superseded: more interviewer speech arrived, the meeting moved on.
        if (seq !== this.judgeSeq || !this.host.isMeetingActive() || this.host.meetingGeneration() !== generation) {
            this.emit({ name: 'auto_answer_judged', questionId: id, judgeOutcome: 'stale', judgeMs });
            return;
        }
        const verdict = outcome === 'verdict' ? parseJudgeVerdict(raw, candidate) : null;
        if (!verdict) {
            if (outcome === 'verdict') outcome = 'unparseable';
            if (outcome !== 'absent') this.emit({ name: 'auto_answer_judged', questionId: id, judgeOutcome: outcome as 'timeout' | 'error' | 'unparseable', judgeMs });
            // A transient judge failure must not silence the question forever
            // (review 2026-08-25): clear the key so the next stoppage retries.
            this.lastJudgedKey = '';
            // Near-legacy fallback: a trailing '?', or — on providers that
            // never guarantee punctuation — an interrogative-led utterance.
            const interrogative = FALLBACK_INTERROGATIVE.test(candidate);
            if (/\?\s*$/.test(candidate) || (!this.punctuationGuaranteed && interrogative)) {
                this.host.log?.(`[AutoAnswer:simple] judge ${outcome} — fallback dispatch`);
                this.deliver(id, candidate, 0.9, 'general_question', committedAt);
            }
            return;
        }
        this.emit({
            name: 'auto_answer_judged', questionId: id, judgeOutcome: 'verdict', judgeMs,
            judgeIsAsk: verdict.isAsk, judgeDirectedAtUser: verdict.directedAtUser,
            dialogueAct: verdict.act, answerability: verdict.answerability,
        });
        const route = routeForVerdict(verdict);
        if (route.route !== 'evaluate') {
            const reason = route.route === 'wait_incomplete' ? 'incomplete' : route.reason;
            this.emit({ name: 'auto_answer_ignored', questionId: id, skipReason: reason, dialogueAct: verdict.act, answerability: verdict.answerability });
            if (route.route === 'wait_incomplete') this.lastJudgedKey = '';   // more speech may finish it → re-judge then
            return;
        }
        const text = route.questionText ?? candidate;
        if (route.answerability >= this.thresholds.autoThreshold) {
            this.deliver(id, text, route.answerability, route.act, committedAt);
        } else if (route.answerability >= this.thresholds.offerThreshold && this.host.offer) {
            this.retractOffer('replaced');
            this.host.offer(this.question(id, text, route.answerability, route.act, committedAt));
            this.activeOffer = {
                id,
                timer: this.clock.setTimeout(() => { this.activeOffer = null; this.host.retractOffer?.(id, 'expired'); }, OFFER_TTL_MS),
            };
            this.emit({ name: 'auto_answer_offered', questionId: id, answerability: route.answerability });
        } else {
            this.emit({ name: 'auto_answer_ignored', questionId: id, skipReason: 'low_answerability', answerability: route.answerability });
        }
    }

    /** Dispatch now, or retry briefly while the engine is busy. */
    private deliver(id: string, text: string, answerability: number, act: AutoAnswerQuestion['dialogueAct'], committedAt: number): void {
        const deadline = this.clock.now() + RETRY_TTL_MS;
        const seqAtDeliver = this.judgeSeq;
        const attempt = () => {
            if (!this.host.isMeetingActive() || this.judgeSeq !== seqAtDeliver) return;
            if (!this.host.engineAccepting()) {
                if (this.clock.now() >= deadline) {
                    this.emit({ name: 'auto_answer_ignored', questionId: id, skipReason: 'engine_busy_or_cooling' });
                    return;
                }
                this.retryTimer = this.clock.setTimeout(attempt, RETRY_MS);
                return;
            }
            this.retractOffer('topic_change');
            const q = this.question(id, text, answerability, act, committedAt);
            this.lastAnsweredText = text;
            this.pending = [];
            this.lastJudgedKey = '';
            this.emit({ name: 'auto_answer_decision', questionId: id, action: 'auto', answerability });
            void this.host.dispatch(q, { reuseSpeculative: false });
        };
        attempt();
    }

    private question(id: string, text: string, answerability: number, act: AutoAnswerQuestion['dialogueAct'], committedAt: number): AutoAnswerQuestion {
        const now = this.clock.now();
        return {
            id, text,
            confidence: answerability, answerability, completionConfidence: 1,
            dialogueAct: act,
            isFollowUp: act === 'follow_up_question', followUpTarget: '',
            startedAt: this.pending[0]?.at ?? committedAt, lastUpdatedAt: now, committedAt,
            endpointSource: 'quiet_window',
            sourceSegments: this.pending.map(p => p.at),
            candidateGeneration: this.sequence,
            meetingGeneration: this.host.meetingGeneration(),
        };
    }

    private turnsBefore(cutoff: number): TranscriptTurn[] {
        // Judge context: the hot window minus the pending finals themselves.
        const pendingSet = new Set(this.pending.map(p => normalizeForCompare(p.text)));
        return this.host.recentTurns()
            .filter(t => !(t.role === 'interviewer' && pendingSet.has(normalizeForCompare(t.text))))
            .slice(-JUDGE_CONTEXT_TURNS);
    }

    private clearRetry(): void {
        if (this.retryTimer !== null) { this.clock.clearTimeout(this.retryTimer); this.retryTimer = null; }
    }

    private retractOffer(reason: 'replaced' | 'expired' | 'user_answering' | 'meeting_stop' | 'topic_change'): void {
        if (!this.activeOffer) return;
        const { id, timer } = this.activeOffer;
        this.activeOffer = null;
        this.clock.clearTimeout(timer);
        this.host.retractOffer?.(id, reason);
    }

    private reset(): void {
        this.disarm();
        this.clearRetry();
        this.retractOffer('meeting_stop');
        this.pending = [];
        this.recentInterviewerFinals = [];
        this.lastJudgedKey = '';
        this.lastAnsweredText = null;
        this.judgeSeq++;
        this.sequence = 0;
    }

    private emit(event: Omit<AutoAnswerTelemetryEvent, 'meetingGeneration'>): void {
        try {
            this.host.telemetry?.({ ...event, meetingGeneration: this.host.meetingGeneration() } as AutoAnswerTelemetryEvent);
        } catch { /* telemetry must never break the pipeline */ }
        if (event.name === 'auto_answer_ignored') this.host.log?.(`[AutoAnswer:simple] skipped: ${event.skipReason}${event.questionId ? ` (${event.questionId})` : ''}`);
    }
}
