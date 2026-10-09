/**
 * Direct install and status tracking of local embedding models from the curated catalog.
 *
 * Supports both:
 * 1. ONNX models (transformers.js layout: config.json, tokenizer.json, onnx/model_quantized.onnx)
 * 2. GGUF models (single quantized weights file: *.gguf)
 *
 * Downloaded models land in:
 *   <userData>/local-models/<org>/<name>/
 *
 * Bundled models (MiniLM) are also discovered in:
 *   <appPath>/resources/models/<org>/<name>/ or process.resourcesPath/models/...
 */

import * as fs from 'fs';
import * as path from 'path';
import { app, shell } from 'electron';
import { HuggingFaceModelDownloader } from '../extensions/HuggingFaceModelDownloader';
import {
  existingFileMatches, findDamagedFiles, flaggedDamaged, readInstallRecord, recordDamage, recordInstall,
  regularFileSize, verifyStagedFile, withRecordedHash,
} from '../extensions/catalogFileIntegrity';
import {
  EMBEDDING_MODEL_CATALOG,
  findEmbeddingCatalogModel,
  type CatalogFile,
  type LocalEmbeddingModel,
} from '../../rag/embeddingModelCatalog';

export type InstalledState = 'not-installed' | 'partial' | 'installed';

export interface LocalEmbeddingModelStatus {
  id: string;
  state: InstalledState;
  /** Bytes present on disk across every declared file. */
  bytesOnDisk: number;
  /** Absolute directory, present or not. */
  directory: string;
  /** Files still missing. */
  missing: string[];
}

export interface InstallProgress {
  modelId: string;
  /** 0..1 across the WHOLE model. */
  fraction: number;
  currentFile: string;
  /**
   * 'checking' while a file already on disk is being hashed, 'downloading'
   * while one is being fetched. A check of an intact model is all 'checking',
   * and the row must not present that as a download.
   */
  phase: 'checking' | 'downloading';
}

/** Root where downloaded local models live. */
export function localModelsRoot(override?: string): string {
  if (override) return override;
  if (process.env.NATIVELY_LOCAL_MODELS_PATH) return process.env.NATIVELY_LOCAL_MODELS_PATH;
  try {
    const userData = app?.getPath?.('userData');
    if (userData) return path.join(userData, 'local-models');
  } catch { /* app not ready */ }
  return path.join(fallbackUserDataDir(), 'local-models');
}

function fallbackUserDataDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'natively');
    case 'win32':
      return path.join(
        process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
        'natively',
      );
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME || path.join(home, '.config'),
        'natively',
      );
  }
}

export function modelDirectory(model: LocalEmbeddingModel, rootOverride?: string): string {
  return path.join(localModelsRoot(rootOverride), ...model.repo.split('/'));
}

export function bundledModelDirectory(model: LocalEmbeddingModel): string | null {
  const candidates: string[] = [];
  if (process.env.NATIVELY_LOCAL_MODELS_PATH) candidates.push(process.env.NATIVELY_LOCAL_MODELS_PATH);
  try {
    if (app.isPackaged) candidates.push(path.join(process.resourcesPath, 'models'));
  } catch { /* not ready */ }
  let appPath = '';
  try { appPath = app.getAppPath(); } catch { /* not ready */ }
  if (appPath) {
    candidates.push(path.join(appPath, 'resources', 'models'));
    candidates.push(path.join(appPath, '..', 'resources', 'models'));
    candidates.push(path.join(appPath, '..', '..', 'resources', 'models'));
  }
  // Also check cwd for test harnesses
  candidates.push(path.join(process.cwd(), 'resources', 'models'));

  for (const c of candidates) {
    const candidateDir = path.join(c, ...model.repo.split('/'));
    if (fs.existsSync(candidateDir)) {
      return candidateDir;
    }
  }
  return null;
}

function fileDestination(model: LocalEmbeddingModel, file: CatalogFile, rootOverride?: string): string {
  return path.join(modelDirectory(model, rootOverride), ...file.repoPath.split('/'));
}

