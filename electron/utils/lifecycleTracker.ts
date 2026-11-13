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

import { app, BrowserWindow, WebContents, utilityProcess, powerMonitor } from 'electron';
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
  | 'app-restart'             // 2026-11-14: app.relaunch() + app.exit(0) ("Restart now"), which skips before-quit
  | 'fatal-main-error'        // uncaughtException or unhandledRejection forced exit
  // The next three are kept for markers written by older builds. A process
  // dying no longer sets the quit reason (see `noteIncident`); it is kept in
  // `lastIncident` instead.
  | 'renderer-gone'           // render-process-gone (renderer crashed)
  | 'child-process-gone'      // child-process-gone (utility process died)
  | 'gpu-process-crashed'     // gpu-process-crashed
  | 'second-instance'         // duplicate instance lock fired → we asked user to focus
  | 'os-signal'               // SIGTERM / SIGINT (graceful) or SIGKILL (logged, not caught)
  // 2026-11-14: the OS is shutting down, restarting or logging the user off
  // (Windows: a window's 'session-end'; macOS: powerMonitor 'shutdown').
  | 'os-shutdown'
  | 'unknown';

/**
 * Processes the app survived during a session, counted by kind. Only real
 * failures count (see CRASH_REASONS), and only before a quit began: windows
 * closing their renderers during a quit are not crashes.
 */
export interface ProcessCrashCounts {
  renderer: number;
  gpu: number;
  helper: number;
  /** How many of the above ran out of memory (oom / memory-eviction). */
  oom: number;
}

export interface LifecycleMarker {
  pid: number;
  startedAt: string;          // ISO
  lastEvent: string;          // last lifecycle event name
  lastEventAt: string;        // ISO of last event
  quitReason: QuitReason | null;
  quitMeta?: Record<string, unknown>;
  /**
   * The last renderer / child / GPU process that died while the app kept
   * running. Diagnostic only: it never decides whether the session crashed.
   */
  lastIncident?: { event: string; at: string; meta?: Record<string, unknown> };
  // Added 2026-11-14 (absent from markers written by older builds):
  /** The app version that wrote this marker. */
  version?: string;
  /** Refreshed every few minutes while the app runs: its last sign of life. */
  aliveAt?: string;
  crashes?: ProcessCrashCounts;
}

/** `render-process-gone` / `child-process-gone` reasons that are failures. */
export const CRASH_REASONS: ReadonlySet<string> = new Set([
  'crashed', 'oom', 'abnormal-exit', 'launch-failed', 'integrity-failure', 'memory-eviction',
]);
const OOM_REASONS: ReadonlySet<string> = new Set(['oom', 'memory-eviction']);

/** How often a running app refreshes `aliveAt` on its marker. */
export const HEARTBEAT_MS = 5 * 60_000;
/** A Windows shutdown asked about but not followed through within this is taken as called off. */
export const SHUTDOWN_CANCEL_MS = 2 * 60_000;

/**
 * Process deaths the app survives. A renderer, utility or GPU process dying
 * does not end the session: main.ts reloads the window or Chromium respawns
 * the process. If one of these set the quit reason, the label stuck for the
 * rest of the session, so a later normal Cmd+Q was logged as
 * "before-quit reason=renderer-gone" and the next launch reported that the
 * previous session "ended unexpectedly" (seen 2026-10-31). Windows closing
 * their renderers during a quit could also overwrite 'user-quit' the same way.
 * These events now go to `lastIncident`. A session that really dies after one
 * still reads as a crash: its marker never reaches 'clean-exit'.
 */
