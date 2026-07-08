// electron/utils/onnxLoadSentinel.ts
//
// Cross-launch disk sentinel for every local ONNX model the app loads.
// Companion to electron/utils/onnxThreadConfig.ts (which guards the cross-loader
// in-memory concurrency gate) and electron/audio/whisper/modelPreloader.ts
// (which owns the Whisper family's in-process recent-failure cooldown).
//
// WHY THIS EXISTS (2026-07-08 audit):
// Every local ONNX consumer (Whisper, intent classifier, embeddings, reranker)
// runs `@huggingface/transformers` + `onnxruntime-node` inside a
// `worker_threads.Worker`. Native onnxruntime-node aborts (BFCArena /
// posix_memalign / libc++ symbol mismatches on macOS 12) can take down the
// host process BEFORE the JS `worker.on('error'|'exit')` listeners fire — so
// the in-memory `nonRecoverableLoadError` / `loadFailed` latches never
// persist across restarts. The original bug: a user-selected Whisper model
// that natively aborted at load kill the app on every launch because the
// catalog-id gate was passed and the recent-failure cooldown hadn't been
// written yet.
//
// WHAT THIS MODULE DOES:
//   - writeLoadSentinel(family, modelId) — atomically records an in-progress
//     load in `<userData>/onnx-load-sentinel-<family>.json` BEFORE the worker
//     is spawned. Synchronous, atomic (tmp+rename) so a power loss can't
//     leave a half-written file.
//   - clearLoadSentinel(family, modelId?) — best-effort removal; a `modelId`
//     arg makes the clear a no-op when the on-disk sentinel is for a
//     DIFFERENT model, so concurrent workers can't clobber each other.
//   - consumePoisonedOnnxLoad(family) — reads + removes the file, returning
//     the previous contents to the caller. Idempotent: second call is a no-op
//     (returns null).
//
// CROSS-FAMILY ISOLATION:
// One file per family. When IntentClassifier / LocalEmbeddingProvider /
// LocalReranker are spawned in the same tick from independent modules, they
// write to different filenames so concurrent writers don't lose updates
// (which a single shared JSON file would suffer under read-modify-write).
// Within a family, the same module's spawn paths coordinate through the
// read-then-atomic-rename pattern, which is how the shipped Whisper
// implementation behaves.
//
// FAIL-OPEN:
// Every read + write wraps fs in try/catch. A disk-full, permission
// failure, or JSON corruption returns `null` (= "no poison"), so the load
// proceeds normally. This module is a SAFETY net — its absence MUST NOT
// turn a working load into a crash. An env flag
// (NATIVELY_ONNX_SENTINEL_DISABLED=1) short-circuits all writes to a no-op
// for emergency rollback.

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/** TTL of a poisoned-load sentinel. After this many ms a fresh load is
 *  attempted. Mirrors `RECENT_FAILURE_TTL_MS` in modelPreloader.ts. A TTL
 *  (not "permanent") is deliberate: a force-quit mid-load is indistinguishable
 *  from a true native abort, so we never permanently disable a family. */
export const ONNX_LOAD_SENTINEL_TTL_MS = 5 * 60 * 1000;

export type OnnxFamily = 'whisper' | 'intent' | 'embeddings' | 'reranker';

export interface OnnxLoadSentinel {
    family: OnnxFamily;
    modelId: string;
    startedAt: number;
    attempt: number;
}

/** Whether the sentinel machinery is active. Honored by every primitive so an
 *  operator can disable the disk layer via env without a redeploy. Default
 *  ON; set NATIVELY_ONNX_SENTINEL_DISABLED=1 in production to opt out. */
function sentinelEnabled(): boolean {
    return process.env.NATIVELY_ONNX_SENTINEL_DISABLED !== '1';
}

function sentinelPath(family: OnnxFamily): string {
    return path.join(app.getPath('userData'), `onnx-load-sentinel-${family}.json`);
}

