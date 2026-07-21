// Generic, provider-agnostic local-model download service.
//
// WHY THIS EXISTS (2026-06-23):
// The previous `local-whisper-start-download` IPC handler bound the download's
// progress/complete/error events to a single `event.sender` WebContents. When
// the Settings overlay was closed (or the renderer navigated away) mid-download:
//   1. `sender.isDestroyed()` became true and ALL subsequent events were
//      silently dropped (the worker kept downloading, but no UI saw it).
//   2. The `activeWhisperDownloads` set leaked — the `if (sender.isDestroyed())
//      return;` guard fired BEFORE the `ready` handler could `delete(modelId)`,
//      so the same model could not be re-started until the app was relaunched.
//   3. On remount, the React panel had no IPC to ask "what's mid-download?"
//      — it started fresh and showed an empty progress bar forever.
//   4. "Fully downloaded" was set on the worker's `ready` message without
//      re-verifying the disk via `isModelCached` — a dtype change or a torn
//      external-data companion would falsely flip the badge.
//
// THIS SERVICE fixes all four. It is also provider-agnostic — `whisper`
// registers itself today; future model families (vision, embeddings, anything
// that emits progress from a Worker thread) can register a provider without
// changing the IPC surface or the React panel.
//
// SCOPE: this is the single owner of all in-flight local-model downloads. It:
//   - Is instantiated once in main.ts after `app.whenReady()`.
//   - Tracks the full state map (status, progress, error, startedAt) in memory.
//   - Persists the state map to `<userData>/local-model-download-state.json`
//     (debounced) so a `before-quit` + relaunch can re-hydrate.
//   - Broadcasts to ALL live `BrowserWindow` webContents on every event — the
//     sender-agnostic pattern, so panel unmount/remount is irrelevant.
//   - Skips destroyed `webContents` in the broadcast loop (defended in a
//     try/catch in case destroy races mid-iteration).
//   - Sets "fully downloaded" ONLY after re-verifying disk via
//     `provider.isModelCached(modelId)` — never on a raw worker `ready`.
//
// DEFERRED (Option A in the review): true HTTP Range resume across restarts.
// Today, quitting mid-download re-downloads from byte zero on next launch.
// That's acceptable because (a) it unblocks the unmount-during-download bug,
// which is the user-reported issue, and (b) the cost is bounded by total
// bytes, not per-second UX. Future work can plug a Range-aware fetcher into
// the provider's `env.remoteHost` if the UX cost becomes user-visible.

import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';

export type LocalModelDownloadStatus =
  | 'downloading'  // bytes are arriving from the network
  | 'verifying'    // worker emitted `ready`; service is running isModelCached()
  | 'complete'     // disk verified — model is ready to use
  | 'cancelled'    // user-initiated cancel; partial bytes may remain on disk
  | 'error'        // worker errored OR disk verification failed
  | 'interrupted'; // rehydrated after a process restart; no live worker

export interface LocalModelDownloadEntry {
  provider: string;
  modelId: string;
  status: LocalModelDownloadStatus;
  progress: number; // 0..99 (worker reports up to 99; only 'complete' is 100)
  startedAt: number;
  updatedAt: number;
  error?: string;
}

// Provider contract — anything that can download a model via a Worker thread
// and verify its disk presence. Whisper implements this today.
export interface LocalModelDownloadProvider {
  // Stable provider name, e.g. 'whisper'. Used as the lookup key in the
  // state map AND as the IPC channel prefix (`local-model-<provider>-...`).
  readonly name: string;

  // Returns true when the model's files are present on disk AND the dtype
  // requirements are met. Called after the worker emits `ready` to gate
  // "fully downloaded" status. Also called on rehydration to decide whether
  // an `interrupted` entry should flip to `complete`.
  isModelCached(modelId: string): boolean;

  // Cleans any partial bytes on disk for a given modelId. Used on
  // `cancel` to make sure a re-install doesn't try to "resume from a
  // half-file that transformers can't actually continue from".
  deletePartial(modelId: string): void;

  // Optional pre-flight check before starting a download — e.g. macOS 13+
  // gating. Return null on OK; an error string on reject.
  preflightCheck(): string | null;

  // Spawns the worker. The service does NOT know about worker paths,
  // dtype maps, transformers config, etc. — all of that lives in the
  // provider, so the service can be reused for any worker-based download.
  spawnWorker(): Worker;

