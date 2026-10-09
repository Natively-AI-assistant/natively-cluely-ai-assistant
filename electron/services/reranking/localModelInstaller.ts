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
import { isDeepStrictEqual } from 'util';
import { app } from 'electron';
import { HuggingFaceModelDownloader } from '../extensions/HuggingFaceModelDownloader';
import {
  existingFileMatches, findDamagedFiles, flaggedDamaged, readInstallRecord, recordDamage, recordInstall,
  regularFileSize, verifyStagedFile, withRecordedHash,
} from '../extensions/catalogFileIntegrity';
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
  /**
   * 'checking' while a file already on disk is being hashed, 'downloading'
   * while one is being fetched. A check of an intact model is all 'checking',
   * and the row must not present that as a download.
   */
  phase: 'checking' | 'downloading';
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
    const size = regularFileSize(dest);
    if (size > 0) bytesOnDisk += size;
    // A download is the catalogue's exact length or it is not that file: a
    // truncated one used to read as installed here and then fail at load.
    // Length only, never a hash, and never the install record: this runs on
    // every retrieval as well as every time the list is drawn. The one
    // rewritten file is judged by what it must contain instead, since its
    // length changed when it was patched.
    const present = isPatchedConfig(model, file)
      ? patchedConfigState(dest, file, model.configPatch!) === 'patched'
      : size === file.bytes;
    if (!present) missing.push(file.repoPath);
  }

  return {
    id: model.id,
    // "partial" is a real state and must not read as installed: transformers.js
    // given a tokenizer but no weights fails at load, long after the UI said Ready.
    // Bytes on disk mean "partial" even when no file is right yet, so the row
    // offers to resume rather than to start over.
    state: missing.length === 0 ? 'installed' : bytesOnDisk === 0 ? 'not-installed' : 'partial',
    bytesOnDisk,
    directory,
    missing,
  };
}

/**
 * `statusOf`, plus what a check has proven damaged and nothing has repaired
 * yet: such a model is listed as `partial`, so its row offers Download.
 *
 * For the model list only. What the app RUNS goes by `statusOf`: a model whose
 * repair failed (offline) is the same model that was serving a minute earlier,
 * and withdrawing it there would leave the user with no reranker at all over
 * damage they have already been told about.
 */
export function listedStatusOf(model: LocalRerankerModel, rootOverride?: string): LocalModelStatus {
  const status = statusOf(model, rootOverride);
  if (status.state !== 'installed') return status;
  const flagged = flaggedDamaged(status.directory, model.revision);
  const damaged = model.files.map((file) => file.repoPath).filter((repoPath) => flagged.has(repoPath));
  return damaged.length === 0 ? status : { ...status, state: 'partial', missing: damaged };
}

