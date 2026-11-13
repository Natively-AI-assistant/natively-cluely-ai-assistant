/**
 * The Auto Answer decision cascade (campaign Phase 4.4 and 4.5).
 *
 * It sits exactly where the LLM judge sits: the engine calls `judge(req, signal)` and gets back
 * a judge-format reply (or null), so SimpleAutoAnswerEngine, its deadline, its held/stale
 * machinery and its per-mode policy are untouched (campaign rule 4: nothing of the judge is
 * deleted).
 *
 *   off     the LLM judge alone, as before this campaign.
 *   shadow  the LLM judge stays AUTHORITATIVE and its reply is returned unchanged. The decider
 *           runs beside it and only telemetry records whether they agreed. It cannot change a
 *           dispatch by construction: its result never reaches the return value.
 *   on      the decider is authoritative. Backends in order (hosted/local per entitlement and
 *           setting, then the other), each under its own deadline. A decision at or above its
 *           label's fitted confidence is returned as a judge-format reply; anything else
 *           ESCALATES to the LLM judge. If the judge then also fails, the doubt policy answers
 *           when the decider's top choice was answer (the user's "if in doubt, answer" rule),
 *           instead of the engine's trailing-'?' fallback.
 *
 * PURE: backends, judge, clock and telemetry are injected. Telemetry carries enums, numbers and
 * booleans only, never text (campaign rule 1).
 */
import type { Clock, ClockTimer } from '../AutoAnswerClock';
import {
    type BackendDecision, type DecisionBackend, type DeciderLabel, type DeciderRequest, type DeciderResult,
    type DeciderThresholds, gateDecision, judgeReplyFor, labelOfJudgeReply,
} from './DecisionBackend';
import type { DeciderMode } from './deciderPlatform';

/** Hosted: a network round trip to natively-api (Phase 5). Local: tokenize + int8 run, ~300 ms p90 on an M4. */
export const HOSTED_DEADLINE_MS = 600;
export const LOCAL_DEADLINE_MS = 900;

export interface DeciderTelemetry {
    name: 'auto_answer_decided';
    questionId?: string;
    decisionMode: Exclude<DeciderMode, 'off'>;
    decisionBackend: DeciderResult['backend'];
    decisionAction: DeciderResult['action'];
    decisionChoice?: DeciderLabel;
    decisionConfidence?: number;
    decisionMs: number;
    escalated: boolean;
    escalateReason?: NonNullable<DeciderResult['escalateReason']>;
    /** shadow: the label the LLM judge's reply amounts to, and whether the decider's top choice matched it. */
    judgeLabel?: DeciderLabel;
    shadowAgree?: boolean;
    /** on: the judge failed after an escalation and the doubt policy answered. */
    doubtAnswered?: boolean;
}

export interface AutoAnswerDeciderDeps {
    mode(): DeciderMode;
    /** Backends in priority order. Unavailable ones are skipped without a call. */
    backends(): DecisionBackend[];
    /** The existing LLM judge hook (main.ts). Absent when NATIVELY_AUTO_ANSWER_JUDGE=off. */
    llmJudge?: (req: DeciderRequest, signal?: AbortSignal) => Promise<string | null>;
    /** The fitted thresholds of the model behind `kind` (each artifact ships its own). */
    thresholds(kind: DecisionBackend['kind']): DeciderThresholds;
    clock: Clock;
    deadlineMs?(kind: DecisionBackend['kind']): number;
    telemetry?(event: DeciderTelemetry): void;
}

export class AutoAnswerDecider {
    constructor(private readonly deps: AutoAnswerDeciderDeps) {}

    /** Drop-in for the engine host's `judgeCandidate`. */
    async judge(req: DeciderRequest, signal?: AbortSignal): Promise<string | null> {
        const mode = this.deps.mode();
        // off: the judge hook itself, errors included, so the engine sees exactly what it saw before.
        if (mode === 'off') return this.deps.llmJudge ? this.deps.llmJudge(req, signal) : null;
        if (mode === 'shadow') return this.shadow(req, signal);
        return this.authoritative(req, signal);
    }

    /** Backends only, no LLM: the first one that answers in time, gated. */
    async decide(req: DeciderRequest, signal?: AbortSignal): Promise<DeciderResult> {
        const start = this.deps.clock.now();
        const available = this.safeBackends().filter((b) => { try { return b.isAvailable(); } catch { return false; } });
        if (!available.length) return { action: 'escalate', escalateReason: 'no_backend', choice: null, probabilities: null, answerConfidence: null, backend: 'none', ms: 0 };
        for (const backend of available) {
            if (signal?.aborted) break;
            const d = await this.withDeadline(backend, req, signal);
            if (!d) continue;
            const gated = gateDecision(d, this.deps.thresholds(backend.kind));
            return { ...gated, choice: d.choice, probabilities: d.probabilities, answerConfidence: d.answerConfidence, backend: backend.kind, ms: this.deps.clock.now() - start };
        }
        return { action: 'escalate', escalateReason: 'backends_failed', choice: null, probabilities: null, answerConfidence: null, backend: 'none', ms: this.deps.clock.now() - start };
    }

