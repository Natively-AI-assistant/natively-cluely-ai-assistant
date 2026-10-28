#!/usr/bin/env node
/**
 * Build the Parakeet Neural Engine helper (macOS, Apple Silicon only).
 *
 * The helper runs the local Parakeet TDT models through CoreML on the Apple
 * Neural Engine (FluidAudio, Apache-2.0). Every other platform and the Intel
 * Mac package keep the ONNX Runtime CPU engine, so this script builds nothing
 * for them and the app falls back to that engine at runtime.
 *
 * Like build-apple-speech.js, ordinary Electron builds never call this.
 * Packaged macOS apps invoke buildForAfterPack() once per target architecture
 * from scripts/after-pack.cjs. FluidAudio's source is fetched with git at the
 * pinned commit (FLUIDAUDIO below) into native/parakeet-ane/FluidAudio and
 * compiled as part of the helper's own package, so SwiftPM resolves nothing
 * and downloads nothing (see native/parakeet-ane/Package.swift for why).
 *
 * Release CI fetches the source in a step of its own before packaging
 * (`--fetch-source`), so a network failure stops the run early and retries
 * instead of failing inside electron-builder's afterPack.
 *
 * For local development:
 *   npm run build:parakeet-ane
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// MUST stay in sync with electron/audio/whisper/parakeet/aneBackend.ts and
// scripts/verify-packaged-local-assets.mjs — guarded by
// scripts/__tests__/parakeet-ane-build.test.mjs.
const HELPER_NAME = `${require('./disguise-name.cjs').darwin}-parakeet`;
const PRODUCT_NAME = 'ParakeetANE';

// FluidAudio 0.17.7. The CoreML file names the helper loads (and Natively
// downloads, electron/audio/whisper/parakeet/aneBackend.ts) are versioned with
// the library, so a bump means checking those too.
const FLUIDAUDIO = Object.freeze({
  url: 'https://github.com/FluidInference/FluidAudio.git',
  version: '0.17.7',
  commit: '503b4bd1bbf7220882de39fe8ae6716aae4132da',
});
// Only what the helper compiles and must ship notices for. The rest of the
// repository (its own Package.swift with the binary target, tests, the CLI)
// is never checked out.
const FLUIDAUDIO_PATHS = [
  '/Sources/FluidAudio/',
  '/Sources/FastClusterWrapper/',
  '/Sources/MachTaskSelfWrapper/',
  '/LICENSE',
  '/ThirdPartyLicenses/',
];
const FETCH_ATTEMPTS = 3;

function archToName(arch) {
  if (arch === 1 || arch === 'x64' || arch === 'x86_64') return 'x64';
  if (arch === 3 || arch === 'arm64' || arch === 'aarch64') return 'arm64';
  if (arch === 4 || arch === 'universal') return 'universal';
  return String(arch);
}

function runText(command, args, run) {
  return String(run(command, args, { encoding: 'utf8' })).trim();
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The commit checked out in `dir`, when it is a clean FluidAudio checkout; null otherwise. */
function checkedOutCommit(dir, run) {
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  try {
    const head = runText('git', ['-C', dir, 'rev-parse', 'HEAD'], run);
    const dirty = runText('git', ['-C', dir, 'status', '--porcelain'], run);
    return dirty ? null : head;
  } catch {
    return null;
  }
}

/**
 * Makes native/parakeet-ane/FluidAudio hold FluidAudio's source at exactly
 * FLUIDAUDIO.commit. Reuses a clean checkout of that commit (no network);
 * otherwise fetches that one commit, shallow and sparse, retrying a failed
 * fetch, and refuses anything whose HEAD is not the pinned commit.
 */
