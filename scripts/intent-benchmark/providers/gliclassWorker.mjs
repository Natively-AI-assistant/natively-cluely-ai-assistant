// scripts/intent-benchmark/providers/gliclassWorker.mjs
//
// GLiClass: zero-shot classification in ONE forward pass for ALL labels.
//
// The reason it is in the matrix is the cost model. NLI zero-shot runs one
// forward pass PER LABEL, which is why MobileBERT costs 8 passes in
// production's configuration and 50 for the full frame. GLiClass encodes the
// labels and the text in a single sequence and reads one logit per label
// position, so asking about twelve labels costs the same as asking about one.
//
// Input layout, from the model's own config (prompt_first: true) and its added
// tokens (<<LABEL>> 128001, <<SEP>> 128002):
//
//   <<LABEL>> label one <<LABEL>> label two ... <<SEP>> the utterance
//
// The output is [position, batch], where position indexes the <<LABEL>> tokens
// in the order they were written. So logit i belongs to label i, and the
// mapping is positional rather than by name. Get the order wrong and every
// score is silently attached to the wrong label, which looks like a bad model
// rather than a bad adapter.

import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';

if (!parentPort) throw new Error('gliclassWorker must be run as a Worker thread');

let session = null;
let tokenizer = null;
const LABEL_TOKEN = '<<LABEL>>';
const SEP_TOKEN = '<<SEP>>';

async function ensureLoaded() {
  if (session) return;
  const t0 = performance.now();
  const { AutoTokenizer, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = workerData.modelPath;
  tokenizer = await AutoTokenizer.from_pretrained(workerData.modelId);

  const ort = await import('onnxruntime-node');
  session = await ort.InferenceSession.create(
    path.join(workerData.modelPath, workerData.modelId, 'onnx', workerData.graph),
    { intraOpNumThreads: workerData.threads ?? 2, interOpNumThreads: 1 },
  );
  parentPort.postMessage({ type: 'loaded', ms: performance.now() - t0 });
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'init') { await ensureLoaded(); parentPort.postMessage({ type: 'ok', id: msg.id }); return; }
    if (msg.type === 'classify') {
      await ensureLoaded();
      const ort = await import('onnxruntime-node');
      const t0 = performance.now();

      const prompt = msg.labels.map((l) => `${LABEL_TOKEN} ${l}`).join(' ') + ` ${SEP_TOKEN} ${msg.text}`;
      const enc = await tokenizer(prompt, { truncation: true, max_length: 512, padding: false });
      const raw = enc.input_ids;
      const ids = Array.from(raw.data ?? raw[0]?.data ?? raw[0] ?? raw, (v) => Number(v));
      const n = ids.length;

      const out = await session.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, n]),
        attention_mask: new ort.Tensor('int64', BigInt64Array.from(ids.map(() => 1n)), [1, n]),
      });
      const t = out.logits ?? out[Object.keys(out)[0]];
      const scores = Array.from(t.data).slice(0, msg.labels.length);

      // Sigmoid, not softmax: GLiClass scores each label independently, so the
      // values are not a distribution over labels and normalising them would
      // invent a competition the model never expressed.
      const probs = scores.map((s) => 1 / (1 + Math.exp(-s)));
      const ranked = msg.labels
        .map((l, i) => [l, probs[i] ?? 0])
        .sort((a, b) => b[1] - a[1]);

      parentPort.postMessage({ type: 'result', id: msg.id, ranked, ms: performance.now() - t0 });
      return;
    }
    parentPort.postMessage({ type: 'error', id: msg.id, error: `unknown message ${msg.type}` });
  } catch (e) {
    parentPort.postMessage({ type: 'error', id: msg?.id, error: e?.message ?? String(e) });
  }
});