  // Builds the message to postMessage the worker on init. Provider-owned
  // so the service doesn't have to know about cacheDir / dtype / etc.
  buildInitMessage(modelId: string): unknown;
}

export interface LocalModelDownloadServiceOptions {
  // Override the persistence path. Defaults to `<userData>/local-model-download-state.json`.
  persistencePath?: string;
  // Override debounce for the state-file flush (ms). Defaults to 500ms.
  persistenceDebounceMs?: number;
  // Skip the persistence layer entirely (used in tests).
  disablePersistence?: boolean;
  // Inject providers at construction time. If omitted, the service tries
  // to require() `./audio/whisper/modelManager` etc. lazily — see
  // `registerProvider` for the safer call site.
  providers?: Map<string, LocalModelDownloadProvider>;
}

interface SerializedState {
  v: 1;
  entries: Array<{
    provider: string;
    modelId: string;
    status: LocalModelDownloadStatus;
    progress: number;
    startedAt: number;
    updatedAt: number;
    error?: string;
  }>;
}

export class LocalModelDownloadService {
  private readonly entries = new Map<string, LocalModelDownloadEntry>();
  // Live workers, keyed by `${provider}:${modelId}`. One per modelId.
  private readonly workers = new Map<string, Worker>();
  private readonly emitter = new EventEmitter();
  private readonly opts: Required<Omit<LocalModelDownloadServiceOptions, 'providers' | 'disablePersistence'>> & {
    providers: Map<string, LocalModelDownloadProvider>;
    disablePersistence: boolean;
  };
  private persistenceTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private static _instance: LocalModelDownloadService | null = null;

  /**
   * Singleton accessor. main.ts and ipcHandlers.ts both reach the same
   * instance — there is exactly one owner of the in-flight state.
   * Tests that need a fresh instance should pass `opts` to override the
   * persistence path; `__resetForTests()` is available for full isolation.
   */
  static getInstance(): LocalModelDownloadService {
    if (!this._instance) this._instance = new LocalModelDownloadService();
    return this._instance;
  }

  /**
   * Test-only: replace the singleton with a fresh instance.
   */
  static __resetForTests(): void {
    if (this._instance) this._instance.dispose();
    this._instance = null;
  }

  constructor(opts: LocalModelDownloadServiceOptions = {}) {
    this.opts = {
      persistencePath: opts.persistencePath ?? '',
      persistenceDebounceMs: opts.persistenceDebounceMs ?? 500,
      providers: opts.providers ?? new Map(),
      disablePersistence: opts.disablePersistence ?? false,
    };
    if (!this.opts.persistencePath && !this.opts.disablePersistence) {
      this.opts.persistencePath = this.defaultPersistencePath();
    }
    this.emitter.setMaxListeners(64); // many subscribers is the norm
    // Re-hydrate from disk before any IPC can hit us. Doing it in the
    // constructor (not in main.ts) keeps the lifecycle self-contained —
    // main.ts just instantiates and forgets.
    this.rehydrate();
  }

  // -- Public API ----------------------------------------------------------

  /**
   * Register a provider. Must be called before `start()` for that provider's
   * models. Idempotent — re-registering with the same name is a no-op.
   *
   * Also promotes any `interrupted` entries for this provider that are
   * actually complete on disk. `rehydrate()` runs in the constructor before
   * providers are registered, so the promotion check inside rehydrate() is
   * a no-op (provider not found yet). We redo it here so the UI sees
   * `complete` instead of a stale `interrupted` badge.
   */
  registerProvider(provider: LocalModelDownloadProvider): void {
    this.opts.providers.set(provider.name, provider);
    for (const [key, entry] of this.entries) {
      if (entry.provider !== provider.name || entry.status !== 'interrupted') continue;
      try {
        if (provider.isModelCached(entry.modelId)) {
          this.entries.set(key, { ...entry, status: 'complete', progress: 100 });
          // Broadcast so any open Settings panel sees the updated badge
          // without waiting for the next user interaction.
          queueMicrotask(() => this.broadcastToRenderers(key, this.entries.get(key)!));
        }
      } catch { /* best-effort */ }
    }
    this.schedulePersistence();
  }

