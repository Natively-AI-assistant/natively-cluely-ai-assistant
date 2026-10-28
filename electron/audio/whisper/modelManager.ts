import path from 'path';
import { ONNX_MAC_UNSUPPORTED_MESSAGE, onnxRuntimeSupportedOnThisMac } from './onnxMacSupport';
import fs from 'fs';
import type { WhisperModelId, WhisperModelInfo } from './types';
import { isCorruptModelFailure } from './loadFailure';

// env is configured lazily via configureTransformersCache()
// We import the type only here; the actual require() happens at runtime.

export const MODEL_CATALOG: WhisperModelInfo[] = [
  // ── Moonshine — streaming-native ASR. ~100× lower latency than Whisper Large v3.
  //     Encoder caching + decoder state reuse. English-only. Best choice for live use.
  { id: 'onnx-community/moonshine-tiny-ONNX', name: 'Moonshine Tiny',  sizeMb: 26,   speed: 'very-fast', accuracy: 'good',      multilingual: false, status: 'missing', streaming: true },
  { id: 'onnx-community/moonshine-base-ONNX', name: 'Moonshine Base',  sizeMb: 60,   speed: 'very-fast', accuracy: 'very-high', multilingual: false, status: 'missing', streaming: true },

  // ── Parakeet TDT v2 — English only. Same export layout and engine as v3
  //     below (only the vocabulary differs: 1024 tokens vs 8192, read from
  //     vocab.txt), and more accurate on English: 2.1% vs 2.5% WER on
  //     LibriSpeech test-clean in FluidAudio's published benchmark. CC-BY-4.0.
  {
    id: 'istupakov/parakeet-tdt-0.6b-v2-onnx',
    name: 'Parakeet TDT 0.6B v2',
    sizeMb: 661,
    speed: 'very-fast',
    accuracy: 'very-high',
    multilingual: false,
    status: 'missing',
    sessionLayout: 'parakeet-tdt',
  },

  // ── Parakeet — NVIDIA FastConformer TDT v3, Multilingual (25 European languages).
  //     Token-and-Duration Transducer architecture with duration-skipping decoding,
  //     native punctuation and capitalization. CC-BY-4.0.
  {
    id: 'istupakov/parakeet-tdt-0.6b-v3-onnx',
    name: 'Parakeet TDT 0.6B v3',
    sizeMb: 670,
    speed: 'very-fast',
    accuracy: 'very-high',
    multilingual: true,
    status: 'missing',
    sessionLayout: 'parakeet-tdt',
  },

  // ── Nemotron 3.5 ASR Streaming — NVIDIA cache-aware FastConformer-RNNT.
  //     The ONLY model in this catalog with real streaming (chunked ONNX
  //     inference with cross-call cache state), not the simulated polling
  //     used for Whisper/Distil-Whisper/Moonshine/Parakeet. Multilingual
  //     (40 locales, tiered — see nemotron/languageTable.ts for which are
  //     exposed). Flat repo layout (no onnx/ subdir, no dtype suffix) — its
  //     cache check is a dedicated branch below, not expectedOnnxFiles().
  //
  //     Previously hidden: true — real-model testing (task-11-report.md,
  //     task-11-debug1-report.md, task-11-debug2-report.md) found this
  //     export transcribed speech as an empty string (complete functional
  //     failure). Root cause (task-11-fix1-report.md): the driving code
  //     baked synthetic zero-padding into the encoder's leading 9
  //     "pre_encode_cache" frames instead of real cross-chunk mel history
  //     (melFrontend.ts/nemotronEngine.ts), plus a wrong `lang_id` value
  //     (2947 — a vocab-token id, not a conditioning index). Both fixed:
  //     NemotronEngine now carries a real raw-PCM lookback buffer across
  //     chunk boundaries, and DEFAULT_LANG_ID is 0 (empirically verified).
  //     The real go/no-go integration test now passes (77.8% word overlap
  //     vs. the required 50%) — unhidden as a real, shippable fix.
  {
    id: 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4',
    name: 'Nemotron 3.5 ASR Streaming',
    sizeMb: 793,
    speed: 'fast',
    accuracy: 'high',
    multilingual: true,
    status: 'missing',
    streaming: true,
    sessionLayout: 'nemotron-rnnt',
  },

  // ── Distil-Whisper — same architecture as Whisper, distilled to 1/2 layers,
  //     ~6× faster CPU/GPU at near-equivalent WER. English-only.
  //     Small EN loads onnx-community's export of the same weights: the
  //     distil-whisper repo's encoder returns all 12 attention maps as outputs
  //     (see the Whisper note below).
  { id: 'distil-whisper/distil-small.en',    name: 'Distil Small EN',  sizeMb: 412,  speed: 'very-fast', accuracy: 'high',      multilingual: false, status: 'missing', distilled: true, repoId: 'onnx-community/distil-small.en', legacyFilesUsable: true },
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
  //    `encoder_model.onnx_data` (2.55 GB) next to a 0.4 MB graph stub. The
  //    repo's config.json declares it; it is recorded here as well so the
  //    cache check requires the companion and a stub-only download never
  //    reads as installed.
  //
  //    The id (kept, because Settings stores it) names the repo this used to
  //    load, `-ONNX`. Its merged decoders take a `cache_position` input that
  //    transformers.js 3.8.1 never sends, so every transcription failed with
  //    "Missing the following inputs: cache_position" after a clean load.
  //    The repo without the suffix has the same encoder and decoders without
  //    that input: transcribes English and Indonesian correctly (measured
  //    2026-10-14). Files left under the old repo are useless and are swept at
  //    launch (OBSOLETE_MODEL_CACHE_DIRS). Real download ~2.99 GB.
  { id: 'onnx-community/whisper-large-v3-turbo-ONNX', name: 'Whisper Large v3 Turbo', sizeMb: 2850, speed: 'slow', accuracy: 'very-high', multilingual: true, status: 'missing', externalDataFormat: { 'encoder_model.onnx': true }, repoId: 'onnx-community/whisper-large-v3-turbo', legacyFilesUsable: false },

  // ── Standard Whisper
  //    Ids are the Xenova repos the app first shipped with; the files come
  //    from onnx-community's exports of the same weights. The Xenova encoders
  //    return every layer's attention map as a graph output (Tiny 4, Base 6,
  //    Small 12, Medium 24; Medium's are ~3.5 GB per call). onnx-community's
  //    return the hidden state alone: Small measured 0.65 GB peak against
  //    3.04 GB, identical encoder output, on an M4 (2026-10-14). Models
  //    already downloaded from Xenova keep loading until the user reinstalls.
  //    Sizes are fp32 encoder + q8 merged decoder, rounded down (the progress
  //    bar needs a lower bound).
  { id: 'Xenova/whisper-tiny.en',    name: 'Tiny English',    sizeMb: 60,   speed: 'very-fast', accuracy: 'decent',   multilingual: false, status: 'missing', repoId: 'onnx-community/whisper-tiny.en', legacyFilesUsable: true },
  { id: 'Xenova/whisper-tiny',       name: 'Tiny Multilingual', sizeMb: 60, speed: 'very-fast', accuracy: 'decent',   multilingual: true,  status: 'missing', repoId: 'onnx-community/whisper-tiny', legacyFilesUsable: true },
  { id: 'Xenova/whisper-base.en',    name: 'Base English',    sizeMb: 130,  speed: 'fast',      accuracy: 'good',     multilingual: false, status: 'missing', repoId: 'onnx-community/whisper-base.en', legacyFilesUsable: true },
  { id: 'Xenova/whisper-base',       name: 'Base Multilingual', sizeMb: 130, speed: 'fast',     accuracy: 'good',     multilingual: true,  status: 'missing', repoId: 'onnx-community/whisper-base', legacyFilesUsable: true },
  { id: 'Xenova/whisper-small.en',   name: 'Small English',   sizeMb: 486,  speed: 'medium',    accuracy: 'high',     multilingual: false, status: 'missing', repoId: 'onnx-community/whisper-small.en', legacyFilesUsable: true },
  { id: 'Xenova/whisper-small',      name: 'Small Multilingual', sizeMb: 486, speed: 'medium',  accuracy: 'high',     multilingual: true,  status: 'missing', repoId: 'onnx-community/whisper-small', legacyFilesUsable: true },
  // whisper-medium.en puts the external-data split on the DECODER (its fp32
  // decoder_model_merged weights live in decoder_model_merged.onnx_data). Its
  // config self-declares it for download; recorded here so the cache check
  // requires the companion of whichever decoder layout it validates.
  // onnx-community has no medium.en, so this is still the Xenova export with
  // 24 attention maps per call. Offered only where it is already installed:
  // new installs get Medium Multilingual, which transcribes English too.
  { id: 'Xenova/whisper-medium.en',  name: 'Medium English',  sizeMb: 1500, speed: 'slow',      accuracy: 'very-high', multilingual: false, status: 'missing', requiresAppleSilicon: true, externalDataFormat: { 'decoder_model_merged.onnx': true }, installedOnly: true },
  { id: 'Xenova/whisper-medium',     name: 'Medium Multilingual', sizeMb: 1810, speed: 'slow',  accuracy: 'very-high', multilingual: true,  status: 'missing', requiresAppleSilicon: true, repoId: 'onnx-community/whisper-medium-ONNX', legacyFilesUsable: true },
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
function repoDir(cacheDir: string, repo: string): string {
  return path.join(cacheDir, ...repo.split('/'));
}

function catalogEntry(modelId: string): WhisperModelInfo | undefined {
  return MODEL_CATALOG.find(m => m.id === modelId);
}

/** The repo a model is downloaded from: its `repoId`, or the id itself. */
// Test seam for the Parakeet repo choice below (see parakeet/aneBackend.ts).
export { setParakeetBackendDepsForTesting } from './parakeet/aneBackend';

/**
 * Parakeet TDT on a Mac that can run it on the Neural Engine: the CoreML
 * repo, which becomes the download target while the ONNX files under the id
 * stay a working older copy (like a Whisper `repoId` with legacyFilesUsable).
 * undefined everywhere else, where the ONNX files under the id are the model.
 */
function parakeetCoreMlRepo(modelId: string): string | undefined {
  const ane = require('./parakeet/aneBackend') as typeof import('./parakeet/aneBackend');
  const model = ane.PARAKEET_CORE_ML_MODELS[modelId];
  if (!model) return undefined;
  return ane.resolveParakeetBackend().backend === 'coreml-ane' ? model.download.repo : undefined;
}

export function getModelDownloadRepo(modelId: string): string {
  return parakeetCoreMlRepo(modelId) ?? catalogEntry(modelId)?.repoId ?? modelId;
}

/**
 * Repos whose files can serve this model, preferred first: the download repo,
 * then the files a previous version left under the id, when they still work.
 */
function candidateRepos(modelId: string): string[] {
  const coreml = parakeetCoreMlRepo(modelId);
  if (coreml) return [coreml, modelId];
  const m = catalogEntry(modelId);
  if (!m?.repoId || m.repoId === modelId) return [modelId];
  return m.legacyFilesUsable ? [m.repoId, modelId] : [m.repoId];
}

/** Every directory this model's files may sit in, used ones or not. */
function allRepoDirsFor(modelId: string, cacheDir: string): string[] {
  // A Parakeet CoreML copy is removed with the model even where this machine
  // would not use it (the helper went missing, the profile moved Macs).
  const ane = require('./parakeet/aneBackend') as typeof import('./parakeet/aneBackend');
  const coreml = ane.PARAKEET_CORE_ML_MODELS[modelId]?.download.repo;
  return [...new Set([getModelDownloadRepo(modelId), modelId, ...(coreml ? [coreml] : [])])].map(r => repoDir(cacheDir, r));
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
  sessionLayout?: 'encoder-decoder' | 'single',
) {
  // A one-session CTC model (Parakeet): a single `model.onnx`, no decoder at
  // all. Returned through the same shape as the encoder-decoder case so the
  // caller stays layout-agnostic — `decoderOptions: [[]]` reads as "one valid
  // decoder layout, requiring no files", which `.some(opt => opt.every(...))`
  // satisfies vacuously. Encoding it as [] instead would mean "NO valid layout"
  // and the model could never be cached.
  if (sessionLayout === 'single') {
    const dt = dtypeForFile('model', dtype);
    return {
      encoder: onnxFilename('model', dt),
      encoderData: externalDataFilesFor('model', dt, externalDataFormat),
      decoderOptions: [[]] as string[][],
    };
  }

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

// Exported (not module-private) so downloadFiles.ts (Task 9) imports this same
// list rather than maintaining a second copy that could drift out of sync.
export const NEMOTRON_REQUIRED_FILES = [
  'encoder.onnx', 'encoder.onnx.data',
  'decoder.onnx', 'decoder.onnx.data',
  'joint.onnx', 'joint.onnx.data',
  'tokenizer.json', 'vocab.txt', 'tokenizer_config.json',
] as const;

function isNemotronModelCached(modelDir: string): boolean {
  return NEMOTRON_REQUIRED_FILES.every(f => {
    try { return fs.statSync(path.join(modelDir, f)).size > 0; } catch { return false; }
  });
}

export const PARAKEET_TDT_REQUIRED_FILES = [
  'encoder-model.int8.onnx',
  'decoder_joint-model.int8.onnx',
  'nemo128.onnx',
  'vocab.txt',
  'config.json',
] as const;

/**
 * `repo` is the folder being checked: a Parakeet CoreML repo (Neural Engine,
 * see parakeetCoreMlRepo) holds the CoreML bundles; any other holds the ONNX
 * files.
 */
function isParakeetModelCached(modelDir: string, modelId: string, repo: string): boolean {
  const ane = require('./parakeet/aneBackend') as typeof import('./parakeet/aneBackend');
  if (ane.parakeetCoreMlModelForRepo(repo)?.modelId === modelId) {
    return ane.isParakeetCoreMlCached(modelDir, modelId);
  }
  return PARAKEET_TDT_REQUIRED_FILES.every(f => {
    try { return fs.statSync(path.join(modelDir, f)).size > 0; } catch { return false; }
  });
}

/**
 * Marker left inside a model's directory for as long as its download is in
 * progress.
 *
 * WHY: transformers.js writes each file straight to its final name (no temp
 * file, no length check), and every "is it installed" test here only asks
 * whether the files are bigger than zero. Quit the app, lose the network or
 * cancel half-way through a 1 GB download and what is left on disk looks
 * exactly like an installed model: the next launch promoted it to "complete",
 * skipped the download, and every load then failed with "Protobuf parsing
 * failed". (Found on a real profile, 2026-10-14: a 2.1 MB encoder_model.onnx
 * for whisper-small.en, reported as installed.)
 *
 * The marker is written before the first byte is fetched and removed only
 * after a worker has loaded the finished files. While it exists the model is
 * not cached, whatever else is in the directory.
 *
 * `cacheDir` is injectable so this is testable against a temp dir without an
 * Electron `app`. The file is a plain marker — same on macOS and Windows.
 */
export const DOWNLOAD_INCOMPLETE_MARKER = '.natively-download-incomplete';

function downloadMarkerPath(modelId: string, cacheDir: string): string {
  return path.join(repoDir(cacheDir, getModelDownloadRepo(modelId)), DOWNLOAD_INCOMPLETE_MARKER);
}

export function markModelDownloadStarted(modelId: string, cacheDir: string = getModelsDir()): void {
  const marker = downloadMarkerPath(modelId, cacheDir);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ startedAt: Date.now() }), 'utf8');
}

