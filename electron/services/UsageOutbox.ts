/**
 * Durable delivery of client-reported usage events (Usage Ledger, phase 4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * When a customer supplies their own provider key, Natively's backend executes
 * nothing on their behalf and can therefore meter nothing. There is no
 * server-side observation of BYOK feature use to be had. The only signal that a
 * feature ran is this client saying so — which makes a dropped event not a gap
 * in telemetry but the entire record of that session, gone.
 *
 * That is why this is a durable SQLite queue and not `fetch(...).catch(() => {})`.
 * The event is written to disk BEFORE any network attempt, so it survives:
 * network loss, app restart, sleep/wake, OS restart, a server outage, and a
 * crash mid-flush.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY DOES NOT CLAIM
 *
 * These events are `client_reported` — the weakest provenance in the system, and
 * the server labels them that way regardless of what this file sends. A user who
 * modifies the desktop app can disable this dispatcher, block the endpoint, or
 * fabricate counts. None of that is preventable from inside the client, and none
 * of it is worth pretending otherwise: the honest response is a separate
 * provenance, which is what the ledger has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANTS
 *
 *   1. Never on a feature's critical path. `record()` does one INSERT OR IGNORE
 *      and returns. No network, no await for the caller.
 *   2. Never throws into a caller. Every entry point is wrapped. An audit bug
 *      must not be able to fail a meeting.
 *   3. Inert unless enabled. Two flags, checked per call.
 *   4. Bounded. 10,000 rows / oldest-undelivered dropped past the cap, counted.
 *   5. No content. Only identifiers, enums, counts and durations — the server
 *      allowlist rejects anything else, and this file must never try to send it.
 */

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { DatabaseManager } from '../db/DatabaseManager';

/**
 * Install id, resolved lazily.
 *
 * NOT a static import of `getOrCreateInstallId`. InstallPingManager computes
 * `path.join(app.getPath('userData'), …)` at MODULE LOAD time, so importing it
 * at the top of this file would make merely requiring UsageOutbox throw
 * "Cannot read properties of undefined (reading 'getPath')" in any context
 * without a ready Electron app — the test runner under ELECTRON_RUN_AS_NODE,
 * and any tooling that loads this module for inspection.
 *
 * Deferring it to first use matches how HindsightManager already reaches that
 * module, and keeps this file loadable everywhere. Cached because the id never
 * changes within a process.
 */
let _installId: string | null = null;
function installId(): string | undefined {
    if (_installId) return _installId;
    try {
        const { getOrCreateInstallId } = require('./InstallPingManager');
        _installId = getOrCreateInstallId();
        return _installId ?? undefined;
    } catch {
        // No install id is survivable: the server resolves the licence from
        // auth, and install_id only distinguishes machines under one licence.
        return undefined;
    }
}

const NATIVELY_API_URL = (process.env.NATIVELY_API_URL || 'https://api.natively.software').replace(/\/+$/, '');

const DISPATCH_INTERVAL_MS = 30_000;
const BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10_000;
// F5 (code-review 2026-08-14): 12 attempts × the 1h-capped backoff exhausted
// an event in ~6.1 hours of continuous failure — deleting "the entire record
// of that session" (this header's own words) faster than a weekend outage or
// a lapsed licence could plausibly resolve, and directly contradicting the
// 401 comment below ("the user may paste a valid key later"). 360 attempts at
// the 1h cap ≈ 15 days of retrying while the app is open, matching the
// durability window the header promises. Unbounded growth is NOT the cost:
// the 10k row cap + delivered-first eviction in enqueueUsageEvent is the real
// storage bound; attempt exhaustion only needs to stop infinite retry churn.
const MAX_ATTEMPTS = 360;
const COMPACT_EVERY_MS = 6 * 60 * 60 * 1000;

/** Exponential backoff with jitter, capped at 1h. Index is attempt_count. */
const BACKOFF_MS = [
    30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000,
    20 * 60_000, 30 * 60_000, 60 * 60_000,
];

export type UsageLayer = 'ledger' | 'telemetry';

export interface UsageEventInput {
    event_type: string;
    event_status?: 'started' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
    feature?: string;
    provider?: string;
    model?: string;
    reported_count?: number;
    reported_duration_ms?: number;
    reported_tokens?: number;
    failure_origin?: string;
    failure_code?: string;
    app_session_id?: string;
    feature_session_id?: string;
    session_id?: string;
    metadata?: Record<string, string | number | boolean>;
}

/**
 * One app session per process launch (§16).
 *
 * Generated here rather than read from anywhere because "this run of the
 * application" has no other identifier, and inventing a fake session where a
 * real one exists is what §16 warns against — there is no real one at this level.
 */
const APP_SESSION_ID = randomUUID();

export function getAppSessionId(): string {
    return APP_SESSION_ID;
}

