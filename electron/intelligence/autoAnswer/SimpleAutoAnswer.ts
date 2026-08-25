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
import { normalizeForCompare, tokenContainment } from './AutoAnswerText';
import { speculativeQuestionSimilarity } from '../../llm/speculativeSimilarity';
import type { AutoAnswerThresholds } from './AutoAnswerPolicy';
import { DEFAULT_THRESHOLDS } from './AutoAnswerPolicy';
import type { AutoAnswerQuestion, AutoAnswerTelemetryEvent } from './AutoAnswerTypes';

// ── Mic echo detection (live-run 2026-08-24, session 3). Unfitted placeholders. ──
/** A user final matching an interviewer final this recent is the speakers echoing into the mic. */
export const ECHO_WINDOW_MS = 5000;
/** Token similarity at or above which a user final is that echo. */
export const ECHO_SIMILARITY = 0.8;
/** A user final whose tokens are (near-)contained in recent interviewer speech is a mic-caught fragment of it. */
export const ECHO_FRAGMENT_CONTAINMENT = 0.85;
/** Containment needs a few words to mean anything ("Yes." is contained in everything). */
export const ECHO_FRAGMENT_MIN_WORDS = 2;
/** Echo mode engages when at least this many of the last ECHO_FLAG_WINDOW user finals were echoes. */
export const ECHO_ACTIVATE_COUNT = 2;
export const ECHO_FLAG_WINDOW = 4;
/**
 * User-channel BACKCHANNELS (live run 8168240a, 2026-08-24): short listening
 * signals — affirmations, acknowledgements, laughter — possibly repeated
 * ("yeah, yeah.", "okay, right."). They are not the user answering.
 */
export const USER_BACKCHANNEL = /^(?:(?:yeah|yes|yep|yup|ya|mm-?hm+|mhm+|uh-?huh|ok(?:ay)?|right|sure|cool|got it|i see|nice|great|perfect|exactly|interesting|makes sense|sounds good|true|correct|wow|oh|ah|hm+|haha+|alright|of course|fair enough|no problem|totally|absolutely|definitely|indeed|good|fine)[\s,.!?-]*){1,4}$/i;
/**
 * LENIENT MIC (user decision 2026-08-24, after live rounds 3/5/6 all showed
 * FALSE mic suppression): a user final counts as the user ANSWERING — closing
 * the candidate — only on strong evidence: non-echo, non-backchannel AND at
 * least this many words of their own. Blips below the floor never kill a
 * question (the old engine's mic-blindness is what made it feel reliable);
 * the trade-off is that a bare "Three years." answer no longer suppresses.
 */
export const GENUINE_ANSWER_MIN_WORDS = 4;

/** The interviewer must be quiet this long before the judge is consulted. Unfitted placeholder. */
export const STABILITY_MS = 900;
/** A provider endpoint (speech_final / <end>) confirms the stop: shorten the wait. */
export const ENDPOINT_CONFIRM_MS = 350;
/** Below this many NEW words (and no '?') we wait for more speech instead of calling. */
export const MIN_NEW_WORDS = 4;
/**
 * Fire at anything above this. Set by the user (2026-08-25): "if the
 * percentage is above 20 then surely show the answer". Everything between
 * this and the old per-mode bars used to become a card asking permission;
 * that card is gone, so this is the only line left — above it the answer is
 * drafted, below it nothing happens.
 */