export function clearModelDownloadMarker(modelId: string, cacheDir: string = getModelsDir()): void {
  try { fs.rmSync(downloadMarkerPath(modelId, cacheDir), { force: true }); } catch { /* absent is fine */ }
}

export function isModelDownloadIncomplete(modelId: string, cacheDir: string = getModelsDir()): boolean {
  try { return fs.existsSync(downloadMarkerPath(modelId, cacheDir)); } catch { return false; }
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
  return candidateRepos(modelId).some(repo => isRepoCached(modelId, repo, dtype, cacheDir));
}

/**
 * Whether the copy a download produces (the download repo) is complete. Unlike
 * isModelCached, an older copy under the id does not count: this is what the
 * download service checks, so "download" on a model that only has an older
 * copy fetches the current one.
 */
export function isModelDownloadComplete(modelId: string, dtype?: string | Record<string, string>): boolean {
  return isRepoCached(modelId, getModelDownloadRepo(modelId), dtype, getModelsDir());
}

/**
 * True when the model works from a copy an earlier version downloaded, and a
 * lighter current copy exists to download (see WhisperModelInfo.repoId).
 * Settings offers it; nothing downloads it on its own.
 */
export function isModelUpgradeAvailable(
  modelId: string,
  dtype?: string | Record<string, string>,
  cacheDir: string = getModelsDir(),
): boolean {
  // Parakeet on a Neural Engine Mac: an ONNX install works, and the CoreML
  // copy is the upgrade (several times faster, and off the CPU).
  const coreml = parakeetCoreMlRepo(modelId);
  if (coreml) return !isRepoCached(modelId, coreml, dtype, cacheDir) && isRepoCached(modelId, modelId, dtype, cacheDir);
  const m = catalogEntry(modelId);
  if (!m?.repoId || m.repoId === modelId || !m.legacyFilesUsable) return false;
  return !isRepoCached(modelId, m.repoId, dtype, cacheDir) && isRepoCached(modelId, modelId, dtype, cacheDir);
}

