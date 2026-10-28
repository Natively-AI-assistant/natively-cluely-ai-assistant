// electron/audio/whisper/parakeet/aneBackend.ts
//
// Parakeet TDT on the Apple Neural Engine.
//
// The ONNX Runtime engine (parakeetTdtEngine.ts) runs Parakeet on the CPU on
// every platform: ORT's CoreML provider splits the graph into hundreds of
// fragments and measured slower than plain CPU (see inferenceConfig.ts). The
// Neural Engine path instead runs FluidAudio's natively converted CoreML
// bundles in a small Swift helper (native/parakeet-ane, built by
// scripts/build-parakeet-ane.js). Measured on an M5 Pro, a 9.3 s clip takes
// ~47 ms there, warm.
//
// Platform contract:
//   darwin arm64, macOS 14+, helper present  -> 'coreml-ane'
//   everything else (Windows, Intel Mac, a dev checkout without the helper)
//                                             -> 'onnx', the existing engine
//
// Where the files live: the CoreML bundles get their own folder, named after
// their Hugging Face repo, next to the ONNX one under the model id. On a Mac
// that can use the Neural Engine, modelManager makes that repo the model's
// download target and keeps the ONNX folder as a working older copy — the
// same `repoId` / `legacyFilesUsable` arrangement the Whisper exports use.
// So an existing ONNX install keeps working untouched, Settings offers an
// Update, and an interrupted update never hides the copy that works. The
// worker picks the engine from the folder it is told to load (sourceRepoId).

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ParakeetDownloadSet } from './downloadFiles';

export type ParakeetBackend = 'coreml-ane' | 'onnx';

// MUST match scripts/build-parakeet-ane.js HELPER_NAME (disguise-name.cjs
// darwin value + "-parakeet"). Guarded by scripts/__tests__/parakeet-ane-build.test.mjs.
export const PARAKEET_ANE_HELPER = 'Natively-parakeet';

/** The helper is built for macOS 14 (FluidAudio's floor). Darwin 23 = macOS 14. */
const MIN_DARWIN_MAJOR = 23;

interface CoreMlModel {
  /** FluidAudio's AsrModelVersion. */
  version: 'v2' | 'v3';
  download: ParakeetDownloadSet;
}

// The CoreML bundles FluidAudio 0.17.7 loads for each version
// (AsrModels.getModelFileNames: Preprocessor, Encoder, Decoder, the joint and
// parakeet_vocab.json). Pinned to a repo revision because the helper is pinned
// to a library version: a later rename upstream must not break an installed
// app. Sizes from the Hugging Face tree API, for the progress bar.
function mlmodelc(name: string, weightBytes: number, milBytes: number): ParakeetDownloadSet['files'] {
  return [
    { path: `${name}.mlmodelc/analytics/coremldata.bin`, approxBytes: 243 },
    { path: `${name}.mlmodelc/coremldata.bin`, approxBytes: 550 },
    { path: `${name}.mlmodelc/metadata.json`, approxBytes: 3_400 },
    { path: `${name}.mlmodelc/model.mil`, approxBytes: milBytes },
    { path: `${name}.mlmodelc/weights/weight.bin`, approxBytes: weightBytes },
  ];
}

export const PARAKEET_CORE_ML_MODELS: Readonly<Record<string, CoreMlModel>> = {
  'istupakov/parakeet-tdt-0.6b-v2-onnx': {
    version: 'v2',
    download: {
      repo: 'FluidInference/parakeet-tdt-0.6b-v2-coreml',
      revision: 'ee09c569f73759e6d44c9bd16766f477b2b36d39',
      files: [
        ...mlmodelc('Preprocessor', 298_880, 27_166),
        ...mlmodelc('Encoder', 445_187_200, 959_769),
        ...mlmodelc('Decoder', 14_429_952, 13_106),
        ...mlmodelc('JointDecision', 3_453_388, 9_722),
        { path: 'parakeet_vocab.json', approxBytes: 18_762 },
      ],
    },
  },
  'istupakov/parakeet-tdt-0.6b-v3-onnx': {
    version: 'v3',
    download: {
      repo: 'FluidInference/parakeet-tdt-0.6b-v3-coreml',
      revision: '7dd20fe6b1797d35f5e3307e8b1732d9a178edfe',
      files: [
        ...mlmodelc('Preprocessor', 491_072, 28_181),
        ...mlmodelc('Encoder', 445_187_200, 959_769),
        ...mlmodelc('Decoder', 23_604_992, 13_110),
        ...mlmodelc('JointDecisionv3', 12_642_764, 11_775),
        { path: 'parakeet_vocab.json', approxBytes: 151_122 },
      ],
    },
  },
};

