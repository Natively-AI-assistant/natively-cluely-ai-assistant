/**
 * Direct install of a reranker from the curated catalogue — no extension folder
 * to stage, no repository to clone.
 *
 * The ONNX entries land in the directory `LocalReranker.resolveModelPath()`
 * already searches first:
 *
 *     <userData>/local-models/<org>/<name>/tokenizer.json
 *                                        /config.json
 *                                        /onnx/model.onnx
 *
 * That is the layout the cross-encoder/ettin-* repositories publish and the
 * layout transformers.js expects, so a completed download is immediately
 * loadable by the reranker Core already ships. No new runtime, no adapter.
 *
 * GGUF entries deliberately do NOT come through here — see `installGgufModel`.
 *
 * `HuggingFaceModelDownloader` is reused rather than reimplemented: it already
 * pins the revision, handles a server that ignores `Range`, stamps partials with
 * the revision that wrote them, and renames only after the stream closes.
 * `ModelStore` is NOT reused, because its `resolve()` requires a bare filename
 * and these files are nested under `onnx/`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { app } from 'electron';
import { HuggingFaceModelDownloader } from '../extensions/HuggingFaceModelDownloader';
import {
  RERANKER_MODEL_CATALOG, findCatalogModel,
  type CatalogFile, type LocalRerankerModel,
} from '../../rag/rerankerModelCatalog';

export type InstalledState = 'not-installed' | 'partial' | 'installed';

export interface LocalModelStatus {
  id: string;
  state: InstalledState;
  /** Bytes present on disk across every declared file. */
  bytesOnDisk: number;
  /** Absolute directory, present or not. */
  directory: string;
  /** Files still missing, for a "resume" that is honest about what is left. */
  missing: string[];
}

export interface InstallProgress {
  modelId: string;
  /** 0..1 across the WHOLE model, not the current file. */
  fraction: number;
  currentFile: string;
}

/** Root that `LocalReranker.resolveModelPath()` looks in first. */
export function localModelsRoot(override?: string): string {
  if (override) return override;
  if (process.env.NATIVELY_LOCAL_MODELS_PATH) return process.env.NATIVELY_LOCAL_MODELS_PATH;
  try {
    const userData = app?.getPath?.('userData');
    if (userData) return path.join(userData, 'local-models');
  } catch { /* app not ready */ }
  return path.join(fallbackUserDataDir(), 'local-models');
}

/**
 * The `app.getPath('userData')` layout, rebuilt by hand for the one path where
 * `app` is unavailable (ELECTRON_RUN_AS_NODE probes and tests).
 *
 * This used to read USERPROFILE and then join a macOS
 * `Library/Application Support` onto it, which on Windows produces
 * `C:\Users\x\Library\Application Support\natively\local-models` — a
 * directory nothing else in the app ever looks in, so an installed model would
 * be invisible to the reranker that is supposed to load it. Repo convention
 * (CLAUDE.md, "Filesystem and paths") forbids hardcoding an OS-specific path in
 * shared code for exactly this reason.
 */
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

export function modelDirectory(model: LocalRerankerModel, rootOverride?: string): string {
  // repo is 'org/name'; split explicitly so this builds a real nested path on
  // Windows too rather than a directory literally named "org/name".
  return path.join(localModelsRoot(rootOverride), ...model.repo.split('/'));
}

function fileDestination(model: LocalRerankerModel, file: CatalogFile, rootOverride?: string): string {
  return path.join(modelDirectory(model, rootOverride), ...file.repoPath.split('/'));
}

export function statusOf(model: LocalRerankerModel, rootOverride?: string): LocalModelStatus {
  const directory = modelDirectory(model, rootOverride);
  let bytesOnDisk = 0;
  const missing: string[] = [];

  for (const file of model.files) {
    const dest = fileDestination(model, file, rootOverride);
    try {
      const stat = fs.statSync(dest);
      if (stat.isFile() && stat.size > 0) { bytesOnDisk += stat.size; continue; }
    } catch { /* missing */ }
    missing.push(file.repoPath);
  }

  return {
    id: model.id,
    // "partial" is a real state and must not read as installed: transformers.js
    // given a tokenizer but no weights fails at load, long after the UI said Ready.
    state: missing.length === 0 ? 'installed' : missing.length === model.files.length ? 'not-installed' : 'partial',
    bytesOnDisk,
    directory,
    missing,
  };
}

