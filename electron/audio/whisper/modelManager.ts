import path from 'path';
import fs from 'fs';
import type { WhisperModelId, WhisperModelInfo } from './types';

// env is configured lazily via configureTransformersCache()
// We import the type only here; the actual require() happens at runtime.

const MODEL_CATALOG: WhisperModelInfo[] = [
  // ── Moonshine — streaming-native ASR. ~100× lower latency than Whisper Large v3.
  //     Encoder caching + decoder state reuse. English-only. Best choice for live use.
  { id: 'onnx-community/moonshine-tiny-ONNX', name: 'Moonshine Tiny',  sizeMb: 26,   speed: 'very-fast', accuracy: 'good',      multilingual: false, status: 'missing', streaming: true },
  { id: 'onnx-community/moonshine-base-ONNX', name: 'Moonshine Base',  sizeMb: 60,   speed: 'very-fast', accuracy: 'very-high', multilingual: false, status: 'missing', streaming: true },

  // ── Distil-Whisper — same architecture as Whisper, distilled to 1/2 layers,
  //     ~6× faster CPU/GPU at near-equivalent WER. English-only.
  { id: 'distil-whisper/distil-small.en',    name: 'Distil Small EN',  sizeMb: 164,  speed: 'very-fast', accuracy: 'high',      multilingual: false, status: 'missing', distilled: true },
  { id: 'distil-whisper/distil-medium.en',   name: 'Distil Medium EN', sizeMb: 383,  speed: 'fast',      accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true },
  //   distil-large-v* are external-data checkpoints (fp32 encoder weights in a
  //   sibling encoder_model.onnx_data). Their OWN config.json self-declares it,
  //   so transformers fetches it on download — but we still record the layout
  //   here so isModelCached requires the companion (an aborted download leaving
  //   the stub-without-data would otherwise falsely report "available" → crash
  //   on load, the same failure mode as turbo).
  { id: 'distil-whisper/distil-large-v3',    name: 'Distil Large v3',  sizeMb: 731,  speed: 'medium',    accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true, externalDataFormat: { 'encoder_model.onnx': true } },
  { id: 'distil-whisper/distil-large-v2',    name: 'Distil Large v2',  sizeMb: 731,  speed: 'medium',    accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true, externalDataFormat: { 'encoder_model.onnx': true } },

  // ── Whisper Large v3 Turbo — 6× faster than Large v3, multilingual.
  //    External-data checkpoint: the fp32 encoder weights live in a sibling
  //    `encoder_model.onnx_data` (~820MB) that transformers only fetches when
  //    use_external_data_format is set. Unlike distil-large-v*/medium.en, this
  //    repo's config.json does NOT self-declare it, so we must — otherwise only
  //    the 0.4MB graph stub downloads and ORT aborts on load (filesystem error:
  //    file_size encoder_model.onnx_data). The encoder is fp32 on every
  //    platform (uniform-fp32 on Apple; encoder_model:'fp32' in the per-module
  //    map elsewhere), so this key is platform-robust.
  { id: 'onnx-community/whisper-large-v3-turbo-ONNX', name: 'Whisper Large v3 Turbo', sizeMb: 1031, speed: 'medium', accuracy: 'very-high', multilingual: true, status: 'missing', externalDataFormat: { 'encoder_model.onnx': true } },

  // ── Standard Whisper
  { id: 'Xenova/whisper-tiny.en',    name: 'Tiny English',    sizeMb: 39,   speed: 'very-fast', accuracy: 'decent',   multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-tiny',       name: 'Tiny Multilingual', sizeMb: 74, speed: 'very-fast', accuracy: 'decent',   multilingual: true,  status: 'missing' },
  { id: 'Xenova/whisper-base.en',    name: 'Base English',    sizeMb: 142,  speed: 'fast',      accuracy: 'good',     multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-base',       name: 'Base Multilingual', sizeMb: 145, speed: 'fast',     accuracy: 'good',     multilingual: true,  status: 'missing' },
  { id: 'Xenova/whisper-small.en',   name: 'Small English',   sizeMb: 244,  speed: 'medium',    accuracy: 'high',     multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-small',      name: 'Small Multilingual', sizeMb: 466, speed: 'medium',  accuracy: 'high',     multilingual: true,  status: 'missing' },
  // whisper-medium.en puts the external-data split on the DECODER (its fp32
  // decoder_model_merged weights live in decoder_model_merged.onnx_data). Its
  // config self-declares it for download; recorded here so the cache check
  // requires the companion of whichever decoder layout it validates.
  { id: 'Xenova/whisper-medium.en',  name: 'Medium English',  sizeMb: 1500, speed: 'slow',      accuracy: 'very-high', multilingual: false, status: 'missing', requiresAppleSilicon: true, externalDataFormat: { 'decoder_model_merged.onnx': true } },
  { id: 'Xenova/whisper-medium',     name: 'Medium Multilingual', sizeMb: 1530, speed: 'slow',  accuracy: 'very-high', multilingual: true,  status: 'missing', requiresAppleSilicon: true },
];

/**
 * Set of every modelId declared in MODEL_CATALOG above. Exported for startup
 * validation gates: a persisted `localWhisperModel` / `localWhisperModelMic` /
 * `localWhisperModelSystem` setting must be one of these, otherwise the
 * worker crashes on init and the user is locked out of audio. Callers should
 * fall back to `Xenova/whisper-tiny.en` (always present) on miss.
 */
export const MODEL_CATALOG_IDS: Set<string> = new Set(MODEL_CATALOG.map(m => m.id));

/**
 * Returns the directory where Whisper models are stored.
 * Uses electron app.getPath('userData') so models persist across updates.
 */
export function getModelsDir(): string {
  // Use require to avoid issues with circular imports / early init
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'whisper-models');
}

/**
 * Configures @huggingface/transformers to use our custom cache directory
 * so models are stored in the user's data directory, not node_modules.
 */
export function configureTransformersCache(): void {
  // Workers configure env.cacheDir themselves via msg.cacheDir.
  // This main-thread call is a fire-and-forget best-effort so any code that
  // runs transformers directly (outside a worker) also picks up the right cache.
  // @huggingface/transformers is ESM-only; use new Function to avoid TypeScript
  // rewriting import() → require() in the CommonJS output.
  (new Function('return import("@huggingface/transformers")')() as Promise<{ env: any }>)
    .then(({ env }) => {
      env.cacheDir = getModelsDir();
      env.allowRemoteModels = true;
    })
    .catch(() => {});
}

/**
 * Converts a model ID like 'Xenova/whisper-tiny.en' to its directory under
 * the local cache. @huggingface/transformers v3+ uses a FLAT layout when
 * `env.cacheDir` is set: `<cacheDir>/<org>/<name>/...` — NOT the HF Hub v2
 * convention `models--{org}--{name}/snapshots/{rev}/...`. Earlier code here
 * assumed the v2 convention and silently returned isModelCached=false for
 * every model, which masked the path bug because the loader doesn't depend
 * on this check (it reads files directly via env.cacheDir).
 */
function modelIdToCacheDir(modelId: WhisperModelId): string {
  return modelId; // already in `<org>/<name>` shape
}

// Maps `dtype` keyword to the ONNX filename suffix the loader will look for.
// Mirrors @huggingface/transformers' DEFAULT_DTYPE_SUFFIX_MAPPING.
const DTYPE_SUFFIX: Record<string, string> = {
  fp32: '',
  fp16: '_fp16',
  int8: '_int8',
  uint8: '_uint8',
  q8: '_quantized',
  q4: '_q4',
  q4f16: '_q4f16',
  bnb4: '_bnb4',
};

function dtypeForFile(file: string, dtype: string | Record<string, string>): string {
  if (typeof dtype === 'string') return dtype;
  return dtype[file] ?? 'fp32'; // matches loader default
}

function onnxFilename(basename: string, dt: string): string {
  return `${basename}${DTYPE_SUFFIX[dt] ?? ''}.onnx`;
}

/**
 * Number of external-data chunks declared for a given ONNX file, mirroring the
 * resolution in @huggingface/transformers (constructSession): the map is keyed
 * by the full ONNX basename (e.g. `encoder_model.onnx`) first, then by the
 * module name (`encoder_model`); a bare boolean/number applies to every file.
 * `+value` coerces false→0, true→1, and leaves an explicit chunk count intact.
 * Returns 0 when no external data applies, so callers can skip the `_data` check.
 */
function externalDataChunks(
  fmt: boolean | Record<string, boolean> | undefined,
  baseName: string,
  moduleName: string,
): number {
  if (!fmt) return 0;
  let v: boolean | number = false;
  if (typeof fmt === 'object') {
    if (Object.prototype.hasOwnProperty.call(fmt, baseName)) v = fmt[baseName];
    else if (Object.prototype.hasOwnProperty.call(fmt, moduleName)) v = fmt[moduleName];
    else v = false;
  } else {
    v = fmt;
  }
  return +v;
}

/**
 * The `*.onnx_data` companion filenames required alongside a given ONNX file,
 * named exactly as transformers fetches them: `${baseName}_data` for chunk 0,
 * `${baseName}_data_${i}` for any further chunks.
 */
function externalDataFilesFor(
  moduleName: string,
  dt: string,
  fmt: boolean | Record<string, boolean> | undefined,
): string[] {
  const baseName = onnxFilename(moduleName, dt);
  const chunks = externalDataChunks(fmt, baseName, moduleName);
  const files: string[] = [];
  for (let i = 0; i < chunks; i++) files.push(`${baseName}_data${i === 0 ? '' : '_' + i}`);
  return files;
}

/**
 * Computes the ONNX files that the active dtype will load. Whisper-family
 * pipelines accept EITHER the merged decoder OR the (decoder + decoder_with_past)
 * pair — so we list both decoder layouts and require either to be complete.
 * Moonshine uses the same naming, so this works uniformly.
 */
function expectedOnnxFiles(
  dtype: string | Record<string, string>,
  externalDataFormat?: boolean | Record<string, boolean>,
) {
  const encDt = dtypeForFile('encoder_model', dtype);
  const mergedDt = dtypeForFile('decoder_model_merged', dtype);
  const decDt = dtypeForFile('decoder_model', dtype);
  const pastDt = dtypeForFile('decoder_with_past_model', dtype);

  const enc = onnxFilename('encoder_model', encDt);
  const merged = onnxFilename('decoder_model_merged', mergedDt);
  const split = [
    onnxFilename('decoder_model', decDt),
    onnxFilename('decoder_with_past_model', pastDt),
  ];

  // External-data checkpoints (e.g. Whisper Large v3 Turbo) split a module's
  // weights into a sibling `*.onnx_data` file. The `.onnx` graph alone is a
  // tiny stub that loads then aborts at file_size() — so for a model to count
  // as cached, every declared `_data` companion of the files it will load must
  // also be present. Required alongside the encoder always; alongside whichever
  // decoder layout is checked.
  const encoderData = externalDataFilesFor('encoder_model', encDt, externalDataFormat);
  const mergedData = externalDataFilesFor('decoder_model_merged', mergedDt, externalDataFormat);
  const splitData = [
    ...externalDataFilesFor('decoder_model', decDt, externalDataFormat),
    ...externalDataFilesFor('decoder_with_past_model', pastDt, externalDataFormat),
  ];

  return {
    encoder: enc,
    encoderData,
    decoderOptions: [
      [merged, ...mergedData],
      [...split, ...splitData],
    ],
  };
}

/**
 * Returns true when the cache contains the ONNX files the active dtype will
 * actually load. When `dtype` is omitted (legacy callers), falls back to a
 * directory-non-empty check — preserves the previous contract.
 *
 * This guards against the "available in panel but downloads mid-recording"
 * regression: a v2-cached model has only `_quantized.onnx` files, while the
 * new dtype config (Apple Silicon = fp32 encoder, mixed elsewhere) requires
 * a different filename. Without this check the loader silently fetches the
 * missing variant on first use, blocking start() for 30–90s.
 */
export function isModelCached(modelId: WhisperModelId, dtype?: string | Record<string, string>): boolean {
  const cacheDir = getModelsDir();
  const modelDir = path.join(cacheDir, modelIdToCacheDir(modelId));
  if (!fs.existsSync(modelDir)) return false;

  if (!dtype) {
    try { return fs.readdirSync(modelDir).length > 0; } catch { return false; }
  }

  const onnxDir = path.join(modelDir, 'onnx');
  if (!fs.existsSync(onnxDir)) return false;

  // A present-but-empty file is a partial/aborted download, not a cache hit —
  // require non-zero size so a 0-byte stub (observed in the broken turbo state)
  // forces a clean re-fetch instead of being reported as available.
  const present = (f: string): boolean => {
    try { return fs.statSync(path.join(onnxDir, f)).size > 0; } catch { return false; }
  };

  const externalDataFormat = getModelExternalDataFormat(modelId);
  const { encoder, encoderData, decoderOptions } = expectedOnnxFiles(dtype, externalDataFormat);
  if (!present(encoder)) return false;
  // External-weight companion(s) of the encoder must exist too, else ORT aborts.
  if (!encoderData.every(present)) return false;
  return decoderOptions.some(opt => opt.every(present));
}

/**
 * Returns the full catalog with live status based on the filesystem.
 * Status reflects whether the files for the platform's active dtype are
 * cached — not just "any file in the directory".
 */
export function getAvailableModels(): WhisperModelInfo[] {
  // onnxruntime-node 1.22.0 links against libc++ symbols (std::to_chars for
  // double) that are only exported on macOS 13 Ventura and later. On macOS 12
  // (Monterey) and earlier the dylib load fails with "Symbol not found:
  // __ZNSt3__18to_charsEPcS0_d". Surface a clear error so users don't waste
  // time downloading models that will immediately crash.
  if (process.platform === 'darwin') {
    const release = (require('os') as typeof import('os')).release(); // e.g. "21.x.x" = macOS 12
    const darwinMajor = parseInt(release.split('.')[0], 10);
    // Darwin 22 = macOS 13 Ventura. Darwin 21 = macOS 12 Monterey.
    if (Number.isNaN(darwinMajor) || darwinMajor < 22) {
      return MODEL_CATALOG.map(m => ({
        ...m,
        status: 'error' as const,
        errorMessage: 'Requires macOS 13 Ventura or later. Local models are not supported on macOS 12 (Monterey) or earlier.',
      }));
    }
  }

  // Resolve the active dtype lazily — avoids importing inferenceConfig at
  // module top (which would break the modelPreloader → modelManager require
  // chain on platforms where process info isn't yet available).
  let dtype: string | Record<string, string> | undefined;
  try {
    const { resolveInferenceConfig } = require('./inferenceConfig');
    dtype = resolveInferenceConfig().dtype;
  } catch {
    dtype = undefined; // fall back to legacy directory-non-empty check
  }
  return MODEL_CATALOG.map(m => ({
    ...m,
    status: isModelCached(m.id, dtype) ? 'available' : 'missing',
  }));
}

/**
 * Catalog download size (in bytes) for a model, used as the progress-bar
 * denominator from byte zero so the bar tracks real wall-clock download
 * instead of inferring the total from whichever files have reported so far.
 * Returns 0 for unknown ids (caller then falls back to observed file totals).
 */
export function getModelSizeBytes(modelId: string): number {
  const m = MODEL_CATALOG.find(x => x.id === modelId);
  return m ? Math.round(m.sizeMb * 1024 * 1024) : 0;
}

/**
 * The catalog's declared ONNX external-data format for a model, or undefined.
 * Forwarded by buildWorkerInitMessage → the worker's pipeline() call as
 * `use_external_data_format` so the sibling `*.onnx_data` weight files get
 * fetched for checkpoints whose own config.json omits the declaration (e.g.
 * Whisper Large v3 Turbo). Returns undefined for unknown ids.
 */
export function getModelExternalDataFormat(
  modelId: string,
): boolean | Record<string, boolean> | undefined {
  const m = MODEL_CATALOG.find(x => x.id === modelId);
  return m?.externalDataFormat;
}

/**
 * Deletes a downloaded model from the cache directory.
 */
export function deleteModel(modelId: WhisperModelId): void {
  const cacheDir = getModelsDir();
  const modelDir = path.join(cacheDir, modelIdToCacheDir(modelId));
  if (fs.existsSync(modelDir)) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    console.log(`[modelManager] Deleted model: ${modelId}`);
  }
}
