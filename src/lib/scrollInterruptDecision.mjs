/**
 * Pure decision logic for the chat auto-scroll interrupt state machine
 * (unit-tested). Extracted from NativelyInterface.tsx's handleScrollInterrupt
 * after this exact branching was wrong three separate times across three
 * separate commits (dead-zone ordering, then a wheel-nudge self-disarm) and
 * each regression was only caught by live manual repro — this table-tested
 * predicate is the regression guard for the next time this code moves.
 */

/**
 * @param {{
 *   delta: number,
 *   distanceFromBottom: number,
 *   alreadySuppressed: boolean,
 *   transitionInFlight: boolean,
 *   rearmDistanceThresholdPx?: number,
 * }} input
 * @returns {'arm' | 're-arm' | 'none'}
 */
export function decideScrollInterrupt({
  delta,
  distanceFromBottom,
  alreadySuppressed,
  transitionInFlight,
  rearmDistanceThresholdPx = 28,
}) {
  // Fresh upward scroll: arm suppression. Gated on !alreadySuppressed so a
  // self-inflicted native scrollTop clamp (browser correcting for a growing
  // clientHeight mid-transition) can't re-snapshot the headroom baseline on
  // every frame — see the caller's comment for the full mechanism.
  if (delta < 0 && !alreadySuppressed) return 'arm';

  // Re-arm requires BOTH net downward motion (delta > 0) and proximity to
  // bottom. Distance alone isn't enough: a tiny upward nudge still leaves
  // distanceFromBottom under the threshold, and without the direction check
  // that same nudge's own resulting scroll event would immediately clear the
  // suppression it just armed. Also gated off while a width/height
  // transition is in flight, since the browser's own scrollTop clamp during
  // a growing clientHeight is indistinguishable from a real user re-arm by
  // geometry alone.
  if (delta > 0 && distanceFromBottom <= rearmDistanceThresholdPx && !transitionInFlight) {
    return 're-arm';
  }

  return 'none';
}