  /**
   * Subscribe to all events. Returns an unsubscribe function.
   * Event payload: `{ key, entry }` where `key` is `${provider}:${modelId}`.
   * Listeners must NOT throw — wrap your own work in try/catch.
   */
  subscribe(listener: (event: { key: string; entry: LocalModelDownloadEntry }) => void): () => void {
    this.emitter.on('change', listener);
    return () => { this.emitter.off('change', listener); };
  }

  /**
   * Begin (or resume awareness of) a download. Idempotent: if a download is
   * already in flight for this provider:modelId, returns `{ success: true,
   * alreadyDownloading: true }` immediately. The actual disk+network work is
   * owned by the provider's worker; this method just registers the entry,
   * spawns the worker, and wires up the broadcast.
   */
  start(providerName: string, modelId: string): { success: boolean; error?: string; alreadyDownloading?: boolean } {
    const provider = this.opts.providers.get(providerName);
    if (!provider) return { success: false, error: `unknown-provider:${providerName}` };
    const blocked = provider.preflightCheck();
    if (blocked) return { success: false, error: blocked };
    const key = this.keyOf(providerName, modelId);
    const existing = this.entries.get(key);
    if (existing && (existing.status === 'downloading' || existing.status === 'verifying')) {
      return { success: true, alreadyDownloading: true };
    }
    // If a prior attempt left cancelled/error/interrupted state, purge
    // partial bytes — transformers can't resume from byte 0 (no HTTP Range).
    // 'interrupted' is included because a mid-download process kill can leave
    // a corrupt partial that passes the size>0 check in isModelCached but
    // triggers "Protobuf parsing failed" when ORT tries to load it.
    if (existing && (existing.status === 'cancelled' || existing.status === 'error' || existing.status === 'interrupted')) {
      try { provider.deletePartial(modelId); } catch { /* best-effort */ }
    }
    let worker: Worker;
    try {
      worker = provider.spawnWorker();
    } catch (e: any) {
      this.setEntry(key, {
        provider: providerName,
        modelId,
        status: 'error',
        progress: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        error: `Failed to spawn worker: ${e?.message ?? String(e)}`,
      });
      return { success: false, error: e?.message ?? String(e) };
    }
    this.workers.set(key, worker);
    this.setEntry(key, {
      provider: providerName,
      modelId,
      status: 'downloading',
      progress: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    worker.on('message', (msg: any) => this.onWorkerMessage(key, msg));
    worker.on('error', (err: Error) => this.onWorkerError(key, err));
    // Worker exit without a `ready` or `error` message: treat as interrupted.
    // This catches abnormal exits (process kill, native crash, OOM).
    worker.on('exit', (code: number) => {
      if (this.workers.get(key) !== worker) return; // already cleaned up
      if (code === 0) return; // 0 exit after our own terminate()
      const cur = this.entries.get(key);
      if (cur && (cur.status === 'downloading' || cur.status === 'verifying')) {
        this.setEntry(key, {
          ...cur,
          status: 'error',
          error: `Worker exited unexpectedly (code ${code})`,
          updatedAt: Date.now(),
        });
      }
    });
    try {
      worker.postMessage(provider.buildInitMessage(modelId));
    } catch (e: any) {
      this.terminateWorker(key);
      this.setEntry(key, {
        provider: providerName,
        modelId,
        status: 'error',
        progress: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        error: `Failed to post init: ${e?.message ?? String(e)}`,
      });
      return { success: false, error: e?.message ?? String(e) };
    }
    return { success: true };
  }

  /**
   * Explicit user-initiated cancel. Terminates the worker and marks the entry
   * `cancelled`; on next `start()` the provider will delete any partial bytes.
   * Safe to call when no download is in flight — returns `{ success: false }`.
   */
  cancel(providerName: string, modelId: string): { success: boolean; error?: string } {
    const key = this.keyOf(providerName, modelId);
    const existing = this.entries.get(key);
    if (!existing || (existing.status !== 'downloading' && existing.status !== 'verifying')) {
      return { success: false, error: 'not-downloading' };
    }
    this.terminateWorker(key);
    this.setEntry(key, {
      ...existing,
      status: 'cancelled',
      updatedAt: Date.now(),
    });
    return { success: true };
  }

  /**
   * Read-only snapshot of the in-memory state. With a `providerName`,
   * returns the single entry or null. Without, returns all entries.
   */
  getState(providerName?: string, modelId?: string): LocalModelDownloadEntry[] | LocalModelDownloadEntry | null {
    if (providerName && modelId) {
      return this.entries.get(this.keyOf(providerName, modelId)) ?? null;
    }
    if (providerName) {
      return [...this.entries.values()].filter(e => e.provider === providerName);
    }
    return [...this.entries.values()];
  }

  /**
   * Called from `before-quit`. Synchronously writes the current state to
   * disk (bypassing the debounce) and terminates every worker so the
   * transformers HTTP fetcher is killed mid-flight rather than leaking
   * across the process boundary.
   */
  pauseForShutdown(): void {
    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = null;
    }
    for (const key of [...this.workers.keys()]) {
      const cur = this.entries.get(key);
      if (cur && (cur.status === 'downloading' || cur.status === 'verifying')) {
        // Mark as interrupted so on next launch we re-verify disk and
        // either complete (files actually landed) or surface the user a
        // clear "interrupted, would you like to resume?" choice via the UI.
        this.entries.set(key, { ...cur, status: 'interrupted', updatedAt: Date.now() });
      }
      this.terminateWorker(key, /* suppressPersistence */ true);
    }
    this.flushPersistenceSync();
  }

  /**
   * Test-only / shutdown-only. Frees all resources without persisting.
   * Production code should call `pauseForShutdown()` instead.
   */
  dispose(): void {
    this.disposed = true;
    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = null;
    }
    for (const key of [...this.workers.keys()]) {
      this.terminateWorker(key, /* suppressPersistence */ true);
    }
    this.emitter.removeAllListeners();
  }

