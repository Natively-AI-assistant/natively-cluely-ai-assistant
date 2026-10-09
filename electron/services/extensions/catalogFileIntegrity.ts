/**
 * What "this is the catalogue's file" means, for both catalogue installers
 * (reranking/localModelInstaller.ts, embeddings/localEmbeddingModelInstaller.ts).
 *
 * A catalogue entry declares every file's exact length and, where Hugging Face
 * publishes one, its sha256. Both are checked, in that order, at the two points
 * a wrong file can be accepted:
 *
 *  - before SKIPPING a file that is already on disk. Size alone is not enough:
 *    a damaged file keeps its length, and a size-only skip made that damage
 *    permanent, because every reinstall skipped it again.
 *  - before RENAMING a finished download into place. A hash alone is not
 *    enough either: most small files (config.json, tokenizers) carry none, so
 *    without the length check a truncated answer was installed as-is.
 *
 * The length is exact, not an estimate: all 120 declared sizes were compared
 * with the published listing of each pinned revision on 2026-10-09 and match.
 * The downloader's own `approxBytes` stays what it says, a progress
 * denominator; the contract lives here.
 *
 * Nothing that hashes is called from a status poll. Hashing reads the whole
 * file, so it belongs to an install or a check the user asked for, not to
 * drawing a list.
 *
 * DAMAGE AFTER INSTALL. The list therefore cannot see a file that kept its
 * length and lost its contents. Two things cover that:
 *
 *  - a CHECK (findDamagedFiles), run when a model is activated and from the
 *    row's own button, which hashes every file and hands whatever fails to the
 *    installer to fetch again;
 *  - an INSTALL RECORD beside the model, holding the hash of every file as it
 *    was installed. A config or tokenizer has no published hash, so the record
 *    is the only thing that can vouch for one later. It vouches for the file
 *    since install, not for the download itself: that is still length-only.
 *
 * The record also carries which files a check has proven damaged and nothing
 * has repaired yet, so the model LIST can keep saying so: without it a model
 * whose repair failed (offline) would go straight back to reading "installed".
 * That is for the list only. What the app loads is decided by length alone, as
 * it was before records existed: a failed repair must not take away a model
 * that was working a minute earlier.
 */

import * as fs from 'fs';
import * as path from 'path';
import { sha256File } from './ModelStore';

export interface DeclaredFile {
  /** Path inside the repository. May be nested (`onnx/model.onnx`). */
  repoPath: string;
  bytes: number;
  /** null where the catalogue has no digest for this file. */
  sha256: string | null;
}

/** Length of a regular file, or -1 when it is absent or not a file. */
export function regularFileSize(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : -1;
  } catch {
    return -1;
  }
}

/** Whether a file already on disk is the one the catalogue declares. */
export async function existingFileMatches(filePath: string, file: DeclaredFile): Promise<boolean> {
  if (regularFileSize(filePath) !== file.bytes) return false;
  if (!file.sha256) return true;
  try {
    return (await sha256File(filePath)).toLowerCase() === file.sha256.toLowerCase();
  } catch {
    // Unreadable is not "matches". The caller fetches it again.
    return false;
  }
}

export type StagedFileVerdict =
  | { ok: true; digest: string }
  | { ok: false; reason: string };

/**
 * Judge a finished download while it is still a `.part` file.
 *
 * Shaped for `HuggingFaceModelDownloader.download()`'s `verify` argument, which
 * deletes the partial and refuses the rename on `ok: false`.
 */
export async function verifyStagedFile(partPath: string, file: DeclaredFile): Promise<StagedFileVerdict> {
  const size = regularFileSize(partPath);
  if (size !== file.bytes) {
    return {
      ok: false,
      reason: `${file.repoPath} is the wrong size: expected ${file.bytes} bytes, got ${Math.max(size, 0)}`,
    };
  }
  const digest = await sha256File(partPath);
  if (file.sha256 && digest.toLowerCase() !== file.sha256.toLowerCase()) {
    return { ok: false, reason: `${file.repoPath} failed verification: expected ${file.sha256}, got ${digest}` };
  }
  return { ok: true, digest };
}

// ── the install record ───────────────────────────────────────────────────────

export const INSTALL_RECORD_NAME = '.natively-install.json';

export interface InstallRecord {
  version: 1;
  /** The catalogue revision these hashes were taken at. */
  revision: string;
  /** repoPath -> what was installed. */
  files: Record<string, { bytes: number; sha256: string }>;
  /** Files a check proved damaged that have not been repaired since. */
  damaged?: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;

/**
 * The record for this revision, or null. A record that is missing, unreadable,
 * malformed or written for another revision is all the same thing: no record.
 * It never throws and never marks anything damaged on its own say-so, so a
 * mangled record costs the extra protection, not the model.
 */
export function readInstallRecord(modelDir: string, revision: string): InstallRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(modelDir, INSTALL_RECORD_NAME), 'utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw.version !== 1 || raw.revision !== revision) return null;
  if (raw.files === null || typeof raw.files !== 'object' || Array.isArray(raw.files)) return null;

