// electron/services/skills/SkillInstaller.ts
//
// Step 2 of the Skill Upload feature — pure install logic that writes a
// validated SkillUploadPayload to disk atomically. The installer:
//   1. Re-runs validateSkillPayload as a defense-in-depth gate.
//   2. Stages the entire skill folder under a unique temp dir
//      (`os.tmpdir()/natively-skill-upload-<uuid>`), so a crash mid-write
//      never leaves the user's skills dir in a half-baked state.
//   3. On full success, `fs.renameSync` the staged tree into the final
//      `userData/skills/<id>/` slot. POSIX-atomic on the same volume;
//      near-atomic on Windows (same volume is the precondition).
//   4. On ANY failure, rolls back by deleting the staging dir.
//
// CONSTRAINTS (per step-2 spec):
//   - No `electron` import. `skillsRoot` is injected by the caller — this
//     keeps the unit tests headless and lets the IPC layer (step 3) hand
//     in `app.getPath('userData')/skills`.
//   - No new dependencies. Only `node:fs`, `node:path`, `node:os`, `node:crypto`.
//   - Imports `SkillsManager` for TYPE ONLY (`SkillSummary`, `SkillSource`)
//     — the installer's read of "what's already installed" arrives via
//     `InstallSkillOptions.existingIds`. The IPC handler (step 3) calls
//     `SkillsManager.listSkills()` and passes the ids in.
//
// CONSTANT JUSTIFICATIONS:
//   - `STAGING_DIR_PREFIX = 'natively-skill-upload-'`. The prefix lets the
//     stale-stage reaper (`reapStaleUploadStages`) target ONLY its own
//     leftovers even when `os.tmpdir()` is shared with other tools.
//   - `DEFAULT_REAP_AGE_MS = 60 * 60 * 1000` (1 hour). Long enough that an
//     in-flight install will finish before being reaped (in normal use the
//     rename completes in <500ms), short enough that a hard-crash during
//     staging doesn't leak temp dirs for the rest of the session.
//   - `crypto.randomUUID()` (not `Math.random()`) so concurrent installs can
//     never collide. `Math.random()` suffixes also break resume-on-relaunch
//     because there is no deterministic key to attach a crash log to.
//   - `MAX_ERRORS = 25` mirrors the validator. The installer itself never
//     emits more than one structural error (write_failed, already_installed,
//     path_traversal), so this cap is purely a safety net.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import {
  validateSkillPayload,
  decodeBase64ToUtf8,
  DEFAULT_BUILTIN_SKILL_IDS,
  type SkillUploadPayload,
  type SkillUploadPreview,
  type SkillValidationError,
} from './SkillValidator';

import type { SkillSummary, SkillSource } from '../SkillsManager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prefix for staged upload dirs under `os.tmpdir()`. */
export const STAGING_DIR_PREFIX = 'natively-skill-upload-';

/** Default age threshold (1 hour) before a stale stage dir is reaped. */
export const DEFAULT_REAP_AGE_MS = 60 * 60 * 1000;

/** Mirror of `SkillValidator`'s MAX_ERRORS, for the installer's own error cap. */
const MAX_ERRORS = 25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallSkillOptions {
  /** Currently installed skill ids, from `SkillsManager.listSkills()`. */
  existingIds?: ReadonlySet<string>;
  /** Builtin-reserved ids, default = `DEFAULT_BUILTIN_SKILL_IDS`. */
  builtinIds?: ReadonlySet<string>;
  /** Override the staging temp dir root (for tests). Default = `os.tmpdir()`. */
  stagingRoot?: string;
  /** Override the final skills dir (for tests). Default = `<userData>/skills/`. */
  skillsRoot?: string;
  /** Override MAX_ERRORS for the installer's own error cap. Default = 25. */
  maxErrors?: number;
  /**
   * Forwarded to the validator. Lets tests exercise the same caps the
   * renderer would use in production. Defaults to the validator's own
   * defaults (100 KiB / file, 5 MiB / payload).
   */
  maxFileBytes?: number;
  /** Forwarded to the validator. See `maxFileBytes`. */
  maxTotalBytes?: number;
  /** Forwarded to the validator. */
  maxInstructionsPreview?: number;
}

export interface InstallSkillSuccess {
  success: true;
  skill: SkillSummary;
  /** The on-disk folder path. */
  installedPath: string;
}