/** The catalog model whose CoreML repo is `repo`, if any. */
export function parakeetCoreMlModelForRepo(repo: string): { modelId: string; model: CoreMlModel } | undefined {
  for (const [modelId, model] of Object.entries(PARAKEET_CORE_ML_MODELS)) {
    if (model.download.repo === repo) return { modelId, model };
  }
  return undefined;
}

/** Every CoreML file of `modelId` is in `repoDir` (that repo's own folder) and non-empty. */
export function isParakeetCoreMlCached(repoDir: string, modelId: string): boolean {
  const model = PARAKEET_CORE_ML_MODELS[modelId];
  if (!model) return false;
  return model.download.files.every(({ path: file }) => {
    try { return fs.statSync(path.join(repoDir, file)).size > 0; } catch { return false; }
  });
}

/** Path to the compiled helper (packaged vs development); null outside the Electron main process. */
export function parakeetAneExecutablePath(): string | null {
  try {
    // Lazy: this module is also loaded in the STT worker and in tests, where
    // electron's `app` does not exist.
    const { app } = require('electron');
    if (!app) return null;
    // Typed locally: this module is also compiled into the STT worker, whose
    // closure does not carry Electron's augmentation of `process`.
    const { resourcesPath } = process as NodeJS.Process & { resourcesPath: string };
    return app.isPackaged
      ? path.join(resourcesPath, 'parakeet-ane', PARAKEET_ANE_HELPER)
      : path.join(app.getAppPath(), 'resources', 'parakeet-ane', PARAKEET_ANE_HELPER);
  } catch {
    return null;
  }
}

export interface ParakeetBackendDeps {
  platform?: NodeJS.Platform;
  arch?: string;
  osRelease?: () => string;
  helperPath?: string | null;
  isExecutable?: (file: string) => boolean;
}

function isExecutableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

let depsOverride: ParakeetBackendDeps | null = null;

/**
 * Test seam: makes resolveParakeetBackend() (and so modelManager's repo
 * choice) answer for an injected platform, so both platform branches run in
 * tests on either OS without touching process.platform. null restores the
 * real values.
 */
export function setParakeetBackendDepsForTesting(deps: ParakeetBackendDeps | null): void {
  depsOverride = deps;
}

/**
 * Which engine runs a Parakeet model here, and the helper to run it with.
 * Exhaustive over the supported platforms: only Apple Silicon on macOS 14+
 * with the helper built gets the Neural Engine; Windows and Intel Macs keep
 * the ONNX CPU engine they have always used.
 */
export function resolveParakeetBackend(deps: ParakeetBackendDeps = depsOverride ?? {}): { backend: ParakeetBackend; helperPath?: string } {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  switch (platform) {
    case 'darwin': {
      if (arch !== 'arm64') return { backend: 'onnx' };
      const darwinMajor = Number.parseInt((deps.osRelease ?? os.release)(), 10);
      if (!Number.isFinite(darwinMajor) || darwinMajor < MIN_DARWIN_MAJOR) return { backend: 'onnx' };
      const helperPath = deps.helperPath !== undefined ? deps.helperPath : parakeetAneExecutablePath();
      if (!helperPath || !(deps.isExecutable ?? isExecutableFile)(helperPath)) return { backend: 'onnx' };
      return { backend: 'coreml-ane', helperPath };
    }
    case 'win32':
      return { backend: 'onnx' };
    default:
      // Linux and anything else: the ONNX engine is the only one that exists.
      return { backend: 'onnx' };
  }
}

/** Download size of `modelId`'s CoreML files in MB (what Settings shows on a Neural Engine Mac), or undefined. */
export function parakeetCoreMlSizeMb(modelId: string): number | undefined {
  const model = PARAKEET_CORE_ML_MODELS[modelId];
  if (!model) return undefined;
  const bytes = model.download.files.reduce((sum, f) => sum + f.approxBytes, 0);
  return Math.round(bytes / (1024 * 1024));
}

/** Whether `modelId` has a Neural Engine build at all (both catalog Parakeet models do). */
export function hasParakeetCoreMlModel(modelId: string): boolean {
  return !!PARAKEET_CORE_ML_MODELS[modelId];
}

type SpawnHelper = (file: string, args: string[]) => ChildProcessWithoutNullStreams;

