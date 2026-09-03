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
  /** True when a `configPatch` rewrote config.json after download. */
  configPatched?: boolean;
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
    // A patched config.json no longer matches its declared size (it was
    // rewritten), so it is matched on presence instead; otherwise every
    // reinstall re-downloads and re-patches it forever.
    const isPatchedConfig = Boolean(model.configPatch) && file.repoPath === 'config.json';
    try {
      const stat = fs.statSync(destination);
      if (stat.isFile() && (isPatchedConfig ? stat.size > 0 : stat.size === file.bytes)) {
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
        // Verified BEFORE the rename. Checking afterwards leaves the finished
        // file sitting at its real path, full size, for as long as it takes to
        // hash 600MB — during which statusOf() reports "installed" and a
        // concurrent load would happily open it. A crash in that window leaves
        // a corrupt model that looks fine forever.
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

  // Records that the file was rewritten, WITHOUT destroying its digest: the one
  // file whose bytes are deliberately mutated is the one whose hash a later
  // integrity check most needs.
  const patched = applyConfigPatch(model, opts.rootOverride);

  return { ok: true, modelId: id, digests, configPatched: patched };
}

/**
 * Write the catalogue's `configPatch` into the downloaded `config.json`.
 *
 * Refuses if that file carries a declared sha256 — patching a verified file
 * would leave bytes on disk that no longer match what was checked, and the next
 * install would look corrupt. In practice config.json is never an LFS object,
 * so it never has one.
 */
function applyConfigPatch(model: LocalRerankerModel, rootOverride?: string): boolean {
  if (!model.configPatch) return false;

  const declared = model.files.find((f) => f.repoPath === 'config.json');
  if (!declared) return false;
  if (declared.sha256) {
    console.warn(`[localModelInstaller] refusing to patch a verified config.json for ${model.id}`);
    return false;
  }

  const file = path.join(modelDirectory(model, rootOverride), 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...config, ...model.configPatch }, null, 2));
    return true;
  } catch (e) {
    console.warn(`[localModelInstaller] could not patch config.json for ${model.id}:`, e);
    return false;
  }
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