  // -- Internals -----------------------------------------------------------

  private keyOf(providerName: string, modelId: string): string {
    return `${providerName}:${modelId}`;
  }

  private setEntry(key: string, entry: LocalModelDownloadEntry): void {
    this.entries.set(key, entry);
    this.schedulePersistence();
    // Defer the broadcast so React (the only consumer today) sees one
    // notification per state change rather than one per micro-set.
    queueMicrotask(() => {
      try {
        this.emitter.emit('change', { key, entry });
      } catch (e) {
        // Never let a listener error break the service.
        console.error('[LocalModelDownloadService] listener threw:', e);
      }
      this.broadcastToRenderers(key, entry);
    });
  }

  private onWorkerMessage(key: string, msg: any): void {
    const cur = this.entries.get(key);
    if (!cur) return; // entry vanished (e.g. cancel race) — drop
    const provider = this.opts.providers.get(cur.provider);
    if (!provider) return;
    if (msg?.type === 'progress' && typeof msg.progress === 'number') {
      // Worker emits 0..99 only; complete (100) is set here on disk verify.
      const clamped = Math.max(0, Math.min(99, Math.round(msg.progress)));
      if (cur.status !== 'downloading') return;
      this.setEntry(key, { ...cur, progress: clamped, updatedAt: Date.now() });
    } else if (msg?.type === 'ready') {
      // CRITICAL: do NOT mark complete yet. The worker says "pipeline loaded"
      // — we say "files verified on disk". This is the gate that fixed the
      // "fully downloaded" bug for dtype changes and torn external-data
      // companions.
      this.setEntry(key, { ...cur, status: 'verifying', progress: 99, updatedAt: Date.now() });
      const ok = (() => {
        try { return provider.isModelCached(cur.modelId); } catch { return false; }
      })();
      const after = this.entries.get(key);
      if (!after) return; // cancel fired during the verify
      if (ok) {
        this.terminateWorker(key);
        this.setEntry(key, { ...after, status: 'complete', progress: 100, updatedAt: Date.now() });
      } else {
        // Files incomplete — most often dtype changed mid-flight OR the
        // `.onnx_data` companion never finished. Clean partials so the next
        // install starts fresh; surface a clear error so the UI can offer
        // a Retry button.
        try { provider.deletePartial(cur.modelId); } catch { /* best-effort */ }
        this.terminateWorker(key);
        this.setEntry(key, {
          ...after,
          status: 'error',
          error: 'Model files incomplete after download. Please retry.',
          updatedAt: Date.now(),
        });
      }
    } else if (msg?.type === 'error') {
      this.terminateWorker(key);
      this.setEntry(key, {
        ...cur,
        status: 'error',
        error: msg?.message ? String(msg.message) : 'Worker reported error',
        updatedAt: Date.now(),
      });
    }
    // Unknown message shapes are ignored silently — forward-compat for
    // future worker message types we don't know about yet.
  }

