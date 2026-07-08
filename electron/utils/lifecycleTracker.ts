// electron/utils/lifecycleTracker.ts
// PHASE-2E: structured lifecycle + quit-reason tracking.
//
// Why this exists: the user's "v2.8.0 crash" report was impossible to diagnose
// from logs alone because:
//   - No `will-quit` / `render-process-gone` / `child-process-gone` /
//     `gpu-process-crashed` handlers existed. A renderer crash or worker
//     crash silently disappeared.
//   - The `before-quit` cleanup ran unconditionally, so a CLEAN user quit
//     looked IDENTICAL in the log to a CRASH-then-OS-reaped exit.
//   - There was no persistent "previous-session marker" to tell the next
//     launch whether the prior session ended cleanly or was killed.
//
// This module:
//   1. Tags every quit / lifecycle event with a `reason` (one of the
//      `QuitReason` enum) so the log tells you WHY the app is going down.
//   2. Writes a tiny JSON marker to a well-known userData path at the
//      START of every quit sequence, and overwrites it on a clean exit.
//      Next launch can read it to detect "previous session crashed".
//   3. Installs the missing Electron lifecycle handlers so a renderer /
//      worker / GPU crash is at least logged with full detail.
//   4. Never logs API keys, transcripts, screenshots, or other secrets
//      (the marker is a few short fields; the lifecycle log lines are
//      deliberately small).

import { app, BrowserWindow, WebContents, utilityProcess } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// PHASE-2E: a tiny local LogFn alias. We intentionally do NOT import from
// ./redactForLog here — the tracker is wired into the very first lifecycle
// hook, which runs before redactForLog may be loaded. The tracker does its
// own redaction in `sanitizeMeta` so this remains safe.
export type LogFn = (msg: string, meta?: Record<string, unknown>) => void;

export type QuitReason =
  | 'user-quit'               // user-initiated quit (Cmd+Q, tray menu, quit-app IPC)
  | 'window-close'            // window-all-closed (non-darwin only; darwin stays running)
  | 'updater-quit-install'    // autoUpdater.quitAndInstall (we ONLY land here for real upgrades)
  | 'manual-relaunch'         // app.relaunch() from a self-update path
  | 'fatal-main-error'        // uncaughtException or unhandledRejection forced exit
  | 'renderer-gone'           // render-process-gone (renderer crashed)
  | 'child-process-gone'      // child-process-gone (utility process died)
  | 'gpu-process-crashed'     // gpu-process-crashed
  | 'second-instance'         // duplicate instance lock fired → we asked user to focus
  | 'os-signal'               // SIGTERM / SIGINT (graceful) or SIGKILL (logged, not caught)
  | 'unknown';

interface LifecycleMarker {
  pid: number;
  startedAt: string;          // ISO
  lastEvent: string;          // last lifecycle event name
  lastEventAt: string;        // ISO of last event
  quitReason: QuitReason | null;
  quitMeta?: Record<string, unknown>;
}

export class LifecycleTracker {
  private static instance: LifecycleTracker | null = null;

  static getInstance(): LifecycleTracker {
    if (!LifecycleTracker.instance) {
      LifecycleTracker.instance = new LifecycleTracker();
    }
    return LifecycleTracker.instance;
  }

  private marker: LifecycleMarker;
  private installed = false;
  // FIX-HIGH-1: separate flag for the pre-whenReady handler set. Without
  // this, calling `installBeforeReady()` after `install()` would short-
  // circuit (because `installed === true`) and SIGTERM/SIGINT/SIGHUP /
  // uncaughtException / unhandledRejection would never be wired — the
  // whole point of the pre-whenReady call.
  private beforeReadyInstalled = false;
  private consoleLog: LogFn | undefined;