export class UsageOutbox {
    private static instance: UsageOutbox | null = null;
    private timer: NodeJS.Timeout | null = null;
    private compactTimer: NodeJS.Timeout | null = null;
    private dispatching = false;
    private getApiKey: (() => string | undefined) | null = null;

    private droppedLocal = 0;
    private deliveredTotal = 0;
    private rejectedTotal = 0;
    private failedAttempts = 0;

    public static getInstance(): UsageOutbox {
        if (!UsageOutbox.instance) UsageOutbox.instance = new UsageOutbox();
        return UsageOutbox.instance;
    }

    /**
     * Both flags must be on. The client half is separately switchable from the
     * server half so a bad client release can be silenced server-side without a
     * client update, and a client can stop emitting without a server change.
     */
    public isEnabled(): boolean {
        const v = process.env.NATIVELY_USAGE_OUTBOX_ENABLED;
        return v === '1' || v === 'true';
    }

    /**
     * @param getApiKey resolves the Natively API key at DISPATCH time, not at
     * start time — a user who pastes their key after launch must not need a
     * restart before their queued events can drain.
     */
    public start(getApiKey: () => string | undefined): void {
        try {
            this.getApiKey = getApiKey;
            if (!this.isEnabled()) return;
            if (this.timer) return;
            this.timer = setInterval(() => { void this.dispatchOnce(); }, DISPATCH_INTERVAL_MS);
            this.timer.unref?.();
            // Compact ONCE at startup, not only every COMPACT_EVERY_MS. A desktop
            // session shorter than the interval otherwise never compacts at all,
            // so delivered rows accumulate across sessions until they fill the
            // enqueue cap — which is a real event-loss path, not just disk use.
            try { DatabaseManager.getInstance().compactUsageOutbox(); } catch { /* best effort */ }
            this.compactTimer = setInterval(() => {
                try { DatabaseManager.getInstance().compactUsageOutbox(); } catch { /* best effort */ }
            }, COMPACT_EVERY_MS);
            this.compactTimer.unref?.();
            console.log('[UsageOutbox] enabled — dispatching every', DISPATCH_INTERVAL_MS / 1000, 's');
        } catch (e: any) {
            console.warn('[UsageOutbox] start failed:', e?.message || e);
        }
    }

