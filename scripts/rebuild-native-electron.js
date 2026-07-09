/**
 * Rebuilds Electron's native addons (better-sqlite3, keytar) against the
 * Electron Node ABI **and the true hardware architecture**.
 *
 * Why this script exists instead of a bare `electron-rebuild` postinstall call:
 *
 *   1. ROSETTA DRIFT. `@electron/rebuild` picks its target arch from
 *      `process.arch`, which silently reports `x64` whenever the invoking
 *      node was launched under Rosetta (an x86_64 terminal tab, an
 *      `arch -x86_64` shell, certain IDE-spawned process trees). That
 *      produces an x86_64 `.node` that then fails to load under the arm64
 *      Electron runtime with:
 *        dlopen(... better_sqlite3.node ... incompatible architecture
 *        (have 'x86_64', need 'arm64')) — code: ERR_DLOPEN_FAILED
 *      Because the binary is then frozen on disk, the app appears to "fail
 *      every now and then": it breaks the moment one install runs under the
 *      wrong shell and stays broken until the next correct rebuild.
 *      We defeat this by detecting the *hardware* arch via
 *      `sysctl hw.optional.arm64` (and proc_translated), which does NOT lie
 *      under Rosetta, rather than trusting `process.arch`.
 *
 *   2. BIN AMBIGUITY. node_modules contains BOTH `@electron/rebuild@4` and
 *      the deprecated `electron-rebuild@3`, each shipping an
 *      `electron-rebuild` bin. Which one a bare `electron-rebuild` call
 *      resolves to is hoist-order-dependent. We invoke the v4 CLI by
 *      explicit path so the toolchain is deterministic.
 *
 *   3. STALE TARGET. The Electron version is read live from the installed
 *      module, so this never goes stale on an Electron bump (unlike a
 *      hardcoded `target=` in .npmrc).
 *
 * `--build-from-source` is passed so we compile for the resolved arch
 * instead of letting prebuild-install download a possibly-wrong-arch
 * prebuilt binary.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULES = ['better-sqlite3', 'keytar'];

// Shared hardware-arch probe — see electron/lib/nativeArch.mjs for the why.
const { detectHardwareArch } = require('../electron/lib/nativeArch.cjs');

function getElectronVersion(root) {
  try {
    return require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
  } catch {
    return null;
  }
}

function main() {
  const root = path.resolve(__dirname, '..');

  // Only Electron+native concerns on macOS/your dev+CI matrix; on other
  // platforms electron-rebuild's own process.arch is already correct.
  const arch = detectHardwareArch();
  const electronVersion = getElectronVersion(root);
  const reportedArch = process.arch;

  if (electronVersion === null) {
    console.warn('[rebuild-native] electron not installed yet — skipping native rebuild.');
    return;
  }

  if (arch !== reportedArch) {
    console.warn(
      `[rebuild-native] Rosetta drift detected: process.arch=${reportedArch} but hardware=${arch}. ` +
      `Pinning rebuild to ${arch} to avoid an unloadable binary.`
    );
  }

  const cli = path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
  if (!fs.existsSync(cli)) {
    console.warn(`[rebuild-native] @electron/rebuild v4 CLI not found at ${cli} — skipping.`);
    return;
  }

  const args = [
    cli,
    '--force',
    '--arch', arch,
    '--version', electronVersion,
    '--build-from-source',
    '--which-module', MODULES.join(','),
  ];

  console.log(
    `[rebuild-native] Rebuilding [${MODULES.join(', ')}] for Electron ${electronVersion}, arch=${arch} (from source)...`
  );

  // Re-exec node under the correct arch on macOS so the entire toolchain
  // (node-gyp, the C++ compiler invocation) runs natively, not translated.
  const useArchWrapper = os.platform() === 'darwin';
  const cmd = useArchWrapper ? 'arch' : process.execPath;
  const cmdArgs = useArchWrapper ? [`-${arch === 'x64' ? 'x86_64' : arch}`, process.execPath, ...args] : args;

  execFileSync(cmd, cmdArgs, { stdio: 'inherit', cwd: root });
  console.log('[rebuild-native] Rebuild complete.');
}

main();