  private constructor() {
    this.marker = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastEvent: 'app-start',
      lastEventAt: new Date().toISOString(),
      quitReason: null,
    };
  }

  /** Wire all lifecycle handlers. Idempotent — second call is a no-op. */
  install(consoleLog?: LogFn): void {
    if (this.installed) return;
    this.installed = true;
    // Allow installBeforeReady to have set consoleLog earlier (pre-whenReady).
    this.consoleLog = consoleLog ?? this.consoleLog;

    // Helper that logs + persists in one place. Never logs secrets.
    const record = (event: string, reason?: QuitReason, meta?: Record<string, unknown>) => {
      this.marker.lastEvent = event;
      this.marker.lastEventAt = new Date().toISOString();
      if (reason) {
        this.marker.quitReason = reason;
        this.marker.quitMeta = meta;
      }
      try { this.writeMarker(); } catch { /* best-effort */ }
      const safeMeta = meta ? sanitizeMeta(meta) as Record<string, unknown> : undefined;
      consoleLog?.(`[Lifecycle] ${event}${reason ? ` reason=${reason}` : ''}`, safeMeta);
    };

    // MISSING HANDLERS that this module adds (PHASE-2E):
    app.on('will-quit', (event) => {
      record('will-quit', 'user-quit');
    });

    app.on('window-all-closed', () => {
      // Already handled elsewhere — but tag it so the log explains the quit.
      record('window-all-closed', 'window-close');
    });

    app.on('before-quit', (event) => {
      // Don't overwrite a more specific reason (e.g. updater-quit-install).
      if (!this.marker.quitReason) {
        record('before-quit', 'user-quit');
      } else {
        record('before-quit', this.marker.quitReason, this.marker.quitMeta);
      }
    });

    app.on('render-process-gone', (event, webContents: WebContents, details: Electron.RenderProcessGoneDetails) => {
      record(
        'render-process-gone',
        'renderer-gone',
        {
          reason: details.reason,
          exitCode: details.exitCode,
          webContentsId: webContents.id,
          url: safeUrl(webContents.getURL()),
        }
      );
    });

    app.on('child-process-gone', (event, details: Electron.Details) => {
      record(
        'child-process-gone',
        'child-process-gone',
        {
          type: details.type,
          reason: details.reason,
          exitCode: details.exitCode,
          serviceName: details.serviceName,
        }
      );
    });

    app.on('gpu-process-crashed', (event, killed: boolean) => {
      record('gpu-process-crashed', 'gpu-process-crashed', { killed });
    });

    // NOTE: OS-level signals (SIGTERM/SIGINT/SIGHUP), uncaughtException, and
    // unhandledRejection are wired by `installBeforeReady()` (callable from
    // module-load time). Don't re-add them here — Node's process.on() is
    // additive, and double-registering would fire the handler twice.
  }

  /**
   * Install ONLY the process-level handlers (uncaughtException,
   * unhandledRejection, SIGTERM/SIGINT/SIGHUP). Safe to call BEFORE
   * app.whenReady() — does not require Electron's main loop to be alive.
   *
   * Use this from `nativeArchGate.ts` (the very first module loaded by
   * main.ts) so a crash during module load / native-binding dlopen still
   * writes a marker. The full `install()` (which adds app.on('render-process-gone')
   * etc.) is still needed and should be called from main.ts after the
   * second-instance handler but before app.whenReady().
   */
  static installBeforeReady(consoleLog?: LogFn): void {
    const instance = LifecycleTracker.getInstance();
    // FIX-HIGH-1: use the dedicated flag (not `installed`) so that
    // `install()` does NOT prevent `installBeforeReady()` from running
    // later, AND so that two `installBeforeReady()` calls don't double-
    // register process.on('uncaughtException') (which fires the handler
    // twice on every crash).
    if (instance.beforeReadyInstalled) return;
    instance.beforeReadyInstalled = true;
    instance.consoleLog = consoleLog;

    const record = (event: string, reason?: QuitReason, meta?: Record<string, unknown>) => {
      instance.marker.lastEvent = event;
      instance.marker.lastEventAt = new Date().toISOString();
      if (reason) {
        instance.marker.quitReason = reason;
        instance.marker.quitMeta = meta;
      }
      try { instance.writeMarker(); } catch { /* best-effort */ }
      const safeMeta = meta ? sanitizeMeta(meta) as Record<string, unknown> : undefined;
      consoleLog?.(`[Lifecycle] ${event}${reason ? ` reason=${reason}` : ''}`, safeMeta);
    };

    process.on('uncaughtException', (err) => {
      // Don't intercept the nativeArch dialog handler — main.ts and
      // nativeArchGate.ts have their own uncaughtException for the
      // [nativeArch] prefix path. We log and tag, but don't prevent
      // the existing handlers from running.
      record('uncaughtException', 'fatal-main-error', {
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : typeof err,
      });
    });

    process.on('unhandledRejection', (reason) => {
      record('unhandledRejection', 'fatal-main-error', {
        reason: reason instanceof Error ? reason.message : String(reason),
      });
    });

    process.on('SIGTERM', () => record('SIGTERM', 'os-signal'));
    process.on('SIGINT', () => record('SIGINT', 'os-signal'));
    process.on('SIGHUP', () => record('SIGHUP', 'os-signal'));
  }

  /**
   * Mark a specific quit reason. Call BEFORE the actual quit (e.g. before
   * `autoUpdater.quitAndInstall`, before `app.quit()` from a fatal path).
   * Without this, the next launch's marker can't tell whether the prior
   * session ended cleanly or in a crash.
   */
  setQuitReason(reason: QuitReason, meta?: Record<string, unknown>): void {
    this.marker.quitReason = reason;
    this.marker.quitMeta = meta;
    this.marker.lastEvent = `quit-reason:${reason}`;
    this.marker.lastEventAt = new Date().toISOString();
    try { this.writeMarker(); } catch { /* best-effort */ }
    const safeMeta = meta ? sanitizeMeta(meta) as Record<string, unknown> : undefined;
    this.consoleLog?.(`[Lifecycle] quit-reason set reason=${reason}`, safeMeta);
  }

  /**
   * Called at the very end of a clean shutdown to record the clean exit.
   *
   * IMPORTANT: only clears the quit reason / meta if no specific reason
   * was set. Otherwise an `updater-quit-install` or `fatal-main-error`
   * reason would be clobbered, producing a false-positive "previous
   * session crashed" warning on next launch — exactly the bug the
   * senior review caught in v2.8.1.
   */
  markCleanExit(): void {
    const hadSpecificReason = this.marker.quitReason !== null;
    this.marker.lastEvent = 'clean-exit';
    this.marker.lastEventAt = new Date().toISOString();
    if (!hadSpecificReason) {
      this.marker.quitReason = null;
      this.marker.quitMeta = undefined;
    }
    try { this.writeMarker(); } catch { /* best-effort */ }
    if (hadSpecificReason) {
      // Log so a maintainer reviewing the trace can see what happened —
      // we DID complete cleanup but a reason was preserved.
      this.consoleLog?.(`[Lifecycle] clean exit (preserved quitReason=${this.marker.quitReason})`);
    } else {
      this.consoleLog?.('[Lifecycle] clean exit');
    }
  }

  /**
   * Read the marker written by the PREVIOUS process (if any). Returns null
   * if the file is missing, unparseable, or was written by the same PID.
   *
   * Use this on startup to decide whether to surface a "previous session
   * ended unexpectedly" toast to the user. ONLY reads the durable userData
   * marker — the tmpdir fallback (used by pre-whenReady handlers) is
   * process-scoped and gets cleared by the OS, so it's not useful for
   * cross-launch detection.
   */
  readPreviousSessionMarker(): LifecycleMarker | null {
    let file: string | null = null;
    try {
      file = path.join(app.getPath('userData'), 'lifecycle-marker.json');
    } catch {
      return null; // not yet ready
    }
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed: LifecycleMarker = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.pid === process.pid) return null; // same PID → no prior session
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * True if the previous session's marker indicates a non-clean exit. Use
   * this on startup to decide whether to show a "previous session ended
   * unexpectedly" message in the UI.
   *
   * Reasons treated as NON-crash (intentional user-or-system-driven exits):
   *   - user-quit         — Cmd+Q / tray quit / quit-app IPC
   *   - window-close      — window-all-closed on non-darwin (default for win/linux)
   *   - updater-quit-install — autoUpdater.quitAndInstall (real upgrade applied)
   *   - manual-relaunch   — app.relaunch() from a self-update path
   *   - second-instance   — duplicate-instance lock fired
   *   - os-signal         — caught SIGTERM/SIGINT/SIGHUP (graceful shutdown)
   *
   * Anything else (renderer-gone, child-process-gone, gpu-process-crashed,
   * fatal-main-error, unknown) IS a crash signal — surface the warning.
   */
  didPreviousSessionCrash(): boolean {
    const prev = this.readPreviousSessionMarker();
    if (!prev) return false;
    if (!prev.quitReason) {
      // Marker exists but no quit reason — could mean the process was
      // SIGKILL'd mid-shutdown (no time to call markCleanExit). Treat as
      // a soft crash signal so the user gets diagnostic info.
      return prev.lastEvent !== 'clean-exit';
    }
    const NON_CRASH_REASONS: ReadonlySet<QuitReason> = new Set<QuitReason>([
      'user-quit',
      'window-close',
      'updater-quit-install',
      'manual-relaunch',
      'second-instance',
      'os-signal',
    ]);
    return !NON_CRASH_REASONS.has(prev.quitReason);
  }

  // --- internal ----------------------------------------------------------

  /**
   * Resolve the marker path. Tries `app.getPath('userData')` first (the
   * canonical Electron location) and falls back to a tmpdir-based fallback
   * when called BEFORE app.whenReady() — that's the case for handlers
   * installed at module-load time (e.g. native-arch gate's pre-whenReady
   * path). The fallback path uses `${tmp}/natively-lifecycle-${pid}.json`
   * so the marker is still per-PID and the next launch can find it.
   *
   * IMPORTANT: userData is the durable location (survives reboots); the
   * tmpdir fallback is best-effort only (cleared by the OS on reboot).
   * We always prefer userData when it works, and only fall back when it
   * throws (i.e. before app.ready).
   */
  private markerPath(): string | null {
    try {
      return path.join(app.getPath('userData'), 'lifecycle-marker.json');
    } catch {
      // app.ready hasn't fired yet — write to tmpdir so we still capture
      // the event. The marker is still PID-scoped (we never read across
      // PIDs), so this is safe even though it's not durable across reboots.
      try {
        return path.join(os.tmpdir(), `natively-lifecycle-${process.pid}.json`);
      } catch {
        return null;
      }
    }
  }

  private writeMarker(): void {
    const file = this.markerPath();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.marker, null, 2));
    } catch {
      // best-effort; the log line is the durable signal
    }
  }
}

