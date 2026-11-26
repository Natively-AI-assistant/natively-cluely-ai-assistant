'use strict';
/**
 * Offload heavy macOS packaging & native build directories to an external drive
 * so internal disk space is never exhausted during multi-arch Electron
 * packaging, ditto staging, @electron/notarize zip creation, or create-dmg
 * disk image builds.
 *
 * OPT-IN. Nothing moves unless either:
 *   - NATIVELY_EXTERNAL_BUILD_DIR names the build root, or
 *   - a mounted candidate volume (/Volumes/ExternalSSD, /ExternalSSD) already
 *     holds a `natively-build` folder (create it once to opt in).
 * A drive that merely has the same name is never written to.
 * NATIVELY_DISABLE_EXTERNAL_BUILD=1 turns it off and unlinks ./release (the
 * files on the drive are left alone).
 *
 * Layout under the build root:
 *   release/, cargo-target/, tmp/                 the main checkout
 *   worktrees/<name>-<hash>/{release,cargo-target,tmp}   each linked worktree
 * so two worktrees never overwrite each other's app bundles or Cargo output.
 *
 * Strictly macOS-only (`platform === 'darwin'`). Windows and Linux builds are
 * untouched.
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_MAC_VOLUMES = Object.freeze([
  '/Volumes/ExternalSSD',
  '/ExternalSSD',
]);

const BUILD_DIR_NAME = 'natively-build';

function isTruthyCi(env) {
  return env.CI === 'true' || env.CI === '1';
}

function safeLstat(p, fsImpl) {
  try {
    return fsImpl.lstatSync(p);
  } catch {
    return null;
  }
}

/**
 * The per-checkout part of the build root: '' for a main checkout (its `.git`
 * is a directory), `worktrees/<name>-<hash>` for a linked worktree (its `.git`
 * is a file). The hash keeps two worktrees with the same folder name apart.
 */
function checkoutScope(repoRoot, fsImpl = fs) {
  if (!repoRoot) return '';
  const st = safeLstat(path.join(repoRoot, '.git'), fsImpl);
  if (!st || !st.isFile()) return '';
  const abs = path.resolve(repoRoot);
  const hash = crypto.createHash('sha1').update(abs).digest('hex').slice(0, 8);
  return path.join('worktrees', `${path.basename(abs)}-${hash}`);
}

/**
 * Resolve the external build root on macOS (scoped to `repoRoot` when given),
 * or null on any other OS or when external storage is off / not set up.
 */
function resolveExternalBuildRoot({
  repoRoot,
  env = process.env,
  platform = process.platform,
  fsImpl = fs,
  candidates = DEFAULT_MAC_VOLUMES,
} = {}) {
  if (platform !== 'darwin') return null;
  if (env.NATIVELY_DISABLE_EXTERNAL_BUILD === '1') return null;
  const scope = checkoutScope(repoRoot, fsImpl);
  if (env.NATIVELY_EXTERNAL_BUILD_DIR) {
    return path.join(path.resolve(env.NATIVELY_EXTERNAL_BUILD_DIR), scope);
  }
  if (isTruthyCi(env)) return null;

  for (const volume of candidates) {
    try {
      const root = path.join(volume, BUILD_DIR_NAME);
      // Opt-in: the folder must already be there.
      if (!fsImpl.existsSync(root)) continue;
      if (!fsImpl.statSync(root).isDirectory()) continue;
      if (typeof fsImpl.accessSync === 'function') {
        fsImpl.accessSync(root, fs.constants.W_OK);
      }
      return path.join(root, scope);
    } catch {
      // Ignore missing or read-only mount candidates and try the next one.
    }
  }
  return null;
}

/**
 * The Cargo target dir build-native.js builds into: CARGO_TARGET_DIR when set,
 * else `<external root>/cargo-target`, else null (Cargo's default,
 * native-module/target). Anything that reads the built dylibs must use this too.
 */
function resolveCargoTargetDir(opts = {}) {
  const env = opts.env || process.env;
  if (env.CARGO_TARGET_DIR) return path.resolve(env.CARGO_TARGET_DIR);
  const root = resolveExternalBuildRoot(opts);
  return root ? path.join(root, 'cargo-target') : null;
}

function pointsIntoBuildRoot(target) {
  return path.resolve(target).split(path.sep).includes(BUILD_DIR_NAME);
}

/**
 * Make `<repoRoot>/release` usable as a plain local folder when external
 * storage is not in use: remove the symlink when it dangles (the drive is
 * unplugged), or, with NATIVELY_DISABLE_EXTERNAL_BUILD=1, when it points into
 * a natively-build folder. electron-builder then creates a normal ./release.
 * Never deletes anything but the link itself.
 */
