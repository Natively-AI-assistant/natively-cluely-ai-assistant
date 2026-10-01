/**
 * Auto Answer → Pro operational telemetry (layer B, `operational_telemetry_events`).
 *
 * WHY THIS EXISTS
 *
 * Every Auto Answer decision already becomes a structured event (the engine's
 * `telemetry` hook), but those went only to TelemetryService, whose one active
 * sink is a local JSONL file: the remote sinks need build-time keys a packaged
 * app does not carry. So how often Auto Answer fires, whether the user keeps
 * the answer, and how long it takes to show one were facts that existed on
 * every user's disk and nowhere else. This feeds the same events into the
 * usage outbox, the pipeline Pro telemetry already rides.
 *
 * WHAT IT SENDS
 *
 * Two rows, both counts, durations and enum labels, never text:
 *
 *   op=auto_answer          one per automatic answer, sent when its feedback
 *                           resolves (kept / superseded), when the next answer
 *                           replaces it, or when the meeting ends (unresolved)
 *   op=auto_answer_meeting  one per meeting that produced a candidate
 *
 * Not one per heard sentence: a candidate is judged every few seconds of a
 * meeting, and a row each would be noise at fleet scale. The meeting row
 * carries those counts instead.
 *
 * THE SERVER'S RULES, WHICH THIS MUST NOT BREAK
 *
 * natively-api/lib/usageAuditSchema.js rejects a whole event (and the outbox
 * then drops it permanently as a poison row) on: a 9th metadata key, a key
 * named like a content field (`answer`, `text`, `source`…), a string value
 * outside /^[A-Za-z0-9_.:@/-]{1,64}$/, a duration over 24 h. Every row below
 * has at most 8 keys; AutoAnswerUsageTelemetry2026_09_27.test.mjs runs them
 * through the real validator.
 *
 * Pure: no electron, no database. The sink is injected (main.ts wires it to
 * usageOutbox.recordTelemetry behind the telemetryEnabled setting).
 */

import { randomUUID } from 'node:crypto';
import type { UsageEventInput } from '../../services/UsageOutbox';
import type { AutoAnswerTelemetryEvent } from './AutoAnswerTypes';

/** The server's IDENT charset. A value outside it is dropped, never mangled. */
const IDENT_RE = /^[A-Za-z0-9_.:@/-]{1,64}$/;
/** The server refuses reported_duration_ms above this. */
const MAX_DURATION_MS = 86_400_000;
/** Candidates remembered between their judging and their decision. */
const MAX_TRACKED_QUESTIONS = 32;
/** Every row is filed under the live meeting feature (not featureForMode: LFW is not a JD analysis). */
const FEATURE = 'meeting_copilot';

export interface AutoAnswerUsageDeps {
    sink(row: UsageEventInput): void;
    /** The active mode as a label: its template id, 'custom:<template>' for a user mode, null for none. */
    mode(): string | null;
    /** The answer model at dispatch time. */
    answerModel(): { provider?: string; model?: string } | null;
    now?(): number;
    newId?(): string;
}

interface Question {
    candidateAt: number;
    act?: string;
    answerability?: number;
    judgeMs?: number;
}

interface PendingAnswer {
    questionId: string;
    decidedAt: number;
    question: Question | undefined;
    mode: string;
    provider?: string;
    model?: string;
    awaitingFirstToken: boolean;
    firstTokenMs?: number;
}

interface MeetingCounts {
    candidates: number;
    answered: number;
    silent: number;
    judgeTimeouts: number;
    judgeErrors: number;
    kept: number;
    superseded: number;
}

const ZERO: MeetingCounts = { candidates: 0, answered: 0, silent: 0, judgeTimeouts: 0, judgeErrors: 0, kept: 0, superseded: 0 };

function ident(v: unknown): string | undefined {
    return typeof v === 'string' && IDENT_RE.test(v) ? v : undefined;
}

function ms(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
}

export class AutoAnswerUsageTelemetry {
    private readonly now: () => number;
    private readonly newId: () => string;
    private meetingId: string | null = null;
    private meetingStartedAt = 0;
    private meetingMode = 'none';
    private counts: MeetingCounts = { ...ZERO };
    private questions = new Map<string, Question>();
    private pending: PendingAnswer | null = null;

    constructor(private readonly deps: AutoAnswerUsageDeps) {
        this.now = deps.now ?? Date.now;
        this.newId = deps.newId ?? randomUUID;
    }

    /** A meeting started: counts restart under a fresh id. */
    meetingStarted(): void {
        this.flushPending('unresolved');
        this.beginMeeting();
    }

    /** The meeting ended: the open answer is sent unresolved, then the meeting row. */
    meetingEnded(): void {
        try {
            this.flushPending('unresolved');
            if (this.meetingId && this.counts.candidates > 0) this.emitMeeting();
        } catch { /* observability only */ }
        this.meetingId = null;
        this.counts = { ...ZERO };
        this.questions.clear();
    }

