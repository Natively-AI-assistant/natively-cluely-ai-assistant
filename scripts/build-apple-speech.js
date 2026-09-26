#!/usr/bin/env node
/**
 * Build the macOS 26 Apple Speech bridge.
 *
 * Ordinary Electron builds deliberately do not call this script. Packaged macOS
 * apps invoke buildForAfterPack() once per target architecture from
 * scripts/after-pack.cjs, writing directly into that architecture's .app. This
 * prevents a simultaneous x64/arm64 package from sharing a stale helper.
 *
 * For local development:
 *   npm run build:apple-speech
 *   npm run build:apple-speech -- --arch universal
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MINIMUM_SDK_MAJOR = 26;
const MINIMUM_MACOS_VERSION = '26.0';
const HELPER_NAME = 'natively-apple-speech';

function archToName(arch) {
  if (arch === 1 || arch === 'x64' || arch === 'x86_64') return 'x64';
  if (arch === 3 || arch === 'arm64' || arch === 'aarch64') return 'arm64';
  if (arch === 4 || arch === 'universal') return 'universal';
  return String(arch);
}

function targetTriple(arch) {
  if (arch === 'x64') return `x86_64-apple-macosx${MINIMUM_MACOS_VERSION}`;
  if (arch === 'arm64') return `arm64-apple-macosx${MINIMUM_MACOS_VERSION}`;
  throw new Error(`[apple-speech] Unsupported architecture "${arch}". Use x64, arm64, or universal.`);
}

function runText(command, args, run) {
  return String(run(command, args, { encoding: 'utf8' })).trim();
}

function resolveToolchain(run = execFileSync) {
  let sdkPath;
  let sdkVersion;
  try {
    sdkPath = runText('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], run);
    sdkVersion = runText('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], run);
  } catch (error) {
    throw new Error(
      '[apple-speech] Xcode 26 or newer is required to package Apple Speech. ' +
      'Select a full Xcode installation with `sudo xcode-select -s /Applications/Xcode.app` and retry.\n' +
      `Underlying error: ${error.message}`
    );
  }

  const sdkMajor = Number.parseInt(sdkVersion, 10);
  if (!sdkPath || !Number.isFinite(sdkMajor) || sdkMajor < MINIMUM_SDK_MAJOR) {
    throw new Error(
      `[apple-speech] macOS ${MINIMUM_SDK_MAJOR} SDK or newer is required, but xcrun selected ` +
      `${sdkVersion || 'an unknown SDK version'}. Install/select Xcode 26+ before packaging macOS.`
    );
  }

  return { sdkPath, sdkVersion };
}

function compileThin({ arch, source, output, sdkPath, run }) {
  const tempOutput = `${output}.tmp-${process.pid}-${arch}`;
  try {
    run(
      'xcrun',
      [
        '--sdk', 'macosx',
        'swiftc',
        '-O',
        '-parse-as-library',
        '-sdk', sdkPath,
        '-target', targetTriple(arch),
        source,
        '-o', tempOutput,
      ],
      { stdio: 'inherit' }
    );
    const actual = runText('lipo', ['-archs', tempOutput], run);
    const expected = arch === 'x64' ? 'x86_64' : 'arm64';
    if (!actual.split(/\s+/).includes(expected)) {
      throw new Error(`[apple-speech] swiftc produced ${actual || 'an unknown architecture'}; expected ${expected}.`);
    }
    fs.renameSync(tempOutput, output);
  } finally {
    fs.rmSync(tempOutput, { force: true });
  }
}

function compileUniversal({ source, output, sdkPath, run }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-apple-speech-'));
  const arm64 = path.join(tempDir, `${HELPER_NAME}-arm64`);
  const x64 = path.join(tempDir, `${HELPER_NAME}-x64`);
  const merged = path.join(tempDir, HELPER_NAME);
  try {
    compileThin({ arch: 'arm64', source, output: arm64, sdkPath, run });
    compileThin({ arch: 'x64', source, output: x64, sdkPath, run });
    run('lipo', ['-create', arm64, x64, '-output', merged], { stdio: 'inherit' });
    const slices = runText('lipo', ['-archs', merged], run).split(/\s+/);
    if (!slices.includes('arm64') || !slices.includes('x86_64')) {
      throw new Error(`[apple-speech] Universal helper is missing a slice: ${slices.join(' ') || 'unknown'}.`);
    }
    fs.copyFileSync(merged, output);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Build one helper. Returns skipped:true on non-macOS so cross-platform npm
 * scripts remain usable; a macOS package fails clearly when its SDK is too old.
 */
