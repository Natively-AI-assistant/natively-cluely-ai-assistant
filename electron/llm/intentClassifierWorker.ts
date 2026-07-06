import { parentPort } from 'worker_threads';
import { getBoundedOnnxSessionOptions } from '../utils/onnxThreadConfig';

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
  })();

  try {
    await loadingPromise;
  } catch (e) {
    loadingPromise = null;
    pipe = null;
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
      const result = await pipe(msg.text, msg.labels, { multi_label: false });
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
