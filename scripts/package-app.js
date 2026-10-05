/**
 * Cross-platform wrapper around `electron-builder`.
 *
 * Why this script exists:
 *
 *   The packaging step used to be inlined in package.json as a bash subshell:
 *
 *     (electron-builder; code=$?; node scripts/rebuild-native-electron.js; exit $code)
 *
 *   `(...)`, `;` and `$?` are POSIX-shell constructs. npm runs scripts through
 *   `cmd.exe` on Windows, which has none of them, so cmd handed the entire tail
 *   to electron-builder as CLI arguments and the build died with
 *   "Unknown arguments: ;, code=$?;, node, ... exit, $code" before packaging
 *   ever started. This script reproduces the intended semantics in Node so the
 *   same `npm run dist` works on macOS and Windows.
 *
 * Semantics (identical on both platforms):
 *   1. Run electron-builder with any args passed through to this script.
 *   2. ALWAYS run scripts/rebuild-native-electron.js afterwards, success or
 *      failure — electron-builder rebuilds native addons against the *Node* ABI
 *      for packaging, which leaves the working tree unusable for `npm start`
 *      until they are rebuilt against the Electron ABI. A failed package must
 *      not strand the dev environment.
 *   3. Exit with electron-builder's exit code, not the rebuild's.
 *
 * electron-builder is invoked via its resolved JS entrypoint under the current
 * `process.execPath` rather than the `electron-builder` bin shim, so there is no
 * dependency on `.cmd`/`.ps1` shim resolution or on PATH ordering.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Resolve electron-builder's CLI entrypoint from its package manifest. */
function resolveElectronBuilderCli() {
  const manifestPath = require.resolve('electron-builder/package.json', {
    paths: [path.join(__dirname, '..')],
  });
  const manifest = require(manifestPath);
  const bin = manifest.bin;
  const relative =
    typeof bin === 'string' ? bin : bin && (bin['electron-builder'] || Object.values(bin)[0]);

  if (!relative) {
    throw new Error('Could not determine the electron-builder CLI entrypoint from its package.json');
  }

  return path.join(path.dirname(manifestPath), relative);
}

function run(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    // No `shell: true`: args are passed as an array, so paths containing spaces
    // (e.g. C:\Users\Some User\...) need no quoting and nothing is re-parsed by
    // cmd.exe or /bin/sh.
  });

  if (result.error) {
    console.error(`[package-app] Failed to launch ${path.basename(scriptPath)}:`, result.error.message);
    return 1;
  }

  // A process killed by a signal reports status === null. Report 128+N, the
  // same code `sh` would have produced via `$?` — release tooling uses 130
  // (SIGINT, operator cancelled) and 137 (SIGKILL, OOM) to tell a transient
  // kill apart from a genuine build failure, and collapsing both to 1 destroys
  // that distinction.
  if (result.status === null) {
    const signal = result.signal || 'unknown';
    console.error(`[package-app] ${path.basename(scriptPath)} terminated by signal ${signal}`);
    return 128 + (os.constants.signals[signal] ?? 0);
  }

  return result.status;
}

const builderArgs = process.argv.slice(2);

// ─── Per-platform disguise name ─────────────────────────────────────────────
// The on-disk app identity (bundle/exe/helpers on macOS, exe + PE version
// resource + install dir on Windows) is disguised at build time via
// productName. The believable alias differs per platform (a real macOS daemon
// is not a real Windows process, and vice-versa), so productName must be set
// for the TARGET platform. electron-builder defaults to the host platform when
// no --win/--mac/--linux flag is passed, so we detect the target the same way.
// See scripts/disguise-name.cjs for the names and the reasoning.
function detectTargetPlatform(args) {
  const hasWin = args.includes('--win') || args.includes('--win32');
  const hasMac = args.includes('--mac') || args.includes('--macos');
  const hasLinux = args.includes('--linux');
  // electron-builder builds EVERY requested platform in one invocation with a
  // single productName, but the believable alias is per-platform. More than one
  // platform flag means one of them gets the wrong on-disk identity, so surface
  // it instead of silently mis-naming a bundle.
  if ([hasWin, hasMac, hasLinux].filter(Boolean).length > 1) {
    console.warn(
      '[package-app] WARNING: multiple platform flags detected. The disguise ' +
        'productName applies to only one platform (first match); build each ' +
        'platform separately for correct per-platform naming.'
    );
  }
  if (hasWin) return 'win32';
  if (hasMac) return 'darwin';
  if (hasLinux) return 'linux';
  return process.platform;
}

const disguiseNames = require('./disguise-name.cjs');
const targetPlatform = detectTargetPlatform(builderArgs);
const disguiseName = disguiseNames[targetPlatform];

