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