  private onWorkerError(key: string, err: Error): void {
    const cur = this.entries.get(key);
    if (!cur) return;
    if (cur.status === 'complete' || cur.status === 'cancelled') return; // late
    this.terminateWorker(key);
    this.setEntry(key, {
      ...cur,
      status: 'error',
      error: err?.message ? String(err.message) : 'Worker crashed',
      updatedAt: Date.now(),
    });
  }

  private terminateWorker(key: string, suppressPersistence = false): void {
    const w = this.workers.get(key);
    if (!w) return;
    this.workers.delete(key);
    // terminate() returns a Promise we deliberately don't await — fire and
    // forget. The exit handler we registered will run for abnormal exits,
    // but we've already cleaned up the entry above so the late exit will
    // no-op (cur.status is no longer 'downloading' / 'verifying').
    try { w.terminate(); } catch { /* worker already gone */ }
    if (!suppressPersistence) this.schedulePersistence();
  }

  private broadcastToRenderers(key: string, entry: LocalModelDownloadEntry): void {
    if (this.disposed) return;
    let windows: BrowserWindow[];
    try {
      windows = BrowserWindow.getAllWindows();
    } catch {
      return; // no electron context (e.g. test env) — skip silently
    }
    const channel = `local-model:${entry.provider}:download-state`;
    const payload = {
      provider: entry.provider,
      modelId: entry.modelId,
      status: entry.status,
      progress: entry.progress,
      error: entry.error,
    };
    for (const win of windows) {
      if (win.isDestroyed()) continue;
      const wc = win.webContents;
      if (!wc || wc.isDestroyed()) continue;
      try {
        // Back-compat channel: existing listeners (LocalWhisperModelPanel)
        // subscribe to the old per-modelId channel. Emit BOTH so the legacy
        // UI keeps working during migration AND any new generic listener
        // gets the unified shape.
        if (entry.provider === 'whisper') {
          if (entry.status === 'complete') {
            try { wc.send('local-whisper-download-complete', { modelId: entry.modelId }); } catch { /* ignore */ }
          } else if (entry.status === 'error') {
            try { wc.send('local-whisper-download-error', { modelId: entry.modelId, error: entry.error ?? 'Download failed' }); } catch { /* ignore */ }
          } else if (entry.status === 'downloading' || entry.status === 'verifying') {
            try { wc.send('local-whisper-download-progress', { modelId: entry.modelId, progress: entry.progress }); } catch { /* ignore */ }
          }
        }
        // New unified channel.
        try { wc.send(channel, payload); } catch { /* ignore */ }
      } catch (e) {
        // webContents can be destroyed between our isDestroyed() check and
        // the .send() call — never let a destroyed window crash the loop.
      }
    }
  }

  // -- Persistence ---------------------------------------------------------

  private defaultPersistencePath(): string {
    try {
      return path.join(app.getPath('userData'), 'local-model-download-state.json');
    } catch {
      // No electron context (test). Caller should pass persistencePath explicitly.
      return '';
    }
  }

  private schedulePersistence(): void {
    if (this.opts.disablePersistence) return;
    if (!this.opts.persistencePath) return;
    if (this.persistenceTimer) return;
    this.persistenceTimer = setTimeout(() => {
      this.persistenceTimer = null;
      this.flushPersistenceAsync();
    }, this.opts.persistenceDebounceMs);
  }

  private flushPersistenceAsync(): void {
    const p = this.opts.persistencePath;
    if (!p) return;
    const serialized = this.serialize();
    // Fire-and-forget; safe because rehydration tolerates a stale read on
    // the next launch (worst case: an entry is briefly `interrupted`).
    fs.promises.writeFile(p, JSON.stringify(serialized, null, 2), 'utf8')
      .catch((e) => console.warn('[LocalModelDownloadService] persistence write failed:', e?.message));
  }

  private flushPersistenceSync(): void {
    const p = this.opts.persistencePath;
    if (!p) return;
    try {
      fs.writeFileSync(p, JSON.stringify(this.serialize(), null, 2), 'utf8');
    } catch (e: any) {
      console.warn('[LocalModelDownloadService] persistence write failed:', e?.message);
    }
  }

  private serialize(): SerializedState {
    return {
      v: 1,
      entries: [...this.entries.values()].map(e => ({ ...e })),
    };
  }

