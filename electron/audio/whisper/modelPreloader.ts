/**
 * ModelPreloader — keeps one warm Whisper worker alive in the background
 * so the first recording session starts instantly instead of waiting 2–5s
 * for the model to load off disk into ONNX Runtime.
 *
 * Usage pattern:
 *   1. Call preload(modelId) when the app launches or when local-whisper is selected.
 *   2. When LocalWhisperSTT.start() fires, call takeWarmWorker(modelId).
 *      If a warm worker exists it is handed off (no startup delay).
 *      If not, LocalWhisperSTT falls back to spawning its own worker normally.
 *
 * Only one warm worker is kept alive at a time. The second audio channel
 * (interviewer vs user) will spawn a fresh worker, which is acceptable because
 * the ONNX model weights file is already in the OS disk-cache after the first
 * worker loaded it, making the cold-start much faster than the first load.
 */

import { Worker } from 'worker_threads';
import fs from 'fs';
import { app } from 'electron';
import path from 'path';
import { buildWorkerInitMessage } from './inferenceConfig';
import { resolveWhisperWorkerPath } from './workerPathResolver';
import { acquireOnnxSlot, hasEnoughMemoryForOnnxSession, getMinFreeGBForOnnxSession } from '../../utils/onnxThreadConfig';
import {
    consumePoisonedOnnxLoad,
    isSentinelWithinTtl,
    clearLoadSentinel as clearOnnxLoadSentinel,
    writeLoadSentinel as writeOnnxLoadSentinel,
} from '../../utils/onnxLoadSentinel';

// Recent preload failure cooldown: tracks modelIds that just failed to init
// so we don't hammer them on every app launch / settings toggle / hotkey.
// Persisted to a small JSON file in the userData dir so a failure isn't
// re-attempted across restarts. TTL is short (5 min) — the recovery path is
// the new local-whisper-reset-to-default IPC.
const RECENT_FAILURE_TTL_MS = 5 * 60 * 1000;

// Cross-launch disk sentinel: re-exports of the generalized module keyed on
// the 'whisper' family. The original `WhisperLoadSentinel` type is preserved
// as a structural superset of the generalized record, so call sites and the
// existing `WhisperLoadSentinel.test.mjs` keep compiling without changes.
// `family` is widened to the full `OnnxFamily` union so the generalized
// module's return type assigns cleanly into this alias.
import type { OnnxFamily } from '../../utils/onnxLoadSentinel';
export type WhisperLoadSentinel = {
    family: OnnxFamily;
    modelId: string;
    startedAt: number;
    attempt: number;
};

function recentFailuresPath(): string {
    return path.join(app.getPath('userData'), 'whisper-recent-failures.json');
}