const pkgPath = path.join(__dirname, '..', 'package.json');
// Marker recording that a disguise productName was applied but not yet restored.
// The finally block below restores on every normal exit path, but if the WRAPPER
// process is killed (SIGTERM/SIGKILL, power loss) while electron-builder still
// runs, finally never executes and package.json would be left with the platform
// alias baked in. The next run sees the marker and restores the original value
// before applying a fresh disguise. It lives in os.tmpdir() so it never pollutes
// the repo; a reboot clearing it only costs a manual `git checkout package.json`.
const DISGUISE_MARKER = path.join(os.tmpdir(), 'natively-package-app-disguise-marker');
let originalProductName = null;

/** Set package.json "build" → "productName" to the target platform's alias. */
function applyDisguiseProductName() {
  if (!disguiseName) return; // no disguise defined for this platform (e.g. linux)
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  originalProductName = pkg.build && pkg.build.productName;
  if (originalProductName === disguiseName) return; // already correct
  pkg.build.productName = disguiseName;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  // Record the applied state so a run killed before the restore can recover.
  fs.writeFileSync(DISGUISE_MARKER, JSON.stringify({ originalProductName }));
  console.log(
    `[package-app] Disguise: productName "${originalProductName}" → "${disguiseName}" (target: ${targetPlatform})`
  );
}

/** Restore the original productName (so the source tree is left unchanged). */
function restoreDisguiseProductName() {
  if (originalProductName === null) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.build && pkg.build.productName !== originalProductName) {
    pkg.build.productName = originalProductName;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
  originalProductName = null;
  try { fs.unlinkSync(DISGUISE_MARKER); } catch { /* already cleared */ }
}

/** Restore a productName left behind by a previous run that was killed. */
function recoverFromKilledRun() {
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(DISGUISE_MARKER, 'utf8'));
  } catch {
    return; // no marker — nothing to recover
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (
      pkg.build &&
      marker.originalProductName != null &&
      pkg.build.productName !== marker.originalProductName
    ) {
      pkg.build.productName = marker.originalProductName;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      console.log(
        `[package-app] Recovered productName from a killed run: → "${marker.originalProductName}"`
      );
    }
  } catch (e) {
    console.warn(`[package-app] Could not recover productName from marker: ${e.message}`);
  }
  try { fs.unlinkSync(DISGUISE_MARKER); } catch { /* already cleared */ }
}

// An installer built without the calendar client secret ships a calendar that
// can never connect (scripts/lib/calendar-client-secret.cjs). Stop before
// electron-builder runs, so the native addons are never touched. Unpacked `dir`
// builds are local and CI smoke builds, which cannot see the secret: warn only.
{
  const { calendarSecretProblem, isUnpackedDirBuild } = require('./lib/calendar-client-secret.cjs');
  const problem = calendarSecretProblem(path.join(__dirname, '..'));
  if (problem && isUnpackedDirBuild(builderArgs)) {
    console.warn(`[package-app] WARNING: calendar sync will not work in this build. ${problem}`);
  } else if (problem) {
    console.error(`[package-app] Refusing to package: ${problem}`);
    process.exit(1);
  }
}

// The resolve is inside the guarded region on purpose. The bash original ran
// the native rebuild even when electron-builder could not be executed at all
// (sh printed "command not found", set $? to 127, and still ran the next
// command). If a resolution failure threw out of here instead, the developer's
// tree would be left with native addons built for the Node ABI and `npm start`
// would die with ERR_DLOPEN_FAILED — the exact failure the always-run rebuild
// exists to prevent.
// Recover first: if a previous run was killed mid-build, package.json may still
// carry a stale platform alias. Restore it before applying a fresh disguise.
recoverFromKilledRun();

let builderCode;
try {
  applyDisguiseProductName();
  try {
    builderCode = run(resolveElectronBuilderCli(), builderArgs);
  } finally {
    // Always restore the source productName, even on a failed/killed build, so
    // the tree is never left with a platform-specific alias baked into it.
    restoreDisguiseProductName();
  }
} catch (error) {
  console.error(`[package-app] Could not locate electron-builder: ${error.message}`);
  builderCode = 127; // sh's "command not found"
}

if (builderCode !== 0) {
  console.error(`[package-app] electron-builder exited with code ${builderCode}`);
}

console.log('[package-app] Restoring native addons to the Electron ABI...');
const rebuildCode = run(path.join(__dirname, 'rebuild-native-electron.js'), []);

if (rebuildCode !== 0) {
  console.error(
    `[package-app] rebuild-native-electron.js exited with code ${rebuildCode} — ` +
      'run "npm run rebuild:native" before starting the app in development.'
  );
}

process.exit(builderCode);
