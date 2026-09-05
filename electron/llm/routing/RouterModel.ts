// electron/llm/routing/RouterModel.ts
//
// Host for the interaction router's worker: lifecycle, the on-disk poison
// sentinel, and the ONNX concurrency slot.
//
// FAILURE IS ALWAYS SILENT HERE, AND THAT IS DELIBERATE.
//
// Every path returns null rather than throwing. The router owns whether the
// assistant speaks, so a router that throws would take the answer with it. A
// router that returns null hands the decision back to whatever decided it
// before, which is the behaviour this ships next to and behind a flag.
//
// The sentinel is written BEFORE the worker starts, for the reason the sibling
// loaders document: a native crash inside session creation kills the process
// without unwinding, so an in-memory guard never survives to record it. The
// file does. On the next launch the poisoned load is consumed and the model is
// not attempted again until the TTL lapses.

import { Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import { acquireOnnxSlot, hasEnoughMemoryForOnnxSession } from '../../utils/onnxThreadConfig';
import {
  writeLoadSentinel, clearLoadSentinel, consumePoisonedOnnxLoad, isSentinelWithinTtl,
} from '../../utils/onnxLoadSentinel';
import type { LocalWorkerStatus } from '../../utils/workerStatus';
import { isInteractionRouterEnabled } from './flag';
import type { NeedsResponse, DialogueAct, RouterPrediction } from './IntentFrame';

export const ROUTER_MODEL_ID = 'natively/router-minilm-multihead';

/** Session creation is about 140ms measured; this is the ceiling for it. */
const LOAD_TIMEOUT_MS = 5000;

export interface RouterInput {
  turn: string;
  mode: string;
  channel: string;
  history?: string[];
  modeHasReferenceFiles?: boolean;
}

type Pending = { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout };

export class RouterModel {
  private static instance: RouterModel | null = null;
  private worker: Worker | null = null;
  private requestId = 0;
  private pending = new Map<number, Pending>();
  private status: LocalWorkerStatus | null = null;
  private disabledUntilRestart = false;
  private loaded = false;

  static getInstance(): RouterModel {
    if (!RouterModel.instance) RouterModel.instance = new RouterModel();
    return RouterModel.instance;
  }

  /** Reset between tests. Never called in production. */
  static resetForTests(): void {
    RouterModel.instance?.dispose();
    RouterModel.instance = null;
  }

  /**
   * Where the model actually is.
   *
   * Candidate search, not a single computed path, and it PROBES for a file the
   * model must contain rather than trusting a directory to exist. This follows
   * LocalEmbeddingProvider, which documents why: esbuild bundles with
   * `bundle: true` and inlines this file, so a `__dirname` relative path is
   * fragile and resolves differently depending on which entry pulled it in. The
   * first version of this method computed `dist-electron/resources/models`,
   * which does not exist.
   *
   * The order matters. An explicit override wins, then the packaged resources
   * directory, then the repo layout at the depths `electron .` and a
   * dist-electron launch each produce.
   */
  private modelDir(): string {
    const leaf = path.join('natively', 'router-minilm-multihead');
    const probe = path.join(leaf, 'heads.json');
    const candidates: string[] = [];
    if (process.env.NATIVELY_LOCAL_MODELS_PATH) candidates.push(process.env.NATIVELY_LOCAL_MODELS_PATH);
    if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'models'));
    // `app` is absent under ELECTRON_RUN_AS_NODE and in a plain node test, so
    // it is reached for defensively rather than imported at module scope.
    let appPath = '';
    try {
      const electron = require('electron');
      appPath = electron?.app?.getAppPath?.() ?? '';
    } catch { /* not an Electron context */ }
    if (appPath) {
      candidates.push(path.join(appPath, 'resources', 'models'));
      candidates.push(path.join(appPath, '..', 'resources', 'models'));
      candidates.push(path.join(appPath, '..', '..', 'resources', 'models'));
    }
    candidates.push(path.join(__dirname, '..', '..', '..', '..', 'resources', 'models'));
    for (const c of candidates) {
      try { if (fs.existsSync(path.join(c, probe))) return path.join(c, leaf); } catch { /* keep trying */ }
    }
    return path.join(candidates.find(Boolean) ?? '.', leaf);
  }

  private workerPath(): string {
    const candidates = [
      path.join(__dirname, 'routerWorker.js'),
      path.join(__dirname, 'routing', 'routerWorker.js'),
      path.join(__dirname, 'llm', 'routing', 'routerWorker.js'),
      path.join(__dirname, 'electron', 'llm', 'routing', 'routerWorker.js'),
    ];
    let resolved = candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
    // fs.existsSync is TRUE inside app.asar, so this rewrite cannot be driven by
    // an existence check alone. It is paired with an asarUnpack glob for
    // electron/llm/routing/**, without which the Worker constructor is handed a
    // path inside the archive and fails at runtime only in a packaged build.
    if (resolved.includes('app.asar') && !resolved.includes('app.asar.unpacked')) {
      resolved = resolved.replace('app.asar', 'app.asar.unpacked');
    }
    return resolved;
  }

  /**
   * Is the router usable right now?
   *
   * Flag, then a previous launch's poisoned load, then free memory. Checked in
   * that order because the cheapest and most decisive answer is first.
   */
  isAvailable(persistedFlag: boolean | null = null): boolean {
    if (!isInteractionRouterEnabled(persistedFlag)) return false;
    if (this.disabledUntilRestart) return false;
    const poisoned = consumePoisonedOnnxLoad('router');
    if (poisoned && isSentinelWithinTtl(poisoned)) {
      this.disabledUntilRestart = true;
      return false;
    }
    if (!fs.existsSync(this.modelDir())) return false;
    return true;
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    writeLoadSentinel('router', ROUTER_MODEL_ID);
    const w = new Worker(this.workerPath());
    w.on('message', (msg: any) => {
      if (msg?.type === 'status') {
        this.status = msg.status;
        if (msg.status?.type === 'ready') clearLoadSentinel('router', ROUTER_MODEL_ID);
        return;
      }
      const p = this.pending.get(msg?.requestId);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.requestId);
      if (msg.type === 'error') p.reject(new Error(msg.error));
      else p.resolve(msg.result ?? null);
    });
    w.on('error', () => { this.failAllPending(); this.worker = null; this.loaded = false; });
    w.on('exit', () => { this.failAllPending(); this.worker = null; this.loaded = false; });
    // The router must never be the reason the process stays alive.
    w.unref();
    this.worker = w;
    return w;
  }

  private failAllPending(): void {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('router worker gone')); }
    this.pending.clear();
  }

  private post(payload: Record<string, unknown>, timeoutMs: number): Promise<any> {
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('router timeout'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.getWorker().postMessage({ ...payload, requestId, modelDir: this.modelDir() });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(e);
      }
    });
  }

  /**
   * Classify one turn, or return null.
   *
   * Null means "no opinion", and every caller must treat it as such rather than
   * as a prediction of `no`. Those are opposite instructions: one says stay
   * quiet, the other says fall back to whatever decided this before.
   */
  async classify(input: RouterInput, { timeoutMs = 60, persistedFlag = null as boolean | null } = {}): Promise<RouterPrediction | null> {
    if (!this.isAvailable(persistedFlag)) return null;
    if (!hasEnoughMemoryForOnnxSession()) return null;

    // The first call pays for the session creation, measured at about 140ms,
    // which no per-turn budget should be sized around. Without this the router
    // could never answer its first turn and would look broken rather than cold.
    // `warmup()` exists so that cost lands at startup instead, but a caller that
    // forgets to call it still gets a working router rather than a silent one.
    const budget = this.loaded ? timeoutMs : Math.max(timeoutMs, LOAD_TIMEOUT_MS);

    let release: (() => void) | null = null;
    try {
      release = await acquireOnnxSlot('normal', 1);
      const r = await this.post({
        type: 'classify',
        input: {
          turn: input.turn, mode: input.mode, channel: input.channel,
          history: input.history ?? [], modeHasReferenceFiles: !!input.modeHasReferenceFiles,
        },
      }, budget);
      this.loaded = true;
      if (!r?.needs_response || !r?.dialogue_act) return null;
      return {
        needs_response: r.needs_response.label as NeedsResponse,
        dialogue_act: r.dialogue_act.label as DialogueAct,
        confidence: {
          needs_response: r.needs_response.score,
          dialogue_act: r.dialogue_act.score,
        },
        alternatives: {
          needs_response: r.needs_response.alternatives,
          dialogue_act: r.dialogue_act.alternatives,
        },
        provenance: 'primary',
      };
    } catch {
      // Silent by design. See the header.
      return null;
    } finally {
      release?.();
    }
  }

  /**
   * Bring the session up before the first turn needs it.
   *
   * Returns whether the model is ready, and never throws: a router that cannot
   * warm up is a router that will return null, which every caller already
   * handles. Safe to call more than once.
   */
  async warmup(persistedFlag: boolean | null = null): Promise<boolean> {
    if (!this.isAvailable(persistedFlag)) return false;
    if (this.loaded) return true;
    if (!hasEnoughMemoryForOnnxSession()) return false;
    let release: (() => void) | null = null;
    try {
      release = await acquireOnnxSlot('normal', 1);
      await this.post({ type: 'init' }, LOAD_TIMEOUT_MS);
      this.loaded = true;
      return true;
    } catch {
      return false;
    } finally {
      release?.();
    }
  }

  getStatus(): LocalWorkerStatus | null { return this.status; }

  dispose(): void {
    this.failAllPending();
    this.loaded = false;
    const w = this.worker;
    this.worker = null;
    // terminate() can fire mid-run and abort the process, which Natively has
    // already hit once. Detaching the listeners first means a late message from
    // a dying worker cannot reach a disposed host.
    w?.removeAllListeners();
    void w?.terminate().catch(() => { /* teardown is best effort */ });
  }
}