export const ANSWER_FLOOR = 0.20;
/** Judge-unavailable fallback on punctuation-less providers: interrogative-led utterances. */
export const FALLBACK_INTERROGATIVE = /^(?:(?:ok(?:ay)?|so|and|now|alright|well)[,.!\s]+)*(?:how|what|why|when|where|which|who|whose|can|could|would|should|do|does|did|are|is|will|have you|tell me|tell us|walk me|walk us|explain|describe)\b/i;
/**
 * Prefetch pacing. Starting the answer alongside the judge removes ~830 ms
 * (measured) from the critical path, but a prefetch the verdict rejects is a
 * wasted generation, so it has to be rationed.
 *
 * The first cut rationed it with the OLD heuristic scorer — which is exactly
 * the thing the judge replaced because it cannot see declarative tasks. So
 * "why did you choose Postgres?" got the speedup and "your task is to
 * recreate this game in React" did not: the case the feature exists for was
 * the one case that never benefited. Now the ration is TIME, not shape — at
 * most one prefetch per window, so a long meeting cannot spend more than a
 * bounded number of generations no matter how it is phrased.
 */
export const PREFETCH_MIN_INTERVAL_MS = 25_000;
/**
 * How long after an automatic answer a manual press still counts as "that
 * answer was not good enough". Long enough for the user to read it and
 * decide, short enough that an unrelated later press is not blamed on it.
 * Unfitted placeholder — this signal exists precisely so it can be fitted.
 */
export const FEEDBACK_WINDOW_MS = 20_000;
/**
 * A verdict discarded as stale is KEPT this long, and re-applied at the next
 * stoppage, when it was positive and the candidate has only grown since.
 *
 * Live run 2026-08-25: 25 of 28 verdicts were thrown away. The engine bumps
 * `judgeSeq` on every interviewer text event, the judge takes ~950 ms, and the
 * stability window measures the gap between transcript ARRIVALS rather than
 * speech — on the relay path finals land in bursts 1-2 s apart, so a stoppage
 * fires mid-sentence and the next arriving segment kills the verdict it paid
 * for. Arrival is not resumption: the text that "superseded" the verdict was
 * usually already spoken when the judge was asked.
 *
 * Deferring instead of discarding keeps the invariant the guard existed for —
 * the held verdict is only ever applied from `onStoppage`, i.e. at a quiet
 * point, never mid-sentence.
 */
export const HELD_MAX_AGE_MS = 15_000;
/**
 * A held verdict is applied ONLY to the byte-identical candidate. Growth may
 * never be held across, in either direction, and this was proved by a test
 * before it could ship:
 *   - the growth COMPLETES the utterance ("tell me about the hardest bug you
 *     ever" + "debugged in production and how you found it?") — applying the
 *     held verdict answers a truncated question;
 *   - the growth is a NEW sentence — applying the held verdict answers Q1
 *     after Q2 arrived, which spec V2 §34 pins as an invariant.
 * So growth always re-judges, exactly as before. What this recovers is the
 * INTERIM supersede: an interim cannot change the candidate (`pending` is
 * finals-only), so a verdict it invalidated is still precisely about the text
 * on the table.
 */
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
    /** Key the engine's speculative cache to this candidate. */
    noteCandidate?(questionId: string, candidateGeneration: number): void;
    /** What the engine currently holds speculatively, for keyed reuse. */
    speculativeSnapshot?(): { questionId: string | null; text: string | null };
    /** Start the answer WHILE the judge decides (see PREFETCH_MIN_ANSWERABILITY). */
    prefetchAnswer?(questionId: string, text: string): void;
    modeName?(): string | null;
    telemetry?(event: AutoAnswerTelemetryEvent): void;
    log?(line: string): void;
    /**
     * DEV-ONLY content trace: the exact words the judge is ruling on, and what
     * it ruled. Telemetry and `log` carry lengths and reasons only, by
     * construction, which left one question unanswerable from a real run —
     * *which part of the speech was judged?*
     *
     * The engine never decides whether this is safe: the host supplies the
     * hook only while the Context-Intelligence content gate is open (dev build
     * AND verbose AND the explicit env opt-in), so a packaged build has no
     * hook at all.
     */
    logContent?(label: string, text: string): void;
}

