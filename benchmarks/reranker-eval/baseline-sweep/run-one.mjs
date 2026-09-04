/** One reranker, all 24 queries, against the frozen no-reranker baseline. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The sibling harness's metrics, not a second implementation of MRR.
import { reciprocalRank } from '../lib/metrics.mjs';
// Resolve dist-electron from the REPO ROOT, wherever this is invoked from.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(repoRoot, 'x.js'));

const [,, KIND, ID, BASE, OUT] = process.argv;
const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const ROOT = path.join(os.homedir(), 'Library/Application Support/natively/local-models');

function seedSettings(localModelId) {
  const store = { reranker: { provider: 'local', localModelId } };
  globalThis.__nativelySettingsManagerV1__ = { get: k => store[k], set: (k, v) => { store[k] = v; return true; } };
}

async function buildPort() {
  if (KIND === 'onnx') {
    seedSettings(ID);
    const { getLocalReranker, reloadLocalReranker } = require(repoRoot + '/dist-electron/electron/rag/LocalReranker.js');
    reloadLocalReranker('bench');
    return getLocalReranker();
  }
  if (KIND === 'gguf') {
    seedSettings(ID);
    const { buildLocalGgufPort, resetLocalGgufPort } = require(repoRoot + '/dist-electron/electron/services/reranking/rerankerConfig.js');
    resetLocalGgufPort();
    return buildLocalGgufPort();
  }
  if (KIND === 'openrouter' || KIND === 'jina') {
    const { OpenRouterReranker } = require(repoRoot + '/dist-electron/electron/services/reranking/OpenRouterReranker.js');
    const { hostedRerankProvider } = require(repoRoot + '/dist-electron/electron/rag/hostedRerankProviders.js');
    const d = hostedRerankProvider(KIND);
    const key = KIND === 'jina' ? process.env.JINA_API_KEY : process.env.OPENROUTER_API_KEY;
    if (!key) return null;
    return new OpenRouterReranker({ baseUrl: d?.baseUrl, providerId: KIND, getApiKey: () => key, getModel: () => ID });
  }
  if (KIND === 'extension') {
    const dir = path.join(os.homedir(), 'natively-extensions', ID);
    const modelDir = { 'natively-qwen3-reranker': path.join(ROOT, 'QuantFactory/Qwen3-Reranker-0.6B-GGUF'),
                       'natively-jina-reranker': path.join(ROOT, 'jinaai/jina-reranker-v3.5-GGUF'),
                       'natively-ettin-reranker': path.join(ROOT, 'cross-encoder/ettin-reranker-32m-v1') }[ID];
    const { default: Impl } = await import(path.join(dir, 'dist/index.js'));
    const ext = new Impl();
    await ext.init({ extensionId: ID, modelDir, logger: { debug(){}, info(){}, warn(){}, error(){} }, config: {} });
    return {
      batchSize: Number.MAX_SAFE_INTEGER,
      async rerank(query, passages) {
        const ranked = await ext.rerank(query, passages.map((text, i) => ({ id: String(i), text })),
          { topK: passages.length, signal: new AbortController().signal });
        return ranked.map(r => ({ index: Number(r.id), score: r.score }));
      },
      dispose: () => ext.dispose(),
    };
  }
  throw new Error(`unknown kind ${KIND}`);
}

let port;
try { port = await buildPort(); }
catch (e) {
  fs.writeFileSync(OUT, JSON.stringify({ kind: KIND, id: ID, fatal: e.message }));
  console.log(`${KIND}/${ID}: FATAL ${e.message.slice(0, 110)}`); process.exit(0);
}
if (!port) {
  fs.writeFileSync(OUT, JSON.stringify({ kind: KIND, id: ID, fatal: 'no port (missing key or unsupported)' }));
  console.log(`${KIND}/${ID}: SKIPPED — no API key`); process.exit(0);
}

const c_len = base.cases[0]?.passages.length ?? 0;
const rows = [];
for (const c of base.cases) {
  const t0 = Date.now();
  let order = null, error = null;
  try { order = await port.rerank(c.query, c.passages); }
  catch (e) { error = e?.message || String(e); }
  const ms = Date.now() - t0;
  const row = { topic: c.topic, baselineRank: c.baselineRank, ms, error };
  if (!Array.isArray(order) || order.length === 0) { row.verdict = error ? 'THREW' : 'NULL'; rows.push(row); continue; }
  const byIndex = new Map(order.map(o => [o.index, o.score]));
  row.complete = byIndex.size === c.passages.length && [...byIndex.values()].every(Number.isFinite);
  const ranked = [...byIndex.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
  row.rank = ranked.indexOf(c.candidates.indexOf(c.gold));
  row.verdict = row.complete && row.rank >= 0 ? 'ok' : 'INCOMPLETE';
  rows.push(row);
}
await port.dispose?.();

const ok = rows.filter(r => r.verdict === 'ok');
const n = rows.length;
// Reciprocal rank per query, averaged over ALL queries — a query the reranker
// failed to answer contributes 0 rather than being dropped, or a model that
// returns null half the time would score better than one that answers badly.
const mrr = rows.reduce((a, r) => a + (r.verdict === 'ok'
  ? reciprocalRank(Array.from({ length: c_len }, (_, i) => i === r.rank))
  : 0), 0) / n;
const summary = {
  kind: KIND, id: ID, queries: n, scored: ok.length,
  failed: rows.filter(r => r.verdict !== 'ok').length,
  top1: ok.filter(r => r.rank === 0).length,
  top3: ok.filter(r => r.rank < 3).length,
  meanRank: ok.length ? +(ok.reduce((a, r) => a + r.rank, 0) / ok.length).toFixed(3) : null,
  mrr: +mrr.toFixed(4),
  improved: ok.filter(r => r.rank < r.baselineRank).length,
  worsened: ok.filter(r => r.rank > r.baselineRank).length,
  medianMs: rows.map(r => r.ms).sort((a, b) => a - b)[Math.floor(n / 2)],
  totalMs: rows.reduce((a, r) => a + r.ms, 0),
  firstError: rows.find(r => r.error)?.error ?? null,
  rows,
};
fs.writeFileSync(OUT, JSON.stringify(summary, null, 1));
console.log(`${KIND}/${ID}: top1 ${summary.top1}/${n} MRR ${summary.mrr} mean ${summary.meanRank} ` +
  `(+${summary.improved}/-${summary.worsened}) ${summary.medianMs}ms` + (summary.failed ? ` FAILED ${summary.failed}` : ''));