function loadRecentFailures(): Map<string, number> {
    try {
        const raw = fs.readFileSync(recentFailuresPath(), 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, number>;
        const m = new Map<string, number>();
        for (const [k, v] of Object.entries(parsed)) {
            if (typeof k === 'string' && typeof v === 'number' && v > Date.now()) m.set(k, v);
        }
        return m;
    } catch {
        return new Map();
    }
}

function saveRecentFailures(m: Map<string, number>): void {
    try {
        const obj: Record<string, number> = {};
        for (const [k, v] of m.entries()) obj[k] = v;
        // Atomic write (tmp + rename) so a process kill mid-write doesn't
        // leave the JSON half-written. Matches the pattern in
        // SettingsManager.saveSettings(). Without this, loadRecentFailures
        // catches the JSON.parse error and returns an empty map — which
        // silently forgets the cooldown and allows immediate retries.
        const finalPath = recentFailuresPath();
        const tmpPath = `${finalPath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(obj), 'utf-8');
        fs.renameSync(tmpPath, finalPath);
    } catch {
        // best-effort; failure to persist is non-fatal
    }
}

// Whisper-family thin shims over the generalized module so existing call
// sites in `electron/main.ts` and `electron/audio/LocalWhisperSTT.ts` keep
// working byte-identically. New families wire the generalized primitives
// directly (no shim).
export function writeLoadSentinel(modelId: string): void {
    writeOnnxLoadSentinel('whisper', modelId);
}

export function clearLoadSentinel(modelId?: string): void {
    clearOnnxLoadSentinel('whisper', modelId);
}

class ModelPreloader {
    private warmWorker: Worker | null = null;
    private warmModelId: string | null = null;
    private loadingWorker: Worker | null = null;
    private pendingModelId: string | null = null;
    private loading = false;
    // modelId -> epoch ms expiry. A preload for a modelId whose entry is still
    // in the future is a no-op (avoids the same crash firing repeatedly during
    // a session that touches the same bad model). Persisted via the
    // recentFailuresPath() helper above.
    private recentFailures: Map<string, number> = loadRecentFailures();

    /**
     * Warm up a worker for the given model ID.
     * Safe to call multiple times — no-ops if already warm or loading for the same model.
     * Cancels an in-progress load if a different model is requested.
     */
    preload(modelId: string): void {
        if (this.warmModelId === modelId && this.warmWorker) return;
        if (this.pendingModelId === modelId && this.loading) return;

        // Skip if this modelId recently failed — the user has the
        // local-whisper-reset-to-default IPC for the clean recovery path,
        // and re-attempting on every settings toggle would re-trigger the
        // crash. TTL is short; after 5 min we try once more in case the
        // underlying issue resolved itself.
        const failureExpiry = this.recentFailures.get(modelId);
        if (failureExpiry && failureExpiry > Date.now()) {
            console.warn(`[ModelPreloader] Skipping preload for ${modelId} — recent failure cooldown active until ${new Date(failureExpiry).toISOString()}`);
            return;
        }

        // Cross-loader ONNX gate — REFUSE silently if memory is tight. Do NOT
        // surface as a worker error here, or the 5-min persisted failure
        // cooldown above would block future preloads. The user can retry by
        // toggling Settings → Audio when memory frees up. Acquire the slot
        // at HIGH priority (Whisper is latency-critical).
        if (!hasEnoughMemoryForOnnxSession()) {
            console.warn(
                `[ModelPreloader] skipping preload for ${modelId} — free memory below ${getMinFreeGBForOnnxSession()}GB floor (silent skip, not a worker error)`,
            );
            return;
        }

        // Cancel any in-progress load for a different model
        if (this.loadingWorker) {
            this.loadingWorker.terminate();
            this.loadingWorker = null;
        }
        // Tear down warm worker for a different model
        if (this.warmWorker) {
            this.warmWorker.terminate();
            this.warmWorker = null;
            this.warmModelId = null;
        }

        this.loading = true;
        this.pendingModelId = modelId;

        console.log(`[ModelPreloader] Warming worker for ${modelId}...`);

        const workerPath = resolveWhisperWorkerPath();
        // Defensive: a missing/moved workerPath would otherwise throw a
        // cryptic "Worker not constructed" on the next line and leave this
        // instance in a half-loaded state. Bail out cleanly instead.
        if (!workerPath || !fs.existsSync(workerPath)) {
            console.error(`[ModelPreloader] Worker path missing or invalid: ${workerPath}`);
            this.recordFailure(modelId);
            this.loading = false;
            this.pendingModelId = null;
            return;
        }
        // Acquire the shared ONNX slot BEFORE spawning the worker. The release
        // function is wired into the worker's error/exit handlers below — the
        // slot stays held for the lifetime of the worker's session.
        let slotRelease: (() => void) | null = null;
        acquireOnnxSlot('high').then((release) => {
            slotRelease = release;
        }).catch(() => { /* should never reject */ });

        writeLoadSentinel(modelId);
        const w = new Worker(workerPath);
        this.loadingWorker = w;
        // Stash release on the worker object so takeWarmWorker() can hand it
        // off cleanly when LocalWhisperSTT picks up this warm worker.
        (w as any).__slotRelease = () => {
            if (slotRelease) { slotRelease(); slotRelease = null; }
        };
        w.on('exit', (code) => {
            if (code === 0) {
                clearLoadSentinel(modelId);
            } else {
                this.recordFailure(modelId);
            }
            if (this.loadingWorker === w) {
                this.loadingWorker = null;
                this.pendingModelId = null;
                this.loading = false;
            }
            (w as any).__slotRelease?.();
        });
        w.on('error', () => { (w as any).__slotRelease?.(); });

        w.on('message', (msg: any) => {
            if (msg.type === 'ready') {
                clearLoadSentinel(modelId);
                console.log(`[ModelPreloader] Worker warm for ${modelId}`);
                this.warmWorker = w;
                this.loadingWorker = null;
                this.warmModelId = modelId;
                this.pendingModelId = null;
                this.loading = false;
            } else if (msg.type === 'error') {
                console.warn(`[ModelPreloader] Worker init failed: ${msg.message}`);
                this.recordFailure(modelId);
                clearLoadSentinel(modelId);
                w.terminate();
                this.loadingWorker = null;
                this.pendingModelId = null;
                this.loading = false;
            }
        });

        w.on('error', (err) => {
            console.warn('[ModelPreloader] Worker error:', err.message);
            this.recordFailure(modelId);
            this.loadingWorker = null;
            this.pendingModelId = null;
            this.loading = false;
        });

        w.postMessage(buildWorkerInitMessage(modelId));
    }

    private recordFailure(modelId: string): void {
        const expiry = Date.now() + RECENT_FAILURE_TTL_MS;
        this.recentFailures.set(modelId, expiry);
        saveRecentFailures(this.recentFailures);
    }

    recordLoadFailure(modelId: string): void {
        this.recordFailure(modelId);
    }

    consumePoisonedLoadSentinel(): WhisperLoadSentinel | null {
        const sentinel = consumePoisonedOnnxLoad('whisper');
        if (sentinel && isSentinelWithinTtl(sentinel)) {
            console.warn(`[ModelPreloader] Previous process exited while loading ${sentinel.modelId}; recording recent-failure cooldown`);
            this.recordFailure(sentinel.modelId);
            return sentinel;
        }
        return null;
    }

    /**
     * Clear the recent-failure entry for a modelId. Called by the
     * local-whisper-reset-to-default IPC after we successfully swap the
     * active model back to the safe fallback — the bad id is no longer
     * active, so the cooldown shouldn't block a future intentional re-select.
     */
    clearRecentFailure(modelId: string): void {
        if (this.recentFailures.delete(modelId)) {
            saveRecentFailures(this.recentFailures);
        }
    }

    /**
     * Hand off the warm worker to a caller and clear the cache.
     * Returns null if no warm worker is available for that model ID.
     *
     * IMPORTANT: removes ALL of the preloader's listeners (`message`,
     * `error`, `exit`) before handoff — not just `message`. Node's
     * EventEmitter fires every registered listener for an event, not just
     * the most recently added one, so leaving the preloader's `error`/`exit`
     * handlers attached means BOTH the preloader's AND the consumer's
     * handler fire on a live-worker error. The preloader's `error`/`exit`
     * handlers call `recordFailure(modelId)` (modelPreloader.ts ~199-232) —
     * so a transient error on the worker AFTER handoff (while
     * LocalWhisperSTT is actively driving it during a live recording)
     * would silently poison the 5-minute recent-failure cooldown for a
     * model that is demonstrably fine (it's mid-session, not failing to
     * load). The NEXT meeting's pre-warm would then silently skip for up
     * to 5 minutes (preload()'s cooldown check at ~133-137), manifesting as
     * "transcription is slow to start" with no visible error. The consumer
     * (LocalWhisperSTT.attachWorkerListeners) installs its own complete
     * message/error/exit handlers immediately after taking the worker, so
     * removing all three preloader listeners here is safe — the worker is
     * never left without error/exit handling. The ONNX slot release
     * (`__slotRelease`, stashed on the worker object) is unaffected by this
     * — it's read by the CONSUMER's own exit/error handlers, not the
     * preloader's removed ones. Mirrors the listener-cleanup pattern in
     * LocalWhisperSTT.beginWorkerTermination.
     */
    takeWarmWorker(modelId: string): Worker | null {
        if (this.warmModelId === modelId && this.warmWorker) {
            const w = this.warmWorker;
            w.removeAllListeners('message');
            w.removeAllListeners('error');
            w.removeAllListeners('exit');
            this.warmWorker = null;
            this.warmModelId = null;
            console.log(`[ModelPreloader] Handing off warm worker for ${modelId}`);
            return w;
        }
        return null;
    }

    isWarm(modelId: string): boolean {
        return this.warmModelId === modelId && this.warmWorker !== null;
    }

    terminate(): void {
        this.loadingWorker?.terminate();
        this.loadingWorker = null;
        this.warmWorker?.terminate();
        this.warmWorker = null;
        this.warmModelId = null;
        this.pendingModelId = null;
        this.loading = false;
    }
}

export const modelPreloader = new ModelPreloader();
