import { parentPort } from 'worker_threads';
import { getBoundedOnnxSessionOptions } from '../utils/onnxThreadConfig';
import { classifyWorkerFailure } from '../utils/workerStatus';

if (!parentPort) throw new Error('intentClassifierWorker must be run as a Worker thread');

let pipe: any = null;
let loadingPromise: Promise<void> | null = null;

async function loadTransformers(): Promise<{ pipeline: any; env: any }> {
  return (new Function('return import("@huggingface/transformers")')()) as any;
}

async function ensureLoaded(msg: any): Promise<void> {
  if (pipe) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { pipeline, env } = await loadTransformers();

    if (msg.isPackaged) {
      env.allowRemoteModels = false;
      env.localModelPath = msg.localModelPath;
    } else {
      env.allowRemoteModels = true;
      env.cacheDir = msg.cacheDir;
    }

    console.log('[IntentClassifierWorker] Loading zero-shot classifier (mobilebert-uncased-mnli)...');
    pipe = await pipeline(
      'zero-shot-classification',
      'Xenova/mobilebert-uncased-mnli',
      { local_files_only: !!msg.isPackaged, session_options: getBoundedOnnxSessionOptions() }
    );
    console.log('[IntentClassifierWorker] Zero-shot classifier loaded successfully.');
    parentPort!.postMessage({ type: 'status', status: { type: 'ready', backend: 'onnx', modelPath: msg.localModelPath } });
  })();

  try {
    await loadingPromise;
  } catch (e) {
    loadingPromise = null;
    pipe = null;
    const failure = classifyWorkerFailure(e);
    parentPort!.postMessage({
      type: 'status',
      status: {
        type: failure.recoverable ? 'degraded' : 'failed',
        backend: 'regex',
        reason: failure.reason,
        message: failure.message,
        recoverable: failure.recoverable,
      },
    });
    throw e;
  }
}

parentPort.on('message', async (msg: any) => {
  try {
    if (msg.type === 'init') {
      await ensureLoaded(msg);
      parentPort!.postMessage({ type: 'ready', requestId: msg.requestId });
      return;
    }

    if (msg.type === 'classify') {
      if (!pipe) {
        await ensureLoaded(msg);
      }
      // Campaign 2 longsession (2026-07-19): optional hypothesisTemplate
      // passthrough so a second caller (AnswerRelevanceChecker) can reuse
      // this SAME worker/ONNX session for a differently-framed zero-shot
      // check (answer-relevance entailment) without spinning up a second
      // model load. Additive — omitted entirely by the existing
      // IntentClassifier.ts caller, so intent classification is byte-for-
      // byte unaffected (transformers.js defaults to "This example is {}."
      // when the option is undefined).
      const options: Record<string, any> = { multi_label: false };
      if (typeof msg.hypothesisTemplate === 'string' && msg.hypothesisTemplate.length > 0) {
        options.hypothesis_template = msg.hypothesisTemplate;
      }
      const result = await pipe(msg.text, msg.labels, options);
      parentPort!.postMessage({
        type: 'result',
        requestId: msg.requestId,
        labels: result.labels,
        scores: result.scores,
      });
      return;
    }

    parentPort!.postMessage({
      type: 'error',
      requestId: msg.requestId,
      error: `Unknown message type: ${msg.type}`,
    });
  } catch (e: any) {
    parentPort!.postMessage({
      type: 'error',
      requestId: msg.requestId,
      error: e?.message || String(e),
    });
  }
});
