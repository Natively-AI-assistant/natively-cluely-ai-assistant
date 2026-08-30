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
    // silently ignoring the new modelId. Evict this one file's cache entry
    // before every require so each call gets a fresh module evaluation (and
    // therefore a fresh singleton) scoped to the modelId just set above.
    // Dependencies (fs, path, worker_threads, electron, onnxThreadConfig,
    // ...) are left cached — they hold no per-model-id state.
    const resolved = require.resolve(dist);
    delete require.cache[resolved];
    ({ getLocalReranker } = require(resolved));
  } catch (e) {
    return { perQuery: [], peakRssMb: 0, failed: true, error: `import failed: ${e.message}` };
  }

  const reranker = getLocalReranker();
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
