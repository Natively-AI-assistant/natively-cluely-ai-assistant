/**
 * Feature-lifecycle instrumentation for the usage ledger (phase 4/5).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DISTINCTION THIS FILE EXISTS TO PRESERVE (§42)
 *
 * "Used" is three different facts, and collapsing them is how a usage record
 * becomes a lie:
 *
 *   feature_started    the user invoked it
 *   feature_completed  the application reached completion
 *   provider_success   the upstream model actually answered
 *
 * A button press is not a completed execution. A completed execution is not a
 * useful answer. This module emits `started` and then exactly one terminal event
 * (`completed` | `failed` | `cancelled`), so a report can distinguish "invoked
 * 40 times, completed 12" from "used 40 times" — and the second sentence is one
 * nobody can honestly write from this data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE MODE MAP IS EXPLICIT AND CONSERVATIVE
 *
 * §31 forbids inventing feature semantics the data cannot support. A user can
 * rename a mode to anything, and custom modes have no fixed meaning at all, so
 * only the BUILT-IN template ids are mapped to named features. Everything else
 * reports the honest, unspecific `mode_execution`. Reporting a custom mode named
 * "Technical Interview" as a technical_interview execution would be a guess
 * printed as a fact.
 */

import { randomUUID } from 'node:crypto';
import { usageOutbox, type UsageEventInput } from './UsageOutbox';

/** Normalized product features. Must match FEATURES in natively-api/lib/licenseLedger.js. */
export const FEATURE = {
    MEETING_COPILOT: 'meeting_copilot',
    TECHNICAL_INTERVIEW: 'technical_interview',
    JD_ANALYSIS: 'jd_analysis',
    PROFILE_INTELLIGENCE: 'profile_intelligence',
    MODE_EXECUTION: 'mode_execution',
} as const;

export type FeatureName = typeof FEATURE[keyof typeof FEATURE];

/**
 * Built-in template id → normalized feature.
 *
 * Only built-ins appear here, and only where the mapping is unambiguous. A
 * template absent from this map is not an oversight — it is a decision not to
 * assert something the data does not establish.
 */
const BUILTIN_TEMPLATE_TO_FEATURE: Record<string, FeatureName> = {
    'technical-interview': FEATURE.TECHNICAL_INTERVIEW,
    'looking-for-work': FEATURE.JD_ANALYSIS,
    'team-meet': FEATURE.MEETING_COPILOT,
    'seminar': FEATURE.MEETING_COPILOT,
    'call-center': FEATURE.MEETING_COPILOT,
    'lecture': FEATURE.MEETING_COPILOT,
};

/**
 * Resolve a normalized feature from the active mode.
 *
 * `isBuiltin` is load-bearing: a user-created mode whose templateType happens to
 * be 'technical-interview' is not a built-in Technical Interview, and treating
 * it as one would attribute a named feature to a row the user could have shaped
 * arbitrarily.
 */
export function featureForMode(mode: { templateType?: string; is_builtin?: number | boolean; isBuiltin?: boolean } | null | undefined): FeatureName {
    if (!mode) return FEATURE.MODE_EXECUTION;
    // F6 (code-review 2026-08-14): the live call site passes
    // ModesManager.getActiveMode() output, whose Mode type carries CAMELCASE
    // `isBuiltin` (rowToMode maps `is_builtin === 1` → isBuiltin). Reading only
    // the snake_case raw-row field meant builtin detection was ALWAYS false in
    // production and every execution ledgered as generic mode_execution — the
    // shipped test used raw-row fixtures, masking it. Accept both shapes.
    const isBuiltin = mode.is_builtin === 1 || mode.is_builtin === true || mode.isBuiltin === true;
    if (!isBuiltin) return FEATURE.MODE_EXECUTION;
    return BUILTIN_TEMPLATE_TO_FEATURE[String(mode.templateType ?? '')] ?? FEATURE.MODE_EXECUTION;
}

