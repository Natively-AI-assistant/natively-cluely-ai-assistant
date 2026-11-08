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
import { retireOnnxWorker, trackOnnxWorker } from '../utils/onnxWorkerShutdown';

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
  // The last attempt failed because the files it produced are damaged: the
  // next start() discards them (provider.discardDamaged) instead of resuming.
  damaged?: boolean;
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
  // Whether the files a download produces are complete, when that differs
  // from "usable" (Whisper: an older copy can be usable while the current one
  // is not downloaded). Decides whether start() downloads and what the verify
  // step accepts. Absent = isModelCached.
  isDownloadComplete?(modelId: string): boolean;

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

  // Optional. Called right before the worker is spawned. The provider removes
  // anything a previous, unfinished download left behind and marks the model
  // as "download in progress" on disk, so a quit, crash or cancel from here on
  // can never be mistaken for an installed model (see
  // modelManager.markModelDownloadStarted).
  prepareDownload?(modelId: string): void;

  // Optional. Called when the worker has loaded the finished files, BEFORE
  // isModelCached() is asked to verify them — it clears the in-progress mark.
  finishDownload?(modelId: string): void;

  // Optional. Turns a raw worker error into the sentence the user is shown.
  describeError?(message: string): string;
  // Whether a worker error means the downloaded files themselves are bad.
  isDamagedError?(message: string): boolean;
  // Remove everything the download wrote, so the next attempt starts clean.
  // Absent = deletePartial.
  discardDamaged?(modelId: string): void;

  // Optional. Anything asynchronous the provider needs settled before
  // spawnWorker() (which is synchronous) — e.g. asking the system which proxy
  // applies. Must never reject. Awaited by startWhenReady().
  beforeSpawn?(): Promise<void>;
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

// The singleton lives on globalThis, NOT in a static field — the same rule,
// for the same reason, as the ONNX semaphore (utils/onnxThreadConfig.ts) and
// the shared Nemotron worker registry: build-electron gives every source file
// its own bundle, so a static field is one instance PER BUNDLE. This service
// is "the one owner of every model download" only if LocalWhisperSTT, main and
// the IPC handlers all reach the same object, whichever bundle each was loaded
// from.
function singletonHolder(): { __nativelyLocalModelDownloadServiceV1__?: LocalModelDownloadService } {
  return globalThis as unknown as { __nativelyLocalModelDownloadServiceV1__?: LocalModelDownloadService };
}

export class LocalModelDownloadService {
  private readonly entries = new Map<string, LocalModelDownloadEntry>();
  // Live workers, keyed by `${provider}:${modelId}`. One per modelId.
  private readonly workers = new Map<string, Worker>();
  // Workers that were asked to stop and have not exited yet, per key. A stop
  // is cooperative (see retireOnnxWorker), so a worker inside a native model
  // load lives on for a moment and may still have the model's files open.
  private readonly retiring = new Map<string, Set<Worker>>();
  private readonly emitter = new EventEmitter();
  private readonly opts: Required<Omit<LocalModelDownloadServiceOptions, 'providers' | 'disablePersistence'>> & {
    providers: Map<string, LocalModelDownloadProvider>;
    disablePersistence: boolean;
  };
  private persistenceTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  /**
   * Singleton accessor. main.ts and ipcHandlers.ts both reach the same
   * instance — there is exactly one owner of the in-flight state.
   * Tests that need a fresh instance should pass `opts` to override the
   * persistence path; `__resetForTests()` is available for full isolation.
   */
  static getInstance(): LocalModelDownloadService {
    const g = singletonHolder();
    if (!g.__nativelyLocalModelDownloadServiceV1__) {
      g.__nativelyLocalModelDownloadServiceV1__ = new LocalModelDownloadService();
    }
    return g.__nativelyLocalModelDownloadServiceV1__;
  }

