const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const nativeModulePath = path.join(__dirname, '..', 'native-module');
const buildAllMacTargets = process.env.NATIVELY_BUILD_ALL_MAC_ARCHES === '1';

// Ensure Cargo binary directory (~/.cargo/bin) is in PATH if cargo is installed there
const cargoBinDir = path.join(os.homedir(), '.cargo', 'bin');
if (fs.existsSync(cargoBinDir)) {
  const pathDelimiter = os.platform() === 'win32' ? ';' : ':';
  const currentPath = process.env.PATH || '';
  if (!currentPath.split(pathDelimiter).includes(cargoBinDir)) {
    process.env.PATH = `${cargoBinDir}${pathDelimiter}${currentPath}`;
  }
}

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
    // List all dependent libraries
    const otoolOutput = execSync(`otool -L "${nodeFilePath}"`, { encoding: 'utf8' });
    const lines = otoolOutput.split('\n').slice(1); // Skip first line (filename)

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Extract the path (first token before whitespace)
      const dylibPath = trimmed.split(/\s+/)[0];

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

  // Windows only: unblock the artifact copy when the app is running.
  //
  // Windows locks a loaded DLL against being written or deleted, so if Natively
  // (or an electron dev instance) has the .node loaded, `napi build` dies at the
  // very end with an opaque "Internal Error: Failed to copy artifact" — after a
  // successful compile, which makes it look like a Rust failure. It is not; it
  // is file locking.
  //
  // A loaded DLL CAN still be renamed, though (the running process keeps using
  // it through its open handle — this is how self-updaters work). So move the
  // old artifact aside and let napi write a fresh one. The stale copy is deleted
  // when nothing holds it any more, which is usually the next build.
  //
  // macOS/Linux never hit this (they permit unlinking an in-use dylib), so this
  // whole step is win32-gated and their behaviour is unchanged.
  if (os.platform() === 'win32' && expectedArtifacts) {
    for (const file of fs.readdirSync(nativeModulePath)) {
      if (!file.includes('.node.stale-')) continue;
      try {
        fs.unlinkSync(path.join(nativeModulePath, file));
      } catch {
        // Still loaded by a live process — a later run will get it.
      }
    }
    for (const artifact of expectedArtifacts) {
      const artifactPath = path.join(nativeModulePath, artifact);
      if (!fs.existsSync(artifactPath)) continue;
      const stalePath = `${artifactPath}.stale-${Date.now()}`;
      try {
        fs.renameSync(artifactPath, stalePath);
      } catch (err) {
        console.warn(
          `Warning: could not move the previous ${artifact} aside (${err.code || err.message}).\n` +
            '         If the build fails with "Failed to copy artifact", close Natively and retry.'
        );
        continue;
      }
      try {
        fs.unlinkSync(stalePath);
      } catch {
        // Expected while the app is running: the DLL is still mapped. Harmless —
        // it is out of the way, gitignored, and removed by a later build.
        console.log(
          `Note: ${artifact} is in use (Natively is running); moved it aside so the build can proceed.`
        );
      }
    }
  }

  runCommand('npx napi build --platform --release');

  if (expectedArtifacts) {
    verifyArtifacts(expectedArtifacts);
  }
}
