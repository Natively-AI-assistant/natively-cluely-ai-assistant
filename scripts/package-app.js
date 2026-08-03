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

// The resolve is inside the guarded region on purpose. The bash original ran
// the native rebuild even when electron-builder could not be executed at all
// (sh printed "command not found", set $? to 127, and still ran the next
// command). If a resolution failure threw out of here instead, the developer's
// tree would be left with native addons built for the Node ABI and `npm start`
// would die with ERR_DLOPEN_FAILED — the exact failure the always-run rebuild
// exists to prevent.
let builderCode;
try {
  builderCode = run(resolveElectronBuilderCli(), builderArgs);
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
