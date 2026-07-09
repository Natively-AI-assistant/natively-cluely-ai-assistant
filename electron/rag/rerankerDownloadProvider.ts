// electron/rag/rerankerDownloadProvider.ts
//
// Lazy-download provider for the bge-reranker-base cross-encoder (Phase 1/3
// of the smart-retrieval rollout). Follows the same shape as
// createWhisperDownloadProvider (electron/services/LocalModelDownloadService.ts)
// so the existing LocalModelDownloadService can register + drive it without
// service-level changes. Broadcasts on `local-model:reranker:download-state`
// for free.
//
// WHY THIS EXISTS (2026-07-06 reviewer HIGH-4):
// The model is no longer bundled in `resources/models/` — instead, the first
// document-grounded mode activation triggers a lazy download via this
// provider. Trades ~5-15 min of first-activation download time for an
// installer that ships without the 283 MB cross-encoder on disk for users
// who never invoke a custom document-grounded mode (>80% of the install base).
//
// Cache layout: <userData>/local-models/Xenova/bge-reranker-base/
//   tokenizer.json
//   config.json
//   onnx/model_quantized.onnx (~266 MB q8)
// The same layout as the bundled location so the runtime worker can find it
// via its existing modelPath candidate-search without code changes.

import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { Worker } from 'worker_threads';

const RERANKER_MODEL_ID = 'Xenova/bge-reranker-base';
const RERANKER_DTYPE = 'q8'; // quantized variant — see LocalReranker.ts comment

function getLocalModelsDir(): string {
    // Mirror the Whisper modelManager.getModelsDir() pattern but under a
    // distinct `local-models` subdirectory so it doesn't share state with
    // Whisper's `whisper-models` cache.
    try {
        return path.join(app.getPath('userData'), 'local-models');
    } catch {
        // Fallback for tests / ELECTRON_RUN_AS_NODE — same convention the
        // LocalReranker.resolveModelPath() uses. In packaged prod this never
        // fires (app.getPath is always ready by the time providers register).
        const home = process.env.HOME || '';
        if (process.platform === 'darwin') {
            return path.join(home, 'Library/Application Support/natively/local-models');
        }
        // Linux/Windows fallback — best-effort only.
        return path.join(home, '.natively/local-models');
    }
}

function getRerankerModelDir(): string {
    return path.join(getLocalModelsDir(), RERANKER_MODEL_ID);
}

function isModelCached(): boolean {
    const dir = getRerankerModelDir();
    try {
        if (!fs.existsSync(path.join(dir, 'tokenizer.json'))) return false;
        // Check the dtype-specific onnx file exists and is non-zero bytes.
        const onnxFile = path.join(dir, 'onnx', `model_${RERANKER_DTYPE === 'q8' ? 'quantized' : ''}.onnx`);
        if (fs.existsSync(onnxFile) && fs.statSync(onnxFile).size > 0) return true;
        // Some HF repos ship a plain model.onnx without the dtype suffix.
        const onnxAlt = path.join(dir, 'onnx', 'model.onnx');
        if (fs.existsSync(onnxAlt) && fs.statSync(onnxAlt).size > 0) return true;
        return false;
    } catch {
        return false;
    }
}

function deletePartial(): void {
    try { fs.rmSync(getRerankerModelDir(), { recursive: true, force: true }); } catch { /* best-effort */ }
}

function spawnWorker(): Worker {
    // The download worker is a small dedicated script that speaks the
    // LocalModelDownloadService protocol ({type:'progress'/'ready'/'error'})
    // using @huggingface/transformers' built-in progress_callback. The
    // service-resident inference worker (localRerankerWorker.ts) speaks a
    // different requestId-based protocol — they are NOT interchangeable.
    const candidates = [
        path.join(__dirname, 'rerankerDownloadWorker.js'),
        path.join(__dirname, 'rag', 'rerankerDownloadWorker.js'),
        path.join(__dirname, 'electron', 'rag', 'rerankerDownloadWorker.js'),
    ];
    const workerPath = candidates.find(p => fs.existsSync(p)) ?? candidates[0];
    return new Worker(workerPath);
}

function buildInitMessage(modelId: string): unknown {
    return {
        type: 'init',
        modelId,
        cacheDir: getLocalModelsDir(),
        dtype: RERANKER_DTYPE,
    };
}

export const RERANKER_PROVIDER_NAME = 'reranker';

export function createRerankerDownloadProvider() {
    return {
        name: RERANKER_PROVIDER_NAME,
        isModelCached,
        deletePartial,
        preflightCheck(): string | null {
            // No platform-specific gating for the reranker — it runs anywhere
            // @huggingface/transformers' Node ORT backend works.
            return null;
        },
        spawnWorker,
        buildInitMessage,
    };
}

// Export internals for testing.
export const __rerankerDownloadInternals = {
    getLocalModelsDir,
    getRerankerModelDir,
    isModelCached,
    deletePartial,
    RERANKER_MODEL_ID,
    RERANKER_DTYPE,
};