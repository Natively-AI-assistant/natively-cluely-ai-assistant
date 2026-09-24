// src/components/onboarding/geniePresence.mjs
//
// The genie for a card whose host only says "open" or "not open".
//
// The onboarding toasters close themselves: they run the genie first and tell
// the host afterwards (useGenieCard's closeThen). Settings, the Modes and
// Profile manager and the other popups are the other way round: the host flips
// a boolean and expects the card to be gone. This is the latch between the
// two. The card stays mounted after `open` goes false, plays the close, and
// only then unmounts.
//
//   closed ──open──▶ shown ──(open false)──▶ closing ──genie done──▶ closed
//
// Asked to open again while it is still closing, the close finishes first and
// the card then pours out afresh. It never jumps back mid-funnel.
//
// Pure, with no React and no DOM, so the tests run it directly.

/** @typedef {{ mounted: boolean, closing: boolean }} PresenceState */

/** @param {boolean} open @returns {PresenceState} */
export function presenceInitial(open) {
  return { mounted: open, closing: false };
}

/**
 * @param {PresenceState} state
 * @param {'open' | 'close' | 'closed'} event
 * @returns {PresenceState}
 */
export function presenceReducer(state, event) {
  switch (event) {
    case 'open':
      // Mid-close is left alone; `presenceEventFor` re-opens once it lands.
      return state.mounted ? state : { mounted: true, closing: false };
    case 'close':
      return state.mounted && !state.closing ? { mounted: true, closing: true } : state;
    case 'closed':
      return state.mounted ? { mounted: false, closing: false } : state;
    default:
      return state;
  }
}

/**
 * What the host's `open` asks of the current state, if anything.
 * @param {PresenceState} state
 * @param {boolean} open
 * @returns {'open' | 'close' | null}
 */
export function presenceEventFor(state, open) {
  if (open && !state.mounted) return 'open';
  if (!open && state.mounted && !state.closing) return 'close';
  return null;
}