function buildAppleSpeech({
  arch = archToName(process.arch),
  output,
  root = path.resolve(__dirname, '..'),
  platform = process.platform,
  run = execFileSync,
} = {}) {
  const normalizedArch = archToName(arch);
  if (platform !== 'darwin') {
    console.log(`[apple-speech] Skipping helper build on ${platform}; Apple Speech is macOS-only.`);
    return { skipped: true, platform };
  }
  if (!['x64', 'arm64', 'universal'].includes(normalizedArch)) {
    throw new Error(`[apple-speech] Unsupported architecture "${normalizedArch}". Use x64, arm64, or universal.`);
  }

  const source = path.join(root, 'native', 'apple-speech', 'main.swift');
  if (!fs.existsSync(source)) {
    throw new Error(`[apple-speech] Swift source is missing: ${source}`);
  }
  const destination = output || path.join(root, 'resources', 'apple-speech', HELPER_NAME);
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const { sdkPath, sdkVersion } = resolveToolchain(run);
  console.log(`[apple-speech] Building ${normalizedArch} helper with macOS SDK ${sdkVersion}…`);
  if (normalizedArch === 'universal') {
    compileUniversal({ source, output: destination, sdkPath, run });
  } else {
    compileThin({ arch: normalizedArch, source, output: destination, sdkPath, run });
  }
  fs.chmodSync(destination, 0o755);
  // lipo invalidates the linker signatures on its input slices. Give both thin
  // and universal development helpers a valid ad-hoc signature here; packaged
  // helpers are signed again with the containing app by electron-builder.
  run('codesign', ['--force', '--sign', '-', destination], { stdio: 'inherit' });
  run('codesign', ['--verify', '--strict', destination], { stdio: 'inherit' });
  console.log(`[apple-speech] Built ${destination}`);
  return { skipped: false, arch: normalizedArch, output: destination, sdkVersion };
}

function afterPackOutput(context) {
  const root = context.packager?.info?.projectDir || path.resolve(__dirname, '..');
  const appName = context.packager?.appInfo?.productFilename;
  if (!context.appOutDir || !appName) {
    throw new Error('[apple-speech] electron-builder afterPack context is missing appOutDir/productFilename.');
  }
  return {
    root,
    output: path.join(
      context.appOutDir,
      `${appName}.app`,
      'Contents',
      'Resources',
      'apple-speech',
      HELPER_NAME
    ),
  };
}

function buildForAfterPack(context) {
  const electronPlatform =
    context.electronPlatformName || context.packager?.platform?.nodeName || process.platform;
  if (electronPlatform !== 'darwin') {
    return buildAppleSpeech({ platform: electronPlatform });
  }

  const arch = archToName(context.arch);
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`[apple-speech] electron-builder supplied unsupported macOS arch "${arch}".`);
  }
  const { root, output } = afterPackOutput(context);
  return buildAppleSpeech({ arch, output, root });
}

function parseCliArgs(argv) {
  let arch = archToName(process.arch);
  let output;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--arch') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
        throw new Error('[apple-speech] --arch requires a value.');
      }
      arch = argv[++i];
    } else if (arg.startsWith('--arch=')) arch = arg.slice('--arch='.length);
    else if (arg === '--output') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
        throw new Error('[apple-speech] --output requires a value.');
      }
      output = argv[++i];
    }
    else if (arg.startsWith('--output=')) output = arg.slice('--output='.length);
    else throw new Error(`[apple-speech] Unknown argument: ${arg}`);
  }
  if (!arch) throw new Error('[apple-speech] --arch requires a value.');
  if (output !== undefined && !output) throw new Error('[apple-speech] --output requires a value.');
  return { arch, output: output ? path.resolve(output) : undefined };
}

if (require.main === module) {
  try {
    buildAppleSpeech(parseCliArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  HELPER_NAME,
  MINIMUM_SDK_MAJOR,
  afterPackOutput,
  archToName,
  buildAppleSpeech,
  buildForAfterPack,
  parseCliArgs,
  resolveToolchain,
  targetTriple,
};
