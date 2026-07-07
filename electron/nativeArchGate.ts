/**
 * NATIVE-ARCH BOOT GATE — module-load-time arch verification.
 *
 * Refuses to launch if better-sqlite3 / keytar were built for a different
 * architecture than this hardware. Without this gate, a Rosetta-poisoned
 * `.node` (x86_64 on arm64) fails at first dlopen inside DatabaseManager's
 * `import Database from 'better-sqlite3'` — which fires at module-load time,
 * well before app.whenReady() can run any async gate.
 *
 * The gate must run BEFORE the ESM imports in main.ts can pull in
 * DatabaseManager. Two facts make this tricky:
 *
 *   1. esbuild hoists all `import` statements to the top of the bundled
 *      `__esm` body in SOURCE ORDER. The first `import` in main.ts triggers
 *      the first `init_*()` call inside init_main() at module-load.
 *
 *   2. `import Database from 'better-sqlite3'` inside DatabaseManager.ts
 *      is a side-effect import that runs `require("better-sqlite3")` the
 *      first time DatabaseManager is referenced. That happens via
 *      `init_ipcHandlers()` (because ipcHandlers.ts imports DatabaseManager),
 *      which is itself the first non-trivial `init_*()` in main.ts.
 *
 * To win the race, main.ts does `import './nativeArchGate'` as its FIRST
 * import. esbuild emits `init_nativeArchGate()` before `init_ipcHandlers()`
 * inside the bundled init_main(), so this module's IIFE runs first.
 *
 * On mismatch: throws synchronously. The uncaughtException handler in
 * main.ts renders the dialog and exits with code 1. We do NOT call
 * process.exit() here because the user hasn't seen the dialog yet —
 * process.exit() races with showErrorBox's modal rendering. Throwing
 * synchronously prevents any subsequent require() in the same module-load
 * from running, which includes the one that would otherwise dlopen
 * better-sqlite3.
 */
(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');

  /**
   * Walk up from a starting directory until we find a directory that
   * contains node_modules/better-sqlite3/build/Release/better_sqlite3.node.
   * In the bundled main.js, __dirname is dist-electron/electron/ (esbuild
   * output dir), but the actual node_modules lives at the repo root, two
   * levels up. Walking up is robust to both: (a) the bundled main.js and
   * (b) the source main.ts run via ts-node or similar.
   */
  function findRepoRoot(startDir: string): string {
    let dir = startDir;
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(dir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return process.cwd();
  }

  // Register the arch-mismatch handler BEFORE running the check. The
  // check throws synchronously, and if the throw reaches process-level
  // without a handler attached, it becomes an uncaughtException with
  // no useful UX. By attaching here (the very first thing this IIFE
  // does), we guarantee the handler exists when the throw fires.
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (!(err instanceof Error) || !err.message.startsWith('[nativeArch]')) return;
    const detail = err.message
      .replace(/^\[nativeArch\]\s*/, '')
      .replace(/^Architecture mismatch:\s*/, '');
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { dialog, app: electronApp } = require('electron');
      // showErrorBox is modal and blocks until the user clicks OK.
      dialog.showErrorBox(
        'Native modules are wrong architecture — run this command to fix:',
        detail,
      );
      electronApp.exit(1);
    } catch {
      // Electron not loaded (e.g. running under bare node in a test or
      // harness). Print the diagnostic to stderr and exit cleanly with
      // code 1 — every consumer in the toolchain (npm scripts, CI, the
      // human running `npm start`) treats non-zero as failure.
      console.error('[nativeArch] ' + detail);
      process.exit(1);
    }
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nativeArch = require('./lib/nativeArch.cjs');
    const repoRoot = findRepoRoot(__dirname);
    const result = nativeArch.verifyAll(repoRoot);
    if (result.ok || result.skipped) return;
    const detail =
      `Detected: ${result.hardware}\n` +
      `Built:    ${result.mismatches.map((m: any) => m.actual).join(', ')}\n\n` +
      `The compiled binaries were built under Rosetta and will not load under the ` +
      `native Electron runtime. The local database, meeting history, and modes ` +
      `will not work until rebuilt.\n\n` +
      `Fix (copy and paste into a terminal):\n\n` +
      `  ${result.fix}\n\n` +
      `Mismatched files:\n` +
      result.mismatches.map((m: any) => `  - ${m.path} (built ${m.actual}, need ${m.expected})`).join('\n');
    throw new Error('[nativeArch] Architecture mismatch:\n' + detail);
  } catch (e: any) {
    if (e instanceof Error && e.message.startsWith('[nativeArch]')) {
      // Re-throw synchronously. The uncaughtException handler in main.ts
      // will display the dialog and exit cleanly.
      throw e;
    }
    // Some other failure during the verify itself (e.g. missing sysctl,
    // missing file binary). Don't block the app on infra issues — fall
    // through. The postinstall / boot-time guards still cover the actual
    // arch mismatch case.
    console.warn('[nativeArch] verify failed (non-fatal, will continue):', e?.message || e);
  }
})();

export {};