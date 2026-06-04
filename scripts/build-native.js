const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const nativeModulePath = path.join(__dirname, '..', 'native-module');
const buildAllMacTargets = process.env.NATIVELY_BUILD_ALL_MAC_ARCHES === '1';

function verifyArtifacts(expectedArtifacts) {
  const missing = expectedArtifacts.filter((file) => !fs.existsSync(path.join(nativeModulePath, file)));

  if (missing.length > 0) {
    throw new Error(`Missing native artifacts after build: ${missing.join(', ')}`);
  }

  console.log('Verified native artifacts:');
  for (const file of expectedArtifacts) {
    console.log(`- ${file}`);
  }
}

function runCommand(command, extraEnv = {}) {
  console.log(`> ${command}`);
  execSync(command, { stdio: 'inherit', cwd: nativeModulePath, env: { ...process.env, ...extraEnv } });
}

// Resolve the actual clang runtime lib path (Xcode version changes across machines).
// Rust's cross-compilation toolchain embeds a stale version number; we override with LIBRARY_PATH.
function getClangLibPath() {
  // Prefer clang -print-resource-dir — works with both Xcode.app and Command Line Tools.
  try {
    const resourceDir = execSync('clang -print-resource-dir', { encoding: 'utf8' }).trim();
    const candidate = path.join(resourceDir, 'lib', 'darwin');
    if (fs.existsSync(candidate)) return candidate;
  } catch {}

  // Fallback: scan Xcode.app toolchain (original behaviour)
  try {
    const clangBase = '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/clang';
    const versions = fs.readdirSync(clangBase).filter(d => /^\d/.test(d)).sort();
    if (versions.length > 0) {
      return path.join(clangBase, versions[versions.length - 1], 'lib', 'darwin');
    }
  } catch {}

  return null;
}

// Fix hardcoded absolute paths to .dylib files in macOS native modules.
// When built on macOS, the linker embeds absolute paths to dependencies.
// We rewrite them to @loader_path so the .node file is portable.
function fixMacOSDylibPaths(nodeFilePath) {
  try {
    // List dependent libraries. Use otool -l so we can ignore LC_ID_DYLIB
    // (the module's own install name) and only rewrite LC_LOAD_DYLIB entries.
    const otoolOutput = execSync(`otool -l "${nodeFilePath}"`, { encoding: 'utf8' });
    const lines = otoolOutput.split('\n');
    const dylibPaths = [];
    let inLoadDylib = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('cmd ')) {
        inLoadDylib = trimmed === 'cmd LC_LOAD_DYLIB';
        continue;
      }
      if (!inLoadDylib || !trimmed.startsWith('name ')) continue;

      // Extract the path before the "(offset N)" metadata. The project may live
      // in a directory with spaces, so splitting on whitespace corrupts it.
      const dylibPath = (trimmed.match(/^name\s+(.*?)\s+\(offset\s+\d+\)$/)?.[1] || '').trim();
      if (!dylibPath) continue;
      dylibPaths.push(dylibPath);
    }

    for (const dylibPath of dylibPaths) {
      // Skip system frameworks and @-prefixed paths (already relative)
      if (dylibPath.startsWith('/System/') ||
          dylibPath.startsWith('/usr/lib/') ||
          dylibPath.startsWith('@')) {
        continue;
      }

      // Extract just the filename from the absolute path
      const dylibName = path.basename(dylibPath);
      const relativePath = `@loader_path/${dylibName}`;

      console.log(`  Fixing dylib path: ${dylibPath} -> ${relativePath}`);

      // Rewrite the path in the .node file
      execSync(`install_name_tool -change "${dylibPath}" "${relativePath}" "${nodeFilePath}"`);
    }

    console.log(`Fixed dylib paths in: ${path.basename(nodeFilePath)}`);
  } catch (err) {
    console.warn(`Warning: Could not fix dylib paths for ${path.basename(nodeFilePath)}: ${err.message}`);
  }
}

if (os.platform() === 'darwin') {
  const macTargets = buildAllMacTargets
    ? ['x86_64-apple-darwin', 'aarch64-apple-darwin']
    : [os.arch() === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'];

  console.log(
    buildAllMacTargets
      ? 'Building for macOS (darwin) for both x64 and arm64...'
      : `Building for macOS (darwin) for current architecture only: ${macTargets[0]}`
  );

  const artifactMap = {
    'x86_64-apple-darwin': 'index.darwin-x64.node',
    'aarch64-apple-darwin': 'index.darwin-arm64.node',
  };

  const clangLibPath = getClangLibPath();
  if (clangLibPath) {
    console.log(`Using clang runtime path: ${clangLibPath}`);
  }

  for (const target of macTargets) {
    try {
      runCommand(`rustup target add ${target}`);
    } catch (err) {
      console.warn(`Warning: Could not configure rust target ${target}. Continuing anyway.`);
    }

    console.log(`\n--- Building for ${target} ---`);
    const extraEnv = clangLibPath ? { LIBRARY_PATH: clangLibPath } : {};
    runCommand(`npx napi build --platform --target ${target} --release`, extraEnv);
  }

  // Fix hardcoded absolute paths in .node binaries
  for (const target of macTargets) {
    const artifact = artifactMap[target];
    const artifactPath = path.join(nativeModulePath, artifact);
    fixMacOSDylibPaths(artifactPath);
  }

  verifyArtifacts(macTargets.map((target) => artifactMap[target]));

} else {
  console.log(`Building for current platform: ${os.platform()}`);
  runCommand('npx napi build --platform --release');

  const artifactMap = {
    win32: {
      x64: ['index.win32-x64-msvc.node'],
      ia32: ['index.win32-ia32-msvc.node'],
      arm64: ['index.win32-arm64-msvc.node'],
    },
    linux: {
      x64: ['index.linux-x64-gnu.node'],
      arm64: ['index.linux-arm64-gnu.node'],
      arm: ['index.linux-arm-gnueabihf.node'],
    },
  };

  const expectedArtifacts = artifactMap[os.platform()]?.[os.arch()];
  if (expectedArtifacts) {
    verifyArtifacts(expectedArtifacts);
  }
}
