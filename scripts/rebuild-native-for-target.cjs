/**
 * rebuild-native-for-target.cjs — electron-builder `beforePack` hook.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * `better-sqlite3` and `keytar` each ship a SINGLE compiled binary at a fixed
 * path (`build/Release/*.node`) with no per-arch loader — unlike native-module
 * (Rust, ships both `index.darwin-{x64,arm64}.node`), onnxruntime-node, sharp,
 * and sqlite-vec, which all carry both arch slices side-by-side and pick at
 * runtime. So whatever arch that one `.node` happens to be on disk is the arch
 * BOTH DMGs embed.
 *
 * electron-builder packs once per target arch (mac = x64, mac-arm64 = arm64).
 * When you build both arches on an Apple-Silicon Mac, the on-disk binaries are
 * arm64, so the x64 (`Natively.dmg`) pack would embed arm64 binaries and every
 * Intel Mac boots straight into main.ts's nativeArchGate "Architecture
 * mismatch" dialog. electron-builder's default `npmRebuild:true` is *supposed*
 * to rebuild per-arch, but its rebuild derives the arch from `process.arch`
 * (which lies under Rosetta) and its resolution of which rebuild bin to run is
 * hoist-order dependent (see scripts/rebuild-native-electron.js header). This
 * repo trusts none of that.
 *
 * THE FIX
 * -------
 * Before EACH per-arch pack, rebuild exactly better-sqlite3 + keytar for THAT
 * target arch, from source, pinned to the installed Electron version.
 *
 * IMPORTANT: this must be `beforePack` + package.json `npmRebuild:false`, NOT
 * `beforeBuild` returning `false`. In electron-builder 26.x, returning false
 * from beforeBuild sets `areNodeModulesHandledExternally`, which skips the
 * entire node_modules collection pass; the packaged app then boots with
 * `Cannot find module 'better-sqlite3'`. `npmRebuild:false` skips eb's own
 * rebuild without disabling node_modules packing, and beforePack still runs
 * per target arch before app.asar is created.
 *
 * The companion afterPack guard (scripts/ad-hoc-sign.js) then `file -b`-verifies
 * the binaries actually inside the packed .app match the target arch, so a
 * regression fails the build loudly instead of shipping a broken Intel DMG.
 *
 * Cross-compiling x64 on arm64 (and vice-versa) works because @electron/rebuild
 * drives node-gyp with `--arch`, and the macOS SDK is universal; verified by a
 * clean x64 build producing `Mach-O 64-bit bundle x86_64` on an M-series host.
 *
 * NB: package.json sets `npmRebuild:false`, so this hook is now the single
 * authoritative native rebuild path for every packaged target arch. On macOS it
 * fixes Rosetta/cross-arch drift; on Windows/Linux it preserves the native rebuild
 * that electron-builder would otherwise have done.
 */
const { execFileSync } = require('child_process');
const path = require('path');

// Kept in sync with scripts/rebuild-native-electron.js MODULES and
// electron/lib/nativeArch.mjs TARGETS.
const MODULES = ['better-sqlite3', 'keytar'];

/**
 * electron-builder invokes beforePack with a context object that includes the
 * resolved target `arch` plus `electronVersion` and `appDir`. In beforePack the
 * arch may be the raw numeric ArchType enum (ia32=0, x64=1, armv7l=2, arm64=3,
 * universal=4), just like afterPack; `archToName` below also accepts the string
 * form defensively.
 *
 * Do not return `false` from this hook. The build config uses `npmRebuild:false`
 * to skip electron-builder's own rebuild without flipping
 * `areNodeModulesHandledExternally`, so node_modules still gets packed.
 */
module.exports = async function beforePack(context) {
  const archName = archToName(context.arch);
  if (archName !== 'x64' && archName !== 'arm64' && archName !== 'ia32') {
    console.warn(`[beforePack] unexpected arch "${archName}" (raw=${context.arch}); skipping custom native rebuild.`);
    return;
  }

  const root = path.resolve(__dirname, '..');
  const electronVersion =
    context.electronVersion || getElectronVersion(root);
  if (!electronVersion) {
    throw new Error('[beforePack] could not resolve Electron version for native rebuild.');
  }

  const cli = path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');

  console.log(
    `[beforePack] Rebuilding [${MODULES.join(', ')}] for target arch=${archName}, Electron ${electronVersion} (from source)…`
  );

  const args = [
    cli,
    '--force',
    '--arch', archName,
    '--version', electronVersion,
    '--build-from-source',
    '--which-module', MODULES.join(','),
  ];

  // Run node DIRECTLY (no `arch` wrapper). @electron/rebuild passes `--arch` to
  // node-gyp, and clang cross-compiles for that target while the toolchain
  // itself runs on the host's native slice — verified producing a clean
  // `Mach-O 64-bit bundle x86_64` from an arm64 host. We must NOT wrap in
  // `arch -x86_64 node`: a Homebrew/arm64-only Node has no x86_64 slice, so
  // Rosetta re-exec dies with "Bad CPU type in executable". (This is why we
  // diverge from scripts/rebuild-native-electron.js, which wraps in `arch` only
  // to defeat Rosetta *drift* for a same-arch host rebuild, never to cross-build.)
  try {
    execFileSync(process.execPath, args, {
      stdio: 'inherit',
      cwd: root,
    });
  } catch (err) {
    // Surface an actionable cause: cross-arch compilation needs the Xcode
    // Command Line Tools (node-gyp → clang). Rethrow so electron-builder aborts
    // the build rather than continuing toward a wrong-arch pack.
    throw new Error(
      `[beforePack] Native rebuild for ${archName} failed. ` +
      `Cross-arch compilation requires the Xcode Command Line Tools — install with ` +
      `\`xcode-select --install\` and retry.\nUnderlying error: ${err.message}`
    );
  }

  console.log(`[beforePack] Native rebuild for ${archName} complete.`);
  // Do not return false here. package.json `npmRebuild:false` already prevents
  // electron-builder from clobbering these binaries, while still allowing eb to
  // collect and pack node_modules into app.asar.
};

/** Map electron-builder's ArchType enum / string to a Node arch string. */
function archToName(arch) {
  // electron-builder passes the enum value; be liberal about shape.
  if (arch === 0 || arch === 'ia32' || arch === 'x86') return 'ia32';
  if (arch === 1 || arch === 'x64' || arch === 'x86_64') return 'x64';
  if (arch === 3 || arch === 'arm64' || arch === 'aarch64') return 'arm64';
  return String(arch);
}

function getElectronVersion(root) {
  try {
    return require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
  } catch {
    return null;
  }
}
