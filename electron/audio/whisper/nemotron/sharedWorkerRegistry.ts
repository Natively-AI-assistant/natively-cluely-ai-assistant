/**
 * Main-process registry that lets TWO LocalWhisperSTT instances (mic +
 * system-audio — the default configuration when localWhisperPerChannelEnabled
 * is off) share ONE Nemotron worker (one loaded model, one set of 3 ONNX
 * sessions) instead of each spawning its own. See
 * .superpowers/sdd/2026-08-10-nemotron-local-stt/dual-channel-fix-brief.md
 * for the full design rationale.
 *
 * Worker-side (whisperWorker.ts) already keeps fully isolated per-channel
 * NemotronEngine instances keyed by channelId — this module's whole job is
 * refcounted LIFECYCLE: deciding when to cold-start a worker, when a second
 * caller can just join the existing one, and when the worker actually dies
 * (only once every channel has released it).
 *
 * State lives on globalThis, NOT at module scope — matching
 * electron/utils/onnxThreadConfig.ts's own established precedent (that
 * file's own comment explains why: this module is inlined into multiple
 * esbuild dist bundles, and a per-bundle copy of this state would let two
 * different bundles each believe they own the one-and-only shared worker).
 */

import { Worker } from 'worker_threads';
import { acquireOnnxSlot } from '../../../utils/onnxThreadConfig';

interface PendingReady {
  resolve: () => void;
  reject: (e: Error) => void;
}

interface SharedNemotronWorkerState {
  worker: Worker | null;
  modelId: string | null;
  refCount: number;
  slotRelease: (() => void) | null;
  pendingReady: Map<string, PendingReady>;
  // Serializes acquireSharedNemotronWorker's cold-start-vs-join decision (see
  // that function's own doc comment). Lives on globalThis alongside the rest
  // of this state — NOT as a standalone module-scope `let` — for the exact
  // reason this file's top-of-file comment already gives for `worker`/
  // `refCount`/etc: esbuild inlines this module into multiple dist bundles,
  // and a per-bundle copy of a plain module-scope lock would let two
  // different bundles each believe they hold (or don't hold) the same lock.
  acquireLock: Promise<void>;
}

function getState(): SharedNemotronWorkerState {
  const g = globalThis as unknown as Record<string, SharedNemotronWorkerState | undefined>;
  if (!g.__nativelySharedNemotronWorkerV1__) {
    g.__nativelySharedNemotronWorkerV1__ = {
      worker: null,
      modelId: null,
      refCount: 0,
      slotRelease: null,
      pendingReady: new Map(),
      acquireLock: Promise.resolve(),
    };
  }
  // Defensive: a state object created by an older bundle generation (before
  // this field existed) would otherwise leave `acquireLock` undefined here —
  // the same multi-bundle skew the doc comment above exists to survive.
  if (!g.__nativelySharedNemotronWorkerV1__.acquireLock) {
    g.__nativelySharedNemotronWorkerV1__.acquireLock = Promise.resolve();
  }
  return g.__nativelySharedNemotronWorkerV1__;
}

/**
 * Unconditional reset — used both by the "last channel released, worker
 * intentionally terminated" path and the "worker crashed unexpectedly" path.
 * Rejects any still-pending ready waiters (a channel that was mid-join when
 * the worker died must see a real rejection, not hang forever) so every
 * caller currently inside `acquireSharedNemotronWorker` for this worker
 * generation gets unblocked.
 */
function resetState(state: SharedNemotronWorkerState): void {
  state.worker = null;
  state.modelId = null;
  state.refCount = 0;
  state.slotRelease = null;
  for (const pending of state.pendingReady.values()) {
    pending.reject(new Error('Shared Nemotron worker died before this channel became ready'));
  }
  state.pendingReady.clear();
}