/**
 * The repo the worker should load for this model: the first candidate whose
 * files are complete, else the download repo (the worker then downloads it).
 * A machine that downloaded a model before its `repoId` existed keeps loading
 * those files; one that has both loads the new ones.
 */
export function resolveModelSourceRepo(
  modelId: string,
  dtype?: string | Record<string, string>,
  cacheDir: string = getModelsDir(),
): string {
  for (const repo of candidateRepos(modelId)) {
    if (isRepoCached(modelId, repo, dtype, cacheDir)) return repo;
  }
  return getModelDownloadRepo(modelId);
}

function isRepoCached(
  modelId: string,
  repo: string,
  dtype: string | Record<string, string> | undefined,
  cacheDir: string,
): boolean {
  const modelDir = repoDir(cacheDir, repo);
  if (!fs.existsSync(modelDir)) return false;
  // A download that started and never finished. Every size check below would
  // pass a truncated file, so this is the only thing that tells "interrupted"
  // from "installed" — see markModelDownloadStarted.
  if (fs.existsSync(path.join(modelDir, DOWNLOAD_INCOMPLETE_MARKER))) return false;

  const sessionLayout = catalogEntry(modelId)?.sessionLayout;
  if (sessionLayout === 'nemotron-rnnt') return isNemotronModelCached(modelDir);
  if (sessionLayout === 'parakeet-tdt') return isParakeetModelCached(modelDir, modelId, repo);

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
  const { encoder, encoderData, decoderOptions } = expectedOnnxFiles(dtype, externalDataFormat, sessionLayout);
  if (!present(encoder)) return false;
  // External-weight companion(s) of the encoder must exist too, else ORT aborts.
  if (!encoderData.every(present)) return false;
  return decoderOptions.some(opt => opt.every(present));
}

