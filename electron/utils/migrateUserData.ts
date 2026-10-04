/**
 * One-time migration of the packaged profile dir off the brand name.
 *
 * The on-disk app identity is disguised at build time (productName sourced
 * from scripts/disguise-name.cjs), so Activity Monitor / proc_pidpath / Task
 * Manager never show "Natively". But the profile dir stayed pinned to
 * `…/Natively`, and every process listing shows the full command line
 * including `--user-data-dir=…/Natively` — the last brand string in process
 * land, and one HackerEarth v3.1.1 reads (`ps -ax -o command=`). This module
 * moves the profile to the per-platform disguise name, once, safely.
 *
 * SAFETY CONTRACT (read before touching):
 *  - renameSync within one parent dir is ATOMIC: it fully happens or throws.
 *    There is no half-moved state, so a crash mid-migration cannot strand data.
 *  - On ANY failure the action is `aborted` → keep using the legacy dir, i.e.
 *    exactly today's pinned behavior. The module NEVER throws out (it runs at
 *    import time; a throw would prevent the app from starting at all).
 *  - A live old-version instance must never write while we move: before any
 *    rename we scan for a legacy main process (ps basename on POSIX,
 *    tasklist image name on Windows). On a positive OR on scan failure we
 *    DEFER — keep the legacy dir this launch and try again next launch.
 *    Deferral is always safe; only migration has preconditions.
 *  - We match the legacy MAIN executable only, never helpers: a lingering
 *    helper without its browser process cannot coordinate profile writes, and
 *    matching helpers would defer forever on crash debris.
 *  - Both-dirs-nonempty (downgrade ran the old app after we migrated, or the
 *    user hand-copied): adopt the new dir, touch nothing, log loudly. Merging
 *    would risk corruption; the new dir is the future.
 *  - The legacy husk is NEVER deleted (uninstall/clean scripts own removal and
 *    already cover both names).
 *  - Keychain/safeStorage is untouched by a folder move: the salt file moves
 *    WITH the folder, the OS key is signature-bound, and CredentialsManager's
 *    key-canary detects any surprise. Dev builds and the agent override never
 *    migrate (dev profile already uses the npm name).
 *
 * Pure decision core (decideProfileMigration) + thin side-effect runner
 * (runProfileMigration) with injectable fs/scan, so the whole matrix is
 * unit-testable. See __tests__/profileMigration.test.mjs.
 */

export type ProfileMigrationKind =
  | 'skipped-dev'
  | 'pinned-legacy-name'
  | 'fresh'
  | 'already-migrated'
  | 'adopted-existing'
  | 'empty-legacy'
  | 'deferred-live-instance'
  | 'deferred-unknown'
  | 'migrated'
  | 'aborted';

export interface ProfileMigrationDecision {
  kind: ProfileMigrationKind;
  /** Dirname (not full path) to setPath when setPath is true. */
  dirName: string | null;
  /** Runner must setPath(dirName) when true (false only pre-packaged). */
  setPath: boolean;
  /** Runner must fs.renameSync(legacy → new) when true. */
  doRename: boolean;
  /** Runner must write the receipt into the new dir when true. */
  writeReceipt: boolean;
  reason: string;
}

export interface ProfileMigrationState {
  packaged: boolean;
  /** Target dir equals the legacy dir (platforms with no disguise, e.g. linux). */
  sameName: boolean;
  legacyExists: boolean;
  legacyEmpty: boolean;
  newExists: boolean;
  newEmpty: boolean;
  receiptPresent: boolean;
  /** True = old main process observed; false = scan clean; null = scan failed/unknown. */
  liveOldInstance: boolean | null;
}

/** Receipt file proving a migration (or adoption) already happened. */
export const PROFILE_MIGRATION_RECEIPT = '.natively-profile-migrated.json';

/** Legacy main-executable names (helpers deliberately excluded — see contract). */
export function legacyMainExeNames(platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') return ['Natively'];
  if (platform === 'win32') return ['natively.exe'];
  return [];
}

/**
 * Profile dir name for a platform. MUST match scripts/disguise-name.cjs
 * (pinned by scripts/__tests__/packaging-config.test.mjs); linux has no
 * disguise alias, so the historical name stands and migration is a no-op.
 */
export function profileDirNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'corespeechd';
  if (platform === 'win32') return 'audiodg';
  return 'Natively';
}

