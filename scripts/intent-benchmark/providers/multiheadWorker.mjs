// scripts/intent-benchmark/providers/multiheadWorker.mjs
//
// The fine-tuned multi-head router, hosted in its own worker.
//
// Unlike the NLI and embedding workers this does NOT go through a
// transformers.js pipeline, because the graph is not one of the shapes those
// pipelines know: one input pair, six output tensors, one per IntentFrame axis.
// So it drives onnxruntime-node directly and borrows only the tokenizer.
//
// That is the candidate's whole argument in one sentence: ONE forward pass
// answers every axis, against the NLI baseline's one pass per label.

import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';

if (!parentPort) throw new Error('multiheadWorker must be run as a Worker thread');

let session = null;
let tokenizer = null;
let cfg = null;
let inverse = null;

async function ensureLoaded() {
  if (session) return;
  const t0 = performance.now();
  cfg = JSON.parse(fs.readFileSync(path.join(workerData.dir, 'heads.json'), 'utf8'));

  const { AutoTokenizer, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = path.dirname(workerData.dir);
  tokenizer = await AutoTokenizer.from_pretrained(path.basename(workerData.dir));

  const ort = await import('onnxruntime-node');
  const graph = cfg.dtype === 'q8' ? 'model_quantized.onnx' : 'model.onnx';
  session = await ort.InferenceSession.create(path.join(workerData.dir, 'onnx', graph), {
    // Bounded threads. The production ONNX loaders all constrain this so
    // several models cannot collectively saturate the machine; a benchmark that
    // let one candidate take every core would report a latency no other
    // candidate was allowed to achieve.
    intraOpNumThreads: workerData.threads ?? 2,
    interOpNumThreads: 1,
  });

  // label index -> label string, per axis
  inverse = {};
  for (const [axis, map] of Object.entries(cfg.label_maps)) {
    const arr = [];
    for (const [label, idx] of Object.entries(map)) arr[idx] = label;
    inverse[axis] = arr;
  }
  parentPort.postMessage({ type: 'loaded', ms: performance.now() - t0 });
}

function softmaxTop(logits, labels, k = 3) {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const z = exps.reduce((a, b) => a + b, 0) || 1;
  return logits
    .map((_, i) => [labels[i] ?? String(i), exps[i] / z])
    .sort((a, b) => b[1] - a[1])
    .slice(0, k);
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'init') { await ensureLoaded(); parentPort.postMessage({ type: 'ok', id: msg.id }); return; }
    if (msg.type === 'classify') {
      await ensureLoaded();
      const ort = await import('onnxruntime-node');
      const t0 = performance.now();
      const enc = await tokenizer(msg.text, { truncation: true, max_length: 192, padding: 'max_length' });
      const ids = BigInt64Array.from(Array.from(enc.input_ids.data, (v) => BigInt(v)));
      const am = BigInt64Array.from(Array.from(enc.attention_mask.data, (v) => BigInt(v)));
      const n = ids.length;
      const out = await session.run({
        input_ids: new ort.Tensor('int64', ids, [1, n]),
        attention_mask: new ort.Tensor('int64', am, [1, n]),
      });
      const result = {};
      for (const axis of cfg.axes) {
        const t = out[`logits_${axis}`];
        if (!t) continue;
        result[axis] = softmaxTop(Array.from(t.data), inverse[axis]);
      }
      parentPort.postMessage({ type: 'result', id: msg.id, axes: result, ms: performance.now() - t0 });
      return;
    }
    parentPort.postMessage({ type: 'error', id: msg.id, error: `unknown message ${msg.type}` });
  } catch (e) {
    parentPort.postMessage({ type: 'error', id: msg?.id, error: e?.message ?? String(e) });
  }
});
