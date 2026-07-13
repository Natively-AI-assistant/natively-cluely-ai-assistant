// ============================================================================
// NATIVE-ARCH BOOT GATE — see electron/nativeArchGate.ts.
//
// This MUST be the first import in this file. esbuild hoists all imports
// to the top of the bundled init_main() function in source order; by
// placing the gate first, we ensure init_nativeArchGate() runs before
// init_DatabaseManager() (which is what loads better-sqlite3).
// ============================================================================
import './nativeArchGate';

import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, systemPreferences, screen, desktopCapturer } from "electron"
import * as crypto from "crypto"
import path from "path"
import fs from "fs"
import os from "os"
import dns from "dns"
import { SystemAudioHealthClassifier } from "./audio/systemAudioHealthClassifier.mjs"
import { autoUpdater } from "electron-updater"

// Override global dns.lookup to resolve macOS system resolver issues with api.natively.software
const originalLookup = dns.lookup;
dns.lookup = function(hostname: any, options: any, callback: any) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname === 'api.natively.software') {
    dns.resolve4(hostname, (err, addresses) => {
      if (err || !addresses.length) {
        originalLookup(hostname, options, callback);
      } else {
        const addr = addresses[0];
        if (options && (options as any).all) {
          callback(null, [{ address: addr, family: 4 }] as any);
        } else {
          callback(null, addr, 4);
        }
      }
    });
  } else {
    originalLookup(hostname, options, callback);
  }
} as any;

if (!app.isPackaged) {
  require('dotenv').config();
}

// ============================================================================
// FONTATIONS RENDERER-CRASH MITIGATION (2026-07-10) — user crash report on
// macOS 27.0 (26A5378j), Electron 33.4.11 / Chromium 130.
//
// Chromium's Rust "Fontations" font backend (font hinting + variable-font
// normalized-coordinate path) traps with EXC_BREAKPOINT / SIGTRAP on the
// renderer's main thread (CrRendererMain) while shaping text on macOS 26/27.
// Faulting frames from the real crash report:
//   fontations_ffi$cxxbridge1$BridgeHintingInstance$operator$sizeof
//   fontations_ffi$cxxbridge1$BridgeNormalizedCoords$operator$sizeof
// Disabling the feature falls Chromium back to the legacy CoreText path, which
// is stable. Related upstream: electron/electron#49522 (no upstream fix).
//
// TIMING: this MUST run before app.whenReady() / before the first GPU+renderer
// command line is assembled, or Chromium ignores the switch. This is bundle
// load (top of main), which satisfies it. Do NOT move it next to the
// disable-background-timer-throttling switch later in initializeApp() — that
// runs AFTER whenReady and is too late for a feature flag.
//
// SCOPE: darwin + macOS 26+ only (Darwin kernel major >= 25 — same mapping as
// ipcHandlers.ts get-os-name). Sequoia (macOS 15 / Darwin 24) and Windows keep
// the faster Rust backend.
//
// ESCAPE HATCH (NATIVELY_* convention):
//   NATIVELY_DISABLE_FONTATIONS=0 → force-KEEP Fontations even on macOS 26+
//   NATIVELY_DISABLE_FONTATIONS=1 → force-DISABLE on any platform/version
//   (unset)                       → auto: disable on darwin macOS 26+ only
// ============================================================================
try {
  const fontationsOverride = process.env.NATIVELY_DISABLE_FONTATIONS;
  let shouldDisableFontations: boolean;
  if (fontationsOverride === '0') {
    shouldDisableFontations = false;
  } else if (fontationsOverride === '1') {
    shouldDisableFontations = true;
  } else {
    const darwinMajor =
      process.platform === 'darwin'
        ? parseInt(os.release().split('.')[0] || '0', 10)
        : 0;
    shouldDisableFontations = darwinMajor >= 25; // Darwin 25 = macOS 26
  }
  if (shouldDisableFontations) {
    // NOTE: this is the ONLY disable-features append in the codebase
    // (verified 2026-07-10). Chromium keeps only the LAST --disable-features
    // value, so if a second disabled feature is ever added it MUST be combined
    // into one comma-separated value here rather than a second appendSwitch.
    //
    // FEATURE NAMES (verified 2026-07-10 via `strings` on the Electron
    // 33.4.11 framework binary): the base::Feature names are
    // "FontationsFontBackend" (the full Rust backend) and
    // "FontationsForSelectedFormats" (routes selected font formats — incl.
    // variable fonts, the BridgeNormalizedCoords crash path — through Rust
    // even when the full backend is off). A bare "Fontations" feature does
    // NOT exist; Chromium silently ignores unknown names, so passing
    // 'Fontations' here was a no-op. Both must be disabled together.
    app.commandLine.appendSwitch(
      'disable-features',
      'FontationsFontBackend,FontationsForSelectedFormats'
    );
    console.log(
      '[Fontations] disable-features=FontationsFontBackend,FontationsForSelectedFormats applied ' +
      `(platform=${process.platform} release=${os.release()} override=${fontationsOverride ?? 'auto'})`
    );
  }
} catch {
  // Never let the mitigation itself break boot. Worst case: Fontations stays
  // enabled and the (rare) font crash remains possible — the render-process-gone
  // auto-reload handler recovers it.
}

// ============================================================================
// TEMPORARY LEAK-DIAGNOSIS TEST HOOKS (2026-07-10) — remove after the Windows
// native-RSS-leak (OOM-freeze on boot) is root-caused. Each is env-gated and a
// no-op unless the flag is set, so they never affect normal runs. See the
// per-process procMem field added to StabilityHeartbeat for attribution.
//
//   NATIVELY_DISABLE_GPU=1        → app.disableHardwareAcceleration() — tests
//                                   whether the leak is Chromium GPU/compositor
//                                   shared memory (top hypothesis). If RSS stays
//                                   flat with this set, the GPU process is it.
//   NATIVELY_DISABLE_STT_PREWARM=1 → skip prewarmSttProviders() (gated at the
//                                   call site in AppState).
//   NATIVELY_ONNX_MIN_FREE_GB=999 → (existing) disables ALL local ONNX workers.
// ============================================================================
try {
  if (process.env.NATIVELY_DISABLE_GPU === '1') {
    app.disableHardwareAcceleration();
    console.warn('[LeakTest] NATIVELY_DISABLE_GPU=1 → hardware acceleration DISABLED for this run');
  }
} catch (e) {
  console.warn('[LeakTest] disableHardwareAcceleration failed:', e);
}

// MASTER LOCAL-MODEL KILL-SWITCH (2026-07-11) — diagnostic.
// NATIVELY_NO_LOCAL_MODELS=1 blocks EVERY on-device model from loading at
// startup: the ONNX local-embedding fallback, the zero-shot intent classifier,
// the BGE reranker, Whisper STT prewarm, the LocalFallbackPreflight probe, AND
// the Ollama bootstrap. NOTHING local is invoked. If the app boots and stays
// stable (no native-RSS leak / UNRESPONSIVE) with this set — while it leaks
// without it — the on-device model path is confirmed as the cause of the
// Windows freeze (which only engages that path because cloud embedding auth
// fails there but works on the dev Mac). A no-op unless the flag is set.
function localModelsDisabled(): boolean {
  return process.env.NATIVELY_NO_LOCAL_MODELS === '1';
}
if (localModelsDisabled()) {
  console.warn('[LeakTest] NATIVELY_NO_LOCAL_MODELS=1 → ALL local models (ONNX embedding/intent/reranker, Whisper prewarm, preflight, Ollama) are DISABLED this run');
}

/**
 * Whether THIS build carries a real Developer ID signature.
 *
 * The signed release path (`electron-builder.signed.cjs`) bakes
 * `nativelySigned: true` into the packaged app's package.json via
 * `extraMetadata`. The default/dev build leaves it absent. We read the flag
 * once from the bundled package.json (inside the asar) and cache it.
 *
 * This is the "build flag" half of the auto-install gate — see canAutoInstall().
 */
let _cachedSignedBuild: boolean | null = null
function isSignedBuild(): boolean {
  if (_cachedSignedBuild !== null) return _cachedSignedBuild
  try {
    const pkgPath = path.join(app.getAppPath(), 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    _cachedSignedBuild = pkg?.nativelySigned === true
  } catch {
    _cachedSignedBuild = false
  }
  return _cachedSignedBuild
}

/**
 * Whether this build can perform a real in-place auto-install + relaunch.
 *
 *  - Dev (not packaged): never — electron-updater no-ops in dev anyway.
 *  - Windows / Linux packaged: yes — NSIS/AppImage updaters relaunch fine
 *    without a macOS-style code signature.
 *  - macOS packaged: only when signed — Squirrel.Mac refuses to swap and
 *    relaunch an app that lacks a valid Developer ID signature, so an unsigned
 *    macOS build must fall back to the manual "open the download" flow.
 */
function canAutoInstall(): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'darwin') return isSignedBuild()
  return true
}

// Handle stdout/stderr errors at the process level to prevent EIO crashes
// This is critical for Electron apps that may have their terminal detached
process.stdout?.on?.('error', () => { });
process.stderr?.on?.('error', () => { });

process.on('uncaughtException', (err) => {
  const reportPath = isNativeArchGateCrash(err)
    ? null
    : writeProcessReport('uncaughtException');
  logCrashConsole('uncaughtException', {
    error: formatCrashError(err),
    reportPath,
    skippedReport: isNativeArchGateCrash(err) ? 'native-arch-gate' : undefined,
  });
  emergencyCloseDatabase('uncaughtException');

  // First-line handler for the native-arch gate (thrown synchronously at
  // module-load above) and any other uncaught errors. The arch gate's
  // error message starts with '[nativeArch]' or '[nativeArch:packaged]' — for those,
  // render the appropriate fix dialog and exit 1. For everything else, fall
  // through to the original logToFile behavior.
  if (err instanceof Error && /^\[nativeArch(?::packaged)?\]/.test(err.message)) {
    const packaged = err.message.startsWith('[nativeArch:packaged]');
    const detail = err.message.replace(/^\[nativeArch(?::packaged)?\]\s*/, '').replace(/^Architecture mismatch:\s*/, '');
    // PHASE-2E (CRITICAL fix): tag this fatal exit so the NEXT launch sees
    // a "previous session ended unexpectedly" marker with reason
    // fatal-main-error — instead of mis-reading it as a generic crash.
    // MUST happen here, in this branch, because this handler is the FIRST
    // one to match the [nativeArch] prefix and exit()s before any other
    // uncaughtException handler (including the one inside nativeArchGate.ts
    // and the one in LifecycleTracker) gets a chance to run.
    try {
      const { LifecycleTracker } = require('./utils/lifecycleTracker');
      LifecycleTracker.getInstance().setQuitReason('fatal-main-error', {
        source: 'native-arch-gate',
        message: detail.slice(0, 200), // bounded — don't spam the marker
      });
    } catch { /* best-effort */ }
    try {
      // Lazy-require electron so this handler doesn't fire before
      // app.whenReady() if the bundle is loaded in a non-Electron context.
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
      // Electron not loaded (running under bare Node in a test) — exit
      // cleanly with the error text on stderr.
      console.error('[nativeArch] ' + detail);
      process.exit(1);
    }
    return;
  }
  logToFile('[CRITICAL] Uncaught Exception: ' + redactArgsForLog([err]));
});

process.on('unhandledRejection', (reason, promise) => {
  logCrashEvent('unhandledRejection', {
    reason: formatCrashError(reason),
    promise: String(promise),
  });
  logToFile('[CRITICAL] Unhandled Rejection: ' + redactArgsForLog([reason]));
  emergencyCloseDatabase('unhandledRejection');
});

// OS-level shutdown signals. macOS / Linux ship SIGTERM to apps before
// SIGKILL, and Cmd+Q / Quit menu paths route through app.quit() which we
// already cover in `before-quit`. These handlers cover the cases where the
// OS kills the process directly: a hung process getting SIGTERM from
// launchd, an interrupted `npm run app:dev` Ctrl+C, a tmux/SSH session
// ending. Each does a synchronous checkpoint+close so the next launch
// doesn't see a stale WAL holding a kernel lock from the dead process.
//
// IMPORTANT: register a handler WITHOUT process.exit()/app.exit() and Node
// SUPPPRESSES the default exit — the dev workflow (`npm run app:dev` via
// concurrently) breaks because Ctrl+C kills Vite but the Electron main
// process keeps running, holding the port indefinitely. So we explicitly
// call app.exit(0) AFTER the DB close on the dev-relevant signals
// (SIGINT/SIGTERM). SIGHUP gets the DB close + breadcrumb only — a tmux
// SSH disconnect shouldn't kill the app on principle, and SIGHUP is rarely
// sent by anything on macOS.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    try {
      logToFile(`[SIGNAL] received ${sig}`);
      emergencyCloseDatabase(sig);
    } catch {
      /* never throw from a signal handler */
    }
    // app.exit(0) is the Electron-clean way to terminate synchronously —
    // skips the "are you sure?" prompts and bypasses before-quit gracefully.
    // We require() lazily because app may not exist pre-whenReady in a test
    // harness (ELECTRON_RUN_AS_NODE).
    try {
      const { app: electronApp } = require('electron');
      electronApp.exit(0);
    } catch {
      process.exit(0);
    }
  });
}
process.on('SIGHUP', () => {
  try {
    logToFile('[SIGNAL] received SIGHUP');
    emergencyCloseDatabase('SIGHUP');
  } catch {
    /* never throw from a signal handler */
  }
  // No exit on SIGHUP — terminal disconnect shouldn't kill a desktop app.
});

// CQ-04 fix: do NOT call app.getPath() at module load time.
// app.getPath('documents') is not guaranteed to be available before app.whenReady().
// Use a lazy getter instead — the path is resolved on first logToFile() call.
let _logFile: string | null = null;
const getLogFile = (): string | null => {
  if (_logFile) return _logFile;
  try {
    _logFile = path.join(app.getPath('documents'), 'natively_debug.log');
    return _logFile;
  } catch {
    // app.ready may not have fired yet (including native module boot gates).
    // Still write somewhere stable so a pre-ready crash leaves a reason behind.
    const home = os.homedir?.();
    _logFile = home
      ? path.join(home, 'Documents', 'natively_debug.log')
      : path.join(os.tmpdir(), 'natively_debug.log');
    return _logFile;
  }
};

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function safeJsonForLog(value: unknown): string {
  // Replacer-based JSON serializer safe for BigInt, Error, circular refs,
  // Uint8Array, and other shapes that JSON.stringify throws on by default.
  // Falls back to a plain-string form on any unexpected failure so a crash
  // breadcrumb is never silently swallowed.
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return `<BigInt:${v.toString()}>`;
      if (v instanceof Error) {
        return {
          __error: true,
          name: v.name,
          message: v.message,
          stack: v.stack,
          cause: v.cause,
        };
      }
      if (v instanceof Uint8Array) return `<Uint8Array len=${v.length}>`;
      if (v instanceof Buffer) return `<Buffer len=${v.length}>`;
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '<circular>';
        seen.add(v);
      }
      return v;
    }) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatCrashError(value: unknown, depth = 0): Record<string, unknown> {
  if (value instanceof Error) {
    const cause = value.cause;
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      // Unwind ES2022 cause chains up to 5 deep — beyond that, just stringify.
      cause: depth < 5 && cause instanceof Error
        ? formatCrashError(cause, depth + 1)
        : (cause != null ? String(cause) : undefined),
    };
  }
  return { value: String(value) };
}

function getCrashDiagnostics(extra: Record<string, unknown> = {}): Record<string, unknown> {
  // Wrap the whole body in try/catch — these calls all allocate or query the
  // OS (memoryUsage, freemem, totalmem, app.isReady) and CAN throw under
  // OOM / sandboxed test environments. If they throw, the original crash
  // evidence must survive; we return a minimal fallback so the
  // [CRASH:*] line still carries the pid/label that points at the crash.
  try {
    const mem = process.memoryUsage();
    return {
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        v8: process.versions.v8,
      },
      uptimeSec: Math.round(process.uptime()),
      appReady: app.isReady(),
      appPackaged: app.isPackaged,
      rssMB: mb(mem.rss),
      heapUsedMB: mb(mem.heapUsed),
      heapTotalMB: mb(mem.heapTotal),
      externalMB: mb(mem.external),
      arrayBuffersMB: mb(mem.arrayBuffers),
      freeMemMB: mb(os.freemem()),
      totalMemMB: mb(os.totalmem()),
      wal: collectWalSnapshot(),
      ...extra,
    };
  } catch (e: any) {
    return {
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      diagnosticError: e?.message || String(e),
      ...extra,
    };
  }
}

function logCrashEvent(label: string, payload: Record<string, unknown>): void {
  try {
    logToFile(`[CRASH:${label}] ${safeJsonForLog(getCrashDiagnostics(payload))}`);
  } catch (e: any) {
    // Last-resort breadcrumb. If even this fails (e.g. logToFile itself), we
    // at least surface the label so triage can tell WHICH crash event was
    // dropped instead of seeing a missing line.
    try { logToFile(`[CRASH:${label}] logging-failed: ${String(e?.message || e)}`); } catch { /* ignored */ }
  }
}

function logCrashConsole(label: string, payload: Record<string, unknown>): void {
  try {
    const snapshot = getCrashDiagnostics(payload);
    const line = `[CRASH:${label}] ${safeJsonForLog(snapshot)}`;
    logToFile(line);
    try {
      process.stderr?.write?.(line + '\n');
    } catch { /* stdout/stderr can be detached */ }
  } catch (e: any) {
    try { logToFile(`[CRASH:${label}] logging-failed: ${String(e?.message || e)}`); } catch { /* ignored */ }
  }
}

// Module-scope emergency DB close. Called from EVERY crash path
// (uncaughtException, unhandledRejection, SIGTERM/SIGINT/SIGHUP,
// render-process-gone, child-process-gone, gpu-process-crashed) so a
// hard kill still leaves a clean WAL and releases the OS-level file lock.
// The next launch's `new Database(dbPath)` then never sees a stale WAL
// holding a kernel lock from the dead writer (the documented launch-hang
// class of bug). Idempotent: safe to call from multiple paths in the same
// process. No-ops if the DB manager isn't initialized yet (early-boot
// handler fires before DatabaseManager.getInstance() exists).
//
// The single-shot flag is set INSIDE the success branch — if checkpoint
// or close throws (transient disk error, half-initialized DB), a later
// crash path can still retry the close. Once the close succeeds, the
// flag sticks and subsequent calls early-return.
let _emergencyDbClosed = false;
function emergencyCloseDatabase(reason: string): void {
  if (_emergencyDbClosed) return;
  try {
    const { DatabaseManager } = require('./db/DatabaseManager');
    const dbMgr = DatabaseManager.getInstance();
    // REGRESSION FIX (2026-07-10): do NOT wal_checkpoint(TRUNCATE) here.
    // This function runs ONLY from crash paths (uncaughtException,
    // unhandledRejection, SIGTERM/SIGINT, SIGHUP, render/child/gpu-process-gone,
    // initializeApp-failed). A TRUNCATE checkpoint fired from a crashing or
    // half-initialized process — or interrupted by the macOS SIGTERM→SIGKILL
    // race — can leave natively.db-wal/-shm half-truncated, which then BLOCKS
    // the next `new Database()` open and bricks every subsequent launch on both
    // macOS and Windows (the "loads once, crashes, then never opens again" bug).
    // We now ONLY release the handle (drop the OS lock) and let SQLite's own
    // automatic WAL recovery replay the log safely on the next clean open —
    // exactly how v2.7.0 (which never checkpointed on crash) behaved. The clean
    // quit path (checkpointDatabase / before-quit / will-quit) still checkpoints
    // because there the process is HEALTHY.
    try {
      if (typeof dbMgr.closeWithoutCheckpoint === 'function') {
        dbMgr.closeWithoutCheckpoint();
      } else {
        // Defensive fallback for an older manager shape — close is still
        // better than leaving the handle open, even if it checkpoints.
        dbMgr.close?.();
      }
    } catch (e: any) {
      logToFile(`[DB-EMERGENCY] close failed during ${reason}: ${e?.message || e}`);
      // Don't latch — a later crash path can retry the close.
      return;
    }
    _emergencyDbClosed = true;
    logToFile(`[DB-EMERGENCY] closed (no checkpoint) during ${reason}`);
  } catch (e: any) {
    // Even if the require itself fails (manager not yet bootstrapped),
    // we still want the breadcrumb so triage can see we tried. Don't latch
    // the flag — a later crash path may run after the manager bootstraps.
    try { logToFile(`[DB-EMERGENCY] failed during ${reason}: ${e?.message || e}`); } catch { /* ignored */ }
  }
}

// Returns true if this exception message looks like the routine native-arch
// gate mismatch (handled by the dialog already). We do NOT write a process
// report on that path because the user already knows the cause and a full
// report would just leak env vars.
function isNativeArchGateCrash(err: unknown): boolean {
  return err instanceof Error && /^\[nativeArch(?::packaged)?\]/.test(err.message);
}

function writeProcessReport(label: string): string | null {
  try {
    const report = (process as any).report;
    if (!report?.writeReport) return null;
    const dir = path.dirname(getLogFile() || path.join(os.tmpdir(), 'natively_debug.log'));
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
    const file = path.join(dir, `natively-${label}-${Date.now()}.report.json`);
    report.writeReport(file);
    // REDACT environmentVariables from the report on disk. Node's process
    // report includes the FULL process.env — that includes any API keys the
    // user has in their shell (GEMINI_API_KEY, OPENAI_API_KEY, etc). Strip
    // the env block before any other process can read the file. We keep the
    // heap snapshot, libuv, JS stack, native stack — those are the actually
    // useful crash artifacts.
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && 'environmentVariables' in parsed) {
        delete parsed.environmentVariables;
        parsed.environmentVariables = '[REDACTED: see natively_debug.log for env-free diagnostic context]';
        fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
      }
    } catch (e: any) {
      // If we can't read/rewrite, delete the unredacted file rather than leak it.
      try { fs.unlinkSync(file); } catch { /* best-effort */ }
      logToFile(`[CRASH:${label}] process report redacted-failed; deleted: ${e?.message || e}`);
      return null;
    }
    logToFile(`[CRASH:${label}] process report written (env redacted): ${file}`);
    return file;
  } catch (e: any) {
    logToFile(`[CRASH:${label}] process report failed: ${e?.message || e}`);
    return null;
  }
}

function logStartupPhase(phase: string, meta: Record<string, unknown> = {}): void {
  logToFile(`[STARTUP:${phase}] ${safeJsonForLog(getCrashDiagnostics(meta))}`);
}

// Lazy redactor import — pulled at first call so this file can boot even if
// the redactor module fails to load (we fall back to a no-op transform).
let _redactForLog: ((args: unknown[]) => string) | null = null;
function redactArgsForLog(args: unknown[]): string {
  if (!_redactForLog) {
    try {
      _redactForLog = require('./utils/redactForLog').redactForLog;
    } catch {
      _redactForLog = (xs: unknown[]) => xs.map(a => (a instanceof Error ? a.stack || a.message : (typeof a === 'object' ? JSON.stringify(a) : String(a)))).join(' ');
    }
  }
  return _redactForLog!(args);
}

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within `ms`
 * milliseconds, rejects with an error whose message contains `tag`. This
 * prevents desktopCapturer.getSources (which can block indefinitely on TCC
 * dialogs or slow API responses) from hanging the Electron main process.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[withTimeout] ${tag} timed out after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/** Maximum log file size before rotation (10 MB). */
const LOG_MAX_BYTES = 10 * 1024 * 1024;

// Per-launch reset: when this version of the app starts, an existing
// natively_debug.log from a previous session is overwritten so the user
// always sees only the CURRENT session's breadcrumbs. Opt-out via
// NATIVELY_KEEP_PREVIOUS_LOG=1 (preserve the old log as natively_debug.log.prev
// for forensics).
//
// CRITICAL FIX (2026-07-09): only TRUNCATE when the prior session ended
// CLEANLY. If the prior session crashed (renderer-gone / fatal-main-error /
// unknown / no marker at all — the common "force-quit then relaunch" path),
// rotate the prior log to .prev so the crash evidence the user is trying to
// debug survives the relaunch. Without this gate, the very common
// "crash → force-quit → relaunch to capture logs" sequence the user relies
// on would eat exactly the crash record they want to read.
function shouldTruncatePriorLog(): boolean {
  if (process.env.NATIVELY_KEEP_PREVIOUS_LOG === '1') return false;
  try {
    const { LifecycleTracker } = require('./utils/lifecycleTracker');
    const crashed = LifecycleTracker.getInstance().didPreviousSessionCrash();
    return !crashed;
  } catch {
    // LifecycleTracker unavailable (test harness / pre-whenReady): be
    // conservative and ROTATE so we never destroy evidence we can't verify.
    return false;
  }
}

let _didStartupLogReset = false;
function resetStartupLog(): void {
  if (_didStartupLogReset) return;
  _didStartupLogReset = true;
  const logFile = getLogFile();
  if (!logFile) return;
  try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); } catch { /* best-effort */ }
  const truncate = shouldTruncatePriorLog();
  try {
    if (fs.existsSync(logFile)) {
      if (truncate) {
        // Clean prior session: blow away the previous log so the user only
        // sees current-session breadcrumbs. Old contents are GONE.
        fs.writeFileSync(logFile, '');
      } else {
        // Prior session crashed (or we can't tell): rotate to .prev so the
        // crash evidence survives this relaunch. The user can read either
        // file directly off disk.
        const rotated = logFile + '.prev';
        try { if (fs.existsSync(rotated)) fs.unlinkSync(rotated); } catch { /* best-effort */ }
        try { fs.renameSync(logFile, rotated); } catch { /* best-effort */ }
      }
    }
    // Only clear stale process-report files when we're also truncating the
    // log. When rotating (prior crash), keep the previous report files too
    // — they're part of the forensic picture the user is debugging.
    if (truncate) {
      try {
        const dir = path.dirname(logFile);
        for (const name of fs.readdirSync(dir)) {
          if (/^natively-.*\.report\.json$/.test(name)) {
            try { fs.unlinkSync(path.join(dir, name)); } catch { /* best-effort */ }
          }
        }
      } catch { /* best-effort */ }
    }
  } catch (e: any) {
    // Non-fatal: if we can't reset, just keep appending to whatever exists.
    try { fs.appendFileSync(logFile, `[reset-failed] ${e?.message || e}\n`); } catch { /* ignored */ }
  }
  // Always write a marker line so the user (and we) can confirm what
  // happened to the prior log.
  try {
    fs.appendFileSync(
      logFile,
      `${new Date().toISOString()} [STARTUP] log opened (prior=${truncate ? 'truncated' : 'rotated-to-prev'}) pid=${process.pid} version=${app.getVersion?.() ?? 'unknown'} platform=${process.platform} arch=${process.arch}\n`,
    );
  } catch { /* best-effort */ }
}

function logToFile(msg: string) {
  try {
    // Lazy: reset the log exactly once per process, on the very first write.
    // We reset on first write (not at module load) because getLogFile() may
    // need app.whenReady() to resolve a stable userData path, AND because the
    // whole point is to overwrite previous-run breadcrumbs.
    resetStartupLog();
    const logFile = getLogFile();
    if (!logFile) return;
    try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); } catch { /* best-effort */ }

    // P2-1: rotate the log file when it exceeds LOG_MAX_BYTES so that long-running
    // sessions (or meetings with dense transcripts) don't fill the user's disk.
    // The previous log is kept as .log.1 for one-generation rollover.
    try {
      const stat = fs.statSync(logFile);
      if (stat.size >= LOG_MAX_BYTES) {
        const rotated = logFile + '.1';
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(logFile, rotated);
      }
    } catch {
      // statSync throws if the file doesn't exist yet — that's fine
    }
    fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n');
  } catch (e) {
    // Ignore logging errors
  }
}

function mb(n: number | undefined | null): number {
  return Math.round(((n || 0) / 1024 / 1024) * 10) / 10;
}

function collectWalSnapshot(): Array<{ file: string; mb: number }> {
  try {
    const userData = app.isReady() ? app.getPath('userData') : path.dirname(getLogFile() || os.tmpdir());
    return fs.readdirSync(userData)
      .filter(name => name.endsWith('-wal'))
      .map(name => {
        const full = path.join(userData, name);
        return { file: name, mb: mb(fs.statSync(full).size) };
      })
      .filter(x => x.mb > 0)
      .sort((a, b) => b.mb - a.mb)
      .slice(0, 5);
  } catch {
    return [];
  }
}

async function ensureMacMicrophoneAccess(context: string): Promise<boolean> {
  if (process.platform !== 'darwin') return true;

  try {
    const currentStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`[Main] macOS microphone permission before ${context}: ${currentStatus}`);

    if (currentStatus === 'granted') {
      return true;
    }

    const granted = await systemPreferences.askForMediaAccess('microphone');
    console.log(
      `[Main] macOS microphone permission request during ${context}: ${granted ? 'granted' : 'denied'}`
    );
    return granted;
  } catch (error) {
    console.error(`[Main] Failed to check macOS microphone permission during ${context}:`, error);
    return false;
  }
}

/**
 * Check macOS Screen Recording (kTCCServiceScreenCapture) permission status.
 *
 * Electron has no askForMediaAccess('screen') API — macOS only shows the TCC
 * dialog when the app actually calls a protected API (SCK / CoreAudio tap).
 * If the permission is 'denied', we cannot re-prompt; the user must re-enable
 * manually in System Settings → Privacy & Security → Screen Recording.
 *
 * Returns false only when the permission is explicitly 'denied'. All other
 * statuses ('granted', 'not-determined', 'restricted') return true because:
 *   - 'granted':         already allowed — nothing to do.
 *   - 'not-determined':  macOS will show the dialog when SCK/CoreAudio tap runs.
 *   - 'restricted':      managed device policy — nothing we can do programmatically.
 */
type MacScreenCaptureStatus = 'granted' | 'denied' | 'not-determined' | 'restricted';

type MacScreenCaptureCapability = {
  status: MacScreenCaptureStatus;
  capturable: boolean;
  effectiveDenied: boolean;
  sourceCount: number;
  message?: string;
  error?: string;
};

let latestSystemAudioPermissionWarning: string | null = null;

function rememberSystemAudioPermissionWarning(message: string): void {
  latestSystemAudioPermissionWarning = message;
}

function clearSystemAudioPermissionWarning(): void {
  latestSystemAudioPermissionWarning = null;
}

/**
 * B5: Whether the dev-mode TCC bypass is enabled.
 *
 * Pre-fix this bypass was unconditional in dev mode: every `npm run app:dev`
 * launch reported screen-capture status as `'granted'` regardless of the
 * actual TCC state. Production bugs (the dominant "permissions granted but
 * no transcription" failure mode) were invisible during local dev.
 *
 * Now opt-in: default OFF in dev so devs see the real TCC status; set
 * `NATIVELY_DEV_BYPASS_SCREEN_TCC=1` to restore the legacy bypass for
 * smooth daily development.
 */
function isDevTccBypassEnabled(): boolean {
  return !app.isPackaged && process.env.NATIVELY_DEV_BYPASS_SCREEN_TCC === '1';
}

function getMacScreenCaptureStatus(): MacScreenCaptureStatus {
  if (process.platform !== 'darwin') return 'granted';

  // B5: opt-in dev bypass — see isDevTccBypassEnabled() for rationale.
  if (isDevTccBypassEnabled()) {
    console.log('[Main] Dev TCC bypass enabled (NATIVELY_DEV_BYPASS_SCREEN_TCC=1) — reporting screen capture as granted');
    return 'granted';
  }

  try {
    return systemPreferences.getMediaAccessStatus('screen') as MacScreenCaptureStatus;
  } catch (error) {
    console.error('[Main] Failed to check screen recording permission:', error);
    return 'not-determined';
  }
}

async function resolveMacScreenCaptureCapability(context: string): Promise<MacScreenCaptureCapability> {
  const status = getMacScreenCaptureStatus();

  const isMac = process.platform === 'darwin';
  // B5: Mirror getMacScreenCaptureStatus's opt-in bypass policy. Default in
  // dev is to run the full capability resolution so devs see the real path.
  if (!isMac || isDevTccBypassEnabled()) {
    clearSystemAudioPermissionWarning();
    return { status, capturable: true, effectiveDenied: false, sourceCount: 0 };
  }

  if (isMac && status === 'restricted') {
    const message = formatPermissionMessage('mac-screen-recording-restricted');
    rememberSystemAudioPermissionWarning(message);
    return { status, capturable: false, effectiveDenied: true, sourceCount: 0, message };
  }

  if (status !== 'denied') {
    clearSystemAudioPermissionWarning();
    return { status, capturable: true, effectiveDenied: false, sourceCount: 0 };
  }

  try {
    const sources = await withTimeout(
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
      }),
      5000,
      `screen-capture-probe-timeout-${context}`,
    );
    const sourceCount = sources.filter((source) => source.id.startsWith('screen:')).length;
    const capturable = sourceCount > 0;

    if (capturable) {
      clearSystemAudioPermissionWarning();
      console.warn(`[Main] Screen Recording status is denied during ${context}, but capture probe succeeded; continuing without permission banner.`);
    } else {
      rememberSystemAudioPermissionWarning(formatPermissionMessage('screen-recording-denied'));
    }

    return { status, capturable, effectiveDenied: !capturable, sourceCount };
  } catch (error: any) {
    // Did the timeout fire?
    if (error?.message?.includes('screen-capture-probe-timeout')) {
      const message = formatPermissionMessage('screen-recording-denied');
      rememberSystemAudioPermissionWarning(message + ' (probe timed out)');
      console.warn(`[Main] Screen Recording capture probe timed out during ${context} — treating as denied.`);
      return { status, capturable: false, effectiveDenied: true, sourceCount: 0, message, error: error.message };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const message = formatPermissionMessage('screen-recording-denied');
    rememberSystemAudioPermissionWarning(message);
    console.warn(`[Main] Screen Recording capture probe failed during ${context}: ${errorMessage}`);
    return { status, capturable: false, effectiveDenied: true, sourceCount: 0, message, error: errorMessage };
  }
}

/**
 * Format a user-facing audio/permission message for the current platform.
 * macOS has TCC (Screen Recording, Microphone) panes under System Settings;
 * Windows has no equivalent for screen-capture (system audio loopback runs
 * via WASAPI without OS-level gating) and gates the microphone via
 * Settings → Privacy → Microphone. Reusing macOS copy on Windows is the
 * cross-contamination class behind issue #252.
 */
// Variants prefixed `mac-` are macOS-only and reference TCC / CoreAudio /
// ScreenCaptureKit concepts that don't exist on Windows. Call sites for those
// must themselves be gated behind `process.platform === 'darwin'` — the
// prefix makes that constraint visible during code review. Cross-platform
// variants have no prefix and branch internally on isMac.
type PermissionReason =
  | 'screen-recording-denied'
  | 'mac-screen-recording-restricted'
  | 'mac-screen-recording-revoked-rebuild'
  | 'mic-denied'
  | 'mic-zero-fill'
  | 'mac-same-device-input-output'
  | 'system-audio-stuck';
function formatPermissionMessage(reason: PermissionReason, extra?: { device?: string }): string {
  const isMac = process.platform === 'darwin';
  switch (reason) {
    case 'screen-recording-denied':
      return isMac
        ? 'Screen Recording permission denied. Interviewer audio will not be captured. Enable in System Settings → Privacy & Security → Screen Recording, then restart the app.'
        : 'System audio capture is unavailable. Interviewer audio will not be captured. Check your audio device routing in Settings and restart the meeting.';
    case 'mac-screen-recording-restricted':
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return 'Screen Recording is restricted by device policy. Interviewer audio will not be captured. Contact your administrator to allow screen capture for Natively.';
    case 'mac-screen-recording-revoked-rebuild':
      // Defense-in-depth: even though all call sites must be darwin-gated
      // (the `mac-` prefix marks this constraint), if a future contributor
      // calls this from a cross-platform path we degrade gracefully rather
      // than leak macOS UI strings to Windows users.
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return 'System audio is being captured but every sample is silent. This usually means macOS Screen Recording permission needs to be re-granted to this build of Natively. Open System Settings → Privacy & Security → Screen Recording, toggle Natively off and back on, then restart the app. (If you recently rebuilt or updated, the previous grant may not apply.)';
    case 'mic-denied':
      return isMac
        ? 'Microphone access denied. Please allow microphone access in System Settings → Privacy & Security → Microphone, then restart Natively.'
        : 'Microphone access denied. Please allow microphone access in Settings → Privacy → Microphone, then restart Natively.';
    case 'mic-zero-fill':
      return isMac
        ? 'Microphone is producing silent audio. Check that the device is unmuted and that macOS Microphone permission is granted to Natively in System Settings → Privacy & Security → Microphone.'
        : 'Microphone is producing silent audio. Check that the device is unmuted and that Natively has microphone access in Settings → Privacy → Microphone.';
    case 'mac-same-device-input-output':
      // Defense-in-depth: see comment on `mac-screen-recording-revoked-rebuild`.
      // The CoreAudio Process Tap same-device limitation is macOS-specific;
      // on Windows WASAPI loopback works fine on the same device as the mic.
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return `Silent capture detected — input and output are the same device (${extra?.device ?? 'unknown'}). macOS cannot tap a device while it is also the active microphone. Switch input to built-in mic or output to built-in speakers.`;
    case 'system-audio-stuck':
      return 'No audio detected on system output for 8s. If your meeting app is using a different output device (Bluetooth headset, virtual cable, second monitor), switch it to your default output, or restart the meeting after switching.';
  }
}

console.log = (...args: any[]) => {
  logToFile('[LOG] ' + redactArgsForLog(args));
  try {
    originalLog.apply(console, args);
  } catch { }
};

console.warn = (...args: any[]) => {
  logToFile('[WARN] ' + redactArgsForLog(args));
  try {
    originalWarn.apply(console, args);
  } catch { }
};

console.error = (...args: any[]) => {
  logToFile('[ERROR] ' + redactArgsForLog(args));
  try {
    originalError.apply(console, args);
  } catch { }
};

import { initializeIpcHandlers } from "./ipcHandlers"
import { WindowHelper } from "./WindowHelper"
import { SettingsWindowHelper } from "./SettingsWindowHelper"
import { ModelSelectorWindowHelper } from "./ModelSelectorWindowHelper"
import { CropperWindowHelper } from "./CropperWindowHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { KeybindManager } from "./services/KeybindManager"
import { ProcessingHelper } from "./ProcessingHelper"

import { IntelligenceManager } from "./IntelligenceManager"
import { SystemAudioCapture } from "./audio/SystemAudioCapture"
import { MicrophoneCapture } from "./audio/MicrophoneCapture"
import { AudioDevices } from "./audio/AudioDevices"
import { loadNativeModule } from "./audio/nativeModuleLoader"
import { GoogleSTT } from "./audio/GoogleSTT"
import { RestSTT } from "./audio/RestSTT"
import { DeepgramStreamingSTT } from "./audio/DeepgramStreamingSTT"
import { isIntelligenceFlagEnabled } from "./intelligence/intelligenceFlags"
import { SonioxStreamingSTT } from "./audio/SonioxStreamingSTT"
import { ElevenLabsStreamingSTT } from "./audio/ElevenLabsStreamingSTT"
import { OpenAIStreamingSTT } from "./audio/OpenAIStreamingSTT"
import { NativelyProSTT } from "./audio/NativelyProSTT"
import { ThemeManager } from "./ThemeManager"
import { RAGManager } from "./rag/RAGManager"
import { DatabaseManager } from "./db/DatabaseManager"
import { warmupIntentClassifier } from "./llm"

/** Unified type for all STT providers with optional extended capabilities */
type STTProvider = (GoogleSTT | RestSTT | DeepgramStreamingSTT | SonioxStreamingSTT | ElevenLabsStreamingSTT | OpenAIStreamingSTT | NativelyProSTT) & {
  finalize?: () => void;
  setAudioChannelCount?: (count: number) => void;
  notifySpeechEnded?: () => void;
};

type ScreenshotWindowMode = 'launcher' | 'overlay';

/** Payload for stt-status IPC events broadcast from main to renderer */
interface SttStatusPayload {
  // 'awaiting-audio' (B2) is the post-meeting-start / pre-verified-audio state:
  // STT WS may be connected but no isFinal transcript has arrived yet, so we
  // cannot honestly claim 'connected' in the UI. Renderers should display this
  // as a neutral "Listening for audio…" indicator, NOT green/active.
  state: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio';
  provider: string;
  error?: string;
  channel: 'user' | 'interviewer';
  reconnectAttempts?: number;
}

export interface LocalWhisperRecoveryNotice {
  recovered: true;
  badModelId: string;
  fallbackModelId: string;
  message: string;
}

/** Family-keyed recovery notice for the generalized ONNX load sentinel.
 *  Each `family` corresponds to one of the local model consumers wired to
 *  `electron/utils/onnxLoadSentinel.ts`. Renderer pulls via the
 *  `onnx-get-recovery-notice` IPC, one-shot drained through AppState. */
export type OnnxRecoveryFamily = 'whisper' | 'intent' | 'embeddings' | 'reranker';
export interface OnnxRecoveryNotice {
  family: OnnxRecoveryFamily;
  badModelId: string;
  message: string;
}

type ScreenshotCaptureKind = 'full' | 'selective';

interface ScreenshotCaptureSession {
  captureKind: ScreenshotCaptureKind;
  wasMainWindowVisible: boolean;
  windowMode: ScreenshotWindowMode;
  wasSettingsVisible: boolean;
  wasModelSelectorVisible: boolean;
  overlayBounds: Electron.Rectangle | null;
  overlayDisplayId: number | null;
  restoreWithoutFocus: boolean;
}

// Premium: Knowledge modules loaded conditionally
let KnowledgeOrchestratorClass: any = null;
let KnowledgeDatabaseManagerClass: any = null;
// Phase 1: shared comp-evidence detector for transcript-aware intent routing.
let textHasCompEvidence: ((text: string) => boolean) | null = null;
try {
    KnowledgeOrchestratorClass = require('../premium/electron/knowledge/KnowledgeOrchestrator').KnowledgeOrchestrator;
    KnowledgeDatabaseManagerClass = require('../premium/electron/knowledge/KnowledgeDatabaseManager').KnowledgeDatabaseManager;
    textHasCompEvidence = require('../premium/electron/knowledge/NegotiationConversationTracker').textHasCompEvidence;
} catch {
    console.log('[Main] Knowledge modules not available — profile intelligence disabled.');
}

import { CredentialsManager } from "./services/CredentialsManager"
import { SettingsManager } from "./services/SettingsManager"
import { PhoneMirrorService } from "./services/PhoneMirrorService"
import { setVerboseLoggingFlag } from "./verboseLog"
import { ReleaseNotesManager } from "./update/ReleaseNotesManager"
import { OllamaManager } from './services/OllamaManager'
import { ProviderStatusRegistry } from './services/ProviderStatusRegistry'
import { decideToggle, decideDockTransition } from './services/toggleStateReducer'
import { NativeOomTrace } from './utils/NativeOomTrace'

// Opt-in only: this trace writes allowlisted process metadata and IPC byte estimates
// for a copied-profile native OOM investigation. It is inert unless explicitly enabled.
const nativeOomTrace = new NativeOomTrace()

// Valid disguise modes. The persisted setting is untyped on disk and historical
// builds wrote values that are no longer part of the union (e.g. 'service'),
// which then match NO case in _applyDisguise() — leaving the dock app with no
// icon/name set (the "Disguise icon not found:" empty-path warning) while the
// window falls back to the terminal icon. That identity mismatch reads as an
// extra/duplicate dock tile. Coerce any out-of-union value to 'none' on load
// and at the runtime entry point so app, dock, and window always agree.
type DisguiseMode = 'terminal' | 'settings' | 'activity' | 'none'
const VALID_DISGUISE_MODES: readonly DisguiseMode[] = ['terminal', 'settings', 'activity', 'none'] as const
function normalizeDisguiseMode(value: unknown): DisguiseMode {
  return (VALID_DISGUISE_MODES as readonly string[]).includes(value as string)
    ? (value as DisguiseMode)
    : 'none'
}

export class AppState {
  private static instance: AppState | null = null

  private windowHelper: WindowHelper
  public settingsWindowHelper: SettingsWindowHelper
  public modelSelectorWindowHelper: ModelSelectorWindowHelper
  public cropperWindowHelper: CropperWindowHelper
  private screenshotHelper: ScreenshotHelper
  public processingHelper: ProcessingHelper

  private intelligenceManager: IntelligenceManager
  private themeManager: ThemeManager
  private ragManager: RAGManager | null = null
  private modeReferenceRetryPromise: Promise<void> | null = null
  private stabilityHeartbeatTimer: NodeJS.Timeout | null = null
  // Diagnostic-only, independently paced native-memory sampler. Normal product
  // heartbeats remain at 30 seconds; this exists only for a short-lived OOM run.
  private nativeOomTraceTimer: NodeJS.Timeout | null = null
  private knowledgeOrchestrator: any = null

  public recordNativeOomTrace(event: string, data: Record<string, unknown> = {}): void {
    nativeOomTrace.record(event, data)
  }

  public recordNativeOomOutboundIpc(webContentsId: number, channel: string, args: unknown[]): void {
    nativeOomTrace.recordOutboundIpc(webContentsId, channel, args)
  }

  public armNativeOomContentTrace(launcherPid: number): void {
    nativeOomTrace.armContentTrace(launcherPid)
  }

  public stopNativeOomContentTrace(reason: string): void {
    void nativeOomTrace.stopContentTrace(reason)
  }

  private tray: Tray | null = null
  private updateAvailable: boolean = false
  private updateDownloadState: 'idle' | 'available' | 'downloading' | 'downloaded' = 'idle'
  private updateDownloadPromise: Promise<unknown> | null = null
  private downloadedUpdateInfo: any = null
  private disguiseMode: 'terminal' | 'settings' | 'activity' | 'none' = 'none'

  // View management
  private view: "queue" | "solutions" = "queue"
  private isUndetectable: boolean = false

  private problemInfo: {
    problem_statement: string
    input_format: Record<string, any>
    output_format: Record<string, any>
    constraints: Array<Record<string, any>>
    test_cases: Array<Record<string, any>>
  } | null = null // Allow null

  private hasDebugged: boolean = false
  private isMeetingActive: boolean = false; // Guard for session state leaks
  private _meetingGeneration = 0;
  private _audioInitPromise: Promise<void> | null = null;
  // AbortController handle for the in-flight startMeeting() audio init, so endMeeting()
  // can cancel it (signal.aborted short-circuits the init's isCurrentMeeting() guards)
  // and await its completion before tearing down captures — preventing a fresh capture
  // from being constructed/started AFTER teardown (dangling native handle / HAL freeze).
  private _audioInitController: AbortController | null = null;
  // Re-entry guard for endMeeting(): set true across the early `await _audioInitPromise`
  // (which yields the event loop before `_pendingTeardown` exists), so a second Stop
  // click during that window can't double-run the teardown and truncate trailing finals.
  private _endMeetingInFlight = false;
  // True between Stop click and the end of STT drain. The transcript handler
  // (and only the transcript handler) treats `isMeetingActive || _isDraining`
  // as "accept trailing finals" — every other call site looks at
  // `isMeetingActive` alone, which flips to false synchronously on Stop so the
  // launcher's "Meeting ongoing" pill switches back to "Start Natively" the
  // instant the user clicks Stop, with no 250 ms green-→-blue stutter.
  private _isDraining: boolean = false;
  // Tracks remembered output device so reconfigureAudio can no-op when nothing changed.
  // Mirrors the existing _lastRequestedInputDeviceId for the input side.
  private _lastRequestedOutputDeviceId: string | undefined = undefined;
  // Promise representing in-flight endMeeting background teardown (STT.stop +
  // intelligenceManager.stopMeeting + RAG cleanup). startMeeting() awaits this
  // before booting a new session so the shared STT instances are not torn down
  // mid-meeting by a stale teardown task.
  private _pendingTeardown: Promise<void> | null = null;
  // Tracks meeting IDs currently being processed by processCompletedMeetingForRAG.
  // Without this guard, a rapid stop→start→stop cycle could enqueue the same
  // meeting for RAG twice (e.g. recovery retry + normal completion), duplicating
  // embedding work, slowing the meeting-end perceived latency, and racing the
  // SQLite INSERT OR IGNORE that protects against duplicates.
  private _ragProcessingInFlight: Set<string> = new Set();
  private _isQuitting: boolean = false;
  private _verboseLogging: boolean = false;
  // Tracks whether STT sample-rate has been applied for the current capture
  // session. Reset on every reconfigureAudio / new pipeline build so the next
  // first-chunk handler reads the freshly-detected native rate.
  private _sysSttRateApplied: boolean = false;
  private _micSttRateApplied: boolean = false;
  // Per-speaker throttle for the display-only `native-audio-transcript` IPC.
  // Finals are sent immediately; partials coalesce to latest-wins within
  // PARTIAL_TRANSCRIPT_THROTTLE_MS so a fast STT (e.g. OpenAI per-delta partials)
  // can't flood both windows with near-per-token IPC during a long meeting
  // (audit finding #7). The answer path (intelligenceManager.handleTranscript /
  // RAG feed) runs BEFORE this send and is unaffected — this only paces the
  // renderer's rolling transcript bar, which renders the latest preview anyway.
  private static readonly PARTIAL_TRANSCRIPT_THROTTLE_MS = 100;
  private _transcriptPartialThrottle = new Map<string, {
    timer: ReturnType<typeof setTimeout> | null;
    pending: { speaker: string; text: string; timestamp: number; final: boolean; confidence: number } | null;
  }>();
  private _disguiseTimers: NodeJS.Timeout[] = []; // Track forceUpdate timeouts
  private _dockDebounceTimer: NodeJS.Timeout | null = null; // Debounce dock state changes
  private _dockReassertTimers: NodeJS.Timeout[] = []; // Self-verifying dock-enforcement retry timers
  private _ollamaBootstrapPromise: Promise<void> | null = null;
  private screenshotCaptureInProgress: boolean = false;
  private localWhisperRecoveryNotice: LocalWhisperRecoveryNotice | null = null;
  // Family-keyed stash for the generalized ONNX load-sentinel recovery
  // notices (intent / embeddings / reranker). Whisper keeps its dedicated
  // channel for backward-compat with the shipped renderer banner.
  private onnxRecoveryNotices: Partial<Record<OnnxRecoveryFamily, OnnxRecoveryNotice>> = {};


  // Processing events
  public readonly PROCESSING_EVENTS = {
    //global states
    UNAUTHORIZED: "procesing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",

    //states for generating the initial solution
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",

    //states for processing the debugging
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error"
  } as const

  constructor() {
    // 1. Load boot-critical settings first (used by WindowHelpers)
    const settingsManager = SettingsManager.getInstance();
    this.isUndetectable = settingsManager.get('isUndetectable') ?? false;
    this.disguiseMode = normalizeDisguiseMode(settingsManager.get('disguiseMode'));
    this._verboseLogging = settingsManager.get('verboseLogging') ?? true;
    setVerboseLoggingFlag(this._verboseLogging);
    console.log(`[AppState] Initialized with isUndetectable=${this.isUndetectable}, disguiseMode=${this.disguiseMode}, verboseLogging=${this._verboseLogging}`);

    // 2. Initialize Helpers with loaded state
    this.windowHelper = new WindowHelper(this)
    this.settingsWindowHelper = new SettingsWindowHelper()
    this.modelSelectorWindowHelper = new ModelSelectorWindowHelper()
    this.cropperWindowHelper = new CropperWindowHelper()

    // 3. Initialize other helpers
    this.screenshotHelper = new ScreenshotHelper(this.view)
    this.processingHelper = new ProcessingHelper(this)

    this.windowHelper.setContentProtection(this.isUndetectable);
    this.settingsWindowHelper.setContentProtection(this.isUndetectable);
    this.modelSelectorWindowHelper.setContentProtection(this.isUndetectable);
    this.cropperWindowHelper.setContentProtection(this.isUndetectable);

    if (process.platform === 'win32' || process.platform === 'darwin') {
      this.cropperWindowHelper.preload();
    }

    // Warm the local Whisper worker in the background so the first recording
    // session starts instantly instead of waiting for model load from disk.
    // Only fires if local-whisper is selected AND a model is already cached.
    setImmediate(() => {
      try {
        const { CredentialsManager } = require('./services/CredentialsManager');
        if (CredentialsManager.getInstance().getSttProvider() === 'local-whisper') {
          const { isModelCached, MODEL_CATALOG_IDS } = require('./audio/whisper/modelManager');
          const { modelPreloader } = require('./audio/whisper/modelPreloader');
          const { resolveInferenceConfig } = require('./audio/whisper/inferenceConfig');
          // Startup validation gate: if the persisted modelId isn't in the
          // catalog (corrupted settings, model retired, fork diverged), reset
          // to the safest fallback BEFORE preload — otherwise the worker
          // crashes on init with a confusing "model not found" and the user
          // is locked out of audio until they manually clear settings.
          //
          // Also consume the Whisper load sentinel before validation/preload. If
          // it exists, the previous process died while loading that model natively
          // (before JS error handlers could persist a cooldown). Reset any
          // matching selection headlessly so one bad ONNX model cannot brick
          // startup.
          //
          // Validate BOTH the global setting AND the per-channel overrides
          // (when per-channel mode is enabled). Per-channel validation runs
          // here because the per-channel id is read at meeting-start time
          // (main.ts:1721-1726), not at this preload block — leaving it
          // un-validated here means a corrupt per-channel id would still
          // crash the meeting even though the global gate passes.
          const FALLBACK = 'Xenova/whisper-tiny.en';
          const poisoned = modelPreloader.consumePoisonedLoadSentinel?.();
          if (poisoned?.modelId) {
            let resetAny = false;
            for (const key of ['localWhisperModel', 'localWhisperModelMic', 'localWhisperModelSystem'] as const) {
              if (settingsManager.get(key) === poisoned.modelId) {
                settingsManager.set(key, FALLBACK);
                resetAny = true;
              }
            }
            if (resetAny) {
              const message = `Recovered from a local transcription model crash. Reset ${poisoned.modelId} to ${FALLBACK}.`;
              console.warn(`[AppState] ${message}`);
              this.setLocalWhisperRecoveryNotice({
                recovered: true,
                badModelId: poisoned.modelId,
                fallbackModelId: FALLBACK,
                message,
              });
            } else {
              console.warn(`[AppState] Previous local Whisper load for ${poisoned.modelId} did not finish cleanly; current settings no longer reference it.`);
            }
          }
          const rawModelId = settingsManager.get('localWhisperModel') ?? FALLBACK;
          const modelId = MODEL_CATALOG_IDS.has(rawModelId) ? rawModelId : FALLBACK;
          if (modelId !== rawModelId) {
            console.warn(`[AppState] Persisted localWhisperModel "${rawModelId}" not in catalog — resetting to ${modelId}`);
            settingsManager.set('localWhisperModel', modelId);
          }
          if (settingsManager.get('localWhisperPerChannelEnabled')) {
            for (const key of ['localWhisperModelMic', 'localWhisperModelSystem'] as const) {
              const raw = settingsManager.get(key);
              if (raw && !MODEL_CATALOG_IDS.has(raw)) {
                console.warn(`[AppState] Persisted ${key} "${raw}" not in catalog — resetting to ${FALLBACK}`);
                settingsManager.set(key, FALLBACK);
              }
            }
          }
          const { dtype } = resolveInferenceConfig();

          // Collect every model ID the user has selected (global + per-channel)
          // so we can auto-repair each one that's missing or corrupt.
          const modelIds = new Set<string>([modelId]);
          if (settingsManager.get('localWhisperPerChannelEnabled')) {
            const mic = settingsManager.get('localWhisperModelMic');
            const sys = settingsManager.get('localWhisperModelSystem');
            if (mic && MODEL_CATALOG_IDS.has(mic)) modelIds.add(mic);
            if (sys && MODEL_CATALOG_IDS.has(sys)) modelIds.add(sys);
          }

          // Which model to warm: mic-channel > global (mic is the user's own
          // voice — most latency-critical). The preloader is single-slot so we
          // pick the highest-priority cached candidate.
          const micOverride = settingsManager.get('localWhisperPerChannelEnabled')
            ? (settingsManager.get('localWhisperModelMic') ?? '')
            : '';
          const preloadPriority = [
            micOverride && MODEL_CATALOG_IDS.has(micOverride) ? micOverride : '',
            modelId,
          ].filter(Boolean);
          const primaryPreloadId = preloadPriority.find(id => isModelCached(id, dtype)) ?? '';

          const { LocalModelDownloadService } = require('./services/LocalModelDownloadService');
          for (const id of modelIds) {
            if (isModelCached(id, dtype)) {
              if (id === primaryPreloadId) {
                console.log(`[AppState] Preloading local Whisper model: ${id}`);
                modelPreloader.preload(id);
              }
            } else {
              // Files are missing or corrupt — auto-download in the background
              // so the user doesn't have to open Settings and click Download.
              console.log(`[AppState] Local Whisper model "${id}" not cached — starting background download`);
              try {
                const result = LocalModelDownloadService.getInstance().start('whisper', id);
                if (!result.success && !result.alreadyDownloading) {
                  console.warn(`[AppState] Auto-download for "${id}" rejected:`, result.error);
                }
              } catch (dlErr: any) {
                console.warn(`[AppState] Auto-download for "${id}" failed to start:`, dlErr?.message);
              }
            }
          }
        }
      } catch (e) {
        // Non-fatal — recording still works, just with a cold-start delay
        console.warn('[AppState] Local Whisper preload skipped:', e);
      }
    });

    // Generalized ONNX load-sentinel consume (intent / embeddings / reranker).
    // Runs UNCONDITIONALLY — these families are loaded on demand and a poisoned
    // disk sentinel must be consumed regardless of the user's STT selection.
    // Each consumer seeds its own in-memory poison flag so the first call
    // (warmup, embed, rerank) fast-fails and the user sees a degraded
    // experience instead of a crashloop.
    setImmediate(() => {
      try {
        const { consumeIntentClassifierSentinel } = require('./llm/IntentClassifier');
        const { consumeLocalEmbeddingSentinel } = require('./rag/providers/LocalEmbeddingProvider');
        const { consumeLocalRerankerSentinel } = require('./rag/LocalReranker');

        const intentPoisoned = consumeIntentClassifierSentinel();
        if (intentPoisoned) {
          const message = `Recovered from an intent classifier crash. ${intentPoisoned.modelId} is skipped this launch — falling back to regex/heuristic intent.`;
          console.warn(`[AppState] ${message}`);
          this.setOnnxRecoveryNotice('intent', {
            family: 'intent',
            badModelId: intentPoisoned.modelId,
            message,
          });
        }

        const embeddingPoisoned = consumeLocalEmbeddingSentinel();
        if (embeddingPoisoned) {
          const message = `Recovered from a local embedding crash. ${embeddingPoisoned.modelId} is skipped this launch — retrieval falls back to lexical.`;
          console.warn(`[AppState] ${message}`);
          this.setOnnxRecoveryNotice('embeddings', {
            family: 'embeddings',
            badModelId: embeddingPoisoned.modelId,
            message,
          });
        }

        const rerankerPoisoned = consumeLocalRerankerSentinel();
        if (rerankerPoisoned) {
          const message = `Recovered from a local reranker crash. ${rerankerPoisoned.modelId} is skipped this launch — retrieval falls back to cosine top-K.`;
          console.warn(`[AppState] ${message}`);
          this.setOnnxRecoveryNotice('reranker', {
            family: 'reranker',
            badModelId: rerankerPoisoned.modelId,
            message,
          });
        }
      } catch (e: any) {
        // Non-fatal — a missing or broken consume helper must never brick startup.
        console.warn('[AppState] ONNX sentinel consume skipped (non-fatal):', e?.message || e);
      }
    });

    // Initialize KeybindManager
    const keybindManager = KeybindManager.getInstance();
    keybindManager.setWindowHelper(this.windowHelper);
    keybindManager.setupIpcHandlers();
    keybindManager.onUpdate(() => {
      this.updateTrayMenu();
    });

    // Stealth keyboard tap (CGEventTap) IPC. Renderer drives the permission
    // flow + queries availability/state; the tap itself is toggled by the
    // global shortcut handler above. Only registered on macOS — on other
    // platforms these handlers no-op so the renderer can render fallback UI.
    //
    // removeHandler-then-handle on each channel is defensive against a
    // second `app.ready` firing (rare but possible during dev HMR / single-
    // instance second-launch path) — `ipcMain.handle` throws on duplicate
    // registration, which would propagate as a renderer IPC rejection and
    // silently leave isCgEventTapAvailableRef at its safe-false default.
    const registerStealthHandler = (channel: string, fn: (...args: any[]) => any) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, fn);
    };
    registerStealthHandler('get-system-audio-permission-warning', () => latestSystemAudioPermissionWarning);
    if (process.platform === 'darwin') {
      const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
      const stealth = StealthKeyboardManager.getInstance();
      registerStealthHandler('stealth-tap:available', () => stealth.isAvailable());
      registerStealthHandler('stealth-tap:open-settings', () => { stealth.openSettings(); });
      registerStealthHandler('stealth-tap:stop', () => { stealth.stop(); });
      registerStealthHandler('stealth-tap:start', () => stealth.start());
      // IME users (Pinyin, Hangul, Kanji, …) cannot compose under the tap
      // because CGEventTap fires below TIS. Renderer consults this before
      // click-to-engage so it can fall back to plain DOM focus when an IME
      // is in play. See electron/services/ImeDetector.ts for the rationale.
      registerStealthHandler('stealth-tap:should-auto-engage', () => {
        const { shouldAutoEngageStealthTap } = require('./services/ImeDetector');
        return shouldAutoEngageStealthTap();
      });
      // Force a fresh IME probe and return the refined value. Renderer calls
      // this on window focus so users who add a Pinyin/Hangul source mid-
      // session don't silently break CJK composition the next time the tap
      // would auto-engage (the cached value from mount-time would be stale).
      registerStealthHandler('stealth-tap:refresh-ime', () => {
        const { refreshImeDetection, shouldAutoEngageStealthTap } = require('./services/ImeDetector');
        refreshImeDetection();
        return shouldAutoEngageStealthTap();
      });
    } else {
      registerStealthHandler('stealth-tap:available', () => false);
      registerStealthHandler('stealth-tap:open-settings', () => {});
      registerStealthHandler('stealth-tap:stop', () => {});
      registerStealthHandler('stealth-tap:start', () => false);
      // Non-darwin: returns true so the renderer's stealthAutoEngageOkRef
      // stays true and the explicit isCgEventTapAvailableRef guard (added in
      // PR #250) is what actually gates blockInputFocus. Inverted relative
      // to availability on purpose — see ImeDetector.ts:67.
      registerStealthHandler('stealth-tap:should-auto-engage', () => true);
      registerStealthHandler('stealth-tap:refresh-ime', () => true);
    }

    keybindManager.onShortcutTriggered(async (actionId) => {
      console.log(`[Main] Global shortcut triggered: ${actionId}`);
      try {
        if (actionId === 'general:toggle-visibility') {
          this.toggleMainWindow();
        } else if (actionId === 'general:toggle-mouse-passthrough') {
          // Adapted from public PR #113 — verify premium interaction
          this.toggleOverlayMousePassthrough();
        } else if (actionId === 'general:take-screenshot') {
          // Route to renderer via global-shortcut so the renderer handles the
          // screenshot through the IPC invoke path (request/response guarantee).
          // The old pattern — main takes screenshot → fires screenshot-taken event →
          // renderer listener catches it — was unreliable in overlay mode because the
          // fire-and-forget event could be missed if the listener registration had any
          // timing gap. The invoke path used by generalHandlers.takeScreenshot() is
          // already proven to work for UI-button screenshots; reuse it here.
          const mainWindow = this.getMainWindow();
          this.sendToWindow(mainWindow, 'global-shortcut', { action: 'takeScreenshot' });
        } else if (actionId === 'general:selective-screenshot') {
          const mainWindow = this.getMainWindow();
          this.sendToWindow(mainWindow, 'global-shortcut', { action: 'selectiveScreenshot' });
        } else if (actionId === 'general:capture-and-process') {
          // Single-trigger: capture current screen then immediately request AI analysis
          await this.captureScreenAndProcess();

        } else if (actionId === 'general:capture-dom') {
          // One hotkey, the right capture: if the companion browser extension is
          // connected, ask it to grab the active tab's page context (delivered to
          // the overlay via /dom). If it isn't reachable — not in a browser, SW
          // asleep, Phone Mirror off — fall back to a screenshot automatically so
          // the gesture always does something. See natively-browser/README.md.
          let captured = false;
          try {
            const svc = PhoneMirrorService.getInstance();
            // MV3 race fix: the extension's service worker may have been idle-killed
            // and is only just reconnecting (its wake-on-interaction handlers fire as
            // the user touches the browser right before capturing). Poll briefly for
            // an extension to connect before deciding — otherwise a just-woken SW
            // would fall straight through to a screenshot. waitForExtension resolves
            // immediately when one is already connected.
            const extReady = svc.isRunning() && (await svc.waitForExtension());
            if (extReady) {
              const result = await svc.requestDomCapture();
              captured = result.ok;
              if (captured) {
                // The extension only acks `done` after /dom returns 200, so by here
                // the overlay has already received the page context (it surfaces a
                // "Page context" pill and uses it on the next answer).
                console.log('[Main] DOM capture delivered to overlay');
              } else {
                console.log('[Main] DOM capture unavailable (', result.reason, ') — falling back to screenshot');
              }
            }
          } catch (e: any) {
            console.warn('[Main] DOM capture error — falling back to screenshot:', e?.message || e);
          }
          if (!captured) {
            await this.captureScreenAndProcess();
          }

        // --- STEALTH SHORTCUTS: no focus, no show, pure IPC dispatch ---

        // Chat actions — fire into the renderer without focusing the window
        } else if (actionId === 'chat:focusInput') {
          // Toggle CGEventTap-backed stealth typing mode. While engaged, every
          // keystroke is captured at the OS event-pipeline layer and routed to
          // the renderer; the foreground app (Zoom/browser/etc.) does NOT
          // receive any key events and never loses key/frontmost status. This
          // is the only path that delivers true Cluely-grade undetectability
          // on macOS — NSPanel-nonactivating gets us 90% there, the tap closes
          // the remaining gap (the panel never even has to become key-window).
          //
          // Falls back to plain panel.focus() if the native tap is unavailable
          // (no rebuild yet, no Accessibility permission, or non-macOS).
          this.showMainWindow(true);
          const overlay = this.windowHelper.getOverlayWindow();
          this.sendToWindow(overlay, 'ensure-expanded');

          if (process.platform === 'darwin') {
            const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
            const mgr = StealthKeyboardManager.getInstance();
            if (mgr.isAvailable()) {
              mgr.toggle();
              return; // tap is the input path; no need to focus the panel
            }
          }

          // Fallback: panel-safe focus on macOS without tap, brief focus on Win.
          if (overlay && !overlay.isDestroyed()) {
            this.sendToWindow(overlay, 'global-shortcut', { action: 'focusInput' });
            overlay.focus();
          }
        } else if (
          actionId === 'chat:whatToAnswer' ||
          actionId === 'chat:clarify' ||
          actionId === 'chat:followUp' ||
          actionId === 'chat:answer' ||
          actionId === 'chat:codeHint' ||
          actionId === 'chat:brainstorm' ||
          actionId === 'chat:dynamicAction4' ||
          actionId === 'chat:scrollUp' ||
          actionId === 'chat:scrollDown' ||
          actionId === 'chat:scrollLeft' ||
          actionId === 'chat:scrollRight'
        ) {
          const actionMap: Record<string, string> = {
            'chat:whatToAnswer': 'whatToAnswer',
            'chat:clarify': 'clarify',
            'chat:followUp': 'followUp',
            'chat:answer': 'answer',
            'chat:codeHint': 'codeHint',
            'chat:brainstorm': 'brainstorm',
            'chat:dynamicAction4': 'dynamicAction4',
            'chat:scrollUp': 'scrollUp',
            'chat:scrollDown': 'scrollDown',
            'chat:scrollLeft': 'scrollLeft',
            'chat:scrollRight': 'scrollRight',
          };
          const action = actionMap[actionId];
          this.sendToMeetingSurfaces('global-shortcut', { action });

        // Window movement — move window position without focus change
        } else if (actionId === 'window:move-up') {
          this.windowHelper.moveWindowUp();
        } else if (actionId === 'window:move-down') {
          this.windowHelper.moveWindowDown();
        } else if (actionId === 'window:move-left') {
          this.windowHelper.moveWindowLeft();
        } else if (actionId === 'window:move-right') {
          this.windowHelper.moveWindowRight();

        // General actions that are now global (stealth)
        } else if (actionId === 'general:process-screenshots') {
          this.sendToMeetingSurfaces('global-shortcut', { action: 'processScreenshots' });
        } else if (actionId === 'general:reset-cancel') {
          this.sendToMeetingSurfaces('global-shortcut', { action: 'resetCancel' });
        }
      } catch (e: any) {
        if (e.message !== "Selection cancelled" && e.message !== "Screenshot capture already in progress") {
          console.error(`[Main] Error handling global shortcut ${actionId}:`, e);
        }
      }
    });

    // Inject WindowHelper into other helpers
    this.settingsWindowHelper.setWindowHelper(this.windowHelper);
    this.modelSelectorWindowHelper.setWindowHelper(this.windowHelper);





    // Initialize IntelligenceManager with LLMHelper
    this.intelligenceManager = new IntelligenceManager(this.processingHelper.getLLMHelper())

    // Initialize ThemeManager
    this.themeManager = ThemeManager.getInstance()

    // Restore toggle states that live in LLMHelper memory.
    // This MUST happen here — not inside initializeRAGManager() — so that
    // it runs unconditionally regardless of whether premium modules are available.
    // Previously, groqFastTextMode restore was inside the KnowledgeOrchestrator
    // block which silently skips when premium modules are absent.
    {
      const llmHelper = this.processingHelper.getLLMHelper();
      if (settingsManager.get('groqFastTextMode')) {
        llmHelper.setGroqFastTextMode(true);
        console.log('[AppState] Fast mode restored from settings');
      }
      llmHelper.setCodexCliConfig({
        enabled: !!settingsManager.get('codexCliEnabled'),
        path: settingsManager.get('codexCliPath') || 'codex',
        model: settingsManager.get('codexCliModel') || 'gpt-5.4',
        fastModel: settingsManager.get('codexCliFastModel') || 'gpt-5.3-codex-spark',
        timeoutMs: settingsManager.get('codexCliTimeoutMs') || 60_000,
        sandboxMode: settingsManager.get('codexCliSandboxMode') || 'read-only',
        serviceTier: settingsManager.get('codexCliServiceTier') || 'default',
        modelReasoningEffort: settingsManager.get('codexCliModelReasoningEffort'),
      });
      // Restore custom notes and persona for non-premium path
      try {
        const savedNotes = DatabaseManager.getInstance().getCustomNotes();
        if (savedNotes) {
          llmHelper.setCustomNotes(savedNotes);
        }
        const savedPersona = DatabaseManager.getInstance().getPersona();
        if (savedPersona) {
          llmHelper.setPersonaPrompt(savedPersona);
        }
      } catch (_) {}
    }

    // Initialize RAGManager (requires database to be ready)
    this.initializeRAGManager()

    // Check and prep Ollama embedding model
    this.bootstrapOllamaEmbeddings()

    // Prime the optional Hindsight long-term-memory server health cache (settings/env
    // config; Noop when unconfigured). Fire-and-forget — never blocks startup.
    try {
      const { HindsightManager } = require('./services/HindsightManager');
      HindsightManager.getInstance().start().catch(() => { /* never blocks startup */ });
    } catch { /* optional */ }

    this.setupIntelligenceEvents()

    ProviderStatusRegistry.getInstance().setBroadcaster((channel, payload) => {
      this.broadcast(channel, payload);
    });

    // Intent-classifier warmup is scheduled after the launcher is visible so
    // transformers/ONNX initialization cannot contend with the first paint.

    // Setup Ollama IPC
    this.setupOllamaIpcHandlers()

    // --- NEW SYSTEM AUDIO PIPELINE (SOX + NODE GOOGLE STT) ---
    // LAZY INIT: Do not setup pipeline here to prevent launch volume surge.
    // this.setupSystemAudioPipeline()

    // Initialize Auto-Updater
    this.setupAutoUpdater()

    this.startStabilityHeartbeat();
    this.startNativeOomTraceSampling();
  }

  private startStabilityHeartbeat(): void {
    if (this.stabilityHeartbeatTimer) return;
    const emit = () => {
      try {
        const mem = process.memoryUsage();
        const flags = {
          ragConfidenceGate: isIntelligenceFlagEnabled('ragConfidenceGate'),
          ragLocalRerank: isIntelligenceFlagEnabled('ragLocalRerank'),
          ragSpeculativeRerank: isIntelligenceFlagEnabled('ragSpeculativeRerank'),
          okfKnowledgePacks: isIntelligenceFlagEnabled('okfKnowledgePacks'),
          okfHybridRetrieval: isIntelligenceFlagEnabled('okfHybridRetrieval'),
          jitFinalAnswerEnforced: isIntelligenceFlagEnabled('jitFinalAnswerEnforced'),
          hindsightMemory: isIntelligenceFlagEnabled('hindsightMemory'),
        };
        // PER-PROCESS memory breakdown (2026-07-10 leak diagnosis): the
        // main-process RSS above cannot tell us WHICH process is growing.
        // app.getAppMetrics() reports RSS per Chromium process (Browser=main,
        // GPU, Tab=renderer, Utility). This makes a native RSS climb
        // attributable: if the GPU process is the one ballooning on Windows,
        // the "Browser"/main RSS and the "GPU" RSS diverge here. Guarded so a
        // failure never breaks the heartbeat.
        let procMem: Array<{ type: string; rssMB: number; pid: number; win?: string }> = [];
        try {
          const { app: eApp, BrowserWindow, webContents } = require('electron');
          // Build a pid → window-label map so a leaking "Tab" (renderer) is
          // attributable to a SPECIFIC window (launcher / overlay / cropper /
          // settings / model-selector). getAppMetrics() only reports the process
          // TYPE + pid, not which renderer it is — so on the Windows repro we
          // couldn't tell WHICH renderer ballooned. Match each live webContents'
          // OS process id to its window URL's ?window= param.
          const pidToWin: Record<number, string> = {};
          try {
            for (const wc of (webContents?.getAllWebContents?.() || [])) {
              try {
                if (wc.isDestroyed?.()) continue;
                const ospid = wc.getOSProcessId?.();
                if (!ospid) continue;
                const url = wc.getURL?.() || '';
                const m = /[?&]window=([a-z-]+)/.exec(url);
                let label = m ? m[1] : (url.includes('index.html') || url.includes('localhost') ? 'launcher?' : 'renderer');
                // Devtools / about:blank helpers
                if (url.startsWith('devtools://')) label = 'devtools';
                pidToWin[ospid] = pidToWin[ospid] ? `${pidToWin[ospid]}+${label}` : label;
              } catch { /* per-wc best effort */ }
            }
          } catch { /* webContents enumeration best effort */ }
          procMem = (eApp.getAppMetrics?.() || [])
            .map((m: any) => ({
              type: m.type,
              rssMB: m.memory?.workingSetSize ? Math.round(m.memory.workingSetSize / 1024) : 0, // KB→MB
              pid: m.pid,
              ...(pidToWin[m.pid] ? { win: pidToWin[m.pid] } : {}),
            }))
            .sort((a: any, b: any) => b.rssMB - a.rssMB);
        } catch { /* getAppMetrics unavailable pre-ready — skip */ }

        this.sampleNativeOomTrace(mem);

        console.log('[StabilityHeartbeat]', {
          rssMB: mb(mem.rss),
          heapUsedMB: mb(mem.heapUsed),
          heapTotalMB: mb(mem.heapTotal),
          externalMB: mb(mem.external),
          arrayBuffersMB: mb(mem.arrayBuffers),
          freeMemMB: mb(os.freemem()),
          totalMemMB: mb(os.totalmem()),
          uptimeSec: Math.round(process.uptime()),
          isMeetingActive: this.isMeetingActive,
          flags,
          wal: collectWalSnapshot(),
          // Per-process working-set RSS (MB) — the leak-attribution field.
          procMem,
          testHooks: {
            gpuDisabled: process.env.NATIVELY_DISABLE_GPU === '1',
            sttPrewarmDisabled: process.env.NATIVELY_DISABLE_STT_PREWARM === '1',
            onnxFloorGB: process.env.NATIVELY_ONNX_MIN_FREE_GB || null,
          },
        });
      } catch (e: any) {
        console.warn('[StabilityHeartbeat] skipped:', e?.message || e);
      }
    };
    setTimeout(emit, 10_000).unref?.();
    this.stabilityHeartbeatTimer = setInterval(emit, 30_000);
    this.stabilityHeartbeatTimer.unref?.();
  }

  private sampleNativeOomTrace(memory = process.memoryUsage()): void {
    if (!nativeOomTrace.isEnabled()) return;
    nativeOomTrace.sample(
      memory,
      (() => {
        try {
          return (app.getAppMetrics?.() || []) as unknown as Array<Record<string, unknown>>;
        } catch {
          return [];
        }
      })(),
      (() => {
        const launcher = this.windowHelper?.getLauncherWindow?.();
        if (!launcher || launcher.isDestroyed()) return undefined;
        const pid = launcher.webContents.getOSProcessId();
        return pid > 0 ? { webContentsId: launcher.webContents.id, pid } : undefined;
      })(),
      { freeMemory: os.freemem(), totalMemory: os.totalmem() },
    );
  }

  private startNativeOomTraceSampling(): void {
    if (!nativeOomTrace.isEnabled() || this.nativeOomTraceTimer) return;
    // A prior incident rose from 497 MB to more than 2 GB in roughly four
    // seconds; the ordinary 30-second heartbeat cannot observe that onset.
    this.nativeOomTraceTimer = setInterval(() => this.sampleNativeOomTrace(), 1000);
    this.nativeOomTraceTimer.unref?.();
  }

  public stopNativeOomTraceSampling(): void {
    if (!this.nativeOomTraceTimer) return;
    clearInterval(this.nativeOomTraceTimer);
    this.nativeOomTraceTimer = null;
  }

  private sendToWindow(win: BrowserWindow | null | undefined, channel: string, ...args: any[]): boolean {
    if (!win || win.isDestroyed()) return false;
    try {
      nativeOomTrace.recordOutboundIpc(win.webContents.id, channel, args);
      win.webContents.send(channel, ...args);
      return true;
    } catch {
      return false;
    }
  }

  private sendToMeetingSurfaces(channel: string, ...args: any[]): void {
    const sent = new Set<number>();
    const sendOnce = (win: BrowserWindow | null | undefined) => {
      if (!win || sent.has(win.id)) return;
      if (this.sendToWindow(win, channel, ...args)) sent.add(win.id);
    };
    sendOnce(this.windowHelper.getLauncherWindow());
    sendOnce(this.windowHelper.getOverlayWindow());
  }

  private sendToSettingsSurfaces(channel: string, ...args: any[]): void {
    const sent = new Set<number>();
    const sendOnce = (win: BrowserWindow | null | undefined) => {
      if (!win || sent.has(win.id)) return;
      if (this.sendToWindow(win, channel, ...args)) sent.add(win.id);
    };
    sendOnce(this.settingsWindowHelper.getSettingsWindow());
    sendOnce(this.windowHelper.getLauncherWindow());
  }

  /** Push a transcript payload to the launcher + overlay rolling-transcript bar. */
  private emitTranscriptToSurfaces(payload: { speaker: string; text: string; timestamp: number; final: boolean; confidence: number }): void {
    const helper = this.getWindowHelper();
    this.sendToWindow(helper.getLauncherWindow(), 'native-audio-transcript', payload);
    this.sendToWindow(helper.getOverlayWindow(), 'native-audio-transcript', payload);
  }

  /**
   * Display-only transcript IPC with partial throttling (audit finding #7).
   * Finals flush any pending partial then send immediately (preserving order);
   * partials coalesce to latest-wins within PARTIAL_TRANSCRIPT_THROTTLE_MS so a
   * chatty STT doesn't generate near-per-token IPC to two windows. Keyed per
   * speaker so interviewer + user channels throttle independently.
   */
  private sendThrottledTranscript(payload: { speaker: string; text: string; timestamp: number; final: boolean; confidence: number }): void {
    const key = payload.speaker;
    let state = this._transcriptPartialThrottle.get(key);
    if (!state) {
      state = { timer: null, pending: null };
      this._transcriptPartialThrottle.set(key, state);
    }

    if (payload.final) {
      // Cancel any pending partial — the final supersedes it — then send now.
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      state.pending = null;
      this.emitTranscriptToSurfaces(payload);
      return;
    }

    // Partial: remember the latest and ensure a flush is scheduled.
    state.pending = payload;
    if (state.timer) return; // a flush is already pending; latest-wins
    state.timer = setTimeout(() => {
      const s = this._transcriptPartialThrottle.get(key);
      if (!s) return;
      s.timer = null;
      const p = s.pending;
      s.pending = null;
      if (p) this.emitTranscriptToSurfaces(p);
    }, AppState.PARTIAL_TRANSCRIPT_THROTTLE_MS);
  }

  /** Drop any pending throttled partials + timers (called on meeting teardown). */
  private clearTranscriptThrottle(): void {
    for (const state of this._transcriptPartialThrottle.values()) {
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      state.pending = null;
    }
    this._transcriptPartialThrottle.clear();
  }

  private sendSttStatus(payload: any): void {
    this.sendToMeetingSurfaces('stt-status', payload);
  }

  // Public so initializeApp's startup permission checks (UX1) can emit the
  // banner symmetrically with sendSystemAudioPermissionDenied. Other in-class
  // call sites are unaffected.
  public sendAudioCaptureFailed(payload: any): void {
    this.sendToMeetingSurfaces('audio-capture-failed', payload);
  }

  public sendSystemAudioPermissionDenied(message: string): void {
    this.sendToMeetingSurfaces('system-audio-permission-denied', message);
  }

  public broadcast(channel: string, ...args: any[]): void {
    BrowserWindow.getAllWindows().forEach(win => {
      this.sendToWindow(win, channel, ...args);
    });
  }

  public getIsMeetingActive(): boolean {
    return this.isMeetingActive;
  }

  public isQuitting(): boolean {
    return this._isQuitting;
  }

  public setQuitting(value: boolean): void {
    this._isQuitting = value;
  }

  private broadcastMeetingState(): void {
    this.broadcast('meeting-state-changed', { isActive: this.isMeetingActive });
  }

  // Public so the reference-file upload IPC handler can kick a retry for a
  // file that landed in 'failed'/'lexical_only' during the embedder warm-up
  // window (the boot-time scheduler only sees files that existed at start).
  public scheduleModeReferenceIndexRetry(): void {
    if (this.modeReferenceRetryPromise) return;
    const pipeline = this.ragManager?.getEmbeddingPipeline();
    if (!pipeline) return;

    this.modeReferenceRetryPromise = pipeline.waitForReady(15000).then(async () => {
      const { ModesManager } = require('./services/ModesManager');
      const modesManager = ModesManager.getInstance();
      await modesManager.retryAllLexicalOnlyFiles().catch(() => { /* logged inside */ });
      // Capture which modes actually had retry-eligible files BEFORE the retry,
      // so we only nudge those renderers to re-fetch status (LOW #8) instead of
      // broadcasting a no-op 'done' to every mode on every pipeline-ready event.
      const affectedModeIds: string[] = modesManager.getModesWithRetryEligibleFiles();
      for (const modeId of affectedModeIds) {
        this.broadcast('mode-file-index-status', { modeId, phase: 'done' });
      }
    }).catch(() => { /* provider unavailable — lexical fallback remains valid */ })
      .finally(() => { this.modeReferenceRetryPromise = null; });
  }

  private async bootstrapOllamaEmbeddings() {
    this._ollamaBootstrapPromise = (async () => {
      try {
        if (localModelsDisabled()) {
          console.warn('[LeakTest] Skipping Ollama embeddings bootstrap (NATIVELY_NO_LOCAL_MODELS=1)');
          return;
        }
        // SKIP when a cloud embedding provider is already available. Pulling the
        // 274MB `nomic-embed-text` on first launch is pure waste for users who
        // have an OpenAI/Gemini key (the RAG pipeline resolves to that cloud
        // provider anyway), and the background pull was racing the ModelSelector
        // window's forceRestartOllama `kill -9` — leaving a "Setting up AI
        // memory… 0%" pill stuck forever. Only bootstrap Ollama embeddings when
        // there is NO cloud key, i.e. Ollama is genuinely the intended provider.
        try {
          const { CredentialsManager } = require('./services/CredentialsManager');
          const cm = CredentialsManager.getInstance();
          const hasCloudEmbeddingKey =
            !!(cm.getOpenaiApiKey() || process.env.OPENAI_API_KEY) ||
            !!(cm.getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
          if (hasCloudEmbeddingKey) {
            console.log('[AppState] Skipping Ollama embeddings bootstrap — a cloud embedding provider is configured.');
            return;
          }
        } catch (guardErr: any) {
          // Credential lookup failed — fall through and attempt the bootstrap.
          console.warn('[AppState] Ollama bootstrap cloud-key guard failed (non-fatal):', guardErr?.message);
        }

        // PHASE-2C: capability resolver — even when no cloud key is
        // configured, the user may have explicitly disabled Ollama (or
        // configured a non-Ollama local provider). Without this gate, a fresh
        // install's `spawn ollama` is wasted work that fills the log with
        // ENOENT noise and can race the ModelSelector force-restart path.
        // Only attempt to bootstrap when the user has not opted out.
        try {
          const { SettingsManager } = require('./services/SettingsManager');
          const settings = SettingsManager.getInstance();
          // Best-effort check — any missing key returns undefined and is
          // treated as "no opt-out" (the bootstrap proceeds, matching
          // pre-fix behavior). This is intentionally permissive: we only
          // short-circuit when the user has clearly said NO.
          const explicitNoOllama =
            settings.get?.('disableOllamaBootstrap') === true ||
            settings.get?.('localProvider') === 'none' ||
            settings.get?.('localProvider') === 'cloud';
          if (explicitNoOllama) {
            console.log('[AppState] Skipping Ollama embeddings bootstrap — user has opted out (disableOllamaBootstrap/localProvider).');
            return;
          }
        } catch (settingsErr: any) {
          // Settings lookup is best-effort; failure here just falls through
          // to the prior behavior.
          console.warn('[AppState] Ollama bootstrap opt-out check failed (non-fatal):', settingsErr?.message);
        }

        const { OllamaBootstrap } = require('./rag/OllamaBootstrap');
        const bootstrap = new OllamaBootstrap();

        // Fire and forget — don't await this before showing the window
        const result = await bootstrap.bootstrap('nomic-embed-text', (status: string, percent: number) => {
          // Send progress to renderer via IPC
          this.broadcast('ollama:pull-progress', { status, percent });
        });

        if (result === 'pulled' || result === 'already_pulled') {
          this.broadcast('ollama:pull-complete');
          // Re-resolve the embedding provider given that Ollama might now be available
          if (this.ragManager) {
             console.log('[AppState] Ollama model ready, re-evaluating RAG pipeline provider');
             const { CredentialsManager } = require('./services/CredentialsManager');
             const cm = CredentialsManager.getInstance();
             this.ragManager.initializeEmbeddings({
                openaiKey: cm.getOpenaiApiKey() || process.env.OPENAI_API_KEY || undefined,
                geminiKey: cm.getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || undefined,
                ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
                providerDataScopes: (() => { try { const { SettingsManager } = require('./services/SettingsManager'); return SettingsManager.getInstance().get('providerDataScopes'); } catch { return undefined; } })()
             });
             this.scheduleModeReferenceIndexRetry();
          }
        }
      } catch (err) {
         console.error('[AppState] Failed to bootstrap Ollama:', err);
      }
    })();
  }

  private initializeRAGManager(): void {
    try {
      const db = DatabaseManager.getInstance();
      const sqliteDb = db.getDb();

      if (sqliteDb) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const cm = CredentialsManager.getInstance();
        const openaiKey = cm.getOpenaiApiKey() || process.env.OPENAI_API_KEY;
        const geminiKey = cm.getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        // Gemini embedding key POOL: credential key + all GEMINI_API_KEY(_2.._6)/GOOGLE
        // env keys, de-duped. Lets the embedding provider rotate off a rate-limited
        // key (429 → per-key cooldown → next key) instead of failing the index.
        const geminiKeys = (() => {
          const pool: string[] = [];
          const add = (k?: string) => { const v = (k || '').trim(); if (v && !pool.includes(v)) pool.push(v); };
          add(cm.getGeminiApiKey());
          for (const n of ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5', 'GEMINI_API_KEY_6', 'GOOGLE_API_KEY']) add(process.env[n]);
          return pool;
        })();

        const providerDataScopes = (() => { try { const { SettingsManager } = require('./services/SettingsManager'); return SettingsManager.getInstance().get('providerDataScopes'); } catch { return undefined; } })();
        this.ragManager = new RAGManager({
            db: sqliteDb,
            dbPath: db.getDbPath(),
            extPath: db.getExtPath(),
            openaiKey,
            geminiKey,
            geminiKeys,
            ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
            providerDataScopes
        });
        this.ragManager.setLLMHelper(this.processingHelper.getLLMHelper());

        // Modes reference files must use the same initialized EmbeddingPipeline as
        // the main RAG stack. A private, never-initialized pipeline marks every
        // upload as lexical_only even after Gemini/Ollama embeddings are ready.
        const { ModesManager } = require('./services/ModesManager');
        const modeEmbeddingPipeline = this.ragManager.getEmbeddingPipeline();
        ModesManager.getInstance().setSharedEmbeddingPipeline(modeEmbeddingPipeline);
        this.scheduleModeReferenceIndexRetry();

        console.log('[AppState] RAGManager initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize RAGManager:', error);
    }

    // Initialize Knowledge Orchestrator
    try {
      const db = DatabaseManager.getInstance();
      const sqliteDb = db.getDb();

      if (sqliteDb && KnowledgeDatabaseManagerClass && KnowledgeOrchestratorClass) {
        const knowledgeDb = new KnowledgeDatabaseManagerClass(sqliteDb);
        this.knowledgeOrchestrator = new KnowledgeOrchestratorClass(knowledgeDb);

        // Wire up LLM functions
        const llmHelper = this.processingHelper.getLLMHelper();

        // generateContent function for LLM calls
        // Join ALL content parts (some callers — e.g. live negotiation coaching —
        // pass [{text: systemPrefix}, {text: prompt}]; reading only [0] dropped the
        // prompt). Single-item callers (extraction, script) are unaffected.
        const joinContents = (contents: any[]) =>
          (Array.isArray(contents) ? contents : [contents])
            .map((c: any) => (typeof c === 'string' ? c : c?.text || ''))
            .filter(Boolean)
            .join('\n\n');
        this.knowledgeOrchestrator.setGenerateContentFn(async (contents: any[]) => {
          return await llmHelper.generateContentStructured(joinContents(contents));
        });

        // Low-latency generation for LIVE negotiation coaching (spoken in real
        // time): Flash-first chain so the tactical note appears fast. The AOT
        // negotiation script + all extraction keep the quality-first fn above.
        if (typeof this.knowledgeOrchestrator.setLiveCoachingContentFn === 'function') {
          this.knowledgeOrchestrator.setLiveCoachingContentFn(async (contents: any[]) => {
            return await llmHelper.generateContentStructured(joinContents(contents), { preferFast: true });
          });
        }

        // Embedding function — lazily delegate to the cascaded EmbeddingPipeline
        // (OpenAI → Gemini → Ollama → Local bundled model).
        // We await waitForReady() so uploads during boot wait for the pipeline
        // instead of immediately throwing 'not ready'.
        const self = this;
        const embedWithProducerMetadata = async (text: string) => {
          const pipeline = self.ragManager?.getEmbeddingPipeline();
          if (!pipeline) throw new Error('RAG pipeline not available');
          await pipeline.waitForReady();
          return await pipeline.getEmbeddingWithFallback(text);
        };
        this.knowledgeOrchestrator.setEmbedFn(async (text: string) => {
          return (await embedWithProducerMetadata(text)).embedding;
        });
        if (typeof this.knowledgeOrchestrator.setEmbedWithMetadataFn === 'function') {
          this.knowledgeOrchestrator.setEmbedWithMetadataFn(embedWithProducerMetadata);
        }
        // Report the active document-embedder's composite space so the orchestrator
        // can detect knowledge nodes embedded in an OLD space (e.g. after a
        // gemini-embedding-001 → -2 upgrade) and re-embed them, instead of silently
        // comparing v1 node vectors against v2 query vectors (same dims = no dim guard).
        if (typeof this.knowledgeOrchestrator.setActiveSpaceFn === 'function') {
          this.knowledgeOrchestrator.setActiveSpaceFn(() => {
            return self.ragManager?.getEmbeddingPipeline()?.getActiveSpaceKey();
          });
        }
        if (typeof this.knowledgeOrchestrator.setEmbedQueryFn === 'function') {
          this.knowledgeOrchestrator.setEmbedQueryFn(async (text: string) => {
            const pipeline = self.ragManager?.getEmbeddingPipeline();
            if (!pipeline) throw new Error('RAG pipeline not available');
            await pipeline.waitForReady();
            return await pipeline.getEmbeddingForQuery(text);
          });
        }
        // Fast on-device query embedder for the latency-critical knowledge path.
        // The orchestrator dimension-checks `dimensions` against the index and
        // only uses `embed` (bundled MiniLM, ~10ms) when compatible — otherwise
        // it falls back to the cloud embedFn above so retrieval stays correct.
        if (typeof this.knowledgeOrchestrator.setFastQueryEmbedFn === 'function') {
          this.knowledgeOrchestrator.setFastQueryEmbedFn(() => {
            const pipeline = self.ragManager?.getEmbeddingPipeline();
            return {
              dimensions: pipeline?.localDimensions ?? null,
              // Composite space of the local embedder — the orchestrator gates the
              // fast path on space identity (not just dimension), so a same-dim but
              // different-space collision can't silently produce garbage similarity.
              space: pipeline?.localSpaceKey ?? null,
              embed: async (text: string) => {
                if (!pipeline) return null;
                // Await readiness so the FIRST cold-session question still gets the
                // local fast path (the local fallback provider is only assigned
                // once the pipeline finishes init). Without this, the very query
                // prewarm targets would silently fall back to the cloud embedder.
                // Swallow errors — getEmbeddingForQueryLocalOnly returns null on
                // any failure and the orchestrator falls back to embedFn.
                try { await pipeline.waitForReady(); } catch { /* fall through */ }
                return await pipeline.getEmbeddingForQueryLocalOnly(text);
              },
            };
          });
        }

        // Kick a knowledge re-embed once the embedding pipeline is ready. CRITICAL:
        // the orchestrator's constructor fires refreshCache()→ensureEmbeddingSpace()
        // BEFORE setActiveSpaceFn is wired above, so that initial pass no-ops (no active
        // space yet). Without this explicit kick, a v1→v2 model upgrade would leave the
        // resume/JD nodes stranded in the old space — _spaceGatedNodes would exclude them
        // and semantic retrieval would silently return nothing until the user re-uploaded.
        // This is the knowledge-base analogue of RAGManager.scheduleAutoReindex's self-heal.
        if (typeof this.knowledgeOrchestrator.ensureEmbeddingSpace === 'function') {
          const ko = this.knowledgeOrchestrator;
          (async () => {
            try {
              await self.ragManager?.getEmbeddingPipeline()?.waitForReady();
              await ko.ensureEmbeddingSpace();
            } catch (e: any) {
              console.warn('[main] Knowledge ensureEmbeddingSpace kick failed (non-fatal):', e?.message || e);
            }
          })();
        }

        // Phase 1: transcript-aware intent hint. The orchestrator (premium) has
        // no SessionTracker reference (package boundary), so the app layer reads
        // the rolling ~180s transcript here and hands back a lightweight verdict.
        // We inspect only the last 1-2 INTERVIEWER turns for comp evidence — NOT
        // the whole window (that caused topic-bleed) and NOT the candidate's own
        // typed question (classified separately). Cheap + synchronous.
        if (typeof this.knowledgeOrchestrator.setConversationContextProvider === 'function') {
          this.knowledgeOrchestrator.setConversationContextProvider(() => {
            if (!textHasCompEvidence) return null;
            try {
              const items = self.intelligenceManager?.getContext(180) ?? [];
              const interviewerTurns = items.filter((i: any) => i.role === 'interviewer');
              const lastTwo = interviewerTurns.slice(-2);
              const lastInterviewerTurn = lastTwo.length ? lastTwo[lastTwo.length - 1].text : undefined;
              const recentInterviewerComp = lastTwo.some((i: any) => textHasCompEvidence!(i.text));
              return { recentInterviewerComp, lastInterviewerTurn };
            } catch {
              return null;
            }
          });
        }

        // Attach KnowledgeOrchestrator to LLMHelper
        llmHelper.setKnowledgeOrchestrator(this.knowledgeOrchestrator);

        // Restore persisted toggle states so UI reflects what the user left them as.
        // NOTE: groqFastTextMode is now restored unconditionally in the AppState constructor
        // so it is not repeated here.
        const sm = SettingsManager.getInstance();
        if (sm.get('knowledgeMode')) {
          this.knowledgeOrchestrator.setKnowledgeMode(true);
          console.log('[AppState] Knowledge mode restored from settings');
          // Pre-warm the provider prompt cache off the hot path so the first
          // question of the session doesn't pay full cold-prefill TTFT. Gated
          // on knowledge mode being active AND a resume being present (only then
          // is a session likely imminent). Best-effort, non-blocking.
          if (this.knowledgeOrchestrator.isKnowledgeMode()) {
            llmHelper.prewarmPromptCache().catch((_e: any): void => {});
          }
        }

        // Restore custom notes so orchestrator has them from first request
        const savedNotes = DatabaseManager.getInstance().getCustomNotes();
        if (savedNotes) {
          this.knowledgeOrchestrator.setCustomNotes(savedNotes);
          llmHelper.setCustomNotes(savedNotes);
          console.log('[AppState] Custom notes restored');
        }

        // Restore persona prompt so it is active from first request (not just after the UI mounts)
        try {
          const savedPersona = DatabaseManager.getInstance().getPersona();
          if (savedPersona) {
            llmHelper.setPersonaPrompt(savedPersona);
            console.log('[AppState] Persona prompt restored');
          }
        } catch (personaErr: any) {
          console.warn('[AppState] Persona restore failed, continuing without it:', personaErr?.message);
        }

        console.log('[AppState] KnowledgeOrchestrator initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize KnowledgeOrchestrator:', error);
    }
  }

  private setupAutoUpdater(): void {
    // Keep downloads user-initiated so the renderer's "Update Now" CTA is the
    // single source of truth. Signed/packaged builds can still apply a downloaded
    // update on quit; unsigned macOS builds use the manual GitHub DMG flow.
    const autoInstall = canAutoInstall()
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = autoInstall
    console.log(
      `[AutoUpdater] autoDownload=${autoUpdater.autoDownload} ` +
      `autoInstallOnAppQuit=${autoUpdater.autoInstallOnAppQuit} ` +
      `(canAutoInstall=${autoInstall}, signedBuild=${isSignedBuild()}, platform=${process.platform})`
    )

    // PHASE-2A: log current + feed config on startup so a mis-pointed `latest.yml`
    // is immediately diagnosable from the log (and from any user bug report).
    //
    // NOTE: electron-updater@6.x deprecated `getFeedURL()` — when no explicit URL
    // was set via `setFeedURL()`, the method returns the literal string
    // "Deprecated. Do not use it." instead of resolving from `package.json`.
    // Read the `publish` block directly so the diagnostic reflects truth.
    try {
      const pkgPath = path.join(app.getAppPath(), 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const publish = pkg?.build?.publish || pkg?.publish
      let feedLabel: string
      if (Array.isArray(publish) && publish.length > 0) {
        // electron-builder allows a publish array (multi-channel). Log them all.
        feedLabel = publish
          .map((p: any) => `${p.provider || 'unknown'}:${p.owner ? `${p.owner}/${p.repo ?? ''}` : (p.url || '(default)')}`)
          .join(', ')
      } else if (publish && typeof publish === 'object') {
        feedLabel = `${publish.provider || 'unknown'}:${publish.owner ? `${publish.owner}/${publish.repo ?? ''}` : (publish.url || '(default)')}`
      } else if (publish) {
        feedLabel = String(publish)
      } else {
        feedLabel = 'auto (publish in package.json)'
      }
      console.log(
        `[AutoUpdater] currentVersion=${app.getVersion()} channel=${autoUpdater.channel} feed=${feedLabel}`
      )
    } catch (feedErr) {
      console.warn('[AutoUpdater] Could not read feed URL:', feedErr)
    }

    // Default to latest (stable) channel - matches latest.yml generated by electron-builder
    autoUpdater.channel = 'latest'
    console.log(`[AutoUpdater] Channel: ${autoUpdater.channel}`)

    autoUpdater.on("checking-for-update", () => {
      console.log("[AutoUpdater] Checking for update...")
      this.broadcast("update-checking")
    })

    autoUpdater.on("update-available", async (info) => {
      // PHASE-2A: refuse non-upgrades (downgrade, equal, malformed). electron-updater
      // normally already filters this, but we belt-and-brace it: a stale latest.yml on
      // GitHub (or a republish with the wrong tag) must NEVER cause us to invite the
      // user to "update" to a version older than or equal to what they're running.
      const currentVersion = app.getVersion()
      const remoteVersion = (info?.version ?? '').toString().replace(/^v/, '')
      if (!AppState.isRealUpgrade(currentVersion, remoteVersion)) {
        console.warn(
          '[AutoUpdater] Ignoring non-upgrade update:',
          `current=${currentVersion} remote=${remoteVersion} channel=${autoUpdater.channel}`
        )
        this.updateAvailable = false
        this.updateDownloadState = 'idle'
        this.downloadedUpdateInfo = null
        // Treat as "not available" so the UI doesn't show a stale banner.
        this.broadcast('update-not-available', {
          version: currentVersion,
          ignored: true,
          reason: 'non-upgrade',
          remote: remoteVersion
        })
        return
      }

      console.log("[AutoUpdater] Update available:", info.version)
      this.updateAvailable = true
      this.updateDownloadState = 'available'
      this.downloadedUpdateInfo = null

      // Fetch structured release notes
      const releaseManager = ReleaseNotesManager.getInstance();
      const notes = await releaseManager.fetchReleaseNotes(info.version);

      // Notify renderer that an update is available with parsed notes if available
      this.broadcast("update-available", {
        ...info,
        parsedNotes: notes
      })
    })

    autoUpdater.on("update-not-available", (info) => {
      console.log("[AutoUpdater] Update not available:", info.version)
      this.updateAvailable = false
      this.updateDownloadState = 'idle'
      this.downloadedUpdateInfo = null
      this.broadcast("update-not-available", info)
    })

    autoUpdater.on("error", (err) => {
      console.error("[AutoUpdater] Error:", err)
      this.updateDownloadState = this.updateAvailable ? 'available' : 'idle'
      this.updateDownloadPromise = null
      // Include more details in the error message for debugging
      const errorMessage = err.message || err.toString() || 'Unknown update error'
      this.broadcast("update-error", errorMessage)
    })

    autoUpdater.on("download-progress", (progressObj) => {
      let log_message = "Download speed: " + progressObj.bytesPerSecond
      log_message = log_message + " - Downloaded " + progressObj.percent + "%"
      log_message = log_message + " (" + progressObj.transferred + "/" + progressObj.total + ")"
      console.log("[AutoUpdater] " + log_message)
      this.broadcast("download-progress", progressObj)
    })

    autoUpdater.on("update-downloaded", (info) => {
      console.log("[AutoUpdater] Update downloaded:", info.version)
      this.updateDownloadState = 'downloaded'
      this.updateDownloadPromise = null
      // info.filePath is the public path of the staged update zip from Squirrel.Mac.
      // Use it over the private downloadedUpdateHelper.file API (see quitAndInstallUpdate).
      this.downloadedUpdateInfo = { ...info, updateFile: (info as any).filePath }
      this.broadcast("update-downloaded", this.downloadedUpdateInfo)
    })

    // Start checking for updates with a 10-second delay
    setTimeout(() => {
      if (process.env.NODE_ENV === "development") {
        console.log("[AutoUpdater] Development mode: Skipping auto check (use manual button)");
      } else {
        autoUpdater.checkForUpdatesAndNotify().catch(err => {
          console.error("[AutoUpdater] Failed to check for updates:", err);
        });
      }
    }, 10000);
  }

  private async checkForUpdatesManual(): Promise<void> {
    try {
      console.log('[AutoUpdater] Checking for updates manually via GitHub API...');
      const releaseManager = ReleaseNotesManager.getInstance();
      // Fetch latest release
      const notes = await releaseManager.fetchReleaseNotes('latest');

      if (notes) {
        const currentVersion = app.getVersion();
        const latestVersionTag = notes.version; // e.g., "v1.2.0" or "1.2.0"
        const latestVersion = latestVersionTag.replace(/^v/, '');

        console.log(`[AutoUpdater] Manual Check: Current=${currentVersion}, Latest=${latestVersion}`);

        if (this.isVersionNewer(currentVersion, latestVersion)) {
          console.log('[AutoUpdater] Manual Check: New version found!');
          this.updateAvailable = true;
          this.updateDownloadState = 'available';
          this.downloadedUpdateInfo = null;

          // Mock an info object compatible with electron-updater
          const info = {
            version: latestVersion,
            files: [] as any[],
            path: '',
            sha512: '',
            releaseName: notes.summary,
            releaseNotes: notes.fullBody
          };

          // Notify renderer
          this.broadcast("update-available", {
            ...info,
            parsedNotes: notes
          });
        } else {
          console.log('[AutoUpdater] Manual Check: App is up to date.');
          this.updateAvailable = false;
          this.updateDownloadState = 'idle';
          this.downloadedUpdateInfo = null;
          this.broadcast("update-not-available", { version: currentVersion });
        }
      }
    } catch (err) {
      console.error('[AutoUpdater] Manual update check failed:', err);
    }
  }

  private isVersionNewer(current: string, latest: string): boolean {
    // EC-01 fix: strip pre-release suffixes (e.g. "2.1.0-beta.1" → "2.1.0")
    // before splitting so Number() never returns NaN on comparison.
    const stripPre = (v: string) => v.replace(/-.*$/, '');
    const c = stripPre(current).split('.').map(Number);
    const l = stripPre(latest).split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const cv = c[i] || 0;
      const lv = l[i] || 0;
      if (lv > cv) return true;
      if (lv < cv) return false;
    }
    return false;
  }

  /**
   * PHASE-2A: Is `remote` strictly newer than `current` (both semver-ish)?
   *
   * Used as the GATE on the production autoUpdater path so a stale or repointed
   * `latest.yml` can never invite the user to "update" to a version <= theirs.
   *
   * Rules:
   *   - Accept only well-formed X[.Y[.Z[.B]]] (digits). Anything else → false.
   *   - Leading 'v' (e.g. "v2.8.0") and pre-release suffixes ("2.8.0-beta.1") are
   *     stripped before comparison so a stable build never accepts a beta as a
   *     downgrade (and vice versa).
   *   - Strict greater-than. Equal or older → false.
   */
  static isRealUpgrade(current: string, remote: string): boolean {
    const stripPre = (v: string) => v.replace(/^v/, '').replace(/-.*$/, '')
    const parse = (v: string): number[] | null => {
      const parts = stripPre(v).split('.')
      if (parts.length < 1 || parts.length > 4) return null
      const out: number[] = []
      for (const p of parts) {
        if (!/^\d+$/.test(p)) return null
        const n = parseInt(p, 10)
        if (!Number.isFinite(n) || n < 0) return null
        out.push(n)
      }
      // Pad to 4 parts for stable comparison (major.minor.patch.build).
      while (out.length < 4) out.push(0)
      return out
    }
    const c = parse(current)
    const r = parse(remote)
    if (!c || !r) return false
    for (let i = 0; i < 4; i++) {
      if (r[i] > c[i]) return true
      if (r[i] < c[i]) return false
    }
    return false
  }

  public async quitAndInstallUpdate(): Promise<void> {
    // PHASE-2A: belt-and-brace guard against applying a downgrade or no-op update.
    // The `update-downloaded` path can only be reached after `update-available`
    // passed isRealUpgrade, but renderer/UI bugs could call this IPC directly.
    const currentVersion = app.getVersion()
    const downloadedVersion = (this.downloadedUpdateInfo?.version ?? '').toString().replace(/^v/, '')
    if (!downloadedVersion) {
      console.error('[AutoUpdater] quitAndInstall called but no downloaded update info')
      return
    }
    if (!AppState.isRealUpgrade(currentVersion, downloadedVersion)) {
      console.warn(
        '[AutoUpdater] Refusing to apply non-upgrade update:',
        `current=${currentVersion} downloaded=${downloadedVersion}`
      )
      this.broadcast('update-error', `Refusing non-upgrade update (${currentVersion} → ${downloadedVersion})`)
      return
    }
    console.log('[AutoUpdater] quitAndInstall called - applying update...')

    // Real in-place install + relaunch. Available on signed macOS builds and on
    // all packaged Windows/Linux builds (see canAutoInstall()). Squirrel.Mac will
    // unpack the staged ZIP, swap the .app, and relaunch.
    if (canAutoInstall()) {
      console.log('[AutoUpdater] Performing real quitAndInstall (signed/auto-installable build)')
      // PHASE-2E: tag this quit so the next-launch marker doesn't report it
      // as a "previous session crashed" event.
      try {
        const { LifecycleTracker } = require('./utils/lifecycleTracker');
        LifecycleTracker.getInstance().setQuitReason('updater-quit-install', {
          fromVersion: app.getVersion(),
          toVersion: downloadedVersion,
        });
      } catch { /* best-effort */ }
      setImmediate(() => {
        try {
          // isSilent=false (show installer UI on Windows), forceRunAfter=true (relaunch).
          autoUpdater.quitAndInstall(false, true)
        } catch (err) {
          console.error('[AutoUpdater] quitAndInstall failed:', err)
          app.exit(0)
        }
      })
      return
    }

    // FALLBACK (unsigned macOS / non-installable build): we can't swap+relaunch in
    // place, so open the folder holding the downloaded update and quit so the user
    // can install it by hand.
    if (process.platform === 'darwin') {
      try {
        // Prefer the public info.filePath from the update-downloaded event where
        // available. Fall back to the private API only if for some reason the event
        // path is absent (shouldn't happen for a packaged build).
        const updateFile =
          (autoUpdater as any).downloadedUpdateHelper?.file ??
          (autoUpdater as any).updateInfo?.filePath ??
          undefined
        console.log('[AutoUpdater] Downloaded update file:', updateFile)

        if (updateFile) {
          const updateDir = path.dirname(updateFile)
          // Open the directory containing the update in Finder
          await shell.openPath(updateDir)
          console.log('[AutoUpdater] Opened update directory:', updateDir)

          // Quit the app so user can install new version
          setTimeout(() => app.quit(), 1000)
          return
        }
      } catch (err) {
        console.error('[AutoUpdater] Failed to open update directory:', err)
      }

      // openPath failed or updateFile was absent — just quit so the user can
      // manually find the staged zip in ~/Library/Caches/electron-update/…
      // or redownload from GitHub releases. Never call quitAndInstall on an
      // unsigned macOS build — Squirrel.Mac will fail silently.
      setTimeout(() => app.quit(), 1000)
      return
    }

    // Last-resort fallback: Windows/Linux — quitAndInstall works there without a
    // Developer ID signature because NSIS/Squirrel handles it differently.
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true)
      } catch (err) {
        console.error('[AutoUpdater] quitAndInstall failed:', err)
        app.exit(0)
      }
    })
  }

  /** Whether this build can do a real in-place auto-install (see canAutoInstall()). */
  public canAutoUpdate(): boolean {
    return canAutoInstall()
  }

  public async checkForUpdates(): Promise<void> {
    console.log('[AutoUpdater] Manual check for updates requested')
    try {
      // In development mode, use manual GitHub API check (electron-updater skips in dev)
      if (process.env.NODE_ENV === "development") {
        await this.checkForUpdatesManual()
      } else {
        await autoUpdater.checkForUpdatesAndNotify()
      }
    } catch (err: any) {
      console.error('[AutoUpdater] checkForUpdates failed:', err)
      const errorMessage = err.message || err.toString() || 'Update check failed'
      this.broadcast("update-error", errorMessage)
    }
  }

  public async downloadUpdate(): Promise<void> {
    if (this.updateDownloadState === 'downloaded' && this.downloadedUpdateInfo) {
      console.log('[AutoUpdater] Download already completed — re-broadcasting downloaded update')
      this.broadcast('update-downloaded', this.downloadedUpdateInfo)
      return
    }

    if (this.updateDownloadState === 'downloading') {
      console.log('[AutoUpdater] Download already in progress — ignoring duplicate request')
      await this.updateDownloadPromise
      return
    }

    if (!this.updateAvailable) {
      const message = 'No update is currently available to download.'
      console.warn(`[AutoUpdater] ${message}`)
      this.broadcast('update-error', message)
      return
    }

    console.log('[AutoUpdater] Starting download...')
    this.updateDownloadState = 'downloading'
    try {
      // Errors during download are surfaced via autoUpdater.on("error") which
      // already broadcasts "update-error". Do not broadcast here to avoid duplicates.
      this.updateDownloadPromise = autoUpdater.downloadUpdate().catch(err => {
        console.error('[AutoUpdater] downloadUpdate failed:', err)
        this.updateDownloadState = this.updateAvailable ? 'available' : 'idle'
        this.updateDownloadPromise = null
        throw err
      })
      await this.updateDownloadPromise
    } catch (err: any) {
      console.error('[AutoUpdater] downloadUpdate exception:', err)
      this.updateDownloadState = this.updateAvailable ? 'available' : 'idle'
      this.updateDownloadPromise = null
    }
  }

  // New Property for System Audio & Microphone
  private systemAudioCapture: SystemAudioCapture | null = null;
  private microphoneCapture: MicrophoneCapture | null = null;
  private audioTestCapture: MicrophoneCapture | null = null; // For audio settings test
  private _audioTestStarting = false;               // P2-12: in-flight guard against concurrent calls
  private googleSTT: STTProvider | null = null; // Interviewer
  private googleSTT_User: STTProvider | null = null; // User

  private createSTTProvider(speaker: 'interviewer' | 'user'): STTProvider | null {
    const { CredentialsManager } = require('./services/CredentialsManager');
    const sttProvider = CredentialsManager.getInstance().getSttProvider();
    const sttLanguage = CredentialsManager.getInstance().getSttLanguage();

    // 'none' means the user has explicitly disabled STT (no provider selected).
    // Return null so the pipeline skips STT without falling back to Google.
    if (sttProvider === 'none') {
      console.log(`[Main] STT provider is 'none' — audio capture will proceed but transcription is disabled.`);
      return null;
    }

    let stt: STTProvider;

    if (sttProvider === 'natively') {
      const nativelyKey = CredentialsManager.getInstance().getNativelyApiKey();
      if (!nativelyKey) {
        // Natively is Coming Soon — no key means degrade gracefully like every other provider
        console.warn(`[Main] No Natively API Key configured for ${speaker}, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      } else {
        // 'system' for interviewer (system audio), 'mic' for user (microphone).
        // The server uses ${key}:${channel} as the session key so both streams
        // can coexist without triggering concurrent_session_blocked.
        //
        // Phase 7/8: pass appVersion + platform for the regional-relay
        // session-create body. The class reads the relay feature flags from
        // SettingsManager itself and derives the control-plane base URL from
        // its own host, so the construction site stays tiny. The relay path is
        // flag-gated OFF by default — this is inert until regionalSttRelayEnabled.
        stt = new NativelyProSTT(
          nativelyKey,
          speaker === 'interviewer' ? 'system' : 'mic',
          {
            appVersion: app.getVersion(),
            platform: process.platform === 'darwin' ? 'mac'
              : process.platform === 'win32' ? 'windows'
              : 'linux',
          },
        );
      }
    } else if (sttProvider === 'deepgram') {
      const apiKey = CredentialsManager.getInstance().getDeepgramApiKey();
      if (apiKey) {
        console.log(`[Main] Using DeepgramStreamingSTT for ${speaker}`);
        const dg = new DeepgramStreamingSTT(apiKey);
        // Opt-in diarization (#3): only on the remote/system channel ('interviewer'), where
        // multiple people may speak. The mic channel is always the local user ('me'), so
        // diarizing it adds cost with no benefit. Default OFF via flag.
        try {
          if (speaker === 'interviewer' && isIntelligenceFlagEnabled('speakerDiarizationV1')) {
            dg.setDiarization(true);
          }
        } catch { /* flag read non-fatal */ }
        stt = dg;
      } else {
        console.warn(`[Main] No API key for Deepgram STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (sttProvider === 'soniox') {
      const apiKey = CredentialsManager.getInstance().getSonioxApiKey();
      if (apiKey) {
        console.log(`[Main] Using SonioxStreamingSTT for ${speaker}`);
        stt = new SonioxStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for Soniox STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (sttProvider === 'elevenlabs') {
      const apiKey = CredentialsManager.getInstance().getElevenLabsApiKey();
      if (apiKey) {
        console.log(`[Main] Using ElevenLabsStreamingSTT for ${speaker}`);
        stt = new ElevenLabsStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for ElevenLabs STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (sttProvider === 'openai') {
      // OpenAI: WebSocket Realtime (gpt-4o-transcribe → gpt-4o-mini-transcribe) with whisper-1 REST fallback.
      // If a custom OpenAI-compatible base URL is configured (e.g. Speaches), the STT class
      // skips the Realtime WS path and uses REST against the custom endpoint.
      const apiKey = CredentialsManager.getInstance().getOpenAiSttApiKey();
      const baseUrl = CredentialsManager.getInstance().getOpenAiSttBaseUrl();
      if (apiKey) {
        console.log(`[Main] Using OpenAIStreamingSTT for ${speaker}${baseUrl ? ` (custom endpoint: ${baseUrl})` : ' (WebSocket+REST fallback)'}`);
        stt = new OpenAIStreamingSTT(apiKey, baseUrl);
      } else {
        console.warn(`[Main] No API key for OpenAI STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (sttProvider === 'groq' || sttProvider === 'azure' || sttProvider === 'ibmwatson') {
      let apiKey: string | undefined;
      let region: string | undefined;
      let modelOverride: string | undefined;

      if (sttProvider === 'groq') {
        apiKey = CredentialsManager.getInstance().getGroqSttApiKey();
        modelOverride = CredentialsManager.getInstance().getGroqSttModel();
      } else if (sttProvider === 'azure') {
        apiKey = CredentialsManager.getInstance().getAzureApiKey();
        region = CredentialsManager.getInstance().getAzureRegion();
      } else if (sttProvider === 'ibmwatson') {
        apiKey = CredentialsManager.getInstance().getIbmWatsonApiKey();
        region = CredentialsManager.getInstance().getIbmWatsonRegion();
      }

      if (apiKey) {
        console.log(`[Main] Using RestSTT (${sttProvider}) for ${speaker}`);
        stt = new RestSTT(sttProvider, apiKey, modelOverride, region);
      } else {
        console.warn(`[Main] No API key for ${sttProvider} STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (sttProvider === 'local-whisper') {
      const { LocalWhisperSTT } = require('./audio/LocalWhisperSTT');
      const sm = SettingsManager.getInstance();
      const globalModel = sm.get('localWhisperModel') ?? 'Xenova/whisper-tiny.en';
      // Per-channel override: when enabled the two STT instances may load
      // different models (e.g. Moonshine Tiny for mic, Moonshine Base for
      // system audio). Falls back to globalModel if the per-channel slot is
      // empty or the feature is disabled.
      let modelId = globalModel;
      if (sm.get('localWhisperPerChannelEnabled')) {
        const override = speaker === 'interviewer'
          ? sm.get('localWhisperModelSystem')
          : sm.get('localWhisperModelMic');
        if (override) modelId = override;
      }
      console.log(`[Main] Using LocalWhisperSTT for ${speaker}, model: ${modelId}`);
      const lws = new LocalWhisperSTT(modelId);
      // Channel label disambiguates the two concurrent instances in latency logs.
      lws.setChannel(speaker === 'interviewer' ? 'system' : 'mic');
      stt = lws as any;
    } else {
      stt = new GoogleSTT(speaker);
    }

    stt.setRecognitionLanguage(sttLanguage);

    // Wire Transcript Events
    stt.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number, speakerId?: string }) => {
      // Accept transcripts while a meeting is active OR while we're draining
      // trailing finals after Stop. `_isDraining` covers the ~250 ms grace
      // window between Stop click and STT socket close so the user's last
      // sentence isn't silently dropped.
      if (!this.isMeetingActive && !this._isDraining) {
        return;
      }

      this.intelligenceManager.handleTranscript({
        speaker: speaker,
        ...(segment.speakerId ? { speakerId: segment.speakerId } : {}),
        text: segment.text,
        timestamp: Date.now(),
        final: segment.isFinal,
        confidence: segment.confidence
      });

      // Feed final transcript to JIT RAG indexer
      if (segment.isFinal && this.ragManager) {
        this.ragManager.feedLiveTranscript([{
          speaker: speaker,
          text: segment.text,
          timestamp: Date.now()
        }]);
      }

      const payload = {
        speaker: speaker,
        ...(segment.speakerId ? { speakerId: segment.speakerId } : {}),
        text: segment.text,
        timestamp: Date.now(),
        final: segment.isFinal,
        confidence: segment.confidence
      };
      // Display-only send, partial-throttled (finals pass through immediately).
      // The answer path above (handleTranscript / RAG feed) is unaffected.
      this.sendThrottledTranscript(payload);

      // Feed final recruiter (system audio) transcripts to the premium
      // negotiation tracker. Issue #272: gate by active mode template so the
      // tracker never accumulates negotiation state in modes where salary is
      // out of scope (technical-interview, team-meet, lecture). Output gating
      // in LLMHelper is the primary defense; gating at the source stops state
      // from carrying over to any future read site. Fails open if ModesManager
      // is unavailable.
      if (segment.isFinal && speaker === 'interviewer') {
        let trackerFeedAllowed = true;
        try {
          const { ModesManager } = require('./services/ModesManager');
          trackerFeedAllowed = ModesManager.getInstance().isPremiumKnowledgeInterceptAllowed();
        } catch (_err) {
          // fail open — preserve existing behaviour for modes that need the tracker
        }
        if (trackerFeedAllowed) {
          this.knowledgeOrchestrator?.feedInterviewerUtterance?.(segment.text);
        }
      }
    });

    // Consecutive failure counter — reset on any successful final transcript
    let _consecutiveErrors = 0;

    // B2: Track state so we broadcast 'connected' on recovery from failed/reconnecting.
    // Initialize to 'awaiting-audio' so the renderer's UI starts in the neutral
    // "Listening for audio…" state until the first isFinal transcript proves
    // the pipeline is actually flowing. Pre-fix this was 'reconnecting' which
    // implied a recovery state from the get-go.
    let _lastState: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio' = 'awaiting-audio';

    stt.on('error', (err: Error) => {
      // Google streamingRecognize's 10s silence timeout closes the stream
      // with gRPC code 11 ("Audio Timeout Error"). GoogleSTT already
      // swallows this case before it reaches us, but other providers may
      // surface a similar idle-timeout that the lazy-reconnect path
      // recovers from cleanly. Downgrade to a one-liner here as well so
      // a stray bubble-up doesn't cascade into stack-trace noise.
      const grpcCode = (err as any)?.code;
      if (grpcCode === 11 || /Audio Timeout Error/i.test(err.message || '')) {
        console.warn(`[Main] STT (${speaker}) idle-timed-out (provider's no-audio limit), reconnecting on next chunk.`);
        return;
      }

      console.error(`[Main] STT (${speaker}) Error:`, err);

      // Extract richer error info from Axios errors (RestSTT)
      let errorMessage = err.message;
      const axiosErr = err as any;
      const httpStatus = axiosErr?.response?.status || 0;
      if (axiosErr?.response?.data?.error) {
        const respErr = axiosErr.response.data.error;
        const respMsg = typeof respErr === 'string' ? respErr : (respErr.message || respErr.code || JSON.stringify(respErr));
        errorMessage = httpStatus ? `${httpStatus} ${respMsg}` : respMsg;
      } else if (httpStatus) {
        errorMessage = `${httpStatus} ${axiosErr.response.statusText}`;
      }

      // Immediately fatal: auth/account problems — no amount of retrying helps
      const isAuthError = httpStatus === 401
        || err.message.toLowerCase().includes('auth_timeout')
        || err.message.toLowerCase().includes('invalid_key')
        || err.message.toLowerCase().includes('invalid api')
        || err.message.toLowerCase().includes('authentication');

      const isQuotaError = err.message.toLowerCase().includes('transcription_quota_exceeded')
        || err.message.toLowerCase().includes('quota');

      if (isAuthError) {
        _consecutiveErrors = 0;
        _lastState = 'failed';
        this.sendSttStatus( {
          state: 'failed',
          provider: sttProvider,
          error: errorMessage,
          channel: speaker,
        } as SttStatusPayload);
        return;
      }

      // Retryable: network drop, timeout, 5xx, 400, 429, WS drop
      _consecutiveErrors++;
      const maxErrors = 5;

      if (_consecutiveErrors >= maxErrors || isQuotaError) {
        _lastState = 'failed';
        this.sendSttStatus( {
          state: 'failed',
          provider: sttProvider,
          error: isQuotaError
            ? errorMessage
            : `STT provider failed (${_consecutiveErrors} consecutive errors): ${errorMessage}`,
          channel: speaker,
          reconnectAttempts: _consecutiveErrors,
        } as SttStatusPayload);
      } else {
        _lastState = 'reconnecting';
        this.sendSttStatus( {
          state: 'reconnecting',
          provider: sttProvider,
          error: errorMessage,
          channel: speaker,
          reconnectAttempts: _consecutiveErrors,
        } as SttStatusPayload);
      }
    });

    // Track successful transcripts — resets consecutive error counter
    // Broadcasts 'connected' whenever we recover from reconnecting/failed
    stt.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number }) => {
      if (segment.isFinal) {
        _consecutiveErrors = 0; // Success — reset counter
        if (_lastState !== 'connected') {
          _lastState = 'connected';
          this.sendSttStatus( {
            state: 'connected',
            provider: sttProvider,
            channel: speaker,
          } as SttStatusPayload);
        }
      }
    });

    // Non-fatal telemetry from providers (e.g. OpenAIStreamingSTT emits this
    // when the pre-session ring buffer evicts leading audio while waiting for
    // the WebSocket handshake). Surface it in the main-process log so the
    // signal isn't silently dropped — the event is informational, not a status
    // change, so we don't push it through the stt-status channel.
    stt.on('warning', (w: { code?: string; message?: string; droppedBytes?: number }) => {
      console.warn(`[Main] STT (${speaker}) warning: ${w?.code ?? 'unknown'}`,
        { provider: sttProvider, message: w?.message, droppedBytes: w?.droppedBytes });
    });

    // Auto language detection: NativelyProSTT emits 'languageDetected' when the
    // backend resolves the language from the first audio batch. Notify the renderer
    // so the settings UI can show what was detected.
    if (stt instanceof NativelyProSTT) {
      stt.on('connected', () => {
        _consecutiveErrors = 0;
        if (_lastState !== 'connected') {
          _lastState = 'awaiting-audio';
          this.sendSttStatus({
            state: 'awaiting-audio',
            provider: sttProvider,
            channel: speaker,
          } as SttStatusPayload);
        }
      });

      stt.on('languageDetected', (bcp47: string) => {
        console.log(`[Main] STT language auto-detected (${speaker}): ${bcp47}`);
        const helper = this.getWindowHelper();
        this.sendToWindow(helper.getMainWindow(), 'stt-language-auto-detected', bcp47);
        this.sendToWindow(helper.getLauncherWindow(), 'stt-language-auto-detected', bcp47);
      });

      // Persistent-reconnect signal: NativelyProSTT now retries indefinitely
      // with a 30s backoff cap, but we want the user to know after ~5 attempts
      // (~30–90s of dead transcript) that the issue is sustained, not a blip.
      // Reuse the stt-status channel with state='reconnecting' and a higher
      // attempts count so the renderer's existing banner picks it up.
      stt.on('persistent-reconnect', (info: { attempts: number }) => {
        console.warn(`[Main] STT persistent reconnect (${speaker}): ${info.attempts} consecutive attempts.`);
        this.sendSttStatus( {
          state: 'reconnecting',
          provider: sttProvider,
          error: `Reconnecting to transcription service — ${info.attempts} consecutive attempts. Check your network connection.`,
          channel: speaker,
          reconnectAttempts: info.attempts,
        } as SttStatusPayload);
      });
    }

    // B2: Emit 'awaiting-audio' once the STT provider is wired up but before
    // any audio has flowed. Renderers that joined mid-session sync to this
    // unverified state and display "Listening for audio…" until the first
    // isFinal transcript fires the 'connected' transition above.
    this.sendSttStatus({
      state: 'awaiting-audio',
      provider: sttProvider,
      channel: speaker,
    } as SttStatusPayload);

    return stt;
  }

  /**
   * REFACTOR: wireSystemCapture / wireMicCapture.
   *
   * Previously the listener-wiring blocks for SystemAudioCapture were
   * duplicated three times (setupSystemAudioPipeline + happy-path of
   * reconfigureAudio + fallback-path of reconfigureAudio), each with its own
   * closure-local chunk counter (`_sysChunkCount` / `_rcfgSysChunkCount` /
   * `_dfltSysChunkCount`) and slightly different log prefix. That made it
   * impossible to know which counter was active from the logs.
   *
   * Consolidation: a single helper attaches all four listeners against the
   * given capture instance. The `label` parameter only affects logging so
   * the originating call site is still identifiable. setupAudioRecoveryHandler
   * is also called here so every wire-up path gets recovery for free.
   */
  private wireSystemCapture(capture: SystemAudioCapture, label: string = ''): void {
    const prefix = label ? `[Main] ${label} ` : '[Main] ';
    let chunkCount = 0;
    // Watchdog: if no chunks arrive within 8s of capture start, the most likely
    // causes are (a) Screen Recording permission was revoked between the TCC
    // check and SCK init, (b) the meeting app routes audio to a device the
    // CoreAudio Tap isn't bound to, or (c) the system is genuinely silent.
    // Production-grade apps surface this so the user knows their interviewer's
    // audio isn't being picked up — instead of staring at an empty transcript.
    //
    // B11: timeout extended from 8000 → 12000ms. The ScreenCaptureKit fallback
    // path (macOS <14.4 hosts or where CoreAudio Tap init fails) takes 5-7s
    // to deliver its first audio buffer on a warm system, and ~8-10s on a
    // slower/contended host. The previous 8s timeout had only a 1-3s margin
    // and produced false-positive "0 chunks in 8s" banners during legitimate
    // SCK cold-start.
    const STUCK_WATCHDOG_MS = 12000;
    const systemAudioHealth = new SystemAudioHealthClassifier({ watchdogMs: STUCK_WATCHDOG_MS });
    const handleSystemAudioHealthDecision = (decision: any) => {
      if (!decision || decision.type === 'none') return;
      if (decision.type === 'log') {
        const logger = decision.level === 'info' ? console.log : console.warn;
        logger(`${prefix}${decision.message}`);
        return;
      }
      if (decision.type === 'warn-user' && decision.reason === 'same-device-input-output') {
        const msg = formatPermissionMessage('mac-same-device-input-output', { device: decision.device });
        console.warn(`${prefix}SystemAudioCapture ${msg}`);
        this.sendAudioCaptureFailed( {
          channel: 'system',
          message: msg,
          attempt: 0,
          maxAttempts: 3,
          terminal: decision.terminal,
          stuck: decision.stuck,
        });
      }
    };
    let stuckTimer: NodeJS.Timeout | null = null;
    const armStuckWatchdog = () => {
      handleSystemAudioHealthDecision(systemAudioHealth.handle({ kind: 'capture-started', nowMs: Date.now() }));
      if (stuckTimer) clearTimeout(stuckTimer);
      stuckTimer = setTimeout(() => {
        if (this.systemAudioCapture !== capture) return; // capture was replaced
        if (chunkCount > 0) return;                       // already producing
        if (!this.isMeetingActive) return;                // meeting ended

        // Bluetooth devices like AirPods register with separate identifiers
        // for input (cpal device name) and output (CoreAudio UID with
        // optional :input/:output suffix). When the user has the same
        // physical device on both sides of the pipeline, macOS cannot run a
        // CoreAudio Process Tap on it while it's also the active microphone
        // — the tap initializes "successfully" but every IO callback yields
        // zero frames. Surface the actual cause instead of a generic
        // "route mismatch" hint so the user knows what to change.
        // The same-device-input-output limitation is a CoreAudio Process Tap
        // constraint — only relevant on macOS. detectSameInputOutputDevice
        // is itself macOS-specific; skip the check on other platforms.
        const sameDeviceName = process.platform === 'darwin'
          ? this.detectSameInputOutputDevice()
          : null;
        if (sameDeviceName) {
          handleSystemAudioHealthDecision(systemAudioHealth.handle({
            kind: 'same-device-route-detected',
            nowMs: Date.now(),
            device: sameDeviceName,
          }));
          return;
        }

        handleSystemAudioHealthDecision(systemAudioHealth.handle({ kind: 'watchdog-tick', nowMs: Date.now() }));
      }, STUCK_WATCHDOG_MS);
    };

    // Synchronous disarm closure exposed on the capture instance so endMeeting()
    // and abortStaleAudioInit() can cancel the stuck watchdog BEFORE stop()/destroy()
    // — without relying on the on('stop') event firing synchronously. Otherwise a
    // short meeting that produced 0 chunks can fire a false "system-audio-stuck"
    // banner up to 12s after the user already stopped.
    const disarmStuckWatchdog = () => {
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
      handleSystemAudioHealthDecision(systemAudioHealth.handle({ kind: 'capture-stopped', nowMs: Date.now() }));
    };
    (capture as any).__disarmStuckWatchdog = disarmStuckWatchdog;
    capture.on('start', armStuckWatchdog);
    capture.on('stop', disarmStuckWatchdog);
    capture.on('data', (chunk: Buffer) => {
      const now = Date.now();
      handleSystemAudioHealthDecision(systemAudioHealth.handle({ kind: 'chunk', nowMs: now, chunk }));
      chunkCount++;
      if (chunkCount === 1 && stuckTimer) {
        clearTimeout(stuckTimer);
        stuckTimer = null;
      }
      if (!this._sysSttRateApplied && this.googleSTT && this.systemAudioCapture === capture) {
        const rate = capture.getSampleRate();
        this.googleSTT.setSampleRate(rate);
        this.googleSTT.setAudioChannelCount?.(1);
        this._sysSttRateApplied = true;
        console.log(`${prefix}Interviewer STT rate locked from first chunk: ${rate}Hz`);
      }
      if (chunkCount <= 3 || chunkCount % 500 === 0) {
        console.log(`${prefix}SystemAudio->STT: chunk #${chunkCount}, ${chunk.length}B, googleSTT=${this.googleSTT ? 'active' : 'NULL'}`);
      }


      this.googleSTT?.write(chunk);
    });
    capture.on('sample_rate_changed', (rate: number) => {
      console.log(`${prefix}SystemAudioCapture rate updated dynamically to ${rate}Hz`);
      this.googleSTT?.setSampleRate(rate);
    });
    capture.on('speech_ended', () => {
      this.googleSTT?.notifySpeechEnded?.();
    });
    // setupAudioRecoveryHandler registers its own 'error' listener — do not
    // add a duplicate logger here or the same error reports twice.
    this.setupAudioRecoveryHandler();
  }

  private wireMicCapture(capture: MicrophoneCapture, label: string = ''): void {
    const prefix = label ? `[Main] ${label} ` : '[Main] ';
    let chunkCount = 0;
    // Mirror of the system-audio stuck watchdog: if the cpal callback never
    // produces samples within STUCK_WATCHDOG_MS of start (USB mic that
    // disappears on open, exclusive-mode contention with another app,
    // default device returning a handle that's actually muted), surface a
    // clear UI signal instead of letting the user transcript silently die.
    //
    // B11: timeout extended from 8000 → 12000ms to mirror the system-audio
    // watchdog. cpal cold-start on USB hot-replug or Bluetooth HFP transition
    // can take 5-9s on contended hardware.
    const STUCK_WATCHDOG_MS = 12000;
    let stuckTimer: NodeJS.Timeout | null = null;
    const armStuckWatchdog = () => {
      if (stuckTimer) clearTimeout(stuckTimer);
      stuckTimer = setTimeout(() => {
        if (this.microphoneCapture !== capture) return;
        if (chunkCount > 0) return;
        if (!this.isMeetingActive) return;
        console.warn(`${prefix}MicrophoneCapture produced 0 chunks in ${STUCK_WATCHDOG_MS / 1000}s — likely silent capture (device contention, hot-unplug, or muted input).`);
        this.sendAudioCaptureFailed( {
          channel: 'mic',
          message: `No audio detected from your microphone for ${STUCK_WATCHDOG_MS / 1000}s. Check that your input device is unmuted and not in use by another app.`,
          attempt: 0,
          maxAttempts: 3,
          terminal: false,
          stuck: true,
        });
      }, STUCK_WATCHDOG_MS);
    };
    // Mirror wireSystemCapture: expose a synchronous disarm closure so the mic
    // stuck watchdog can be cancelled BEFORE stop()/destroy() during teardown.
    const disarmStuckWatchdog = () => {
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
    };
    (capture as any).__disarmStuckWatchdog = disarmStuckWatchdog;
    capture.on('start', armStuckWatchdog);
    capture.on('stop', disarmStuckWatchdog);
    // Inter-chunk gap tracking — see wireSystemCapture for rationale.
    let lastChunkAt = 0;
    // Mic TCC / muted-input zero-fill detector. cpal will happily open a mic
    // stream and deliver silent (peak=0) buffers when:
    //   - macOS Microphone permission was revoked between TCC check and start,
    //   - the OS muted the input via the menu bar mic indicator,
    //   - the hardware mic is physically muted (some Jabra/Bose headsets),
    //   - exclusive-mode contention with a meeting app (Zoom/Teams) on Windows.
    // Same shape as the system tap zero-fill: chunks arrive on cadence but every
    // sample is 0. Without this, the user just sees an empty user transcript
    // and assumes the meeting itself is broken.
    const ZEROFILL_OBSERVATION_MS = 12000;
    let firstChunkAt = 0;
    let zerofillLatched = false;
    let zerofillTriggered = false;
    // One-shot guard for the mid-meeting HFP-degradation backstop below.
    let hfpDegradationChecked = false;
    capture.on('data', (chunk: Buffer) => {
      const now = Date.now();
      if (lastChunkAt > 0) {
        const gap = now - lastChunkAt;
        if (gap > 2000 && gap < 8000) {
          console.warn(`${prefix}Mic chunk gap ${gap}ms — likely transient device change (USB hot-plug, BT reconnect). Resuming.`);
        }
      }
      lastChunkAt = now;
      chunkCount++;
      if (chunkCount === 1 && stuckTimer) {
        clearTimeout(stuckTimer);
        stuckTimer = null;
      }
      if (!this._micSttRateApplied && this.googleSTT_User && this.microphoneCapture === capture) {
        const rate = capture.getSampleRate();
        this.googleSTT_User.setSampleRate(rate);
        this.googleSTT_User.setAudioChannelCount?.(1);
        this._micSttRateApplied = true;
        console.log(`${prefix}User STT rate locked from first mic chunk: ${rate}Hz`);
      }

      // HFP-degradation backstop. The proactive reconfigureAudio check handles
      // the common case (default mic + Bluetooth output) at meeting start; this
      // catches what it can't see statically: the OS default mic resolving to a
      // Bluetooth device while output is the laptop speakers, or a device
      // dropping into HFP mid-meeting. The NATIVE rate is ground truth — macOS
      // opens a built-in/USB mic at 44.1/48kHz, but a Bluetooth mic in HFP "call
      // mode" reports ≤24kHz. So ≤24kHz native means the mic is degraded
      // regardless of how it's named ('default' lists as "Default Microphone",
      // never the hardware name — which is why the name check alone missed
      // AirPods). Checked once per capture (hfpDegradationChecked), after open.
      // Darwin-only: Windows BT mics don't exhibit this exact rate collapse.
      if (!hfpDegradationChecked && process.platform === 'darwin' && this.microphoneCapture === capture) {
        hfpDegradationChecked = true;
        try {
          const nativeRate = capture.getNativeSampleRate?.() ?? 0;
          if (nativeRate > 0 && nativeRate <= 24000) {
            const builtIn = this.findBuiltInInputDevice();
            const alreadyBuiltIn =
              !!builtIn &&
              !!this._lastRequestedInputDeviceId &&
              this.normalizeDeviceName(builtIn.name) ===
                this.normalizeDeviceName(this._lastRequestedInputDeviceId);

            if (builtIn && !alreadyBuiltIn) {
              // Auto-switch to the built-in mic — the "just works" path. The BT
              // device stays the audio OUTPUT (A2DP), so the user keeps hearing
              // the meeting in their earbuds. reconfigureAudio tears down +
              // recreates the mic capture, so defer it off the data handler to
              // avoid re-entrancy on the live stream.
              console.warn(`${prefix}Mic native rate ${nativeRate}Hz indicates Bluetooth HFP (degraded). Auto-switching to built-in mic "${builtIn.name}".`);
              this.broadcast('audio-input-auto-switched', {
                from: 'Bluetooth mic',
                to: builtIn.name,
                reason: 'bluetooth-hfp-avoided',
              });
              const outputId = this._lastRequestedOutputDeviceId;
              setImmediate(() => {
                if (this.isMeetingActive && this.microphoneCapture === capture) {
                  void this.reconfigureAudio(builtIn.id, outputId).catch(err =>
                    console.warn(`${prefix}HFP auto-switch reconfigure failed:`, err),
                  );
                }
              });
            } else if (!builtIn) {
              console.warn(`${prefix}Mic in HFP (native ${nativeRate}Hz) but no built-in mic to switch to.`);
              this.sendAudioCaptureFailed({
                channel: 'mic',
                message: `Your microphone is in low-quality Bluetooth call mode. Set your audio output to the speakers, or use a different mic, for better transcription.`,
                attempt: 0,
                maxAttempts: 0,
                terminal: false,
                stuck: false,
              });
            }
          }
        } catch (e) {
          console.warn(`${prefix}HFP degradation check failed (non-fatal):`, e);
        }
      }

      if (!zerofillLatched && !zerofillTriggered) {
        if (firstChunkAt === 0) firstChunkAt = now;
        // B10: peak-to-peak detection — see wireSystemCapture for full rationale.
        // Pre-fix `abs(sample) > 8` false-latched on DC bias from muted-but-biased
        // mics (USB/Bluetooth hardware bias of ±10..±50 is common), permanently
        // disabling the detector. Peak-to-peak (max - min) is DC-offset invariant.
        let minS = 32767;
        let maxS = -32768;
        const stride = Math.max(2, (chunk.length >> 5) & ~1);
        for (let i = 0; i + 1 < chunk.length; i += stride) {
          const s = chunk.readInt16LE(i);
          if (s < minS) minS = s;
          if (s > maxS) maxS = s;
        }
        const peakToPeak = maxS - minS;
        if (peakToPeak > 100) {
          zerofillLatched = true;
        } else if (now - firstChunkAt >= ZEROFILL_OBSERVATION_MS) {
          zerofillTriggered = true;
          console.warn(`${prefix}Mic chunks all zero-filled (peak-to-peak < 100) for ${ZEROFILL_OBSERVATION_MS / 1000}s — TCC denial or device-mute suspected.`);
          this.sendAudioCaptureFailed( {
            channel: 'mic',
            message: formatPermissionMessage('mic-zero-fill'),
            attempt: 0,
            maxAttempts: 3,
            terminal: false,
            stuck: true,
          });
        }
      }

      this.googleSTT_User?.write(chunk);
    });
    capture.on('sample_rate_changed', (rate: number) => {
      console.log(`${prefix}MicrophoneCapture rate updated dynamically to ${rate}Hz`);
      this.googleSTT_User?.setSampleRate(rate);
    });
    capture.on('speech_ended', () => {
      this.googleSTT_User?.notifySpeechEnded?.();
    });
    // setupMicRecoveryHandler registers its own 'error' listener.
    this.setupMicRecoveryHandler();
  }

  private async setupSystemAudioPipeline(): Promise<void> {
    // REMOVED EARLY RETURN: if (this.systemAudioCapture && this.microphoneCapture) return; // Already initialized

    try {
      // 1. Initialize Captures if missing
      // If they already exist (e.g. from reconfigureAudio), they are already wired to write to this.googleSTT/User
      //
      // B6: ALWAYS re-evaluate screen-recording permission at pipeline setup,
      // regardless of whether a SystemAudioCapture wrapper already exists.
      // Pre-fix this check was gated on `!this.systemAudioCapture`, so a stale
      // wrapper that survived from a prior meeting (mid-stream reconfigureAudio
      // failure, deferred teardown, etc.) would prevent the permission re-check,
      // and a between-meeting TCC revoke would cause the next meeting to
      // silently zero-fill with no banner — the exact pattern the audit
      // identified for "permissions granted (then revoked), no transcription."
      const screenCapability = await resolveMacScreenCaptureCapability('system audio pipeline setup');

      if (screenCapability.effectiveDenied) {
        const message = screenCapability.message ?? formatPermissionMessage('screen-recording-denied');
        console.warn('[Main] Screen Recording permission denied at pipeline setup. Tearing down any stale system audio capture; meeting will run mic-only.');
        this.sendSystemAudioPermissionDenied(message);
        this.broadcastDeviceSelection({
          kind: 'output',
          requested: null,
          actual: null,
          fellBack: true,
          reason: 'screen-recording-permission-denied',
        });
        // B6: tear down any stale capture so the 2nd meeting after a
        // between-meeting TCC revoke doesn't continue feeding the STT
        // pipeline zero-filled audio against a now-denied permission.
        if (this.systemAudioCapture) {
          try {
            await this.systemAudioCapture.destroy();
          } catch (destroyErr) {
            console.warn('[Main] Stale system audio capture destroy failed during permission-denied path:', destroyErr);
          }
          this.systemAudioCapture = null;
          this._sysSttRateApplied = false;
        }
      } else if (!this.systemAudioCapture) {
        // B3: wrap construction + wiring in its own try/catch so a native-module
        // failure (NAPI throw, HAL/WASAPI resource exhaustion, internal error
        // from SystemAudioCapture ctor) doesn't silently leave systemAudioCapture
        // null with no watchdog armed and no UI signal. Pre-fix the throw was
        // caught by the outer catch at the bottom of the function, which only
        // console.error'd — the caller then proceeded with a null capture, the
        // STT WS connected, the user saw "Listening for audio…" forever, and
        // no banner ever surfaced.
        try {
          this.systemAudioCapture = new SystemAudioCapture();
          this.wireSystemCapture(this.systemAudioCapture);
          // Transparency: tell the renderer which device is actually being captured
          // even on the no-metadata default path. Previously only reconfigureAudio
          // broadcast this, so a meeting started without an explicit device choice
          // left the UI in the dark about whether system audio was using the
          // expected output route.
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: null,
            actual: 'default',
            fellBack: false,
          });
        } catch (capErr) {
          console.error('[Main] SystemAudioCapture construction failed:', capErr);
          this.systemAudioCapture = null;
          this.sendAudioCaptureFailed({
            channel: 'system',
            message: 'System audio capture failed to initialize. The native audio module could not allocate the capture device. Restarting Natively may help; if the problem persists, file a bug.',
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }
      // If !effectiveDenied && this.systemAudioCapture already exists, the
      // existing wrapper is assumed correct (its watchdogs will detect any
      // zero-fill or stuck state and surface via audio-capture-failed).

      if (!this.microphoneCapture) {
        // B3: same defense for mic ctor throws (USB device disappears on open,
        // exclusive-mode steal). Outer try/catch only logged; user got no banner.
        try {
          this.microphoneCapture = new MicrophoneCapture();
          this.wireMicCapture(this.microphoneCapture);
        } catch (capErr) {
          console.error('[Main] MicrophoneCapture construction failed:', capErr);
          this.microphoneCapture = null;
          this.sendAudioCaptureFailed({
            channel: 'mic',
            message: 'Microphone capture failed to initialize. The native audio module could not open the default input device. Check that the device is connected and not in exclusive use by another app, then restart Natively.',
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }

      // 2. Initialize STT Services if missing
      // STT init wraps each createSTTProvider in its own try/catch so a single
      // provider failure (bad API key, missing credentials file, network error
      // during constructor) doesn't break the entire pipeline AND the user gets
      // a specific UI signal instead of the generic "no transcript" experience.
      const { CredentialsManager } = require('./services/CredentialsManager');
      const sttProv = CredentialsManager.getInstance().getSttProvider();

      if (!this.googleSTT) {
        console.log(`[Main] Creating interviewer STT provider: ${sttProv}`);
        try {
          this.googleSTT = this.createSTTProvider('interviewer');
        } catch (sttErr) {
          console.error(`[Main] Interviewer STT init failed (${sttProv}):`, sttErr);
          this.googleSTT = null;
        }
        if (!this.googleSTT) {
          this.sendAudioCaptureFailed( {
            channel: 'system',
            message: `Speech-to-text provider "${sttProv}" failed to initialize for the interviewer channel. Check your API key and credentials in Settings.`,
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }

      if (!this.googleSTT_User) {
        console.log(`[Main] Creating user STT provider: ${sttProv}`);
        try {
          this.googleSTT_User = this.createSTTProvider('user');
        } catch (sttErr) {
          console.error(`[Main] User STT init failed (${sttProv}):`, sttErr);
          this.googleSTT_User = null;
        }
        if (!this.googleSTT_User) {
          this.sendAudioCaptureFailed( {
            channel: 'mic',
            message: `Speech-to-text provider "${sttProv}" failed to initialize for the microphone channel. Check your API key and credentials in Settings.`,
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }

      // STT sample rate is now applied lazily on the first chunk arrival
      // (see the 'data' handlers above). Pre-configuring here was racy because
      // SystemAudioCapture's monitor doesn't exist until start() and returns
      // the constructor default (48000) until the native bg-init thread
      // publishes the real rate — which on Windows after Fix #2 is known
      // synchronously, but on macOS CoreAudio Tap takes ~5-7s to propagate.
      this._sysSttRateApplied = false;
      this._micSttRateApplied = false;

      if (this._verboseLogging) console.log('[Main] Full Audio Pipeline (System + Mic) Initialized (Ready)');

    } catch (err) {
      console.error('[Main] Failed to setup System Audio Pipeline:', err);
    }
  }

  /**
   * PERF: Pre-construct STT provider objects at app launch so the meeting-start
   * critical path doesn't pay for createSTTProvider (which does CredentialsManager
   * lookup + listener wiring + per-provider class init).
   *
   * NOTE: this only constructs the JS objects. Provider sockets are still opened
   * lazily on first .write() / .start() — opening idle sockets at app launch
   * would burn provider quota and is provider-specific behavior we don't want
   * to assume. The actual streaming-WebSocket cold-start is a separate (larger)
   * optimization that should be done per-provider.
   *
   * Safe to call multiple times: existence guards in setupSystemAudioPipeline
   * prevent duplicate construction.
   */
  public prewarmSttProviders(): void {
    // TEMPORARY LEAK-DIAGNOSIS gate (2026-07-10) — remove after root cause.
    if (process.env.NATIVELY_DISABLE_STT_PREWARM === '1') {
      console.warn('[LeakTest] NATIVELY_DISABLE_STT_PREWARM=1 → skipping STT pre-warm this run');
      return;
    }
    if (this.googleSTT && this.googleSTT_User) return;
    try {
      if (!this.googleSTT) {
        console.log('[Main] Pre-warming interviewer STT provider...');
        this.googleSTT = this.createSTTProvider('interviewer');
      }
      if (!this.googleSTT_User) {
        console.log('[Main] Pre-warming user STT provider...');
        this.googleSTT_User = this.createSTTProvider('user');
      }
    } catch (err) {
      // Pre-warm failure is non-fatal; setupSystemAudioPipeline will retry on
      // first meeting start with full error handling.
      console.warn('[Main] STT pre-warm failed (will retry on meeting start):', err);
    }
  }

  /**
   * Restart system + mic captures after a macOS sleep/wake cycle.
   *
   * Why this exists: when the laptop sleeps (lid close, "Sleep" menu, idle
   * timeout), CoreAudio invalidates the AggregateDevice handle, the SCK
   * stream silently dies, and the Process Tap stops delivering buffers. On
   * resume the OS doesn't notify our IO proc, so the captures sit there
   * looking healthy (chunkCount > 0 from before sleep, isRecording=true)
   * but never produce another chunk. The 8s no-chunks watchdog *would*
   * eventually fire, but only on the path where chunkCount stays at 0 — it
   * doesn't help mid-meeting after we've already seen audio.
   *
   * The WS connection is similarly half-dead: TCP keepalive won't notice
   * for 2+ hours on macOS, and meanwhile the renderer shows a frozen
   * transcript and a "Connected" badge.
   *
   * Cleanest fix: on system resume, if a meeting is active, destroy and
   * recreate both captures using the same device IDs the user originally
   * picked. The STT WS will close as a side effect of the capture stop and
   * reconnect via the existing scheduleReconnect path. Total dead air is
   * ~500ms — a small price for guaranteed recovery.
   */
  public async restartCapturesAfterResume(): Promise<void> {
    if (!this.isMeetingActive) {
      console.log('[Main] System resume — no active meeting, nothing to restart.');
      return;
    }
    console.log('[Main] System resume — restarting captures so CoreAudio/cpal handles are fresh.');

    // B7: reset ALL audio recovery state BEFORE recreating captures. State is
    // tied to a SPECIFIC capture instance's failure history; once we destroy
    // + recreate, the fresh captures must get a clean slate. Mirrors the
    // fuller reset done in startMeeting. Pre-fix:
    //   1. Counter saturation (attempts == 3) caused the early-return guards
    //      in setupMicRecoveryHandler / setupAudioRecoveryHandler to drop
    //      the FIRST post-wake error event silently — cpal frequently
    //      emits a transient 'error' on wake, which was the exact bug.
    //   2. A pre-sleep recovery in flight (`_*RecoveryInProgress = true`)
    //      AND its pending `_*RecoveryTimer` would still be referenced by
    //      the abandoned recovery promise after wake, so a stale recovery
    //      could land on a freshly recreated capture.
    this._systemAudioRecoveryInProgress = false;
    this._systemAudioRecoveryAttempts = 0;
    this._systemAudioConsecutiveFailures = 0;
    if (this._systemAudioRecoveryTimer) {
      clearTimeout(this._systemAudioRecoveryTimer);
      this._systemAudioRecoveryTimer = null;
    }
    this._micRecoveryInProgress = false;
    this._micRecoveryAttempts = 0;
    if (this._micRecoveryTimer) {
      clearTimeout(this._micRecoveryTimer);
      this._micRecoveryTimer = null;
    }

    // STT sockets do NOT reliably survive a sleep/wake cycle: the WebSocket can be
    // half-open (no FIN observed) so writes after wake silently go nowhere and no
    // transcript ever arrives. Recreating the captures alone (below) left the OLD
    // STT instances in place, relying on an assumed-but-not-coded reconnect (audit
    // finding #5). Explicitly tear them down here — same pattern as
    // _doReconfigureSttProvider — and recreate fresh instances after the captures
    // are back, so the data path wires to live sockets. Captures are already
    // stopped/destroyed below, so no audio events race this teardown.
    if (this.googleSTT) {
      try { this.googleSTT.stop(); this.googleSTT.removeAllListeners(); } catch (e) { console.warn('[Main] Resume: googleSTT teardown threw:', e); }
      this.googleSTT = null;
    }
    if (this.googleSTT_User) {
      try { this.googleSTT_User.stop(); this.googleSTT_User.removeAllListeners(); } catch (e) { console.warn('[Main] Resume: googleSTT_User teardown threw:', e); }
      this.googleSTT_User = null;
    }

    // Mic first. MicrophoneCapture is lazy-init: start() constructs the cpal
    // input stream. Do this before starting the CoreAudio system tap so cpal
    // does not negotiate input while the aggregate device IO proc is active.
    // Mic usually survives sleep, but recreate to be safe; cpal exclusive mode
    // on Windows can silently drop the stream.
    if (this.microphoneCapture) {
      try {
        await this.microphoneCapture.destroy();
      } catch (e) {
        console.warn('[Main] Resume: mic capture destroy threw:', e);
      }
      this.microphoneCapture = null;
    }
    try {
      this.microphoneCapture = new MicrophoneCapture(this._lastRequestedInputDeviceId);
      this._micSttRateApplied = false;
      this.wireMicCapture(this.microphoneCapture, '(Resume)');
      this.microphoneCapture.start();
    } catch (err) {
      console.error('[Main] Resume: failed to restart mic capture:', err);
      this.sendAudioCaptureFailed( {
        channel: 'mic',
        message: 'Microphone failed to restart after wake. Check that no other app holds the mic, then end and restart the meeting.',
        attempt: 0,
        maxAttempts: 0,
        terminal: true,
        stuck: false,
      });
    }

    // System audio (CoreAudio Tap is the most fragile across sleep cycles).
    // Start it after the mic stream has been constructed to avoid CoreAudio HAL
    // contention during resume as well as initial meeting start.
    if (this.systemAudioCapture) {
      try {
        await this.systemAudioCapture.destroy();
      } catch (e) {
        console.warn('[Main] Resume: system capture destroy threw:', e);
      }
      this.systemAudioCapture = null;
    }
    try {
      const screenCapability = await resolveMacScreenCaptureCapability('resume capture restart');
      if (screenCapability.effectiveDenied) {
        this.sendSystemAudioPermissionDenied( screenCapability.message ?? formatPermissionMessage('screen-recording-denied'));
        this.broadcastDeviceSelection({
          kind: 'output',
          requested: this._lastRequestedOutputDeviceId || null,
          actual: null,
          fellBack: true,
          reason: 'screen-recording-permission-denied',
        });
      } else {
        this.systemAudioCapture = new SystemAudioCapture(this._lastRequestedOutputDeviceId);
        this._sysSttRateApplied = false;
        this.wireSystemCapture(this.systemAudioCapture, '(Resume)');
        this.systemAudioCapture.start();
      }
    } catch (err) {
      console.error('[Main] Resume: failed to restart system capture:', err);
      this.sendAudioCaptureFailed( {
        channel: 'system',
        message: 'System audio capture failed to restart after wake. End and restart the meeting to recover.',
        attempt: 0,
        maxAttempts: 0,
        terminal: true,
        stuck: false,
      });
    }

    // Recreate the STT providers we tore down above so the freshly-restarted
    // captures feed live sockets (audit finding #5). Mirrors the STT block in
    // setupSystemAudioPipeline + the .start() in _doReconfigureSttProvider. Each
    // is guarded so a single provider failure doesn't abort the other channel; a
    // failed createSTTProvider leaves the field null and the capture's `?.write`
    // becomes a no-op rather than throwing. We only recreate ones we nulled, so
    // there is no risk of double-starting an existing provider.
    if (!this.googleSTT) {
      try {
        this.googleSTT = this.createSTTProvider('interviewer');
        this.googleSTT?.start();
      } catch (sttErr) {
        console.error('[Main] Resume: interviewer STT recreate failed:', sttErr);
        this.googleSTT = null;
      }
    }
    if (!this.googleSTT_User) {
      try {
        this.googleSTT_User = this.createSTTProvider('user');
        this.googleSTT_User?.start();
      } catch (sttErr) {
        console.error('[Main] Resume: user STT recreate failed:', sttErr);
        this.googleSTT_User = null;
      }
    }
  }

  /**
   * Broadcast which device the main process actually opened, vs what the
   * renderer requested. Renderer subscribes to this so it can show a banner
   * when fallback to default occurred (e.g. saved AirPods name no longer in
   * the cpal list because they're disconnected). Without this signal the UI
   * shows "AirPods selected" but capture is silently using built-in mic.
   */
  private broadcastDeviceSelection(payload: {
    kind: 'input' | 'output';
    requested: string | null;
    actual: string | null;
    fellBack: boolean;
    reason?: string;
  }): void {
    console.log(`[Main] device-selection-applied:`, payload);
    this.sendToSettingsSurfaces('device-selection-applied', payload);
  }

  /**
   * Normalize a device id from the renderer/localStorage into the canonical
   * "use the system default" form (undefined). Treats null, empty string, and
   * the literal sentinel "default" as equivalent to "no preference".
   *
   * This matters because Rust's `list_input_devices()` returns ("default",
   * "Default Microphone") as the first option, so the renderer's "Default"
   * dropdown choice gets persisted as the literal string "default" — which
   * is truthy in JS and would otherwise:
   *   - defeat the default-output watcher's `_lastRequestedOutputDeviceId`
   *     guard (it skipped polling for users on Default because the field
   *     was the truthy string "default" instead of undefined),
   *   - leave the reconfigureAudio device-id comparison dependent on the
   *     exact string the renderer happened to send,
   *   - cause the mic recovery handler to attempt recreation with the
   *     literal "default" string (which Rust handles correctly, but only
   *     because of explicit special-casing in microphone.rs/sck.rs).
   * Centralizing the normalization here keeps every downstream consumer on
   * the same page about what "default" actually means.
   */
  private normalizeDeviceId(id: string | null | undefined): string | undefined {
    if (!id) return undefined;
    const trimmed = id.trim();
    if (!trimmed) return undefined;
    if (trimmed.toLowerCase() === 'default') return undefined;
    return trimmed;
  }

  /**
   * Detect the case where the requested input and output devices are the same
   * physical hardware (typically AirPods on both sides). Input IDs come from
   * cpal (device name), output IDs come from CoreAudio (UID with optional
   * :input/:output suffix), so direct string comparison won't catch the
   * conflict. We resolve the output UID to a friendly name via
   * AudioDevices.getOutputDevices() and compare it to the input name (case-
   * insensitive). Returns the friendly name when a same-device conflict is
   * detected, undefined otherwise.
   */
  private detectSameInputOutputDevice(): string | undefined {
    return this.checkSameInputOutputDevice(this._lastRequestedInputDeviceId, this._lastRequestedOutputDeviceId);
  }

  /**
   * Pure variant of detectSameInputOutputDevice that takes the IDs as args
   * instead of reading from instance state. Used by reconfigureAudio so the
   * conflict check runs against the INCOMING request before instance state
   * is mutated, which would otherwise interact badly with the skip-if-
   * unchanged early-exit.
   */
  private checkSameInputOutputDevice(inputId?: string, outputId?: string): string | undefined {
    if (!inputId || !outputId) return undefined;

    // Strip the macOS CoreAudio :input/:output suffix before any comparison —
    // a single Bluetooth device can appear with both suffixes.
    const stripSuffix = (s: string) => s.replace(/:(input|output)$/i, '');
    const inputBase = stripSuffix(inputId).toLowerCase();
    const outputBase = stripSuffix(outputId).toLowerCase();
    if (inputBase === outputBase) {
      return stripSuffix(inputId);
    }

    // Resolve the output UID to its friendly name and compare to the input
    // name (input IDs from cpal ARE the device name, e.g. "Evin's AirPods Pro").
    try {
      const outputName = this.getEffectiveOutputDeviceName(outputId);
      if (outputName && outputName.toLowerCase() === inputId.toLowerCase()) {
        return outputName;
      }
    } catch {
      // Native module unavailable — fall through to "no conflict detected".
    }
    return undefined;
  }

  /**
   * Resolve an explicit output device id — or the current default output route
   * when the user selected Default — to the friendly output name. This is only
   * for HFP/default-input decision-making; it must not pin the persisted Default
   * output selection to a concrete device id.
   */
  private getEffectiveOutputDeviceName(outputDeviceId?: string): string {
    const stripSuffix = (s: string) => s.replace(/:(input|output)$/i, '');

    try {
      const outputs = AudioDevices.getOutputDevices();
      const resolveOutputName = (id?: string): string => {
        if (!id) return '';
        const outputBase = stripSuffix(id).toLowerCase();
        return outputs.find(
          d => stripSuffix(d.id).toLowerCase() === outputBase,
        )?.name ?? '';
      };

      const explicitName = resolveOutputName(outputDeviceId);
      if (explicitName) return explicitName;

      const NativeModule: any = loadNativeModule();
      if (NativeModule && typeof NativeModule.getDefaultOutputDeviceId === 'function') {
        const defaultOutputId = NativeModule.getDefaultOutputDeviceId() || undefined;
        return resolveOutputName(defaultOutputId);
      }
      return '';
    } catch {
      return '';
    }
  }

  /**
   * Pick the best mic to use when the requested input conflicts with the
   * audio output (same physical device — typically AirPods on both sides).
   * Built-in mics get first preference because they are always available
   * and never participate in the Bluetooth aggregate that's blocking the
   * tap. Falls back to any other input that isn't the conflicting device.
   * Returns undefined if nothing else is plugged in.
   */
  private pickFallbackInputDevice(conflictingName: string): { id: string; name: string } | undefined {
    try {
      const inputs = AudioDevices.getInputDevices();
      if (!inputs?.length) return undefined;

      const stripSuffix = (s: string) => s.replace(/:(input|output)$/i, '');
      const conflictBase = stripSuffix(conflictingName).toLowerCase();
      const isConflicting = (d: { id: string; name: string }) =>
        stripSuffix(d.id).toLowerCase() === conflictBase ||
        d.name.toLowerCase() === conflictBase;
      // Built-in mics on macOS show up as "MacBook Pro Microphone" / "MacBook
      // Air Microphone" / "Built-in Microphone" / "iMac Microphone". Match
      // loosely so we don't miss future Apple naming changes.
      const isBuiltIn = (d: { id: string; name: string }) =>
        /macbook|built[- ]?in|imac|mac\s+studio|mac\s+mini/i.test(d.name);

      return inputs.find(d => !isConflicting(d) && isBuiltIn(d))
          ?? inputs.find(d => !isConflicting(d));
    } catch {
      return undefined;
    }
  }

  /**
   * Loosely normalize a device name for comparison (lowercase, trim, collapse
   * unicode dashes, strip a :input/:output suffix). Mirrors the Rust-side
   * normalize_device_name so a single Bluetooth device that appears with
   * different suffixes/casing across the input and output lists compares equal.
   */
  private normalizeDeviceName(name: string): string {
    return (name || '')
      .replace(/:(input|output)$/i, '')
      .replace(/[–—−]/g, '-')
      .trim()
      .toLowerCase();
  }

  /**
   * Heuristic: is this device name a Bluetooth headset/earbud that macOS will
   * force into HFP ("Hands-Free"/call mode) when used as a microphone? In HFP
   * the mic collapses to ~16/24kHz, heavily band-limited telephone-grade audio
   * that wrecks STT accuracy (the AirPods "0 transcripts on Google" bug). We
   * match the explicit "Hands-Free" profile suffix macOS appends plus the
   * common BT families. Name-based because cpal/CoreAudio don't expose the
   * transport type at this layer.
   */
  private isBluetoothInputName(name: string): boolean {
    const n = this.normalizeDeviceName(name);
    if (!n) return false;
    if (n.includes('hands-free') || n.includes('handsfree') || n.includes('(hfp')) return true;
    const families = [
      'airpods', 'beats', 'bose', 'sony wh', 'sony wf', 'wh-1000', 'wf-1000',
      'jabra', 'galaxy buds', 'pixel buds', 'soundcore', 'jbl', 'sennheiser',
      'momentum', 'oneplus', 'one plus', 'buds', 'earbuds', 'earbud', 'tws',
      'bluetooth',
    ];
    return families.some(f => n.includes(f));
  }

  /** Find the built-in mic among current input devices, if present. */
  private findBuiltInInputDevice(): { id: string; name: string } | undefined {
    try {
      const builtIn = AudioDevices.getInputDevices().find(d =>
        /macbook|built[- ]?in|imac|mac\s+studio|mac\s+mini|internal/i.test(d.name),
      );
      return builtIn ? { id: builtIn.id, name: builtIn.name } : undefined;
    } catch {
      return undefined;
    }
  }

  private async reconfigureAudio(inputDeviceId?: string | null, outputDeviceId?: string | null): Promise<void> {
    console.log(`[Main] Reconfiguring Audio: Input=${inputDeviceId}, Output=${outputDeviceId}`);

    // PERF: skip the entire destroy+recreate cycle when neither device changed
    // since the last reconfigure AND both captures already exist. Each
    // destroy()+new() costs 50–200ms (macOS CoreAudio Tap re-init, Windows
    // WASAPI device contention, CPAL stream open). The common case — user
    // starts a second meeting with the same mic/speakers — hits this path.
    let wantedInput = this.normalizeDeviceId(inputDeviceId);
    const wantedOutput = this.normalizeDeviceId(outputDeviceId);

    // Auto-fallback for the "same device on both sides" conflict (most common
    // with AirPods used for both listening and the meeting mic). macOS won't
    // tap a device while it's also the active microphone — the system audio
    // capture would silently produce zero-filled buffers and the interviewer
    // transcript would stay empty. Switch the mic to a non-conflicting input
    // (built-in preferred) so the user can keep their headphones for audio
    // output without touching system settings.
    //
    // This check runs BEFORE the skip-if-unchanged comparison so the skip
    // path uses the post-fallback wantedInput. Otherwise a stale identical
    // request could short-circuit a needed re-resolution (e.g., user
    // unplugged the built-in fallback after the first reconfigure).
    let micAutoSwitched = false;
    if (wantedInput && wantedOutput) {
      const conflict = this.checkSameInputOutputDevice(wantedInput, wantedOutput);
      if (conflict) {
        const fallback = this.pickFallbackInputDevice(conflict);
        if (fallback) {
          console.warn(`[Main] I/O conflict detected (${conflict} on both sides). Auto-switching mic to "${fallback.name}".`);
          wantedInput = this.normalizeDeviceId(fallback.id);
          micAutoSwitched = true;
          this.broadcast('audio-input-auto-switched', {
            from: conflict,
            to: fallback.name,
            reason: 'same-device-conflict',
          });
        } else {
          console.warn(`[Main] I/O conflict detected (${conflict}) but no alternate input available — system audio will likely be silent.`);
        }
      }
    }

    // HFP avoidance: a Bluetooth mic forces macOS into HFP "call mode" the moment
    // it is opened for input — collapsing it to ~16/24kHz telephone-grade audio
    // that ruins STT (the AirPods bug). Prefer the built-in mic so the Bluetooth
    // device stays in high-quality A2DP for OUTPUT (the user keeps hearing the
    // meeting in their earbuds) — the "just works" path that matches competitors.
    //
    // Detection must handle the dominant real case: inputDeviceId === 'default'.
    // The 'default' list entry is literally named "Default Microphone" (Rust
    // list_input_devices), NOT the underlying hardware, so a name check on the
    // input alone never sees "AirPods". Reliable signals:
    //   (a) the input EXPLICITLY names a Bluetooth device, OR
    //   (b) the input is 'default' AND the OUTPUT is a Bluetooth device — macOS
    //       routes the default mic to that BT device in HFP whenever it is the
    //       active output. (Output = built-in speakers → default mic stays on the
    //       built-in mic, so we must NOT switch.)
    // The wireMicCapture native-rate backstop (≤24kHz after open) catches any
    // residual case this static check can't see. Skipped if the same-device
    // switch above fired, or no built-in mic exists (e.g. Mac mini / desktop).
    if (!micAutoSwitched) {
      try {
        const inputs = AudioDevices.getInputDevices();

        const explicitName = wantedInput
          ? inputs.find(d => d.id === wantedInput)?.name ?? ''
          : '';
        const inputIsExplicitBt = !!explicitName && this.isBluetoothInputName(explicitName);

        const outputName = this.getEffectiveOutputDeviceName(wantedOutput);
        const outputIsBt = !!outputName && this.isBluetoothInputName(outputName);
        const outputResolutionUnknown = !!wantedOutput && !outputName;
        const inputIsDefault = !wantedInput;
        const willBeHfp = inputIsExplicitBt || (inputIsDefault && (outputIsBt || outputResolutionUnknown));

        if (willBeHfp) {
          const fromLabel = inputIsExplicitBt ? explicitName : (outputName || 'Bluetooth mic');
          const builtIn = this.findBuiltInInputDevice();
          if (builtIn && this.normalizeDeviceName(builtIn.name) !== this.normalizeDeviceName(fromLabel)) {
            console.warn(`[Main] Bluetooth mic ("${fromLabel}") would force HFP (low quality). Auto-switching mic to "${builtIn.name}" to keep it in A2DP.`);
            wantedInput = this.normalizeDeviceId(builtIn.id);
            micAutoSwitched = true;
            this.broadcast('audio-input-auto-switched', {
              from: fromLabel,
              to: builtIn.name,
              reason: 'bluetooth-hfp-avoided',
            });
          } else if (!builtIn) {
            console.warn(`[Main] Bluetooth mic ("${fromLabel}") will run in HFP — no built-in mic available to switch to.`);
          }
        }
      } catch (e) {
        console.warn('[Main] HFP avoidance check failed (non-fatal):', e);
      }
    }

    if (
      this.systemAudioCapture &&
      this.microphoneCapture &&
      this._lastRequestedInputDeviceId === wantedInput &&
      this._lastRequestedOutputDeviceId === wantedOutput
    ) {
      console.log('[Main] Audio reconfigure skipped — device IDs unchanged.');
      return;
    }

    // Remember the (possibly fallback-overridden) input id so the mic-recovery
    // handler can recreate with the same selection if the cpal stream errors
    // out mid-meeting.
    this._lastRequestedInputDeviceId = wantedInput;
    this._lastRequestedOutputDeviceId = wantedOutput;
    // Reset mic recovery counter for the new device choice.
    this._micRecoveryAttempts = 0;

    // 1. System Audio (Output Capture)
    if (this.systemAudioCapture) {
      // destroy() calls stop() AND removeAllListeners(), preventing EventEmitter listener leaks.
      // Using stop()+null would orphan all 'data', 'speech_ended', 'sample_rate_changed'
      // closures (they still hold a ref to `this`) and trigger them on the next meeting.
      const oldSystemAudioCapture = this.systemAudioCapture;
      this.systemAudioCapture = null;
      await oldSystemAudioCapture.destroy();
    }

    const screenCapability = await resolveMacScreenCaptureCapability('audio reconfigure');
    if (screenCapability.effectiveDenied) {
      const message = screenCapability.message ?? formatPermissionMessage('screen-recording-denied');
      console.warn('[Main] Skipping SystemAudioCapture reconfigure — Screen Recording permission denied. Meeting will run mic-only.');
      this.sendSystemAudioPermissionDenied( message);
      this.broadcastDeviceSelection({
        kind: 'output',
        requested: wantedOutput || null,
        actual: null,
        fellBack: true,
        reason: 'screen-recording-permission-denied',
      });
    } else {
      try {
        console.log('[Main] Initializing SystemAudioCapture...');
        this.systemAudioCapture = new SystemAudioCapture(wantedOutput);
        this._sysSttRateApplied = false;
        this.wireSystemCapture(this.systemAudioCapture, '(Reconfigured)');
        console.log('[Main] SystemAudioCapture initialized.');
        this.broadcastDeviceSelection({
          kind: 'output',
          requested: wantedOutput || null,
          actual: wantedOutput || 'default',
          fellBack: false,
        });
      } catch (err) {
        console.warn('[Main] Failed to initialize SystemAudioCapture with preferred ID. Falling back to default.', err);
        try {
          this.systemAudioCapture = new SystemAudioCapture(); // Default
          this._sysSttRateApplied = false;
          this.wireSystemCapture(this.systemAudioCapture, '(Default)');
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: wantedOutput || null,
            actual: 'default',
            fellBack: true,
            reason: (err as Error)?.message || 'unknown',
          });
        } catch (err2) {
          console.error('[Main] Failed to initialize SystemAudioCapture (Default):', err2);
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: wantedOutput || null,
            actual: null,
            fellBack: true,
            reason: `Both preferred and default failed: ${(err2 as Error)?.message || 'unknown'}`,
          });
        }
      }
    }

    // 2. Microphone (Input Capture)
    if (this.microphoneCapture) {
      // destroy() calls stop() AND removeAllListeners(), preventing EventEmitter listener leaks.
      const oldMicrophoneCapture = this.microphoneCapture;
      this.microphoneCapture = null;
      await oldMicrophoneCapture.destroy();
    }

    try {
      console.log('[Main] Initializing MicrophoneCapture...');
      this.microphoneCapture = new MicrophoneCapture(wantedInput);
      this._micSttRateApplied = false;
      this.wireMicCapture(this.microphoneCapture, '(Reconfigured)');
      console.log('[Main] MicrophoneCapture initialized.');
      this.broadcastDeviceSelection({
        kind: 'input',
        requested: wantedInput || null,
        actual: wantedInput || 'default',
        fellBack: false,
      });
    } catch (err) {
      console.warn('[Main] Failed to initialize MicrophoneCapture with preferred ID. Falling back to default.', err);
      try {
        this.microphoneCapture = new MicrophoneCapture(); // Default
        this._micSttRateApplied = false;
        this.wireMicCapture(this.microphoneCapture, '(Default)');
        this.broadcastDeviceSelection({
          kind: 'input',
          requested: wantedInput || null,
          actual: 'default',
          fellBack: true,
          reason: (err as Error)?.message || 'unknown',
        });
      } catch (err2) {
        // Third-level fallback: enumerate every available input device and try
        // each in order. Common case where this matters: user has only
        // Bluetooth-HFP mics available (AirPods/Sony XM5), one of which
        // returns an unsupported sample format from cpal. Without this,
        // both `wantedInput` and `default` could be the SAME failing device,
        // and the user is left with a meeting that has zero mic input.
        console.warn('[Main] Default mic also failed. Enumerating remaining input devices to try each.', err2);
        const tried = new Set<string>([
          wantedInput ?? '',
          'default',
        ].filter(Boolean));
        const candidates = AudioDevices.getInputDevices()
          .map((d) => d.id)
          .filter((id) => id && !tried.has(id));
        let success = false;
        let lastErr: unknown = err2;
        for (const candidateId of candidates) {
          try {
            console.log(`[Main] Trying mic fallback candidate: ${candidateId}`);
            this.microphoneCapture = new MicrophoneCapture(candidateId);
            this._micSttRateApplied = false;
            this.wireMicCapture(this.microphoneCapture, `(Fallback:${candidateId})`);
            this.broadcastDeviceSelection({
              kind: 'input',
              requested: wantedInput || null,
              actual: candidateId,
              fellBack: true,
              reason: `Preferred and default failed; using ${candidateId}.`,
            });
            success = true;
            break;
          } catch (errN) {
            lastErr = errN;
            console.warn(`[Main] Fallback candidate ${candidateId} failed:`, errN);
          }
        }
        if (!success) {
          console.error('[Main] All input devices failed to initialize.', lastErr);
          this.microphoneCapture = null;
          this.broadcastDeviceSelection({
            kind: 'input',
            requested: wantedInput || null,
            actual: null,
            fellBack: true,
            reason: `All ${candidates.length + 2} input devices failed: ${(lastErr as Error)?.message || 'unknown'}`,
          });
          // Surface to UI so the user knows the meeting will be system-audio-only.
          this.sendAudioCaptureFailed( {
            channel: 'mic',
            message: 'No working microphone could be initialized. Disconnect and reconnect your audio devices, or restart the app.',
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }
    }

    if (this.isMeetingActive) {
      // Mic first: lazy mic start constructs the cpal input stream; do it
      // before starting the CoreAudio system tap to avoid HAL contention.
      this.microphoneCapture?.start();
      this.googleSTT_User?.start();
      this.systemAudioCapture?.start();
      this.googleSTT?.start();
    }
  }

  /**
   * Serialization mutex for reconfigureSttProvider.
   *
   * Crash/hang fix (2026-06-05): a single "save Natively API key" action can
   * fire up to TWO reconfigure calls back-to-back — one from the
   * `set-natively-api-key` handler (which auto-promotes the STT provider to
   * 'natively' and reconfigures), and one from the renderer's follow-up
   * `set-stt-provider('natively')` call. Each call tears down and rebuilds the
   * native captures (SystemAudioCapture / MicrophoneCapture → CoreAudio /
   * ScreenCaptureKit / WASAPI). Two interleaved teardown+construct sequences
   * against the same native device handles is a native-resource race that
   * deadlocks the OS audio stack or crashes the process — manifesting as the
   * "app hangs / freezes the system right after entering the key" reports on
   * BOTH macOS and Windows (the bug is in this cross-platform JS orchestration,
   * not in any OS-specific native code).
   *
   * Every other capture-mutating flow in this class is already guarded
   * (`_systemAudioRecoveryInProgress`, `_defaultOutputSwitchInProgress`); this
   * path was the one gap. We serialize rather than drop: the second caller
   * genuinely needs to apply the latest provider config, so it awaits the
   * in-flight reconfigure and then runs its own against fresh state.
   */
  private _sttReconfigureChain: Promise<void> = Promise.resolve();

  /**
   * Reconfigure STT provider mid-session (called from IPC when user changes provider)
   * Destroys existing STT instances and recreates them with the new provider.
   *
   * Concurrency: serialized via `_sttReconfigureChain`. Concurrent callers are
   * queued and run one-at-a-time, so the native captures are never torn down /
   * rebuilt in parallel. A throw in one queued reconfigure must not break the
   * chain for the next caller, so the chain link swallows the error here and
   * re-throws to THIS caller only.
   */
  public async reconfigureSttProvider(): Promise<void> {
    const run = this._sttReconfigureChain.then(
      () => this._doReconfigureSttProvider(),
      // Previous link rejected — its error already surfaced to its own caller.
      // Don't let it poison this link; proceed with our reconfigure.
      () => this._doReconfigureSttProvider(),
    );
    // Keep the chain alive regardless of this run's outcome so a failure never
    // wedges all future reconfigures.
    this._sttReconfigureChain = run.then(
      (): void => undefined,
      (): void => undefined,
    );
    return run;
  }

  private async _doReconfigureSttProvider(): Promise<void> {
    console.log('[Main] Reconfiguring STT Provider...');

    // RC-01 fix: pause audio captures FIRST so their EventEmitter queues drain
    // before we null-out the STT instances. Without this, buffered 'data' events
    // still in-flight call this.googleSTT?.write() while googleSTT is already null.
    if (this.isMeetingActive) {
      // Wait for native teardown before restarting below. This keeps the lazy
      // mic start from constructing a new cpal stream while the previous
      // CoreAudio tap / mic handle is still releasing on setImmediate.
      await Promise.all([
        Promise.resolve(this.systemAudioCapture?.stop()).catch((e) => {
          console.warn('[Main] Reconfigure STT: system capture stop threw:', e);
        }),
        (async () => {
          // This path immediately restarts the same wrapper below. Disable the
          // asynchronous pre-warm so stop() cannot race a freshly-started instance
          // by constructing an extra cpal stream in its post-teardown .then().
          this.microphoneCapture?.disablePreWarm();
          await this.microphoneCapture?.stop();
        })().catch((e) => {
          console.warn('[Main] Reconfigure STT: mic capture stop threw:', e);
        }),
      ]);
    }

    // Now safe to destroy STT instances — no more audio events incoming
    if (this.googleSTT) {
      this.googleSTT.stop();
      this.googleSTT.removeAllListeners();
      this.googleSTT = null;
    }
    if (this.googleSTT_User) {
      this.googleSTT_User.stop();
      this.googleSTT_User.removeAllListeners();
      this.googleSTT_User = null;
    }

    // Only reinitialize the pipeline when a meeting is already active.
    // Outside a meeting, defer pipeline creation to startMeeting() so we never
    // eagerly construct a MicrophoneCapture (which calls build_input_stream on
    // macOS and immediately triggers the orange mic indicator even without .play()).
    if (this.isMeetingActive) {
      await this.setupSystemAudioPipeline();
      // Mic first: lazy mic start constructs the cpal input stream; do it
      // before starting the CoreAudio system tap to avoid HAL contention.
      this.microphoneCapture?.start();
      this.googleSTT_User?.start();
      this.systemAudioCapture?.start();
      this.googleSTT?.start();
    }

    console.log('[Main] STT Provider reconfigured');

    // Broadcast the new STT config state to all windows so they can update banners / warnings
    const { CredentialsManager: CM } = require('./services/CredentialsManager');
    const newProvider = CM.getInstance().getSttProvider();
    this.broadcast('stt-config-changed', { configured: newProvider !== 'none', provider: newProvider });
  }

  /**
   * PR #173: Audio Recovery Handler
   *
   * Listens for 'audio-capture-failed' emit from SystemAudioCapture and
   * transparently restarts the full capture + STT pipeline without ending the
   * meeting session. Prevents silent audio loss when macOS CoreAudio or SCK
   * drops the capture stream mid-session (e.g. device re-plug, Display Sleep).
   */
  private _systemAudioRecoveryInProgress = false;
  private _systemAudioRecoveryAttempts = 0;
  private _systemAudioRecoveryTimer: NodeJS.Timeout | null = null;
  private _systemAudioLastFailureAt: number | null = null;
  private _systemAudioSuccessfulRestarts = 0;
  private _systemAudioConsecutiveFailures = 0;

  private setupAudioRecoveryHandler(): void {
    if (!this.systemAudioCapture) return;

    this.systemAudioCapture.on('error', async (err: Error) => {
      const recoveryMeetingGeneration = this._meetingGeneration;
      const isRecoveryCurrentMeeting = () => this.isMeetingActive && this._meetingGeneration === recoveryMeetingGeneration;
      if (!isRecoveryCurrentMeeting()) return; // Only attempt recovery during active meetings

      // Cross-flow mutex with handleDefaultOutputChanged. Both flows
      // destroy+recreate `this.systemAudioCapture`; without this guard, a
      // route change racing with a recovery would leave one of the two `fresh`
      // captures orphaned (still running, emitting chunks to nothing). The
      // route change will rebuild the capture on its next watcher tick, so
      // dropping the recovery attempt here is safe — the new capture won't
      // carry the original error condition.
      // Bail BEFORE incrementing _systemAudioConsecutiveFailures so the
      // counter only reflects errors we actually attempted to recover from.
      if (this._defaultOutputSwitchInProgress) {
        console.warn('[AudioRecovery] Route change in progress — deferring recovery to that flow.');
        return;
      }

      const now = Date.now();
      this._systemAudioLastFailureAt = now;
      this._systemAudioConsecutiveFailures++;

      // Cap at 3 consecutive recovery attempts to avoid infinite restart loops
      if (this._systemAudioRecoveryInProgress || this._systemAudioRecoveryAttempts >= 3) {
        console.warn(
          `[AudioRecovery] Skipping recovery — already in progress or max attempts (${this._systemAudioRecoveryAttempts}/3) reached.`,
        );
        return;
      }

      this._systemAudioRecoveryInProgress = true;
      this._systemAudioRecoveryAttempts++;
      console.warn(
        `[AudioRecovery] SystemAudioCapture error — attempting recovery #${this._systemAudioRecoveryAttempts}: ${err.message}`,
      );

      // Surface the failure to the UI so the user sees the actual cause (e.g.
      // "ScreenCaptureKit access denied", "No displays found") instead of just
      // a generic STT 'reconnecting' indicator. This event is non-fatal — the
      // recovery attempt may still succeed.
      this.sendAudioCaptureFailed( {
        channel: 'system',
        message: err.message,
        attempt: this._systemAudioRecoveryAttempts,
        maxAttempts: 3,
      });

      try {
        // Brief delay so the OS can release the device before re-acquisition
        await new Promise<void>(resolve => {
          this._systemAudioRecoveryTimer = setTimeout(resolve, 1500);
        });
        this._systemAudioRecoveryTimer = null;
        if (!isRecoveryCurrentMeeting()) {
          return;
        }

        // Recovery via destroy+recreate, NOT stop()+start():
        //   - SystemAudioCapture.stop() defers the native teardown via setImmediate
        //     so the synchronously-following start() runs while the Rust capture_thread
        //     is still Some, and Rust's start() returns "Capture already running".
        //   - The deferred stop also leaves the SCK/CoreAudio Tap holding device
        //     resources, so even if start() succeeded the BG thread couldn't
        //     re-acquire them.
        // destroy() (called via the new instance shadow) synchronously removes
        // listeners; the old monitor's stop/join still completes in setImmediate.
        // The new instance has its own fresh state so there's no race.
        const oldCapture = this.systemAudioCapture;
        oldCapture?.destroy();
        this.systemAudioCapture = null;
        this._sysSttRateApplied = false;

        const screenCapability = await resolveMacScreenCaptureCapability('system audio recovery');
        if (!isRecoveryCurrentMeeting()) {
          return;
        }
        if (screenCapability.effectiveDenied) {
          this.sendSystemAudioPermissionDenied( screenCapability.message ?? formatPermissionMessage('screen-recording-denied'));
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: this._lastRequestedOutputDeviceId || null,
            actual: null,
            fellBack: true,
            reason: 'screen-recording-permission-denied',
          });
          return;
        }

        const fresh = new SystemAudioCapture(this._lastRequestedOutputDeviceId);
        this.systemAudioCapture = fresh;
        this.wireSystemCapture(fresh, '(Recovery)');
        fresh.start();

        this._systemAudioSuccessfulRestarts++;
        this._systemAudioConsecutiveFailures = 0;
        console.log(
          `[AudioRecovery] SystemAudioCapture recreated successfully (total restarts: ${this._systemAudioSuccessfulRestarts}).`,
        );
      } catch (recoveryErr: any) {
        console.error(`[AudioRecovery] Recovery attempt #${this._systemAudioRecoveryAttempts} failed:`, recoveryErr);
        // If we've exhausted recovery, tell the renderer the failure is now terminal
        // for this meeting so it can stop showing "reconnecting" and surface a
        // mic-only banner instead.
        if (this._systemAudioRecoveryAttempts >= 3 && isRecoveryCurrentMeeting()) {
          this.sendAudioCaptureFailed( {
            channel: 'system',
            message: `System audio capture gave up after 3 attempts. Last error: ${recoveryErr?.message || err.message}`,
            attempt: this._systemAudioRecoveryAttempts,
            maxAttempts: 3,
            terminal: true,
          });
        }
      } finally {
        this._systemAudioRecoveryInProgress = false;
      }
    });
  }

  /**
   * Default-output-device watcher.
   *
   * macOS CoreAudio Tap is per-device — it captures audio from one specific
   * output device. When SystemAudioCapture is created with no device id (the
   * common case), the Rust side binds the tap to whatever the system default
   * output WAS at meeting start. If the user later changes their default
   * output (plugs in headphones, switches AirPods, routes to a virtual cable),
   * the tap stays bound to the original device and captures silence — the
   * interviewer transcript suddenly stops with no obvious cause.
   *
   * Production-grade fix: poll the platform default output id every few
   * seconds while a meeting is active. When the id changes, recreate the
   * SystemAudioCapture so the tap follows the new route. This only runs when
   * we're using the default route (no explicit user-selected output device);
   * if the user picked a specific device, we honor that choice and don't
   * second-guess it.
   *
   * Cost: one napi call (CoreAudio HAL property read) every 4s — negligible.
   */
  private _defaultOutputWatcherInterval: NodeJS.Timeout | null = null;
  private _lastObservedDefaultOutputId: string | null = null;
  private _defaultOutputSwitchInProgress = false;

  private startDefaultOutputWatcher(): void {
    if (this._defaultOutputWatcherInterval) return; // already running
    const NativeModule: any = loadNativeModule();
    if (!NativeModule || typeof NativeModule.getDefaultOutputDeviceId !== 'function') {
      // Older binary without the export — silently skip; the rest of the
      // pipeline still works, just without auto-recovery on route changes.
      console.log('[DefaultOutputWatcher] Native getDefaultOutputDeviceId unavailable — skipping route-change watcher.');
      return;
    }
    try {
      this._lastObservedDefaultOutputId = NativeModule.getDefaultOutputDeviceId() || '';
    } catch {
      this._lastObservedDefaultOutputId = '';
    }
    console.log(`[DefaultOutputWatcher] Started. Initial default output: ${this._lastObservedDefaultOutputId || '(none)'}`);

    this._defaultOutputWatcherInterval = setInterval(() => {
      if (this._isQuitting) return;
      if (!this.isMeetingActive) return;
      // Only watch when we're on the default route. If the user explicitly
      // picked an output device, respect that choice.
      if (this._lastRequestedOutputDeviceId) return;
      if (this._defaultOutputSwitchInProgress) return;
      if (!this.systemAudioCapture) return;

      let currentId = '';
      try {
        currentId = NativeModule.getDefaultOutputDeviceId() || '';
      } catch (err) {
        // CoreAudio momentarily unavailable during route change — skip this tick.
        return;
      }
      if (!currentId) return;
      if (currentId === this._lastObservedDefaultOutputId) return;

      console.warn(`[DefaultOutputWatcher] Default output changed: ${this._lastObservedDefaultOutputId} → ${currentId}. Rebinding CoreAudio Tap.`);
      this._lastObservedDefaultOutputId = currentId;
      this.handleDefaultOutputChanged().catch(err => {
        console.error('[DefaultOutputWatcher] Failed to rebind tap:', err);
      });
    }, 4000);
  }

  private stopDefaultOutputWatcher(): void {
    if (this._defaultOutputWatcherInterval) {
      clearInterval(this._defaultOutputWatcherInterval);
      this._defaultOutputWatcherInterval = null;
    }
    this._lastObservedDefaultOutputId = null;
  }

  // Public wrapper for the before-quit hook so shutdown can cancel the
  // interval without poking into a private method. Mirrors the meeting-end
  // path's stopDefaultOutputWatcher() call but is invoked from a context that
  // does not own a `this` reference inside the AppState class.
  public stopDefaultOutputWatcherForShutdown(): void {
    this.stopDefaultOutputWatcher();
  }

  private async handleDefaultOutputChanged(): Promise<void> {
    const meetingGeneration = this._meetingGeneration;
    const isCurrentMeeting = () => this.isMeetingActive && this._meetingGeneration === meetingGeneration;
    if (this._isQuitting) return;
    if (!isCurrentMeeting()) return;
    if (this._defaultOutputSwitchInProgress) return;
    // Cross-flow mutex: also bail if the recovery handler is mid-rebuild.
    // Both flows destroy + recreate `this.systemAudioCapture` and both await
    // resolveMacScreenCaptureCapability. Without this guard, the two `await`s
    // can interleave such that the recovery's `fresh` instance is assigned to
    // `this.systemAudioCapture`, then the route-change's `fresh` overwrites it
    // — leaving recovery's instance orphaned (still running, emitting chunks,
    // holding a CoreAudio Tap, double-writing to STT). Dropping this cycle is
    // safe: the watcher's setInterval will re-fire and pick up the route
    // change once recovery's instance is in place.
    if (this._systemAudioRecoveryInProgress) {
      console.log('[DefaultOutputWatcher] Recovery in progress — deferring route-change rebuild.');
      return;
    }
    this._defaultOutputSwitchInProgress = true;
    try {
      // Same destroy+recreate pattern as setupAudioRecoveryHandler — never
      // stop+start, since the deferred native teardown races the synchronous
      // start. Reset the recovery counter so a subsequent unrelated failure
      // gets its full 3-attempt budget.
      const oldCapture = this.systemAudioCapture;
      oldCapture?.destroy();
      this.systemAudioCapture = null;
      this._sysSttRateApplied = false;
      this._systemAudioRecoveryAttempts = 0;
      this._systemAudioConsecutiveFailures = 0;

      const screenCapability = await resolveMacScreenCaptureCapability('default output route change');
      if (this._isQuitting) return;
      if (!isCurrentMeeting()) {
        return;
      }
      if (screenCapability.effectiveDenied) {
        this.sendSystemAudioPermissionDenied( screenCapability.message ?? formatPermissionMessage('screen-recording-denied'));
        this.broadcastDeviceSelection({
          kind: 'output',
          requested: null,
          actual: null,
          fellBack: true,
          reason: 'screen-recording-permission-denied',
        });
        return;
      }

      // Pass undefined (not the new device id) so CoreAudio picks up the new
      // default at construction time. This is intentional: binding to a
      // stable id would defeat the whole point of "follow the user's route".
      const fresh = new SystemAudioCapture(undefined);
      this.systemAudioCapture = fresh;
      this.wireSystemCapture(fresh, '(RouteChanged)');
      fresh.start();
      // Tell the renderer what's happening so any "interviewer went silent"
      // banners can clear once chunks resume.
      this.broadcastDeviceSelection({
        kind: 'output',
        requested: null,
        actual: 'default',
        fellBack: false,
        reason: 'output-route-changed',
      });
      console.log('[DefaultOutputWatcher] CoreAudio Tap rebound to new default output.');
    } finally {
      this._defaultOutputSwitchInProgress = false;
    }
  }

  // Mic-side equivalent of setupAudioRecoveryHandler. Pre-fix the cpal err_fn
  // (USB unplug, device-format change, exclusive-mode steal) only logged to
  // stderr — JS never learned the mic stream had stopped producing samples
  // and the user's voice silently disappeared from the transcript.
  private _micRecoveryInProgress = false;
  private _micRecoveryAttempts = 0;
  private _micRecoveryTimer: NodeJS.Timeout | null = null;
  /** Last input device id passed to reconfigureAudio; used by mic recovery. */
  private _lastRequestedInputDeviceId: string | undefined = undefined;

  private setupMicRecoveryHandler(): void {
    if (!this.microphoneCapture) return;

    this.microphoneCapture.on('error', async (err: Error) => {
      // Guard with both live isMeetingActive and the meeting generation. The
      // live flag drops errors after Stop, while the generation check prevents
      // an old meeting's delayed recovery timer from restarting the mic after a
      // new meeting has begun.
      const micRecoveryMeetingGeneration = this._meetingGeneration;
      const isMicRecoveryCurrentMeeting = () => this.isMeetingActive && this._meetingGeneration === micRecoveryMeetingGeneration;
      if (!isMicRecoveryCurrentMeeting()) return;

      if (this._micRecoveryInProgress || this._micRecoveryAttempts >= 3) {
        console.warn(
          `[MicRecovery] Skipping recovery — already in progress or max attempts (${this._micRecoveryAttempts}/3) reached.`,
        );
        return;
      }

      this._micRecoveryInProgress = true;
      this._micRecoveryAttempts++;
      console.warn(
        `[MicRecovery] MicrophoneCapture error — attempting recovery #${this._micRecoveryAttempts}: ${err.message}`,
      );

      try {
        await new Promise<void>(resolve => {
          this._micRecoveryTimer = setTimeout(resolve, 1500);
        });
        this._micRecoveryTimer = null;
        if (!isMicRecoveryCurrentMeeting()) {
          return;
        }

        // Tear down + recreate the mic. Because MicrophoneCapture is lazy-init,
        // mic.start() constructs the cpal input stream. Pause system audio first
        // so cpal does not negotiate the mic stream while the CoreAudio aggregate
        // device IO proc is active — same HAL ordering invariant as startMeeting.
        const systemCapturePausedForMicRecovery = !!this.systemAudioCapture;
        const systemCapturePausedByMicRecovery = this.systemAudioCapture;
        if (systemCapturePausedByMicRecovery) {
          (systemCapturePausedByMicRecovery as any)?.__disarmStuckWatchdog?.();
          await systemCapturePausedByMicRecovery.stop();
        }

        let micRecoveryErr: any = null;
        try {
          if (this.microphoneCapture) {
            await this.microphoneCapture.destroy();
            this.microphoneCapture = null;
          }
          this._micSttRateApplied = false;

          try {
            this.microphoneCapture = new MicrophoneCapture(this._lastRequestedInputDeviceId);
          } catch (createErr) {
            console.warn('[MicRecovery] Saved device unavailable on recovery, falling back to default.', createErr);
            this.microphoneCapture = new MicrophoneCapture();
          }

          // Use the canonical wiring path (wireMicCapture) instead of hand-rolling
          // data/sample_rate_changed/speech_ended. Hand-rolled wiring drifts: this
          // recovery path used to omit the stuck-watchdog and zero-fill detector
          // (lines 1612-1693 of wireMicCapture), so after a mic recovery the user
          // would silently get zero-filled audio with no UI signal — exactly the
          // failure mode the watchdog was built to surface. setupMicRecoveryHandler
          // is invoked at the tail of wireMicCapture so we don't need a separate
          // call here either. Mirrors the system-audio recovery pattern at L2413.
          this.wireMicCapture(this.microphoneCapture, '(Recovery)');
          this.microphoneCapture.start();
        } catch (err) {
          micRecoveryErr = err;
        } finally {
          // Only restart the exact system wrapper WE paused. If a route-change
          // watcher or system-audio recovery rebuilt/restarted system audio while
          // mic recovery was in flight, that owner should keep control; starting
          // whatever happens to be in this.systemAudioCapture could resurrect a
          // stale wrapper or double-start a freshly-owned one.
          if (
            systemCapturePausedForMicRecovery &&
            systemCapturePausedByMicRecovery &&
            this.systemAudioCapture === systemCapturePausedByMicRecovery &&
            !this._defaultOutputSwitchInProgress &&
            !this._systemAudioRecoveryInProgress &&
            isMicRecoveryCurrentMeeting()
          ) {
            try {
              systemCapturePausedByMicRecovery.start();
            } catch (restartErr) {
              console.error('[MicRecovery] Failed to restart system audio after mic recovery pause:', restartErr);
              this.sendAudioCaptureFailed({
                channel: 'system',
                message: `System audio failed to restart after microphone recovery: ${(restartErr as Error)?.message || 'unknown error'}`,
                attempt: 0,
                maxAttempts: 0,
                terminal: false,
              });
            }
          }
        }

        if (micRecoveryErr) throw micRecoveryErr;

        this._micRecoveryAttempts = 0;
        console.log('[MicRecovery] MicrophoneCapture restarted successfully.');
      } catch (recoveryErr: any) {
        console.error(`[MicRecovery] Recovery attempt #${this._micRecoveryAttempts} failed:`, recoveryErr);
        // B4: surface a terminal failure to the CURRENT meeting after the same
        // 3-attempt cap that setupAudioRecoveryHandler uses for system audio
        // (see L2456-2464). Pre-fix, mic recovery exhausted attempts only via
        // console.error and the next 'error' was silently dropped by the
        // early-return guard at the top of this handler — user heard nothing
        // was being transcribed but no banner ever showed. Meeting-generation
        // check mirrors isRecoveryCurrentMeeting() in the system-side handler.
        if (this._micRecoveryAttempts >= 3 && isMicRecoveryCurrentMeeting()) {
          this.sendAudioCaptureFailed({
            channel: 'mic',
            message: `Microphone capture gave up after 3 attempts. Last error: ${recoveryErr?.message || err.message}`,
            attempt: this._micRecoveryAttempts,
            maxAttempts: 3,
            terminal: true,
          });
        }
      } finally {
        this._micRecoveryInProgress = false;
      }
    });
  }


  public async startAudioTest(deviceId?: string): Promise<void> {
    // P2-12: guard against two concurrent calls both passing the async permission check
    // before either has created a capture — the second call would orphan the first capture.
    if (this._audioTestStarting) return;
    // Block audio test while a meeting is live. Both code paths construct
    // their own MicrophoneCapture instance against the same device; on Windows
    // cpal grants exclusive access, so the second open silently degrades, and
    // on macOS the meeting's capture and the test capture compete for the
    // same input handle — symptom: meeting transcript stalls until the test
    // is closed. Reject the request loudly via the IPC error path so the
    // renderer can disable the Test button instead of letting the user think
    // their mic is broken.
    if (this.isMeetingActive) {
      throw new Error('Audio test is unavailable while a meeting is active. End the meeting first, then test your microphone.');
    }
    this._audioTestStarting = true;
    try {
      await this._startAudioTestImpl(deviceId);
    } finally {
      this._audioTestStarting = false;
    }
  }

  // UX4: system-audio probe runs in parallel with the mic test so users can
  // verify their system-audio capture path BEFORE starting a meeting.
  // Without this, the only signals were post-meeting watchdogs (8-12s after
  // meeting start), which is too late for a smooth "verify and proceed"
  // onboarding flow.
  private audioTestSystemCapture: SystemAudioCapture | null = null;
  // UX4 hardening (code-review HIGH): bumped on every startAudioTest call
  // AND every stopAudioTest call. The system-audio probe awaits
  // resolveMacScreenCaptureCapability for ~seconds; if the user closes the
  // Audio tab during that await, stopAudioTest fires but the subsequent
  // `new SystemAudioCapture(); start()` would orphan a capture with no
  // shutdown path. Snapshot this token before the await and bail if it has
  // changed by the time the await resolves.
  private _audioTestEpoch = 0;
  // HANG FIX: pending timer for the debounced system-audio probe. The CoreAudio
  // process-tap + aggregate-device teardown is a synchronous HAL operation that,
  // on a Bluetooth output route (e.g. AirPods), can stall coreaudiod's global HAL
  // lock for seconds — freezing the whole machine — when a tap is created and then
  // destroyed within ~1-2s. Rapidly opening the Audio tab and switching away does
  // exactly that. By deferring tap CREATION behind this timer (cleared on
  // stopAudioTest), a quick tab switch never creates the tap at all, so there is
  // nothing to tear down. The mic-level probe stays eager; only the system probe
  // (which owns the CoreAudio tap) is debounced.
  private _audioTestSystemProbeTimer: NodeJS.Timeout | null = null;

  private async _startAudioTestImpl(deviceId?: string): Promise<void> {
    console.log(`[Main] Starting Audio Test on device: ${deviceId || 'default'}`);
    this.stopAudioTest(); // Stop any existing test (also bumps _audioTestEpoch)
    // UX4 hardening: snapshot epoch BEFORE the system-audio probe's awaited
    // permission probe. If stopAudioTest fires while we're awaiting, the
    // post-await check below catches it and skips system-capture construction.
    const startEpoch = ++this._audioTestEpoch;
    const isCurrentTest = () => this._audioTestEpoch === startEpoch;

    if (!(await ensureMacMicrophoneAccess('audio test'))) {
      throw new Error(formatPermissionMessage('mic-denied'));
    }

    const broadcastTargets = (): BrowserWindow[] =>
      [
        this.settingsWindowHelper.getSettingsWindow(),
        this.getWindowHelper().getLauncherWindow(),
        this.getWindowHelper().getOverlayWindow(),
      ].filter((win): win is BrowserWindow => !!win && !win.isDestroyed());

    const computeRmsLevel = (chunk: Buffer): number => {
      let sum = 0;
      const step = 10;
      const len = chunk.length;
      for (let i = 0; i < len; i += 2 * step) {
        const val = chunk.readInt16LE(i);
        sum += val * val;
      }
      const count = len / (2 * step);
      if (count <= 0) return 0;
      const rms = Math.sqrt(sum / count);
      return Math.min(rms / 10000, 1.0);
    };

    const attachAudioTestListeners = (capture: MicrophoneCapture) => {
      capture.on('data', (chunk: Buffer) => {
        const targets = broadcastTargets();
        if (targets.length === 0) return;
        const level = computeRmsLevel(chunk);
        for (const target of targets) {
          this.sendToWindow(target, 'audio-test-level', level);
        }
      });

      capture.on('error', (err: Error) => {
        console.error('[Main] AudioTest Error:', err);
      });
    };

    // UX4: parallel system-audio probe. Wired AFTER the mic capture so a
    // missing screen-recording grant doesn't block the mic level meter.
    // Listeners include a TCC zero-fill detector (peak-to-peak < 100 for
    // the entire probe = TCC silently denied even though SCK started).
    const attachSystemTestListeners = (capture: SystemAudioCapture) => {
      capture.on('data', (chunk: Buffer) => {
        const targets = broadcastTargets();
        if (targets.length === 0) return;
        const level = computeRmsLevel(chunk);
        for (const target of targets) {
          this.sendToWindow(target, 'audio-test-system-level', level);
        }
      });
      capture.on('error', (err: Error) => {
        console.error('[Main] AudioTest System Error:', err);
        for (const target of broadcastTargets()) {
          this.sendToWindow(target, 'audio-test-system-error', err.message || String(err));
        }
      });
    };

    try {
      this.audioTestCapture = new MicrophoneCapture(deviceId || undefined);
      attachAudioTestListeners(this.audioTestCapture);
      this.audioTestCapture.start();
    } catch (err) {
      console.warn('[Main] Failed to start audio test on preferred device. Falling back to default.', err);
      // RC-02 fix: explicitly stop and null the failed capture before creating
      // the fallback to prevent a brief double-microphone-capture window.
      try {
        this.audioTestCapture?.disablePreWarm();
        this.audioTestCapture?.stop();
      } catch { /* ignore errors on already-failed capture */ }
      this.audioTestCapture = null;
      try {
        this.audioTestCapture = new MicrophoneCapture();
        attachAudioTestListeners(this.audioTestCapture);
        this.audioTestCapture.start();
      } catch (fallbackErr) {
        console.error('[Main] Failed to start audio test:', fallbackErr);
        throw fallbackErr;
      }
    }

    // Independent system-audio probe — failure here does NOT abort the mic
    // test. The renderer renders the system-level bar greyed-out + a
    // permission-denied notice if the screen capture probe couldn't start.
    try {
      const screenCapability = await resolveMacScreenCaptureCapability('audio test');
      // UX4 hardening: bail if a stopAudioTest fired during the await.
      // Constructing+starting a SystemAudioCapture after stop would orphan
      // the capture with no shutdown path.
      if (!isCurrentTest()) {
        console.log('[Main] Audio test was stopped during permission probe — skipping system capture construction.');
        return;
      }
      if (screenCapability.effectiveDenied) {
        for (const target of broadcastTargets()) {
          this.sendToWindow(
            target,
            'audio-test-system-error',
            screenCapability.message ?? formatPermissionMessage('screen-recording-denied'),
          );
        }
      } else {
        // HANG FIX: defer the CoreAudio tap creation behind a debounce. If the
        // user switches away from the Audio tab within this window, stopAudioTest
        // clears the timer and the tap is NEVER created — so coreaudiod never has
        // to tear down a freshly-created Bluetooth aggregate-device tap (the
        // operation that stalls the system-wide HAL lock and hangs the machine).
        // 600ms is long enough to absorb an accidental click-through, short enough
        // that a deliberate visit to the Audio tab still shows the system meter
        // promptly.
        if (this._audioTestSystemProbeTimer) {
          clearTimeout(this._audioTestSystemProbeTimer);
          this._audioTestSystemProbeTimer = null;
        }
        this._audioTestSystemProbeTimer = setTimeout(() => {
          this._audioTestSystemProbeTimer = null;
          // Re-check the epoch: a stopAudioTest (tab switch / close) bumps it and
          // would have cleared this timer, but guard anyway against races.
          if (!isCurrentTest()) {
            console.log('[Main] Audio test stopped during system-probe debounce — skipping CoreAudio tap creation.');
            return;
          }
          try {
            this.audioTestSystemCapture = new SystemAudioCapture();
            attachSystemTestListeners(this.audioTestSystemCapture);
            // INVARIANT: SystemAudioCapture.start() MUST remain synchronous (its
            // native CoreAudio init runs on a background thread and start()
            // returns instantly). Because nothing awaits between start() and the
            // isCurrentTest() re-check below, no stopAudioTest can interleave, so
            // this guard cannot itself trigger a create-then-immediately-destroy
            // teardown — the exact HAL stall this debounce exists to avoid. If
            // start() is ever made async/awaiting, this inline stop() would run
            // right after the tap is created and REINTRODUCE the hang; in that
            // case, defer/cancel here instead of calling stop() inline.
            this.audioTestSystemCapture.start();
            if (!isCurrentTest()) {
              try { this.audioTestSystemCapture?.stop(); } catch { /* ignore */ }
              this.audioTestSystemCapture = null;
            }
          } catch (probeErr: any) {
            console.warn('[Main] Deferred system-audio probe failed to start:', probeErr);
            for (const target of broadcastTargets()) {
              this.sendToWindow(
                target,
                'audio-test-system-error',
                probeErr?.message || 'System audio probe failed to start.',
              );
            }
          }
        }, 600);
      }
    } catch (sysErr: any) {
      console.warn('[Main] Failed to start system-audio probe:', sysErr);
      for (const target of broadcastTargets()) {
        this.sendToWindow(
          target,
          'audio-test-system-error',
          sysErr?.message || 'System audio probe failed to start.',
        );
      }
    }
  }

  public stopAudioTest(): void {
    // UX4 hardening: bump epoch so any in-flight _startAudioTestImpl that's
    // awaiting resolveMacScreenCaptureCapability sees the change and skips
    // constructing the system capture (avoids orphaned-capture race).
    this._audioTestEpoch++;
    // HANG FIX: cancel a pending debounced system-audio probe. If the user
    // switched away from the Audio tab before the 600ms timer fired, the
    // CoreAudio tap was never created — clearing the timer here ensures it
    // never will be for this (now stale) test, so there is no Bluetooth
    // aggregate-device teardown to stall coreaudiod.
    if (this._audioTestSystemProbeTimer) {
      clearTimeout(this._audioTestSystemProbeTimer);
      this._audioTestSystemProbeTimer = null;
    }
    // Also disable pre-warm so stop() doesn't pre-warm a new monitor that would
    // keep the DSP thread alive after the settings panel is closed. Mirrors
    // the endMeeting() pattern where disablePreWarm() is called before stop().
    this.audioTestCapture?.disablePreWarm();
    if (this.audioTestCapture) {
      console.log('[Main] Stopping Audio Test');
      this.audioTestCapture.stop();
      this.audioTestCapture = null;
    }
    // UX4: also stop the parallel system probe.
    if (this.audioTestSystemCapture) {
      try {
        this.audioTestSystemCapture.stop();
      } catch (e) {
        console.warn('[Main] Stopping system audio test threw:', e);
      }
      this.audioTestSystemCapture = null;
    }
  }

  public finalizeMicSTT(): void {
    // We only want to finalize the user microphone, because the context is Manual Answer
    if (this.googleSTT_User?.finalize) {
      console.log('[Main] Finalizing STT');
      this.googleSTT_User.finalize();
    }
  }

  public async startMeeting(metadata?: any): Promise<void> {
    console.log('[Main] Starting Meeting...', metadata);

    // If a previous endMeeting() is still draining STT in the background, wait
    // for it to finish before we boot a new session — otherwise the BG teardown
    // could call STT.stop() on instances the new meeting just started using.
    // In the common case (Stop, then Start seconds later) this awaits an
    // already-resolved promise and is free.
    if (this._pendingTeardown) {
      try {
        await this._pendingTeardown;
      } catch {
        // teardown already logs; safe to swallow here
      }
      this._pendingTeardown = null;
    }

    // PR #173: Reset audio recovery state for fresh session
    this._systemAudioRecoveryInProgress = false;
    this._systemAudioRecoveryAttempts = 0;
    this._systemAudioConsecutiveFailures = 0;
    this._micRecoveryAttempts = 0;
    if (this._systemAudioRecoveryTimer) {
      clearTimeout(this._systemAudioRecoveryTimer);
      this._systemAudioRecoveryTimer = null;
    }

    if (!(await ensureMacMicrophoneAccess('meeting start'))) {
      const message = formatPermissionMessage('mic-denied');
      this.broadcast('meeting-audio-error', message);
      // Tag the thrown error so the renderer's start-meeting caller (still on
      // the launcher — the overlay/meeting surface hasn't been shown yet, so
      // the in-overlay audio banner would not be visible) can recognise this
      // as a recoverable mic-permission denial and re-open the permissions
      // card instead of failing silently with only a console.error. Pre-fix,
      // a denied/revoked mic grant made "Start Natively" do nothing on screen.
      const err = new Error(message) as Error & { code?: string; channel?: string };
      err.code = 'mic-permission-denied';
      err.channel = 'mic';
      throw err;
    }

    // Check Screen Recording permission required for system audio capture
    // (CoreAudio Global Process Tap + ScreenCaptureKit both need this).
    // NOTE: The 'not-determined' TCC dialog is triggered once at app startup
    // (in initializeApp) so it never pops up mid-meeting here. We only act on
    // explicit 'denied' — in that case warn the user but let the meeting continue
    // with microphone-only transcription.
    if (process.platform === 'darwin') {
      const screenCapability = await resolveMacScreenCaptureCapability('meeting start');
      console.log(`[Main] macOS screen recording permission status: ${screenCapability.status}; capturable=${screenCapability.capturable}; sources=${screenCapability.sourceCount}`);
      if (screenCapability.effectiveDenied) {
        // Permission was explicitly denied — warn the user via the UI but do NOT
        // auto-open System Settings. Forcing that window open every meeting start
        // is extremely disruptive, especially when mic transcription is still working.
        // The UI will show a non-blocking banner; the user can fix it deliberately.
        const message = screenCapability.message ?? formatPermissionMessage('screen-recording-denied');
        console.warn('[Main]', message);
        this.sendSystemAudioPermissionDenied( message);
        // NOTE: Do NOT call shell.openExternal() here — it hijacks focus on every meeting
        // start. The UI banner (system-audio-permission-denied IPC event) handles this.
      }
      // 'not-determined': Handled at startup. SCK/CoreAudio will trigger the TCC
      // dialog itself when it first attempts to access screen content.
    }

    // Reset overlay position BEFORE the switch so the new meeting starts in
    // a predictable centered position regardless of where the previous
    // session left it. (Moved up from below so setWindowMode('overlay') reads
    // the reset bounds.)
    this.windowHelper.resetOverlayPosition();

    // ─── WINDOW SWAP BEFORE STATE BROADCAST ───────────────────────────────
    // Switch to the overlay BEFORE flipping `isMeetingActive` to true. If we
    // broadcast meeting-state-changed:{isActive:true} while the launcher is
    // still visible, the launcher's CTA pill briefly crossfades blue→green
    // before the renderer's follow-up setWindowMode('overlay') hides it —
    // visible as a flash. Switching first means the launcher hides before
    // the state event arrives, so the user only ever sees the overlay.
    this.windowHelper.setWindowMode('overlay');

    const meetingGeneration = ++this._meetingGeneration;
    this.isMeetingActive = true;
    this.broadcastMeetingState()
    if (metadata) {
      this.intelligenceManager.setMeetingMetadata(metadata);
    }

    // Phase 3 — bind dynamic action engine to this meeting + active mode.
    // Action store is per-(sessionId, modeId), so a fresh sessionId here gives
    // us per-meeting isolation. Re-binding on mode switch is handled in the
    // modes:set-active IPC handler.
    let _meetingTelemetrySessionId: string | undefined;
    try {
      const { ModesManager } = require('./services/ModesManager');
      const activeMode = ModesManager.getInstance().getActiveMode();
      if (activeMode) {
        const sessionId = `session_${crypto.randomUUID()}`;
        _meetingTelemetrySessionId = sessionId;
        this.intelligenceManager.setDynamicActionContext({
          sessionId,
          modeId: activeMode.id,
          modeTemplateType: activeMode.templateType,
        });
      }
    } catch (err) {
      // Auxiliary feature — never block meeting start.
      console.warn('[Main] failed to bind dynamic action context at meeting start:', (err as Error)?.message);
    }

    // Phase 6 — meeting_start telemetry (no transcript / no PII).
    try {
      const { telemetryService } = require('./services/telemetry/TelemetryService');
      const { ModesManager } = require('./services/ModesManager');
      const am = ModesManager.getInstance().getActiveMode();
      telemetryService.track({
        name: 'meeting_start',
        sessionId: _meetingTelemetrySessionId,
        modeId: am?.id,
        properties: { modeTemplateType: am?.templateType, hasMetadata: Boolean(metadata) },
      });
    } catch { /* non-fatal */ }

    // Emit session reset to clear UI state immediately
    this.sendToWindow(this.getWindowHelper().getOverlayWindow(), 'session-reset');
    this.sendToWindow(this.getWindowHelper().getLauncherWindow(), 'session-reset');

    // LOCAL-MODEL WARMUP: if the active model is a local Ollama model, warm + pin
    // it now (fire-and-forget) so the cold weight-load (8-12s for a 7-9B model)
    // happens DURING the meeting-start / audio-init window instead of on the user's
    // first live question — where it would otherwise blow the first-token deadline
    // and surface the canned fallback. Cloud models no-op here (prewarm returns
    // fast for non-Ollama), so a cloud session pays nothing. Never blocks start.
    try {
      const llmHelper = this.processingHelper.getLLMHelper();
      if (llmHelper?.isUsingOllama?.()) {
        llmHelper.prewarmPromptCache().catch((_e: any): void => {});
      }
    } catch { /* non-fatal — warmup must never block meeting start */ }

    // ★ ASYNC AUDIO INIT: Return INSTANTLY so the IPC response goes back
    // to the renderer immediately, allowing the UI to switch to overlay
    // without waiting for SCK/audio initialization (which takes 5-7 seconds).
    const audioInitController = new AbortController();
    this._audioInitController = audioInitController;
    const audioInitSignal = audioInitController.signal;
    this._audioInitPromise = (async () => {
      const isCurrentMeeting = () => this.isMeetingActive && this._meetingGeneration === meetingGeneration && !audioInitSignal.aborted;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      let systemCaptureOwnedByInit = this.systemAudioCapture;
      let microphoneCaptureOwnedByInit = this.microphoneCapture;
      let systemSttOwnedByInit = this.googleSTT;
      let userSttOwnedByInit = this.googleSTT_User;
      let ragManagerOwnedByInit = this.ragManager;
      let systemSttStartedByInit = false;
      let userSttStartedByInit = false;
      let liveIndexingStartedByInit = false;
      const abortStaleAudioInit = () => {
        if (this.systemAudioCapture === systemCaptureOwnedByInit) {
          (this.systemAudioCapture as any)?.__disarmStuckWatchdog?.();
          this.systemAudioCapture?.destroy();
          this.systemAudioCapture = null;
        }
        if (this.microphoneCapture === microphoneCaptureOwnedByInit) {
          (this.microphoneCapture as any)?.__disarmStuckWatchdog?.();
          this.microphoneCapture?.destroy();
          this.microphoneCapture = null;
        }
        if (systemSttStartedByInit) {
          if (this.googleSTT === systemSttOwnedByInit) this.googleSTT?.stop();
        }
        if (userSttStartedByInit) {
          if (this.googleSTT_User === userSttOwnedByInit) this.googleSTT_User?.stop();
        }
        if (liveIndexingStartedByInit) {
          if (this.ragManager === ragManagerOwnedByInit) this.ragManager?.stopLiveIndexing?.();
        }
      };

      if (!isCurrentMeeting()) {
        console.warn('[Main] Meeting was cancelled before audio pipeline could start — aborting init.');
        return;
      }
      try {
        // Check for audio configuration preference
        if (metadata?.audio) {
          await this.reconfigureAudio(metadata.audio.inputDeviceId, metadata.audio.outputDeviceId);
          if (!isCurrentMeeting()) {
            abortStaleAudioInit();
            return;
          }
          systemCaptureOwnedByInit = this.systemAudioCapture;
          microphoneCaptureOwnedByInit = this.microphoneCapture;
          systemSttOwnedByInit = this.googleSTT;
          userSttOwnedByInit = this.googleSTT_User;
          ragManagerOwnedByInit = this.ragManager;
        }

        // LAZY INIT: Ensure pipeline is ready (if not reconfigured above)
        await this.setupSystemAudioPipeline();
        if (!isCurrentMeeting()) {
          abortStaleAudioInit();
          return;
        }
        systemCaptureOwnedByInit = this.systemAudioCapture;
        microphoneCaptureOwnedByInit = this.microphoneCapture;
        systemSttOwnedByInit = this.googleSTT;
        userSttOwnedByInit = this.googleSTT_User;
        ragManagerOwnedByInit = this.ragManager;

        // Start Microphone FIRST. MicrophoneCapture is lazy-init: start()
        // constructs the cpal input stream. If we start the CoreAudio system
        // tap first, cpal can hang inside build_input_stream while the aggregate
        // device IO proc is already active (observed: logs stop after
        // `[Microphone] Device: ...`). Keep launch-time mic discipline by
        // staying lazy, but restore the pre-fix HAL ordering inside meetings.
        this.microphoneCapture?.start();
        this.googleSTT_User?.start();
        userSttStartedByInit = true;

        // Start System Audio after the mic stream has been constructed.
        this.systemAudioCapture?.start();
        this.googleSTT?.start();
        systemSttStartedByInit = true;

        // Start JIT RAG live indexing
        if (this.ragManager) {
          this.ragManager.startLiveIndexing('live-meeting-current');
          liveIndexingStartedByInit = true;
        }

        if (!isCurrentMeeting()) {
          abortStaleAudioInit();
          return;
        }

        // Watch for default-output route changes so the CoreAudio Tap follows
        // the user when they swap output devices mid-meeting (AirPods plug,
        // headphones, virtual cable). No-op if the user picked a specific
        // output or if the native binary lacks the getDefaultOutputDeviceId
        // export.
        this.startDefaultOutputWatcher();

        if (this._verboseLogging) {
          const requestedInput = metadata?.audio?.inputDeviceId || 'default';
          const requestedOutput = metadata?.audio?.outputDeviceId || 'default';
          const backend = requestedOutput === 'sck' ? 'sck' : 'coreaudio';
          const sysRate = this.systemAudioCapture?.getSampleRate() || 48000;
          const micRate = this.microphoneCapture?.getSampleRate() || 48000;
          console.log(`[Main][debug] Audio pipeline: input=${requestedInput} output=${requestedOutput} backend=${backend} sysRate=${sysRate}Hz micRate=${micRate}Hz`);
        }
        console.log('[Main] Audio pipeline started successfully.');
      } catch (err) {
        // An endMeeting()-driven abort (or a generation change) is expected — it is
        // NOT a real audio failure, so we must not surface a "pipeline failed" banner
        // for a Stop the user initiated themselves.
        const isAbort = (err as Error)?.message === 'audio_init_aborted' || !isCurrentMeeting();
        if (!isAbort) {
          console.error('[Main] Error initializing audio pipeline:', err);
          // Notify UI so user knows microphone/audio failed to start
          this.broadcast('meeting-audio-error', (err as Error).message || 'Audio pipeline failed to start');
        } else {
          abortStaleAudioInit();
        }
      } finally {
        if (this._meetingGeneration === meetingGeneration) this._audioInitPromise = null;
        if (this._audioInitController === audioInitController) {
          this._audioInitController = null;
        }
      }
    })(); // Defer to next event loop tick — ensures IPC response reaches renderer before audio init
  }

  public async endMeeting(): Promise<void> {
    // Idempotency guard: a double-click on Stop, or a Stop racing with a
    // global-shortcut reset, can deliver two endMeeting() calls within ms of
    // each other. Without this, both invocations would run the synchronous
    // teardown block (overwriting the in-flight `_pendingTeardown` promise
    // reference, breaking startMeeting()'s await on it, and both `finally`
    // handlers could clear `_isDraining` prematurely — truncating the trailing
    // transcript finals from the first teardown).
    if (this._endMeetingInFlight || (!this.isMeetingActive && this._pendingTeardown)) {
      console.log('[Main] endMeeting() ignored — teardown already in flight.');
      await this._pendingTeardown?.catch((): void => {});
      return;
    }
    // Cover the window between here and `_pendingTeardown` assignment, during which
    // the new in-flight-audio-init await below yields the event loop.
    this._endMeetingInFlight = true;
    console.log('[Main] Ending Meeting...');

    // Phase 6 — meeting_stop telemetry. Emit BEFORE any teardown so a crash
    // in stop logic still records the stop event.
    try {
      const { telemetryService } = require('./services/telemetry/TelemetryService');
      const { ModesManager } = require('./services/ModesManager');
      const am = ModesManager.getInstance().getActiveMode();
      telemetryService.track({
        name: 'meeting_stop',
        modeId: am?.id,
        properties: { modeTemplateType: am?.templateType },
      });
    } catch { /* non-fatal */ }

    // Reset Mouse Passthrough so the next meeting overlay starts fresh and focusable
    if (this.overlayMousePassthrough) {
      this.setOverlayMousePassthrough(false);
    }

    // ─── WINDOW SWAP BEFORE STATE BROADCAST ───────────────────────────────
    // Mirror startMeeting()'s ordering: swap the window BEFORE flipping
    // `isMeetingActive` and broadcasting. If the overlay receives
    // `meeting-state-changed:{isActive:false}` while it is still visible, the
    // overlay's React tree may begin unmount/cleanup paths (cancel streams,
    // clear effects) while still painted — combined with a same-instance theme
    // switch, that interleaving produces the half-painted overlay symptom the
    // user can only escape via force-quit. Hide first, then broadcast.
    this.windowHelper.setWindowMode('launcher');

    // ─── CLEAR THE OVERLAY TREE WHILE IT IS HIDDEN ─────────────────────────
    // The overlay BrowserWindow is PERSISTENT — created once with show:false
    // and thereafter only hide()/show()'d; its React tree is never unmounted
    // between meetings. The line above just hid it. If we don't clear it now,
    // the previous meeting's messages + expanded width survive into the next
    // meeting and are briefly VISIBLE the instant startMeeting() show()s the
    // window again — then torn down ON SCREEN (chat-list unmount + height
    // recompute + the shellWidth→OS-resize shrink) when the start-side
    // session-reset finally lands a few frames after show(). That on-screen
    // teardown is the "old UI flashes, then a choppy collapse" the user sees.
    //
    // Clearing HERE — after the window is hidden, with a whole meeting of idle
    // time before the next show() — means the overlay's mounted state is
    // already the clean collapsed baseline by the next meeting, so its FIRST
    // visible frame is clean and there is nothing to resize/tear down on
    // screen. The renderer's onSessionReset handler does the full synchronous
    // clear (messages, shellWidth→collapsed, code-expansion refs/timers); the
    // only change is that it now runs while hidden instead of while visible.
    //
    // Safe: the overlay is already hidden above and shows nothing post-stop —
    // trailing transcript finals (_isDraining), meeting save, and the
    // title/summary all run against the DB / other windows, never this tree.
    // The start-side session-reset (in startMeeting) is kept as a safety net
    // for the cold-start / crash-recovery path where endMeeting never ran; on
    // the normal Stop→Start path it is now a no-op (state already clean).
    this.sendToWindow(this.getWindowHelper().getOverlayWindow(), 'session-reset');

    // ─── UX STATE FLIP — SYNCHRONOUS ───────────────────────────────────────
    // Now flip the UX-facing meeting flag and broadcast. The launcher's
    // "Meeting ongoing" pill reverts to "Start Natively" immediately;
    // trailing transcript finals are still accepted via `_isDraining`.
    this.isMeetingActive = false;
    this._meetingGeneration++;
    this._isDraining = true;
    this.broadcastMeetingState();

    // ─── ABORT + AWAIT IN-FLIGHT AUDIO INIT (before any capture teardown) ───
    // If startMeeting()'s async audio init is still mid-`setupSystemAudioPipeline()`
    // it can construct/start a FRESH native capture AFTER our stop()/destroy() runs,
    // leaving a dangling CoreAudio/SCK handle — or both the dying and fresh captures
    // grab the HAL property-listener lock at once and freeze the main thread mid-paint.
    // abort() is synchronous (flips audioInitSignal.aborted so the init's
    // isCurrentMeeting() guards short-circuit and it tears down its own captures);
    // the await is INSTANT in the common case (_audioInitPromise is already null once
    // init completed) and only blocks in the narrow cold-start-then-immediate-Stop
    // window — where waiting is exactly what prevents the freeze. The launcher UI
    // already reverted above via broadcastMeetingState(), so perceived responsiveness
    // is unaffected.
    this._audioInitController?.abort();
    try {
      await this._audioInitPromise;
    } catch {
      // The init body may reject with the `audio_init_aborted` sentinel on abort — expected.
    }
    this._audioInitPromise = null;
    // The await (the only yield point before `_pendingTeardown` is assigned) is done;
    // the remaining teardown runs synchronously, so re-entry is no longer possible here
    // and the `_pendingTeardown`-based guard above takes over once it's set.
    this._endMeetingInFlight = false;

    // ─── SYNCHRONOUS: things the user expects "right now" on Stop click ────
    // Disarm the stuck-capture watchdogs BEFORE stop() — stop() flips isRecording
    // and schedules a deferred native teardown, so we cannot rely on the on('stop')
    // listener firing in time to cancel the 12s timer. Without this, a short meeting
    // that captured 0 chunks can fire a false "system-audio-stuck" banner after the
    // user already stopped. clearTimeout(null) is a no-op, so this is always safe.
    (this.systemAudioCapture as any)?.__disarmStuckWatchdog?.();
    (this.microphoneCapture as any)?.__disarmStuckWatchdog?.();

    // ─── CAPTURE TEARDOWN — DESTROY + RECREATE, NOT STOP + REUSE ───────────
    // Snapshot the live capture wrappers, then null the fields SYNCHRONOUSLY.
    // This is the fix for the second-meeting UI freeze: if we leave the
    // wrappers in place, a fast Stop→Start on the SAME device skips the
    // reconfigureAudio destroy+recreate path ("reconfigure skipped — device
    // IDs unchanged") and setupSystemAudioPipeline's `if (!this.microphoneCapture)`
    // guard, so MicrophoneCapture.start() ends up SYNCHRONOUSLY constructing a
    // fresh `new RustMicCapture` on the main thread WHILE the previous meeting's
    // deferred `monitor.stop()` is still releasing the same CoreAudio device —
    // both grab the HAL property-listener lock and deadlock the main thread.
    // Nulling here forces the next meeting down the serialized reconstruction
    // path, and the destroy() promises below are threaded into _pendingTeardown
    // (awaited by the next startMeeting) so the dying native handle is fully
    // released BEFORE any new capture is constructed on the same device.
    //
    // destroy() = disablePreWarm + (deferred) stop + removeAllListeners + null
    // monitor. It returns within ~1ms (the native teardown is on setImmediate);
    // we do NOT await it here — endMeeting still returns instantly.
    const dyingSystemCapture = this.systemAudioCapture;
    const dyingMicrophoneCapture = this.microphoneCapture;
    this.systemAudioCapture = null;
    this.microphoneCapture = null;
    const captureTeardownPromise = Promise.all([
      Promise.resolve(dyingSystemCapture?.destroy()).catch((e) => {
        console.error('[Main] System capture teardown failed:', e);
      }),
      Promise.resolve(dyingMicrophoneCapture?.destroy()).catch((e) => {
        console.error('[Main] Microphone capture teardown failed:', e);
      }),
    ]).then(() => {});

    // Stop the default-output watcher — no point polling CoreAudio while
    // there's no active capture to rebind.
    this.stopDefaultOutputWatcher();

    // Tell STT to mark the audio stream as ended; trailing finals will arrive
    // over the next ~150ms while we're already returning to the renderer.
    this.googleSTT?.finalize?.();
    this.googleSTT_User?.finalize?.();

    // ─── BACKGROUND: STT drain + meeting save + RAG embed ────────────────
    // Note: `isMeetingActive` was already flipped to false synchronously above
    // (so the launcher UI updates instantly). `_isDraining` is true during the
    // 250 ms grace window so the transcript handler keeps accepting trailing
    // finals — without that, the user's last sentence vanishes. We expose the
    // in-flight teardown as `_pendingTeardown` so a fast start→stop→start
    // sequence awaits this completion in startMeeting() before booting a new
    // session on the (still-shared) STT instances.
    const ragManager = this.ragManager;
    this._pendingTeardown = (async () => {
      // CRITICAL ORDERING: await the native capture teardown FIRST, before any
      // of the STT/RAG drain below. startMeeting() awaits this whole
      // _pendingTeardown promise before it constructs/starts a new capture, so
      // resolving captureTeardownPromise inside it guarantees the previous
      // meeting's `monitor.stop()` has released the CoreAudio device before the
      // next meeting opens it — closing the HAL-lock deadlock window. It is
      // awaited up front (not in parallel) so even a slow native release blocks
      // the next start rather than racing it.
      await captureTeardownPromise;
      try {
        // 0. Revert to Default Model. Moved into BG: getDefaultModel() and the
        //    provider list reads touch disk, and the 'model-changed' broadcast
        //    re-renders all open windows — both block the main thread/renderer
        //    during the Stop-click critical path. Doing it here means the
        //    revert lands ~250 ms after Stop, by which point the launcher is
        //    already painted and the overlay is hidden, so the user never
        //    sees a stutter.
        try {
          const { CredentialsManager } = require('./services/CredentialsManager');
          const cm = CredentialsManager.getInstance();
          const defaultModel = cm.getDefaultModel();
          const all = [...(cm.getCurlProviders() || []), ...(cm.getCustomProviders() || [])];
          console.log(`[Main] Reverting model to default: ${defaultModel}`);
          this.processingHelper.getLLMHelper().setModel(defaultModel, all);
          BrowserWindow.getAllWindows().forEach(win => {
            this.sendToWindow(win, 'model-changed', defaultModel);
          });
        } catch (e) {
          console.error('[Main] Failed to revert model:', e);
        }

        // 1. Grace window for STT trailing finals (Google/Soniox/Deepgram all
        //    reply to finalize() within 100–200ms). 250ms is conservative.
        await new Promise(resolve => setTimeout(resolve, 250));

        // 2. Tear down STT sockets now that finals have arrived.
        this.googleSTT?.stop();
        this.googleSTT_User?.stop();

        // 3. Snapshot transcript + persist placeholder + queue title/summary LLM.
        //    intelligenceManager.stopMeeting itself runs LLM in background.
        const meetingId = await this.intelligenceManager.stopMeeting();

        // 5. RAG cleanup — same logic as before, just inside the BG IIFE.
        if (meetingId) {
          if (ragManager) {
            await ragManager.stopLiveIndexing();
            console.log('[Main] Live RAG indexing stopped.');
          }
          await this.processCompletedMeetingForRAG(meetingId);
          if (ragManager && !this.isMeetingActive) {
            ragManager.deleteMeetingData('live-meeting-current');
            console.log('[Main] JIT RAG provisional chunks cleaned up.');
          } else if (this.isMeetingActive) {
            console.log('[Main] New meeting started during cleanup — skipping live-meeting-current deletion.');
          }
        } else {
          if (ragManager) {
            await ragManager.stopLiveIndexing().catch((): void => {});
            if (!this.isMeetingActive) ragManager.deleteMeetingData('live-meeting-current');
          }
        }
      } catch (err) {
        console.error('[Main] Background meeting teardown failed:', err);
      } finally {
        this._isDraining = false;
        this.clearTranscriptThrottle();
      }
    })();
    // endMeeting returns NOW — the IPC handler resolves and the renderer's
    // "Stop" button transitions instantly. Total endMeeting wall-clock time
    // is now bounded by the synchronous block above (~1–5ms typical).
  }

  private async processCompletedMeetingForRAG(meetingId: string): Promise<void> {
    if (!this.ragManager) return;

    // In-flight guard: rapid teardown paths (recovery retry + normal completion,
    // or back-to-back endMeeting calls) can enqueue the same meeting twice
    // before the first completes. Each invocation re-reads the transcript,
    // re-chunks, and re-queues embeddings — duplicating ~100ms-2s of work and
    // racing the SQLite INSERT-OR-IGNORE. Short-circuit if already in flight.
    if (this._ragProcessingInFlight.has(meetingId)) {
      console.log(`[AppState] RAG processing for ${meetingId} already in flight — skipping duplicate.`);
      return;
    }
    this._ragProcessingInFlight.add(meetingId);

    try {
      // Use the explicit meetingId passed from endMeeting() — deterministic, never
      // picks up a concurrently started meeting the way getRecentMeetings(1) could.
      const meeting = DatabaseManager.getInstance().getMeetingDetails(meetingId);
      if (!meeting || !meeting.transcript || meeting.transcript.length === 0) return;

      // Convert transcript to RAG format
      const segments = meeting.transcript.map(t => ({
        speaker: t.speaker,
        text: t.text,
        timestamp: t.timestamp
      }));

      // Generate summary from detailedSummary if available
      let summary: string | undefined;
      if (meeting.detailedSummary) {
        summary = [
          ...(meeting.detailedSummary.keyPoints || []),
          ...(meeting.detailedSummary.actionItems || []).map(a => `Action: ${a}`)
        ].join('. ');
      }

      const result = await this.ragManager.processMeeting(meeting.id, segments, summary);
      console.log(`[AppState] RAG processed meeting ${meeting.id}: ${result.chunkCount} chunks`);

    } catch (error) {
      console.error('[AppState] Failed to process meeting for RAG:', error);
    } finally {
      this._ragProcessingInFlight.delete(meetingId);
    }
  }

  private setupIntelligenceEvents(): void {
    const mainWindow = this.getMainWindow.bind(this)

    // Sprint 9: time-batched IPC token sends.
    //
    // Each LLM streaming token previously fired one webContents.send → one
    // structured-clone serialization → one IPC message. For a 400-token
    // answer at 100 tok/s that's 400 IPC messages over 4 seconds. With
    // Groq at 200+ tok/s the rate gets uncomfortable.
    //
    // Coalesce per-tick: a token arriving in the current libuv iteration
    // adds to a per-kind buffer. The first add schedules a setImmediate
    // flush that drains all buffers in one webContents.send per kind
    // (carrying an items array). Net: ~3-5× fewer IPC messages on hot
    // streams with no perceptible latency cost (sub-frame).
    //
    // The old per-token channels (intelligence-suggested-answer-token, etc.)
    // are NO LONGER USED for these 5 streams. The single
    // 'intelligence-token-batch' channel replaces them. The old channel
    // names + preload bridges are kept (defense-in-depth, no callers).
    type BatchKind = 'suggested_answer' | 'refined_answer' | 'recap' | 'clarify' | 'follow_up_questions';
    const tokenBatches = new Map<BatchKind, any[]>();
    let batchFlushScheduled = false;
    const flushBatchesNow = () => {
      const win = mainWindow();
      if (!win) { tokenBatches.clear(); return; }
      for (const [kind, items] of tokenBatches.entries()) {
        if (items.length > 0) {
          this.sendToWindow(win, 'intelligence-token-batch', { kind, items });
        }
      }
      tokenBatches.clear();
    };
    const scheduleBatchFlush = () => {
      if (batchFlushScheduled) return;
      batchFlushScheduled = true;
      setImmediate(() => {
        batchFlushScheduled = false;
        flushBatchesNow();
      });
    };
    const queueBatch = (kind: BatchKind, item: any) => {
      let arr = tokenBatches.get(kind);
      if (!arr) { arr = []; tokenBatches.set(kind, arr); }
      arr.push(item);
      scheduleBatchFlush();
    };
    // ORDER: every final-answer handler must call this BEFORE its own send so
    // the renderer sees (..., last tokens, final answer) and not (..., final
    // answer, trailing tokens) — the latter would clobber the just-finalized
    // row with appended text from a pending setImmediate batch.
    const flushBatchesBeforeFinal = flushBatchesNow;

    // Forward intelligence events to renderer
    this.intelligenceManager.on('assist_update', (insight: string) => {
      // Send to both if both exist, though mostly overlay needs it
      const helper = this.getWindowHelper();
      this.sendToWindow(helper.getLauncherWindow(), 'intelligence-assist-update', { insight });
      this.sendToWindow(helper.getOverlayWindow(), 'intelligence-assist-update', { insight });
    })

    // Phase 3 — Cluely-style dynamic action card. Forward to all open windows
    // (launcher + overlay) so whichever surface the user has up shows the card.
    this.intelligenceManager.on('dynamic_action_emitted', (action: any) => {
      const helper = this.getWindowHelper();
      this.sendToWindow(helper.getLauncherWindow(), 'intelligence-dynamic-action', { action });
      this.sendToWindow(helper.getOverlayWindow(), 'intelligence-dynamic-action', { action });
      // Phase 6 — telemetry: log detection (sanitized: NO transcript text, NO
      // evidence body — only ids, type, mode, confidence). The TelemetryService
      // sanitizer also strips transcript-shaped fields defensively.
      try {
        const { telemetryService } = require('./services/telemetry/TelemetryService');
        telemetryService.track({
          name: 'dynamic_action_detected',
          sessionId: action?.sessionId,
          modeId: action?.modeId,
          properties: {
            actionId: action?.id,
            actionType: action?.type,
            modeTemplateType: action?.modeTemplateType,
            confidence: action?.confidence,
            priority: action?.priority,
          },
        });
      } catch { /* non-fatal */ }
    })

    this.intelligenceManager.on('suggested_answer', (answer: string, question: string, confidence: number) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-suggested-answer', { answer, question, confidence })

    })

    this.intelligenceManager.on('suggested_answer_token', (token: string, question: string, confidence: number, generationId?: number) => {
      // Sprint 9: batch instead of per-token webContents.send.
      // generationId (audit finding #3): carried per-item so the renderer can
      // drop a batch belonging to a superseded live answer. Undefined for the
      // other live streams (code hint / brainstorm) — id-less items are accepted.
      queueBatch('suggested_answer', { token, question, confidence, generationId });
    })

    // Orphaned-scaffold fix: a what-to-answer stream that already showed a
    // coding scaffold ended with no final answer (superseded/declined/errored).
    // Tell the renderer to drop the open scaffold row. Flush pending token
    // batches first so a late scaffold batch can't re-mount the row afterwards.
    this.intelligenceManager.on('suggested_answer_discard', (reason: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-suggested-answer-discard', { reason })
    })

    // Verified code execution (background): a ✓ badge when the shown code passed
    // its executed test cases, and a NEW corrected message when it failed and a
    // re-verified fix was produced. Both arrive AFTER the answer was shown.
    this.intelligenceManager.on('code_verified', (info: { question: string; passed: number; total: number; language: string }) => {
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-code-verified', info)
    })
    this.intelligenceManager.on('code_correction', (info: { question: string; answer: string; note: string; reVerified: boolean }) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-code-correction', info)
    })

    // Sprint 7: dedicated negotiation-coaching channel. Engine emits this
    // INSTEAD of suggested_answer / suggested_answer_token when it detects
    // the coaching sentinel, so the renderer no longer needs JSON.parse-
    // every-token detection.
    this.intelligenceManager.on('negotiation_coaching', (payload: unknown) => {
      // Sprint 9: flush any pending batched tokens first so the renderer
      // sees them before the coaching card swap.
      flushBatchesBeforeFinal();
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-negotiation-coaching', { payload })
    })

    this.intelligenceManager.on('refined_answer_token', (token: string, intent: string) => {
      // Sprint 9: batch.
      queueBatch('refined_answer', { token, intent });
    })

    this.intelligenceManager.on('refined_answer', (answer: string, intent: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-refined-answer', { answer, intent })

    })

    this.intelligenceManager.on('recap', (summary: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-recap', { summary })
    })

    this.intelligenceManager.on('recap_token', (token: string) => {
      // Sprint 9: batch.
      queueBatch('recap', { token });
    })

    this.intelligenceManager.on('clarify', (clarification: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-clarify', { clarification })
    })

    this.intelligenceManager.on('clarify_token', (token: string) => {
      // Sprint 9: batch.
      queueBatch('clarify', { token });
    })

    this.intelligenceManager.on('follow_up_questions_update', (questions: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-follow-up-questions-update', { questions })
    })

    this.intelligenceManager.on('follow_up_questions_token', (token: string) => {
      // Sprint 9: batch.
      queueBatch('follow_up_questions', { token });
    })

    this.intelligenceManager.on('manual_answer_started', () => {
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-manual-started')
    })

    this.intelligenceManager.on('manual_answer_result', (answer: string, question: string) => {
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-manual-result', { answer, question })

    })

    this.intelligenceManager.on('mode_changed', (mode: string) => {
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-mode-changed', { mode })
    })

    this.intelligenceManager.on('error', (error: Error, mode: string) => {
      console.error(`[IntelligenceManager] Error in ${mode}:`, error)
      const win = mainWindow()
      this.sendToWindow(win, 'intelligence-error', { error: error.message, mode })
    })
  }





  public updateGoogleCredentials(keyPath: string): void {
    console.log(`[AppState] Updating Google Credentials to: ${keyPath}`);
    // Set global environment variable so new instances pick it up
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;

    if (this.googleSTT) {
      this.googleSTT.setCredentials(keyPath);
    }

    if (this.googleSTT_User) {
      this.googleSTT_User.setCredentials(keyPath);
    }
  }

  public setRecognitionLanguage(key: string): void {
    console.log(`[AppState] Setting recognition language to: ${key}`);
    const { CredentialsManager } = require('./services/CredentialsManager');
    CredentialsManager.getInstance().setSttLanguage(key);

    // 'auto' is only meaningful for NativelyProSTT — other providers fall back to en-US.
    const sttProvider = CredentialsManager.getInstance().getSttProvider();
    const effectiveKey = (key === 'auto' && sttProvider !== 'natively') ? 'english-us' : key;

    this.googleSTT?.setRecognitionLanguage(effectiveKey);
    this.googleSTT_User?.setRecognitionLanguage(effectiveKey);
    this.processingHelper.getLLMHelper().setSttLanguage(effectiveKey);
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  // Getters and Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public setLocalWhisperRecoveryNotice(notice: LocalWhisperRecoveryNotice): void {
    this.localWhisperRecoveryNotice = notice;
  }

  public takeLocalWhisperRecoveryNotice(): LocalWhisperRecoveryNotice | null {
    const notice = this.localWhisperRecoveryNotice;
    this.localWhisperRecoveryNotice = null;
    return notice;
  }

  public setOnnxRecoveryNotice(family: OnnxRecoveryFamily, notice: OnnxRecoveryNotice): void {
    this.onnxRecoveryNotices[family] = notice;
  }

  public takeOnnxRecoveryNotice(family: OnnxRecoveryFamily): OnnxRecoveryNotice | null {
    const notice = this.onnxRecoveryNotices[family];
    if (notice) delete this.onnxRecoveryNotices[family];
    return notice ?? null;
  }

  public getWindowHelper(): WindowHelper {
    return this.windowHelper
  }

  public getIntelligenceManager(): IntelligenceManager {
    return this.intelligenceManager
  }

  public getThemeManager(): ThemeManager {
    return this.themeManager
  }

  public getRAGManager(): RAGManager | null {
    return this.ragManager;
  }

  public getKnowledgeOrchestrator(): any {
    return this.knowledgeOrchestrator;
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
    this.screenshotHelper.setView(view)
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getProblemInfo(): any {
    return this.problemInfo
  }

  public setProblemInfo(problemInfo: any): void {
    this.problemInfo = problemInfo
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotHelper.getScreenshotQueue()
  }

  public getExtraScreenshotQueue(): string[] {
    return this.screenshotHelper.getExtraScreenshotQueue()
  }

  // Window management methods
  public setupOllamaIpcHandlers(): void {
    ipcMain.handle('get-ollama-models', async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout for detection

        const response = await fetch('http://localhost:11434/api/tags', {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          // data.models is an array of objects: { name: "llama3:latest", ... }
          return data.models.map((m: any) => m.name);
        }
        return [];
      } catch (error) {
        // console.warn("Ollama detection failed:", error);
        return [];
      }
    });
  }

  public createWindow(): void {
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(inactive?: boolean): void {
    if (this.windowHelper) {
      this.windowHelper.showMainWindow(inactive)
    }
  }

  public toggleMainWindow(): void {
    console.log(
      "Screenshots: ",
      this.screenshotHelper.getScreenshotQueue().length,
      "Extra screenshots: ",
      this.screenshotHelper.getExtraScreenshotQueue().length
    )

    const mode = this.windowHelper.getCurrentWindowMode();

    if (mode === 'launcher') {
      // In launcher mode, just physically hide/show the window
      this.windowHelper.toggleMainWindow();
    } else {
      // In overlay mode, send toggle-expand IPC to expand/collapse the UI
      const targetWindow = this.windowHelper.getOverlayWindow();
      this.sendToWindow(targetWindow, 'toggle-expand');
    }
  }

  public setWindowDimensions(width: number, height: number): void {
    this.windowHelper.setWindowDimensions(width, height)
  }

  public clearQueues(): void {
    this.screenshotHelper.clearQueues()

    // Clear problem info
    this.problemInfo = null

    // Reset view to initial state
    this.setView("queue")
  }

  private createScreenshotCaptureSession(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean
  ): ScreenshotCaptureSession {
    const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
    const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();

    return {
      captureKind,
      wasMainWindowVisible: this.windowHelper.isVisible(),
      windowMode: this.windowHelper.getCurrentWindowMode(),
      wasSettingsVisible: !!settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible(),
      wasModelSelectorVisible: !!modelSelectorWindow && !modelSelectorWindow.isDestroyed() && modelSelectorWindow.isVisible(),
      overlayBounds: this.windowHelper.getLastOverlayBounds(),
      overlayDisplayId: this.windowHelper.getLastOverlayDisplayId(),
      restoreWithoutFocus: process.platform === 'darwin' || !restoreFocus
    };
  }

  private getDisplayById(displayId: number | null): Electron.Display | undefined {
    if (displayId === null) return undefined;
    return screen.getAllDisplays().find(display => display.id === displayId);
  }

  private getTargetDisplayForFullScreenshot(session: ScreenshotCaptureSession): Electron.Display {
    if (session.windowMode === 'overlay' && session.overlayBounds) {
      return screen.getDisplayMatching(session.overlayBounds);
    }

    const lastOverlayDisplay = this.getDisplayById(session.overlayDisplayId);
    if (lastOverlayDisplay) {
      return lastOverlayDisplay;
    }

    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  private hideWindowsForScreenshot(session: ScreenshotCaptureSession): void {
    if (session.wasModelSelectorVisible) {
      this.modelSelectorWindowHelper.hideWindow();
    }

    if (session.wasSettingsVisible) {
      this.settingsWindowHelper.closeWindow();
    }

    if (session.wasMainWindowVisible) {
      this.hideMainWindow();
    }
  }

  private restoreWindowsAfterScreenshot(session: ScreenshotCaptureSession): void {
    const activate = !session.restoreWithoutFocus;
    const shouldRestoreMainWindow = session.wasMainWindowVisible;

    if (shouldRestoreMainWindow) {
      if (session.windowMode === 'overlay') {
        this.windowHelper.switchToOverlay(!activate);
      } else {
        this.windowHelper.switchToLauncher(!activate);
      }
    }

    if (session.wasSettingsVisible) {
      const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        const { x, y } = settingsWindow.getBounds();
        this.settingsWindowHelper.showWindow(x, y, { activate });
      }
    }

    if (session.wasModelSelectorVisible) {
      const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();
      if (modelSelectorWindow && !modelSelectorWindow.isDestroyed()) {
        const { x, y } = modelSelectorWindow.getBounds();
        this.modelSelectorWindowHelper.showWindow(x, y, { activate });
      }
    }
  }

  private async withScreenshotCaptureSession<T>(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean,
    capture: (session: ScreenshotCaptureSession) => Promise<T>
  ): Promise<T> {
    if (!this.getMainWindow()) {
      throw new Error("No main window available");
    }

    if (this.screenshotCaptureInProgress) {
      throw new Error("Screenshot capture already in progress");
    }

    const session = this.createScreenshotCaptureSession(captureKind, restoreFocus);
    this.screenshotCaptureInProgress = true;

    try {
      this.hideWindowsForScreenshot(session);
      // setOpacity(0) makes the window invisible to the compositor immediately
      // (within the current frame). hide() removes it from the event dispatch
      // tree synchronously. One compositor frame flush (~16ms) is enough for
      // macOS to stop including the window in the next capture frame. We wait
      // 80ms to give the GPU render server one full v-sync cycle + overhead,
      // which consistently avoids the black-frame artifact without the
      // excessive 150ms latency the old value imposed.
      await new Promise(resolve => setTimeout(resolve, process.platform === 'darwin' ? 80 : 40));
      return await capture(session);
    } finally {
      try {
        this.restoreWindowsAfterScreenshot(session);
      } finally {
        this.screenshotCaptureInProgress = false;
      }
    }
  }

  // Screenshot management methods
  public async takeScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('full', restoreFocus, (session) =>
      this.screenshotHelper.takeScreenshot(this.getTargetDisplayForFullScreenshot(session))
    )
  }

  /**
   * Capture the current screen and immediately request AI analysis (the
   * "capture-and-process" single-trigger). Extracted so both the
   * `general:capture-and-process` hotkey and the `general:capture-dom`
   * screenshot fallback share one path.
   */
  private async captureScreenAndProcess(): Promise<void> {
    const screenshotPath = await this.takeScreenshot(false);
    const preview = await this.getImagePreview(screenshotPath);
    // Ensure the window is visible so the user can see the response without stealing focus
    this.showMainWindow(true);
    // win.focus() can cause macOS to re-activate the app. Re-hide the dock
    // if we are in undetectable mode.
    if (process.platform === 'darwin' && this.isUndetectable) {
      app.dock.hide();
    }
    const mainWindow = this.getMainWindow();
    this.sendToWindow(mainWindow, 'capture-and-process', {
      path: screenshotPath,
      preview,
    });
  }

  public async takeSelectiveScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('selective', restoreFocus, async () => {
      let captureArea: Electron.Rectangle | undefined;

      if (process.platform === 'win32' || process.platform === 'darwin') {
        captureArea = await this.cropperWindowHelper.showCropper();

        if (!captureArea) {
          throw new Error("Selection cancelled");
        }
      }

      return this.screenshotHelper.takeSelectiveScreenshot(captureArea)
    })
  }

  public async getImagePreview(filepath: string): Promise<string> {
    return this.screenshotHelper.getImagePreview(filepath)
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.screenshotHelper.deleteScreenshot(path)
  }

  // New methods to move the window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public createTray(): void {
    this.showTray();
  }

  public showTray(): void {
    if (this.tray) return;

    // Try to find a template image first for macOS
    const resourcesPath = app.isPackaged ? process.resourcesPath : app.getAppPath();

    // Potential paths for tray icon
    const templatePath = path.join(resourcesPath, 'assets', 'iconTemplate.png');
    const defaultIconPath = app.isPackaged
      ? path.join(resourcesPath, 'src/components/icon.png')
      : path.join(app.getAppPath(), 'src/components/icon.png');

    let iconToUse = defaultIconPath;

    // Check if template exists (sync check is fine for startup/rare toggle)
    try {
      if (require('fs').existsSync(templatePath)) {
        iconToUse = templatePath;
        console.log('[Tray] Using template icon:', templatePath);
      } else {
        // Also check src/components for dev
        const devTemplatePath = path.join(app.getAppPath(), 'src/components/iconTemplate.png');
        if (require('fs').existsSync(devTemplatePath)) {
          iconToUse = devTemplatePath;
          console.log('[Tray] Using dev template icon:', devTemplatePath);
        } else {
          console.log('[Tray] Template icon not found, using default:', defaultIconPath);
        }
      }
    } catch (e) {
      console.error('[Tray] Error checking for icon:', e);
    }

    const trayIcon = nativeImage.createFromPath(iconToUse).resize({ width: 16, height: 16 });
    // IMPORTANT: specific template settings for macOS if needed, but 'Template' in name usually suffices
    trayIcon.setTemplateImage(iconToUse.endsWith('Template.png'));

    this.tray = new Tray(trayIcon)
    this.tray.setToolTip('Natively') // This tooltip might also need update if we change global shortcut, but global shortcut is removed.
    this.updateTrayMenu();

    // Double-click to show window
    this.tray.on('double-click', () => {
      this.centerAndShowWindow()
    })
  }

  public updateTrayMenu() {
    if (!this.tray) return;

    const keybindManager = KeybindManager.getInstance();
    const screenshotAccel = keybindManager.getKeybind('general:take-screenshot') || 'CommandOrControl+H';

    console.log('[Main] updateTrayMenu called. Screenshot Accelerator:', screenshotAccel);

    // Update tooltip for verification
    this.tray.setToolTip('Natively');

    // Helper to format accelerator for display (e.g. CommandOrControl+H -> Cmd+H)
    const formatAccel = (accel: string) => {
      return accel
        .replace('CommandOrControl', 'Cmd')
        .replace('Command', 'Cmd')
        .replace('Control', 'Ctrl')
        .replace('OrControl', '') // Cleanup just in case
        .replace(/\+/g, '+');
    };

    const displayScreenshot = formatAccel(screenshotAccel);
    // We can also get the toggle visibility shortcut if desired
    const toggleKb = keybindManager.getKeybind('general:toggle-visibility');
    const toggleAccel = toggleKb || 'CommandOrControl+B';
    const displayToggle = formatAccel(toggleAccel);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Natively',
        click: () => {
          this.centerAndShowWindow()
        }
      },
      {
        label: `Toggle Window (${displayToggle})`,
        click: () => {
          this.toggleMainWindow()
        }
      },
      {
        type: 'separator'
      },
      {
        label: `Take Screenshot (${displayScreenshot})`,
        accelerator: screenshotAccel,
        click: async () => {
          try {
            const screenshotPath = await this.takeScreenshot()
            const preview = await this.getImagePreview(screenshotPath)
            const mainWindow = this.getMainWindow()
            this.sendToWindow(mainWindow, 'screenshot-taken', {
              path: screenshotPath,
              preview,
            })
          } catch (error) {
            console.error("Error taking screenshot from tray:", error)
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'Command+Q',
        click: () => {
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  public hideTray(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  public setHasDebugged(value: boolean): void {
    this.hasDebugged = value
  }

  public getHasDebugged(): boolean {
    return this.hasDebugged
  }

  public setUndetectable(state: boolean): void {
    const decision = decideToggle(this.isUndetectable, state);

    // RC-2 fix: even when the value is unchanged, RE-BROADCAST the authoritative
    // state so a renderer whose optimistic toggle drifted out of sync (dropped/
    // duplicate event, concurrent shortcut press) heals itself. Previously this
    // path returned silently, leaving the UI showing the wrong state until the
    // user toggled to a *different* value (the "toggle does nothing" symptom).
    // The expensive macOS dock/focus side-effects below still only run on a real
    // change, so we don't thrash the dock on a no-op.
    if (!decision.changed) {
      this._broadcastToAllWindows('undetectable-changed', this.isUndetectable);
      return;
    }

    console.log(`[Stealth] setUndetectable(${state}) called`);

    this.isUndetectable = state
    this.windowHelper.setContentProtection(state)
    this.settingsWindowHelper.setContentProtection(state)
    this.modelSelectorWindowHelper.setContentProtection(state)
    this.cropperWindowHelper.setContentProtection(state)

    if (process.platform === 'win32') {
      this.windowHelper.syncOverlayInteractionPolicy();
      this.settingsWindowHelper.syncActivationPolicy();
      this.modelSelectorWindowHelper.syncActivationPolicy();
    }

    // Persist state via SettingsManager
    SettingsManager.getInstance().set('isUndetectable', state);

    // Cancel all pending disguise timers to prevent their app.setName() calls
    // from re-registering the dock icon after we hide it
    if (state) {
      for (const timer of this._disguiseTimers) {
        clearTimeout(timer);
      }
      this._disguiseTimers = [];
    }

    // Cancel any pending content-protection re-assert from a PREVIOUS toggle —
    // a fresh toggle supersedes it, and we don't want a stale follow-up pushing
    // an outdated sharingType after the user has changed their mind.
    for (const timer of this._dockReassertTimers) {
      clearTimeout(timer);
    }
    this._dockReassertTimers = [];

    // Broadcast state change to all relevant windows
    this._broadcastToAllWindows('undetectable-changed', state);

    // --- STEALTH MODE LOGIC ---
    // The dock hide/show is debounced: rapid toggles update isUndetectable
    // immediately (so content protection, IPC broadcasts and the guard above are
    // always current), but the actual macOS dock/tray/focus operation only fires
    // once the user stops toggling. The debounce window MUST be longer than a
    // human's fast toggle cadence (~250-350ms/click); at the old 150ms it
    // expired between clicks and every click fired its own dock op, churning the
    // activation policy. 350ms collapses a burst into a single settled
    // transition, after which _enforceDockState() verifies it actually stuck.
    if (process.platform === 'darwin') {
      if (this._dockDebounceTimer) {
        clearTimeout(this._dockDebounceTimer);
        this._dockDebounceTimer = null;
      }

      this._dockDebounceTimer = setTimeout(() => {
        this._dockDebounceTimer = null;

        // Read the settled state — may differ from the `state` captured above
        // if the user toggled again before the timer fired.
        const settled = this.isUndetectable;

        // Pre-toggle focus bookkeeping so the dock transition doesn't hand
        // keyboard focus to whatever app is behind us.
        const activeWindow = this.windowHelper.getMainWindow();
        const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
        let targetFocusWindow = activeWindow;
        if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) {
          targetFocusWindow = settingsWindow;
        }
        const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();
        const isModelSelectorVisible = modelSelectorWindow && !modelSelectorWindow.isDestroyed() && modelSelectorWindow.isVisible();

        if (targetFocusWindow && targetFocusWindow === settingsWindow) {
          this.settingsWindowHelper.setIgnoreBlur(true);
        }
        if (isModelSelectorVisible) {
          /* this.modelSelectorWindowHelper.setIgnoreBlur(true); */
        }

        // Drive the dock/tray to the settled state via a SELF-VERIFYING loop.
        // Issuing app.dock.hide()/show() once is unreliable after a burst of
        // toggles: macOS coalesces rapid activation-policy flips and can DROP
        // the final call (the symptom: "still shows in dock even in undetectable
        // mode"). enforceDockState() re-reads app.dock.isVisible() — the OS
        // ground truth — and re-applies until reality matches intent.
        this._enforceDockState(settled, targetFocusWindow, 0);

        if (targetFocusWindow && targetFocusWindow === settingsWindow) {
          setTimeout(() => { this.settingsWindowHelper.setIgnoreBlur(false); }, 500);
        }
        if (isModelSelectorVisible) {
          setTimeout(() => { /* this.modelSelectorWindowHelper.setIgnoreBlur(false); */ }, 500);
        }
      }, 350);
    }
  }

  // Self-verifying dock/tray enforcement. macOS asynchronously coalesces and
  // sometimes DROPS rapid app.dock.hide()/show() calls (each flips the app's
  // activation policy), so a single fire-and-forget call is not reliable after a
  // toggle burst. We poll app.dock.isVisible() — the OS ground truth — and
  // re-apply the desired state until it sticks (or the user changes intent).
  // Also re-asserts content protection on every hide, because the activation-
  // policy flip can reset each window's NSWindowSharingType.
  private _enforceDockState(
    wantUndetectable: boolean,
    targetFocusWindow: BrowserWindow | null,
    attempt: number,
    maxAttempts: number = 6,
  ): void {
    if (process.platform !== 'darwin') return;

    // Abort if the user toggled again since this enforcement was scheduled —
    // the newer toggle owns the dock now (and cleared these timers anyway).
    if (this.isUndetectable !== wantUndetectable) return;

    // app.dock.isVisible() is the OS ground truth. decideDockTransition tells us
    // whether the dock needs changing given the desired state and what's
    // currently applied (currentlyHidden = !visible).
    const currentlyHidden = !app.dock.isVisible();
    const { shouldApply } = decideDockTransition(wantUndetectable, currentlyHidden);

    if (shouldApply) {
      if (wantUndetectable) {
        const nativelyWasFocused =
          targetFocusWindow != null &&
          !targetFocusWindow.isDestroyed() &&
          targetFocusWindow.isFocused();

        console.log(`[Stealth] app.dock.hide() (enforce attempt ${attempt})`);
        app.dock.hide();
        this.hideTray();

        // Re-assert content protection: the activation-policy flip can reset
        // the windows' sharingType, silently undoing screen-capture stealth.
        this.reassertAllContentProtection();

        // Keep focus on Natively (win.focus(), not app.focus()) so dock.hide()'s
        // implicit app-deactivation doesn't hand control to the app behind us.
        if (nativelyWasFocused && targetFocusWindow && !targetFocusWindow.isDestroyed()) {
          targetFocusWindow.focus();
        }
      } else {
        console.log(`[Stealth] app.dock.show() (enforce attempt ${attempt})`);
        app.dock.show();
        this.showTray();
        // Do NOT call focus() — let the user's current app retain focus.
      }
    }

    // Verify it actually stuck. macOS may apply the policy change a tick later
    // (or drop it), so re-check a few times even when this pass looked correct.
    // Timers are tracked so the next toggle cancels stale enforcement.
    if (attempt < maxAttempts) {
      const t = setTimeout(() => {
        this._dockReassertTimers = this._dockReassertTimers.filter((x) => x !== t);
        this._enforceDockState(wantUndetectable, targetFocusWindow, attempt + 1, maxAttempts);
      }, 130);
      this._dockReassertTimers.push(t);
    }
  }

  // Force-reapply the current content-protection state to every window helper,
  // bypassing their dedupe guards. See setUndetectable() for why this is needed
  // after macOS dock/activation-policy transitions.
  private reassertAllContentProtection(): void {
    this.windowHelper.reassertContentProtection();
    this.settingsWindowHelper.reassertContentProtection();
    this.modelSelectorWindowHelper.reassertContentProtection();
    this.cropperWindowHelper.reassertContentProtection();
  }

  public getUndetectable(): boolean {
    return this.isUndetectable
  }

  // Converge a persisted-ON undetectable session to actually-stealth at startup.
  //
  // WHY this is needed separately from the pre-emptive app.dock.hide() in
  // initializeApp(): that hide runs BEFORE createWindow(), but creating and
  // showing the launcher window re-registers the app with macOS and re-shows the
  // dock icon, silently undoing the pre-emptive hide. The old startup code
  // assumed "dock already hidden, no action needed" — which is false — and never
  // ran any enforcement, so a persisted-ON launch came up NOT undetectable until
  // the user toggled off/on (which routes through the robust _enforceDockState
  // loop). This method runs that SAME self-verifying enforcement at startup:
  // re-assert content protection (window show can flip the activation policy and
  // reset sharingType) and drive the dock to hidden, retrying against the OS
  // ground truth so a late ready-to-show dock re-show is corrected.
  public applyInitialUndetectableState(): void {
    // Longer retry budget than the toggle path (~2.5s vs ~0.8s): at startup the
    // dock re-show lands at the launcher's ready-to-show, which on a cold launch
    // can arrive later than the toggle path's 6-retry window. Extra isVisible()
    // re-checks are cheap and stop early via the isUndetectable guard.
    this.reassertUndetectableStealth(18);
  }

  // Re-drive the app back to a fully-stealth state after any operation that can
  // silently undo it — used by both startup convergence (above) and, critically,
  // every launcher window show (WindowHelper.switchToLauncher).
  //
  // WHY launcher shows leak stealth: the launcher is a REGULAR macOS window (no
  // `type: 'panel'`, no skipTaskbar — unlike the overlay NSPanel). Calling
  // .show()+.focus() on it while the app is in accessory policy with the dock
  // tile hidden re-activates the app as a foreground app, which makes macOS
  // re-register it and REVEAL the dock tile — silently undoing app.dock.hide().
  // This is the "Natively icon appears in the dock after Stop meeting" bug:
  // endMeeting() swaps overlay→launcher, the activating show re-shows the tile,
  // and nothing re-asserted stealth afterward. It is intermittent because macOS
  // asynchronously coalesces and sometimes drops activation-policy/dock calls.
  //
  // This routes through the SAME self-verifying _enforceDockState() loop the
  // toggle path uses: it polls app.dock.isVisible() (the OS ground truth) and
  // re-applies dock.hide() + content protection until reality matches intent,
  // so it cannot be defeated by a dropped call or a late re-show. Cheap and safe
  // to call redundantly — it no-ops immediately off-darwin or when not
  // undetectable, and stops early via the isUndetectable guard inside the loop.
  public reassertUndetectableStealth(maxAttempts: number = 10): void {
    if (process.platform !== 'darwin') return;
    if (!this.isUndetectable) return;
    // Collapse any in-flight enforcement chain from a PRIOR re-assert before
    // starting a fresh one — same discipline as setUndetectable(). Without this,
    // a burst of launcher shows (rapid Stop→Start→Stop, or a cold-start
    // convergence overlapping a ready-to-show switchToLauncher) would spawn
    // several overlapping _enforceDockState chains. They are idempotent and
    // self-cancelling (all want dock hidden; each stops early once app.dock
    // reports hidden or the isUndetectable guard flips), so this is not a
    // correctness fix — it just avoids redundant isVisible() polling. The newest
    // re-assert owns the dock; the intent (want-hidden) is unchanged, so
    // cancelling the older timers loses nothing.
    for (const timer of this._dockReassertTimers) {
      clearTimeout(timer);
    }
    this._dockReassertTimers = [];
    this.reassertAllContentProtection();
    const focusWindow = this.windowHelper.getMainWindow();
    this._enforceDockState(true, focusWindow, 0, maxAttempts);
  }

  // --- Mouse Passthrough (Adapted from public PR #113 — verify premium interaction) ---
  private overlayMousePassthrough: boolean = false;

  public setOverlayMousePassthrough(state: boolean): void {
    const decision = decideToggle(this.overlayMousePassthrough, state);

    // RC-2 fix (see setUndetectable): always reconcile the renderer with the
    // authoritative state, even on a no-op, so the UI can never stay desynced.
    if (!decision.changed) {
      this._broadcastToAllWindows('overlay-mouse-passthrough-changed', this.overlayMousePassthrough);
      return;
    }

    console.log(`[Overlay] setOverlayMousePassthrough(${state}) called`);

    this.overlayMousePassthrough = state;
    this.windowHelper.syncOverlayInteractionPolicy();

    // Immediately revalidate global shortcuts after the window interaction-policy
    // changes.  The OS can silently drop Carbon/IOKit hotkey registrations when
    // window focusability or visibility changes; revalidating surgically
    // re-registers any that were lost without clobbering the others.
    KeybindManager.getInstance().revalidateShortcuts();

    this._broadcastToAllWindows('overlay-mouse-passthrough-changed', state);
  }

  public toggleOverlayMousePassthrough(): boolean {
    const next = !this.overlayMousePassthrough;
    this.setOverlayMousePassthrough(next);
    return next;
  }

  public getOverlayMousePassthrough(): boolean {
    return this.overlayMousePassthrough;
  }

  public getVerboseLogging(): boolean {
    return this._verboseLogging;
  }

  public setVerboseLogging(enabled: boolean): void {
    this._verboseLogging = enabled;
    setVerboseLoggingFlag(enabled);
    SettingsManager.getInstance().set('verboseLogging', enabled);
    console.log(`[AppState] verboseLogging set to ${enabled}`);
    // Notify all renderer windows so they can start/stop forwarding their console output
    this.broadcast('verbose-logging-changed', enabled);
  }

  public setDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
    mode = normalizeDisguiseMode(mode);
    this.disguiseMode = mode;
    SettingsManager.getInstance().set('disguiseMode', mode);

    // NO runtime activation-policy churn here — and this is deliberate.
    //
    // The dual-dock-icon bug is a STARTUP phenomenon: the app is born, paints a
    // tile, THEN renames via app.setName()+CFBundleName, and the LaunchServices
    // re-registration races into a second tile. That path is fully handled at
    // startup by LSUIElement (the bundle is born tile-less) plus the one-shot
    // accessory→regular promotion after createWindow() — see the whenReady block.
    //
    // At RUNTIME the app already owns a single stable 'regular' dock tile, and
    // app.setName() updates that tile's label in place rather than spawning a
    // duplicate. The old code still bracketed this rename in accessory→regular
    // "to be safe", but that round-trip deactivates the whole application for a
    // tick — the always-on-top overlay/launcher windows leave the foreground
    // layer and snap back, producing a visible disappear/reappear flicker on
    // every disguise switch. Trading a guaranteed flicker for a hypothetical
    // duplicate tile is the wrong deal, so the bracket is gone. With no policy
    // change the app never deactivates, so there is also nothing to re-focus.
    //
    // Stealth is unaffected: _applyDisguise() already skips app.setName() and
    // app.dock.setIcon() when isUndetectable (the dock stays hidden), and we
    // never promote activation policy here.
    this._applyDisguise(mode);
  }

  public applyInitialDisguise(): void {
    this._applyDisguise(this.disguiseMode);
  }

  private _applyDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
    let appName = "Natively";
    let iconPath = "";

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    switch (mode) {
      case 'terminal':
        appName = isWin ? "Command Prompt " : "Terminal ";
        if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/win/terminal.png")
            : path.join(app.getAppPath(), "assets/fakeicon/win/terminal.png");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/mac/terminal.png")
            : path.join(app.getAppPath(), "assets/fakeicon/mac/terminal.png");
        }
        break;
      case 'settings':
        appName = isWin ? "Settings " : "System Settings ";
        if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/win/settings.png")
            : path.join(app.getAppPath(), "assets/fakeicon/win/settings.png");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/mac/settings.png")
            : path.join(app.getAppPath(), "assets/fakeicon/mac/settings.png");
        }
        break;
      case 'activity':
        appName = isWin ? "Task Manager " : "Activity Monitor ";
        if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/win/activity.png")
            : path.join(app.getAppPath(), "assets/fakeicon/win/activity.png");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/mac/activity.png")
            : path.join(app.getAppPath(), "assets/fakeicon/mac/activity.png");
        }
        break;
      case 'none':
      default:
        appName = "Natively";
        if (isMac) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "natively.icns")
            : path.join(app.getAppPath(), "assets/natively.icns");
        } else if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/icons/win/icon.ico")
            : path.join(app.getAppPath(), "assets/icons/win/icon.ico");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "icon.png")
            : path.join(app.getAppPath(), "assets/icon.png");
        }
        break;
    }

    console.log(`[AppState] Applying disguise: ${mode} (${appName}) on ${process.platform}`);

    // 1. Update process title (affects Activity Monitor / Task Manager)
    process.title = appName;

    // 2. Update app name (affects macOS Menu / Dock)
    // Skip when undetectable — app.setName() causes macOS to re-register
    // the app and re-show the dock icon even after dock.hide()
    if (!this.isUndetectable) {
      app.setName(appName);
    }

    if (isMac) {
      process.env.CFBundleName = appName.trim();
    }

    // 3. Update App User Model ID (Windows Taskbar grouping)
    if (isWin) {
      // Use unique AUMID per disguise to avoid grouping with the real app
      app.setAppUserModelId(`com.natively.assistant.${mode}`);
    }

    // 4. Update Icons
    if (fs.existsSync(iconPath)) {
      const image = nativeImage.createFromPath(iconPath);

      if (isMac) {
        // Skip dock icon update when dock is hidden to avoid potential flicker
        if (!this.isUndetectable) {
          app.dock.setIcon(image);
        }
      } else {
        // Windows/Linux: Update all window icons
        this.windowHelper.getLauncherWindow()?.setIcon(image);
        this.windowHelper.getOverlayWindow()?.setIcon(image);
        this.settingsWindowHelper.getSettingsWindow()?.setIcon(image);
      }
    } else {
      console.warn(`[AppState] Disguise icon not found: ${iconPath}`);
    }

    // 5. Update Window Titles
    const launcher = this.windowHelper.getLauncherWindow();
    if (launcher && !launcher.isDestroyed()) {
      launcher.setTitle(appName.trim());
      this.sendToWindow(launcher, 'disguise-changed', mode);
    }

    const overlay = this.windowHelper.getOverlayWindow();
    if (overlay && !overlay.isDestroyed()) {
      overlay.setTitle(appName.trim());
      this.sendToWindow(overlay, 'disguise-changed', mode);
    }

    const settingsWin = this.settingsWindowHelper.getSettingsWindow();
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.setTitle(appName.trim());
      this.sendToWindow(settingsWin, 'disguise-changed', mode);
    }

    // Cancel any stale forceUpdate timeouts from previous disguise changes
    for (const timer of this._disguiseTimers) {
      clearTimeout(timer);
    }
    this._disguiseTimers = [];

    // Periodically re-assert process.title only — it can drift on some systems.
    // NOTE: We intentionally do NOT call app.setName() here — it was already called
    // synchronously above, and repeated calls on macOS cause the system to briefly
    // show a second dock tile while re-registering the app identity.
    const scheduleUpdate = (ms: number) => {
      const ts = setTimeout(() => {
        process.title = appName;
        this._disguiseTimers = this._disguiseTimers.filter(t => t !== ts);
      }, ms);
      this._disguiseTimers.push(ts);
    };

    scheduleUpdate(200);
    scheduleUpdate(1000);
    scheduleUpdate(5000);
  }

  // Helper: broadcast an IPC event to all windows
  private _broadcastToAllWindows(channel: string, ...args: any[]): void {
    const windows = [
      this.windowHelper.getMainWindow(),
      this.windowHelper.getLauncherWindow(),
      this.windowHelper.getOverlayWindow(),
      this.settingsWindowHelper.getSettingsWindow(),
      this.modelSelectorWindowHelper.getWindow(),
    ];
    const sent = new Set<number>();
    for (const win of windows) {
      if (win && !win.isDestroyed() && !sent.has(win.id)) {
        sent.add(win.id);
        this.sendToWindow(win, channel, ...args);
      }
    }
  }

  public getDisguise(): string {
    return this.disguiseMode;
  }
}

// Application initialization

async function initializeApp() {
  logStartupPhase('initializeApp:start');
  // 1. Enforce single instance — prevent duplicate dock icons from leftover processes.
  // In development mode with hot-reload this is still safe because electron is restarted
  // by the build step, not re-launched by concurrently while the old process is alive.
  const gotLock = app.requestSingleInstanceLock();
  logStartupPhase('single-instance-lock', { gotLock });
  if (!gotLock) {
    console.log('[Main] Another instance is already running. Exiting this instance.');
    // Use app.exit(0) — app.quit() before whenReady can be deferred or no-op'd
    // (it tries to close all windows first, but none exist yet), leaving the
    // duplicate process alive long enough to register a second tray icon on
    // macOS Tahoe + Spotlight launches. exit() terminates immediately and
    // cannot be intercepted by before-quit handlers.
    app.exit(0);
    return;
  }

  // When a duplicate launch is attempted (e.g. user invokes Spotlight again
  // while Natively is running), focus and recenter the existing window so the
  // launch is visibly handled instead of silently absorbed.
  app.on('second-instance', () => {
    try {
      const appState = AppState.getInstance();
      appState.centerAndShowWindow();
    } catch (err) {
      console.error('[Main] second-instance handler failed:', err);
    }
  });

  // PHASE-2E: install lifecycle tracking BEFORE app.whenReady() so we never
  // miss a renderer crash, GPU crash, or worker death that occurs during
  // initial window creation.
  try {
    const { LifecycleTracker } = require('./utils/lifecycleTracker');
    const consoleLog: (msg: string, meta?: Record<string, unknown>) => void = (msg, meta) => {
      // Use the same redaction policy as logToFile — never log secrets.
      const safeMeta = meta
        ? Object.fromEntries(
            Object.entries(meta).map(([k, v]) => {
              if (/key|secret|token|password|auth|credential/i.test(k)) return [k, '[REDACTED]'];
              return [k, v];
            })
          )
        : undefined;
      console.log(msg, safeMeta ?? '');
      logToFile(msg + ' ' + (safeMeta ? JSON.stringify(safeMeta) : ''));
    };
    LifecycleTracker.getInstance().install(consoleLog);
    // Surface "previous session crashed" — useful for the user-facing
    // diagnostics UI, and free insurance for the very report that triggered
    // this work.
    const prev = LifecycleTracker.getInstance().readPreviousSessionMarker();
    if (prev && LifecycleTracker.getInstance().didPreviousSessionCrash()) {
      console.warn(
        `[Lifecycle] previous session ended unexpectedly: ` +
        `pid=${prev.pid} lastEvent=${prev.lastEvent} reason=${prev.quitReason ?? 'unknown'} ` +
        `startedAt=${prev.startedAt} lastEventAt=${prev.lastEventAt}`
      );
    }
  } catch (err) {
    console.warn('[Main] LifecycleTracker install failed (non-fatal):', err);
  }

  // 2. Wait for app to be ready
  logStartupPhase('before-app-whenReady');
  await app.whenReady()
  nativeOomTrace.initialize()
  nativeOomTrace.record('app-ready', {
    pid: process.pid,
    platform: process.platform,
    electron: process.versions.electron,
  })
  logStartupPhase('after-app-whenReady', { userData: app.getPath('userData') });

  // 2a. PRE-EMPTIVE dock hide / activation-policy clamp: must happen before ANY
  // operation that causes macOS to register a dock entry (app.setName, the
  // LaunchServices live-rename in _applyDisguise, BrowserWindow creation, etc.).
  //
  // DUAL-DOCK-ICON FIX: even in NORMAL (non-stealth) mode, applyInitialDisguise()
  // → app.setName() + the native setProcessDisplayName() LaunchServices rename
  // re-register the running app's LS identity. Doing that while the app is on the
  // default 'regular' activation policy makes macOS paint a SECOND dock tile (the
  // old identity's tile lingers while the renamed one registers) — the duplicate
  // "Natively" icon multiple users reported. We therefore drop to 'accessory'
  // (no dock tile) for the whole rename+window-creation window, then promote back
  // to 'regular' exactly once AFTER createWindow() so a single, correctly-named
  // tile appears together with the window. Stealth mode stays hidden via dock.hide()
  // and is never promoted.
  // We read isUndetectable directly from settings here — AppState singleton isn't
  // constructed yet, so we cannot call appState.getUndetectable().
  if (process.platform === 'darwin') {
    // SettingsManager is already statically imported — no require() needed.
    const isUndetectableOnStartup = SettingsManager.getInstance().get('isUndetectable') ?? false;
    if (isUndetectableOnStartup) {
      app.dock.hide();
    } else {
      // Non-stealth: clamp to accessory (dock-tile-less) until the disguised
      // name/icon is painted and the window exists. Do NOT promote to 'regular'
      // here — that happens once after createWindow() below.
      app.setActivationPolicy('accessory');
    }
  }

  // 3. Initialize Managers
  // Phase 6 — bind TelemetryService to the Electron userData path. The
  // singleton was constructed with cwd-relative paths at module-load time
  // (before app.whenReady), so we reconfigure here. Honors the user's
  // telemetry-enabled setting (default: on, local-only JSONL).
  logStartupPhase('telemetry-configure:start');
  try {
    const { telemetryService } = require('./services/telemetry/TelemetryService');
    const userDataPath = app.getPath('userData');
    const telemetryEnabledSetting = SettingsManager.getInstance().get('telemetryEnabled');

    // Remote sinks are built from env (set at app launch / packaged build). Each
    // is added ONLY when its credential is present, so unset = silently local-only.
    // A stable, NON-PII install id (random, persisted in settings) lets PostHog
    // dedupe sessions without ever shipping a key/email.
    const release = (typeof app.getVersion === 'function' ? app.getVersion() : undefined) || process.env.APP_VERSION || 'unknown';
    const environment = process.env.NODE_ENV === 'development' ? 'development' : 'production';
    let distinctId: string | undefined;
    try {
      const sm = SettingsManager.getInstance() as unknown as { get: (k: string) => unknown; set: (k: string, v: unknown) => void };
      distinctId = sm.get('telemetryInstallId') as string | undefined;
      if (!distinctId) {
        distinctId = `nd_${Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
        sm.set('telemetryInstallId', distinctId);
      }
    } catch { /* settings unavailable — distinctId stays undefined */ }

    const sinks: Array<Record<string, unknown>> = [{ name: 'local-jsonl', enabled: true }];
    if (process.env.POSTHOG_API_KEY) {
      sinks.push({ name: 'posthog', enabled: true, apiKey: process.env.POSTHOG_API_KEY, endpoint: process.env.POSTHOG_HOST || 'https://app.posthog.com', distinctId });
    }
    if (process.env.SENTRY_DSN) {
      sinks.push({ name: 'sentry', enabled: true, dsn: process.env.SENTRY_DSN, release, environment });
    }
    if (process.env.AXIOM_TOKEN && process.env.AXIOM_DATASET) {
      sinks.push({ name: 'axiom', enabled: true, apiKey: process.env.AXIOM_TOKEN, dataset: process.env.AXIOM_DATASET });
    }

    telemetryService.configure({
      userDataPath,
      enabled: telemetryEnabledSetting !== false, // default true
      localEnabled: true,
      sinks,
    });
    const remote = sinks.filter(s => s.name !== 'local-jsonl').map(s => s.name);
    console.log(`[Telemetry] sinks: local-jsonl${remote.length ? ' + ' + remote.join(' + ') : ' (remote unconfigured)'} release=${release}`);
    telemetryService.track({ name: 'app_start', properties: { platform: process.platform, release } });
    logStartupPhase('telemetry-configure:complete', { release, remoteSinks: remote });
  } catch (err) {
    console.warn('[Init] TelemetryService configure threw (non-fatal):', err);
  }

  // Initialize CredentialsManager and load keys explicitly
  // This fixes the issue where keys (especially in production) aren't loaded in time for RAG/LLM
  logStartupPhase('credentials-init:start');
  const { CredentialsManager } = require('./services/CredentialsManager');
  CredentialsManager.getInstance().init();
  logStartupPhase('credentials-init:complete');

  // 4. Initialize State
  logStartupPhase('app-state:get-instance:start');
  const appState = AppState.getInstance()
  logStartupPhase('app-state:get-instance:complete')

  // Explicitly load credentials into helpers
  appState.processingHelper.loadStoredCredentials();

  // Seed the un-deletable General mode once at startup. Idempotent.
  try {
    const { ModesManager } = require('./services/ModesManager');
    ModesManager.getInstance().ensureSeeded();
  } catch (err) {
    console.warn('[Init] ModesManager.ensureSeeded threw (non-fatal):', err);
  }

  // Initialize IPC handlers before window creation
  initializeIpcHandlers(appState)

  // Start the in-app review session ledger. This is intentionally main-process
  // owned so renderer reloads don't double-count app sessions. Also sync the
  // backend prompt-state once so cross-install dismissals/reviews are honored.
  try {
    const { ReviewService, getReviewApiKey, getReviewHardwareId } = require('./services/ReviewService');
    const reviewService = ReviewService.getInstance();
    reviewService.recordSessionStart();
    const apiKey = getReviewApiKey();
    getReviewHardwareId()
      .then((hwid: string | null) => reviewService.syncWithBackend(apiKey, hwid))
      .catch(() => {});
  } catch (err) {
    console.warn('[Init] ReviewService recordSessionStart failed (non-fatal):', err);
  }

  // Generic, provider-agnostic local-model download service. Owns the
  // in-flight state for Whisper (today) and any future local model family
  // (vision, embeddings, …). Instantiated BEFORE createWindow so the
  // Settings overlay can call `getDownloadState` on first mount without
  // waiting for IPC registration. The service rehydrates from disk
  // synchronously in its constructor.
  try {
    const { LocalModelDownloadService, createWhisperDownloadProvider } = require('./services/LocalModelDownloadService');
    const downloadService = LocalModelDownloadService.getInstance();
    downloadService.registerProvider(createWhisperDownloadProvider());
    // 2026-07-06: lazy download for the reranker (smart-retrieval Phase 1).
    // The 283 MB bge-reranker-base model is no longer bundled — it is fetched
    // on first document-grounded mode activation via ModesManager.
    try {
        const { createRerankerDownloadProvider } = require('./rag/rerankerDownloadProvider');
        downloadService.registerProvider(createRerankerDownloadProvider());
    } catch (e: any) {
        console.warn('[main] Reranker download provider registration failed (non-fatal):', e?.message);
    }
  } catch (e: any) {
    console.warn('[main] LocalModelDownloadService init failed (non-fatal):', e?.message);
  }

  // Apply the full disguise payload (names, dock icon, AUMID) early
  appState.applyInitialDisguise();

  // Ollama is an external optional provider. Do not spawn it on startup unless
  // the user explicitly selected/opted into it; Natively's packaged fallback
  // stack must work without Ollama installed.
  try {
    const settingsManager = SettingsManager.getInstance();
    const defaultModel = CredentialsManager.getInstance().getDefaultModel();
    const shouldStartOllama =
      !localModelsDisabled() && (
        settingsManager.get('autoStartOllama') === true ||
        defaultModel.startsWith('ollama-') ||
        defaultModel.startsWith('ollama:') ||
        process.env.NATIVELY_AUTO_START_OLLAMA === '1'
      );
    if (localModelsDisabled()) {
      OllamaManager.getInstance().skipStartup('NATIVELY_NO_LOCAL_MODELS=1 — Ollama disabled for diagnostic');
      console.warn('[LeakTest] Skipping Ollama startup (NATIVELY_NO_LOCAL_MODELS=1)');
    } else if (shouldStartOllama) {
      OllamaManager.getInstance().ensureRunning({
        reason: settingsManager.get('autoStartOllama') === true ? 'auto-start-setting' : 'startup-selected',
        selectedModel: defaultModel,
      }).catch((err: any) => console.warn('[OllamaManager] Startup ensureRunning failed (non-fatal):', err?.message || err));
    } else {
      OllamaManager.getInstance().skipStartup('Ollama not selected; startup skipped');
      console.log('[OllamaManager] Skipping Ollama startup; Ollama provider not selected');
    }
  } catch (err: any) {
    console.warn('[OllamaManager] Startup selection check failed (non-fatal):', err?.message || err);
    OllamaManager.getInstance().skipStartup('Ollama startup skipped after selection check failure');
  }

  // NOTE: CredentialsManager.init() and loadStoredCredentials() are already called
  // above before this block — do NOT call them again here to avoid double key-load.

  // Anonymous install ping - one-time, non-blocking
  // See electron/services/InstallPingManager.ts for privacy details
  const { sendAnonymousInstallPing } = require('./services/InstallPingManager');
  sendAnonymousInstallPing();

  // Load stored Google Service Account path (for Speech-to-Text)
  // Fall back to GOOGLE_APPLICATION_CREDENTIALS env var (set in terminal but not Spotlight)
  const storedServiceAccountPath = CredentialsManager.getInstance().getGoogleServiceAccountPath()
    || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (storedServiceAccountPath) {
    console.log("[Init] Loading stored Google Service Account path");
    appState.updateGoogleCredentials(storedServiceAccountPath);
    // Persist env-var path so Spotlight launches also work going forward
    if (!CredentialsManager.getInstance().getGoogleServiceAccountPath()) {
      CredentialsManager.getInstance().setGoogleServiceAccountPath(storedServiceAccountPath);
    }
  }

  console.log("App is ready")

  // DEV-ONLY: thinking-budget sweep. Runs after credentials are loaded (so the
  // LIVE Gemini key is available — the .env key is billing-dead), prints the
  // table + writes userData/thinking-budget-bench-results.json, then quits.
  //   THINKING_BENCH=1 npm run electron:build
  //   THINKING_BENCH=1 THINKING_BENCH_BUDGETS=0,256,512,1024 THINKING_BENCH_REPEATS=2 npm run electron:build
  if (process.env.THINKING_BENCH === '1') {
    (async () => {
      try {
        const llmHelper = appState.processingHelper?.getLLMHelper?.();
        if (!llmHelper) { console.error('[ThinkingBudgetBench] LLMHelper unavailable'); app.quit(); return; }
        const { runThinkingBudgetBench } = require('./services/dev/ThinkingBudgetBench');
        const budgets = (process.env.THINKING_BENCH_BUDGETS || '0,128,512,1024,-1').split(',').map((s: string) => Number(s.trim()));
        const repeats = Number(process.env.THINKING_BENCH_REPEATS || '1');
        const model = process.env.THINKING_BENCH_MODEL || 'gemini-3.1-flash-lite';
        // Give the embedding/provider init a moment to settle.
        await new Promise(r => setTimeout(r, 2000));
        await runThinkingBudgetBench(llmHelper, { budgets, repeats, model, log: (s: string) => console.log(s) });
      } catch (e: any) {
        console.error('[ThinkingBudgetBench] failed:', e?.message || e);
      } finally {
        console.log('[ThinkingBudgetBench] done — quitting.');
        app.quit();
      }
    })();
    return; // skip the rest of startup (no meeting/STT prewarm needed for the bench)
  }

  // DEV-ONLY: thinking MATRIX (budgets × levels) on a focused problem subset.
  //   THINKING_MATRIX=1 THINKING_BENCH_MODEL=gemini-3.5-flash THINKING_BENCH_DATASET=$(pwd)/electron/services/dev/cf10.json npm run electron:build
if (process.env.THINKING_MATRIX === '1') {
    (async () => {
      try {
        const llmHelper = appState.processingHelper?.getLLMHelper?.();
        if (!llmHelper) { console.error('[ThinkingMatrix] LLMHelper unavailable'); app.quit(); return; }
        const { runThinkingMatrix } = require('./services/dev/ThinkingBudgetBench');
        const model = process.env.THINKING_BENCH_MODEL || 'gemini-3.1-flash-lite';
        const delayMs = Number(process.env.THINKING_BENCH_DELAY_MS || '500');
        const configs = process.env.THINKING_MATRIX_CONFIGS || undefined;
        await new Promise(r => setTimeout(r, 2000));
        await runThinkingMatrix(llmHelper, { model, delayMs, configs, log: (s: string) => console.log(s) });
      } catch (e: any) {
        console.error('[ThinkingMatrix] failed:', e?.message || e);
      } finally {
        console.log('[ThinkingMatrix] done — quitting.');
        app.quit();
      }
    })();
    return;
  }

  // PERF: pre-construct STT provider objects so the meeting-start critical
  // path doesn't pay for class init + listener wiring. Runs after all
  // credentials are loaded (so the provider can read its API key) and is
  // non-blocking — failures are logged and retried at meeting start.
  try {
    if (localModelsDisabled()) {
      console.warn('[LeakTest] Skipping STT pre-warm (NATIVELY_NO_LOCAL_MODELS=1)');
    } else {
      appState.prewarmSttProviders();
    }
  } catch (err) {
    console.warn('[Init] STT pre-warm threw (non-fatal):', err);
  }

  // Mic-indicator discipline: at this point in the launch path we MUST NOT
  // have any live MicrophoneCapture instances. microphoneCapture is the
  // meeting-time capture (constructed in setupSystemAudioPipeline, gated on
  // isMeetingActive). audioTestCapture is the Settings > Audio test capture
  // (constructed in startAudioTest, user-initiated). If either is non-null
  // at app launch — before any user has started a meeting or opened Audio
  // settings — the macOS CoreAudio HAL is being touched prematurely, and the
  // orange menu-bar mic-in-use indicator will be on for the lifetime of the
  // process. This is a regression guard; log and continue (don't crash).
  if (process.platform === 'darwin') {
    try {
      const mc = (appState as unknown as { microphoneCapture: unknown }).microphoneCapture;
      const at = (appState as unknown as { audioTestCapture: unknown }).audioTestCapture;
      if (mc !== null && mc !== undefined) {
        console.warn(
          '[INVARIANT] MicrophoneCapture exists at app launch (pre-meeting). ' +
          'This will keep the macOS mic-in-use indicator on. Investigate the ' +
          'construction site — setupSystemAudioPipeline must remain LAZY.'
        );
      }
      if (at !== null && at !== undefined) {
        console.warn(
          '[INVARIANT] audioTestCapture exists at app launch. This means ' +
          'Settings > Audio test was started without user action — investigate.'
        );
      }
    } catch (e) {
      // Non-fatal: this is a debug aid, not a safety check.
      console.error('[INVARIANT] mic-capture invariant check threw:', e);
    }
  }

  logStartupPhase('create-window:start');
  appState.createWindow()
  logStartupPhase('create-window:complete', {
    windowCount: BrowserWindow.getAllWindows().length,
  });

  // DIAGNOSTIC (2026-07-11): dump Chromium's GPU feature status once at boot.
  // The "window appears then freezes / renderer not responsive" report is
  // consistent with a machine that fell back to SOFTWARE compositing (Chromium
  // blocklisted the GPU / driver state), where the launcher splash's heavy
  // blur/backdrop-filter becomes catastrophically expensive and can wedge the
  // renderer's main thread. This logs, in one line, whether gpu_compositing and
  // rasterization are 'enabled' (hardware) or 'software'/'disabled'. If a user
  // who freezes shows software/disabled here while a healthy machine shows
  // enabled, the compositing path is confirmed and `?nofx=1` should unblock it.
  try {
    const status = app.getGPUFeatureStatus();
    console.log('[GPU] featureStatus', JSON.stringify(status));
  } catch (e: any) {
    console.warn('[GPU] getGPUFeatureStatus failed:', e?.message || e);
  }

  // Run the local-fallback preflight AFTER the launcher paints. We schedule
  // it via setTimeout so the visible launch is not blocked by:
  //   - native module requires (onnxruntime-node, sqlite-vec)
  //   - transformers.js / @huggingface/transformers probe
  //   - reading the bundled model file sizes
  // The preflight itself never blocks the main thread for more than a few
  // hundred ms; we add a second safety net: if the app is quitting when
  // the timer fires, skip the preflight (its writes to ProviderStatusRegistry
  // would still succeed but its reads of process.resourcesPath / app.getPath
  // can throw during teardown). Also wrapped in try/catch so a synchronous
  // throw in the require() or in runLocalFallbackPreflight cannot crash
  // the main process. Idempotent: runLocalFallbackPreflight is single-flighted.
  const preflightTimer = setTimeout(() => {
    if (appState.isQuitting?.()) {
      console.log('[LocalFallbackPreflight] skipped — app is quitting');
      return;
    }
    if (localModelsDisabled()) {
      console.warn('[LeakTest] Skipping LocalFallbackPreflight (NATIVELY_NO_LOCAL_MODELS=1)');
      return;
    }
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const { runLocalFallbackPreflight } = require('./services/LocalFallbackPreflight');
      runLocalFallbackPreflight({ ollamaSelected: llmHelper.isUsingOllama?.() === true })
        .catch((err: any) => console.warn('[LocalFallbackPreflight] failed to run (non-fatal):', err?.message || err));
    } catch (err: any) {
      console.warn('[LocalFallbackPreflight] scheduling failed (non-fatal):', err?.message || err);
    }
  }, Number(process.env.NATIVELY_LOCAL_PREFLIGHT_DELAY_MS || '1500'));
  // Don't let the preflight timer keep the process alive past quit.
  if (preflightTimer && typeof preflightTimer.unref === 'function') preflightTimer.unref();

  // Defer the zero-shot intent classifier warmup until after the launcher has
  // had a chance to paint and settle. The classifier still lazy-loads on first
  // use, so this only moves startup CPU work out of the visible launch path.
  setTimeout(() => {
    try {
      if (localModelsDisabled()) {
        console.warn('[LeakTest] Skipping intent-classifier warmup (NATIVELY_NO_LOCAL_MODELS=1)');
        return;
      }
      warmupIntentClassifier();
    } catch (err) {
      console.warn('[Init] Intent classifier warmup scheduling failed (non-fatal):', err);
    }
  }, Number(process.env.NATIVELY_INTENT_WARMUP_DELAY_MS || '2500'));

  // DUAL-DOCK-ICON FIX (promotion half): now that the disguised name/icon are
  // applied and the window exists, promote back to 'regular' so a SINGLE dock
  // tile appears together with the window. Gated on darwin && !undetectable so
  // stealth mode is never promoted (it must stay dock-tile-less). This pairs
  // with the 'accessory' clamp in step 2a above — together they ensure the LS
  // re-registration from app.setName()/setProcessDisplayName() happens while no
  // tile is visible, so macOS never paints a second "Natively" icon.
  if (process.platform === 'darwin' && !appState.getUndetectable()) {
    app.setActivationPolicy('regular');
  }

  // Apply initial stealth state based on isUndetectable setting.
  if (!appState.getUndetectable()) {
    // Normal mode: show tray (dock is already showing — no need to call dock.show() again)
    appState.showTray();
  } else {
    // Persisted undetectable: the pre-emptive app.dock.hide() above is NOT
    // sufficient — createWindow() + the launcher's first show re-registers the
    // app and re-shows the dock. Converge through the same self-verifying
    // enforcement the runtime toggle uses, so the app comes up actually
    // undetectable without the user having to toggle off/on. The enforcement
    // loop re-checks app.dock.isVisible() across several retries, which also
    // catches the dock re-show that lands at the launcher's ready-to-show.
    appState.applyInitialUndetectableState();
  }
  // Register global shortcuts using KeybindManager
  KeybindManager.getInstance().registerGlobalShortcuts()

  // System sleep/wake handling. macOS invalidates CoreAudio AggregateDevice
  // handles on sleep — without this the Process Tap silently stops delivering
  // buffers on resume and the user sits in front of a frozen transcript with
  // no idea why. Fire restartCapturesAfterResume on resume; it's a no-op if
  // no meeting is active. The 'lock-screen' event isn't useful here (the OS
  // doesn't tear down audio on lock) so we don't subscribe to it.
  try {
    const { powerMonitor } = require('electron') as typeof import('electron');
    powerMonitor.on('resume', () => {
      console.log('[Main] powerMonitor: system resumed from sleep.');
      appState.restartCapturesAfterResume().catch((err) =>
        console.error('[Main] restartCapturesAfterResume threw:', err)
      );
    });
    powerMonitor.on('suspend', () => {
      console.log('[Main] powerMonitor: system suspending. Captures will be recreated on resume if a meeting is active.');
    });
  } catch (err) {
    console.warn('[Main] powerMonitor unavailable — sleep/wake recovery disabled:', err);
  }

  // Pre-create detached overlay companion windows in background for faster first open
  appState.settingsWindowHelper.preloadWindow()
  appState.modelSelectorWindowHelper.preloadWindow()

  // Restore Phone Mirror service if it was enabled in a previous session.
  // Failure here is non-fatal — the user can re-enable from Settings.
  //
  // DIAGNOSTIC (2026-07-11): NATIVELY_DISABLE_PHONE_MIRROR=1 stops the PhoneMirror
  // WebSocket server from ever starting. On the Windows repro, the launcher
  // renderer's native RSS explodes (497→2008MB in ~4s, flat JS heap) within
  // seconds of `[PhoneMirror] companion extension connected` — the same trigger
  // in 3 separate logs. This flag lets the (frozen) user boot WITHOUT the WS
  // server so the phone/companion extension can't connect. If the leak vanishes,
  // PhoneMirror connect is confirmed as the trigger.
  if (process.env.NATIVELY_DISABLE_PHONE_MIRROR === '1') {
    console.warn('[LeakTest] NATIVELY_DISABLE_PHONE_MIRROR=1 → PhoneMirror WS server NOT started this run');
  } else if (SettingsManager.getInstance().get('phoneMirrorEnabled')) {
    PhoneMirrorService.getInstance()
      .start({ exposeOnLan: !!SettingsManager.getInstance().get('phoneMirrorExposeOnLan'), persist: false })
      .catch((err) => console.error('[Init] PhoneMirror auto-start failed:', err));
  }

  // One-time macOS screen recording permission prompt.
  //
  // We must fire this AFTER createWindow() so that:
  //   1. The Natively launcher window is visible and focused when the TCC dialog
  //      appears — macOS anchors the dialog to the frontmost app window on Ventura+.
  //      Without a visible window the dialog can appear behind other apps (Sequoia).
  //   2. In stealth/undetectable mode the dock icon is hidden, but the window is
  //      still visible — the dialog still has a surface to attach to.
  //
  // The 800ms delay lets the launcher's ready-to-show animation complete so the
  // window is fully composited before the system sheet appears above it.
  //
  // TCC caches the decision permanently after the first response — this block
  // runs exactly ONCE on the first launch of each unique packaged binary.
  // On every subsequent launch the status is 'granted' or 'denied', and we skip.
  if (process.platform === 'darwin') {
    setTimeout(async () => {
      try {
        const screenStatus = systemPreferences.getMediaAccessStatus('screen');
        console.log(`[Init] Screen recording permission status at startup: ${screenStatus}`);

        if (isDevTccBypassEnabled()) {
          // B5: Legacy dev bypass — see isDevTccBypassEnabled() docstring.
          // Without the env var, dev users get the same startup TCC flow as
          // production so production bugs are reproducible locally.
          console.log('[Init] Dev TCC bypass enabled — skipping startup screen-recording check');
          return;
        }

        if (screenStatus === 'not-determined') {
          // First launch: trigger the one-time TCC dialog by making a minimal
          // desktopCapturer call. macOS will show the permission sheet anchored
          // to our window. The user's response is stored permanently in the TCC
          // database — we do NOT check status immediately after because the dialog
          // is still open; the status will be read correctly next time `startMeeting`
          // is called (which is the correct gate for system audio access).
          console.log('[Init] Screen recording not-determined — showing one-time TCC dialog...');
          try {
            await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
          } catch (e) {
            // On some Electron builds getSources throws when permission is pending —
            // that's fine; the TCC dialog has still been triggered.
            console.log('[Init] getSources threw (expected during TCC pending state):', (e as Error).message);
          }
          // NOTE: Do NOT read afterStatus here — TCC response is async (dialog still open).
          // startMeeting() reads the status when the user actually tries to use audio.

        } else if (screenStatus === 'denied') {
          const screenCapability = await resolveMacScreenCaptureCapability('startup permission check');
          if (screenCapability.effectiveDenied) {
            // Returning user who previously denied — show the banner immediately at startup
            // so they know system audio won't work before they even start a meeting.
            console.warn('[Init] Screen recording was previously denied — notifying UI banner.');
            appState.sendSystemAudioPermissionDenied(screenCapability.message ?? formatPermissionMessage('screen-recording-denied'));
          }
        } else {
          // 'granted' or 'restricted' — nothing to do for screen recording.
          console.log(`[Init] Screen recording permission already resolved: ${screenStatus}`);
        }

        // UX1: also check Microphone permission at startup. The existing
        // screen-recording check above gave returning users with a denied
        // grant immediate feedback; do the same for the mic so users know
        // before they start a meeting that audio capture is blocked.
        // Symmetric to the screen-recording branch above.
        try {
          const micStatus = systemPreferences.getMediaAccessStatus('microphone');
          console.log(`[Init] Microphone permission status at startup: ${micStatus}`);
          if (micStatus === 'denied') {
            console.warn('[Init] Microphone was previously denied — notifying UI banner.');
            appState.sendAudioCaptureFailed({
              channel: 'mic',
              message: formatPermissionMessage('mic-denied'),
              attempt: 0,
              maxAttempts: 0,
              terminal: true,
              stuck: false,
            });
          } else if (micStatus === 'restricted') {
            console.warn('[Init] Microphone is restricted by device policy at startup.');
            appState.sendAudioCaptureFailed({
              channel: 'mic',
              message: 'Microphone is restricted by device policy. Contact your administrator to enable microphone access for Natively.',
              attempt: 0,
              maxAttempts: 0,
              terminal: true,
              stuck: false,
            });
          }
          // 'granted' or 'not-determined' — no banner. 'not-determined' is
          // resolved at first meeting start via ensureMacMicrophoneAccess.
        } catch (micErr) {
          console.warn('[Init] Startup microphone permission check failed:', micErr);
        }
      } catch (e) {
        console.warn('[Init] Startup screen recording permission check failed:', e);
      }
    }, 800);
  }

  // Initialize CalendarManager
  try {
    const { CalendarManager } = require('./services/CalendarManager');
    const calMgr = CalendarManager.getInstance();
    calMgr.init();

    calMgr.on('start-meeting-requested', (event: any) => {
      console.log('[Main] Start meeting requested from calendar notification', event);
      appState.centerAndShowWindow();
      appState.startMeeting({
        title: event.title,
        calendarEventId: event.id,
        source: 'calendar'
      });
    });

    calMgr.on('open-requested', () => {
      appState.centerAndShowWindow();
    });

    console.log('[Main] CalendarManager initialized');
  } catch (e) {
    console.error('[Main] Failed to initialize CalendarManager:', e);
  }

  // Recover unprocessed meetings (persistence check)
  appState.getIntelligenceManager().recoverUnprocessedMeetings().catch(err => {
    console.error('[Main] Failed to recover unprocessed meetings:', err);
  });

  logStartupPhase('initializeApp:complete');

  // Note: We do NOT force dock show here anymore, respecting stealth mode.

  app.on("activate", () => {
    console.log("App activated")
    if (process.platform === 'darwin') {
      // Do NOT call dock.show() while a meeting is running — the dock icon
      // appearing mid-meeting is a critical stealth failure.
      if (!appState.getUndetectable() && !appState.getIsMeetingActive()) {
        app.dock.show();
      }
    }

    // If no window exists, create it
    if (appState.getMainWindow() === null) {
      appState.createWindow()
    } else {
      // If the window exists but is hidden, clicking the dock icon should restore it
      if (!appState.isVisible()) {
        appState.toggleMainWindow();
      }
    }
  })

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  function stopAppManagedHindsight(reason: string): void {
    try {
      const { HindsightManager } = require('./services/HindsightManager');
      HindsightManager.getInstance().stopSync();
    } catch { /* optional */ }
  }

  function checkpointDatabase(reason: string): void {
    try {
      const { DatabaseManager } = require('./db/DatabaseManager');
      DatabaseManager.getInstance().checkpoint();
    } catch (e) {
      console.warn(`[main] DatabaseManager.checkpoint failed during ${reason} (non-fatal):`, e);
    }
  }

  app.on('will-quit', () => {
    appState.stopNativeOomTraceSampling();
    nativeOomTrace.stop('will-quit');
    stopAppManagedHindsight('will-quit');
    checkpointDatabase('will-quit');
  });

  // Crash-loop guard: reload timestamps per webContentsId.
  const rendererReloadHistory = new Map<number, number[]>();
  const RENDERER_RELOAD_MAX = 3;            // max auto-reloads ...
  const RENDERER_RELOAD_WINDOW_MS = 60_000; // ... within this rolling window

  app.on('render-process-gone', (_event, webContents, details) => {
    const urlNow = (() => { try { return webContents?.getURL?.() || ''; } catch { return ''; } })();
    logCrashConsole('render-process-gone', {
      details,
      webContentsId: webContents?.id,
      webContentsUrl: urlNow || null,
    });
    console.warn('[main] render-process-gone:', details);
    stopAppManagedHindsight('render-process-gone');

    // RECOVERY (2026-07-10): a renderer crash (e.g. the Fontations font trap on
    // macOS 26/27 — see the disable-features mitigation at top-of-module) kills
    // only the render process; the BrowserWindow and the main process survive.
    // Previously we only logged + closed the DB, leaving a blank/dead launcher
    // that the user reads as "the app crashed and won't come back." Now we
    // reload the dead webContents with a crash-loop backoff.
    //
    // CRITICAL: do NOT emergencyCloseDatabase on the RECOVER path. That call is
    // irreversible (it nulls the singleton DB with no reopen path), so closing
    // it here would hand the reloaded renderer a dead main-process DB (no
    // history/modes/persistence). The renderer does not own the DB — main does,
    // synchronously — so a renderer crash cannot corrupt it. We only close the
    // DB on TERMINAL paths (quit / non-crash / give-up).
    const reason = details?.reason;
    const isCrash = reason === 'crashed' || reason === 'abnormal-exit';

    // Never fight an intentional teardown, and don't reload a clean/intentional
    // exit or an intentional kill — treat those as terminal (preserve the
    // original crash-path behavior so the WAL lock is released cleanly).
    if (!isCrash || appState.isQuitting?.()) {
      emergencyCloseDatabase('render-process-gone');
      return;
    }

    // Only auto-reload real user-facing windows. Transient/hidden helpers
    // (cropper = screenshot overlay; model-selector = hidden preload with a
    // known forceRestartOllama side-effect) should NOT be blindly reloaded —
    // they get recreated on next open. Reload launcher / settings / overlay.
    const isRecoverableWindow =
      urlNow === '' /* URL unavailable — assume the main launcher */ ||
      /[?&]window=(launcher|settings|overlay)\b/.test(urlNow) ||
      !/[?&]window=/.test(urlNow) /* no window tag → the default launcher */;
    if (!isRecoverableWindow) {
      logToFile(`[main] render-process-gone: not auto-reloading transient window (${urlNow})`);
      return;
    }

    const id = webContents?.id;
    if (typeof id !== 'number' || !webContents || webContents.isDestroyed?.()) {
      // WebContents gone entirely — recreate the launcher via the existing
      // helper (idempotent: no-ops if a launcher already exists). Keep the DB
      // OPEN so the recreated renderer is fully functional.
      try {
        appState.createWindow();
        logToFile('[main] render-process-gone: webContents destroyed, recreated launcher window');
      } catch (e: any) {
        logToFile(`[main] render-process-gone: window recreate failed: ${e?.message || e}`);
      }
      return;
    }

    const now = Date.now();
    const history = (rendererReloadHistory.get(id) || []).filter(
      (t) => now - t < RENDERER_RELOAD_WINDOW_MS
    );

    if (history.length >= RENDERER_RELOAD_MAX) {
      // Crash loop: stop reloading. NOW it is terminal — release the DB cleanly
      // and surface a single dialog. Do not loop.
      rendererReloadHistory.delete(id);
      logCrashConsole('render-process-gone-loop-giveup', {
        webContentsId: id,
        reloadsInWindow: history.length,
        windowMs: RENDERER_RELOAD_WINDOW_MS,
      });
      emergencyCloseDatabase('render-process-gone-loop-giveup');
      try {
        // dialog is not imported at module top — require it lazily (matches
        // the native-arch gate handler's pattern above).
        const { dialog } = require('electron');
        dialog.showErrorBox(
          'Natively — display error',
          'A window keeps crashing while rendering. Please restart Natively. ' +
          'If this continues, update to the latest version.'
        );
      } catch { /* dialog best-effort */ }
      return;
    }

    // Under the cap → reload. Keep the DB OPEN (main owns it; it is healthy).
    history.push(now);
    rendererReloadHistory.set(id, history);
    logToFile(
      `[main] render-process-gone: auto-reloading webContents ${id} ` +
      `(attempt ${history.length}/${RENDERER_RELOAD_MAX} within ${RENDERER_RELOAD_WINDOW_MS}ms)`
    );
    try {
      webContents.reloadIgnoringCache();
    } catch (e: any) {
      logToFile(`[main] render-process-gone: reload failed: ${e?.message || e}`);
    }
  });

  app.on('child-process-gone', (_event, details) => {
    logCrashConsole('child-process-gone', { details });
    console.warn('[main] child-process-gone:', details);
    stopAppManagedHindsight('child-process-gone');
    emergencyCloseDatabase('child-process-gone');
  });

  app.on('gpu-process-crashed', (_event, killed: boolean) => {
    logCrashConsole('gpu-process-crashed', { killed });
    emergencyCloseDatabase('gpu-process-crashed');
  });

  app.on('gpu-info-update', () => {
    logToFile('[DIAG:gpu-info-update] GPU process info changed');
  });

  // Scrub API keys from memory on quit to minimize exposure window
  app.on("before-quit", (event) => {
    console.log("App is quitting, cleaning up resources...");
    appState.setQuitting(true);

    // Stop the default-output watcher immediately after setting the quitting
    // flag so any straggler interval tick observes _isQuitting before native
    // audio handles start tearing down.
    try {
      appState.stopDefaultOutputWatcherForShutdown?.();
    } catch (e) {
      console.error('[main] Failed to stop DefaultOutputWatcher during shutdown:', e);
    }

    // 2026-07-08: TRUNCATE the SQLite WAL file early in shutdown.
    // On a force-quit (e.g. user ⌘Q during a meeting, macOS sending
    // SIGKILL after a hang, or `kill -9` from the auto-update flow) the
    // `-wal` file may be left mid-transaction. The next launch's
    // `new Database(dbPath)` then either:
    //   1. Hangs on a kernel lock the OS believes is held by the dead
    //      process (the user sees a frozen launcher), or
    //   2. Reads partial data, fails a migration, and degrades to
    //      `db: null` silently.
    // PRAGMA wal_checkpoint(TRUNCATE) is synchronous and fast (<5ms
    // typically) and writes any pending WAL frames to the main .db
    // before exit. Idempotent and safe to call even when db is null.
    checkpointDatabase('before-quit');

    // Stop an app-managed Hindsight server SYNCHRONOUSLY (kills the detached process group
    // → no orphaned Python/Postgres). No-op unless we spawned one. Must be sync: the app
    // can exit before any async kill completes.
    stopAppManagedHindsight('before-quit');

    // Review-prompt service: close any in-flight session so total_usage_ms
    // captures this run, then flush the debounced state write (250ms window)
    // synchronously so a user dismissing the prompt 100ms before quit isn't
    // re-prompted on next launch. Idempotent with the renderer's
    // beforeunload path (which also calls review:flush-session).
    try {
      const { ReviewService, getReviewApiKey, getReviewHardwareId } = require('./services/ReviewService');
      const reviewService = ReviewService.getInstance();
      const totals = reviewService.beforeQuit();
      if (totals.counted) {
        const apiKey = getReviewApiKey();
        getReviewHardwareId()
          .then((hwid: string | null) => reviewService.reportUsage(apiKey, hwid, totals.usage_ms))
          .catch(() => {});
      }
    } catch { /* optional */ }

    // Local-model download service: synchronously flush the in-flight state
    // map to disk and terminate every live worker. Without this, a quit
    // mid-download (e.g. user force-quits while a 1.5GB Whisper Medium is
    // downloading) leaves the service's state file in a stale
    // 'downloading' state forever, AND any workers keep running until the
    // process is actually reaped. The next launch rehydrates to
    // 'interrupted' (or 'complete' if the bytes actually landed).
    try {
      const { LocalModelDownloadService } = require('./services/LocalModelDownloadService');
      LocalModelDownloadService.getInstance().pauseForShutdown();
    } catch { /* optional */ }

    // ROUND 2 FIX (#9): synchronously stop the CGEventTap worker thread
    // BEFORE V8 starts tearing down. The tap callback holds an
    // Arc<ThreadsafeFunction> that calls into napi from a non-V8 thread;
    // if V8 is mid-teardown when the callback runs, napi's release path
    // crashes. stop() joins the worker, guaranteeing no in-flight callbacks
    // remain by the time we return.
    //
    // ORDERING NOTE: this MUST happen before any subsequent napi-touching
    // cleanup (cropper.dispose, ollama.stop, phoneMirror.dispose). Those
    // can spawn their own native threads or release napi resources, which
    // would race with our worker if it's still alive.
    if (process.platform === 'darwin') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
        StealthKeyboardManager.getInstance().stop();
      } catch (e) {
        console.error('[main] Failed to stop StealthKeyboardManager during shutdown:', e);
      }
    }

    // Dispose CropperWindowHelper to clean up IPC listeners and prevent memory leaks
    // This is critical to prevent resource leaks and ensure proper cleanup
    if (appState?.cropperWindowHelper) {
      appState.cropperWindowHelper.dispose();
    }

    // Cancel any pending RAG auto-reindex timer (could fire ~15s — or the long
    // drain-poll — after quit) and terminate the VectorStore worker thread.
    try {
      const rag = appState.getRAGManager();
      rag?.cancelPendingReindex();
      void rag?.dispose();
    } catch (e) {
      console.error('[main] Failed to dispose RAGManager during shutdown:', e);
    }

    // Kill Ollama if we started it
    OllamaManager.getInstance().stop();

    // Stop any in-flight Settings > Audio test so the OS mic indicator turns
    // off cleanly on quit. Without this, a user who quits while on the Audio
    // tab leaves `audioTestCapture` running on the deferred setImmediate path,
    // and the CoreAudio HAL handle can outlive V8 teardown — keeping the
    // orange mic-in-use indicator briefly visible in the macOS menu bar after
    // the process exits. Idempotent (no-op if no test is running).
    try {
      appState.stopAudioTest();
    } catch (e) {
      console.error('[main] Failed to stop audio test during shutdown:', e);
    }

    // Tear down the Phone Mirror service so the OS port is freed cleanly.
    PhoneMirrorService.getInstance().dispose().catch((err) =>
      console.error('[Main] PhoneMirror dispose failed:', err)
    );

    // Best-effort WAL checkpoint so a crash/force-quit followed by immediate
    // relaunch has less recovery work and fewer chances to trip over a large
    // or stale natively.db-wal. Must be synchronous and must never block quit.
    // 2026-07-08: now uses the new `close()` method which checkpoints AND
    // closes the better-sqlite3 connection so the file lock is released
    // before the process exits. A stale lock on a brand-new user profile
    // would cause the next launch to hang on `new Database(dbPath)`.
    try {
      const { DatabaseManager } = require('./db/DatabaseManager');
      const dbMgr = DatabaseManager.getInstance();
      dbMgr.checkpoint?.();
      dbMgr.close?.();
    } catch (e) {
      console.error('[Main] Failed to checkpoint/close database during shutdown:', e);
    }

    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().scrubMemory();
      appState.processingHelper.getLLMHelper().scrubKeys();
      console.log('[Main] Credentials scrubbed from memory on quit');
    } catch (e) {
      console.error('[Main] Failed to scrub credentials on quit:', e);
    }

    // Clean up screenshot queues to prevent residual PNG files on disk
    try {
      const { ScreenshotHelper } = require('./ScreenshotHelper');
      // Clear screenshot queues - this deletes all queued screenshot files
      const screenshotHelper = new ScreenshotHelper();
      screenshotHelper.clearQueues();
      console.log('[Main] Screenshot queues cleared on quit');
    } catch (e) {
      console.error('[Main] Failed to clear screenshot queues on quit:', e);
    }

    // PHASE-2E: mark this as a clean exit so the next-launch marker doesn't
    // show "previous session crashed". Last write wins — placed at the end
    // of the cleanup handler so a throw earlier in the chain still leaves
    // the marker with the originating quit reason.
    try {
      const { LifecycleTracker } = require('./utils/lifecycleTracker');
      // Only mark clean if no specific quit reason was set (e.g. an
      // updater install). Those should retain their explicit reason.
      LifecycleTracker.getInstance().markCleanExit();
    } catch { /* best-effort */ }
  })



  // app.dock?.hide() // REMOVED: User wants Dock icon visible
  app.commandLine.appendSwitch("disable-background-timer-throttling")
}

// Start the application
initializeApp().catch((err) => {
  // Close DB BEFORE writing the process report so the next launch never
  // sees a stale WAL from this half-open app. The helper is idempotent
  // and safe even if DatabaseManager.getInstance() throws (early-boot
  // failure where the DB was never opened).
  try { emergencyCloseDatabase('initializeApp-failed'); } catch { /* best-effort */ }
  const reportPath = isNativeArchGateCrash(err)
    ? null
    : writeProcessReport('initializeApp-failed');
  logCrashConsole('initializeApp-failed', {
    error: formatCrashError(err),
    reportPath,
    skippedReport: isNativeArchGateCrash(err) ? 'native-arch-gate' : undefined,
  });
  console.error(err);
})