/** Map a thrown error to a normalized failure category (§19). Never the message. */
export function classifyFailure(err: unknown): { failure_origin: string; failure_code: string } {
    const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
    const name = String((err as any)?.name ?? '').toLowerCase();

    if (name.includes('abort') || msg.includes('aborted') || msg.includes('cancel')) {
        return { failure_origin: 'user_cancelled', failure_code: 'USER_CANCELLED' };
    }
    if (name.includes('timeout') || msg.includes('timeout') || msg.includes('timed out') || msg.includes('deadline')) {
        return { failure_origin: 'timeout', failure_code: 'TIMEOUT' };
    }
    if (msg.includes('401') || msg.includes('403') || msg.includes('unauthor') || msg.includes('invalid key') || msg.includes('api key')) {
        return { failure_origin: 'authentication', failure_code: 'AUTH_FAILED' };
    }
    if (msg.includes('429') || msg.includes('rate limit')) {
        return { failure_origin: 'provider', failure_code: 'PROVIDER_RATE_LIMIT' };
    }
    if (msg.includes('quota') || msg.includes('exceeded your')) {
        return { failure_origin: 'quota', failure_code: 'QUOTA_EXCEEDED' };
    }
    if (msg.includes('enotfound') || msg.includes('econnrefused') || msg.includes('network') || msg.includes('fetch failed')) {
        return { failure_origin: 'network', failure_code: 'NETWORK_UNAVAILABLE' };
    }
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('upstream')) {
        return { failure_origin: 'provider', failure_code: 'PROVIDER_5XX' };
    }
    if (msg.includes('permission') || msg.includes('denied')) {
        return { failure_origin: 'permission', failure_code: 'PERMISSION_DENIED' };
    }
    // The default is `natively` + RUNTIME_ERROR, not `unknown`. An error we
    // failed to categorise happened inside our own code until proven otherwise,
    // and a dispute report must never imply a provider was at fault when the
    // truth is that we could not tell.
    return { failure_origin: 'natively', failure_code: 'RUNTIME_ERROR' };
}

export interface FeatureTracker {
    featureSessionId: string;
    /** Terminal. Safe to call more than once — only the first call emits. */
    completed(extra?: Partial<UsageEventInput>): void;
    failed(err: unknown, extra?: Partial<UsageEventInput>): void;
    cancelled(extra?: Partial<UsageEventInput>): void;
    /** Layer B diagnostics for this execution. Never evidence. */
    telemetry(input: Partial<UsageEventInput> & { event_type: string }): void;
}

/**
 * Begin tracking one feature execution.
 *
 * Emits `feature_started` immediately, then exactly one terminal event. Every
 * method is wrapped: instrumentation must never be able to fail the feature it
 * is measuring.
 */
export function trackFeature(feature: FeatureName, opts?: { sessionId?: string; metadata?: Record<string, string | number | boolean> }): FeatureTracker {
    const featureSessionId = randomUUID();
    const startedAt = Date.now();
    let terminated = false;

    const emit = (input: UsageEventInput) => {
        try { usageOutbox.record(input); } catch { /* never throws into the feature */ }
    };

    try {
        emit({
            event_type: 'feature_started',
            event_status: 'started',
            feature,
            feature_session_id: featureSessionId,
            ...(opts?.sessionId ? { session_id: opts.sessionId } : {}),
            ...(opts?.metadata ? { metadata: opts.metadata } : {}),
        });
    } catch { /* ignore */ }

    const terminal = (event_type: string, event_status: UsageEventInput['event_status'], extra?: Partial<UsageEventInput>) => {
        // Idempotent. A path that both throws and runs a `finally` cleanup must
        // not produce two terminal events for one execution — that would inflate
        // every count derived from them.
        if (terminated) return;
        terminated = true;
        emit({
            event_type,
            event_status,
            feature,
            feature_session_id: featureSessionId,
            reported_duration_ms: Date.now() - startedAt,
            ...(opts?.sessionId ? { session_id: opts.sessionId } : {}),
            ...extra,
        } as UsageEventInput);
    };

    return {
        featureSessionId,
        completed: (extra) => terminal('feature_completed', 'completed', extra),
        failed: (err, extra) => terminal('feature_failed', 'failed', { ...classifyFailure(err), ...extra }),
        cancelled: (extra) => terminal('feature_cancelled', 'cancelled', extra),
        telemetry: (input) => {
            try {
                usageOutbox.recordTelemetry({
                    feature,
                    feature_session_id: featureSessionId,
                    ...input,
                } as UsageEventInput);
            } catch { /* ignore */ }
        },
    };
}

