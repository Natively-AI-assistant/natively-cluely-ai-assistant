// scripts/intent-benchmark/providers/staticEmbedWorker.mjs
//
// Model2Vec static embeddings, driven directly through onnxruntime-node.
//
// The generic feature-extraction pipeline cannot run these. A Model2Vec graph
// is an EmbeddingBag, whose signature is (input_ids, offsets) rather than
// (input_ids, attention_mask): all the sequences in a batch are CONCATENATED
// into one flat array, and `offsets` marks where each one starts. Handing it an
// attention mask fails with "Missing the following inputs: offsets".
//
// Which is also why it is fast. There is no transformer here at all — no
// attention, no layers. It is a table lookup per token followed by a mean, so
// the cost is proportional to token count rather than to model depth. That is
// what makes it the only candidate with a plausible route to sub-millisecond
// routing, and why it is worth a bespoke worker rather than being dropped when
// the generic path failed.

import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';

if (!parentPort) throw new Error('staticEmbedWorker must be run as a Worker thread');

let session = null;
let tokenizer = null;

async function ensureLoaded() {
  if (session) return;
  const t0 = performance.now();
  const { AutoTokenizer, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = workerData.modelPath;
  tokenizer = await AutoTokenizer.from_pretrained(workerData.modelId);

  const ort = await import('onnxruntime-node');
  session = await ort.InferenceSession.create(
    path.join(workerData.modelPath, workerData.modelId, 'onnx', 'model.onnx'),
    { intraOpNumThreads: workerData.threads ?? 2, interOpNumThreads: 1 },
  );
  parentPort.postMessage({ type: 'loaded', ms: performance.now() - t0 });
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'init') { await ensureLoaded(); parentPort.postMessage({ type: 'ok', id: msg.id }); return; }
    if (msg.type === 'embed') {
      await ensureLoaded();
      const ort = await import('onnxruntime-node');
      const t0 = performance.now();

      // Tokenise ONE TEXT AT A TIME.
      //
      // EmbeddingBag wants the real tokens concatenated, so padding is wrong
      // here: a pad token would be averaged into the result as if it were a
      // real word. But asking the tokenizer for an unpadded BATCH fails outright
      // ("Unable to create tensor... activate truncation and/or padding"),
      // because it still tries to build one rectangular tensor. Encoding each
      // text separately sidesteps both problems, and costs nothing measurable:
      // tokenisation is a rounding error next to the lookup this model does.
      const seqs = [];
      for (const text of msg.texts) {
        const enc = await tokenizer(text, { padding: false, truncation: true, max_length: 512 });
        const ids = enc.input_ids;
        seqs.push(Array.from(ids.data ?? ids[0]?.data ?? ids[0] ?? ids, (v) => Number(v)));
      }

      const flat = [];
      const offsets = [];
      for (const s of seqs) {
        offsets.push(flat.length);
        // An empty sequence would make EmbeddingBag average over nothing and
        // return NaNs, which then poison every centroid it touches. One token
        // is enough to keep the vector finite.
        const toks = s.length ? s : [0];
        for (const t of toks) flat.push(BigInt(t));
      }

      const out = await session.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(flat), [flat.length]),
        offsets: new ort.Tensor('int64', BigInt64Array.from(offsets.map(BigInt)), [offsets.length]),
      });
      const key = Object.keys(out)[0];
      const t = out[key];
      const dim = t.dims[t.dims.length - 1];

      // L2-normalise here rather than in the provider, so this worker returns
      // the same contract as the transformer embedding worker and the prototype
      // arithmetic is identical for both.
      const data = Array.from(t.data);
      for (let i = 0; i < offsets.length; i++) {
        let norm = 0;
        for (let d = 0; d < dim; d++) norm += data[i * dim + d] ** 2;
        norm = Math.sqrt(norm) || 1;
        for (let d = 0; d < dim; d++) data[i * dim + d] /= norm;
      }

      parentPort.postMessage({ type: 'vectors', id: msg.id, data, dims: [offsets.length, dim], ms: performance.now() - t0 });
      return;
    }
    parentPort.postMessage({ type: 'error', id: msg.id, error: `unknown message ${msg.type}` });
  } catch (e) {
    parentPort.postMessage({ type: 'error', id: msg?.id, error: e?.message ?? String(e) });
  }
});