export class SimpleAutoAnswerEngine {
    private pending: Array<{ text: string; at: number; speaker?: string }> = [];
    /** speakerId per interviewer final, when the STT diarizes. Keyed by normalized text. */
    private speakerByTurn = new Map<string, string>();
    private recentInterviewerFinals: Array<{ text: string; at: number }> = [];
    private timer: ClockTimer | null = null;
    private retryTimer: ClockTimer | null = null;
    private judgeSeq = 0;
    private sequence = 0;
    private lastJudgedKey = '';
    private lastAnsweredText: string | null = null;
    /** The automatic answer currently inside its feedback window. */
    private feedbackPending: { id: string; at: number; act: AutoAnswerQuestion['dialogueAct']; answerability: number } | null = null;
    private feedbackTimer: ClockTimer | null = null;
    /** When the last prefetch fired, for PREFETCH_MIN_INTERVAL_MS pacing. */
    private lastPrefetchAt: number | null = null;
    /** A dispatch waiting on a busy engine, so onEngineIdle can wake it immediately. */
    private parkedAttempt: (() => void) | null = null;
    /** A positive verdict superseded by still-arriving transcript — see HELD_MAX_AGE_MS. */
    private held: {
        id: string; key: string; text: string;
        answerability: number; act: AutoAnswerQuestion['dialogueAct']; at: number;
    } | null = null;
    /** Punctuation provenance of the latest interviewer final ('provider' family = a missing '?' means something). */
    private punctuationGuaranteed = false;
    /** What last bumped judgeSeq, so a discarded verdict can say what killed it. */
    private judgeSeqCause: NonNullable<AutoAnswerTelemetryEvent['supersededBy']> | null = null;
    private thresholds: AutoAnswerThresholds;

    constructor(
        private readonly host: SimpleAutoAnswerHost,
        private readonly clock: Clock = systemClock,
        thresholds: AutoAnswerThresholds = DEFAULT_THRESHOLDS,
    ) {
        this.thresholds = thresholds;
    }

    setThresholds(t: AutoAnswerThresholds): void { this.thresholds = t; }

    /** Every supersede goes through here so the telemetry can name the cause. */
    private bumpJudgeSeq(cause: NonNullable<AutoAnswerTelemetryEvent['supersededBy']>): void {
        this.judgeSeq++;
        this.judgeSeqCause = cause;
    }