function ensureFluidAudioSource(packageDir, { run = execFileSync, wait = sleepMs } = {}) {
  const dir = path.join(packageDir, 'FluidAudio');
  if (checkedOutCommit(dir, run) === FLUIDAUDIO.commit) return dir;

  console.log(`[parakeet-ane] Fetching FluidAudio ${FLUIDAUDIO.version} (${FLUIDAUDIO.commit.slice(0, 12)})…`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const git = (args, opts) => run('git', ['-C', dir, ...args], { stdio: 'inherit', ...opts });
  try {
    git(['init', '--quiet']);
    git(['sparse-checkout', 'set', '--no-cone', ...FLUIDAUDIO_PATHS]);
    for (let attempt = 1; ; attempt += 1) {
      try {
        git(['fetch', '--quiet', '--depth', '1', FLUIDAUDIO.url, FLUIDAUDIO.commit]);
        break;
      } catch (error) {
        if (attempt >= FETCH_ATTEMPTS) {
          throw new Error(
            `[parakeet-ane] Could not fetch FluidAudio from ${FLUIDAUDIO.url} after ${attempt} attempts.\n` +
            `Underlying error: ${error.message}`
          );
        }
        console.warn(`[parakeet-ane] FluidAudio fetch failed (attempt ${attempt}/${FETCH_ATTEMPTS}); retrying…`);
        wait(attempt * 5_000);
      }
    }
    git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    const head = runText('git', ['-C', dir, 'rev-parse', 'HEAD'], run);
    if (head !== FLUIDAUDIO.commit) {
      throw new Error(`[parakeet-ane] FluidAudio checkout is at ${head || 'an unknown commit'}; expected ${FLUIDAUDIO.commit}.`);
    }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return dir;
}

/**
 * FluidAudio is Apache-2.0 and statically linked, with third-party code of its
 * own (ThirdPartyLicenses/), so its notices ship beside the helper:
 * Resources/parakeet-ane/licenses/FluidAudio/. A build without them fails.
 */
function copyLicenses(checkout, helperDir) {
  const license = path.join(checkout, 'LICENSE');
  if (!fs.existsSync(license)) {
    throw new Error(`[parakeet-ane] FluidAudio's LICENSE is missing from ${checkout}; it must ship with the helper.`);
  }
  const destination = path.join(helperDir, 'licenses', 'FluidAudio');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(license, path.join(destination, 'LICENSE'));
  const thirdParty = path.join(checkout, 'ThirdPartyLicenses');
  if (fs.existsSync(thirdParty)) {
    fs.cpSync(thirdParty, path.join(destination, 'ThirdPartyLicenses'), { recursive: true });
  }
  return destination;
}

/**
 * Build one helper. Returns skipped:true on non-macOS and on Intel targets so
 * cross-platform npm scripts stay usable. A universal request builds the arm64
 * helper only: the Neural Engine path does not exist on Intel Macs.
 */
function buildParakeetAne({
  arch = archToName(process.arch),
  output,
  root = path.resolve(__dirname, '..'),
  platform = process.platform,
  run = execFileSync,
  wait = sleepMs,
} = {}) {
  const normalizedArch = archToName(arch);
  if (platform !== 'darwin') {
    console.log(`[parakeet-ane] Skipping helper build on ${platform}; the Neural Engine helper is macOS-only.`);
    return { skipped: true, platform };
  }
  if (!['x64', 'arm64', 'universal'].includes(normalizedArch)) {
    throw new Error(`[parakeet-ane] Unsupported architecture "${normalizedArch}". Use arm64, x64, or universal.`);
  }
  if (normalizedArch === 'x64') {
    console.log('[parakeet-ane] Skipping helper build for x64; Intel Macs use the ONNX CPU engine.');
    return { skipped: true, platform, arch: normalizedArch };
  }

  const packageDir = path.join(root, 'native', 'parakeet-ane');
  if (!fs.existsSync(path.join(packageDir, 'Package.swift'))) {
    throw new Error(`[parakeet-ane] Swift package is missing: ${packageDir}`);
  }
  const destination = output || path.join(root, 'resources', 'parakeet-ane', HELPER_NAME);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const fluidAudioDir = ensureFluidAudioSource(packageDir, { run, wait });

  const swiftArgs = ['--sdk', 'macosx', 'swift', 'build', '-c', 'release', '--arch', 'arm64', '--package-path', packageDir];
  console.log('[parakeet-ane] Building arm64 helper…');
  try {
    run('xcrun', swiftArgs, { stdio: 'inherit' });
  } catch (error) {
    throw new Error(
      '[parakeet-ane] swift build failed. Xcode 26 or newer (Swift 6.2) is required.\n' +
      `Underlying error: ${error.message}`
    );
  }
  const binDir = runText('xcrun', [...swiftArgs, '--show-bin-path'], run);
  const built = path.join(binDir, PRODUCT_NAME);
  if (!fs.existsSync(built)) {
    throw new Error(`[parakeet-ane] swift build reported success but ${built} is missing.`);
  }
  const archs = runText('lipo', ['-archs', built], run);
  if (!archs.split(/\s+/).includes('arm64')) {
    throw new Error(`[parakeet-ane] swift build produced ${archs || 'an unknown architecture'}; expected arm64.`);
  }

  const tempOutput = `${destination}.tmp-${process.pid}`;
  try {
    fs.copyFileSync(built, tempOutput);
    fs.chmodSync(tempOutput, 0o755);
    fs.renameSync(tempOutput, destination);
  } finally {
    fs.rmSync(tempOutput, { force: true });
  }
  // Same signing contract as the Apple Speech helper: a valid ad-hoc signature
  // for development; packaged helpers are signed again with the containing app.
  copyLicenses(fluidAudioDir, path.dirname(destination));
  run('codesign', ['--force', '--sign', '-', destination], { stdio: 'inherit' });
  run('codesign', ['--verify', '--strict', destination], { stdio: 'inherit' });
  console.log(`[parakeet-ane] Built ${destination}`);
  return { skipped: false, arch: 'arm64', output: destination };
}

function afterPackOutput(context) {
  const root = context.packager?.info?.projectDir || path.resolve(__dirname, '..');
  const appName = context.packager?.appInfo?.productFilename;
  if (!context.appOutDir || !appName) {
    throw new Error('[parakeet-ane] electron-builder afterPack context is missing appOutDir/productFilename.');
  }
  return {
    root,
    output: path.join(
      context.appOutDir,
      `${appName}.app`,
      'Contents',
      'Resources',
      'parakeet-ane',
      HELPER_NAME
    ),
  };
}

function buildForAfterPack(context) {
  const electronPlatform =
    context.electronPlatformName || context.packager?.platform?.nodeName || process.platform;
  if (electronPlatform !== 'darwin') {
    return buildParakeetAne({ platform: electronPlatform });
  }

  const arch = archToName(context.arch);
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`[parakeet-ane] electron-builder supplied unsupported macOS arch "${arch}".`);
  }
  if (arch === 'x64') return buildParakeetAne({ arch });
  const { root, output } = afterPackOutput(context);
  return buildParakeetAne({ arch, output, root });
}