/**
 * The large ONNX files a download of this model fetches, as paths inside its
 * repo, for the worker's resumable downloader: the encoder and the merged
 * decoder transformers.js loads, with their external-data companions. Empty
 * for models that download through their own engine (Nemotron, Parakeet).
 */
export function getResumableDownloadFiles(modelId: string, dtype: string | Record<string, string>): string[] {
  const m = catalogEntry(modelId);
  const layout = m?.sessionLayout;
  if (!m || layout === 'nemotron-rnnt' || layout === 'parakeet-tdt' || layout === 'single') return [];
  return loadedOnnxFiles(dtype, m.externalDataFormat, layout).map(f => `onnx/${f}`);
}

/**
 * The files in `onnx/` that transformers.js loads under the init `dtype`: the
 * encoder (or the one `model` of a 'single' layout) and the merged decoder,
 * with their external-data companions. transformers.js 3.8.1 never loads the
 * split decoder pair, so it is not listed. For the default mixed map that is
 * `encoder_model.onnx` + `decoder_model_merged_quantized.onnx`.
 *
 * The worker's load diagnostics stat these. They used to build the names
 * themselves and, for a mixed map, named `decoder_model_merged.onnx` (not
 * there) with size -1 (issue #668).
 */
export function loadedOnnxFiles(
  dtype: string | Record<string, string>,
  externalDataFormat?: boolean | Record<string, boolean>,
  sessionLayout?: WhisperModelInfo['sessionLayout'],
): string[] {
  const layout = sessionLayout === 'single' ? 'single' : undefined;
  const { encoder, encoderData, decoderOptions } = expectedOnnxFiles(dtype, externalDataFormat, layout);
  return [encoder, ...encoderData, ...decoderOptions[0]];
}

