// src/lib/cornerSlot.mjs
//
// The launcher's bottom-right corner holds one notice at a time (2026-11-09).
//
// The meeting offer, the update toast, the quota notice, the trial meter, the
// Hindsight notice and the provider-change notice all sit in that corner, each
// fixed there on its own, so two at once were drawn on top of each other. Each
// now asks this slot while it wants to show; only the highest-priority one
// asking is shown, and the others wait (still asking), so each comes back when
// the corner frees. Nothing is dropped. Pure; no DOM, no platform branches.

/** Highest priority first. */
export const CORNER_PRIORITY = Object.freeze([
  'meeting_offer',
  'update',
  'quota',
  'trial_meter',
  'hindsight',
  'provider_notice',
]);

export function createCornerSlot(order = CORNER_PRIORITY) {
  const asking = new Set();
  const listeners = new Set();
  let current = null;

  const recompute = () => {
    const next = order.find((id) => asking.has(id)) ?? null;
    if (next === current) return;
    current = next;
    listeners.forEach((l) => l());
  };

  return {
    /** `id` wants the corner (idempotent). */
    request(id) {
      if (!order.includes(id)) throw new Error(`unknown corner notice: ${id}`);
      asking.add(id);
      recompute();
    },
    /** `id` no longer wants it (idempotent). */
    release(id) {
      asking.delete(id);
      recompute();
    },
    /** The notice the corner shows now, or null. */
    holder() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The one corner of this window. */
export const cornerSlot = createCornerSlot();