export function statusOf(model: LocalEmbeddingModel, rootOverride?: string): LocalEmbeddingModelStatus {
  const directory = modelDirectory(model, rootOverride);
  const bundledDir = model.bundled ? bundledModelDirectory(model) : null;

  // First check downloaded directory. A download is the catalogue's exact
  // length or it is not that file: a truncated one used to read as installed
  // here and then fail at load. Length only, never a hash, and never the
  // install record: this decides what the embedding provider loads as well as
  // what the list draws.
  let bytesOnDisk = 0;
  const missing: string[] = [];

  for (const file of model.files) {
    const size = regularFileSize(fileDestination(model, file, rootOverride));
    if (size > 0) bytesOnDisk += size;
    if (size !== file.bytes) missing.push(file.repoPath);
  }

  if (missing.length === 0) {
    return {
      id: model.id,
      state: 'installed',
      bytesOnDisk,
      directory,
      missing: [],
    };
  }

  // If missing in user-data, check bundled location if marked bundled
  if (bundledDir && model.bundled) {
    let bundledBytes = 0;
    const bundledMissing: string[] = [];
    for (const file of model.files) {
      const bundledDest = path.join(bundledDir, ...file.repoPath.split('/'));
      try {
        const stat = fs.statSync(bundledDest);
        if (stat.isFile() && stat.size > 0) {
          bundledBytes += stat.size;
          continue;
        }
      } catch { /* missing */ }
      bundledMissing.push(file.repoPath);
    }
    if (bundledMissing.length === 0) {
      return {
        id: model.id,
        state: 'installed',
        bytesOnDisk: bundledBytes,
        directory: bundledDir,
        missing: [],
      };
    }
  }

  return {
    id: model.id,
    // Bytes on disk mean "partial" even when no file is the right length yet,
    // so the row offers to resume rather than to start over.
    state: bytesOnDisk === 0 ? 'not-installed' : 'partial',
    bytesOnDisk,
    directory,
    missing,
  };
}

/**
 * `statusOf`, plus what a check has proven damaged and nothing has repaired
 * yet: such a model is listed as `partial`, so its row offers Download.
 *
 * For the model list only. What the app LOADS goes by `statusOf`
 * (resolveEmbeddingModelPath): a model whose repair failed (offline) is the
 * same model that was embedding a minute earlier, and withdrawing it there
 * leaves the index with no embedder at all at the next launch.
 *
 * Only a downloaded copy can be flagged. The bundled model served from the
 * app's own resources is never checked, so it is never listed as damaged.
 */
export function listedStatusOf(model: LocalEmbeddingModel, rootOverride?: string): LocalEmbeddingModelStatus {
  const status = statusOf(model, rootOverride);
  const directory = modelDirectory(model, rootOverride);
  if (status.state !== 'installed' || status.directory !== directory) return status;
  const flagged = flaggedDamaged(directory, model.revision);
  const damaged = model.files.map((file) => file.repoPath).filter((repoPath) => flagged.has(repoPath));
  return damaged.length === 0 ? status : { ...status, state: 'partial', missing: damaged };
}

export function listEmbeddingCatalogStatus(rootOverride?: string): Array<LocalEmbeddingModel & { status: LocalEmbeddingModelStatus }> {
  return EMBEDDING_MODEL_CATALOG.map((m) => ({
    ...m,
    status: listedStatusOf(m, rootOverride),
  }));
}

export interface InstallResult {
  ok: boolean;
  modelId: string;
  error?: string;
  digests?: Record<string, string>;
}

