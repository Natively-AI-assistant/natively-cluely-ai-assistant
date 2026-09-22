/**
 * toggleStateReducer — pure decision logic for boolean window/stealth toggles
 * (undetectable / overlay mouse-passthrough).
 *
 * Extracted so the core invariant can be unit-tested without Electron:
 *
 *   INVARIANT (fixes the "toggle shows the wrong state" desync, RC-2):
 *   we ALWAYS reconcile the renderer with the authoritative main-process state,
 *   even when the requested value equals the current value. Previously, a no-op
 *   request (`current === requested`) early-returned WITHOUT broadcasting, so if
 *   the renderer's optimistic state had drifted from main (e.g. a dropped/duplicate
 *   event, or a concurrent shortcut press), the UI stayed visually desynced until
 *   the user toggled to a *different* value. Always broadcasting the authoritative
 *   state makes that desync self-healing.
 *
 *   Side-effects (content protection, dock hide/show, native stealth) are still
 *   gated on `changed` so we don't redundantly thrash macOS dock/focus on a no-op.
 */

export interface ToggleDecision {
  /** The authoritative next state (always equals the requested value). */
  next: boolean;
  /** Whether the value actually changed (gates expensive OS side-effects). */
  changed: boolean;
  /** Always true: reconcile the renderer with authoritative state every time. */
  broadcast: true;
}

export function decideToggle(current: boolean, requested: boolean): ToggleDecision {
  return {
    next: requested,
    changed: current !== requested,
    broadcast: true,
  };
}

/**
 * decideDockTransition — pure decision for whether the (debounced) macOS dock
 * hide/show side-effect needs to run.
 *
 * Why this exists: on macOS, app.dock.hide()/show() flips the app's activation
 * policy, and rapid flips churn WindowServer (and can reset window sharingType,
 * undoing content protection). The dock op is debounced so only the SETTLED
 * state matters — but if the dock is ALREADY in that state (e.g. the user
 * toggled ON→OFF→ON and the dock was already hidden), running it again is pure
 * churn. `lastApplied` is the last dock state we actually pushed to the OS
 * (null = never applied yet, so the first transition always runs).
 *
 *   settled   = the desired undetectable state after debounce settles
 *   lastApplied = the dock state already applied to the OS (or null)
 *   → shouldApply: run app.dock.hide()/show() only when it would change the OS
 *   → next: the state to record as applied once it runs
 */
export interface DockTransitionDecision {
  shouldApply: boolean;
  next: boolean;
}

export function decideDockTransition(
  settled: boolean,
  lastApplied: boolean | null,
): DockTransitionDecision {
  return {
    shouldApply: settled !== lastApplied,
    next: settled,
  };
}

/**
 * Self-verifying dock enforcement budget (AppState._enforceDockState).
 *
 * Electron's Browser::DockHide() (shell/browser/browser_mac.mm) is a SILENT
 * NO-OP for one second after any Browser::DockShow() — a workaround for a
 * macOS bug that leaves duplicate tiles behind on rapid hide/show flips. So a
 * show that lands right before or during the enforcement loop (an LS check-in
 * from `process.title`, a click on the pinned Dock tile) cannot be corrected by
 * any hide issued inside that second. The loop must therefore keep polling
 * app.dock.isVisible() for LONGER than the guard, or it gives up with the tile
 * still showing — which is exactly what the 2026-09-22 live trace showed for
 * the old 6 × 130 ms = 780 ms budget.
 */
export const ELECTRON_DOCK_HIDE_GUARD_MS = 1000;
export const DOCK_ENFORCE_INTERVAL_MS = 130;
/** Toggle / launcher-show budget: 10 × 130 ms = 1.3 s > the 1 s guard. */
export const DOCK_ENFORCE_MAX_ATTEMPTS = 10;
/**
 * Startup budget: on a cold launch the dock re-show lands at the launcher's
 * ready-to-show, which can arrive later than the toggle window — ~2.3 s.
 */
export const DOCK_ENFORCE_STARTUP_MAX_ATTEMPTS = 18;

/**
 * shouldWriteProcessTitle — may `_applyDisguise()` assign `process.title`?
 *
 * On macOS, `process.title = …` is not a plain string write: libuv's
 * uv__set_process_title (src/unix/darwin-proctitle.c) calls the private
 * LaunchServices SPI `_LSApplicationCheckIn(-2, <main bundle Info.plist>)`
 * before renaming. Natively.app carries no LSUIElement, so that check-in
 * re-registers the running process as a Foreground app — the same effect as
 * app.dock.show(): the Dock tile and its running dot reappear, undoing
 * dock.hide(). The +5 s re-assert timer in _applyDisguise() is what brought the
 * tile back ~5.7 s after every launch in undetectable mode (live trace,
 * 2026-09-22). Activity Monitor reads the LS display name, not the process
 * title, so the write buys no disguise there; only `ps`/`top` see it.
 *
 * Elsewhere the title is harmless (Windows: console title; Linux: argv[0]),
 * and in normal mode on macOS the tile is meant to be visible anyway.
 */
export function shouldWriteProcessTitle(platform: string, isUndetectable: boolean): boolean {
  if (platform !== 'darwin') return true;
  return !isUndetectable;
}