export function listCatalogStatus(rootOverride?: string): Array<LocalRerankerModel & { status: LocalModelStatus }> {
  return RERANKER_MODEL_CATALOG.map((m) => ({ ...m, status: listedStatusOf(m, rootOverride) }));
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
  // `supported` is deliberately NOT checked here. It answers "can Natively score
  // this yet", which is a different question from "may the user have the file".
  // Downloading is always an explicit act, the card states plainly that the
  // model is not usable, and activation still refuses it — so refusing the
  // download too was substituting my judgement for the user's about their own
  // disk. The bytes are useful on their own: for a future runtime, or for
  // another tool entirely.

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
    // Skip rather than re-fetch 597MB, but only what is provably the
    // catalogue's file: right length AND, where one is published or was
    // recorded at install, right hash.
    // A mismatch is fetched again; the downloader keeps the old file in place
    // until the replacement has been verified.
    //
    // A patched config.json no longer matches its declared size (it was
    // rewritten), so it is matched on being usable instead: already patched,
    // or still the untouched upstream file that applyConfigPatch() below will
    // finish. Otherwise every reinstall re-downloads and re-patches it forever.
    // Name the file before checking it: hashing a multi-gigabyte file that is
    // already here takes seconds, and the row would otherwise sit silent.
    onProgress({ modelId: id, fraction: Math.min(1, completedBytes / total), currentFile: file.repoPath, phase: 'checking' });
    const reusable = isPatchedConfig(model, file)
      ? patchedConfigState(destination, file, model.configPatch!) !== 'unusable'
      : await existingFileMatches(destination, withRecordedHash(file, previous));
    if (reusable) {
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
          onProgress({ modelId: id, fraction: Math.min(1, completedBytes / total), currentFile: file.repoPath, phase: 'downloading' });
        },
        signal,
        // Verified BEFORE the rename. Checking afterwards leaves the finished
        // file sitting at its real path, full size, for as long as it takes to
        // hash 600MB — during which statusOf() reports "installed" and a
        // concurrent load would happily open it. A crash in that window leaves
        // a corrupt model that looks fine forever.
        //
        // Length as well as hash (catalogFileIntegrity.ts): most small files
        // carry no hash, and a truncated one was installed as-is.
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

  // Records that the file was rewritten, WITHOUT destroying its digest: the one
  // file whose bytes are deliberately mutated is the one whose hash a later
  // integrity check most needs.
  //
  // A patch that could not be written is a FAILED install, not a note on a
  // successful one: the entry declares the patch because transformers.js cannot
  // load the model without it, so "ok" here used to mean "downloaded, unusable".
  const patch = applyConfigPatch(model, opts.rootOverride);
  if (patch.error) return { ok: false, modelId: id, error: patch.error };


  // Every file's hash, so a later check can tell a damaged config or tokenizer
  // from the one installed here. Not the rewritten config: its bytes are this
  // installer's own, and it is judged by what it must contain instead.
  await recordInstall({
    modelDir: directory,
    revision: model.revision,
    files: model.files.filter((file) => !isPatchedConfig(model, file)),
    destinationOf: (file) => fileDestination(model, file, opts.rootOverride),
    digests,
    previous,
  });

  return { ok: true, modelId: id, digests, configPatched: patch.rewritten };
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
 * installed. Run when a model is activated and from the row's own button.
 *
 * The list cannot do this: it is drawn constantly and may only stat. So a file
 * that kept its length and lost its contents read as installed until now, and
 * could pass activation as long as the runtime still produced numbers.
 *
 * It repairs what was installed and never starts a download of its own: a
 * model that is not installed is refused, since the row offers Download for it.
 * Damage that cannot be repaired (offline) is recorded, so the model stops
 * reading as installed until a later check or download succeeds. Nothing is
 * deleted: the downloader replaces a file only once its replacement verifies.
 */
export async function checkAndRepairCatalogModel(
  id: string,
  onProgress: (p: InstallProgress) => void,
  signal: AbortSignal,
  opts: {
    rootOverride?: string;
    downloader?: HuggingFaceModelDownloader;
    /**
     * Runs once damage is found, before anything is fetched. The caller uses it
     * to let go of the model if it is the one loaded: Windows will not replace
     * a file a running session still has open.
     */
    beforeRepair?: () => void | Promise<void>;
  } = {},
): Promise<CheckResult> {
  const model = findCatalogModel(id);
  if (!model) return { ok: false, modelId: id, repaired: [], error: `unknown model "${id}"` };

  const directory = modelDirectory(model, opts.rootOverride);
  const record = readInstallRecord(directory, model.revision);
  const flagged = (record?.damaged?.length ?? 0) > 0;
  if (statusOf(model, opts.rootOverride).state !== 'installed' && !flagged) {
    return { ok: false, modelId: id, repaired: [], error: `${model.name} is not fully downloaded` };
  }

  const total = model.files.reduce((n, f) => n + f.bytes, 0) || 1;
  const damaged = await findDamagedFiles({
    files: model.files,
    destinationOf: (file) => fileDestination(model, file, opts.rootOverride),
    record,
    signal,
    onFile: (file, bytesChecked) => onProgress({
      modelId: id, fraction: Math.min(1, bytesChecked / total), currentFile: file.repoPath, phase: 'checking',
    }),
    judge: (file, destination) => (isPatchedConfig(model, file)
      ? patchedConfigState(destination, file, model.configPatch!) === 'patched'
      : undefined),
  });
  if (damaged === 'cancelled') return { ok: false, modelId: id, repaired: [], error: 'cancelled' };

  if (damaged.length === 0) {
    // First check of a model installed before records existed, or one whose
    // files have since been put right some other way: record what is here.
    if (!record || flagged) {
      await recordInstall({
        modelDir: directory,
        revision: model.revision,
        files: model.files.filter((file) => !isPatchedConfig(model, file)),
        destinationOf: (file) => fileDestination(model, file, opts.rootOverride),
        digests: {},
        previous: record,
      });
    }
    return { ok: true, modelId: id, repaired: [] };
  }

  console.warn(`[localModelInstaller] ${model.id}: ${damaged.length} file(s) are not what was installed; fetching again: ${damaged.join(', ')}`);
  recordDamage(directory, model.revision, record, damaged);
  try { await opts.beforeRepair?.(); } catch { /* releasing the model is best effort */ }
  const repair = await installCatalogModel(id, onProgress, signal, opts);
  if (!repair.ok) return { ok: false, modelId: id, repaired: [], error: repair.error };
  // What was actually fetched or rewritten, not what the first pass flagged: a
  // file that could not be read for a moment passes the install's own check
  // untouched, and that is not a repair.
  const replaced = new Set(Object.keys(repair.digests ?? {}));
  if (repair.configPatched) replaced.add('config.json');
  return { ok: true, modelId: id, repaired: damaged.filter((repoPath) => replaced.has(repoPath)) };
}

/** The one file an entry rewrites after download, so it is not checked by length. */
function isPatchedConfig(model: LocalRerankerModel, file: CatalogFile): boolean {
  return Boolean(model.configPatch) && file.repoPath === 'config.json';
}

/**
 * What a `config.json` on disk is, for an entry that patches it:
 *
 *  - 'patched'   a JSON object that already carries every patched field;
 *  - 'pristine'  the untouched upstream file (still its declared length), which
 *                is what a crash between download and rewrite leaves behind;
 *  - 'unusable'  missing, not a JSON object, or neither of the above.
 *
 * A small synchronous read, and only for the entries that declare a patch.
 */
function patchedConfigState(
  configPath: string,
  file: CatalogFile,
  patch: Record<string, unknown>,
): 'patched' | 'pristine' | 'unusable' {
  let config: unknown;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return 'unusable';
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return 'unusable';
  const fields = config as Record<string, unknown>;
  if (Object.entries(patch).every(([key, value]) => isDeepStrictEqual(fields[key], value))) return 'patched';
  return regularFileSize(configPath) === file.bytes ? 'pristine' : 'unusable';
}

/**
 * Write the catalogue's `configPatch` into the downloaded `config.json`.
 *
 * Refuses if that file carries a declared sha256 — patching a verified file
 * would leave bytes on disk that no longer match what was checked, and the next
 * install would look corrupt. In practice config.json is never an LFS object,
 * so it never has one; if an entry ever declares both, the install fails with
 * that reason instead of passing with the patch quietly missing.
 *
 * `error` is set whenever the entry needs a patch that is not on disk when
 * this returns.
 */
function applyConfigPatch(
  model: LocalRerankerModel,
  rootOverride?: string,
): { rewritten: boolean; error?: string } {
  if (!model.configPatch) return { rewritten: false };

  const declared = model.files.find((f) => f.repoPath === 'config.json');
  if (!declared) {
    return { rewritten: false, error: `${model.name} needs its config.json adjusted, but the catalogue does not list that file` };
  }
  if (declared.sha256) {
    console.warn(`[localModelInstaller] refusing to patch a verified config.json for ${model.id}`);
    return { rewritten: false, error: `${model.name} needs its config.json adjusted, but that file is verified by hash and must not be changed` };
  }

  const file = path.join(modelDirectory(model, rootOverride), 'config.json');
  const state = patchedConfigState(file, declared, model.configPatch);
  if (state === 'patched') return { rewritten: false };
  if (state === 'unusable') {
    console.warn(`[localModelInstaller] config.json for ${model.id} is not a JSON object; cannot patch it`);
    return { rewritten: false, error: `config.json for ${model.name} could not be read, so the settings this model needs were not written. Download it again.` };
  }
  try {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...config, ...model.configPatch }, null, 2));
    return { rewritten: true };
  } catch (e) {
    console.warn(`[localModelInstaller] could not patch config.json for ${model.id}:`, e);
    return { rewritten: false, error: `config.json for ${model.name} could not be updated with the settings this model needs. Download it again.` };
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



/**
 * Absolute path to a GGUF entry's weights.
 *
 * Null for anything else, so a caller cannot hand an ONNX directory to
 * llama.cpp or a .gguf to transformers.js.
 */
export function ggufModelFile(id: string, rootOverride?: string): string | null {
  const model = findCatalogModel(id);
  if (!model || model.runtime !== 'gguf') return null;
  // The FIRST .gguf, not files[0]: a GGUF entry may legitimately ship
  // companion files alongside the weights — jina-reranker-v3.5 needs a
  // separate projector and its own tokenizer — and returning one of those as
  // "the model" would hand llama.cpp a safetensors blob.
  const file = model.files.find(f => f.repoPath.endsWith('.gguf')) ?? model.files[0];
  if (!file) return null;
  return path.join(modelDirectory(model, rootOverride), ...file.repoPath.split('/'));
}

/**
 * A companion file that was downloaded alongside a model's weights.
 *
 * Returns null when the entry does not declare that file, so a caller cannot
 * build a path into a file the installer never fetched and then fail on open.
 */
export function companionModelFile(id: string, repoPath: string, rootOverride?: string): string | null {
  const model = findCatalogModel(id);
  if (!model) return null;
  if (!model.files.some(f => f.repoPath === repoPath)) return null;
  return path.join(modelDirectory(model, rootOverride), ...repoPath.split('/'));
}
