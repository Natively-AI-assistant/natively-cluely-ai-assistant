#!/usr/bin/env node
// What the app's two local retrieval models cost on this machine: the bundled reranker
// (Xenova/ms-marco-MiniLM-L-6-v2, q8, a cross-encoder scoring question+passage pairs) and the bundled embedder
// (Xenova/multilingual-e5-small, q8). Loaded the way the app's workers load them (transformers.js on
// onnxruntime-node, local files only). Reports wall time, CPU time (user + system, so more than wall when several
// cores work), and memory. One process, nothing else measured; no network.
//   node tools/local-model-cost.mjs --models <dir with Xenova/…> [--e5 <dir with Xenova/multilingual-e5-small>] [--threads 1]
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MODELS = path.resolve(opt('models', '/Users/evin/natively-cluely-ai-assistant/resources/models'));
const E5 = opt('e5') ? path.resolve(opt('e5')) : MODELS;
const require = createRequire(import.meta.url);
const tfPath = (() => { for (const base of [process.cwd(), '/Users/evin/natively-cluely-ai-assistant']) { try { return require.resolve('@huggingface/transformers', { paths: [base] }); } catch { /* next */ } } throw new Error('@huggingface/transformers not found'); })();
const tfMod = await import(pathToFileURL(tfPath).href);
const tf = tfMod.env ? tfMod : tfMod.default;
const { env, AutoTokenizer, AutoModelForSequenceClassification, AutoModel } = tf;
env.allowRemoteModels = false;
// The app's own bounds for every local ONNX session (electron/utils/onnxThreadConfig.ts): one thread, no arena.
const SESSION = () => ({ intraOpNumThreads: Number(opt('threads', 1)), interOpNumThreads: 1, executionMode: 'sequential', enableCpuMemArena: false, enableMemPattern: false });

const mb = (b) => (b / 1048576).toFixed(0);
const q = (x, p) => { const s = [...x].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const cpuMs = (c) => (c.user + c.system) / 1000;
async function timed(fn) { const c0 = process.cpuUsage(); const t0 = performance.now(); const out = await fn(); return { out, wall: performance.now() - t0, cpu: cpuMs(process.cpuUsage(c0)) }; }

console.log(`machine: ${os.cpus()[0].model}, ${os.cpus().length} cores, ${(os.totalmem() / 1073741824).toFixed(0)} GB RAM; node ${process.version}`);
const rss0 = process.memoryUsage().rss;
console.log(`process before any model: ${mb(rss0)} MB`);

// A profile-sized candidate set: résumé and job-description chunks of roughly 90–130 words.
const QUESTION = 'Tell me about a time you had to deal with duplicate writes in a pipeline, and what you changed afterwards.';
const CHUNK = (i) => `Experience: Software Engineer II, Backend, Larkspur Freight (${2019 + (i % 5)}–${2020 + (i % 5)}). Built Dockhand, a Kafka pipeline handling about 2.3 million shipment status events a day. Duplicate writes during consumer rebalances were removed with a transactional outbox table and idempotency keys on the settlement service. Led Project Tern, a rewrite of the carrier-settlement service from a Rails monolith into three Go services, coordinating four engineers and one QA analyst. On call for the relay; wrote the incident review for the October outage and added lag alerts and a prune job for the outbox. Item ${i}: mentored two junior engineers and ran the weekly design review.`;

// ---- reranker ----
env.localModelPath = MODELS;
const rr = await timed(async () => {
  const tokenizer = await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { local_files_only: true });
  const model = await AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { local_files_only: true, dtype: 'q8', session_options: SESSION() });
  return { tokenizer, model };
});
const rssR = process.memoryUsage().rss;
console.log(`\nreranker loaded in ${rr.wall.toFixed(0)} ms (CPU ${rr.cpu.toFixed(0)} ms); process now ${mb(rssR)} MB (+${mb(rssR - rss0)} MB)`);
const rerank = async (n) => {
  const passages = Array.from({ length: n }, (_, i) => CHUNK(i));
  const inputs = rr.out.tokenizer(Array(n).fill(QUESTION), { text_pair: passages, padding: true, truncation: true });
  const o = await rr.out.model(inputs);
  return o.logits.data.length;
};
await rerank(5); // first call warms the session
console.log('| rerank of | wall p50 / p90 ms | CPU p50 ms | cores busy while it runs |'); console.log('|---|---:|---:|---:|');
let peak = process.memoryUsage().rss;
for (const n of [5, 10, 20, 30]) {
  const w = []; const c = [];
  for (let i = 0; i < 15; i++) { const r = await timed(() => rerank(n)); w.push(r.wall); c.push(r.cpu); peak = Math.max(peak, process.memoryUsage().rss); }
  console.log(`| ${n} passages | ${q(w, 0.5).toFixed(0)} / ${q(w, 0.9).toFixed(0)} | ${q(c, 0.5).toFixed(0)} | ${(q(c, 0.5) / q(w, 0.5)).toFixed(1)} |`);
}
console.log(`process at its largest while reranking: ${mb(peak)} MB`);

// ---- embedder ----
env.localModelPath = E5;
const rssBeforeE = process.memoryUsage().rss;
const em = await timed(async () => {
  const tokenizer = await AutoTokenizer.from_pretrained('Xenova/multilingual-e5-small', { local_files_only: true });
  const model = await AutoModel.from_pretrained('Xenova/multilingual-e5-small', { local_files_only: true, dtype: 'q8', session_options: SESSION() });
  return { tokenizer, model };
});
const rssE = process.memoryUsage().rss;
console.log(`\nembedder loaded in ${em.wall.toFixed(0)} ms (CPU ${em.cpu.toFixed(0)} ms); process now ${mb(rssE)} MB (+${mb(rssE - rssBeforeE)} MB for the embedder)`);
const embed = async (text) => { const o = await em.out.model(em.out.tokenizer([text], { padding: true, truncation: true })); return o.last_hidden_state.dims; };
await embed(`query: ${QUESTION}`);
{
  const w = []; const c = [];
  for (let i = 0; i < 20; i++) { const r = await timed(() => embed(`query: ${QUESTION} (${i})`)); w.push(r.wall); c.push(r.cpu); }
  console.log(`one question embedded: wall p50 / p90 ${q(w, 0.5).toFixed(0)} / ${q(w, 0.9).toFixed(0)} ms, CPU p50 ${q(c, 0.5).toFixed(0)} ms`);
}
console.log(`process with both models loaded: ${mb(process.memoryUsage().rss)} MB`);
console.log('device: onnxruntime-node CPU execution (no GPU provider is requested by the app\'s workers or here).');
