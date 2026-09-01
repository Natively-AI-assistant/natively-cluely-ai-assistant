#!/usr/bin/env node
// benchmarks/reranker-eval/run.mjs
//
// Orchestrates every reranker candidate against the shared fixture corpus
// and dumps raw per-query results to results/raw/. Run `npm run
// benchmark:reranker:score` afterward to compute metrics and generate the
// report. Never touches ModeHybridRetriever.ts or LocalReranker.ts.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Embedder } from './lib/embedder.mjs';
import { buildCandidatePools } from './lib/candidates.mjs';
import { runCohereReranker } from './lib/rerankers/cohere.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const resultsDir = path.join(__dirname, 'results', 'raw');
mkdirSync(resultsDir, { recursive: true });

function writeResult(name, data) {
  writeFileSync(path.join(resultsDir, `${name}.json`), JSON.stringify(data, null, 2));
  console.log(`[run] wrote results/raw/${name}.json`);
}

async function main() {
  const documents = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/documents.json'), 'utf8'));
  const queries = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/queries.json'), 'utf8'));

  console.log(`[run] building candidate pools for ${queries.length} queries over ${documents.length} documents...`);
  const embedder = new Embedder(repoRoot);
  const embedderAvailable = await embedder.isAvailable();
  if (!embedderAvailable) {
    console.error('[run] FATAL: local embedder unavailable — run `node scripts/download-models.js` from the repo root first.');
    process.exit(1);
  }
  const pools = await buildCandidatePools(repoRoot, documents, queries, embedder);
  const unresolved = pools.filter((p) => p.goldChunkPoolIndices.length === 0);
  if (unresolved.length > 0) {
    console.warn(`[run] WARNING: ${unresolved.length}/${pools.length} queries did not resolve a gold chunk within the candidate pool: ${unresolved.map((p) => p.queryId).join(', ')}`);
  }
  writeFileSync(path.join(resultsDir, '_pools.json'), JSON.stringify(pools, null, 2));

  // Baseline: cosine order as-is, no model call.
  writeResult('baseline', {
    candidate: 'baseline',
    skipped: false,
    failed: false,
    perQuery: pools.map((p) => ({ queryId: p.queryId, order: p.pool.map((_, i) => i) })),
  });

  // Local candidates run in a SEPARATE CHILD PROCESS per model id. This is
  // required, not just tidy, for two independent reasons:
  //   1. peakRssMb measurement isolation — a second in-process model load
  //      would report base+large RSS, not large alone (see local.mjs).
  //   2. The shared ONNX concurrency gate (electron/utils/onnxThreadConfig.ts)
  //      caps normal-priority slot acquisition at 2 concurrent holders with
  //      NO TIMEOUT. This process's own Embedder (used above to build the
  //      pools) already holds one slot for this process's lifetime. If both
  //      local reranker models were also loaded in *this* process, the
  //      second model's slot acquisition would hang forever once the first
  //      two slots (embedder + first reranker) were taken. Spawning a fresh
  //      OS process per model id gives each one its own slot-accounting
  //      state, sidestepping the cap entirely.
  const { execFileSync } = await import('node:child_process');
  // The child script's own path/model-id inputs are passed via argv rather
  // than spliced into the -e source string — spliced paths only work
  // because macOS paths happen to contain no quotes/backslashes; argv keeps
  // this correct on Windows too (drive letters, backslashes, spaces).
  const localRerankerUrl = pathToFileURL(path.join(__dirname, 'lib/rerankers/local.mjs')).href;
  const script = `
    import { runLocalReranker } from ${JSON.stringify(localRerankerUrl)};
    import { readFileSync } from 'node:fs';
    const [, poolsPath, repoRootArg, modelIdArg] = process.argv;
    const pools = JSON.parse(readFileSync(poolsPath, 'utf8'));
    const poolEntries = pools.map(p => ({ queryId: p.queryId, query: p.query, pool: p.pool }));
    const result = await runLocalReranker(repoRootArg, modelIdArg, poolEntries);
    process.stdout.write(JSON.stringify(result));
  `;
  for (const [name, modelId] of [
    ['bge-reranker-base', 'Xenova/bge-reranker-base'],
    ['bge-reranker-large', 'Xenova/bge-reranker-large'],
  ]) {
    console.log(`[run] running ${name}...`);
    try {
      const out = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', script, '--', path.join(resultsDir, '_pools.json'), repoRoot, modelId],
        {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 64,
          stdio: ['ignore', 'pipe', 'inherit'],
          // Defense-in-depth, not the primary safety: LocalReranker.ts's own
          // WORKER_INIT_TIMEOUT_MS (60s) plus its worker.unref() already
          // keep a stuck load from hanging the process today. This bounds
          // the subprocess independently of that implementation detail (out
          // of this task's control) so a future change there that removes
          // unref() fails this script visibly instead of hanging forever.
          // Generous enough for a real model load + full pool rerank pass.
          timeout: 180_000,
        },
      );
      const result = JSON.parse(out.trim().split('\n').pop());
      writeResult(name, { candidate: name, skipped: false, ...result });
    } catch (e) {
      // execFileSync's own e.message embeds the full inline -e source (not
      // useful in a report); the real diagnostic already streamed to this
      // process's stderr live (stdio: 'inherit' above), so keep this short.
      // A timeout kill (see the `timeout` option above) is a DISTINCT case:
      // Node sets e.code === 'ETIMEDOUT' and e.status === null (not
      // undefined, and not a real exit code — the parent killed the child,
      // the child never exited on its own) with e.signal === 'SIGTERM'.
      // Reporting that as "exit null, signal SIGTERM — see console output
      // above" would be actively misleading: there IS no underlying error in
      // the console, the process was still working when it got killed.
      let error;
      if (e.code === 'ETIMEDOUT') {
        error = `subprocess timed out after 180s loading/running "${modelId}" — see LocalReranker.ts's WORKER_INIT_TIMEOUT_MS and this script's execFileSync timeout option`;
      } else {
        const status = e.status !== undefined && e.status !== null ? e.status : 'unknown';
        const sig = e.signal ? `, signal ${e.signal}` : '';
        error = `subprocess failed (exit ${status}${sig}) — see console output above for the underlying error`;
      }
      writeResult(name, { candidate: name, skipped: false, failed: true, error, perQuery: [] });
    }
  }

  // Cohere — same process is fine, no model-loading state to isolate.
  console.log('[run] running cohere-rerank-v3.5 (skips cleanly if COHERE_API_KEY unset)...');
  const poolEntries = pools.map((p) => ({ queryId: p.queryId, query: p.query, pool: p.pool }));
  const cohereResult = await runCohereReranker(poolEntries);
  writeResult('cohere-rerank-v3-5', { candidate: 'cohere-rerank-v3.5', ...cohereResult });

  console.log('[run] done. Run `npm run benchmark:reranker:score` next.');
}

main().catch((e) => {
  console.error('[run] FATAL:', e);
  process.exit(1);
});
