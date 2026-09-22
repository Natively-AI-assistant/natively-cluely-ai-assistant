#!/usr/bin/env node
// Show the retriever's full ordering for ONE query: top N plus the needle.
//   ELECTRON_RUN_AS_NODE=1 npx electron experiments/retrieval-scale/debug-query.mjs --files jd_70k.md --q "Who leads the Eyrie pod 13?" --needle "Eyrie pod 13" [--stack vector|lexical] [--top 6]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const log = console.log; console.warn = () => {}; console.log = () => {};
const { ModeHybridRetriever } = require(path.join(ROOT, 'dist-electron/electron/services/modes/ModeHybridRetriever.js'));
const { normalizeDocumentGroundedRetrievalQuery } = require(path.join(ROOT, 'dist-electron/electron/llm/documentGroundedPrompt.js'));
const STACK = arg('stack', 'vector');
let ex = null;
async function embed(texts) {
  if (!ex) { const tf = await import('@huggingface/transformers'); tf.env.allowRemoteModels = false; tf.env.localModelPath = path.join(ROOT, 'resources/models'); ex = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' }); }
  const out = []; for (let i = 0; i < texts.length; i += 16) out.push(...(await ex(texts.slice(i, i + 16), { pooling: 'mean', normalize: true })).tolist()); return out;
}
const space = 'natively:all-minilm-l6-v2:384';
const pipeline = { isReady: () => STACK !== 'lexical', getActiveProviderName: () => 'natively', getActiveSpaceKey: () => space, getActiveProviderMaxBatch: () => 32, getEmbeddingForQuery: async (q) => (await embed([q]))[0], getEmbedding: async (q) => (await embed([q]))[0], getEmbeddingsWithFallback: async (t) => ({ embeddings: await embed(t), space }) };
const Database = require('better-sqlite3');
const hr = new ModeHybridRetriever(new Database(':memory:'), { searchSimilar: async () => [], hasEmbeddings: () => false }, pipeline);
const files = arg('files').split(',').map((f, i) => ({ id: `f${i}`, modeId: 'm', fileName: f, content: fs.readFileSync(path.join(HERE, 'out', f), 'utf8'), createdAt: '' }));
if (STACK !== 'lexical') for (const f of files) await hr.indexFile(f);
const q = normalizeDocumentGroundedRetrievalQuery(arg('q'));
const res = await hr.retrieve({ query: q, modeId: 'm', files, tokenBudget: 10_000_000, topK: 100_000, hasTranscript: false, allowRerank: false, forceDocumentGrounding: true });
const needle = arg('needle', '').toLowerCase();
const show = (c, i) => log(`#${String(i).padStart(3)} score=${c.score?.toFixed(3)} fts=${c.ftsScore?.toFixed(3)} vec=${c.vectorScore?.toFixed(3)} ans=${c.answerabilityScore?.toFixed(3)} ${c.fileName}#${c.chunkIndex} len=${c.text.length}\n      ${c.text.replace(/\s+/g, ' ').slice(0, Number(arg('chars', 260)))}`);
log(`query: ${q}\nreturned: ${res.chunks.length}`);
res.chunks.slice(0, Number(arg('top', 5))).forEach(show);
const ni = res.chunks.findIndex((c) => c.text.toLowerCase().includes(needle));
if (needle && ni >= 0) { log('--- needle'); show(res.chunks[ni], ni); } else if (needle) log('--- needle NOT in returned set');
process.exit(0);