/**
 * Wrap one feature execution. This is how handlers should be instrumented.
 *
 * WHY A WRAPPER RATHER THAN THREE LINES PER HANDLER
 *
 * The answer handlers in ipcHandlers.ts end in three different ways, and the
 * distinction is exactly the one §42 says must not be blurred:
 *
 *   • throwing            `catch (e) { throw e }`      — clearly a failure
 *   • error-object        `return { error, hint: null }` — a failure that LOOKS
 *                          like a normal return, and a naive `finally` records
 *                          it as a completed execution
 *   • null-result         `return { clarification: null }` — nothing was
 *                          produced, but no error was raised either
 *
 * Instrumenting each by hand means getting that judgement right eight separate
 * times. It was already got wrong once (the early returns in
 * `generate-what-to-say` were recorded as successes until a review caught it),
 * which is the argument for one code path with tests rather than eight without.
 *
 * `failedIf` decides what counts as failure for a given handler. The default
 * catches the error-object shape; handlers whose emptiness is meaningful pass
 * their own predicate.
 */
export async function runTracked<T>(
  feature: FeatureName,
  fn: () => Promise<T>,
  opts?: {
    failedIf?: (result: T) => boolean;
    sessionId?: string;
    metadata?: Record<string, string | number | boolean>;
  },
): Promise<T> {
  const tracker = trackFeature(feature, { sessionId: opts?.sessionId, metadata: opts?.metadata });
  try {
    const result = await fn();
    // Default: a truthy `error` field means the handler failed while returning
    // normally. Recording that as a completion would imply delivered service.
    const failed = opts?.failedIf
      ? safeBool(() => opts.failedIf!(result))
      : safeBool(() => !!(result as any)?.error);
    if (failed) tracker.failed(new Error('handler_reported_failure'));
    else tracker.completed();
    return result;
  } catch (err) {
    tracker.failed(err);
    // Rethrow unchanged. Instrumentation observes; it never alters control flow,
    // and a handler's contract with the renderer must not depend on it.
    throw err;
  }
}

/** A predicate that throws must not decide the outcome — treat it as "not failed". */
function safeBool(fn: () => boolean): boolean {
  try { return !!fn(); } catch { return false; }
}

/** Application lifecycle (§5). Emitted once per launch. */
export function recordAppStarted(metadata?: Record<string, string | number | boolean>): void {
    try {
        usageOutbox.record({
            event_type: 'app_started',
            event_status: 'completed',
            ...(metadata ? { metadata } : {}),
        });
    } catch { /* ignore */ }
}

export function recordAppShutdown(): void {
    try {
        usageOutbox.record({ event_type: 'app_shutdown', event_status: 'completed' });
    } catch { /* ignore */ }
}

// ── Operational telemetry (layer B) ──────────────────────────────────────────
//
// WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM THE LEDGER ABOVE
//
// `operational_telemetry_events` shipped on 2026-08-14 with a migration, a
// server route, an allowlist and a 45-day sweep — and NOT ONE EMITTER. Nothing
// in this application ever called `usageOutbox.recordTelemetry`, so the table
// could only ever hold rows written by the live E2E harness. Turning
// OPS_TELEMETRY_ENABLED on changed nothing, because "enabled" and "emitting"
// are different facts and only one of them had been built.
//
// The source is the AnswerTrace the answer pipeline already produces per turn —
// no new instrumentation on the answer path, which is the same argument
// rollout-metrics makes for deriving its counters from the same object.
//
// PRIVACY. Everything below is a count, a duration, an enum or an identifier.
// The trace itself is redacted at construction and carries evidence IDENTITY
// rather than content; this maps only its numeric and enum fields, and the
// server's allowlist independently refuses anything with a space in it.

/** The server's IDENT charset. Anything outside it is refused, not stripped. */
const IDENT_RE = /^[A-Za-z0-9_.:@/-]{1,64}$/;

/**
 * Coerce to something the server allowlist will accept, or drop it.
 *
 * Dropping beats sending a mangled value: a truncated model name that no longer
 * matches any real model is worse than an absent one, because it reads as data.
 */
function identOrUndefined(v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    if (!t) return undefined;
    const cleaned = t.replace(/[^A-Za-z0-9_.:@/-]/g, '_').slice(0, 64);
    return IDENT_RE.test(cleaned) ? cleaned : undefined;
}

