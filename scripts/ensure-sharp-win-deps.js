#!/usr/bin/env node
/**
 * Windows counterpart to ensure-sharp-mac-deps.js.
 *
 * WHY THIS EXISTS
 * ---------------
 * sharp ships one prebuilt package per OS+arch and marks them optional with a
 * `cpu` constraint, so `npm install` on an x64 host installs ONLY
 * `@img/sharp-win32-x64`. The NSIS target ships x64 AND ia32, and
 * electron-builder packs the same node_modules tree for both — so the ia32
 * installer embedded the x64 sharp binary, and every 32-bit install booted with
 * a dead screenshot/image pipeline. (`sqlite-vec` has the identical problem;
 * see scripts/ensure-sqlite-vec.js, which force-installs for the same reason.)
 *
 * Versions come from package-lock.json rather than a hardcoded literal: sharp's
 * platform packages are version-locked to the sharp release, so a literal here
 * would silently install a mismatched pair on the next sharp bump.
 *
 * The darwin script is left untouched — its packages, its gate, its messages —
 * so nothing here can regress a macOS build.
 */
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

if (process.platform !== 'win32') {
  console.log('[ensure-sharp-win-deps] Skipping; Windows packages are only needed on win32 builds.');
  process.exit(0);
}

const lockfile = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
const sharpOptionalDeps = lockfile.packages?.['node_modules/sharp']?.optionalDependencies;

if (!sharpOptionalDeps) {
  throw new Error('Could not find sharp optionalDependencies in package-lock.json.');
}

const nodeModulesDir = path.join(rootDir, 'node_modules');

// Only the arches package.json `build.win.target` actually ships. Windows sharp
// packages bundle libvips, so there is no separate @img/sharp-libvips-win32-*
// to fetch the way darwin and linux need one.
//
// KEEP IN SYNC with the arch-pinned check in
// electron/services/LocalFallbackPreflight.ts, which looks for
// `@img/sharp-win32-${process.arch}`. Adding an arch to build.win.target without
// adding it here makes that check fail on a correct install. (@img/sharp-win32-arm64
// exists upstream, so an arm64 target only needs the entry — but see the
// sqlite-vec note in the preflight first: a native arm64 build LOSES native
// vector search, which the emulated x64 build keeps.)
const requiredPackages = [
  '@img/sharp-win32-x64',
  '@img/sharp-win32-ia32',
];

function packageDir(packageName) {
  return path.join(nodeModulesDir, ...packageName.split('/'));
}

function isInstalled(packageName) {
  return fs.existsSync(path.join(packageDir(packageName), 'package.json'));
}

function installPackage(packageName) {
  const version = sharpOptionalDeps[packageName];
  if (!version) {
    throw new Error(`Missing ${packageName} in sharp optionalDependencies.`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharp-win32-dep-'));
  try {
    // `npm` is a .cmd shim on Windows, and since the CVE-2024-27980 fix Node
    // refuses to spawn a .cmd without a shell at all (EINVAL) — so execFileSync
    // with an args array cannot work here. Use execSync with a single command
    // string, the same shape scripts/ensure-sqlite-vec.js already uses on this
    // platform. Both interpolated values come from the lockfile, not user
    // input, and the one path is quoted for spaces.
    const tarball = execSync(
      `npm pack ${packageName}@${version} --silent --pack-destination "${tempDir}"`,
      { cwd: rootDir, encoding: 'utf8' },
    ).trim().split('\n').pop();

    // Extract using RELATIVE paths only, from inside tempDir.
    //
    // Two different tars can be first on PATH here: Windows' bundled bsdtar
    // (System32) and Git for Windows' GNU tar. GNU tar reads an absolute
    // Windows path as a remote `host:path` spec and dies with
    // "Cannot connect to C: resolve failed" — so passing an absolute path to
    // -f or -C works under cmd.exe and breaks under Git Bash, purely by PATH
    // order. Keeping every tar argument relative sidesteps that for both
    // implementations; Node then does the absolute-path move.
    const stagingDir = path.join(tempDir, 'extract');
    fs.mkdirSync(stagingDir, { recursive: true });
    execFileSync('tar', ['-xzf', tarball, '-C', 'extract', '--strip-components=1'], {
      cwd: tempDir,
      stdio: 'inherit',
    });

    const destination = packageDir(packageName);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(stagingDir, destination, { recursive: true });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const missingPackages = requiredPackages.filter((packageName) => !isInstalled(packageName));

if (missingPackages.length === 0) {
  console.log('[ensure-sharp-win-deps] sharp packages for win32 x64 and ia32 are installed.');
  process.exit(0);
}

console.log(`[ensure-sharp-win-deps] Installing missing sharp packages: ${missingPackages.join(', ')}`);
missingPackages.forEach(installPackage);

const stillMissing = missingPackages.filter((packageName) => !isInstalled(packageName));
if (stillMissing.length > 0) {
  throw new Error(`Failed to install sharp packages: ${stillMissing.join(', ')}`);
}

console.log('[ensure-sharp-win-deps] sharp packages for win32 x64 and ia32 are installed.');
