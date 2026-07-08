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

  // PHASE-2E (Fix-1): install the process-level lifecycle hooks BEFORE
  // anything else so a crash during the arch check itself still writes
  // a marker. This is the earliest module loaded by main.ts (it's the
  // first `import` in main.ts), so any pre-whenReady crash (native
  // bindings dlopen, electron itself not yet loaded, etc.) goes through
  // the tracker. The full `install()` in main.ts adds the Electron-app
  // handlers after this point.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LifecycleTracker } = require('./utils/lifecycleTracker');
    LifecycleTracker.installBeforeReady((msg: string, meta?: Record<string, unknown>) => {
      try { console.log(msg, meta ?? ''); } catch { /* best-effort */ }
    });
  } catch {
    // Tracker not loadable (very early failure path). Swallow — the
    // existing uncaughtException handler below still shows the dialog.
  }

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

  /**
   * Detect a packaged build WITHOUT requiring the Electron `app` object
   * (the gate may run before electron is safe to load). The two signals:
   *
   *   1. Electron sets `process.resourcesPath` to `…/Natively.app/Contents/Resources`
   *      when the bundle is packaged. In dev it's `undefined` or points
   *      at the running `electron` executable's Resources dir.
   *   2. `process.defaultApp === true` is set when Electron is invoked
   *      as a normal CLI binary (i.e. dev mode), and is NOT set when the
   *      app was launched from a `.app` bundle.
   *
   * Combining the two gives a reliable packaged / dev split without ever
   * touching the `app` API.
   */
  function isPackagedBuild(): boolean {
    const rp = (process as any).resourcesPath as string | undefined;
    if (typeof rp !== 'string') return false;
    if ((process as any).defaultApp === true) return false;
    // Real packaged apps: resourcesPath ends in /Natively.app/Contents/Resources.
    // The `.app` substring is a robust heuristic — there's no `.app` segment
    // in any Electron dev tree path.
    return rp.includes('.app/');
  }

  // Register the arch-mismatch handler BEFORE running the check. The
  // check throws synchronously, and if the throw reaches process-level
  // without a handler attached, it becomes an uncaughtException with
  // no useful UX. By attaching here (the very first thing this IIFE
  // does), we guarantee the handler exists when the throw fires.
  //
  // NOTE: We intentionally do NOT call LifecycleTracker.setQuitReason()
  // here. The first matching uncaughtException handler is in main.ts:92
  // (registered at module-load time, before this IIFE runs) — it matches
  // the [nativeArch] prefix and calls electronApp.exit(1) synchronously,
  // so any setQuitReason call here would never execute. The actual
  // marker write lives in main.ts:92's branch (see the FIX-1 commit).
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (!(err instanceof Error) || !/^\[nativeArch(?::packaged)?\]/.test(err.message)) return;
    const packaged = err.message.startsWith('[nativeArch:packaged]');
    const detail = err.message
      .replace(/^\[nativeArch(?::packaged)?\]\s*/, '')
      .replace(/^Architecture mismatch:\s*/, '');
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { dialog, app: electronApp } = require('electron');
      // showErrorBox is modal and blocks until the user clicks OK.
      dialog.showErrorBox(
        packaged
          ? 'Natively was built for a different chip — please reinstall'
          : 'Native modules are wrong architecture — run this command to fix:',
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
    const packaged = isPackagedBuild();
    const verifyOpts = packaged
      ? { resourcesPath: (process as any).resourcesPath, packaged: true }
      : {};
    const repoRoot = packaged ? undefined : findRepoRoot(__dirname);
    const result = nativeArch.verifyAll(repoRoot, verifyOpts);
    if (result.ok || result.skipped) return;
    const detail = packaged
      ? `Detected: ${result.hardware}\n` +
        `Built:    ${result.mismatches.map((m: any) => m.actual).join(', ')}\n\n` +
        `${result.fix}\n\n` +
        `Mismatched files:\n` +
        result.mismatches.map((m: any) => `  - ${m.path} (built ${m.actual}, need ${m.expected})`).join('\n')
      : `Detected: ${result.hardware}\n` +
        `Built:    ${result.mismatches.map((m: any) => m.actual).join(', ')}\n\n` +
        `The compiled binaries were built under Rosetta and will not load under the ` +
        `native Electron runtime. The local database, meeting history, and modes ` +
        `will not work until rebuilt.\n\n` +
        `Fix (copy and paste into a terminal):\n\n` +
        `  ${result.fix}\n\n` +
        `Mismatched files:\n` +
        result.mismatches.map((m: any) => `  - ${m.path} (built ${m.actual}, need ${m.expected})`).join('\n');
    throw new Error(`${packaged ? '[nativeArch:packaged]' : '[nativeArch]'} Architecture mismatch:\n` + detail);
  } catch (e: any) {
    if (e instanceof Error && /^\[nativeArch(?::packaged)?\]/.test(e.message)) {
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