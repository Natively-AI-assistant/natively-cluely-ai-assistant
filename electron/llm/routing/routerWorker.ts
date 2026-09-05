// electron/llm/routing/routerWorker.ts
//
// The interaction router's ONNX session, in its own worker thread.
//
// One fine-tuned MiniLM-L6 encoder with a linear head per axis, quantized to
// int8. The router owns two of those heads, needs_response and dialogue_act;
// the rest are read but discarded here, because AXIS_OWNER assigns them to
// Context Intelligence V3 and a second opinion on a V3-owned axis is a source
// of disagreement rather than of information.
//
// THE WORKER IS NOT OPTIONAL. Natively already learned that several ONNX
// Runtime sessions on the Electron main thread cause fatal BFCArena::Extend
// aborts on macOS. Every production loader here runs in its own worker behind
// an onnxThreadConfig bound and an on-disk poison sentinel, and this one is no
// different.
//
// The text handed to the encoder must match what the trainer built, byte for
// byte, or the model predicts on a format it was never fitted to and the
// accuracy drop reads as a bad model. `buildRouterText` is that format and
// scripts/intent-benchmark has a test that diffs it against the Python.

import { parentPort } from 'worker_threads';
import path from 'path';
import { getBoundedOnnxSessionOptions } from '../../utils/onnxThreadConfig';
import { classifyWorkerFailure } from '../../utils/workerStatus';
import { buildRouterText } from './routerText';

if (!parentPort) throw new Error('routerWorker must be run as a Worker thread');

type Heads = {
  axes: string[];
  label_maps: Record<string, Record<string, number>>;
  dtype?: string;
};

let session: any = null;
let tokenizer: any = null;
let heads: Heads | null = null;
let indexToLabel: Record<string, string[]> = {};
let loadingPromise: Promise<void> | null = null;

/** Kept out of the bundler's static analysis, as the sibling workers do. */
async function loadTransformers(): Promise<any> {
  return (new Function('return import("@huggingface/transformers")')()) as any;
}
async function loadOrt(): Promise<any> {
  return (new Function('return import("onnxruntime-node")')()) as any;
}

async function ensureLoaded(msg: any): Promise<void> {
  if (session) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const fs = await import('fs');
    heads = JSON.parse(fs.readFileSync(path.join(msg.modelDir, 'heads.json'), 'utf8')) as Heads;

    // label index -> label string, per axis, inverted once at load.
    indexToLabel = {};
    for (const [axis, map] of Object.entries(heads.label_maps)) {
      const arr: string[] = [];
      for (const [label, idx] of Object.entries(map)) arr[idx as number] = label;
      indexToLabel[axis] = arr;
    }

    const { AutoTokenizer, env } = await loadTransformers();
    env.allowRemoteModels = false;
    env.localModelPath = path.dirname(msg.modelDir);
    tokenizer = await AutoTokenizer.from_pretrained(path.basename(msg.modelDir));

    const ort = await loadOrt();
    // int8 is what the exporter writes and what the installer ships. Naming the
    // graph explicitly rather than letting a default pick keeps this from
    // degrading the way the transformers.js v3 dtype default did for the
    // sibling workers: a bare load asks for model.onnx, the installer ships
    // model_quantized.onnx and nothing else, and a packaged local-only load
    // then fails silently.
    const graph = heads.dtype === 'fp32' ? 'model.onnx' : 'model_quantized.onnx';
    const bounds = getBoundedOnnxSessionOptions();
    session = await ort.InferenceSession.create(path.join(msg.modelDir, 'onnx', graph), {
      intraOpNumThreads: bounds.intraOpNumThreads,
      interOpNumThreads: bounds.interOpNumThreads,
    });

    parentPort!.postMessage({
      type: 'status',
      status: { type: 'ready', backend: 'onnx', modelPath: msg.modelDir },
    });
  })();

  try {
    await loadingPromise;
  } catch (e) {
    loadingPromise = null;
    session = null;
    tokenizer = null;
    const failure = classifyWorkerFailure(e);
    parentPort!.postMessage({
      type: 'status',
      status: {
        type: failure.recoverable ? 'degraded' : 'failed',
        // There is no cheaper router to fall back to. `none` says so, rather
        // than implying a regex path that does not exist for these axes.
        backend: 'none',
        reason: failure.reason,
        message: failure.message,
        recoverable: failure.recoverable,
      },
    });
    throw e;
  }
}

function softmaxTop(logits: Float32Array | number[], labels: string[]): { label: string; score: number; alternatives: Array<[string, number]> } {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  let sum = 0;
  const probs: number[] = [];
  for (const v of logits) { const e = Math.exp(v - max); probs.push(e); sum += e; }
  for (let i = 0; i < probs.length; i++) probs[i] /= sum;
  const ranked = probs
    .map((p, i) => [labels[i] ?? String(i), p] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  return { label: ranked[0][0], score: ranked[0][1], alternatives: ranked.slice(0, 3) };
}

parentPort.on('message', async (msg: any) => {
  try {
    if (msg.type === 'init') {
      await ensureLoaded(msg);
      parentPort!.postMessage({ type: 'ready', requestId: msg.requestId });
      return;
    }

    if (msg.type === 'classify') {
      await ensureLoaded(msg);
      const text = buildRouterText(msg.input);
      // `padding: 'max_length'` and an explicit BigInt64Array, matching the
      // harness worker that produced the measured numbers. transformers.js
      // hands back a typed array whose element type does not always survive
      // being passed straight into an int64 tensor, and the failure is a native
      // Napi throw rather than a JS error, so it takes the process with it.
      const enc = await tokenizer(text, { truncation: true, max_length: 192, padding: 'max_length' });
      const ids = BigInt64Array.from(Array.from(enc.input_ids.data as ArrayLike<number>, (v) => BigInt(v as number)));
      const am = BigInt64Array.from(Array.from(enc.attention_mask.data as ArrayLike<number>, (v) => BigInt(v as number)));
      const n = ids.length;

      const ort = await loadOrt();
      const out = await session.run({
        input_ids: new ort.Tensor('int64', ids, [1, n]),
        attention_mask: new ort.Tensor('int64', am, [1, n]),
      });

      // Only the two axes the router owns. Reading the rest and handing them up
      // would put a second opinion beside V3's on axes V3 owns.
      //
      // The graph names its outputs `logits_<axis>`. Reading `out[axis]` finds
      // nothing, leaves the result empty, and the host reads that as "no
      // opinion" rather than as a failure, so the router silently never fires.
      const result: Record<string, any> = {};
      for (const axis of ['needs_response', 'dialogue_act']) {
        const t = out[`logits_${axis}`];
        if (!t) continue;
        result[axis] = softmaxTop(Array.from(t.data as ArrayLike<number>), indexToLabel[axis] ?? []);
      }
      if (Object.keys(result).length === 0) {
        throw new Error(`router graph produced no known head; outputs were [${Object.keys(out).join(', ')}]`);
      }
      parentPort!.postMessage({ type: 'result', requestId: msg.requestId, result });
      return;
    }
  } catch (e) {
    parentPort!.postMessage({
      type: 'error',
      requestId: msg?.requestId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});