function cleanupReleaseSymlink(repoRoot, { env = process.env, fsImpl = fs, log = console } = {}) {
  if (!repoRoot) return false;
  const localRelease = path.join(repoRoot, 'release');
  const st = safeLstat(localRelease, fsImpl);
  if (!st || !st.isSymbolicLink()) return false;

  let reason = null;
  if (!fsImpl.existsSync(localRelease)) {
    reason = 'external drive not mounted';
  } else if (env.NATIVELY_DISABLE_EXTERNAL_BUILD === '1') {
    let target = null;
    try {
      target = path.resolve(path.dirname(localRelease), fsImpl.readlinkSync(localRelease));
    } catch {
      target = null;
    }
    if (target && pointsIntoBuildRoot(target)) reason = 'NATIVELY_DISABLE_EXTERNAL_BUILD=1';
  }
  if (!reason) return false;

  try {
    fsImpl.unlinkSync(localRelease);
    log.log(`[external-build] Removed symlink ${localRelease} (${reason}) — building to internal storage.`);
    return true;
  } catch (err) {
    log.warn(`[external-build] Could not remove symlink ${localRelease}: ${err && err.message}`);
    return false;
  }
}

/**
 * Copy each top-level entry of `src` over the same entry in `dst`, replacing
 * it rather than merging into it: a merged Natively.app would keep files that
 * only the older copy had and fail codesign --verify. Entries only in `dst`
 * (older versions' DMGs) stay. ditto preserves framework symlinks and code
 * signatures inside packaged .app bundles.
 */
function replaceEntries(src, dst, { fsImpl, execFileSyncImpl }) {
  for (const entry of fsImpl.readdirSync(src)) {
    const from = path.join(src, entry);
    const to = path.join(dst, entry);
    fsImpl.rmSync(to, { recursive: true, force: true });
    execFileSyncImpl('ditto', [from, to], { stdio: 'inherit' });
  }
}

/**
 * Ensure `<externalRoot>/release` and `<externalRoot>/tmp` exist on macOS,
 * move any local `<repoRoot>/release` folder onto external storage, and point
 * `<repoRoot>/release` at `<externalRoot>/release` via symlink.
 *
 * When external storage is not in use, cleans up the `<repoRoot>/release`
 * symlink (see cleanupReleaseSymlink) so the build falls back to internal
 * storage.
 *
 * Returns `{ externalRoot, releaseDir, tmpDir, cargoTargetDir }` or `null`.
 */
function prepareExternalBuildStorage({
  repoRoot,
  env = process.env,
  platform = process.platform,
  fsImpl = fs,
  execFileSyncImpl = execFileSync,
  log = console,
  candidates = DEFAULT_MAC_VOLUMES,
} = {}) {
  if (platform !== 'darwin') return null;
  const externalRoot = resolveExternalBuildRoot({ repoRoot, env, platform, fsImpl, candidates });
  if (!externalRoot) {
    cleanupReleaseSymlink(repoRoot, { env, fsImpl, log });
    return null;
  }

  const releaseDir = path.join(externalRoot, 'release');
  const tmpDir = path.join(externalRoot, 'tmp');
  const cargoTargetDir = path.join(externalRoot, 'cargo-target');

  try {
    fsImpl.mkdirSync(releaseDir, { recursive: true });
    fsImpl.mkdirSync(tmpDir, { recursive: true });
  } catch (err) {
    log.warn(
      `[external-build] Could not create external build directories at ${externalRoot} (${err && err.message}) — falling back to internal storage.`
    );
    cleanupReleaseSymlink(repoRoot, { env, fsImpl, log });
    return null;
  }

  if (repoRoot) {
    const localRelease = path.join(repoRoot, 'release');
    const resolvedLocal = path.resolve(localRelease);
    const resolvedExternal = path.resolve(releaseDir);

    if (resolvedLocal !== resolvedExternal) {
      try {
        const st = safeLstat(localRelease, fsImpl);
        if (!st) {
          fsImpl.symlinkSync(releaseDir, localRelease);
          log.log(`[external-build] Linked ${localRelease} -> ${releaseDir}`);
        } else if (st.isSymbolicLink()) {
          const currentTarget = path.resolve(path.dirname(localRelease), fsImpl.readlinkSync(localRelease));
          if (currentTarget !== resolvedExternal) {
            fsImpl.unlinkSync(localRelease);
            fsImpl.symlinkSync(releaseDir, localRelease);
            log.log(`[external-build] Updated symlink ${localRelease} -> ${releaseDir}`);
          }
        } else if (st.isDirectory()) {
          log.log(`[external-build] Moving existing ${localRelease} to ${releaseDir}…`);
          replaceEntries(localRelease, releaseDir, { fsImpl, execFileSyncImpl });
          fsImpl.rmSync(localRelease, { recursive: true, force: true });
          fsImpl.symlinkSync(releaseDir, localRelease);
          log.log(`[external-build] Moved and linked ${localRelease} -> ${releaseDir}`);
        }
      } catch (err) {
        log.warn(
          `[external-build] Failed to move or link ${localRelease} -> ${releaseDir} (${err && err.message}) — falling back to internal storage.`
        );
        return null;
      }
    }
  }

  return {
    externalRoot,
    releaseDir,
    tmpDir,
    cargoTargetDir,
  };
}

module.exports = {
  BUILD_DIR_NAME,
  DEFAULT_MAC_VOLUMES,
  checkoutScope,
  cleanupReleaseSymlink,
  prepareExternalBuildStorage,
  resolveCargoTargetDir,
  resolveExternalBuildRoot,
};
