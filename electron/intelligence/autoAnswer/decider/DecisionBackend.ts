/**
 * The decision layer's contract (campaign Phase 4.1). PURE: no worker, no network, no clock.
 *
 * A DecisionBackend answers the §4 `respond` question for one candidate: answer, silent or wait,
 * with Laya's probabilities and its calibrated `answerConfidence`. The cascade
 * (AutoAnswerDecider.ts) turns a backend result into an ACTION by gating on that confidence;
 * anything not confidently decided becomes `escalate` and goes to the LLM judge, which stays
 * exactly as it is (campaign rule 4).
 *
 * Local and hosted backends receive the SAME `DeciderRequest` and build the SAME §4 state with
 * deciderState.ts, so the two runtimes see byte-identical model input (campaign §4).
 */
import type { JudgeRequest } from '../AutoAnswerJudge';
import { parseJudgeVerdict, routeForVerdict } from '../AutoAnswerJudge';
import type { DeciderLabel } from './deciderState';

export type { DeciderLabel };
export type DeciderAction = DeciderLabel | 'escalate';
export type DeciderBackendKind = 'local' | 'hosted';

/** The engine's judge request, unchanged: the decider reads what the judge reads. */
export type DeciderRequest = JudgeRequest;

/** What one backend returns for one candidate: the model's opinion, before any gating. */
export interface BackendDecision {
    choice: DeciderLabel;
    probabilities: Record<DeciderLabel, number>;
    /** Calibrated max(p) after the fitted temperature. The ONLY number the gate reads (decision D1). */
    answerConfidence: number;
    /** Laya's normalized-entropy concentration. Logged for comparison, never gated on (D1). */
    entropyConfidence: number;
    /** The state did not fit the model's budget even after deciderState's fit. Never trusted. */
    truncated: boolean;
    /** Wall time inside the backend, ms (tokenize + run + decode; network for hosted). */
    ms: number;
}

export interface DecisionBackend {
    readonly kind: DeciderBackendKind;
    /** Cheap, synchronous: false when the model is not downloaded, disabled or poisoned. */
    isAvailable(): boolean;
    decide(req: DeciderRequest, signal?: AbortSignal): Promise<BackendDecision>;
    /** Optional: load the model before the first candidate (meeting start). */
    warmUp?(): void;
    dispose?(): void;
}

/**
 * Per-label minimum `answerConfidence` (fitted on the calib split, Phase 2.6, shipped in the
 * model manifest). Below its label's threshold a decision escalates. `Infinity` for a label
 * means that label never decides on its own.
 */
export interface DeciderThresholds {
    answer: number;
    silent: number;
    wait: number;
}

/** Nothing decides on its own: every candidate escalates. The default until thresholds are fitted. */
export const ESCALATE_ALL: DeciderThresholds = Object.freeze({ answer: Infinity, silent: Infinity, wait: Infinity });

export interface DeciderResult {
    action: DeciderAction;
    /** The backend's top choice even when the action is `escalate` (the doubt policy reads it). */
    choice: DeciderLabel | null;
    probabilities: Record<DeciderLabel, number> | null;
    answerConfidence: number | null;
    backend: DeciderBackendKind | 'none';
    ms: number;
    /** Why the action is `escalate`, when it is. */
    escalateReason?: 'below_threshold' | 'truncated' | 'backends_failed' | 'no_backend';
}

/** Gate one backend decision. Truncated input is never trusted, whatever the confidence. */
export function gateDecision(d: BackendDecision, t: DeciderThresholds): Pick<DeciderResult, 'action' | 'escalateReason'> {
    if (d.truncated) return { action: 'escalate', escalateReason: 'truncated' };
    const need = t[d.choice];
    if (Number.isFinite(need) && d.answerConfidence >= need) return { action: d.choice };
    return { action: 'escalate', escalateReason: 'below_threshold' };
}

/**
 * The label a raw LLM-judge reply amounts to, through the engine's own parser and router: the
 * same mapping the teacher used (data/teacher_label.mjs). Null when the reply does not parse.
 */
export function labelOfJudgeReply(raw: string | null | undefined, candidateText: string): DeciderLabel | null {
    const v = parseJudgeVerdict(raw, candidateText);
    if (!v) return null;
    const route = routeForVerdict(v);
    if (route.route === 'wait_incomplete') return 'wait';
    return route.route === 'evaluate' && route.action === 'answer' ? 'answer' : 'silent';
}

/**
 * A decider verdict in the judge's reply format, so that in `on` mode the engine's existing
 * parser, router, held/stale handling and per-mode policy all run unchanged on it.
 *
 * `answerability` 0.95 for answer: the decider has already ruled at its fitted confidence, and the
 * per-mode policy bands are tuned for the judge's scale, where a real ask scores 0.9-1.0. Passing
 * the raw confidence through would let a band below it veto the decider's answer.
 */
export function judgeReplyFor(label: DeciderLabel): string {
    if (label === 'answer') {
        return JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', action: 'answer', answerability: 0.95, question_text: null });
    }
    if (label === 'wait') {
        return JSON.stringify({ is_ask: false, directed_at_user: false, complete: false, act: 'incomplete', action: 'silent', answerability: 0, question_text: null });
    }
    return JSON.stringify({ is_ask: false, directed_at_user: false, complete: true, act: 'statement', action: 'silent', answerability: 0, question_text: null });
}
