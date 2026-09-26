// Keeps the process's NON-BrowserWindow windows out of screen capture while
// Undetectable is on: file pickers, message boxes, tooltips, <select> popups,
// menus. Electron's setContentProtection only reaches BrowserWindows, and each
// of these is its own OS window (measured 2026-09-27 on macOS: the resume
// picker was an 880x448 window owned by Natively reading sharing state 1, so
// it showed in a screen share while the launcher beside it read 0).
//
// The native half (native-module/src/capture_exclusion.rs) is a sweep, not a
// hook, so this module decides WHEN to sweep:
//   - right after an async dialog.* call returns, before the event loop can
//     composite the new window, then every 16ms until that dialog settles;
//   - every 50ms while Undetectable is on, for windows main never sees open
//     (tooltips, popups);
//   - the moment the app activates or a window gains focus: macOS resets a
//     window's sharing state on an activation change (measured: ~3 captured
//     frames of a picker), so the native side re-applies unconditionally;
//   - once with `false` when Undetectable turns off, restoring them.
// BrowserWindows are always passed as `own` and left to Electron. With
// Undetectable off nothing is touched. An older native binary without the
// function makes every call a no-op.

export interface ForeignWindowNative {
  setForeignWindowsCaptureExcluded?: (excluded: boolean, ownHandles: Buffer[]) => number;
}

export interface ForeignWindowGuardDeps {
  native: () => ForeignWindowNative | null;
  /** Native handles of every live BrowserWindow (left to Electron). */
  ownHandles: () => Buffer[];
  isUndetectable: () => boolean;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  log?: (message: string) => void;
}

export const IDLE_SWEEP_MS = 50;
export const DIALOG_SWEEP_MS = 16;

export function createForeignWindowCaptureGuard(deps: ForeignWindowGuardDeps) {
  const every = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const stop = deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  let idleTimer: unknown = null;
  let openDialogs = 0;
  let dialogTimer: unknown = null;

  const call = (excluded: boolean): number => {
    try {
      const fn = deps.native()?.setForeignWindowsCaptureExcluded;
      return typeof fn === 'function' ? fn(excluded, deps.ownHandles()) : 0;
    } catch (e: any) {
      deps.log?.(`[ForeignWindowCapture] sweep failed: ${e?.message ?? e}`);
      return 0;
    }
  };

  const sweep = (): number => (deps.isUndetectable() ? call(true) : 0);

  return {
    sweep,

    /** Follow Undetectable: start the idle sweep when on, stop and restore when off. */
    sync(undetectable: boolean): void {
      if (undetectable) {
        sweep();
        if (idleTimer === null) idleTimer = every(sweep, IDLE_SWEEP_MS);
      } else {
        if (idleTimer !== null) {
          stop(idleTimer);
          idleTimer = null;
        }
        call(false);
      }
    },

    /**
     * Run an async dialog call, sweeping as soon as it returns (the window
     * exists but has not been composited yet) and every 16ms until it settles.
     */
    around<T>(open: () => Promise<T>): Promise<T> {
      const pending = open();
      sweep();
      // Nothing to do with Undetectable off. If it turns on while this dialog
      // is open, the idle sweep sync(true) starts covers it.
      if (!deps.isUndetectable()) return pending;
      openDialogs += 1;
      if (dialogTimer === null) dialogTimer = every(sweep, DIALOG_SWEEP_MS);
      const done = () => {
        openDialogs -= 1;
        if (openDialogs === 0 && dialogTimer !== null) {
          stop(dialogTimer);
          dialogTimer = null;
        }
      };
      return pending.then(
        (value) => { done(); return value; },
        (err) => { done(); throw err; },
      );
    },
  };
}

export type ForeignWindowCaptureGuard = ReturnType<typeof createForeignWindowCaptureGuard>;

/**
 * Route Electron's async dialogs through the guard. The sync variants block the
 * main thread, so nothing can sweep while they are open; their stealth-relevant
 * callers are refused in Undetectable mode instead (stealthPromptGate.ts).
 */
export function wrapAsyncDialogs(
  dialog: Record<string, any>,
  guard: ForeignWindowCaptureGuard,
): void {
  for (const name of ['showOpenDialog', 'showSaveDialog', 'showMessageBox'] as const) {
    const original = dialog[name];
    if (typeof original !== 'function' || original.__foreignWindowGuarded) continue;
    const wrapped = (...args: unknown[]) => guard.around(() => original.apply(dialog, args));
    (wrapped as any).__foreignWindowGuarded = true;
    dialog[name] = wrapped;
  }
}