/** Exact (darwin, case-sensitive comm) or case-insensitive (win32 image) main-exe match. */
export function isLegacyMainProcessName(name: string, platform: NodeJS.Platform): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (platform === 'win32') return trimmed.toLowerCase() === 'natively.exe';
  if (platform === 'darwin') return trimmed === 'Natively';
  return false;
}

/**
 * Basename of one `ps -o comm=` line. macOS prints full paths
 * (`/Applications/Natively.app/Contents/MacOS/Natively`), so matching must
 * strip to the last path segment first — same `split("/").pop()` shape
 * HackerEarth's own scanner uses.
 */
export function psLineBasename(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

export function decideProfileMigration(s: ProfileMigrationState): ProfileMigrationDecision {
  const no = (kind: ProfileMigrationKind, reason: string): ProfileMigrationDecision => ({
    kind,
    dirName: null,
    setPath: false,
    doRename: false,
    writeReceipt: false,
    reason,
  });
  if (!s.packaged) return no('skipped-dev', 'unpackaged build keeps the npm-name profile');
  // NOTE: targetName is applied by the runner from profileDirNameForPlatform;
  // sameName short-circuits before any scan so linux behavior is byte-identical
  // to the old unconditional pin.
  return decidePackaged(s);
}

function decidePackaged(s: ProfileMigrationState): ProfileMigrationDecision {
  const at = (kind: ProfileMigrationKind, dirName: string | null, extra: Partial<ProfileMigrationDecision> & { reason: string }): ProfileMigrationDecision => ({
    kind,
    dirName,
    setPath: dirName !== null,
    doRename: false,
    writeReceipt: false,
    ...extra,
  });
  if (s.sameName) {
    return at('pinned-legacy-name', 'Natively', { reason: 'platform has no disguise alias; explicit pin preserved' });
  }
  if (s.receiptPresent) {
    // Target resolved by runner; dirName placeholder replaced there.
    return at('already-migrated', '__NEW__', { reason: 'receipt present from a previous run' });
  }
  if (s.newExists && !s.newEmpty) {
    return at('adopted-existing', '__NEW__', { writeReceipt: true, reason: 'new dir already populated without receipt — adopt, never merge or delete' });
  }
  if (!s.legacyExists) {
    return at('fresh', '__NEW__', { reason: 'no legacy profile; fresh install goes straight to the new dir' });
  }
  if (s.legacyEmpty) {
    return at('empty-legacy', '__NEW__', { reason: 'legacy dir is an empty husk; use new dir, leave husk in place' });
  }
  if (s.liveOldInstance === true) {
    return at('deferred-live-instance', 'Natively', { reason: 'old-version main process observed — run from legacy this launch so its singleton lock still governs' });
  }
  if (s.liveOldInstance === null) {
    return at('deferred-unknown', 'Natively', { reason: 'liveness scan failed — conservative: status quo this launch' });
  }
  return at('migrated', '__NEW__', { doRename: true, writeReceipt: true, reason: 'legacy profile moved atomically to the new dir' });
}

export interface ProfileFs {
  existsSync(p: string): boolean;
  readdirSync(p: string): string[];
  renameSync(oldPath: string, newPath: string): void;
  rmdirSync(p: string): void;
  writeFileSync(p: string, data: string): void;
}

export interface ProfileMigrationDeps {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  appDataDir: string;
  join: (a: string, b: string) => string;
  fs: ProfileFs;
  /** Null = scan failed/unknown (runner defers). Skipped unless migration is on the table. */
  scanLegacyInstance?: () => boolean | null;
  log?: (message: string) => void;
}

export interface ProfileMigrationOutcome {
  action: ProfileMigrationDecision;
  /** Full dir the caller must setPath, or null when the caller must not setPath. */
  dir: string | null;
}

/** Default liveness scan (ps basename on POSIX, tasklist image on Windows). Exported for tests. */
export function defaultScanLegacyInstance(platform: NodeJS.Platform): boolean | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    if (platform === 'win32') {
      const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 5000 }) as string;
      return out.split('\n').some((line) => {
        const m = /^"([^"]+)"/.exec(line.trim());
        return !!m && isLegacyMainProcessName(m[1], 'win32');
      });
    }
    if (platform === 'darwin' || platform === 'linux') {
      const out = execFileSync('/bin/ps', ['-ax', '-o', 'comm='], { encoding: 'utf8', timeout: 5000 }) as string;
      return out.split('\n').some((line) => isLegacyMainProcessName(psLineBasename(line), platform));
    }
    return false;
  } catch {
    return null;
  }
}