  const files: InstallRecord['files'] = {};
  for (const [repoPath, value] of Object.entries(raw.files as Record<string, unknown>)) {
    const entry = value as { bytes?: unknown; sha256?: unknown } | null;
    if (entry && Number.isSafeInteger(entry.bytes) && typeof entry.sha256 === 'string' && SHA256.test(entry.sha256)) {
      files[repoPath] = { bytes: entry.bytes as number, sha256: entry.sha256 };
    }
  }
  const damaged = Array.isArray(raw.damaged)
    ? raw.damaged.filter((item): item is string => typeof item === 'string')
    : [];
  return { version: 1, revision, files, ...(damaged.length > 0 ? { damaged } : {}) };
}

/** Written beside itself and renamed, so a crash never leaves half a record. */
function writeInstallRecord(modelDir: string, record: InstallRecord): boolean {
  const target = path.join(modelDir, INSTALL_RECORD_NAME);
  const staged = `${target}.tmp`;
  try {
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(staged, `${JSON.stringify(record, null, 2)}\n`);
    fs.renameSync(staged, target);
    return true;
  } catch {
    try { fs.rmSync(staged, { force: true }); } catch { /* nothing staged */ }
    return false;
  }
}

/** The files a check has flagged and nothing has repaired. One small read; for the model list, not the retrieval path. */
export function flaggedDamaged(modelDir: string, revision: string): ReadonlySet<string> {
  return new Set(readInstallRecord(modelDir, revision)?.damaged ?? []);
}

/**
 * The file as it should be checked: with its published hash, or failing that
 * the hash recorded when it was installed (only if the record describes a file
 * of the same declared length).
 */
export function withRecordedHash(file: DeclaredFile, record: InstallRecord | null): DeclaredFile {
  if (file.sha256) return file;
  const recorded = record?.files[file.repoPath];
  return recorded && recorded.bytes === file.bytes ? { ...file, sha256: recorded.sha256 } : file;
}

/**
 * Record a finished install: every file's hash, and no damage outstanding.
 *
 * A hash comes from, in order: the catalogue; this install's own download; the
 * previous record; and last the file as it stands, which is all there is for a
 * model installed before records existed.
 */
export async function recordInstall(args: {
  modelDir: string;
  revision: string;
  files: DeclaredFile[];
  destinationOf: (file: DeclaredFile) => string;
  digests: Record<string, string>;
  previous: InstallRecord | null;
}): Promise<boolean> {
  const files: InstallRecord['files'] = {};
  for (const file of args.files) {
    let sha256 = file.sha256 ?? args.digests[file.repoPath] ?? withRecordedHash(file, args.previous).sha256;
    if (!sha256) {
      try { sha256 = await sha256File(args.destinationOf(file)); } catch { continue; }
    }
    files[file.repoPath] = { bytes: file.bytes, sha256: sha256.toLowerCase() };
  }
  if (writeInstallRecord(args.modelDir, { version: 1, revision: args.revision, files })) return true;
  // A record that cannot be replaced must not go on saying "damaged" about a
  // model that has just been repaired.
  try { fs.rmSync(path.join(args.modelDir, INSTALL_RECORD_NAME), { force: true }); } catch { /* read-only volume */ }
  return false;
}

/** Note what a check found, keeping every hash already recorded. */
export function recordDamage(modelDir: string, revision: string, previous: InstallRecord | null, damaged: string[]): boolean {
  return writeInstallRecord(modelDir, { version: 1, revision, files: previous?.files ?? {}, damaged });
}

/**
 * Hash every file and return the ones that are not what was installed, or
 * 'cancelled'. Reads only.
 *
 * `judge` answers for a file that cannot be checked by length and hash (a
 * config the installer rewrote); returning undefined leaves it to the default.
 */
export async function findDamagedFiles(args: {
  files: DeclaredFile[];
  destinationOf: (file: DeclaredFile) => string;
  record: InstallRecord | null;
  signal: AbortSignal;
  /** Called before each file with the bytes already checked. */
  onFile: (file: DeclaredFile, bytesChecked: number) => void;
  judge?: (file: DeclaredFile, destination: string) => boolean | undefined;
}): Promise<string[] | 'cancelled'> {
  const damaged: string[] = [];
  let bytesChecked = 0;
  for (const file of args.files) {
    if (args.signal.aborted) return 'cancelled';
    args.onFile(file, bytesChecked);
    const destination = args.destinationOf(file);
    const intact = args.judge?.(file, destination)
      ?? await existingFileMatches(destination, withRecordedHash(file, args.record));
    if (!intact) damaged.push(file.repoPath);
    bytesChecked += file.bytes;
  }
  return damaged;
}
