'use strict';
/**
 * ensure-mac-optional-deps.cjs — shared core for the "install BOTH darwin arches
 * of a per-arch optional-dependency family" build step.
 *
 * WHY THIS EXISTS:
 *   npm installs only the optional dependency matching the HOST arch. A universal
 *   macOS release ships two slices from one host, so any package family that
 *   resolves its native binding by arch (`<name>-darwin-arm64` / `<name>-darwin-x64`)
 *   silently ends up half-installed, and electron-builder packs whatever is on disk.
 *   The Intel slice then ships without its binding and the feature dies at runtime.
 *
 *   That is not hypothetical: v2.8.7 shipped an x64 DMG containing only
 *   `@napi-rs/canvas-darwin-arm64`. The app booted fine (canvas is loaded lazily
 *   via `await import()` from SafeDocumentTextExtractor), but every Intel user's
 *   PDF text extraction failed with `DOMMatrix is not defined`, because pdfjs
 *   could not polyfill DOMMatrix/ImageData/Path2D without canvas. `sharp` and
 *   `sqlite-vec` already had bespoke scripts doing exactly this; canvas did not.
 *
 * DARWIN-ONLY BY DESIGN: callers gate on process.platform === 'darwin' before
 * installing (Windows builds resolve their own optional deps normally). The pure
 * helpers below are platform-agnostic so both platform shapes are testable anywhere.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Absolute directory a package name maps to under node_modules. */
function packageDir(nodeModulesDir, packageName) {
  return path.join(nodeModulesDir, ...packageName.split('/'));
}

/** A package counts as installed only if it has a package.json (an empty dir does not). */
function isInstalled(nodeModulesDir, packageName) {
  return fs.existsSync(path.join(packageDir(nodeModulesDir, packageName), 'package.json'));
}

/**
 * Pull the pinned versions for a family's required packages out of the lockfile.
 * Throws with a NAMED error rather than installing a floating "latest" — a native
 * binding that drifts from its parent package is its own class of bug.
 *
 * @param {object} lockfile      parsed package-lock.json
 * @param {string} lockKey       e.g. 'node_modules/@napi-rs/canvas'
 * @param {string[]} required    package names that must be present
 * @returns {Record<string,string>} package name → version
 */
function resolveVersions(lockfile, lockKey, required) {
  const optional = lockfile?.packages?.[lockKey]?.optionalDependencies;
  if (!optional) {
    throw new Error(`Could not find optionalDependencies for "${lockKey}" in package-lock.json.`);
  }
  const versions = {};
  const missingFromLock = [];
  for (const name of required) {
    if (!optional[name]) missingFromLock.push(name);
    else versions[name] = optional[name];
  }
  if (missingFromLock.length) {
    throw new Error(
      `Missing ${missingFromLock.join(', ')} in "${lockKey}" optionalDependencies — ` +
        'the package may have renamed its platform packages.'
    );
  }
  return versions;
}

/** Which of `required` are not installed. Pure: takes the predicate. */
function computeMissing(required, installedPredicate) {
  return required.filter((name) => !installedPredicate(name));
}

/** `npm pack` the exact version and unpack it into node_modules. */
function installPackage({ rootDir, nodeModulesDir, packageName, version, tmpPrefix }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), tmpPrefix));
  try {
    const tarball = execFileSync(
      'npm',
      ['pack', `${packageName}@${version}`, '--silent', '--pack-destination', tempDir],
      { cwd: rootDir, encoding: 'utf8' }
    )
      .trim()
      .split('\n')
      .pop();

    const destination = packageDir(nodeModulesDir, packageName);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });

    execFileSync('tar', ['-xzf', path.join(tempDir, tarball), '-C', destination, '--strip-components=1'], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Ensure every package in `required` is installed, installing the lockfile-pinned
 * version of any that are missing. No-op on non-darwin.
 *
 * @param {object} opts
 * @param {string} opts.label       log prefix, e.g. 'ensure-napi-canvas-mac-deps'
 * @param {string} opts.rootDir     repo root
 * @param {string} opts.lockKey     lockfile key of the PARENT package
 * @param {string[]} opts.required  platform package names to guarantee
 * @param {string} opts.tmpPrefix   mkdtemp prefix
 * @param {string} [opts.platform]  injectable for tests (defaults to process.platform)
 */
function ensureMacOptionalDeps(opts) {
  const { label, rootDir, lockKey, required, tmpPrefix, platform = process.platform } = opts;
  const log = (msg) => console.log(`[${label}] ${msg}`);

  if (platform !== 'darwin') {
    log('Skipping; macOS packages are only needed on darwin builds.');
    return { skipped: true, installed: [] };
  }

  const nodeModulesDir = path.join(rootDir, 'node_modules');
  const lockfile = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
  const versions = resolveVersions(lockfile, lockKey, required);

  const missing = computeMissing(required, (name) => isInstalled(nodeModulesDir, name));
  if (missing.length === 0) {
    log(`packages for darwin arm64 and x64 are installed.`);
    return { skipped: false, installed: [] };
  }

  log(`Installing missing packages: ${missing.join(', ')}`);
  for (const name of missing) {
    installPackage({ rootDir, nodeModulesDir, packageName: name, version: versions[name], tmpPrefix });
  }

  const stillMissing = computeMissing(required, (name) => isInstalled(nodeModulesDir, name));
  if (stillMissing.length > 0) {
    throw new Error(`[${label}] Failed to install: ${stillMissing.join(', ')}`);
  }
  log(`packages for darwin arm64 and x64 are installed.`);
  return { skipped: false, installed: missing };
}

module.exports = {
  packageDir,
  isInstalled,
  resolveVersions,
  computeMissing,
  installPackage,
  ensureMacOptionalDeps,
};
