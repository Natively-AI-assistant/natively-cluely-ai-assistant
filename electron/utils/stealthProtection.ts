// Periodic content-protection re-assertion while undetectable.
//
// setContentProtection is the primitive that keeps a window out of screen
// captures — but it is a *set-once* call on a live window, and several paths
// can silently undo it after the fact: a window created after the last
// disguise apply, a re-created window (macOS activate, render-process-gone),
// an activation-policy flip (app.dock.hide()/show() resets sharingType — see
// reassertAllContentProtection), and on Windows an Electron race where the
// creation-hook registration can silently fail (cf. Electron #39907, which
// Final Round's StealthService cites as the reason for its own 500ms loop).
//
// This module is the backstop for all of those: while undetectable, every
// 500ms it re-asserts content protection on every known window. The call is
// idempotent and cheap (SetWindowDisplayAffinity / sharingType set to the
// value already in force is a no-op at the OS level), so the loop is safe to
// run for a whole session. It never runs in normal mode.
//
// Pure (no electron import) so it can be unit-tested in bare `node --test`.
// State is read through getters at EVENT/TICK time (not attach time), so a
// mid-session undetectable toggle is honoured without re-attaching. The
// scheduler is injectable so tests don't wait on real timers. See
// __tests__/stealthProtection.test.mjs.

export interface StealthProtectionWindow {
  /** Stable label for diagnostics (e.g. 'launcher', 'overlay-pill'). */
  label: string;
  win: unknown;
}

export interface StealthProtectionDeps {
  /** Current undetectable state, read on every tick and every show/restore. */
  isUndetectable: () => boolean;
  /** All windows under protection (null/destroyed entries are skipped). */
  getWindows: () => StealthProtectionWindow[];
  /** Re-assert interval. Final Round uses 500ms; same default here. */
  intervalMs?: number;
  /** Timer factory (injectable for tests). Must return a stop handle. */
  schedule?: (fn: () => void, ms: number) => { stop: () => void };
}

export interface StealthProtectionResult {
  applied: number;
  skipped: number;
}

interface WindowLike {
  isDestroyed(): boolean;
  setContentProtection(enable: boolean): void;
  on?(event: string, listener: () => void): void;
}

function asWindow(win: unknown): WindowLike | null {
  if (!win || typeof win !== 'object') return null;
  const w = win as Partial<WindowLike>;
  if (typeof w.isDestroyed !== 'function' || typeof w.setContentProtection !== 'function') return null;
  if (w.isDestroyed()) return null;
  return w as WindowLike;
}

const ATTACHED_MARKER = '__nativelyStealthProtection';

export interface StealthProtectionLoop {
  /** One re-assertion pass. No-op unless undetectable. Never throws. */
  applyOnce(): StealthProtectionResult;
  /**
   * Attach show/restore re-apply listeners to one window. Idempotent (marker
   * on the window object). The listeners themselves read isUndetectable at
   * event time, so they are inert in normal mode.
   */
  attachWindow(win: unknown): void;
  /** Start the periodic loop. Idempotent; no-op while already running. */
  start(): void;
  /** Stop the periodic loop. Idempotent. */
  stop(): void;
  readonly running: boolean;
}

export function createStealthProtectionLoop(deps: StealthProtectionDeps): StealthProtectionLoop {
  const intervalMs = deps.intervalMs ?? 500;
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const t = setInterval(fn, ms);
      // Never keep the process alive for stealth bookkeeping.
      (t as unknown as { unref?: () => void }).unref?.();
      return { stop: () => clearInterval(t) };
    });

  let handle: { stop: () => void } | null = null;

  function applyTo(w: WindowLike): boolean {
    try {
      w.setContentProtection(true);
      return true;
    } catch {
      return false;
    }
  }

  const loop: StealthProtectionLoop = {
    applyOnce(): StealthProtectionResult {
      let undetectable = false;
      try {
        undetectable = deps.isUndetectable();
      } catch {
        return { applied: 0, skipped: 0 };
      }
      if (!undetectable) return { applied: 0, skipped: 0 };
      let applied = 0;
      let skipped = 0;
      for (const { win } of deps.getWindows()) {
        const w = asWindow(win);
        if (!w) {
          skipped += 1;
          continue;
        }
        if (applyTo(w)) applied += 1;
        else skipped += 1;
      }
      return { applied, skipped };
    },

    attachWindow(win: unknown): void {
      const w = asWindow(win);
      if (!w || typeof w.on !== 'function') return;
      const marker = w as WindowLike & { [ATTACHED_MARKER]?: boolean };
      if (marker[ATTACHED_MARKER]) return;
      marker[ATTACHED_MARKER] = true;
      const reapply = () => {
        let undetectable = false;
        try {
          undetectable = deps.isUndetectable();
        } catch {
          return;
        }
        if (!undetectable) return;
        const live = asWindow(win);
        if (live) applyTo(live);
      };
      w.on('show', reapply);
      w.on('restore', reapply);
    },

    start(): void {
      if (handle) return;
      handle = schedule(() => {
        try {
          loop.applyOnce();
        } catch {
          // Never let stealth bookkeeping break the app.
        }
      }, intervalMs);
    },

    stop(): void {
      if (!handle) return;
      try {
        handle.stop();
      } catch {
        // Best effort.
      }
      handle = null;
    },

    get running(): boolean {
      return handle !== null;
    },
  };

  return loop;
}