export function listCatalogStatus(rootOverride?: string): Array<LocalRerankerModel & { status: LocalModelStatus }> {
  return RERANKER_MODEL_CATALOG.map((m) => ({ ...m, status: statusOf(m, rootOverride) }));
}

export interface InstallResult {
  ok: boolean;
  modelId: string;
  error?: string;
  /** Digests computed during this install, including for files with no published hash. */
  digests?: Record<string, string>;
}

/**
 * Download every file of a catalogue entry, ONNX or GGUF.
 *
 * The mechanics are identical — files into a directory under the local-models
 * root — so the runtimes do not each need their own installer. Only what reads
 * the result afterwards differs.
 *
 * Progress is reported across the WHOLE model, weighted by the real file sizes,
 * so a 597MB weights file does not sit at "33%" while two small files finish
 * instantly.
 */
export async function installCatalogModel(
  id: string,
  onProgress: (p: InstallProgress) => void,
  signal: AbortSignal,
  opts: { rootOverride?: string; downloader?: HuggingFaceModelDownloader } = {},
): Promise<InstallResult> {
  const model = findCatalogModel(id);
  if (!model) return { ok: false, modelId: id, error: `unknown model "${id}"` };
  if (!model.supported) {
    // Refuse the download rather than spending hundreds of megabytes on bytes
    // this build cannot score. See the catalogue header for what was measured.
    return { ok: false, modelId: id, error: model.unsupportedReason ?? `${model.name} is not supported by this build` };
  }

  const downloader = opts.downloader ?? new HuggingFaceModelDownloader({ logger: console });
  const total = model.files.reduce((n, f) => n + f.bytes, 0) || 1;
  const digests: Record<string, string> = {};
  let completedBytes = 0;

  for (const file of model.files) {
    if (signal.aborted) return { ok: false, modelId: id, error: 'cancelled' };

    const destination = fileDestination(model, file, opts.rootOverride);
    // Already present and the right size — skip rather than re-fetch 597MB.
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
          // The catalogue pins a sha per model; without forwarding it here the
          // downloader resolved the live default branch instead, once per file.
          revision: model.revision,
          // The downloader only uses `file` for messages here; the real
          // destination is passed explicitly.
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
      );
    } catch (e) {
      return { ok: false, modelId: id, error: e instanceof Error ? e.message : String(e) };
    }

    // Verify HERE rather than trusting the download. The downloader writes the
    // bytes; deciding whether they are the right bytes stays with the caller,
    // exactly as ModelStore does it for extensions.
    const actual = await sha256File(destination);
    digests[file.repoPath] = actual;
    if (file.sha256 && actual.toLowerCase() !== file.sha256.toLowerCase()) {
      // A file that fails its hash must not be left behind looking installed.
      try { fs.rmSync(destination, { force: true }); } catch { /* best effort */ }
      return {
        ok: false,
        modelId: id,
        error: `${file.repoPath} failed verification: expected ${file.sha256}, got ${actual}`,
      };
    }

    completedBytes = before + file.bytes;
    onProgress({ modelId: id, fraction: Math.min(1, completedBytes / total), currentFile: file.repoPath });
  }

  return { ok: true, modelId: id, digests };
}

/** Delete an installed ONNX model's directory. */
export function removeCatalogModel(id: string, rootOverride?: string): { ok: boolean; error?: string } {
  const model = findCatalogModel(id);
  if (!model) return { ok: false, error: `unknown model "${id}"` };
  try {
    fs.rmSync(modelDirectory(model, rootOverride), { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Absolute path to a GGUF entry's weights.
 *
 * Null for anything else, so a caller cannot hand an ONNX directory to
 * llama.cpp or a .gguf to transformers.js.
 */
export function ggufModelFile(id: string, rootOverride?: string): string | null {
  const model = findCatalogModel(id);
  if (!model || model.runtime !== 'gguf') return null;
  const file = model.files[0];
  if (!file) return null;
  return path.join(modelDirectory(model, rootOverride), ...file.repoPath.split('/'));
}
