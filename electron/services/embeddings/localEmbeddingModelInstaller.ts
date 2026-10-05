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
import { sha256File } from '../extensions/ModelStore';
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

  // First check downloaded directory
  let bytesOnDisk = 0;
  const missing: string[] = [];

  for (const file of model.files) {
    const dest = fileDestination(model, file, rootOverride);
    try {
      const stat = fs.statSync(dest);
      if (stat.isFile() && stat.size > 0) {
        bytesOnDisk += stat.size;
        continue;
      }
    } catch { /* missing */ }
    missing.push(file.repoPath);
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
    state: missing.length === model.files.length ? 'not-installed' : 'partial',
    bytesOnDisk,
    directory,
    missing,
  };
}

export function listEmbeddingCatalogStatus(rootOverride?: string): Array<LocalEmbeddingModel & { status: LocalEmbeddingModelStatus }> {
  return EMBEDDING_MODEL_CATALOG.map((m) => ({
    ...m,
    status: statusOf(m, rootOverride),
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
  let completedBytes = 0;

  for (const file of model.files) {
    if (signal.aborted) return { ok: false, modelId: id, error: 'cancelled' };

    const destination = fileDestination(model, file, opts.rootOverride);

    try {
      const stat = fs.statSync(destination);
      if (stat.isFile() && stat.size === file.bytes) {
        completedBytes += file.bytes;
        onProgress({ modelId: id, fraction: Math.min(1, completedBytes / total), currentFile: file.repoPath });
        continue;
      }
    } catch { /* not present */ }

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
          onProgress({ modelId: id, fraction: Math.min(1, completedBytes / total), currentFile: file.repoPath });
        },
        signal,
        async (partPath) => {
          const digest = await sha256File(partPath);
          digests[file.repoPath] = digest;
          if (file.sha256 && digest.toLowerCase() !== file.sha256.toLowerCase()) {
            return { ok: false, reason: `${file.repoPath} failed verification: expected ${file.sha256}, got ${digest}` };
          }
          return { ok: true };
        },
      );
    } catch (e) {
      return { ok: false, modelId: id, error: e instanceof Error ? e.message : String(e) };
    }

    completedBytes = before + file.bytes;
    onProgress({ modelId: id, fraction: Math.min(1, completedBytes / total), currentFile: file.repoPath });
  }

  return { ok: true, modelId: id, digests };
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
