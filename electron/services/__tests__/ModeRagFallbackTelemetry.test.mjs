// electron/services/__tests__/ModeRagFallbackTelemetry.test.mjs
//
// Regression for FIX-007: when the retriever falls back to lexical-only
// (embedding provider unavailable, hybrid path throws, or DB unavailable),
// it must emit a `rag_lexical_fallback` telemetry event in addition to the
// existing console.warn. The event must be throttled (≤1 per (modeId,
// reason) per 60s) so a 1-hour meeting can't produce thousands of identical
// log lines.
//
// We observe the JSONL log the bundled instance actually writes (each
// dist-electron entry-point has its own bundled telemetry singleton —
// stubbing the standalone one doesn't reach the retriever's bundle). To
// avoid cross-test interference we set NATIVELY_TELEMETRY_TEST_RUN_ID
// before importing the bundle; the retriever stamps that id onto every
// fallback event and the test filters by it.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Stamp this run BEFORE importing the bundled retriever so the env-var read
// inside the bundle sees the id.
const RUN_ID = `test-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
process.env.NATIVELY_TELEMETRY_TEST_RUN_ID = RUN_ID;

const hybridMod = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js')).href
);
const { ModeHybridRetriever } = hybridMod;

const TELEMETRY_LOG = path.join(process.cwd(), 'logs', 'telemetry.jsonl');

function readNewLines(startOffset) {
  if (!fs.existsSync(TELEMETRY_LOG)) return [];
  const buf = fs.readFileSync(TELEMETRY_LOG);
  if (buf.length <= startOffset) return [];
  return buf
    .subarray(startOffset)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function fallbackEventsSinceOffset(startOffset) {
  return readNewLines(startOffset).filter(e =>
    e?.name === 'rag_lexical_fallback' && e?.properties?.testRunId === RUN_ID
  );
}

let logOffset = 0;
beforeEach(() => {
  logOffset = fs.existsSync(TELEMETRY_LOG) ? fs.statSync(TELEMETRY_LOG).size : 0;
  // Reset the static throttle cache between tests so each test starts clean.
  ModeHybridRetriever.__resetFallbackThrottleForTests();
});

function makeRetriever({ embeddingReady = false, throwOnEmbed = false } = {}) {
  const db = {
    exec: () => {},
    prepare: () => ({ get: () => null, run: () => {}, all: () => [] }),
  };
  const vectorStore = {};
  const embeddingPipeline = {
    isReady: () => embeddingReady,
    getEmbedding: async () => { if (throwOnEmbed) throw new Error('synthetic embedding failure'); return [0, 0, 0]; },
    getEmbeddingForQuery: async () => { if (throwOnEmbed) throw new Error('synthetic query embedding failure'); return [0, 0, 0]; },
  };
  return new ModeHybridRetriever(db, vectorStore, embeddingPipeline);
}

const FILES = [
  {
    id: 'ref_1',
    modeId: 'mode_x',
    fileName: 'doc.md',
    content: 'Sarah owns the launch checklist and must deliver it by Friday.',
    createdAt: '2026-05-15T00:00:00.000Z',
  },
];

describe('FIX-007: Lexical-fallback telemetry', () => {
  test("emits 'rag_lexical_fallback' with reason=embedding_unavailable when provider not ready", async () => {
    const retriever = makeRetriever({ embeddingReady: false });
    await retriever.retrieve({
      query: 'who owns the launch checklist',
      modeId: 'mode_x',
      files: FILES,
    });
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 1);
    assert.equal(events[0].modeId, 'mode_x');
    assert.equal(events[0].properties.reason, 'embedding_unavailable');
    assert.equal(typeof events[0].properties.candidateCount, 'number');
    assert.equal(typeof events[0].properties.queryTokenCount, 'number');
  });

  test("emits 'rag_lexical_fallback' with reason=hybrid_threw when embedding pipeline throws", async () => {
    const retriever = makeRetriever({ embeddingReady: true, throwOnEmbed: true });
    await retriever.retrieve({
      query: 'who owns the launch checklist',
      modeId: 'mode_x',
      files: FILES,
    });
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 1);
    assert.equal(events[0].properties.reason, 'hybrid_threw');
    assert.equal(typeof events[0].properties.errorClass, 'string');
  });

  test('does not emit fallback telemetry on the happy path', async () => {
    const retriever = makeRetriever({ embeddingReady: true, throwOnEmbed: false });
    await retriever.retrieve({
      query: 'who owns the launch checklist',
      modeId: 'mode_x',
      files: FILES,
    });
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 0);
  });

  test('throttle: 100 rapid fallback calls emit at most 1 event per (modeId, reason)', async () => {
    const retriever = makeRetriever({ embeddingReady: false });
    for (let i = 0; i < 100; i++) {
      await retriever.retrieve({
        query: 'who owns the launch checklist',
        modeId: 'mode_x',
        files: FILES,
      });
    }
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 1, `Throttle must collapse 100 calls into 1 event. Got ${events.length}.`);
  });

  test('static helper: db_unavailable path is throttled the same way', () => {
    const before = fs.existsSync(TELEMETRY_LOG) ? fs.statSync(TELEMETRY_LOG).size : 0;
    for (let i = 0; i < 50; i++) {
      ModeHybridRetriever.emitFallbackTelemetryStatic({
        reason: 'db_unavailable',
        modeId: 'mode_db_throttle',
      });
    }
    const events = readNewLines(before).filter(
      e => e?.name === 'rag_lexical_fallback' &&
           e?.properties?.testRunId === RUN_ID &&
           e?.modeId === 'mode_db_throttle' &&
           e?.properties?.reason === 'db_unavailable'
    );
    assert.equal(events.length, 1, `db_unavailable static emitter must throttle. Got ${events.length} events for 50 calls.`);
  });

  test('throttle keys on (modeId, reason): different modeIds emit independently', async () => {
    const retriever = makeRetriever({ embeddingReady: false });
    for (const id of ['mode_a', 'mode_b', 'mode_a', 'mode_b']) {
      await retriever.retrieve({ query: 'who owns', modeId: id, files: FILES });
    }
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 2, 'Throttle must allow one event per distinct modeId');
    const modeIds = new Set(events.map(e => e.modeId));
    assert.deepEqual([...modeIds].sort(), ['mode_a', 'mode_b']);
  });

  test('telemetry payload carries no raw query / chunk / transcript content (redaction guard)', async () => {
    const retriever = makeRetriever({ embeddingReady: false });
    await retriever.retrieve({
      query: 'secret-customer-Acme target $185k base salary BATNA',
      modeId: 'mode_x',
      files: FILES,
    });
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 1);
    const serialized = JSON.stringify(events[0]);
    assert.ok(!serialized.includes('Acme'), `Telemetry must not carry customer name. Got:\n${serialized}`);
    assert.ok(!serialized.includes('BATNA'), 'Telemetry must not carry negotiation context');
    assert.ok(!serialized.includes('Sarah'), 'Telemetry must not carry chunk content');
  });

  test('redaction: extended SENSITIVE_KEY_RE drops query / chunk / userInput / errorMessage values', async () => {
    // We exercise TelemetryService directly to confirm the regex changes.
    // We do NOT use the bundled instance here because the assertion is on
    // the redactor itself, not the retriever path.
    const tmod = await import(
      pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/telemetry/TelemetryService.js')).href
    );
    const { telemetryService } = tmod;
    const offsetBefore = fs.existsSync(TELEMETRY_LOG) ? fs.statSync(TELEMETRY_LOG).size : 0;
    telemetryService.track({
      name: 'rag_lexical_fallback',
      modeId: 'mode_redact',
      properties: {
        testRunId: RUN_ID,
        query: 'should NOT be present in log',
        queryText: 'should NOT be present',
        userInput: 'should NOT be present',
        chunkText: 'should NOT be present',
        snippetText: 'should NOT be present',
        errorMessage: 'sensitive error: should NOT be present',
        userMessage: 'should NOT be present',
      },
    });
    const newEvents = readNewLines(offsetBefore).filter(e => e?.modeId === 'mode_redact');
    assert.equal(newEvents.length, 1);
    const serialized = JSON.stringify(newEvents[0]);
    assert.ok(!serialized.includes('should NOT be present'),
      `Redactor must remove query/userInput/chunk/snippet/errorMessage values. Got:\n${serialized}`);
  });
});
