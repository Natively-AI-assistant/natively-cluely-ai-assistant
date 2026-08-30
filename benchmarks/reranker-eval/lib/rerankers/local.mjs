// benchmarks/reranker-eval/lib/rerankers/local.mjs
//
// Runs the REAL LocalReranker (electron/rag/LocalReranker.ts, compiled) with
// a given model id, via the same NATIVELY_RERANKER_MODEL env override
// production already supports for experimentation — no code changes to
// LocalReranker.ts needed. One process per model id (see run.mjs) so the
// singleton's cached worker never mixes two model ids in one run.
import path from 'node:path';
import { createRequire } from 'node:module';
import { installElectronMock } from '../electron-mock.mjs';

const require = createRequire(import.meta.url);

export async function runLocalReranker(repoRoot, modelId, poolEntries) {
  installElectronMock(repoRoot);
  process.env.NATIVELY_LOCAL_MODELS_PATH = path.join(repoRoot, 'resources', 'models');
  process.env.NATIVELY_RERANKER_MODEL = modelId;

  let getLocalReranker;
  try {
    const dist = path.resolve(repoRoot, 'dist-electron/electron/rag/LocalReranker.js');
    // dist-electron output is CommonJS. LocalReranker's `getLocalReranker()`
    // singleton reads NATIVELY_RERANKER_MODEL only once, at construction
    // time, into a `readonly modelId` — Node's require cache (keyed by
    // resolved file path, NOT by any query string, so `import()` cache-
    // busting tricks don't apply to a CJS target) would otherwise hand back
    // the SAME already-loaded singleton to a second runLocalReranker() call
    // made later in the same process (e.g. two tests in one test file),
    // silently ignoring the new modelId and returning wrong pass/fail.
    // Evict this one file's cache entry before every require so each call's
    // getLocalReranker() reads the modelId just set above — this fixes
    // CORRECTNESS (which model id a call actually exercises), not isolation
    // (see the teardown note below for what's still shared). Dependencies
    // (fs, path, worker_threads, electron, onnxThreadConfig, ...) are left
    // cached — they hold no per-model-id state.
    const resolved = require.resolve(dist);
    const prior = require.cache[resolved];
    if (prior?.exports?.getLocalReranker) {
      // Best-effort teardown of the singleton we're about to orphan:
      // __resetForTests() terminates its worker_threads.Worker and calls
      // its stashed slotRelease(), freeing the shared ONNX concurrency slot
      // (electron/utils/onnxThreadConfig.ts — default cap is 2, and a
      // normal-priority acquireOnnxSlot() call has NO timeout, so an
      // orchestrator that reloaded a THIRD real model in this same process
      // without this cleanup would hang forever once both slots were
      // leaked, not error out). This does NOT make repeated in-process
      // reloads safe for RSS measurement — a terminated worker's heap/ONNX
      // allocations are not guaranteed to be reclaimed by the OS promptly,
      // so a second call's peakRssMb here is base+large, not large alone.
      // One-process-per-model (run.mjs) remains the required design for
      // measurement validity; this eviction only guarantees each call
      // observes its OWN modelId's pass/fail correctly.
      try { prior.exports.getLocalReranker().__resetForTests?.(); } catch { /* best effort */ }
    }
    delete require.cache[resolved];
    ({ getLocalReranker } = require(resolved));
  } catch (e) {
    return { perQuery: [], peakRssMb: 0, failed: true, error: `import failed: ${e.message}` };
  }

  const reranker = getLocalReranker();

  // Fast-fail on an uncached model BEFORE isAvailable()/rerank() ever touch
  // the worker. isCached() is a synchronous-ish local filesystem check (no
  // network, no subprocess) that mirrors exactly what ensureLoaded() would
  // need on disk — so a model with no files under resources/models/ fails in
  // milliseconds with an actionable message, instead of burning the full
  // WORKER_INIT_TIMEOUT_MS (60s) attempting to load/download it and then
  // failing with a generic worker-timeout error. Applies to any modelId this
  // function is called with, not just bge-reranker-large: isCached() on an
  // already-cached model (e.g. bge-reranker-base, pre-fetched by
  // scripts/download-models.js) returns true immediately and this branch is
  // a no-op for it.
  const cached = await reranker.isCached();
  if (!cached) {
    return {
      perQuery: [],
      peakRssMb: 0,
      failed: true,
      error: `model "${modelId}" is not cached under resources/models/ — pre-fetch it before running this benchmark, e.g.: curl -C - -L "https://huggingface.co/${modelId}/resolve/main/tokenizer.json" -o "resources/models/${modelId}/tokenizer.json" (and similarly for config.json, tokenizer_config.json, and onnx/model_quantized.onnx) — see LocalReranker.ts's resolveModelPath() for the exact expected directory layout`,
    };
  }

  const available = await reranker.isAvailable();
  if (!available) {
    return { perQuery: [], peakRssMb: 0, failed: true, error: `model "${modelId}" did not become available (see console warnings above for the underlying load error)` };
  }

  let peakRssMb = process.memoryUsage().rss / (1024 * 1024);
  const perQuery = [];
  for (const entry of poolEntries) {
    const texts = entry.pool.map((c) => c.text);
    const t0 = Date.now();
    const results = await reranker.rerank(entry.query, texts);
    const latencyMs = Date.now() - t0;
    peakRssMb = Math.max(peakRssMb, process.memoryUsage().rss / (1024 * 1024));

    if (!results) {
      perQuery.push({ queryId: entry.queryId, order: texts.map((_, i) => i), latencyMs, rerankReturnedNull: true });
      continue;
    }
    const order = results.map((r) => r.index); // already sorted descending by LocalReranker.rerank()
    perQuery.push({ queryId: entry.queryId, order, latencyMs });
  }

  return { perQuery, peakRssMb, failed: false };
}