    /** One engine telemetry event. Never throws. */
    observe(event: AutoAnswerTelemetryEvent): void {
        try {
            if (!this.meetingId) this.beginMeeting();
            const id = event.questionId;
            switch (event.name) {
                case 'auto_answer_candidate': {
                    if (!id) return;
                    this.counts.candidates++;
                    if (this.questions.size >= MAX_TRACKED_QUESTIONS) {
                        const oldest = this.questions.keys().next().value;
                        if (oldest !== undefined) this.questions.delete(oldest);
                    }
                    this.questions.set(id, { candidateAt: this.now() });
                    return;
                }
                case 'auto_answer_judged': {
                    if (event.judgeOutcome === 'timeout') this.counts.judgeTimeouts++;
                    else if (event.judgeOutcome === 'error' || event.judgeOutcome === 'unparseable') this.counts.judgeErrors++;
                    const q = id ? this.questions.get(id) : undefined;
                    if (!q) return;
                    if (event.dialogueAct) q.act = event.dialogueAct;
                    if (typeof event.answerability === 'number') q.answerability = event.answerability;
                    // 'held_applied' carries the time the verdict was HELD, not
                    // how long the judge took; only a live verdict is a judge time.
                    if (event.judgeOutcome === 'verdict') q.judgeMs = ms(event.judgeMs);
                    return;
                }
                case 'auto_answer_ignored': {
                    // Before a candidate forms (incomplete, backchannel, duplicate)
                    // nothing was judged; only a candidate's silence counts.
                    if (!id || !this.questions.has(id)) return;
                    this.counts.silent++;
                    this.questions.delete(id);
                    return;
                }
                case 'auto_answer_decision': {
                    if (!id || event.action !== 'auto') return;
                    this.flushPending('unresolved');
                    this.counts.answered++;
                    const selection = this.deps.answerModel() ?? {};
                    this.pending = {
                        questionId: id,
                        decidedAt: this.now(),
                        question: this.questions.get(id),
                        mode: this.currentMode(),
                        provider: ident(selection.provider),
                        model: ident(selection.model),
                        awaitingFirstToken: true,
                    };
                    this.questions.delete(id);
                    return;
                }
                case 'auto_answer_feedback': {
                    if (!this.pending || this.pending.questionId !== id) return;
                    if (event.feedback === 'kept') this.counts.kept++;
                    else if (event.feedback === 'superseded') this.counts.superseded++;
                    else return;
                    this.flushPending(event.feedback, ms(event.feedbackMs));
                    return;
                }
                default:
                    return;
            }
        } catch { /* observability only */ }
    }

    /**
     * Answer content reached the overlay. The first one after an automatic
     * dispatch is that answer's first visible word.
     */
    answerShown(): void {
        const p = this.pending;
        if (!p || !p.awaitingFirstToken) return;
        p.awaitingFirstToken = false;
        p.firstTokenMs = ms(this.now() - (p.question?.candidateAt ?? p.decidedAt));
    }

    /**
     * Whatever shows next is not the automatic answer's: a manual answer took
     * over, or the automatic one was discarded. The open answer keeps waiting
     * for its feedback; it just stops waiting for a first word.
     */
    stopAwaitingAnswer(): void {
        if (this.pending) this.pending.awaitingFirstToken = false;
    }

    private beginMeeting(): void {
        this.meetingId = this.newId();
        this.meetingStartedAt = this.now();
        this.meetingMode = this.currentMode();
        this.counts = { ...ZERO };
        this.questions.clear();
    }

    private currentMode(): string {
        try {
            return ident(this.deps.mode()) ?? 'none';
        } catch {
            return 'none';
        }
    }

    private flushPending(feedback: 'kept' | 'superseded' | 'unresolved', feedbackMs?: number): void {
        const p = this.pending;
        this.pending = null;
        if (!p || !this.meetingId) return;
        const q = p.question;
        // Only measured values. An absent key is honest; a 0 would be averaged.
        const metadata: Record<string, string | number | boolean> = {
            op: 'auto_answer',
            mode: p.mode,
            feedback,
        };
        if (q?.act && ident(q.act)) metadata.act = q.act;
        if (typeof q?.answerability === 'number' && Number.isFinite(q.answerability)) {
            metadata.answerability = Math.round(q.answerability * 100) / 100;
        }
        if (q?.judgeMs !== undefined) metadata.judge_ms = q.judgeMs;
        // From the candidate forming (the speaker's pause) to the first word on
        // screen: judge, context, provider and paint, everything the user waits on.
        if (p.firstTokenMs !== undefined) metadata.first_token_ms = p.firstTokenMs;
        if (feedback === 'superseded' && feedbackMs !== undefined) metadata.feedback_ms = feedbackMs;
        this.send({
            event_type: 'feature_completed',
            // Nothing showed: the answer never reached the user.
            event_status: p.firstTokenMs !== undefined ? 'completed' : 'interrupted',
            feature: FEATURE,
            feature_session_id: this.meetingId,
            ...(p.provider ? { provider: p.provider } : {}),
            ...(p.model ? { model: p.model } : {}),
            metadata,
        });
    }

    private emitMeeting(): void {
        const c = this.counts;
        const duration = ms(this.now() - this.meetingStartedAt);
        this.send({
            event_type: 'feature_completed',
            event_status: 'completed',
            feature: FEATURE,
            feature_session_id: this.meetingId ?? undefined,
            reported_count: c.candidates,
            ...(duration !== undefined && duration <= MAX_DURATION_MS ? { reported_duration_ms: duration } : {}),
            metadata: {
                op: 'auto_answer_meeting',
                mode: this.meetingMode,
                answered: c.answered,
                silent: c.silent,
                judge_timeouts: c.judgeTimeouts,
                judge_errors: c.judgeErrors,
                kept: c.kept,
                superseded: c.superseded,
            },
        });
    }

    private send(row: UsageEventInput): void {
        try { this.deps.sink(row); } catch { /* observability only */ }
    }
}