function attachRegistryListeners(state: SharedNemotronWorkerState, worker: Worker): void {
  worker.on('message', (msg: any) => {
    if (!msg || typeof msg !== 'object' || !msg.channelId) return;
    if (msg.type === 'ready') {
      const pending = state.pendingReady.get(msg.channelId);
      if (pending) {
        state.pendingReady.delete(msg.channelId);
        pending.resolve();
      }
    } else if (msg.type === 'error') {
      // Only treat this as an init-time failure if some channel is actually
      // still waiting on it — a post-ready transcribe/setLanguage error also
      // carries channelId (see whisperWorker.ts) but must NOT be treated as
      // an init rejection; LocalWhisperSTT's own per-channel message
      // listener (attached after acquireSharedNemotronWorker resolves)
      // handles those via the normal 'error' postMessage path.
      const pending = state.pendingReady.get(msg.channelId);
      if (pending) {
        state.pendingReady.delete(msg.channelId);
        pending.reject(new Error(msg.message ?? 'Nemotron worker init failed'));
      }
    }
  });

  // Unexpected crash (not `release()`-initiated — that path resets state
  // itself, synchronously, BEFORE calling worker.terminate(), so this
  // listener's `state.worker !== worker` guard correctly no-ops for an
  // expected shutdown and only runs the full reset for a genuine surprise).
  // Every LocalWhisperSTT instance sharing this worker has its OWN 'error'/
  // 'exit' listener attached directly on this same worker object (Node's
  // EventEmitter supports multiple listeners on one event natively) — those
  // are what actually surface a real, visible error to each channel's own
  // consumer. This listener's only job is resetting the REGISTRY's internal
  // bookkeeping so the NEXT acquireSharedNemotronWorker call cold-starts
  // fresh instead of reusing a dead reference.
  worker.on('error', () => {
    if (state.worker !== worker) return;
    const slotRelease = state.slotRelease;
    resetState(state);
    if (slotRelease) slotRelease();
  });

  worker.on('exit', () => {
    if (state.worker !== worker) return;
    const slotRelease = state.slotRelease;
    resetState(state);
    if (slotRelease) slotRelease();
  });
}

// Serializes the "decide cold-start vs. join, and if cold-starting, acquire
// the ONNX slot + spawn the worker" critical section across concurrent
// acquireSharedNemotronWorker calls. Without this, two channels starting
// back-to-back (the realistic case — main.ts constructs both LocalWhisperSTT
// instances at meeting start) could BOTH observe `state.worker === null` and
// BOTH attempt a cold start: the second cold start's acquireOnnxSlot('high',
// 3) call would then race the first's exclusive-mode acquisition and either
// wrongly block for up to 15s then throw, or (worse) succeed and load a
// second, fully redundant set of 3 ONNX sessions — exactly what this whole
// change exists to prevent. Only the fast decide+spawn step is serialized;
// the slow part (waiting for THIS channel's own real `ready`) happens
// OUTSIDE the lock, so a joining channel B is not forced to wait behind
// channel A's entire model load — see the brief's explicit note that a
// joining channel's wait "must wait for the REAL ready event for THIS
// channelId, not just 'the worker object exists'".
//
// Lives on getState().acquireLock (globalThis), not a module-scope `let` —
// see SharedNemotronWorkerState's own doc comment on the field. Deliberately
// NOT reset by resetState(): resetState() can run from the registry's own
// 'error'/'exit' listeners WHILE another acquireSharedNemotronWorker call is
// still inside this critical section (hasn't reached `releaseTurn()` yet —
// e.g. a crash racing a concurrent join). Resetting the lock there would let
// the next caller chain off a fresh resolved promise and enter the critical
// section concurrently with the in-flight one, reintroducing the exact
// double-cold-start race this lock exists to prevent. Only
// __resetSharedNemotronWorkerForTests() (an explicit, test-only, between-
// tests reset) touches it.
/**
 * Acquires (cold-starting if necessary) or joins the shared Nemotron worker
 * for `modelId`, registers `channelId` on it, and resolves once THAT
 * channel's own `ready` has actually arrived (not merely once the worker
 * object exists). Returns a `release()` the caller MUST call exactly once
 * when it's done with this channel (typically from
 * LocalWhisperSTT.beginWorkerTermination).
 */
