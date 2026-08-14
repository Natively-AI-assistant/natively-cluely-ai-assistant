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