/**
 * The local models the settings select, catalog ids only: the global one
 * (Tiny English when unset, as a meeting start reads it), plus the mic and
 * system ones when per-channel models are on. Startup preload and the
 * background update (legacyCopyUpgrade.ts) both read it.
 */
export function selectedLocalModelIds(get: (key: string) => unknown): string[] {
  const ids: unknown[] = [get('localWhisperModel') ?? 'Xenova/whisper-tiny.en'];
  if (get('localWhisperPerChannelEnabled')) ids.push(get('localWhisperModelMic'), get('localWhisperModelSystem'));
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && MODEL_CATALOG_IDS.has(id)))];
}

/** The `onnx/` folder of one repo's copy in the models cache. */
export function onnxDirFor(cacheDir: string, repo: string): string {
  return path.join(repoDir(cacheDir, repo), 'onnx');
}

/**
 * Clean up after an interrupted download of this model, keeping what the
 * resumable downloader can reuse (see deleteInterruptedDownloadKeepingParts).
 * Touches only the download repo, never files an earlier version left under
 * the id, which may be a working copy.
 */
export function deleteInterruptedModelDownload(modelId: string, cacheDir: string = getModelsDir()): void {
  const { deleteInterruptedDownloadKeepingParts } = require('./resumableDownload') as typeof import('./resumableDownload');
  deleteInterruptedDownloadKeepingParts(repoDir(cacheDir, getModelDownloadRepo(modelId)));
}

