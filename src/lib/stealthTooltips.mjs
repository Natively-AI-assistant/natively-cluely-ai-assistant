// Custom (in-DOM) tooltip suppression while undetectable.
//
// Two tooltip kinds exist in this app, with different threat models:
//   1. Native `title` tooltips — separate OS windows OUTSIDE content
//      protection; they leak into screen shares. Handled by
//      nativeTooltipGuard.mjs (overlay family: always stripped; launcher:
//      stripped only while undetectable).
//   2. Custom `.t-tt` tooltips — plain absolutely-positioned divs INSIDE the
//      page, so content protection already hides them from captures. This
//      module: with the overlay and the meeting both fully usable
//      mid-session, no hover hint is worth even the residual risk (a tooltip
//      mid-fade during a protection re-assert, a future portal that escapes
//      the page), so while undetectable they don't render at all.
//
// Mechanism: a `data-tooltips` attribute on <html> (`off` = hide), driven by
// the same undetectable IPC the launcher native guard uses, with the same
// event-beats-read race discipline. The CSS rule lives next to the `.t-tt`
// definition in src/index.css. Installed for EVERY window (main.tsx) —
// overlay windows need it as much as the launcher despite their always-on
// native guard, because this covers the other tooltip kind.
//
// Stealth-safe default: the attribute starts `off` the moment the API is
// known to exist and is only lifted once normal mode is CONFIRMED (event or
// read). A normal-mode launch shows tooltips ~an IPC round-trip later —
// imperceptible, since tooltips need a hover plus delay anyway — while a
// persisted-stealth launch never flashes them.

const ATTR = 'tooltips';
const OFF = 'off';

function setTooltips(root, on) {
  try {
    if (on) delete root.dataset[ATTR];
    else root.dataset[ATTR] = OFF;
  } catch {
    // A hostile/frozen DOM must never break boot.
  }
}

/**
 * Wire custom-tooltip suppression to the undetectable lifecycle.
 * `api` is window.electronAPI-shaped; either accessor may be absent (older
 * preload, non-Electron context) — with neither, this is a no-op returning
 * a null disposer and tooltips behave exactly as before.
 */
export function wireStealthTooltips(root, api) {
  const noop = () => {};
  if (!root || !api) return noop;
  const canRead = typeof api.getUndetectable === 'function';
  const canListen = typeof api.onUndetectableChanged === 'function';
  if (!canRead && !canListen) return noop;

  // Stealth-safe default (see header): off until normal mode is confirmed.
  setTooltips(root, false);

  // A change event is newer than the initial read, so a late read loses.
  let eventSeen = false;
  let disposeListener = null;
  if (canListen) {
    try {
      disposeListener =
        api.onUndetectableChanged((undetectable) => {
          eventSeen = true;
          setTooltips(root, !undetectable);
        }) || null;
    } catch {
      // Listener registration must never break boot.
    }
  }
  if (canRead) {
    try {
      api
        .getUndetectable()
        .then((undetectable) => {
          if (!eventSeen) setTooltips(root, !undetectable);
        })
        .catch(() => {});
    } catch {
      // Read failure leaves the stealth-safe default in place.
    }
  }
  return () => {
    try {
      if (typeof disposeListener === 'function') disposeListener();
    } catch {
      // Best effort.
    }
  };
}
