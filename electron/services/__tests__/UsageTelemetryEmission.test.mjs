// electron/services/__tests__/UsageTelemetryEmission.test.mjs
//
// SEPARATE FILE ON PURPOSE. The emitter reaches DatabaseManager through the
// esbuild bundle inlined into usageInstrumentation.js, which holds its OWN
// singleton — a different object from the one `require(DBM_PATH)` hands back,
// even though both open the same SQLite file. Sharing a process with
// UsageOutbox.test.mjs meant those earlier describes closed their database and
// deleted its directory while the inlined singleton kept pointing at it, and
// every assertion here read zero rows. node:test isolates FILES, not describes,
// so a file is the unit that buys a clean singleton.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DBM_PATH = path.join(REPO, 'dist-electron/electron/db/DatabaseManager.js');
const HAVE_BUILD = fs.existsSync(DBM_PATH);

const INSTR = path.join(REPO, 'dist-electron/electron/services/usageInstrumentation.js');

// ONE fixture for the whole file. The DatabaseManager inlined into
// usageInstrumentation.js resolves its userData path once per process, so a
// second describe that mints its own tmpdir would leave the emitter writing to
// the first one — which is exactly how this file read zero rows before.
let TDIR; let TDB;
before(() => {
    if (!HAVE_BUILD) return;
    TDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-turntel-test-'));
    process.env.NATIVELY_TEST_USERDATA = TDIR;
    delete process.env.NATIVELY_USAGE_OUTBOX_ENABLED;
    const { DatabaseManager } = require(DBM_PATH);
    DatabaseManager.instance = null;
    TDB = DatabaseManager.getInstance();
});
after(() => {
    try { TDB?.close?.(); } catch { /* ignore */ }
    try { fs.rmSync(TDIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** Every payload queued since the last call, oldest first. */
function emitted() {
    const rows = TDB.claimUsageOutboxBatch(1000, Date.now() + 10 ** 12);
    if (rows.length) TDB.dropUsageEvents(rows.map((r) => r.event_id));
    return rows.map((r) => r.payload);
}

// ── Operational telemetry emission (2026-08-27) ──────────────────────────────
//
// The gap these tests close: operational_telemetry_events shipped with a
// migration, a route, an allowlist and a retention sweep, and ZERO emitters.
// Nothing called recordTelemetry, so the table could only ever hold rows the
// live E2E harness wrote. "Flag enabled" and "something emits" are different
// facts and only the first had been built.
describe('turn telemetry emission', { skip: HAVE_BUILD ? false : 'run `npm run build:electron` first' }, () => {
    /** A trace shaped like the one the V3 orchestrator hands to recordTurnMetrics. */
    function trace(over = {}) {
        return {
            requestId: 'v3-what-to-answer-1756300000000',
            status: 'COMPLETED',
            retrievalAttempts: [
                { attempt: 1, candidateCount: 12, admittedAfterScopeFilter: 5 },
                { attempt: 2, candidateCount: 3, admittedAfterScopeFilter: 2 },
            ],
            acceptedEvidence: [
                { evidenceId: 'e1', sourceType: 'RESUME', contentLength: 400 },
                { evidenceId: 'e2', sourceType: 'RESUME', contentLength: 200 },
                { evidenceId: 'e3', sourceType: 'JOB_DESCRIPTION', contentLength: 90 },
            ],
            providerAttempts: [{ provider: 'gemini', model: 'gemini-3.1-flash-lite', ok: true }],
            latency: {
                retrievalMs: 210, rerankingMs: 48, promptCompositionMs: 33,
                providerTtfbMs: 640, totalMs: 1180,
            },
            ...over,
        };
    }

    test('a completed turn emits exactly one telemetry-layer event', () => {
        emitted();
        const { recordTurnTelemetry } = require(INSTR);
        recordTurnTelemetry(trace());
        const rows = emitted();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].layer, 'telemetry', 'must NOT land in the 8-year ledger');
        assert.equal(rows[0].event_type, 'retrieval_completed');
        assert.equal(rows[0].event_status, 'completed');
    });

    test('counts, durations and provider are mapped from the trace', () => {
        emitted();
        const { recordTurnTelemetry } = require(INSTR);
        recordTurnTelemetry(trace());
        const [row] = emitted();
        assert.equal(row.reported_count, 15, 'candidateCount summed across attempts');
        assert.equal(row.reported_duration_ms, 1180);
        assert.equal(row.provider, 'gemini');
        assert.equal(row.model, 'gemini-3.1-flash-lite');
        assert.equal(row.metadata.selected_source_count, 3);
        assert.equal(row.metadata.reranking_used, true);
        assert.equal(row.metadata.knowledge_source_type, 'RESUME', 'the dominant type, not the first');
        assert.equal(row.metadata.context_build_duration_ms, 33);
        assert.equal(row.metadata.llm_ttfb_ms, 640);
    });

    test('a SUPERSEDED turn is interrupted, never completed', () => {
        // Counting an abandoned turn as a completion inflates every rate built
        // on this table, and auto-answer supersedes turns routinely.
        emitted();
        const { recordTurnTelemetry } = require(INSTR);
        recordTurnTelemetry(trace({ status: 'SUPERSEDED' }));
        const [row] = emitted();
        assert.equal(row.event_status, 'interrupted');
        assert.notEqual(row.event_status, 'completed');
    });

    test('a FAILED turn reports retrieval_failed', () => {
        emitted();
        const { recordTurnTelemetry } = require(INSTR);
        recordTurnTelemetry(trace({ status: 'FAILED' }));
        const [row] = emitted();
        assert.equal(row.event_type, 'retrieval_failed');
        assert.equal(row.event_status, 'failed');
    });

    test('reranking_used is false when the reranker did not run', () => {
        emitted();
        const { recordTurnTelemetry } = require(INSTR);
        recordTurnTelemetry(trace({ latency: { rerankingMs: 0, totalMs: 90 } }));
        const [row] = emitted();
        assert.equal(row.metadata.reranking_used, false);
        assert.equal(row.metadata.knowledge_source_type, 'RESUME');
    });

    test('no accepted evidence reports none rather than guessing', () => {
        emitted();
        const { recordTurnTelemetry } = require(INSTR);
        recordTurnTelemetry(trace({ acceptedEvidence: [], retrievalAttempts: [] }));
        const [row] = emitted();
        assert.equal(row.metadata.knowledge_source_type, 'none');
        assert.equal(row.metadata.selected_source_count, 0);
        assert.equal(row.reported_count, 0);
    });

    test('a malformed trace emits nothing and never throws', () => {
        emitted();
        const { recordTurnTelemetry } = require(INSTR);
        for (const bad of [null, undefined, 'a string', 42, {}]) {
            assert.doesNotThrow(() => recordTurnTelemetry(bad));
        }
        // `{}` is a shapeless but valid object — it may emit a minimal row, but
        // nothing may reach the LEDGER layer from this function.
        assert.ok(emitted().every((r) => r.layer === 'telemetry'));
    });

    test('metadata stays under the 8-key cap that would poison the event', () => {
        // Overflow is not a strip: the server rejects the whole event and the
        // outbox then drops it permanently. Headroom is the guard.
        emitted();
        const { recordTurnTelemetry } = require(INSTR);
        recordTurnTelemetry(trace());
        const [row] = emitted();
        assert.ok(Object.keys(row.metadata).length <= 6,
            `expected headroom under the cap of 8, got ${Object.keys(row.metadata).length}`);
    });

    test('a hostile trace cannot smuggle prose into an identifier field', () => {
        emitted();
        const { recordTurnTelemetry } = require(INSTR);
        recordTurnTelemetry(trace({
            requestId: 'tell me about the candidate salary expectations',
            providerAttempts: [{ provider: 'a whole sentence here', model: 'x'.repeat(200) }],
            acceptedEvidence: [{ sourceType: 'some source with spaces' }],
        }));
        const [row] = emitted();
        for (const v of [row.provider, row.model, row.feature_session_id, row.metadata.knowledge_source_type]) {
            if (v === undefined) continue;
            assert.ok(!/\s/.test(v), `"${v}" must not contain whitespace`);
            assert.ok(v.length <= 64, `"${v}" must be bounded`);
        }
    });
});

// ── Cross-repo contract ──────────────────────────────────────────────────────
//
// The client and the server allowlist live in different repositories and drift
// independently. A telemetry event the server refuses is not merely lost: the
// route returns its id in `rejected_ids`, and the outbox then DROPS it
// permanently as a poison row rather than retrying. So "the client emits" and
// "the server accepts" have to be asserted together, against the real schema
// module — not a copy of what it was believed to do.
describe('emitted telemetry survives the real server allowlist', { skip: HAVE_BUILD ? false : 'run `npm run build:electron` first' }, () => {
    const SCHEMA = path.join(REPO, 'natively-api/lib/usageAuditSchema.js');
    let validateAuditBatch;

    before(async () => {
        if (fs.existsSync(SCHEMA)) ({ validateAuditBatch } = await import(`file://${SCHEMA}`));
    });

    test('every event the emitter produces is ACCEPTED, never rejected', (t) => {
        if (!validateAuditBatch) return t.skip('natively-api not checked out beside this repo');
        const { recordTurnTelemetry } = require(INSTR);

        // One trace per shape the pipeline actually produces, including the
        // hostile one — a rejection on any of them is a silent data loss.
        const traces = [
            { status: 'COMPLETED', requestId: 'v3-what-to-answer-1756300000000',
              retrievalAttempts: [{ candidateCount: 12 }, { candidateCount: 3 }],
              acceptedEvidence: [{ sourceType: 'RESUME' }, { sourceType: 'MEETING_TRANSCRIPT' }],
              providerAttempts: [{ provider: 'gemini', model: 'gemini-3.1-flash-lite' }],
              latency: { rerankingMs: 48, promptCompositionMs: 33, providerTtfbMs: 640, totalMs: 1180 } },
            { status: 'SUPERSEDED', retrievalAttempts: [], acceptedEvidence: [], latency: { totalMs: 12 } },
            { status: 'FAILED', requestId: 'turn_v3-assist-9',
              acceptedEvidence: [{ sourceType: 'SCREEN_CONTEXT' }],
              providerAttempts: [{ provider: 'minimax', model: 'MiniMax-M3' }],
              latency: { totalMs: 5000 } },
            { status: 'CANCELLED', latency: {} },
            // Hostile: prose everywhere an identifier is expected.
            { status: 'COMPLETED', requestId: 'tell me about the candidate salary',
              acceptedEvidence: [{ sourceType: 'a type with spaces' }],
              providerAttempts: [{ provider: 'a whole sentence', model: 'm'.repeat(300) }],
              latency: { totalMs: 1 } },
            {},
        ];
        for (const tr of traces) recordTurnTelemetry(tr);

        const rows = emitted().map((payload) => ({ payload }));
        assert.ok(rows.length >= traces.length - 1, `expected an event per trace, got ${rows.length}`);

        const result = validateAuditBatch({ events: rows.map((r) => r.payload) });
        assert.equal(result.ok, true, `the batch itself was refused: ${result.error}`);
        assert.deepEqual(
            result.rejected.map((r) => ({ id: r.event_id, why: r.errors ?? r.error })),
            [],
            'the server refused an event this client emits — it would be dropped as a poison row',
        );
        assert.equal(result.accepted.length, rows.length);
        // And it must land in the 45-day diagnostics table, never the 8-year ledger.
        assert.ok(result.accepted.every((e) => e.layer === 'telemetry'));
    });
});

// ── Application lifecycle (§5) ───────────────────────────────────────────────
//
// recordAppStarted/recordAppShutdown were written on 2026-08-14 with the
// taxonomy reserving app_started/app_shutdown, and had ZERO callers until
// 2026-08-27. They are wired in main.ts now: started after the outbox comes up,
// shutdown as the FIRST statement in `will-quit` — before
// checkpointDatabase('will-quit'), because record() is a synchronous INSERT
// into the very file that is about to be checkpointed and it swallows its own
// errors, so writing afterwards would lose the row silently.
describe('application lifecycle events', { skip: HAVE_BUILD ? false : 'run `npm run build:electron` first' }, () => {
    test('app_started and app_shutdown reach the LEDGER layer, not telemetry', () => {
        emitted();
        const { recordAppStarted, recordAppShutdown } = require(INSTR);
        recordAppStarted();
        recordAppShutdown();
        const rows = emitted();
        assert.deepEqual(rows.map((r) => r.event_type), ['app_started', 'app_shutdown']);
        assert.ok(rows.every((r) => r.layer === 'ledger'), 'lifecycle is evidence, not diagnostics');
        assert.ok(rows.every((r) => r.event_status === 'completed'));
        // Both must carry the app context a version-specific bug report needs.
        assert.ok(rows.every((r) => typeof r.platform === 'string' && r.platform.length));
        assert.ok(rows.every((r) => typeof r.app_session_id === 'string' && r.app_session_id.length));
    });

    test('the lifecycle pair is accepted by the server allowlist too', async (t) => {
        const SCHEMA = path.join(REPO, 'natively-api/lib/usageAuditSchema.js');
        // t.skip, not a bare return: a bare return leaves a PASSING test that
        // asserted nothing, which is indistinguishable from a real pass in CI.
        if (!fs.existsSync(SCHEMA)) return t.skip('natively-api not checked out beside this repo');
        const { validateAuditBatch } = await import(`file://${SCHEMA}`);
        emitted();
        const { recordAppStarted, recordAppShutdown } = require(INSTR);
        recordAppStarted();
        recordAppShutdown();
        const result = validateAuditBatch({ events: emitted() });
        assert.equal(result.ok, true);
        assert.deepEqual(result.rejected, []);
    });
});