/**
 * Remove everything a download of this model wrote, part files included: the
 * files it produced failed to load as damaged, so the next attempt must not
 * reuse any of them. Never touches an older copy under the id.
 */
export function discardModelDownload(modelId: string, cacheDir: string = getModelsDir()): void {
  fs.rmSync(repoDir(cacheDir, getModelDownloadRepo(modelId)), { recursive: true, force: true });
}

/** The platform's active dtype, or undefined where it cannot be resolved (tests). */
function activeDtype(): string | Record<string, string> | undefined {
  try {
    const { resolveInferenceConfig } = require('./inferenceConfig');
    return resolveInferenceConfig().dtype;
  } catch {
    return undefined;
  }
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
  // (13.3 precisely; see onnxMacSupport.ts.)
  if (!onnxRuntimeSupportedOnThisMac()) {
    return MODEL_CATALOG.filter(m => !m.hidden).map(m => ({
      ...m,
      status: 'error' as const,
      errorMessage: ONNX_MAC_UNSUPPORTED_MESSAGE,
    }));
  }

  // Resolve the active dtype lazily — avoids importing inferenceConfig at
  // module top (which would break the modelPreloader → modelManager require
  // chain on platforms where process info isn't yet available).
  // Undefined falls back to the legacy directory-non-empty check.
  const dtype = activeDtype();
  return MODEL_CATALOG.filter(m => !m.hidden).flatMap(m => {
    const cached = isModelCached(m.id, dtype);
    if (m.installedOnly && !cached) return [];
    return [{
      ...m,
      status: cached ? 'available' as const : 'missing' as const,
      upgradeAvailable: cached && dtype !== undefined && isModelUpgradeAvailable(m.id, dtype),
    }];
  });
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

/** Catalog size in MB, or undefined for an unknown id (callers then use the flat memory floor). */
export function getModelSizeMb(modelId: string): number | undefined {
  return MODEL_CATALOG.find(x => x.id === modelId)?.sizeMb;
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
  // Both the download repo and any files an earlier version left under the id.
  for (const modelDir of allRepoDirsFor(modelId, getModelsDir())) {
    if (fs.existsSync(modelDir)) {
      fs.rmSync(modelDir, { recursive: true, force: true });
      console.log(`[modelManager] Deleted model: ${modelId} (${modelDir})`);
    }
  }
}

/**
 * Cache directories under getModelsDir() that no shipped code opens any more.
 *
 * transformers.js downloads land here keyed by model id, and nothing removes
 * them when the code that needed them goes. The intent classifier's MobileBERT
 * was removed on 2026-09-05; every machine that ever warmed it still carries a
 * 94 MB copy in this cache. Listed by exact repo so the sweep can only ever
 * touch downloads that were deliberately retired, never one a model still loads.
 */
const OBSOLETE_MODEL_CACHE_DIRS: readonly string[] = [
  'Xenova/mobilebert-uncased-mnli',
  // Large v3 Turbo's first repo: loads, then fails every transcription
  // (cache_position). Up to ~3 GB per machine. The catalog entry now
  // downloads onnx-community/whisper-large-v3-turbo instead.
  'onnx-community/whisper-large-v3-turbo-ONNX',
];

/**
 * Remove retired model caches, and older copies of a model whose current
 * repo is fully installed (see supersededModelCacheDirs). Returns the repos it
 * removed. Safe to call on every launch: a missing directory is a no-op, and a
 * failure to remove one (a Windows handle still open, a permission error) is
 * logged and skipped so a stale cache can never block startup.
 *
 * `cacheDir` and `dtype` are injectable so the sweep can be tested against a
 * temp dir without an Electron `app`.
 */
export function purgeObsoleteModelCaches(
  cacheDir: string = getModelsDir(),
  dtype: string | Record<string, string> | undefined = activeDtype(),
): string[] {
  const removed: string[] = [];
  for (const id of [...OBSOLETE_MODEL_CACHE_DIRS, ...supersededModelCacheDirs(cacheDir, dtype)]) {
    const dir = path.join(cacheDir, ...id.split('/'));
    try {
      if (!fs.existsSync(dir)) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(id);
      console.log(`[modelManager] Removed obsolete model cache: ${id}`);
    } catch (e: any) {
      console.warn(`[modelManager] Could not remove obsolete model cache ${id}: ${e?.message || e}`);
    }
  }
  return removed;
}

/**
 * Older downloads of a model whose current repo is now fully installed next to
 * them. The resolver already prefers the current repo, so nothing opens these.
 * Needs the active dtype to tell "fully installed"; without it, sweeps nothing.
 */
function supersededModelCacheDirs(
  cacheDir: string,
  dtype: string | Record<string, string> | undefined,
): string[] {
  if (!dtype) return [];
  return MODEL_CATALOG
    .filter(m => m.repoId && m.repoId !== m.id && m.legacyFilesUsable)
    .filter(m => isRepoCached(m.id, m.repoId!, dtype, cacheDir))
    .map(m => m.id);
}

/**
 * Errors that mean "the bytes on disk are not a usable model", as opposed to
 * "this machine cannot run models at all" or "this load failed for a reason
 * that has nothing to do with the files".
 *
 * The classification lives in loadFailure.ts. It used to match the phrase
 * "failed to load model" here, on the belief that it was ONNX Runtime's own
 * wrapper. It is the prefix whisperWorker.ts puts on EVERY init error, so every
 * failure — out of memory, no network, a file still in use, a missing Windows
 * runtime DLL — was classified as corrupt and the model directory was deleted.
 * Reinstalling then failed the same way and deleted it again.
 *
 * Only positive evidence of bad bytes purges now. Deliberately does NOT match
 * the macOS 12 / libonnxruntime symbol errors either: wiping a perfectly good
 * download because the host cannot load ANY model would turn one bad message
 * into a bad message plus a lost 350 MB.
 */
export function isCorruptModelError(message: string, platform: NodeJS.Platform = process.platform): boolean {
  return isCorruptModelFailure(message, { platform });
}

/**
 * Purge a model whose files failed to load, so the next install re-downloads
 * instead of re-reading the same bad bytes.
 *
 * THE BUG THIS EXISTS FOR: isModelCached only asserts `size > 0` per file. That
 * catches the 0-byte stub it was written for, but a TRUNCATED download — e.g.
 * 121 MB of a 353 MB encoder — passes every check. LocalModelDownloadService
 * then verifies via isModelCached, sees "cached", and marks the install
 * complete. The UI reports the model installed, every load fails with a
 * protobuf error, and because the cache check still returns true nothing ever
 * re-fetches it. The corrupt state is self-perpetuating and survives restarts,
 * which is why it presents as "every model fails to download".
 *
 * Returns true when something was actually removed.
 */
export function purgeCorruptModel(modelId: WhisperModelId, reason: string): boolean {
  try {
    // The copy that was being loaded: the resolver picks it the same way here
    // as it did for the worker, since nothing on disk changed in between. When
    // that directory is gone, any other copy on disk is incomplete (the
    // resolver would have picked a complete one), so that one goes instead.
    const cacheDir = getModelsDir();
    const resolved = resolveModelSourceRepo(modelId, activeDtype(), cacheDir);
    // Never a folder a download is still writing: its files are not the ones
    // that failed, and deleting them under the downloader breaks it.
    const modelDir = [resolved, ...candidateRepos(modelId)]
      .map(r => repoDir(cacheDir, r))
      .find(d => fs.existsSync(d) && !fs.existsSync(path.join(d, DOWNLOAD_INCOMPLETE_MARKER)));
    if (!modelDir) return false;
    fs.rmSync(modelDir, { recursive: true, force: true });
    console.warn(`[modelManager] Purged corrupt model ${modelId} — ${reason}`);
    return true;
  } catch (e) {
    console.error(`[modelManager] Failed to purge corrupt model ${modelId}:`, e);
    return false;
  }
}