export async function installEmbeddingCatalogModel(
  id: string,
  onProgress: (p: InstallProgress) => void,
  signal: AbortSignal,
  opts: { rootOverride?: string; downloader?: HuggingFaceModelDownloader } = {},
): Promise<InstallResult> {
  const model = findEmbeddingCatalogModel(id);
  if (!model) return { ok: false, modelId: id, error: `unknown model "${id}"` };

  const downloader = opts.downloader ?? new HuggingFaceModelDownloader({ logger: console });
  const total = model.files.reduce((n, f) => n + f.bytes, 0) || 1;
  const digests: Record<string, string> = {};
  const directory = modelDirectory(model, opts.rootOverride);
  // Hashes from the last install, for the files nobody publishes one for.
  const previous = readInstallRecord(directory, model.revision);
  let completedBytes = 0;

  for (const file of model.files) {
    if (signal.aborted) return { ok: false, modelId: id, error: 'cancelled' };

    const destination = fileDestination(model, file, opts.rootOverride);

    // Skip only what is provably the catalogue's file: right length AND, where
    // one is published or was recorded at install, right hash. A mismatch is fetched again; the downloader
    // keeps the old file in place until the replacement has been verified.
    // Name the file before checking it: hashing a multi-gigabyte file that is
    // already here takes seconds, and the row would otherwise sit silent.
    onProgress({ modelId: id, fraction: Math.min(1, completedBytes / total), currentFile: file.repoPath, phase: 'checking' });
    if (await existingFileMatches(destination, withRecordedHash(file, previous))) {
      completedBytes += file.bytes;
      onProgress({ modelId: id, fraction: Math.min(1, completedBytes / total), currentFile: file.repoPath, phase: 'checking' });
      continue;
    }

    const before = completedBytes;
    try {
      await downloader.download(
        {
          key: `${model.id}:${file.repoPath}`,
          format: model.runtime,
          source: 'huggingface',
          repo: model.repo,
          repoPath: file.repoPath,
          revision: model.revision,
          file: path.basename(file.repoPath),
          approxBytes: file.bytes,
          sha256: file.sha256,
          license: model.license,
        } as never,
        destination,
        (fraction) => {
          completedBytes = before + fraction * file.bytes;
          onProgress({ modelId: id, fraction: Math.min(1, completedBytes / total), currentFile: file.repoPath, phase: 'downloading' });
        },
        signal,
        // Length and hash, BEFORE the rename (catalogFileIntegrity.ts).
        async (partPath) => {
          const verdict = await verifyStagedFile(partPath, file);
          if (verdict.ok) digests[file.repoPath] = verdict.digest;
          return verdict;
        },
      );
    } catch (e) {
      return { ok: false, modelId: id, error: e instanceof Error ? e.message : String(e) };
    }

    completedBytes = before + file.bytes;
    onProgress({ modelId: id, fraction: Math.min(1, completedBytes / total), currentFile: file.repoPath, phase: 'downloading' });
  }

  // Every file's hash, so a later check can tell a damaged config or tokenizer
  // from the one installed here (catalogFileIntegrity.ts).
  await recordInstall({
    modelDir: directory,
    revision: model.revision,
    files: model.files,
    destinationOf: (file) => fileDestination(model, file, opts.rootOverride),
    digests,
    previous,
  });

  return { ok: true, modelId: id, digests };
}

export interface CheckResult {
  ok: boolean;
  modelId: string;
  /** Files that were damaged and have been fetched again. Empty when intact. */
  repaired: string[];
  error?: string;
}

/**
 * Hash an installed model's files and fetch again whatever is not what was
 * installed. Run when a model is activated and from the row's own button; the
 * list itself may only stat (see statusOf).
 *
 * It repairs what was downloaded and never starts a download of its own. That
 * rules out two things: a model that is not installed (the row offers Download
 * for it), and the bundled model while it is being served from the app's own
 * resources. Those files are pruned for shipping and are not the catalogue's
 * byte for byte; the package vouches for them, and "repairing" them would
 * download a second copy nobody asked for.
 *
 * Damage that cannot be repaired (offline) is recorded, so the model stops
 * reading as installed until a later check or download succeeds. Nothing is
 * deleted: the downloader replaces a file only once its replacement verifies.
 */
