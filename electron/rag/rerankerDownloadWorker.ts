// electron/rag/rerankerDownloadWorker.ts
//
// Download worker for the bge-reranker-base cross-encoder. Speaks the
// LocalModelDownloadService protocol:
//   in:  { type: 'init', requestId, modelId, cacheDir, dtype }
//   out: { type: 'progress', requestId, progress: 0..99 }
//        { type: 'ready', requestId }
//        { type: 'error', requestId, message }
//
// Hosts a @huggingface/transformers AutoTokenizer + AutoModelForSequenceClassification
// load with a progress_callback, writing into `cacheDir`. The result is the
// standard transformers.js v3 flat layout (Xenova/<model>/...) inside the
// `cacheDir`. After 'ready' is posted, the service re-verifies with
// `isModelCached()` (which checks for tokenizer.json + the q8 onnx file).
//
// Distinct from localRerankerWorker.ts which speaks a requestId-based
// inference protocol — this one is download-only.

import { parentPort } from 'worker_threads';

if (!parentPort) throw new Error('rerankerDownloadWorker must be run as a Worker thread');

let initStarted = false;

async function loadTransformers(): Promise<{ AutoModelForSequenceClassification: any; AutoTokenizer: any; env: any }> {
    return (new Function('return import("@huggingface/transformers")')()) as any;
}

parentPort.on('message', async (msg: any) => {
    if (msg.type !== 'init' || initStarted) return;
    initStarted = true;

    const requestId = msg.requestId;
    try {
        const { AutoModelForSequenceClassification, AutoTokenizer, env } = await loadTransformers();
        env.allowRemoteModels = true;
        env.cacheDir = msg.cacheDir;
        env.localModelPath = msg.cacheDir;

        // Aggregator: bytes-weighted progress across all files. transformers.js
        // calls progress_callback(file, status, progress) where status is
        // 'download' | 'done' | 'ready'. We map:
        //   download 0..99%  →  0..95%  of overall
        //   'done'           →  +0.5%  (file complete, more files may follow)
        //   'ready'          →  99%    (model loaded in memory)
        const fileTotals = new Map<string, number>(); // path -> total bytes
        let bytesDownloaded = 0;
        let bytesTotal = 0;

        const progress_callback = (data: any) => {
            try {
                if (data.status === 'download') {
                    const fname = data.file ?? data.path ?? '';
                    const total = data.total ?? 0;
                    const loaded = data.loaded ?? 0;
                    if (total > 0) {
                        fileTotals.set(fname, total);
                        bytesTotal = Array.from(fileTotals.values()).reduce((a, b) => a + b, 0);
                    }
                    // Estimate: sum current `loaded` for active files + 0 for queued.
                    const estLoaded = Array.from(fileTotals.entries()).reduce((acc, [f, t]) => {
                        return acc + (f === fname ? Math.min(loaded, t) : 0);
                    }, 0);
                    bytesDownloaded = estLoaded;
                    const pct = bytesTotal > 0 ? Math.min(99, Math.floor((bytesDownloaded / bytesTotal) * 99)) : 50;
                    parentPort!.postMessage({ type: 'progress', requestId, progress: pct });
                } else if (data.status === 'done') {
                    parentPort!.postMessage({ type: 'progress', requestId, progress: Math.min(99, bytesTotal > 0 ? Math.floor((bytesDownloaded / bytesTotal) * 99) + 1 : 99) });
                } else if (data.status === 'ready') {
                    parentPort!.postMessage({ type: 'progress', requestId, progress: 99 });
                }
            } catch { /* don't kill the load on a progress post failure */ }
        };

        // Load tokenizer + model. Set session_options for bounded thread count
        // so the download/init doesn't itself pressure the BFCArena (this
        // matches the shared onnxThreadConfig approach used elsewhere).
        const sessionOptions = (() => {
            try {
                const { getBoundedOnnxSessionOptions } = require('../utils/onnxThreadConfig');
                return getBoundedOnnxSessionOptions();
            } catch {
                return undefined;
            }
        })();

        await AutoTokenizer.from_pretrained(msg.modelId, {
            progress_callback,
            local_files_only: false,
        });
        await AutoModelForSequenceClassification.from_pretrained(msg.modelId, {
            dtype: msg.dtype || 'q8',
            progress_callback,
            local_files_only: false,
            session_options: sessionOptions,
        } as any);

        parentPort!.postMessage({ type: 'ready', requestId });
    } catch (e: any) {
        parentPort!.postMessage({
            type: 'error',
            requestId,
            message: e?.message || String(e),
        });
    }
});