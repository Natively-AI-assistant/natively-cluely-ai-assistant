import path from 'path';
import fs from 'fs';
import type { WhisperModelId, WhisperModelInfo } from './types';

// env is configured lazily via configureTransformersCache()
// We import the type only here; the actual require() happens at runtime.

const MODEL_ID_ALIASES: Record<string, WhisperModelId> = {
  'onnx-community/whisper-large-v3-turbo-ONNX': 'onnx-community/whisper-large-v3-turbo',
};

export function normalizeWhisperModelId(modelId: string): WhisperModelId {
  return (MODEL_ID_ALIASES[modelId] ?? modelId) as WhisperModelId;
}

const MODEL_CATALOG: WhisperModelInfo[] = [
  // ── Moonshine — streaming-native ASR. ~100× lower latency than Whisper Large v3.
  //     Encoder caching + decoder state reuse. English-only. Best choice for live use.
  { id: 'onnx-community/moonshine-tiny-ONNX', name: 'Moonshine Tiny',  sizeMb: 26,   speed: 'very-fast', accuracy: 'good',      multilingual: false, status: 'missing', streaming: true },
  { id: 'onnx-community/moonshine-base-ONNX', name: 'Moonshine Base',  sizeMb: 60,   speed: 'very-fast', accuracy: 'very-high', multilingual: false, status: 'missing', streaming: true },

  // ── Distil-Whisper — same architecture as Whisper, distilled to 1/2 layers,
  //     ~6× faster CPU/GPU at near-equivalent WER. English-only.
  { id: 'distil-whisper/distil-small.en',    name: 'Distil Small EN',  sizeMb: 164,  speed: 'very-fast', accuracy: 'high',      multilingual: false, status: 'missing', distilled: true },
  { id: 'distil-whisper/distil-medium.en',   name: 'Distil Medium EN', sizeMb: 383,  speed: 'fast',      accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true },
  { id: 'distil-whisper/distil-large-v3',    name: 'Distil Large v3',  sizeMb: 731,  speed: 'medium',    accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true },
  { id: 'distil-whisper/distil-large-v2',    name: 'Distil Large v2',  sizeMb: 731,  speed: 'medium',    accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true },

  // ── Whisper Large v3 / Turbo — multilingual, best in the current
  // Transformers.js-compatible Whisper family for Russian. Turbo is the
  // practical live option; full Large v3 is quality-first and much heavier.
  { id: 'onnx-community/whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo', sizeMb: 1031, speed: 'medium', accuracy: 'very-high', multilingual: true, status: 'missing' },
  { id: 'Xenova/whisper-large-v3', name: 'Whisper Large v3', sizeMb: 3100, speed: 'slow', accuracy: 'very-high', multilingual: true, status: 'missing', requiresAppleSilicon: true },

  // ── Standard Whisper
  { id: 'Xenova/whisper-tiny.en',    name: 'Tiny English',    sizeMb: 39,   speed: 'very-fast', accuracy: 'decent',   multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-tiny',       name: 'Tiny Multilingual', sizeMb: 74, speed: 'very-fast', accuracy: 'decent',   multilingual: true,  status: 'missing' },
  { id: 'Xenova/whisper-base.en',    name: 'Base English',    sizeMb: 142,  speed: 'fast',      accuracy: 'good',     multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-base',       name: 'Base Multilingual', sizeMb: 145, speed: 'fast',     accuracy: 'good',     multilingual: true,  status: 'missing' },
  { id: 'Xenova/whisper-small.en',   name: 'Small English',   sizeMb: 244,  speed: 'medium',    accuracy: 'high',     multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-small',      name: 'Small Multilingual', sizeMb: 466, speed: 'medium',  accuracy: 'high',     multilingual: true,  status: 'missing' },
  { id: 'Xenova/whisper-medium.en',  name: 'Medium English',  sizeMb: 1500, speed: 'slow',      accuracy: 'very-high', multilingual: false, status: 'missing', requiresAppleSilicon: true },
  { id: 'Xenova/whisper-medium',     name: 'Medium Multilingual', sizeMb: 1530, speed: 'slow',  accuracy: 'very-high', multilingual: true,  status: 'missing', requiresAppleSilicon: true },
];

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
  return normalizeWhisperModelId(modelId); // already in `<org>/<name>` shape
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
 * Computes the ONNX files that the active dtype will load. Whisper-family
 * pipelines accept EITHER the merged decoder OR the (decoder + decoder_with_past)
 * pair — so we list both decoder layouts and require either to be complete.
 * Moonshine uses the same naming, so this works uniformly.
 */
function expectedOnnxFiles(dtype: string | Record<string, string>) {
  const enc = onnxFilename('encoder_model', dtypeForFile('encoder_model', dtype));
  const merged = onnxFilename('decoder_model_merged', dtypeForFile('decoder_model_merged', dtype));
  const split = [
    onnxFilename('decoder_model', dtypeForFile('decoder_model', dtype)),
    onnxFilename('decoder_with_past_model', dtypeForFile('decoder_with_past_model', dtype)),
  ];
  return { encoder: enc, decoderOptions: [[merged], split] };
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
  const modelDir = path.join(cacheDir, modelIdToCacheDir(normalizeWhisperModelId(modelId)));
  if (!fs.existsSync(modelDir)) return false;

  if (!dtype) {
    try { return fs.readdirSync(modelDir).length > 0; } catch { return false; }
  }

  const onnxDir = path.join(modelDir, 'onnx');
  if (!fs.existsSync(onnxDir)) return false;

  const { encoder, decoderOptions } = expectedOnnxFiles(dtype);
  if (!fs.existsSync(path.join(onnxDir, encoder))) return false;
  return decoderOptions.some(opt => opt.every(f => fs.existsSync(path.join(onnxDir, f))));
}

/**
 * Returns the full catalog with live status based on the filesystem.
 * Status reflects whether the files for the platform's active dtype are
 * cached — not just "any file in the directory".
 */
export function getAvailableModels(): WhisperModelInfo[] {
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
 * Deletes a downloaded model from the cache directory.
 */
export function deleteModel(modelId: WhisperModelId): void {
  const cacheDir = getModelsDir();
  const normalizedModelId = normalizeWhisperModelId(modelId);
  const modelDir = path.join(cacheDir, modelIdToCacheDir(normalizedModelId));
  if (fs.existsSync(modelDir)) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    console.log(`[modelManager] Deleted model: ${normalizedModelId}`);
  }
}