export async function checkAndRepairEmbeddingCatalogModel(
  id: string,
  onProgress: (p: InstallProgress) => void,
  signal: AbortSignal,
  opts: { rootOverride?: string; downloader?: HuggingFaceModelDownloader } = {},
): Promise<CheckResult> {
  const model = findEmbeddingCatalogModel(id);
  if (!model) return { ok: false, modelId: id, repaired: [], error: `unknown model "${id}"` };

  const directory = modelDirectory(model, opts.rootOverride);
  const record = readInstallRecord(directory, model.revision);
  const flagged = (record?.damaged?.length ?? 0) > 0;
  const status = statusOf(model, opts.rootOverride);
  if (status.state === 'installed' && status.directory !== directory) {
    return { ok: true, modelId: id, repaired: [] };
  }
  if (status.state !== 'installed' && !flagged) {
    return { ok: false, modelId: id, repaired: [], error: `${model.name} is not fully downloaded` };
  }

  const total = model.files.reduce((n, f) => n + f.bytes, 0) || 1;
  const destinationOf = (file: CatalogFile) => fileDestination(model, file, opts.rootOverride);
  const damaged = await findDamagedFiles({
    files: model.files,
    destinationOf,
    record,
    signal,
    onFile: (file, bytesChecked) => onProgress({
      modelId: id, fraction: Math.min(1, bytesChecked / total), currentFile: file.repoPath, phase: 'checking',
    }),
  });
  if (damaged === 'cancelled') return { ok: false, modelId: id, repaired: [], error: 'cancelled' };

  if (damaged.length === 0) {
    // First check of a model installed before records existed, or one whose
    // files have since been put right some other way: record what is here.
    if (!record || flagged) {
      await recordInstall({ modelDir: directory, revision: model.revision, files: model.files, destinationOf, digests: {}, previous: record });
    }
    return { ok: true, modelId: id, repaired: [] };
  }

  console.warn(`[LocalEmbedding] ${model.id}: ${damaged.length} file(s) are not what was installed; fetching again: ${damaged.join(', ')}`);
  recordDamage(directory, model.revision, record, damaged);
  const repair = await installEmbeddingCatalogModel(id, onProgress, signal, opts);
  if (!repair.ok) return { ok: false, modelId: id, repaired: [], error: repair.error };
  // What was actually fetched, not what the first pass flagged: a file that
  // could not be read for a moment passes the install's own check untouched,
  // and that is not a repair.
  const fetched = repair.digests ?? {};
  return { ok: true, modelId: id, repaired: damaged.filter((repoPath) => repoPath in fetched) };
}

export function removeEmbeddingCatalogModel(id: string, rootOverride?: string): { ok: boolean; error?: string } {
  const model = findEmbeddingCatalogModel(id);
  if (!model) return { ok: false, error: `unknown model "${id}"` };
  if (model.bundled) {
    return { ok: false, error: 'Cannot remove bundled default model' };
  }
  try {
    fs.rmSync(modelDirectory(model, rootOverride), { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Resolves the absolute model path (directory for ONNX, file for GGUF)
 * for a model if installed or bundled.
 */
export function resolveEmbeddingModelPath(model: LocalEmbeddingModel, rootOverride?: string): string | null {
  const status = statusOf(model, rootOverride);
  if (status.state !== 'installed') {
    return null;
  }

  if (model.runtime === 'gguf') {
    const ggufFileName = model.ggufFile || model.files.find((f) => f.repoPath.endsWith('.gguf'))?.repoPath;
    if (!ggufFileName) return null;
    return path.join(status.directory, ...ggufFileName.split('/'));
  }

  // ONNX: returns root directory containing model and tokenizer
  return status.directory;
}

export async function revealLocalEmbeddingModelsDirectory(rootOverride?: string): Promise<boolean> {
  const dir = localModelsRoot(rootOverride);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (shell?.openPath) {
      const res = await shell.openPath(dir);
      return res === '';
    }
    return true;
  } catch (e) {
    console.error('[LocalEmbedding] Failed to reveal local models folder:', e);
    return false;
  }
}