function readSentinel(family: OnnxFamily): OnnxLoadSentinel | null {
    if (!sentinelEnabled()) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(sentinelPath(family), 'utf-8')) as Partial<OnnxLoadSentinel>;
        if (
            typeof parsed.modelId === 'string' && parsed.modelId.length > 0
            && typeof parsed.startedAt === 'number'
            && typeof parsed.attempt === 'number'
            && parsed.family === family
        ) {
            return {
                family,
                modelId: parsed.modelId,
                startedAt: parsed.startedAt,
                attempt: Math.max(1, Math.floor(parsed.attempt)),
            };
        }
    } catch {
        // absent, corrupt, unreadable — all treated as absent (fail-open)
    }
    return null;
}

/**
 * Record an in-progress load. MUST be called synchronously before
 * `new Worker(...)` so a native abort during load leaves a sentinel file
 * on disk for the next launch to consume.
 *
 * Idempotent on rapid retries for the same modelId: `attempt` increments.
 */
export function writeLoadSentinel(family: OnnxFamily, modelId: string): void {
    if (!sentinelEnabled()) return;
    try {
        const previous = readSentinel(family);
        const next: OnnxLoadSentinel = {
            family,
            modelId,
            startedAt: Date.now(),
            attempt: previous && previous.modelId === modelId ? previous.attempt + 1 : 1,
        };
        const finalPath = sentinelPath(family);
        const tmpPath = `${finalPath}.tmp`;
        // Atomic write (tmp + rename) so a process kill mid-write doesn't
        // leave the JSON half-written. On macOS APFS / Linux ext4 / Windows
        // NTFS the rename is atomic at the filesystem layer for a same-
        // directory source/destination pair, matching the pattern in
        // SettingsManager.saveSettings() and modelPreloader.saveRecentFailures.
        fs.writeFileSync(tmpPath, JSON.stringify(next), 'utf-8');
        fs.renameSync(tmpPath, finalPath);
    } catch (e: any) {
        // fail-open: a permission/disk-full here means the safety net misses
        // one launch's worth of crashloop protection, NOT a blocked load.
        console.warn(`[OnnxLoadSentinel] write failed for ${family}/${modelId}:`, e?.message || e);
    }
}

/**
 * Clear the sentinel. Should be called on `ready` (worker thread posted the
 * ready status) and on clean `exit(0)`.
 *
 * If `modelId` is provided, the clear is a no-op when the on-disk sentinel
 * is for a DIFFERENT model — guards against a fresh worker for model A
 * clobbering a concurrent still-loading sentinel for model B in the same family.
 */
export function clearLoadSentinel(family: OnnxFamily, modelId?: string): void {
    if (!sentinelEnabled()) return;
    try {
        if (modelId) {
            const current = readSentinel(family);
            if (current && current.modelId !== modelId) return;
        }
        fs.unlinkSync(sentinelPath(family));
    } catch {
        // absence is fine — best-effort
    }
}

/**
 * Test-only helper: invalidate a stale sentinel (force a fresh retry).
 * Mirrors `modelPreloader.clearRecentFailure` for the Whisper family.
 */
export function clearAllOnnxLoadSentinels(family: OnnxFamily): void {
    clearLoadSentinel(family);
}

/**
 * Consume the sentinel at cold start. Returns the previous contents (so
 * the caller can stash a recovery notice on AppState + record a recent-
 * failure cooldown), then removes the file. Idempotent — second call
 * returns null.
 *
 * Each family decides its own recovery: Whisper resets the user setting to
 * `Xenova/whisper-tiny.en`; intent skips ONNX warmup this launch; embeddings
 * seeds the in-memory `nonRecoverableLoadError`; reranker seeds `loadFailed`.
 */
export function consumePoisonedOnnxLoad(family: OnnxFamily): OnnxLoadSentinel | null {
    if (!sentinelEnabled()) return null;
    const previous = readSentinel(family);
    if (previous) clearLoadSentinel(family);
    return previous;
}

/**
 * Pure helper for the side: is this sentinel record still within its TTL?
 * Used by tests and by the recovery notice logic to decide whether to
 * still treat a leftover record as authoritative.
 */
export function isSentinelWithinTtl(sentinel: OnnxLoadSentinel, now: number = Date.now()): boolean {
    return now - sentinel.startedAt < ONNX_LOAD_SENTINEL_TTL_MS;
}