interface Pending {
  resolve: (r: { text: string }) => void;
  reject: (e: Error) => void;
}

/**
 * One helper process. Requests are answered in order by id; any number may be
 * in flight. The same `transcribe(Float32Array)` contract as ParakeetTdtEngine,
 * so the worker treats the two engines alike.
 */
export class AneParakeetEngine {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stdoutBuffer = '';
  private exitError: Error | null = null;
  private disposed = false;

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {}

  /**
   * Starts the helper and resolves once it has loaded the models. The first
   * launch on a Mac compiles the bundles for the Neural Engine (~14 s on an
   * M5 Pro); later launches hit the OS cache (~0.2 s).
   */
  static create(
    helperPath: string,
    coremlDir: string,
    version: 'v2' | 'v3',
    opts: {
      spawnHelper?: SpawnHelper;
      /** The helper died after it was ready, without dispose(): the engine is gone for good. */
      onUnexpectedExit?: (error: Error) => void;
    } = {},
  ): Promise<AneParakeetEngine> {
    const spawnHelper: SpawnHelper = opts.spawnHelper
      ?? ((file, args) => spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] }));
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnHelper(helperPath, ['--model-dir', coremlDir, '--version', version]);
      } catch (e: any) {
        reject(new Error(`Could not start the Parakeet Neural Engine helper: ${e?.message ?? String(e)}`));
        return;
      }
      const engine = new AneParakeetEngine(child);
      let settled = false;
      let stderrTail = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        // CoreML and FluidAudio diagnostics. Kept only to explain a failure.
        stderrTail = (stderrTail + chunk).slice(-2_000);
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        engine.stdoutBuffer += chunk;
        let end: number;
        while ((end = engine.stdoutBuffer.indexOf('\n')) >= 0) {
          const line = engine.stdoutBuffer.slice(0, end);
          engine.stdoutBuffer = engine.stdoutBuffer.slice(end + 1);
          if (!line.trim()) continue;
          let message: any;
          try { message = JSON.parse(line); } catch { continue; }
          if (message?.type === 'ready' && !settled) {
            settled = true;
            resolve(engine);
          } else if (message?.type === 'fatal') {
            const error = new Error(String(message.message ?? 'The Parakeet Neural Engine helper failed.'));
            engine.exitError = error;
            if (!settled) { settled = true; reject(error); }
          } else {
            engine.handleMessage(message);
          }
        }
      });
      // An EPIPE on a dead helper surfaces through 'exit' below.
      child.stdin.on('error', () => {});
      child.on('error', (e) => {
        engine.failAll(e);
        if (!settled) { settled = true; reject(new Error(`Could not start the Parakeet Neural Engine helper: ${e.message}`)); }
      });
      child.on('exit', (code, signal) => {
        const error = engine.exitError ?? new Error(
          `The Parakeet Neural Engine helper exited (${signal ?? `code ${code}`})` +
          (stderrTail.trim() ? `: ${stderrTail.trim().split('\n').pop()}` : ''),
        );
        engine.failAll(error);
        if (!settled) { settled = true; reject(error); return; }
        if (!engine.disposed) opts.onUnexpectedExit?.(error);
      });
    });
  }

  transcribe(pcm: Float32Array): Promise<{ text: string }> {
    if (this.exitError) return Promise.reject(this.exitError);
    const id = this.nextId++;
    if (this.nextId > 0xffff_ffff) this.nextId = 1;
    const header = Buffer.alloc(8);
    header.writeUInt32LE(id, 0);
    header.writeUInt32LE(pcm.length, 4);
    // A copy, not a view: the write is asynchronous and the caller's buffer
    // may be reused or transferred before it drains.
    const payload = Buffer.from(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(header);
      this.child.stdin.write(payload);
    });
  }

  /** Ends the helper. Closing stdin is its shutdown signal; the kill is a backstop. */
  dispose(): void {
    this.disposed = true;
    this.failAll(new Error('The Parakeet Neural Engine helper was stopped.'));
    try { this.child.stdin.end(); } catch { /* already closed */ }
    try { if (this.child.exitCode === null) this.child.kill(); } catch { /* already gone */ }
  }

  private handleMessage(message: any): void {
    const id = Number(message?.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (message.type === 'result') pending.resolve({ text: String(message.text ?? '') });
    else pending.reject(new Error(String(message.message ?? 'Parakeet transcription failed.')));
  }

  private failAll(error: Error): void {
    if (!this.exitError) this.exitError = error;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}