  private rehydrate(): void {
    if (this.opts.disablePersistence) return;
    const p = this.opts.persistencePath;
    if (!p || !fs.existsSync(p)) return;
    let parsed: SerializedState | null = null;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      parsed = JSON.parse(raw);
    } catch (e: any) {
      console.warn('[LocalModelDownloadService] rehydrate parse failed:', e?.message);
      return;
    }
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.entries)) return;
    for (const e of parsed.entries) {
      if (!e || !e.provider || !e.modelId) continue;
      const key = this.keyOf(e.provider, e.modelId);
      // A previously-'downloading' or 'verifying' entry has no live worker
      // (process restarted). Flip to 'interrupted' so the UI can show a
      // clear state and the user can choose to retry. If the providers
      // are already registered AND the files are now actually on disk,
      // we can promote straight to 'complete'.
      let status: LocalModelDownloadStatus = e.status;
      if (status === 'downloading' || status === 'verifying') {
        status = 'interrupted';
      }
      if (status === 'interrupted') {
        const provider = this.opts.providers.get(e.provider);
        if (provider) {
          try {
            if (provider.isModelCached(e.modelId)) {
              status = 'complete';
            }
          } catch { /* best-effort */ }
        }
      }
      // Cancelled entries: on next start() the service will call
      // deletePartial() to clean up torn bytes. No work to do at rehydrate.
      this.entries.set(key, {
        provider: e.provider,
        modelId: e.modelId,
        status,
        progress: status === 'complete' ? 100 : e.progress,
        startedAt: e.startedAt,
        updatedAt: e.updatedAt,
        error: e.error,
      });
    }
  }
}

/**
 * Whisper provider — the first consumer of this service. Wired up from
 * main.ts after `app.whenReady()` so it can lazy-require `electron` and the
 * whisper model manager without circular-init pain.
 *
 * The provider is intentionally minimal: it does NOT carry state of its own
 * (all state lives in the service). It only knows how to spawn a worker,
 * build the init message, and verify / clean disk.
 */
export function createWhisperDownloadProvider(): LocalModelDownloadProvider {
  return {
    name: 'whisper',
    isModelCached(modelId: string): boolean {
      const { isModelCached } = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
      const { resolveInferenceConfig: rIC } = require('../audio/whisper/inferenceConfig') as typeof import('../audio/whisper/inferenceConfig');
      try {
        const { dtype } = rIC();
        return isModelCached(modelId as any, dtype);
      } catch {
        return isModelCached(modelId as any);
      }
    },
    deletePartial(modelId: string): void {
      const { deleteModel } = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
      try { deleteModel(modelId as any); } catch { /* best-effort */ }
    },
    preflightCheck(): string | null {
      // Preserve the existing macOS 13 Ventura gate from the IPC handler.
      if (process.platform === 'darwin') {
        const os = require('os') as typeof import('os');
        const darwinMajor = parseInt(os.release().split('.')[0], 10);
        if (Number.isNaN(darwinMajor) || darwinMajor < 22) {
          return 'Local Whisper models require macOS 13 Ventura or later.';
        }
      }
      return null;
    },
    spawnWorker(): Worker {
      const { Worker } = require('worker_threads');
      // Use the existing resolver that handles both bundling layouts:
      //   - Unbundled: this service runs from dist-electron/electron/services/;
      //     worker lives at dist-electron/electron/audio/whisper/whisperWorker.js.
      //   - Bundled: this code is inlined into main.js (dist-electron/electron/);
      //     worker lives at dist-electron/electron/audio/whisper/whisperWorker.js.
      // In BOTH cases the worker is reachable as __dirname + 'audio/whisper/whisperWorker.js'
      // because esbuild's `outbase: rootDir` preserves the `electron/` segment.
      // The `..` was a leftover from an earlier draft that resolved wrongly when
      // bundled (would produce dist-electron/audio/... — missing the `electron/`
      // segment), manifesting at runtime as "Cannot find module" with no
      // error in dev paths.
      const workerPath = path.join(__dirname, 'audio', 'whisper', 'whisperWorker.js');
      return new Worker(workerPath);
    },
    buildInitMessage(modelId: string): unknown {
      const { buildWorkerInitMessage } = require('../audio/whisper/inferenceConfig') as typeof import('../audio/whisper/inferenceConfig');
      return buildWorkerInitMessage(modelId);
    },
  };
}
