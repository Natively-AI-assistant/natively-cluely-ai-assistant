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