function parseCliArgs(argv) {
  let arch = archToName(process.arch);
  let output;
  let fetchSourceOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fetch-source') fetchSourceOnly = true;
    else if (arg === '--arch') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
        throw new Error('[parakeet-ane] --arch requires a value.');
      }
      arch = argv[++i];
    } else if (arg.startsWith('--arch=')) arch = arg.slice('--arch='.length);
    else if (arg === '--output') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
        throw new Error('[parakeet-ane] --output requires a value.');
      }
      output = argv[++i];
    }
    else if (arg.startsWith('--output=')) output = arg.slice('--output='.length);
    else throw new Error(`[parakeet-ane] Unknown argument: ${arg}`);
  }
  if (!arch) throw new Error('[parakeet-ane] --arch requires a value.');
  if (output !== undefined && !output) throw new Error('[parakeet-ane] --output requires a value.');
  return { arch, output: output ? path.resolve(output) : undefined, fetchSourceOnly };
}

/** `--fetch-source`: only fetch FluidAudio's source (macOS; nothing to do elsewhere). */
function fetchSource({ root = path.resolve(__dirname, '..'), platform = process.platform, run = execFileSync, wait = sleepMs } = {}) {
  if (platform !== 'darwin') {
    console.log(`[parakeet-ane] Skipping FluidAudio fetch on ${platform}; the Neural Engine helper is macOS-only.`);
    return { skipped: true, platform };
  }
  const dir = ensureFluidAudioSource(path.join(root, 'native', 'parakeet-ane'), { run, wait });
  console.log(`[parakeet-ane] FluidAudio source ready in ${dir}`);
  return { skipped: false, dir };
}

if (require.main === module) {
  try {
    const { fetchSourceOnly, ...options } = parseCliArgs(process.argv.slice(2));
    if (fetchSourceOnly) fetchSource();
    else buildParakeetAne(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  FLUIDAUDIO,
  FLUIDAUDIO_PATHS,
  HELPER_NAME,
  PRODUCT_NAME,
  afterPackOutput,
  archToName,
  copyLicenses,
  ensureFluidAudioSource,
  fetchSource,
  buildForAfterPack,
  buildParakeetAne,
  parseCliArgs,
};