function finiteInt(v: unknown): number | undefined {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/**
 * TraceStatus → ledger status.
 *
 * SUPERSEDED must NOT become `completed`. A superseded turn is one the pipeline
 * abandoned because a newer question arrived — counting it as a completion
 * inflates every rate computed from this table, and with auto-answer running on
 * interims those turns are not rare. `interrupted` exists for exactly this.
 */
const TRACE_STATUS_TO_EVENT_STATUS: Record<string, UsageEventInput['event_status']> = {
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    SUPERSEDED: 'interrupted',
};

/**
 * Emit one operational-telemetry event for a completed turn.
 *
 * Never throws — this runs on the live answer path, and the rule the whole
 * observability layer is built on is that a monitoring defect degrades the
 * metric, never the answer.
 */
export function recordTurnTelemetry(trace: unknown): void {
    try {
        if (!trace || typeof trace !== 'object') return;
        const t = trace as Record<string, any>;

        const status = TRACE_STATUS_TO_EVENT_STATUS[String(t.status)] ?? 'completed';
        const latency = (t.latency ?? {}) as Record<string, unknown>;

        const attempts: any[] = Array.isArray(t.retrievalAttempts) ? t.retrievalAttempts : [];
        const candidates = attempts.reduce((n, a) => n + (finiteInt(a?.candidateCount) ?? 0), 0);
        const accepted = Array.isArray(t.acceptedEvidence) ? t.acceptedEvidence.length : 0;

        // The dominant accepted source type, not a list: metadata values may not
        // be arrays, and "which kind of knowledge answered this" is the question
        // a 45-day diagnostics table is actually asked.
        const tally = new Map<string, number>();
        for (const e of (Array.isArray(t.acceptedEvidence) ? t.acceptedEvidence : [])) {
            const k = identOrUndefined(e?.sourceType);
            if (k) tally.set(k, (tally.get(k) ?? 0) + 1);
        }
        let dominant = 'none';
        let best = 0;
        for (const [k, n] of tally) if (n > best) { dominant = k; best = n; }

        // ONLY MEASURED VALUES. The first version of this shipped
        // llm_ttfb_ms, context_build_duration_ms and reranking_used, and all
        // three were structurally impossible to measure at the emit point:
        // 173 production rows carried 0/0/false without a single one of them
        // being an observation. A measurement-shaped non-measurement is worse
        // than an absent field, because a reader averages it.
        //
        // What is left is measured in orchestrate(): the retrieval span, the
        // candidate and accepted counts, and the dominant source type.
        //
        // At most 8 keys are accepted and an overflow REJECTS THE WHOLE EVENT,
        // which the outbox then drops permanently as a poison row. Four keys,
        // four spare.
        const metadata: Record<string, string | number | boolean> = {
            selected_source_count: accepted,
            knowledge_source_type: dominant,
        };
        const retrievalMs = finiteInt(latency.retrievalMs);
        if (retrievalMs !== undefined) metadata.retrieval_ms = retrievalMs;
        const classifyMs = finiteInt(latency.classificationMs);
        if (classifyMs !== undefined) metadata.classification_ms = classifyMs;

        const input: UsageEventInput = {
            event_type: status === 'failed' ? 'retrieval_failed' : 'retrieval_completed',
            event_status: status,
            reported_count: candidates,
            metadata,
        };
        // NAMING COLLISION, READ THIS BEFORE JOINING THE TWO TABLES.
        // This is ORCHESTRATION time — resolve + classify + retrieve — and it
        // ends before the prompt is composed or the provider is called. The
        // ledger's reported_duration_ms, written by runTracked(), is the WHOLE
        // handler including the LLM: in production the ledger median is ~4.6s
        // and p95 ~30s, roughly an order of magnitude larger. Same column name,
        // two tables, two different things.
        const totalMs = finiteInt(latency.totalMs);
        if (totalMs !== undefined) input.reported_duration_ms = totalMs;

        // provider/model are NOT set, and that is not an omission. This event
        // is emitted from a trace finalized before any provider call, so
        // providerAttempts is always empty (see orchestrator.ts). The first
        // version read it anyway and wrote NULL on 100% of 173 rows. Attribute
        // the provider where the provider call actually completes, or not at
        // all.
        // Correlates this row with the rest of the turn inside the telemetry
        // table. Not the raw question, and not a licence identifier — the server
        // resolves the licence from auth and refuses a client-chosen one.
        const reqId = identOrUndefined(t.requestId);
        if (reqId) input.feature_session_id = reqId;

        usageOutbox.recordTelemetry(input);
    } catch { /* observability only */ }
}