export interface InstallSkillFailure {
  success: false;
  errors: SkillValidationError[];
}

export type InstallSkillOutcome = InstallSkillSuccess | InstallSkillFailure;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert any synchronous-looking error into a `SkillValidationError` of
 * `field: 'structure'` so the caller can pattern-match on `code` without
 * branching on `instanceof`.
 */
function writeError(message: string, code: string): SkillValidationError {
  return { field: 'structure', code, message };
}

/**
 * Defense-in-depth: even though the validator already rejected `..` and
 * absolute paths, re-verify that `path.resolve(root, relPath)` stays
 * inside `root`. Catches anything the validator missed (e.g. the validator
 * was upgraded without us noticing).
 */
function isInsideDir(root: string, relPath: string): boolean {
  const resolved = path.resolve(root, relPath);
  // Use separator to avoid `foo` matching `foobar`.
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved === root || resolved.startsWith(rootWithSep);
}

/**
 * Best-effort rollback. Swallows its own errors and logs them — by the time
 * we get here the user's skills dir is already untouched (rename hadn't
 * happened) so the worst case is leaking a few KB in `os.tmpdir()`. The
 * stale-stage reaper will clean up on next app start.
 */
function safeRemove(stagingDir: string, errors: SkillValidationError[], code: string): SkillValidationError[] {
  try {
    // `force: true` so ENOENT on a partially-removed dir doesn't throw.
    fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch (e) {
    // Don't mask the original write error — just append a notice.
    const msg = (e as Error)?.message || String(e);
    errors.push(writeError(`Rollback failed: ${msg}`, code + '_rollback'));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate → stage → atomic-rename an uploaded skill to disk.
 *
 * Returns `{ success: true, skill, installedPath }` on success, or
 * `{ success: false, errors }` on any failure (validation, traversal,
 * write failure, already-installed). On failure, no partial files are
 * left behind in the final skills dir; any stage dir is rolled back.
 */
export async function installUploadedSkill(
  payload: SkillUploadPayload,
  opts: InstallSkillOptions = {}
): Promise<InstallSkillOutcome> {
  const builtinIds = opts.builtinIds ?? DEFAULT_BUILTIN_SKILL_IDS;
  const maxErrors = opts.maxErrors ?? MAX_ERRORS;
  const stagingRoot = opts.stagingRoot ?? os.tmpdir();
  const skillsRoot = opts.skillsRoot; // caller MUST inject this — no `app` import.

  if (!skillsRoot) {
    // This is a programmer error (the IPC layer is the only consumer in
    // production and always provides it). Surface as a structured error so
    // tests catch it loudly.
    return {
      success: false,
      errors: [writeError(
        'installUploadedSkill requires `skillsRoot` (no default available without electron).',
        'install_misconfigured'
      )],
    };
  }

  // 1. Re-validate. Defense-in-depth: a race between the renderer's
  //    "preview" call and this call could mean the disk state shifted.
  const validation = validateSkillPayload(payload, {
    existingIds: opts.existingIds,
    builtinIds,
    maxFileBytes: opts.maxFileBytes,
    maxTotalBytes: opts.maxTotalBytes,
    maxInstructionsPreview: opts.maxInstructionsPreview,
  });
  if (validation.ok === false) {
    return { success: false, errors: validation.errors };
  }
  const preview: SkillUploadPreview = validation.preview;

  // 2. Idempotency check — refuse to overwrite an already-installed skill.
  //    This runs BEFORE staging so we don't burn a UUID for a request we're
  //    going to reject anyway. (`opts.existingIds` is the source of truth
  //    passed by the IPC layer; the on-disk check below is belt + suspenders
  //    for the case where the caller forgot to update existingIds.)
  //
  //    Note: the validator already returned `ok: true` above, so we have
  //    narrowed out the `errors` branch of `SkillValidationResult`. The
  //    installer's own idempotency guards here ONLY fire when the caller
  //    forgot to pass `existingIds` (or a race created a folder between
  //    the validator call and now).
  const targetDir = path.join(skillsRoot, preview.id);
  let existsOnDisk = false;
  try {
    const stat = await fsp.stat(targetDir);
    existsOnDisk = stat.isDirectory();
  } catch (e) {
    // ENOENT is the expected case for a fresh install. Anything else is
    // a real I/O error — let the staging loop surface it with a
    // consistent message rather than trying to be clever here.
  }
  if (existsOnDisk) {
    return {
      success: false,
      errors: [{
        field: 'structure',
        code: 'already_installed',
        message: `Skill '${preview.id}' is already installed at ${targetDir}.`,
        conflictingId: preview.id,
      }],
    };
  }

  // 3. Stage to a unique temp dir. The UUID suffix guarantees no collision
  //    with concurrent installs (the IPC layer is single-threaded so this
  //    is only relevant for tests, but it's cheap insurance).
  const stagingDir = path.join(stagingRoot, STAGING_DIR_PREFIX + crypto.randomUUID());
  const stagedSkillDir = path.join(stagingDir, preview.id);

  // We collect errors as we go so a rollback failure can be appended
  // alongside the original write_failed error.
  const errors: SkillValidationError[] = [];

  try {
    await fsp.mkdir(stagedSkillDir, { recursive: true });

    // 4. Walk every file in the preview's tree, write it under the staged
    //    skill dir. SKILL.md is always the first write so a crash mid-write
    //    leaves an obviously-broken state (no SKILL.md → invalid folder).
    const skillMdEntry = preview.fileTree.find(p => p.toLowerCase() === 'skill.md');
    const orderedTree = [
      ...(skillMdEntry ? [skillMdEntry] : []),
      ...preview.fileTree.filter(p => p.toLowerCase() !== 'skill.md'),
    ];

    // We need to decode each file's base64 payload. The validator already
    // decoded + counted bytes; we re-decode here because the preview only
    // carries relPath + classification, not the original contentBase64.
    // Decoding again costs nothing measurable at this size and avoids
    // expanding the preview's surface to include base64 (which would be a
    // ~5MB memory hit per preview).
    const base64ByPath = collectBase64ByPath(payload);

    // For folder payloads where every file shares a `sourceFolderName`
    // prefix (e.g. `my-skill/SKILL.md`, `my-skill/references/foo.md`), we
    // strip that prefix so the staged tree matches the install root
    // exactly: `<stagingDir>/<id>/SKILL.md`, not
    // `<stagingDir>/<id>/my-skill/SKILL.md`. Without this, the on-disk
    // layout would diverge from SkillsManager.loadUserSkills()'s
    // expectations (it looks for SKILL.md directly inside the skill
    // folder, not nested under another folder).
    const folderPrefix = preview.sourceFolderName
      ? preview.sourceFolderName + '/'
      : null;

    for (const relPath of orderedTree) {
      // Strip the sourceFolderName prefix if present.
      const stripped = folderPrefix && relPath.startsWith(folderPrefix)
        ? relPath.slice(folderPrefix.length)
        : relPath;

      // Path-traversal defense-in-depth. The validator already rejected
      // `..` and absolute paths, but re-check against the staged skill
      // dir specifically in case the sourceFolderName logic above opened
      // up a new escape route.
      if (!isInsideDir(stagedSkillDir, stripped)) {
        throw new InstallPathError(stripped);
      }
      const contentBase64 = base64ByPath.get(relPath);
      if (contentBase64 === undefined) {
        // The preview said this file exists; the payload must agree.
        // Should never happen — the validator built the preview from the
        // same payload we just received.
        throw new InstallInternalError(`Preview listed '${relPath}' but payload has no such file.`);
      }
      const { text } = decodeBase64ToUtf8(contentBase64);
      const target = path.join(stagedSkillDir, stripped);
      // Make sure parent dirs exist (e.g. `references/` for a nested file).
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, Buffer.from(text, 'utf8'));
    }

    // 5. Atomic rename into place. POSIX guarantees this is atomic on the
    //    same volume; on Windows it falls back to a same-volume MoveFileEx
    //    which is near-atomic. The staged path and target path MUST live on
    //    the same volume — they're both rooted in `os.tmpdir()` and
    //    `userData` respectively, which on macOS/Linux are usually the same
    //    boot volume but could differ on some Windows installs. The
    //    rename-then-fallback-to-copy pattern is overkill for v1; if it
    //    becomes an issue we can detect with `fs.statSync(d1).dev` vs
    //    `fs.statSync(d2).dev`.
    await fsp.mkdir(skillsRoot, { recursive: true });
    await fsp.rename(stagedSkillDir, targetDir);
  } catch (e) {
    // Classify the failure.
    if (e instanceof InstallPathError) {
      errors.push(writeError(
        `Refusing to write '${e.relPath}': escapes the staged skill directory.`,
        'path_traversal'
      ));
    } else {
      const msg = (e as Error)?.message || String(e);
      errors.push(writeError(`Failed to install skill: ${msg}`, 'write_failed'));
    }
    // Rollback. Even on a successful rename the rollback rmSync is a
    // no-op on the moved tree (it lives in skillsRoot now, not
    // stagingDir) — safe.
    safeRemove(stagingDir, errors, 'write_failed');
    return { success: false, errors: errors.slice(0, maxErrors) };
  }

  // 6. Best-effort cleanup of the now-empty staging root.
  safeRemove(stagingDir, errors, 'write_failed');

  const source: SkillSource = 'userData';
  const skill: SkillSummary = {
    id: preview.id,
    name: preview.name,
    description: preview.description,
    source,
  };
  return { success: true, skill, installedPath: targetDir };
}

// ---------------------------------------------------------------------------
// Stale-stage reaper
// ---------------------------------------------------------------------------

export interface ReapStaleUploadStagesResult {
  removed: string[];
  errors: string[];
}

/**
 * Recovery path for app crashes mid-install: scan `stagingRoot` for any
 * `natively-skill-upload-*` directory whose mtime is older than
 * `olderThanMs` (default 1 hour) and remove it.
 *
 * Safe to call from `app.whenReady()` — runs sync, swallows per-entry
 * errors (collected into the `errors` array) so one bad stage dir never
 * blocks the rest.
 */
export function reapStaleUploadStages(
  opts: { stagingRoot?: string; olderThanMs?: number } = {}
): ReapStaleUploadStagesResult {
  const stagingRoot = opts.stagingRoot ?? os.tmpdir();
  const olderThanMs = opts.olderThanMs ?? DEFAULT_REAP_AGE_MS;
  const cutoff = Date.now() - olderThanMs;

  const removed: string[] = [];
  const errors: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(stagingRoot, { withFileTypes: true });
  } catch (e) {
    // stagingRoot missing or unreadable — nothing to reap.
    errors.push(`readdirSync(${stagingRoot}): ${(e as Error)?.message || e}`);
    return { removed, errors };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(STAGING_DIR_PREFIX)) continue;
    const full = path.join(stagingRoot, entry.name);
    let mtime: number;
    try {
      const stat = fs.statSync(full);
      mtime = stat.mtimeMs;
    } catch (e) {
      errors.push(`statSync(${full}): ${(e as Error)?.message || e}`);
      continue;
    }
    if (mtime > cutoff) continue; // still fresh — leave it alone
    try {
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(full);
    } catch (e) {
      errors.push(`rmSync(${full}): ${(e as Error)?.message || e}`);
    }
  }

  return { removed, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Index the payload's base64 by relative path so the write loop can look
 * each file up by name without re-scanning the array.
 *
 * IMPORTANT: for `kind: 'file'` payloads the single uploaded file is ALWAYS
 * keyed as `SKILL.md`, regardless of the user's original filename. The
 * on-disk contract that `SkillsManager.loadUserSkills()` reads is
 * `<skill-dir>/SKILL.md` exactly — a file written under any other name
 * (e.g. `code-simplifier.md`) is invisible to the loader, so the skill
 * would silently never appear in the UI. The validator already treats the
 * single uploaded file as the SKILL.md for parsing; we mirror that on disk.
 */
function collectBase64ByPath(payload: SkillUploadPayload): Map<string, string> {
  const out = new Map<string, string>();
  if (payload.kind === 'file') {
    // Single-file upload → the on-disk file is always SKILL.md.
    out.set('SKILL.md', payload.contentBase64);
  } else {
    for (const f of payload.files) {
      const relPath = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
      out.set(relPath, f.contentBase64);
    }
  }
  return out;
}

/**
 * Sentinel errors thrown inside the write loop so the outer catch can
 * distinguish traversal rejections from generic I/O failures. They never
 * escape this module.
 */
class InstallPathError extends Error {
  readonly relPath: string;
  constructor(relPath: string) {
    super(`Path traversal: ${relPath}`);
    this.relPath = relPath;
    this.name = 'InstallPathError';
  }
}

class InstallInternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallInternalError';
  }
}