    private async shadow(req: DeciderRequest, signal?: AbortSignal): Promise<string | null> {
        // No model downloaded (the normal state before Phase 6): nothing to compare, and an event
        // per candidate saying so would only be noise.
        if (!this.safeBackends().some((b) => { try { return b.isAvailable(); } catch { return false; } })) {
            return this.deps.llmJudge ? this.deps.llmJudge(req, signal) : null;
        }
        const decided = this.decide(req, signal).catch(() => null);
        let raw: string | null = null;
        let judgeErr: unknown = null;
        try { raw = this.deps.llmJudge ? await this.deps.llmJudge(req, signal) : null; } catch (e) { judgeErr = e; }
        // Telemetry once both are in. Never awaited here: the judge's reply goes back to the
        // engine the moment it exists, whatever the decider is still doing.
        void decided.then((d) => {
            if (!d || signal?.aborted) return;
            const judgeLabel = judgeErr ? undefined : labelOfJudgeReply(raw, req.candidateText) ?? undefined;
            this.emit(req, 'shadow', d, {
                ...(judgeLabel ? { judgeLabel } : {}),
                ...(judgeLabel && d.choice ? { shadowAgree: judgeLabel === d.choice } : {}),
            });
        });
        // The judge's outcome reaches the engine unchanged, a thrown error included.
        if (judgeErr) throw judgeErr;
        return raw;
    }

    private async authoritative(req: DeciderRequest, signal?: AbortSignal): Promise<string | null> {
        const d = await this.decide(req, signal);
        if (d.action !== 'escalate') {
            this.emit(req, 'on', d);
            return judgeReplyFor(d.action);
        }
        let raw: string | null = null;
        let judgeErr: unknown = null;
        try { raw = this.deps.llmJudge ? await this.deps.llmJudge(req, signal) : null; } catch (e) { judgeErr = e; }
        if (!judgeErr && labelOfJudgeReply(raw, req.candidateText) !== null) {
            this.emit(req, 'on', d);
            return raw;
        }
        // Escalated AND the judge failed or did not parse. Doubt answers (decision logged in
        // docs/autopilot/decider-decisions.md); anything else keeps the engine's own fallback.
        if (d.choice === 'answer' && !signal?.aborted) {
            this.emit(req, 'on', d, { doubtAnswered: true });
            return judgeReplyFor('answer');
        }
        this.emit(req, 'on', d);
        // Otherwise the engine handles the judge's failure exactly as before (outcome 'error').
        if (judgeErr) throw judgeErr;
        return raw;
    }

    private safeBackends(): DecisionBackend[] {
        try { return this.deps.backends() ?? []; } catch { return []; }
    }

    /** One backend under its deadline. Null on timeout, error, abort or a malformed decision. */
    private withDeadline(backend: DecisionBackend, req: DeciderRequest, outer?: AbortSignal): Promise<BackendDecision | null> {
        const ms = this.deps.deadlineMs?.(backend.kind) ?? (backend.kind === 'hosted' ? HOSTED_DEADLINE_MS : LOCAL_DEADLINE_MS);
        const ctl = new AbortController();
        const onOuter = () => ctl.abort();
        outer?.addEventListener('abort', onOuter, { once: true });
        let timer: ClockTimer | null = null;
        const cleanup = () => {
            if (timer !== null) this.deps.clock.clearTimeout(timer);
            outer?.removeEventListener('abort', onOuter);
        };
        return new Promise<BackendDecision | null>((resolve) => {
            let settled = false;
            const done = (v: BackendDecision | null) => { if (settled) return; settled = true; cleanup(); resolve(v); };
            timer = this.deps.clock.setTimeout(() => { ctl.abort(); done(null); }, ms);
            ctl.signal.addEventListener('abort', () => done(null), { once: true });
            Promise.resolve()
                .then(() => backend.decide(req, ctl.signal))
                .then((d) => done(isDecision(d) ? d : null), () => done(null));
        });
    }

    private emit(req: DeciderRequest, mode: 'shadow' | 'on', d: DeciderResult, extra: Partial<DeciderTelemetry> = {}): void {
        if (!this.deps.telemetry) return;
        try {
            this.deps.telemetry({
                name: 'auto_answer_decided',
                questionId: req.questionId,
                decisionMode: mode,
                decisionBackend: d.backend,
                decisionAction: d.action,
                ...(d.choice ? { decisionChoice: d.choice } : {}),
                ...(typeof d.answerConfidence === 'number' ? { decisionConfidence: Math.round(d.answerConfidence * 1e4) / 1e4 } : {}),
                decisionMs: d.ms,
                escalated: d.action === 'escalate',
                ...(d.escalateReason ? { escalateReason: d.escalateReason } : {}),
                ...extra,
            });
        } catch { /* telemetry must never break the pipeline */ }
    }
}

function isDecision(d: unknown): d is BackendDecision {
    const x = d as BackendDecision | null;
    return !!x && (x.choice === 'answer' || x.choice === 'silent' || x.choice === 'wait')
        && typeof x.answerConfidence === 'number' && Number.isFinite(x.answerConfidence);
}
