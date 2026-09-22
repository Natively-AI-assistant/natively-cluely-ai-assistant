/**
 * The BASELINE: retrieval with no reranker at all.
 *
 * Every reranker is measured against this single frozen candidate list, so the
 * only thing that varies between rows is the reranker. Embedded once through
 * the app's own OpenRouter provider, cached to disk — a re-run costs nothing
 * and cannot drift.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(repoRoot, 'x.js'));
const { OpenRouterEmbeddingProvider } = require(repoRoot + '/dist-electron/electron/rag/providers/OpenRouterEmbeddingProvider.js');
const { probeOpenRouterEmbeddingDimensions } = require(repoRoot + '/dist-electron/electron/rag/openrouterEmbeddingModels.js');

const MODEL = 'openai/text-embedding-3-small';
const KEY = process.env.OPENROUTER_API_KEY;
const corpus = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const dims = await probeOpenRouterEmbeddingDimensions(MODEL, KEY);
if (!dims) throw new Error('could not measure the embedding width');
const provider = new OpenRouterEmbeddingProvider({ apiKey: KEY, model: MODEL, dimensions: dims });

// embedBatch, not embed: embed() takes ONE string and would return a single
// vector for the whole corpus without erroring.
const docs = await provider.embedBatch(corpus.passages);
const qs = await provider.embedBatch(corpus.queries.map(q => q.q));
if (docs.length !== corpus.passages.length || qs.length !== corpus.queries.length) {
  throw new Error(`got ${docs.length}/${qs.length} vectors`);
}

const cos = (a, b) => { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/(Math.sqrt(na)*Math.sqrt(nb)); };

const cases = corpus.queries.map((entry, qi) => {
  const ranked = corpus.passages.map((_, di) => ({ di, s: cos(qs[qi], docs[di]) }))
    .sort((a, b) => b.s - a.s).map(x => x.di);
  return {
    query: entry.q, topic: entry.topic, gold: entry.gold,
    candidates: ranked,                       // the WHOLE pool, in retrieval order
    passages: ranked.map(i => corpus.passages[i]),
    baselineRank: ranked.indexOf(entry.gold), // where no-reranker leaves it
  };
});

const ranks = cases.map(c => c.baselineRank);
const summary = {
  embeddingModel: MODEL, dims, poolSize: corpus.passages.length, queries: cases.length,
  top1: ranks.filter(r => r === 0).length,
  top3: ranks.filter(r => r < 3).length,
  meanRank: +(ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(3),
  mrr: +(ranks.reduce((a, r) => a + 1 / (r + 1), 0) / ranks.length).toFixed(4),
};
fs.writeFileSync(process.argv[3], JSON.stringify({ ...summary, cases }, null, 1));
console.log(`BASELINE (no reranker): top1 ${summary.top1}/${summary.queries}, top3 ${summary.top3}/${summary.queries}, ` +
  `meanRank ${summary.meanRank}, MRR ${summary.mrr}  [${MODEL} @ ${dims}]`);