  /**
   * Test-only: replace the singleton with a fresh instance.
   */
  static __resetForTests(): void {
    const g = singletonHolder();
    g.__nativelyLocalModelDownloadServiceV1__?.dispose();
    g.__nativelyLocalModelDownloadServiceV1__ = undefined;
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
        if (downloadCompleteOnDisk(provider, entry.modelId)) {
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
    // The worker of a download that was just cancelled is still on its way
    // out. Starting over now would delete and rewrite files it may hold open
    // (on Windows the delete fails outright and the new worker then loads the
    // stale, half-written ones).
    if ((this.retiring.get(key)?.size ?? 0) > 0) {
      return { success: false, error: 'The previous download of this model is still stopping. Try again in a few seconds.' };
    }
    // If a prior attempt left cancelled/error/interrupted state, purge
    // partial bytes. 'interrupted' is included because a mid-download process
    // kill can leave a corrupt partial that passes the size>0 check in
    // isModelCached but triggers "Protobuf parsing failed" when ORT tries to
    // load it. The Whisper provider keeps its resume points (part files, and
    // ONNX files it re-checks against the server's size): see
    // resumableDownload.ts.
    if (existing && (existing.status === 'cancelled' || existing.status === 'error' || existing.status === 'interrupted')) {
      try {
        if (existing.status === 'error' && existing.damaged && provider.discardDamaged) provider.discardDamaged(modelId);
        else provider.deletePartial(modelId);
      } catch { /* best-effort */ }
    }
    // From here until a worker has loaded the finished files, the model is
    // "download in progress" on disk — not just in this process's memory.
    //
    // Not for a model that is already whole: starting a "download" of an
    // installed model only re-verifies it, and marking it in progress would
    // turn a quit during that check into a full re-download of good files.
    let alreadyOnDisk = false;
    try { alreadyOnDisk = downloadCompleteOnDisk(provider, modelId); } catch { alreadyOnDisk = false; }
    if (!alreadyOnDisk) {
      try { provider.prepareDownload?.(modelId); } catch (e: any) {
        console.warn(`[LocalModelDownloadService] prepareDownload failed for ${modelId}:`, e?.message);
      }
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
   * start(), after giving the provider its chance to prepare (beforeSpawn).
   * This is the entry point every caller that CAN wait should use; start()
   * itself stays synchronous and works from whatever the provider last
   * prepared.
   */
  async startWhenReady(providerName: string, modelId: string): Promise<{ success: boolean; error?: string; alreadyDownloading?: boolean }> {
    const provider = this.opts.providers.get(providerName);
    if (provider?.beforeSpawn) {
      try { await provider.beforeSpawn(); } catch { /* never block a download on preparation */ }
    }
    // Cancel followed straight away by Download: give the cancelled worker its
    // moment to exit instead of refusing the click (start() below still
    // refuses if it has not gone by then).
    await this.waitForRetiring(this.keyOf(providerName, modelId));
    return this.start(providerName, modelId);
  }

  /** Resolves when no stopped worker for `key` is still alive, or after `timeoutMs`. */
  private waitForRetiring(key: string, timeoutMs: number = 10_000): Promise<void> {
    const pending = this.retiring.get(key);
    if (!pending || pending.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
      const timer = setTimeout(finish, timeoutMs);
      (timer as any).unref?.();
      for (const w of pending) {
        w.once('exit', () => { if ((this.retiring.get(key)?.size ?? 0) === 0) finish(); });
      }
    });
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

  /** True once a provider with this name has been registered. */
  hasProvider(providerName: string): boolean {
    return this.opts.providers.has(providerName);
  }

  /** Whether the provider reports this model as fully on disk. False on any error. */
  isModelReady(providerName: string, modelId: string): boolean {
    const provider = this.opts.providers.get(providerName);
    if (!provider) return false;
    try { return provider.isModelCached(modelId); } catch { return false; }
  }

  /**
   * Resolve once `modelId` is fully on disk, starting its download when
   * nothing has started it yet and joining the one in flight when something
   * has. Rejects when the download fails or is cancelled.
   *
   * WHY THIS EXISTS: this service used to be one of two things that could
   * download a model. The other was a meeting start — LocalWhisperSTT spawned
   * its own worker, which fetched the same files into the same paths with no
   * idea a download was already running (the launch-time auto-download, or a
   * click in Settings). Two writers on one file: for transformers models the
   * second truncated what the first was about to load; for Nemotron the
   * loser's rename failed and the resulting "no such file" was then treated
   * as corruption and deleted the model the winner had just finished. Every
   * download now goes through here, and a meeting waits for it.
   *
   * `shouldAbandon` lets a caller that has moved on (meeting stopped) drop its
   * wait without cancelling the download for everyone else.
   */
  async ensureDownloaded(
    providerName: string,
    modelId: string,
    opts: { onProgress?: (progress: number) => void; shouldAbandon?: () => boolean } = {},
  ): Promise<void> {
    if (!this.opts.providers.has(providerName)) {
      throw new Error(`unknown-provider:${providerName}`);
    }
    if (this.isModelReady(providerName, modelId)) return;
    const started = await this.startWhenReady(providerName, modelId);
    if (!started.success) {
      throw new Error(started.error ?? 'The model download could not start.');
    }
    const key = this.keyOf(providerName, modelId);
    await new Promise<void>((resolve, reject) => {
      const settle = (entry: LocalModelDownloadEntry | undefined): boolean => {
        if (!entry) return false;
        if (entry.status === 'complete') { resolve(); return true; }
        if (entry.status === 'downloading' || entry.status === 'verifying') {
          try { opts.onProgress?.(entry.progress); } catch { /* a listener must not break the wait */ }
          return false;
        }
        reject(new Error(entry.error ?? `The model download was ${entry.status}.`));
        return true;
      };
      const unsubscribe = this.subscribe(({ key: k, entry }) => {
        if (k !== key) return;
        if (opts.shouldAbandon?.()) {
          unsubscribe();
          reject(new Error('The wait for the model download was abandoned.'));
          return;
        }
        if (settle(entry)) unsubscribe();
      });
      // start() publishes its first state in a microtask, and a download that
      // was already in flight may have finished between the check above and
      // the subscription: look at the state as it stands right now too.
      if (settle(this.entries.get(key))) unsubscribe();
    });
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
      // The worker LOADED what it downloaded, so the files are whole: lift the
      // in-progress mark, then let isModelCached confirm the right set exists.
      try { provider.finishDownload?.(cur.modelId); } catch { /* verified below */ }
      const ok = (() => {
        try { return downloadCompleteOnDisk(provider, cur.modelId); } catch { return false; }
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
      const raw = msg?.message ? String(msg.message) : 'Worker reported error';
      let shown = raw;
      try { shown = provider.describeError?.(raw) ?? raw; } catch { shown = raw; }
      if (shown !== raw) console.warn(`[LocalModelDownloadService] ${key} failed: ${raw}`);
      let damaged = false;
      try { damaged = provider.isDamagedError?.(raw) === true; } catch { damaged = false; }
      this.setEntry(key, {
        ...cur,
        status: 'error',
        error: shown,
        ...(damaged ? { damaged: true } : {}),
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
    // NEVER worker.terminate(): this worker downloads AND loads the model, so
    // a cancel in the final "loading" phase (or a quit) lands inside a native
    // ONNX session create, and terminating there aborts the whole app — see
    // onnxWorkerShutdown.ts. It is asked to exit at its next idle point
    // instead. The exit handler registered in start() sees it is no longer
    // the live worker for this key and no-ops.
    this.trackRetiring(key, w);
    retireOnnxWorker(w);
    if (!suppressPersistence) this.schedulePersistence();
  }

  private trackRetiring(key: string, w: Worker): void {
    // A stand-in without an exit event (unit tests) cannot be tracked, and
    // must not block the next start() forever.
    if (typeof (w as any)?.once !== 'function') return;
    let set = this.retiring.get(key);
    if (!set) { set = new Set(); this.retiring.set(key, set); }
    set.add(w);
    w.once('exit', () => {
      const cur = this.retiring.get(key);
      if (!cur) return;
      cur.delete(w);
      if (cur.size === 0) this.retiring.delete(key);
    });
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
        //
        // LocalWhisperModelPanel.tsx renders the WHOLE local-whisper-family
        // catalog (getAvailableModels()), which includes the Nemotron entry
        // — so the legacy channel must fire for 'nemotron' too, not just
        // 'whisper'. This was hardcoded to 'whisper' only, meaning even
        // after fixing which provider a Nemotron download routes through
        // (resolveLocalModelProviderName), the panel would see zero
        // progress/complete/error events for it — the download would
        // succeed in the backend while the UI showed nothing happening.
        // Providers with their own dedicated UI (e.g. 'reranker') correctly
        // do NOT need this legacy channel — they only ever use the unified
        // `local-model:${provider}:download-state` channel below.
        if (entry.provider === 'whisper' || entry.provider === 'nemotron') {
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
      // MIGRATION (2026-08-14): drop entries persisted under the WRONG
      // provider for their modelId. Before resolveLocalModelProviderName()
      // existed, every download call site hardcoded 'whisper' — so a failed
      // Nemotron attempt persisted as `whisper:<nemotron-id>` with a stale
      // "init.channelId is required" error. Left in place, that ghost entry
      // re-marks the Nemotron catalog row as errored in the Settings panel
      // on EVERY app launch (the panel merges download-state entries onto
      // models by modelId alone, ignoring provider) — even after the real
      // routing bug was fixed and even when the model is fully installed.
      // Manual state-file surgery doesn't stick either: the running app
      // re-persists its in-memory copy over any external edit. Dropping the
      // mis-keyed entry here, at rehydrate, is the only durable fix. Scoped
      // narrowly to the whisper/nemotron pair (both resolve through
      // resolveLocalModelProviderName); other providers ('reranker', …) have
      // their own id spaces this helper knows nothing about.
      if (
        (e.provider === 'whisper' || e.provider === 'nemotron') &&
        resolveLocalModelProviderName(e.modelId) !== e.provider
      ) {
        console.log(`[LocalModelDownloadService] rehydrate: dropping stale wrong-provider entry ${e.provider}:${e.modelId} (real provider: ${resolveLocalModelProviderName(e.modelId)})`);
        continue;
      }
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
 * Resolves which registered provider ('whisper' or 'nemotron') owns a given
 * local-whisper-catalog modelId, by its real `sessionLayout` in
 * MODEL_CATALOG — not a naive string check, so this stays correct even if
 * catalog entries change.
 *
 * BUG THIS FIXES (2026-08-13): every call site that starts/cancels a local
 * model download (`ipcHandlers.ts`'s `local-whisper-start-download` /
 * `local-whisper-cancel-download` handlers, and `main.ts`'s background
 * auto-download loop) hardcoded the provider name as `'whisper'` — even
 * though `createNemotronDownloadProvider()` was registered back in Task 9
 * specifically to handle the Nemotron catalog entry. Nemotron downloads
 * were therefore ALWAYS routed through the whisper provider's
 * `buildInitMessage()` (which never learned about the dual-channel fix's
 * new `channelId` requirement), producing "Failed to load model:
 * init.channelId is required for sessionLayout \"nemotron-rnnt\"" on every
 * single attempt — the nemotron provider I'd separately fixed for this
 * exact error was registered but never actually invoked. This helper
 * makes the routing correct; both call sites now use it instead of a
 * literal `'whisper'`.
 */
export function resolveLocalModelProviderName(modelId: string): string {
  const { MODEL_CATALOG } = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  return entry?.sessionLayout === 'nemotron-rnnt' ? 'nemotron' : 'whisper';
}

function downloadCompleteOnDisk(provider: LocalModelDownloadProvider, modelId: string): boolean {
  return provider.isDownloadComplete ? provider.isDownloadComplete(modelId) : provider.isModelCached(modelId);
}

/**
 * Shared by both local-STT providers: remove what an unfinished download left
 * behind, then mark the model "download in progress" on disk.
 *
 * The leftover check does not rely on this service's own state file — that
 * file can be missing, stale or from another profile, while the marker sits
 * next to the bytes it describes.
 */
function prepareLocalSttDownload(modelId: string, deletePartial: (id: string) => void): void {
  const mm = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
  if (mm.isModelDownloadIncomplete(modelId)) {
    try { deletePartial(modelId); } catch { /* best-effort; the marker is rewritten below either way */ }
  }
  mm.markModelDownloadStarted(modelId);
}

/**
 * A download worker, started with the system's proxy when there is one (see
 * utils/systemProxy.ts). With no proxy the Worker is created exactly as
 * before — no `env` option at all.
 */
function spawnLocalSttDownloadWorker(): Worker {
  const { Worker } = require('worker_threads') as typeof import('worker_threads');
  const { resolveWhisperWorkerPath } = require('../audio/whisper/workerPathResolver') as typeof import('../audio/whisper/workerPathResolver');
  const { getCachedSystemProxy, workerEnvForProxy } = require('../utils/systemProxy') as typeof import('../utils/systemProxy');
  const env = workerEnvForProxy(getCachedSystemProxy());
  return trackOnnxWorker(env ? new Worker(resolveWhisperWorkerPath(), { env }) : new Worker(resolveWhisperWorkerPath()));
}

async function prepareLocalSttDownloadEnvironment(): Promise<void> {
  const { refreshSystemProxy } = require('../utils/systemProxy') as typeof import('../utils/systemProxy');
  await refreshSystemProxy();
}

function finishLocalSttDownload(modelId: string): void {
  const mm = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
  mm.clearModelDownloadMarker(modelId);
}

/**
 * The sentence shown when a local STT model fails to download or load. The
 * platform decides which remedies may be named: the Visual C++ runtime only
 * on Windows, the macOS version floor only on macOS.
 */
function describeLocalSttDownloadError(message: string): string {
  const { describeLocalModelLoadFailure } = require('../audio/whisper/loadFailure') as typeof import('../audio/whisper/loadFailure');
  const { listMissingVcRuntimeDlls, resolveOnnxBindingDir } = require('../audio/whisper/windowsVcRuntime') as typeof import('../audio/whisper/windowsVcRuntime');
  const bindingDir = resolveOnnxBindingDir();
  return describeLocalModelLoadFailure(message, {
    platform: process.platform,
    missingWindowsRuntimeDlls: listMissingVcRuntimeDlls({ extraDirs: bindingDir ? [bindingDir] : [] }),
    reinstallReplacesDamaged: true,
  });
}

function isDamagedLocalSttDownload(message: string): boolean {
  const { isCorruptModelFailure } = require('../audio/whisper/loadFailure') as typeof import('../audio/whisper/loadFailure');
  return isCorruptModelFailure(message, { platform: process.platform });
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
    isDownloadComplete(modelId: string): boolean {
      const { isModelDownloadComplete } = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
      const { resolveInferenceConfig: rIC } = require('../audio/whisper/inferenceConfig') as typeof import('../audio/whisper/inferenceConfig');
      try {
        return isModelDownloadComplete(modelId, rIC().dtype);
      } catch {
        return isModelDownloadComplete(modelId);
      }
    },
    deletePartial(modelId: string): void {
      // Keeps what a resumed download can reuse; the worker size-checks every
      // kept file against the server before trusting it (resumableDownload.ts).
      const { deleteInterruptedModelDownload } = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
      try { deleteInterruptedModelDownload(modelId); } catch { /* best-effort */ }
    },
    prepareDownload(modelId: string): void {
      prepareLocalSttDownload(modelId, (id) => this.deletePartial(id));
    },
    finishDownload(modelId: string): void {
      finishLocalSttDownload(modelId);
    },
    describeError(message: string): string {
      return describeLocalSttDownloadError(message);
    },
    isDamagedError(message: string): boolean {
      return isDamagedLocalSttDownload(message);
    },
    discardDamaged(modelId: string): void {
      const { discardModelDownload } = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
      discardModelDownload(modelId);
    },
    preflightCheck(): string | null {
      // Preserve the existing macOS 13 Ventura gate from the IPC handler.
      {
        const { onnxRuntimeSupportedOnThisMac, ONNX_MAC_UNSUPPORTED_MESSAGE } = require('../audio/whisper/onnxMacSupport');
        if (!onnxRuntimeSupportedOnThisMac()) return ONNX_MAC_UNSUPPORTED_MESSAGE;
      }
      return null;
    },
    beforeSpawn(): Promise<void> {
      return prepareLocalSttDownloadEnvironment();
    },
    spawnWorker(): Worker {
      return spawnLocalSttDownloadWorker();
    },
    buildInitMessage(modelId: string): unknown {
      const { buildWorkerInitMessage } = require('../audio/whisper/inferenceConfig') as typeof import('../audio/whisper/inferenceConfig');
      return buildWorkerInitMessage(modelId, { forDownload: true });
    },
  };
}

/**
 * Nemotron 3.5 ASR Streaming provider — reuses whisperWorker.ts as the
 * download-and-load worker (its `nemotron-rnnt` init branch fetches the
 * required files via downloadFiles.ts before constructing ONNX sessions),
 * so "download" and "load" stay a single worker lifecycle exactly like
 * every other model family.
 *
 * This worker is entirely one-shot and never shared (spawnWorker() above
 * makes a fresh dedicated Worker per download, torn down on completion/error
 * by terminateWorker()) — it never joins sharedWorkerRegistry.ts's
 * multi-channel lifecycle, so its channelId never needs to coordinate with
 * anything else. It exists purely to satisfy whisperWorker.ts's
 * nemotron-rnnt init branch, which (as of the dual-channel fix) requires a
 * channelId on every init for that sessionLayout — omitting it here made
 * every Nemotron "Download"/"Install" click in Settings fail immediately
 * with "init.channelId is required", since this provider predates that
 * requirement and was never updated for it.
 */
export function createNemotronDownloadProvider(): LocalModelDownloadProvider {
  return {
    name: 'nemotron',
    isModelCached(modelId: string): boolean {
      const { isModelCached } = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
      return isModelCached(modelId as any);
    },
    deletePartial(modelId: string): void {
      const { getModelsDir } = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
      const { deletePartialNemotronFiles } = require('../audio/whisper/nemotron/downloadFiles') as typeof import('../audio/whisper/nemotron/downloadFiles');
      const path = require('path') as typeof import('path');
      deletePartialNemotronFiles(path.join(getModelsDir(), ...modelId.split('/')));
    },
    prepareDownload(modelId: string): void {
      prepareLocalSttDownload(modelId, (id) => this.deletePartial(id));
    },
    finishDownload(modelId: string): void {
      finishLocalSttDownload(modelId);
    },
    describeError(message: string): string {
      return describeLocalSttDownloadError(message);
    },
    isDamagedError(message: string): boolean {
      return isDamagedLocalSttDownload(message);
    },
    discardDamaged(modelId: string): void {
      const { getModelsDir } = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
      const { discardNemotronFiles } = require('../audio/whisper/nemotron/downloadFiles') as typeof import('../audio/whisper/nemotron/downloadFiles');
      const path = require('path') as typeof import('path');
      discardNemotronFiles(path.join(getModelsDir(), ...modelId.split('/')));
    },
    preflightCheck(): string | null {
      // Same macOS-13-floor gate every other local model uses. Interface takes
      // no modelId — getAvailableModels() applies the gate uniformly across
      // the whole catalog (see modelManager.ts:297-308 / getAvailableModels),
      // so any entry's errorMessage reflects the same platform-level check.
      const { getAvailableModels } = require('../audio/whisper/modelManager') as typeof import('../audio/whisper/modelManager');
      const models = getAvailableModels();
      return models.find((m) => m.errorMessage)?.errorMessage ?? null;
    },
    beforeSpawn(): Promise<void> {
      return prepareLocalSttDownloadEnvironment();
    },
    spawnWorker(): Worker {
      return spawnLocalSttDownloadWorker();
    },
    buildInitMessage(modelId: string): unknown {
      const { buildWorkerInitMessage } = require('../audio/whisper/inferenceConfig') as typeof import('../audio/whisper/inferenceConfig');
      // channelId: this worker is a dedicated, one-shot download/verify
      // instance (never shared — see the class doc comment above), so a
      // fixed synthetic id is correct, not a real per-session channel.
      // whisperWorker.ts's nemotron-rnnt init branch requires SOME channelId
      // to be present; onWorkerMessage() above doesn't inspect it at all, so
      // any stable string is fine.
      return { ...(buildWorkerInitMessage(modelId) as object), channelId: 'download' };
    },
  };
}
