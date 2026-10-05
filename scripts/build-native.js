const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const nativeModulePath = path.join(__dirname, '..', 'native-module');
// Suffix marking a moved-aside artifact the developer still needs. The stale
// sweep skips these; everything else matching '.node.stale-' is swept freely.
const RESCUE_MARKER = '.rescue-last-good';
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
  // Artifacts moved aside above, so a FAILED build can put them back. These are
  // gitignored (.gitignore: native-module/*.node), so once the last-good binary
  // is gone there is nothing to restore it from — losing it to a compile error
  // costs a full working native module (WASAPI capture + the stealth keyboard
  // hook) and trips LocalFallbackPreflight into telling the user to reinstall.
  const movedAside = [];

  if (os.platform() === 'win32' && expectedArtifacts) {
    for (const file of fs.readdirSync(nativeModulePath)) {
      if (!file.includes('.node.stale-')) continue;
      // Preserve a rescue copy: when a restore fails, the catch below tells the
      // developer the last-good binary "is still on disk at <path>". Sweeping
      // every stale copy unconditionally deleted exactly that file on the next
      // run, so the advice pointed at something this line had already removed.
      // Anything renamed with the rescue marker is left alone; the developer
      // moves or deletes it themselves.
      if (file.includes(RESCUE_MARKER)) continue;
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
      // NOT deleted here. The previous revision unlinked the copy immediately,
      // which in the ordinary case (app not running, so the unlink succeeds)
      // destroyed the last-good binary BEFORE a build that might fail — and
      // runCommand uses execSync, which throws and aborts the script. The
      // rename alone is enough to unblock napi's copy; deletion can wait until
      // the build has actually produced a replacement.
      movedAside.push({ artifact, artifactPath, stalePath });
    }
  }

  try {
    runCommand('npx napi build --platform --release');
    // Verified INSIDE the try, before the stale copies are swept. napi can exit
    // 0 and still not leave the artifact this platform/arch expects — a
    // toolchain that silently falls back to ia32, or a target-triple rename,
    // both produce a differently-named .node. Sweeping first and verifying
    // afterwards deleted the last-good binary and only then reported the
    // failure, with the restore path already behind us.
    if (expectedArtifacts) {
      verifyArtifacts(expectedArtifacts);
    }
  } catch (err) {
    // Put the last-good artifacts back so a failed build leaves the tree no
    // worse than it found it. Skip any the build already replaced.
    for (const { artifact, artifactPath, stalePath } of movedAside) {
      if (fs.existsSync(artifactPath)) continue;
      if (!fs.existsSync(stalePath)) continue;
      try {
        fs.renameSync(stalePath, artifactPath);
        console.warn(`Build failed; restored the previous ${artifact}.`);
      } catch (restoreErr) {
        // The rename back failed (usually: the DLL is mapped by a running
        // Natively). Mark the copy as a rescue file so the sweep at the top of
        // the NEXT run leaves it alone — otherwise this message would point the
        // developer at a path that the next build deletes before they get to it.
        // Keep the '.node.stale-' segment so the file still looks like what it
        // is, and APPEND the marker. The sweep matches on '.node.stale-' and
        // then skips anything carrying the marker — if the rescue name dropped
        // that segment it would fall outside the sweep's filter entirely, the
        // marker check would be dead code, and any test of it would pass
        // vacuously.
        let rescuePath = stalePath;
        try {
          rescuePath = `${stalePath}${RESCUE_MARKER}`;
          fs.renameSync(stalePath, rescuePath);
        } catch {
          rescuePath = stalePath; // could not even mark it; report where it is
        }
        console.error(
          `Build failed AND the previous ${artifact} could not be restored ` +
            `(${restoreErr.code || restoreErr.message}).\n` +
            `         The last-good binary is at:\n           ${rescuePath}\n` +
            `         Close Natively and rename it back to ${artifact} to recover.`
        );
      }
    }
    throw err;
  }

  // Build succeeded AND the expected artifact was verified present, so the
  // copies are now genuinely stale. An unlink that fails here means the DLL is
  // still mapped by a running Natively; it is out of the way, gitignored, and
  // swept by the next build.
  for (const { artifact, stalePath } of movedAside) {
    try {
      fs.unlinkSync(stalePath);
    } catch {
      console.log(
        `Note: ${artifact} is in use (Natively is running); moved it aside so the build can proceed.`
      );
    }
  }
}