    public stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.compactTimer) { clearInterval(this.compactTimer); this.compactTimer = null; }
    }

    /**
     * Persist one event. Synchronous, bounded, never throws.
     *
     * The event_id is generated here and is the idempotency key end to end: the
     * local table's PRIMARY KEY, the server's UNIQUE(event_id), and the upsert's
     * onConflict target are all the same value, so a duplicate at any layer
     * collapses to one logical event.
     */
    public record(input: UsageEventInput, layer: UsageLayer = 'ledger'): string {
        try {
            if (!this.isEnabled()) return 'disabled';
            const eventId = randomUUID();
            const payload = {
                event_id: eventId,
                layer,
                event_type: input.event_type,
                ...(input.event_status ? { event_status: input.event_status } : {}),
                ...(input.feature ? { feature: input.feature } : {}),
                ...(input.provider ? { provider: input.provider } : {}),
                ...(input.model ? { model: input.model } : {}),
                ...(Number.isInteger(input.reported_count) ? { reported_count: input.reported_count } : {}),
                ...(Number.isInteger(input.reported_duration_ms) ? { reported_duration_ms: input.reported_duration_ms } : {}),
                ...(Number.isInteger(input.reported_tokens) ? { reported_tokens: input.reported_tokens } : {}),
                ...(input.failure_origin ? { failure_origin: input.failure_origin } : {}),
                ...(input.failure_code ? { failure_code: input.failure_code } : {}),
                // The client's CLAIM about when this happened. The server keeps
                // its own timestamp as authoritative and stores this beside it;
                // it is never a substitute for server time.
                client_event_ts: new Date().toISOString(),
                app_version: app?.getVersion?.() ?? undefined,
                platform: process.platform,
                install_id: installId(),
                app_session_id: input.app_session_id ?? APP_SESSION_ID,
                ...(input.feature_session_id ? { feature_session_id: input.feature_session_id } : {}),
                ...(input.session_id ? { session_id: input.session_id } : {}),
                ...(input.metadata ? { metadata: input.metadata } : {}),
                schema_version: 1,
                client_telemetry_version: '1',
            };
            const r = DatabaseManager.getInstance().enqueueUsageEvent(eventId, layer, payload);
            if (r === 'dropped') this.droppedLocal++;
            return r;
        } catch (e: any) {
            console.warn('[UsageOutbox] record failed:', e?.message || e);
            return 'error';
        }
    }

    /** Convenience for §17's pipeline diagnostics — Layer B, never evidence. */
    public recordTelemetry(input: UsageEventInput): string {
        return this.record(input, 'telemetry');
    }

    private backoffFor(attempt: number): number {
        const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        // Jitter so a fleet of clients that all lost connectivity at the same
        // moment does not return as a synchronised thundering herd.
        return Date.now() + base + Math.floor(Math.random() * Math.min(base, 30_000));
    }

    /**
     * Attempt one batch. Safe to call concurrently — the `dispatching` guard
     * makes overlapping timer ticks a no-op rather than a double-send.
     */
    public async dispatchOnce(): Promise<{ sent: number; delivered: number; rejected: number; skipped?: string }> {
        if (this.dispatching) return { sent: 0, delivered: 0, rejected: 0, skipped: 'in_flight' };
        this.dispatching = true;
        try {
            if (!this.isEnabled()) return { sent: 0, delivered: 0, rejected: 0, skipped: 'disabled' };
            const apiKey = this.getApiKey?.();
            // No key means no authenticated identity, and the server resolves the
            // licence from auth. Events stay queued rather than being sent
            // unattributable — a row that cannot be tied to a licence is not
            // evidence of anything.
            if (!apiKey) return { sent: 0, delivered: 0, rejected: 0, skipped: 'no_api_key' };

            const db = DatabaseManager.getInstance();
            const batch = db.claimUsageOutboxBatch(BATCH_SIZE);
            if (batch.length === 0) return { sent: 0, delivered: 0, rejected: 0 };

            // Give up on an event that has failed this many times. Keeping it
            // forever would block nothing (the queue is not ordered) but would
            // occupy a slot under the cap that a fresh event could use.
            const exhausted = batch.filter((b) => b.attempt_count >= MAX_ATTEMPTS).map((b) => b.event_id);
            if (exhausted.length) {
                db.dropUsageEvents(exhausted);
                this.droppedLocal += exhausted.length;
            }
            const live = batch.filter((b) => b.attempt_count < MAX_ATTEMPTS);
            if (live.length === 0) return { sent: 0, delivered: 0, rejected: 0 };

            const ids = live.map((b) => b.event_id);
            let res: Response;
            try {
                res = await fetch(`${NATIVELY_API_URL}/v1/usage/audit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-natively-key': apiKey },
                    body: JSON.stringify({ events: live.map((b) => b.payload) }),
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });
            } catch (e: any) {
                this.failedAttempts++;
                db.markUsageEventsFailed(ids, this.backoffFor(live[0].attempt_count), e?.message || 'network');
                return { sent: live.length, delivered: 0, rejected: 0 };
            }

            // 401/403: the key is wrong or the licence lapsed. Retryable — the
            // user may paste a valid key later, and these events are still the
            // only record of what happened.
            // 503: ingestion is intentionally disabled server-side. Retryable by
            // design; the server returns 503 rather than 200 precisely so the
            // client keeps the events instead of ACKing them into a black hole.
            if (!res.ok) {
                this.failedAttempts++;
                db.markUsageEventsFailed(ids, this.backoffFor(live[0].attempt_count), `http_${res.status}`);
                return { sent: live.length, delivered: 0, rejected: 0 };
            }

            let body: any = null;
            try { body = await res.json(); } catch { /* a 2xx with an unreadable body still counts as delivered */ }

            // Events the server refused on schema grounds are DROPPED, not
            // retried: this server build will refuse them identically forever,
            // and retrying a poison row is how a queue wedges.
            const rejectedIds: string[] = Array.isArray(body?.rejected_ids) ? body.rejected_ids : [];
            if (rejectedIds.length) {
                db.dropUsageEvents(rejectedIds);
                this.rejectedTotal += rejectedIds.length;
            }
            const deliveredIds = ids.filter((id) => !rejectedIds.includes(id));
            db.markUsageEventsDelivered(deliveredIds);
            this.deliveredTotal += deliveredIds.length;

            return { sent: live.length, delivered: deliveredIds.length, rejected: rejectedIds.length };
        } catch (e: any) {
            console.warn('[UsageOutbox] dispatch failed:', e?.message || e);
            return { sent: 0, delivered: 0, rejected: 0, skipped: 'error' };
        } finally {
            this.dispatching = false;
        }
    }

    /** §20 health counters. Local-only; never shipped as a usage event. */
    public getStats(): Record<string, unknown> {
        let queue = { pending: 0, delivered: 0, total: 0, oldestPendingAgeMs: null as number | null };
        try { queue = DatabaseManager.getInstance().getUsageOutboxStats(); } catch { /* db unavailable */ }
        return {
            enabled: this.isEnabled(),
            appSessionId: APP_SESSION_ID,
            queue,
            deliveredTotal: this.deliveredTotal,
            rejectedTotal: this.rejectedTotal,
            droppedLocal: this.droppedLocal,
            failedAttempts: this.failedAttempts,
        };
    }

    /** Test-only. */
    public __resetForTests(): void {
        this.droppedLocal = 0;
        this.deliveredTotal = 0;
        this.rejectedTotal = 0;
        this.failedAttempts = 0;
        this.dispatching = false;
    }
}

export const usageOutbox = UsageOutbox.getInstance();