export async function acquireSharedNemotronWorker(
  modelId: string,
  channelId: string,
  executionProviders: string[],
  cacheDir: string,
  workerPath: string,
): Promise<{ worker: Worker; channelId: string; release: () => void }> {
  const state = getState();

  let capturedWorker!: Worker;
  const myTurn = state.acquireLock;
  let releaseTurn!: () => void;
  state.acquireLock = myTurn.then(() => new Promise<void>((resolve) => { releaseTurn = resolve; }));
  await myTurn;
  try {
    if (state.worker && state.modelId !== modelId) {
      throw new Error(
        `[sharedWorkerRegistry] A shared Nemotron worker is already running model "${state.modelId}" — ` +
        `cannot also load "${modelId}". Only one Nemotron model is supported concurrently.`,
      );
    }
    if (state.worker) {
      // Joining an existing (possibly still-loading) worker.
      capturedWorker = state.worker;
      state.refCount++;
    } else {
      // Cold start — this registry now owns the ONE weight:3 ONNX slot
      // acquisition for Nemotron; LocalWhisperSTT no longer calls
      // acquireOnnxSlot directly for it.
      const slotRelease = await acquireOnnxSlot('high', 3);
      capturedWorker = new Worker(workerPath);
      state.worker = capturedWorker;
      state.modelId = modelId;
      state.refCount = 1;
      state.slotRelease = slotRelease;
      attachRegistryListeners(state, capturedWorker);
    }
  } finally {
    releaseTurn();
  }

  const readyPromise = new Promise<void>((resolve, reject) => {
    state.pendingReady.set(channelId, { resolve, reject });
  });

  capturedWorker.postMessage({
    type: 'init',
    sessionLayout: 'nemotron-rnnt',
    modelId,
    cacheDir,
    executionProviders,
    channelId,
  });

  try {
    await readyPromise;
  } catch (err) {
    // This channel never actually joined — undo its refCount contribution.
    // Guarded by `state.worker === capturedWorker`: if the worker already
    // crashed (attachRegistryListeners' own error/exit handler already reset
    // state and released the slot), there's nothing left here to undo.
    if (state.worker === capturedWorker) {
      state.refCount = Math.max(0, state.refCount - 1);
      if (state.refCount === 0) {
        const slotRelease = state.slotRelease;
        resetState(state);
        try { capturedWorker.terminate(); } catch { /* already dead */ }
        if (slotRelease) slotRelease();
      }
    }
    throw err instanceof Error ? err : new Error(String(err));
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    releaseChannel(state, capturedWorker, channelId);
  };

  return { worker: capturedWorker, channelId, release };
}

function releaseChannel(state: SharedNemotronWorkerState, capturedWorker: Worker, channelId: string): void {
  if (state.worker !== capturedWorker) {
    // The shared worker has already been reset/replaced — either it crashed
    // (attachRegistryListeners already reset state) or an entirely new
    // worker generation has since been cold-started. Either way, this
    // release refers to a generation that's already gone; nothing to
    // decrement or tear down.
    return;
  }
  state.refCount = Math.max(0, state.refCount - 1);
  try {
    capturedWorker.postMessage({ type: 'closeChannel', channelId });
  } catch {
    /* worker may already be gone */
  }
  if (state.refCount > 0) return;
  // Last channel — tear the whole worker down.
  const slotRelease = state.slotRelease;
  resetState(state);
  try { capturedWorker.terminate(); } catch { /* already dead */ }
  if (slotRelease) slotRelease();
}

/**
 * Test-only: reset the registry so a test can re-exercise acquisition from
 * scratch. Not exported in the main barrel — only for the test suite.
 */
export function __resetSharedNemotronWorkerForTests(): void {
  const state = getState();
  resetState(state);
  // NOT done by resetState() itself — see acquireLock's own doc comment
  // above (a concurrent in-flight acquire must not have its lock reset out
  // from under it). This test-only helper runs strictly BETWEEN tests, with
  // no acquire in flight, so resetting it here is safe.
  state.acquireLock = Promise.resolve();
}
