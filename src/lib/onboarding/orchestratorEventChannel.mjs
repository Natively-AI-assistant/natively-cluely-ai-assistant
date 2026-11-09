// src/lib/onboarding/orchestratorEventChannel.mjs
//
// The launcher's events for the onboarding orchestrator (launcher mounted,
// foreground, meeting, turns, usage) pass through here on their way to
// OrchestratorProvider, which attaches the orchestrator when it mounts.
//
// Events sent before it attaches are kept and handed over, in order, when it
// does (2026-11-09). The provider mounts only once the first-run Welcome is
// gone, in the same commit as the Launcher, and the Launcher's effect (which
// sends 'launcher:mounted') runs before the provider's. Dropping events until
// then lost that one, so after Welcome the orchestrator never knew Home was
// up and the first-run cards never came.
//
// It is not forwarded straight to the orchestrator singleton: other windows
// (the overlay) also send events here and never mount a provider, and an
// orchestrator built there would write the launcher's persisted onboarding
// state from a second renderer. The queue is bounded so such a window cannot
// grow it without end. Pure; no DOM, no platform branches.

/** Most events kept while nothing is attached; the oldest go first. */
export const MAX_PENDING_EVENTS = 100;

/**
 * @template E
 * @param {{ maxPending?: number }} [options]
 */
export function createOrchestratorEventChannel({ maxPending = MAX_PENDING_EVENTS } = {}) {
  /** @type {((e: E) => void) | null} */
  let target = null;
  /** @type {E[]} */
  let pending = [];

  return {
    /** Send an event now, or keep it for when the orchestrator attaches. */
    emit(e) {
      if (target) { target(e); return; }
      pending.push(e);
      if (pending.length > maxPending) pending.splice(0, pending.length - maxPending);
    },
    /**
     * Attach the orchestrator's emit; every kept event is handed to it first,
     * in the order sent. Returns the detach.
     */
    attach(fn) {
      target = fn;
      const queued = pending;
      pending = [];
      for (const e of queued) fn(e);
      return () => { if (target === fn) target = null; };
    },
    /** Events kept so far (tests). */
    pendingCount() { return pending.length; },
  };
}