export const SURVIVABLE_PROCESS_EVENTS: ReadonlySet<string> = new Set([
  'render-process-gone',
  'child-process-gone',
  'gpu-process-crashed',
]);

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
  /**
   * The previous session's marker, read once by install() BEFORE this session
   * writes its own. undefined until then (readPreviousSessionMarker reads the
   * file live until install() has run).
   */
  private previous: LifecycleMarker | null | undefined = undefined;
  /** A quit has begun: process deaths from here on are windows closing, not crashes. */
  private quitting = false;
  private heartbeat: NodeJS.Timeout | null = null;
  /**
   * Windows asked whether the session may end ('query-session-end') and
   * 'session-end' has not followed yet: the quit reason is 'os-shutdown' for
   * now, and `before` is what it was.
   */
  private pendingShutdown: {
    before: { reason: QuitReason | null; meta?: Record<string, unknown> };
    timer: NodeJS.Timeout;
  } | null = null;
  /** When the debug log was last written before this process first wrote to it (ms), or null. */
  private priorLogWriteAt: number | null | undefined = undefined;

  private constructor() {
    this.marker = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastEvent: 'app-start',
      lastEventAt: new Date().toISOString(),
      quitReason: null,
      crashes: { renderer: 0, gpu: 0, helper: 0, oom: 0 },
    };
    try { this.marker.version = app.getVersion(); } catch { /* stub or too early */ }
  }

  /**
   * Wire all lifecycle handlers. Idempotent — second call is a no-op.
   *
   * @param platform injectable for tests; decides how an OS shutdown is heard
   *        (Windows: each window's 'session-end'; macOS and Linux: powerMonitor 'shutdown').
   */
  install(consoleLog?: LogFn, platform: NodeJS.Platform = process.platform): void {
    if (this.installed) return;
    this.installed = true;
    // Allow installBeforeReady to have set consoleLog earlier (pre-whenReady).
    this.consoleLog = consoleLog ?? this.consoleLog;

    // 2026-11-14: keep the previous session's marker, THEN write this one's.
    // Before this, a session wrote nothing until it quit or something died, so
    // a session that vanished without a word (a native crash, a force quit, a
    // power cut) left the session before it on disk, and the next launch read
    // that one's 'clean-exit' and reported no crash.
    this.previous = this.readMarkerFile();
    try { this.writeMarker(); } catch { /* best-effort */ }
    this.heartbeat = setInterval(() => {
      this.marker.aliveAt = new Date().toISOString();
      try { this.writeMarker(); } catch { /* best-effort */ }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();

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

    // A process the app survives: log it and keep it as the last incident,
    // but leave the quit reason alone (see SURVIVABLE_PROCESS_EVENTS).
    const noteIncident = (event: string, meta?: Record<string, unknown>) => {
      const at = new Date().toISOString();
      const safeMeta = meta ? sanitizeMeta(meta) as Record<string, unknown> : undefined;
      this.marker.lastEvent = event;
      this.marker.lastEventAt = at;
      this.marker.lastIncident = { event, at, meta: safeMeta };
      try { this.writeMarker(); } catch { /* best-effort */ }
      consoleLog?.(`[Lifecycle] ${event} (app keeps running; quit reason unchanged)`, safeMeta);
    };

    // MISSING HANDLERS that this module adds (PHASE-2E):
    app.on('will-quit', (event) => {
      // F-709: do NOT clobber a more specific reason. Electron fires
      // will-quit AFTER before-quit, and before-quit deliberately preserves an
      // existing reason (see below) — so an unguarded record here always won,
      // overwriting e.g. 'updater-quit-install' with 'user-quit' and dropping
      // its {fromVersion,toVersion} meta. The next launch then could not tell
      // "user quit" from "applied an update". Mirror the before-quit guard.
      if (!this.marker.quitReason) {
        record('will-quit', 'user-quit');
      } else {
        record('will-quit', this.marker.quitReason, this.marker.quitMeta);
      }
    });

    app.on('window-all-closed', () => {
      // macOS keeps running with no windows: closing them is not a quit, and
      // labelling it one made a later crash read as a quit (2026-11-14).
      if (platform === 'darwin') { record('window-all-closed'); return; }
      this.takeBackPendingShutdown('session-end-cancelled-by-quit', record);
      // Already handled elsewhere — but tag it so the log explains the quit.
      // Not over a more specific reason: on a Windows shutdown 'session-end'
      // comes first and the windows close after it.
      if (!this.marker.quitReason || this.marker.quitReason === 'user-quit') {
        record('window-all-closed', 'window-close');
      } else {
        record('window-all-closed', this.marker.quitReason, this.marker.quitMeta);
      }
    });

    app.on('before-quit', (event) => {
      // A quit while Windows has only asked about ending the session: the
      // shutdown was called off (during a real one Windows ends the process
      // after 'session-end' and no quit runs first), and this quit is the
      // user's. If 'session-end' still follows, it marks the shutdown again.
      this.takeBackPendingShutdown('session-end-cancelled-by-quit', record);
      this.quitting = true;
      // Don't overwrite a more specific reason (e.g. updater-quit-install).
      if (!this.marker.quitReason) {
        record('before-quit', 'user-quit');
      } else {
        record('before-quit', this.marker.quitReason, this.marker.quitMeta);
      }
    });

    // Counted before noteIncident writes the marker, so the count is on disk with it.
    const countCrash = (kind: 'renderer' | 'gpu' | 'helper', reason: unknown) => {
      if (this.quitting || typeof reason !== 'string' || !CRASH_REASONS.has(reason)) return;
      const c = (this.marker.crashes ||= { renderer: 0, gpu: 0, helper: 0, oom: 0 });
      c[kind] += 1;
      if (OOM_REASONS.has(reason)) c.oom += 1;
    };

    app.on('render-process-gone', (event, webContents: WebContents, details: Electron.RenderProcessGoneDetails) => {
      countCrash('renderer', details?.reason);
      noteIncident(
        'render-process-gone',
        {
          reason: details.reason,
          exitCode: details.exitCode,
          webContentsId: webContents.id,
          url: safeUrl(webContents.getURL()),
        }
      );
    });

    app.on('child-process-gone', (event, details: Electron.Details) => {
      countCrash(details?.type === 'GPU' ? 'gpu' : 'helper', details?.reason);
      noteIncident(
        'child-process-gone',
        {
          type: details.type,
          reason: details.reason,
          exitCode: details.exitCode,
          serviceName: details.serviceName,
        }
      );
    });

    // TODO(electron43): dead event on Electron 43; remove after verifying child-process-gone covers GPU crashes on macOS+Windows
    // The `as any` is type-only: Electron 43 dropped 'gpu-process-crashed' from its
    // typings, so no overload matches. The listener is deliberately KEPT registered
    // (removing it would be a behaviour change).
    app.on('gpu-process-crashed' as any, (event: Electron.Event, killed: boolean) => {
      noteIncident('gpu-process-crashed', { killed });
    });

    // 2026-11-14: an OS shutdown, restart or log-off. Without this it read as a
    // user quit at best (macOS sends the app a quit), and on Windows, where the
    // session can end before 'before-quit' runs, as a session that vanished.
    //
    // `tentative`: Windows asks first (WM_QUERYENDSESSION, 'query-session-end')
    // and the shutdown can still be called off (another app holds it up, the
    // user cancels). It is recorded at once, the earliest moment there is, in
    // case Windows ends the process before 'session-end' is handled; if the app
    // is still running SHUTDOWN_CANCEL_MS later with no quit begun, the label
    // is taken back.
    const osShutdown = (source: string, meta?: Record<string, unknown>, tentative = false) => {
      if (this.marker.quitReason === 'updater-quit-install') return;
      if (!tentative) {
        // Confirmed: nothing takes it back now.
        this.clearPendingShutdown();
        this.quitting = true;
        if (this.marker.quitReason !== 'os-shutdown') record(source, 'os-shutdown', meta);
        return;
      }
      if (this.marker.quitReason === 'os-shutdown') return; // every window is asked; once is enough
      const before = { reason: this.marker.quitReason, meta: this.marker.quitMeta };
      record(source, 'os-shutdown', meta);
      const timer = setTimeout(() => this.takeBackPendingShutdown('session-end-cancelled', record), SHUTDOWN_CANCEL_MS);
      timer.unref?.();
      this.pendingShutdown = { before, timer };
    };
    if (platform === 'win32') {
      // Both are BrowserWindow events; every window gets them.
      const reasonsOf = (e: any) => ({
        reasons: Array.isArray(e?.reasons) ? e.reasons.filter((r: unknown) => typeof r === 'string').slice(0, 4) : [],
      });
      app.on('browser-window-created', (_event, win: BrowserWindow) => {
        try {
          win.on('query-session-end' as any, (e: any) => osShutdown('query-session-end', reasonsOf(e), true));
          win.on('session-end', (e: any) => osShutdown('session-end', reasonsOf(e)));
        } catch { /* best-effort */ }
      });
    } else if (platform === 'darwin' || platform === 'linux') {
      // powerMonitor can only be used once the app is ready. Never preventDefault:
      // the app does not hold up a shutdown.
      try {
        app.whenReady?.().then(() => {
          try { powerMonitor?.on?.('shutdown', () => osShutdown('power-shutdown')); } catch { /* best-effort */ }
        }).catch(() => { /* best-effort */ });
      } catch { /* best-effort */ }
    }

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

    // 2026-11-14: a rejection is survivable. main.ts keeps running after an
    // isolated one and exits only when they repeat (terminateAfterFatalError,
    // which marks the run fatal itself). Setting the quit reason here made one
    // stray rejection turn the session's later normal quit into a "crash".
    process.on('unhandledRejection', (reason) => {
      const meta = sanitizeMeta({ reason: reason instanceof Error ? reason.message : String(reason) }) as Record<string, unknown>;
      const at = new Date().toISOString();
      instance.marker.lastEvent = 'unhandledRejection';
      instance.marker.lastEventAt = at;
      instance.marker.lastIncident = { event: 'unhandledRejection', at, meta };
      try { instance.writeMarker(); } catch { /* best-effort */ }
      instance.consoleLog?.('[Lifecycle] unhandledRejection (app keeps running; quit reason unchanged)', meta);
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
   * The debug log's modification time as this process found it, before its
   * first write (main.ts logToFile): the last moment a previous run wrote to
   * it. Unlike the marker, every build writes the log, so this still tells
   * the truth about a run of a build that left no marker of its own. Only the
   * first call counts.
   */
  notePriorLogWrite(mtimeMs: number | null): void {
    if (this.priorLogWriteAt !== undefined) return;
    this.priorLogWriteAt = typeof mtimeMs === 'number' && Number.isFinite(mtimeMs) ? mtimeMs : null;
  }

  getPriorLogWrite(): number | null {
    return this.priorLogWriteAt ?? null;
  }

  private clearPendingShutdown(): void {
    if (!this.pendingShutdown) return;
    clearTimeout(this.pendingShutdown.timer);
    this.pendingShutdown = null;
  }

  /** A shutdown Windows asked about did not happen: put the quit reason back. */
  private takeBackPendingShutdown(event: string, record: (event: string) => void): void {
    const pending = this.pendingShutdown;
    if (!pending) return;
    this.clearPendingShutdown();
    if (this.marker.quitReason !== 'os-shutdown') return;
    this.marker.quitReason = pending.before.reason;
    this.marker.quitMeta = pending.before.meta;
    record(event);
  }

  /** The app is about to restart itself (app.relaunch + app.exit, which skips before-quit). */
  markRestart(source: string): void {
    this.quitting = true;
    this.setQuitReason('app-restart', { source: String(source).slice(0, 80) });
  }

  /**
   * The main process is about to exit on a fatal error. Keeps a fatal reason
   * already set (an uncaughtException records its own, with the message).
   */
  markFatal(source: string): void {
    if (this.marker.quitReason === 'fatal-main-error') return;
    this.setQuitReason('fatal-main-error', { source: String(source).slice(0, 80) });
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
    // After install() this session has written its own marker over the file;
    // the previous one is the copy install() kept.
    if (this.previous !== undefined) return this.previous;
    return this.readMarkerFile();
  }

  private readMarkerFile(): LifecycleMarker | null {
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
   *   - os-shutdown       — the OS shut down, restarted or logged off
   *   - app-restart       — the app restarted itself ("Restart now")
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
      'os-shutdown',
      'app-restart',
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