    onMeetingStart(): void { this.reset(); }
    onMeetingStop(): void { this.reset(); }
    /**
     * The engine went idle. A dispatch parked behind it should go NOW rather
     * than wait out the rest of its 500 ms poll — measured on a real interview,
     * the poll was adding most of a second on top of an already 6-second wait.
     */
    onEngineIdle(): void {
        const parked = this.parkedAttempt;
        if (!parked) return;
        this.clearRetry();
        parked();
    }

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
                    if (text) this.bumpJudgeSeq('interim');
                    this.arm(STABILITY_MS);
                }
                return;
            }
            if (!text) return;
            this.recentInterviewerFinals.push({ text, at: now });
            while (this.recentInterviewerFinals.length > 8) this.recentInterviewerFinals.shift();
            this.punctuationGuaranteed = (segment as { punctuationSource?: string }).punctuationSource === 'provider' ||
                (segment as { punctuationSource?: string }).punctuationSource === 'provider_final';
            const speaker = (segment as { speakerId?: string }).speakerId;
            if (speaker) {
                this.speakerByTurn.set(normalizeForCompare(text), speaker);
                if (this.speakerByTurn.size > 64) {
                    const oldest = this.speakerByTurn.keys().next().value;
                    if (oldest !== undefined) this.speakerByTurn.delete(oldest);
                }
            }
            this.pending.push({ text, at: now, speaker });
            this.bumpJudgeSeq('final');  // supersede any in-flight verdict: it judged less than this
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
        this.bumpJudgeSeq('user_answering');
        this.dropParked();
        // A held verdict is keyed to a candidate PREFIX, not to judgeSeq, so
        // the seq guard no longer protects it: drop it explicitly or it fires
        // into a question the user has just answered themselves.
        this.held = null;
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
        const words = candidate.split(/\s+/).filter(Boolean).length;

        // A verdict this candidate already earned, deferred because transcript
        // kept arriving. Checked BEFORE the lastJudgedKey return: an INTERIM
        // supersede leaves the candidate byte-identical, so that return would
        // otherwise swallow the very case this exists for.
        const heldReady = this.applicableHeld(key, now);
        if (heldReady) {
            this.held = null;
            this.lastJudgedKey = key;
            this.emit({
                name: 'auto_answer_judged', questionId: heldReady.id, judgeOutcome: 'held_applied',
                judgeMs: now - heldReady.at, dialogueAct: heldReady.act, answerability: heldReady.answerability,
            });
            this.host.log?.(`[AutoAnswer:simple] applying the deferred verdict for ${heldReady.id}`);
            this.host.logContent?.(`deferred verdict applied ${heldReady.id} (a=${heldReady.answerability})`, heldReady.text);
            this.deliver(heldReady.id, heldReady.text, heldReady.answerability, heldReady.act, now);
            return;
        }

        // Zero-cost prefilter — the ONLY heuristics left in the hot path.
        if (key === this.lastJudgedKey) return;                     // verdict already stands
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
        this.host.logContent?.(`judging ${id} (${words}w)`, candidate);
        // Key any speculation the engine starts on its own interims to THIS
        // candidate, so the dispatch below can claim it by id.
        this.host.noteCandidate?.(id, this.sequence);
        this.maybePrefetch(id, candidate, now);
        void this.consult(id, candidate, now);
    }

    /**
     * The held verdict, if it still applies to this candidate: same text, or
     * the same text plus a little more speech. Anything else (a revision that
     * broke the prefix, a long continuation, an old verdict) is dropped here
     * so the stoppage judges afresh.
     */
    private applicableHeld(key: string, now: number): NonNullable<SimpleAutoAnswerEngine['held']> | null {
        const h = this.held;
        if (!h) return null;
        if (now - h.at > HELD_MAX_AGE_MS) { this.held = null; return null; }
        if (key !== h.key) { this.held = null; return null; }   // see the note on HELD_MAX_AGE_MS
        return h;
    }

    /**
     * Start the answer while the judge is still deciding. Rationed by time, so
     * a declarative task gets the same head start as a question mark — see
     * PREFETCH_MIN_INTERVAL_MS. The engine applies its own guards on top (idle
     * only, never over a live stream or an existing speculation), so this can
     * be optimistic without stacking generations.
     */
    private maybePrefetch(id: string, candidate: string, now: number): void {
        if (!this.host.prefetchAnswer) return;
        if (this.lastPrefetchAt !== null && now - this.lastPrefetchAt < PREFETCH_MIN_INTERVAL_MS) return;
        this.lastPrefetchAt = now;
        try {
            this.host.prefetchAnswer(id, candidate);
        } catch { /* prefetch is an optimisation; never break the pipeline */ }
    }

    private async consult(id: string, candidate: string, committedAt: number): Promise<void> {
        const seq = this.judgeSeq;
        const generation = this.host.meetingGeneration();
        let timer: ClockTimer | null = null;
        let timedOut = false;
        const turns = this.turnsBefore(committedAt);
        const parts = this.pending.map(p => ({ speaker: p.speaker, text: p.text }));
        let raw: string | null = null;
        let outcome: 'verdict' | 'timeout' | 'error' | 'unparseable' | 'absent' = 'verdict';
        if (!this.host.judgeCandidate) {
            outcome = 'absent';
        } else {
            try {
                raw = await Promise.race([
                    this.host.judgeCandidate({
                        candidateText: candidate,
                        recentTurns: turns,
                        speakers: turns.map(t => (t.role === 'interviewer' ? this.speakerByTurn.get(normalizeForCompare(t.text)) : undefined)),
                        candidateParts: parts,
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
        // Parse FIRST (it is pure and cheap), so that a verdict about to be
        // discarded still reaches telemetry. Live run 2026-08-25: 25 of 28
        // verdicts were dropped here and the record could not say whether a
        // single one of them had said 'answer'.
        const verdict = outcome === 'verdict' ? parseJudgeVerdict(raw, candidate) : null;
        // Superseded: more interviewer speech arrived, the meeting moved on.
        if (seq !== this.judgeSeq || !this.host.isMeetingActive() || this.host.meetingGeneration() !== generation) {
            this.emit({
                name: 'auto_answer_judged', questionId: id, judgeOutcome: 'stale', judgeMs,
                supersededBy: !this.host.isMeetingActive() ? 'meeting_ended'
                    : this.host.meetingGeneration() !== generation ? 'meeting_reset'
                    : (this.judgeSeqCause ?? undefined),
                ...(verdict ? {
                    judgeIsAsk: verdict.isAsk, judgeDirectedAtUser: verdict.directedAtUser,
                    dialogueAct: verdict.act, answerability: verdict.answerability,
                } : {}),
            });
            this.host.logContent?.(
                `superseded ${id} by ${this.judgeSeqCause ?? 'unknown'} after ${judgeMs}ms`
                + (verdict ? ` — it had said ${verdict.isAsk ? 'ASK' : 'not-ask'} a=${verdict.answerability}` : ''),
                candidate);
            // Defer, don't discard. Only a POSITIVE verdict is held: a silent
            // one must not veto the grown candidate, because the ask may be in
            // the very words that superseded it.
            if (verdict && this.host.isMeetingActive() && this.host.meetingGeneration() === generation) {
                const superseded = routeForVerdict(verdict);
                if (superseded.route === 'evaluate' && superseded.action === 'answer'
                    && superseded.answerability > ANSWER_FLOOR) {
                    this.held = {
                        id, key: normalizeForCompare(candidate),
                        text: superseded.questionText ?? candidate,
                        answerability: superseded.answerability, act: superseded.act, at: this.clock.now(),
                    };
                }
            }
            return;
        }
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
        this.host.logContent?.(
            `verdict ${id} → ${route.route === 'evaluate' ? route.action : route.route}`
            + ` (${verdict.act}, a=${verdict.answerability}, ${judgeMs}ms)`,
            route.route === 'evaluate' ? (route.questionText ?? candidate) : candidate);
        if (route.route !== 'evaluate') {
            const reason = route.route === 'wait_incomplete' ? 'incomplete' : route.reason;
            this.emit({ name: 'auto_answer_ignored', questionId: id, skipReason: reason, dialogueAct: verdict.act, answerability: verdict.answerability });
            if (route.route === 'wait_incomplete') this.lastJudgedKey = '';   // more speech may finish it → re-judge then
            return;
        }
        const text = route.questionText ?? candidate;
        // Answer or nothing. The judge decides, and the only number left in
        // the decision is ANSWER_FLOOR — the per-mode bars no longer gate a
        // dispatch, because the thing they used to demote to (the offer card)
        // is gone.
        if (route.action === 'answer' && route.answerability > ANSWER_FLOOR) {
            this.deliver(id, text, route.answerability, route.act, committedAt);
        } else {
            this.emit({ name: 'auto_answer_ignored', questionId: id, skipReason: 'low_answerability', answerability: route.answerability });
        }
    }

    /** Dispatch now, or retry while the engine is busy — woken early by onEngineIdle. */
    private deliver(id: string, text: string, answerability: number, act: AutoAnswerQuestion['dialogueAct'], committedAt: number): void {
        const deadline = this.clock.now() + RETRY_TTL_MS;
        const seqAtDeliver = this.judgeSeq;
        const attempt = () => {
            if (!this.host.isMeetingActive() || this.judgeSeq !== seqAtDeliver) { this.parkedAttempt = null; return; }
            if (!this.host.engineAccepting()) {
                if (this.clock.now() >= deadline) {
                    this.parkedAttempt = null;
                    this.emit({ name: 'auto_answer_ignored', questionId: id, skipReason: 'engine_busy_or_cooling' });
                    return;
                }
                this.parkedAttempt = attempt;
                this.retryTimer = this.clock.setTimeout(attempt, RETRY_MS);
                return;
            }
            this.parkedAttempt = null;
            const q = this.question(id, text, answerability, act, committedAt);
            // If the engine already has an answer in flight for THIS question
            // (our prefetch, or its own interim speculation keyed by
            // noteCandidate), adopt it instead of starting over — that is the
            // whole point of prefetching.
            const snapshot = this.host.speculativeSnapshot?.();
            const reuseSpeculative = Boolean(snapshot && snapshot.questionId === id && snapshot.text);
            this.lastAnsweredText = text;
            this.pending = [];
            this.lastJudgedKey = '';
            this.emit({ name: 'auto_answer_decision', questionId: id, action: 'auto', answerability });
            if (reuseSpeculative) this.host.log?.(`[AutoAnswer:simple] reusing the prefetched answer for ${id}`);
            this.armFeedback(id, act, answerability);
            void this.host.dispatch(q, { reuseSpeculative });
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

    /**
     * A manual What-to-Answer started. Inside the feedback window that is the
     * user telling us the automatic answer missed; the offer card (if any) is
     * committed either way.
     */
    onManualAnswerStarted(): void {
        const pending = this.feedbackPending;
        if (!pending) return;
        this.clearFeedback();
        const feedbackMs = this.clock.now() - pending.at;
        this.emit({
            name: 'auto_answer_feedback', questionId: pending.id, feedback: 'superseded', feedbackMs,
            dialogueAct: pending.act, answerability: pending.answerability,
        });
        this.host.log?.(`[AutoAnswer:simple] superseded by a manual answer after ${feedbackMs}ms`);
    }

    private armFeedback(id: string, act: AutoAnswerQuestion['dialogueAct'], answerability: number): void {
        this.clearFeedback();
        this.feedbackPending = { id, at: this.clock.now(), act, answerability };
        this.feedbackTimer = this.clock.setTimeout(() => {
            const pending = this.feedbackPending;
            this.feedbackTimer = null;
            this.feedbackPending = null;
            if (!pending) return;
            this.emit({
                name: 'auto_answer_feedback', questionId: pending.id, feedback: 'kept',
                dialogueAct: pending.act, answerability: pending.answerability,
            });
        }, FEEDBACK_WINDOW_MS);
    }

    private clearFeedback(): void {
        if (this.feedbackTimer !== null) { this.clock.clearTimeout(this.feedbackTimer); this.feedbackTimer = null; }
        this.feedbackPending = null;
    }

    private clearRetry(): void {
        if (this.retryTimer !== null) { this.clock.clearTimeout(this.retryTimer); this.retryTimer = null; }
    }

    private dropParked(): void { this.parkedAttempt = null; this.clearRetry(); }

    private reset(): void {
        this.disarm();
        this.dropParked();
        this.clearFeedback();
        this.pending = [];
        this.recentInterviewerFinals = [];
        this.speakerByTurn.clear();
        this.lastJudgedKey = '';
        this.lastAnsweredText = null;
        this.lastPrefetchAt = null;
        this.held = null;
        this.bumpJudgeSeq('meeting_reset');
        this.sequence = 0;
    }

    private emit(event: Omit<AutoAnswerTelemetryEvent, 'meetingGeneration'>): void {
        try {
            this.host.telemetry?.({ ...event, meetingGeneration: this.host.meetingGeneration() } as AutoAnswerTelemetryEvent);
        } catch { /* telemetry must never break the pipeline */ }
        if (event.name === 'auto_answer_ignored') this.host.log?.(`[AutoAnswer:simple] skipped: ${event.skipReason}${event.questionId ? ` (${event.questionId})` : ''}`);
    }
}