/**
 * Defensive meta sanitizer — strip anything that looks like a credential,
 * key, or token. The lifecycle marker is logged to disk, so an
 * accidentally-passed `meta: { apiKey: 'sk-...' }` must NEVER leak.
 *
 * Recursively walks nested objects and arrays so a structured payload like
 * `{ user: { apiKey: 'sk-...' } }` or `{ error: new Error('… token=abc123') }`
 * is also redacted. FIX-HIGH-2: the prior top-level-only sanitizer let
 * `meta.apiKey` inside a nested object bypass the regex.
 *
 * ALSO redacts VALUE-pattern credentials embedded in free-form strings
 * (Error messages, URLs with `?api_key=…`, etc.) — replace `sk-…`,
 * `api_key=…`, `Bearer …`, etc. with `[REDACTED]`. Without this, an
 * Error message like `'request failed: api_key=sk-secret leaked'`
 * would survive the sanitizer verbatim.
 *
 * Depth is bounded so a pathological cyclic structure can't loop forever.
 */
const SENSITIVE_KEY_RE = /key|secret|token|password|auth|credential/i;
// Patterns that mark value-content as a credential. Order matters — the
// more specific patterns (Bearer, sk-, ghp_) come first so they win over
// the generic `key=…` matcher.
const SENSITIVE_VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  /\bBearer\s+[A-Za-z0-9._\-+/=]{6,}/g,
  /\bsk-[A-Za-z0-9_\-]{16,}/g,                              // OpenAI / sk-*
  /\bghp_[A-Za-z0-9]{20,}/g,                                // GitHub PAT
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,                        // Slack
  /\bAIza[0-9A-Za-z_\-]{35}/g,                              // Google API keys
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?([^\s"']{6,})["']?/gi,
];
const MAX_SANITIZE_DEPTH = 4;
const MAX_STRING_LEN = 200;

function redactString(s: string): string {
  let out = s;
  for (const re of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

function sanitizeMeta(meta: unknown, depth: number = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return '[max-depth]';
  if (meta === null || meta === undefined) return meta;

  // Error → safe string. The Error.message itself is run through the
  // value-pattern redactor so an embedded credential like `api_key=sk-...`
  // doesn't survive verbatim.
  if (meta instanceof Error) {
    let msg = String(meta.message ?? meta);
    msg = redactString(msg);
    return `[Error: ${msg.length > MAX_STRING_LEN ? `${msg.slice(0, MAX_STRING_LEN)}…` : msg}]`;
  }

  // Arrays: walk each element.
  if (Array.isArray(meta)) {
    return meta.map((v) => sanitizeMeta(v, depth + 1));
  }

  // Plain object: redact keys matching the pattern and recurse into values.
  if (typeof meta === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '[REDACTED]';
        continue;
      }
      if (typeof v === 'string') {
        const redacted = redactString(v);
        out[k] = redacted.length > MAX_STRING_LEN ? `[${redacted.length} chars]` : redacted;
        continue;
      }
      out[k] = sanitizeMeta(v, depth + 1);
    }
    return out;
  }

  // Primitives: pass through (strings already length-checked by callers).
  return meta;
}

function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.hostname}${u.pathname}`;
  } catch {
    return '[unparseable]';
  }
}