/**
 * Decide AND execute (or safely decline). Never throws: any unexpected error
 * collapses to `aborted` → legacy dir, i.e. today's pinned behavior.
 */
export function runProfileMigration(deps: ProfileMigrationDeps): ProfileMigrationOutcome {
  const log = deps.log ?? (() => {});
  try {
    const targetName = profileDirNameForPlatform(deps.platform);
    const legacyDir = deps.join(deps.appDataDir, 'Natively');
    const newDir = deps.join(deps.appDataDir, targetName);
    const sameName = targetName === 'Natively';

    if (!deps.isPackaged) {
      return { action: decideProfileMigration({ packaged: false } as ProfileMigrationState), dir: null };
    }
    if (sameName) {
      const action = decideProfileMigration({
        packaged: true, sameName: true,
        legacyExists: false, legacyEmpty: true, newExists: false, newEmpty: true,
        receiptPresent: false, liveOldInstance: false,
      });
      return { action, dir: legacyDir };
    }

    const exists = (p: string): boolean => {
      try { return deps.fs.existsSync(p); } catch { return false; }
    };
    const isEmptyDir = (p: string): boolean => {
      try { return deps.fs.readdirSync(p).length === 0; } catch { return false; }
    };
    const legacyExists = exists(legacyDir);
    const newExists = exists(newDir);
    const receiptPresent = newExists && exists(deps.join(newDir, PROFILE_MIGRATION_RECEIPT));

    // Only pay for a process scan when a rename is actually on the table:
    // legacy present, no receipt, and no populated new dir to adopt instead.
    let liveOldInstance: boolean | null = false;
    const newPopulated = newExists && !isEmptyDir(newDir);
    if (legacyExists && !receiptPresent && !newPopulated) {
      const scan = deps.scanLegacyInstance ?? (() => defaultScanLegacyInstance(deps.platform));
      try {
        const r = scan();
        liveOldInstance = r === null ? null : !!r;
      } catch {
        liveOldInstance = null;
      }
    }

    const action = decideProfileMigration({
      packaged: true, sameName: false,
      legacyExists,
      legacyEmpty: legacyExists ? isEmptyDir(legacyDir) : true,
      newExists,
      newEmpty: newExists ? isEmptyDir(newDir) : true,
      receiptPresent,
      liveOldInstance,
    });
    const resolve = (dirName: string | null) => (dirName === null || dirName === '__NEW__' ? newDir : legacyDir);

    if (action.doRename) {
      // newDir is absent or empty here (decide guarantees it): drop an empty
      // husk first — renameSync onto an existing dir fails on Windows.
      if (newExists) deps.fs.rmdirSync(newDir);
      deps.fs.renameSync(legacyDir, newDir);
      log(`[ProfileMigration] moved profile Natively → ${targetName}`);
    }
    if (action.writeReceipt) {
      try {
        deps.fs.writeFileSync(
          deps.join(newDir, PROFILE_MIGRATION_RECEIPT),
          JSON.stringify({ migratedFrom: 'Natively', migratedAt: new Date().toISOString(), action: action.kind }),
        );
      } catch (e) {
        // Non-fatal: the dir itself is correct; a later launch re-adopts it
        // (adopted-existing) and retries the receipt.
        log(`[ProfileMigration] receipt write failed (non-fatal): ${(e as Error)?.message ?? e}`);
      }
    }
    if (action.kind !== 'fresh' && action.kind !== 'empty-legacy') {
      log(`[ProfileMigration] ${action.kind}: ${action.reason}`);
    }
    return { action, dir: resolve(action.dirName) };
  } catch (e) {
    // Total backstop: status quo ante (today's pin). Never break startup.
    try { (deps.log ?? (() => {}))(`[ProfileMigration] aborted (${(e as Error)?.message ?? e}); staying on legacy dir`); } catch { /* noop */ }
    try {
      return {
        action: { kind: 'aborted', dirName: 'Natively', setPath: true, doRename: false, writeReceipt: false, reason: 'unexpected error; status quo' },
        dir: deps.join(deps.appDataDir, 'Natively'),
      };
    } catch {
      return {
        action: { kind: 'aborted', dirName: null, setPath: false, doRename: false, writeReceipt: false, reason: 'unexpected error; cannot resolve dirs' },
        dir: null,
      };
    }
  }
}
