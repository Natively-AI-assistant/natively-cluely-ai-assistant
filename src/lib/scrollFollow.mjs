/**
 * Pure pieces of the overlay chat's follow-the-bottom behaviour (unit-tested),
 * shared by every path that scrolls or interrupts the scroll container. The
 * state machine's arm/re-arm decision itself lives in scrollInterruptDecision.mjs.
 */

/**
 * What "auto-scroll is withheld" is keyed to while NOTHING is streaming.
 * Suppression is stored as a message id (or null = not suppressed), and the
 * streaming id is null between answers — arming with it stored null, which
 * reads as "not suppressed", so a scroll-up in a finished chat or during the
 * pre-token "Thinking…" phase armed nothing. Any real stream id differs from
 * this sentinel, so the next stream still lifts it (see isAutoScrollSuppressed).
 */
export const IDLE_SUPPRESSION = '__idle__';

/** @param {string | null} streamingId @returns {string} */
export function suppressionKeyForArm(streamingId) {
  return streamingId ?? IDLE_SUPPRESSION;
}

/**
 * Suppressed for as long as the stream it was armed for is live, and through
 * that stream's finalize (the streaming id goes null for one commit before
 * the last effect run). A different, non-null stream id lifts it.
 * @param {string | null} suppressedId
 * @param {string | null} streamingId
 */
export function isAutoScrollSuppressed(suppressedId, streamingId) {
  return suppressedId !== null && (streamingId === null || streamingId === suppressedId);
}

/**
 * True when scrollTop sits BELOW where our own last write left it. Every
 * programmatic write is followed by a resync of `lastScrollTop`, so anything
 * lower was moved by someone else — a held key, a global-shortcut kick, the
 * edge-strip wheel forward, a scrollbar drag — whether or not that channel
 * announced itself. The comparison is capped at the CURRENT max so the
 * browser's own clamp after the content shrank (scrollTop lowered to fit) is
 * not mistaken for the user.
 *
 * @param {{ scrollTop: number, lastScrollTop: number, maxScroll: number, tolerancePx?: number }} input
 */
export function detectExternalUpwardScroll({ scrollTop, lastScrollTop, maxScroll, tolerancePx = 2 }) {
  return scrollTop < Math.min(lastScrollTop, maxScroll) - tolerancePx;
}

/**
 * Whether a wheel event is a genuine "scroll up to read" gesture on the chat
 * container: upward, mostly vertical, and there is actually somewhere above
 * to go. A horizontal swipe over a code block carries a small negative deltaY
 * that must not detach the chat, and neither should a wheel over a container
 * that has nothing to scroll.
 *
 * @param {{ deltaX: number, deltaY: number, scrollTop: number, scrollHeight: number, clientHeight: number }} input
 */
export function shouldArmFromWheel({ deltaX, deltaY, scrollTop, scrollHeight, clientHeight }) {
  if (!(deltaY < 0)) return false;
  if (Math.abs(deltaX) > Math.abs(deltaY)) return false;
  if (scrollHeight - clientHeight <= 1) return false;
  return scrollTop > 0;
}
