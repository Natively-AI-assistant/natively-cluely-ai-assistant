/**
 * A partially embedded reference file must be completable (GAP-1), and the
 * indexing batch must be one upstream request (GAP-2).
 *
 * ── GAP-1: the bug this pins ────────────────────────────────────────────────
 *
 * indexFileInner embeds in sub-batches. On a mid-file failure it deliberately
 * keeps the embedded prefix, stores the tail as lexical-only, and marks the file
 * `ready` — correct, because a partly-vectorised file retrieves better than an
 * all-lexical one. Its own comment promised "a follow-up prewarm/retry can
 * complete the tail when quota frees up".
 *
 * No such follow-up could run:
 *   - ModesManager.prewarmModeReferenceIndex re-indexes only files whose status
 *     is NOT 'ready';
 *   - indexFileInner early-returned on 'ready' + matching hash + matching space.
 *
 * So one 429 mid-index left a large file permanently half-indexed, and the state
 * table had no column that could even express the condition. The fix records
 * embedded_chunk_count and treats "ready but not fully embedded" as unfinished.
 *
 * These are source-level assertions on purpose: constructing a real
 * ModeHybridRetriever needs better-sqlite3, a VectorStore, an EmbeddingPipeline
 * and a live provider, and the invariant under test is a decision rule, not an
 * I/O behaviour. The rule is what regressed, so the rule is what is pinned.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = readFileSync(path.join(repoRoot, 'electron/services/modes/ModeHybridRetriever.ts'), 'utf8');
const PIPELINE = readFileSync(path.join(repoRoot, 'electron/rag/EmbeddingPipeline.ts'), 'utf8');
const PROVIDER = readFileSync(path.join(repoRoot, 'electron/rag/providers/NativelyEmbeddingProvider.ts'), 'utf8');

describe('GAP-1 — a partial index is detectable and resumable', () => {
  test('the state table records how many chunks actually have vectors', () => {
    assert.match(SRC, /ADD COLUMN embedded_chunk_count INTEGER NOT NULL DEFAULT 0/);
    assert.match(SRC, /embedded_chunk_count FROM mode_reference_index_state WHERE file_id = \?/);
  });

  test("'ready' alone no longer skips a file — it must be FULLY embedded", () => {
    // This is the exact line that made the bug unreachable-by-repair.
    assert.match(SRC, /state\.embeddedChunkCount >= state\.chunkCount/);
    const skip = SRC.slice(SRC.indexOf('const fullyEmbedded'));
    assert.match(skip.slice(0, 600), /status === 'ready'[\s\S]{0,200}&& fullyEmbedded/);
  });

  test('the partial branch persists the count that makes it resumable', () => {
    const partial = SRC.slice(SRC.indexOf('const padded = chunks.map'));
    assert.match(partial.slice(0, 900), /updateIndexState\([^)]*'ready', embeddingSpace, embeddedCount\)/);
  });

  test('a fully embedded file records its full count, so it is still skipped', () => {
    // The fix must not cause healthy files to re-embed on every activation.
    assert.match(SRC, /updateIndexState\(file\.id, contentHash, chunks\.length, 'ready', result\.space, chunks\.length\)/);
  });

  test('a partial file reports as pending so prewarm picks it up', () => {
    // prewarmModeReferenceIndex re-indexes everything that is not 'ready';
    // reporting the true state is what lets the tail ever be completed.
    const fn = SRC.slice(SRC.indexOf('public getFileIndexStatus'));
    assert.match(fn.slice(0, 1800), /state\.embeddedChunkCount < state\.chunkCount[\s\S]{0,200}status: 'pending'/);
  });

  test('rows predating the column read as 0, which re-indexes rather than skips', () => {
    // The safe direction: at worst one redundant re-index of a complete file,
    // never a silently-unfinished one treated as done.
    assert.match(SRC, /typeof row\.embedded_chunk_count === 'number' \? row\.embedded_chunk_count : 0/);
  });

  test('every terminal state records a count (no call site left defaulting)', () => {
    // This assertion caught a real miss while it was being written: the OUTER
    // catch in indexFileInner still called updateIndexState without a count, so
    // a hard failure wrote embedded_chunk_count via the default rather than
    // explicitly. Harmless there (the default is 0, which is correct), but the
    // point of the column is that every writer states its answer.
    for (const st of ['ocr_required', 'lexical_only', 'failed']) {
      assert.ok(
        SRC.includes(`'${st}', null, 0)`),
        `${st} must record 0 embedded chunks explicitly`,
      );
    }
    assert.doesNotMatch(
      SRC,
      /updateIndexState\(file\.id, contentHash, chunks\.length, '[a-z_]+', null\)/,
      'no updateIndexState call may fall back to the default count',
    );
  });
});

describe('GAP-2 — one index sub-batch is one upstream request', () => {
  test('the provider declares its upstream per-request ceiling', () => {
    assert.match(PROVIDER, /readonly maxBatchSize = SERVER_MAX_BATCH;/);
    assert.match(PROVIDER, /const SERVER_MAX_BATCH = 32;/);
  });

  test('the indexer clamps its batch to that ceiling', () => {
    // Sending 100 to a transport that caps at 32 meant FOUR sequential requests
    // sharing the pipeline's single 30s deadline — and any one failing discarded
    // all 100 chunks rather than the 32 that failed.
    assert.match(SRC, /getActiveProviderMaxBatch\?\.\(\)/);
    assert.match(SRC, /Math\.min\(configuredBatch, providerMax\)/);
  });

  test('the inner per-request timeout is strictly below the outer batch deadline', () => {
    const inner = Number(/const REQUEST_TIMEOUT_MS = ([\d_]+);/.exec(PROVIDER)[1].replace(/_/g, ''));
    const outer = Number(/const EMBED_TIMEOUT_MS = ([\d_]+);/.exec(PIPELINE)[1].replace(/_/g, ''));
    assert.ok(inner < outer,
      `inner request timeout ${inner}ms must be < outer batch timeout ${outer}ms, or a slow request can only ever surface as the generic outer timeout`);
  });
});

describe('GAP-3 — batches are bounded by tokens, not just item count', () => {
  // planEmbedBatches is pure, so the boundary rule is testable without a
  // database, a provider or a network. The rule is what regresses.
  const load = async () => {
    const { pathToFileURL } = await import('node:url');
    const mod = path.join(repoRoot, 'dist-electron/electron/services/modes/ModeHybridRetriever.js');
    return import(pathToFileURL(mod).href);
  };

  test('a batch closes on the ITEM limit when chunks are small', async () => {
    const { planEmbedBatches } = await load();
    const chunks = Array.from({ length: 70 }, () => 'x'.repeat(100));
    const plan = planEmbedBatches(chunks, 32, 24_000);
    assert.deepEqual(plan.map(b => b.length), [32, 32, 6]);
  });

  test('a batch closes on the CHAR budget when chunks are large', async () => {
    const { planEmbedBatches } = await load();
    // 8 chunks x 5,000 chars = 40,000 — over a 24,000 budget, under 32 items.
    // A count-only batcher would send all 8 in one request.
    const chunks = Array.from({ length: 8 }, () => 'y'.repeat(5_000));
    const plan = planEmbedBatches(chunks, 32, 24_000);
    assert.ok(plan.length > 1, 'the char budget must bind before the item count');
    for (const b of plan) {
      const total = b.reduce((a, c) => a + c.length, 0);
      assert.ok(total <= 24_000 || b.length === 1, `batch of ${total} chars exceeds the budget`);
    }
  });

  test('every chunk appears exactly once, in order', async () => {
    const { planEmbedBatches } = await load();
    const chunks = Array.from({ length: 41 }, (_, i) => `chunk-${i}-` + 'z'.repeat(i * 137));
    const plan = planEmbedBatches(chunks, 32, 24_000);
    assert.deepEqual(plan.flat(), chunks, 'batching must not drop, duplicate or reorder chunks');
  });

  test('an oversized single chunk goes out ALONE rather than being cut', async () => {
    const { planEmbedBatches } = await load();
    // Splitting here would undo the chunker's entire purpose. The server
    // truncates at its own per-input cap and reports it.
    const chunks = ['a'.repeat(60_000), 'b'.repeat(10)];
    const plan = planEmbedBatches(chunks, 32, 24_000);
    assert.equal(plan[0].length, 1);
    assert.equal(plan[0][0].length, 60_000);
  });

  test('empty input yields no batches', async () => {
    const { planEmbedBatches } = await load();
    assert.deepEqual(planEmbedBatches([], 32, 24_000), []);
  });
});

describe('GAP-4 / retry — bounded concurrency and a server-directed backoff', () => {
  test('file indexing is gated process-wide, not per-file', () => {
    assert.match(SRC, /class IndexConcurrencyGate/);
    assert.match(SRC, /const indexGate = new IndexConcurrencyGate\(MODE_INDEX_MAX_CONCURRENT_FILES\)/);
    const fn = SRC.slice(SRC.indexOf('public async indexFile('));
    assert.match(fn.slice(0, 900), /await indexGate\.acquire\(\)/);
    assert.match(fn.slice(0, 900), /finally \{ indexGate\.release\(\); \}/);
  });

  test('the gate is released even when indexing throws', () => {
    const fn = SRC.slice(SRC.indexOf('public async indexFile('));
    const body = fn.slice(0, 900);
    // A leaked permit would wedge indexing for the rest of the session.
    assert.match(body, /try \{ await this\.indexFileInner\(file\); \}\s*\n\s*finally \{ indexGate\.release\(\); \}/);
  });

  test('a sub-batch retries, bounded and jittered', () => {
    const fn = SRC.slice(SRC.indexOf('private async embedSubBatchWithRetry'));
    const body = fn.slice(0, 2600);
    assert.match(body, /attempt <= MODE_INDEX_BATCH_RETRIES/);
    assert.match(body, /Math\.random\(\)/, 'jitter: N files resuming after one rate limit must not retry in lockstep');
    assert.match(body, /MODE_INDEX_RETRY_CAP_MS/, 'the backoff must be capped');
  });

  test("a permanent rejection is NOT retried — the server's verdict wins", () => {
    const fn = SRC.slice(SRC.indexOf('private async embedSubBatchWithRetry'));
    assert.match(fn.slice(0, 2600), /err\?\.retryable === false \|\| err\?\.permanentAuthFailure\) throw err/);
  });

  test("Retry-After from the provider is preferred over a guessed backoff", () => {
    const fn = SRC.slice(SRC.indexOf('private async embedSubBatchWithRetry'));
    assert.match(fn.slice(0, 2600), /Number\(err\?\.retryAfter\) > 0 \? Number\(err\.retryAfter\) \* 1000 : null/);
  });

  test('the provider trusts the server\'s explicit retryable flag', () => {
    const prov = readFileSync(path.join(repoRoot, 'electron/rag/providers/NativelyEmbeddingProvider.ts'), 'utf8');
    assert.match(prov, /typeof detail\?\.retryable === 'boolean'/);
    assert.match(prov, /detail\?\.retry_after/);
  });
});
