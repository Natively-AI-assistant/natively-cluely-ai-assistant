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
 * from scripts/after-pack.cjs. SwiftPM fetches the pinned FluidAudio release
 * (native/parakeet-ane/Package.resolved) on the first build.
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

function archToName(arch) {
  if (arch === 1 || arch === 'x64' || arch === 'x86_64') return 'x64';
  if (arch === 3 || arch === 'arm64' || arch === 'aarch64') return 'arm64';
  if (arch === 4 || arch === 'universal') return 'universal';
  return String(arch);
}

function runText(command, args, run) {
  return String(run(command, args, { encoding: 'utf8' })).trim();
}

/**
 * FluidAudio is Apache-2.0 and statically linked, with third-party code of its
 * own (ThirdPartyLicenses/), so its notices ship beside the helper:
 * Resources/parakeet-ane/licenses/FluidAudio/. A build without them fails.
 */
function copyLicenses(packageDir, helperDir) {
  const checkout = path.join(packageDir, '.build', 'checkouts', 'FluidAudio');
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

  const swiftArgs = ['--sdk', 'macosx', 'swift', 'build', '-c', 'release', '--arch', 'arm64', '--package-path', packageDir];
  console.log('[parakeet-ane] Building arm64 helper…');
  try {
    run('xcrun', swiftArgs, { stdio: 'inherit' });
  } catch (error) {
    throw new Error(
      '[parakeet-ane] swift build failed. Xcode 26 or newer (Swift 6.2) is required, and the first build ' +
      'downloads FluidAudio from GitHub.\n' +
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
  copyLicenses(packageDir, path.dirname(destination));
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
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--arch') {
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
  return { arch, output: output ? path.resolve(output) : undefined };
}

if (require.main === module) {
  try {
    buildParakeetAne(parseCliArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  HELPER_NAME,
  PRODUCT_NAME,
  afterPackOutput,
  archToName,
  copyLicenses,
  buildForAfterPack,
  buildParakeetAne,
  parseCliArgs,
};
