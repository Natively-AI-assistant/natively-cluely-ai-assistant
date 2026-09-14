// "Did the user mean AUTO?" — the tolerance band around auto sizing that a
// manual resize release is judged against.
//
// THE PROBLEM. Auto expand/contract is the primary sizing; a manual drag pins a
// size and suspends it. But a user dragging back toward the size the overlay
// picks for itself cannot land on it exactly — they are eyeballing a window
// edge. Landing three pixels off used to pin a size visually identical to auto
// AND silently switch auto sizing off for the rest of the meeting, which reads
// as "the app stopped resizing itself" with no way to connect that to the drag.
//
// THE RULE. On release, each axis is compared against what auto sizing would
// have chosen. Within the band, the drag is treated as an aim AT auto: that
// axis's pin is not taken (and any existing one is dropped), so auto sizing
// simply continues. Outside it, the drag is deliberate and pins as before.
//
// PER AXIS, not both together: the pins already are. Widening the window while
// letting the height keep sizing itself is a coherent thing to want, and
// requiring both axes to be near auto before honouring either would make the
// height's snap depend on how precisely the user happened to drag the width.
//
// The band is RELATIVE on purpose — a 15px miss is a lot at the 154px empty
// height and nothing at 800px — but that also means it widens as the overlay
// grows. If a deliberate pin near a tall auto height ever gets swallowed, the
// fix is a px ceiling on the band here, not a smaller fraction, which would
// make the empty state unhittable.

/** Fraction of the auto size that still counts as "aiming at auto". */
export const SNAP_TO_AUTO_TOLERANCE = 0.1;

/**
 * @param {number} dragged  the size this axis settled at, px
 * @param {number} auto     the size auto sizing would choose for it, px
 * @param {number} [tolerance=SNAP_TO_AUTO_TOLERANCE]
 * @returns {boolean} true when the pin should be dropped and auto resumed
 */
export function isAimedAtAuto(dragged, auto, tolerance = SNAP_TO_AUTO_TOLERANCE) {
  // A non-positive auto means "not known yet" — never snap on a guess, because
  // the failure mode is discarding a pin the user meant to keep.
  if (!Number.isFinite(auto) || auto <= 0) return false;
  if (!Number.isFinite(dragged) || dragged <= 0) return false;
  if (!Number.isFinite(tolerance) || tolerance < 0) return false;
  // The epsilon keeps the boundary INCLUSIVE as documented. Both operands are
  // px in practice, but `auto * tolerance` is a float (154 * 0.1 is
  // 15.400000000000002), so an exact-boundary comparison can miss by ~1e-14 and
  // silently make the band one pixel narrower than it reads.
  return Math.abs(dragged - auto) <= auto * tolerance + 1e-9;
}

/**
 * @typedef {'pin'|'auto'|'skip'} ReleaseAction
 *   pin  — the drag was deliberate; pin this axis at the settled size
 *   auto — the drag was aimed at auto; drop this axis's pin and resume auto
 *   skip — this drag did not move this axis; leave whatever it had alone
 */

/**
 * What a manual resize release should do to each axis.
 *
 * Extracted from the release handler so the WIRING is testable, not just the
 * tolerance arithmetic. The bug this exists to catch was of exactly that shape:
 * the band computed "aimed at auto" correctly, and the width still stayed where
 * it was dragged because the release path cleared the pin's React state but not
 * the ref the reporter actually reads. A unit test over the arithmetic could
 * never have seen it; a unit test over the plan at least pins which axes are
 * supposed to change hands.
 *
 * @param {Object} input
 * @param {boolean} input.widthDriven  the drag moved the east edge
 * @param {boolean} input.pinsHeight   the drag pins a height (see pinsHeightFor)
 * @param {number} input.settledWidth  window width the drag settled at
 * @param {number} input.settledHeight window height the drag settled at
 * @param {number} input.autoWidth     window width auto sizing would choose
 * @param {number} input.autoHeight    window height auto sizing would choose
 * @param {number} [input.tolerance]
 * @returns {{ width: ReleaseAction, height: ReleaseAction }}
 */
export function planResizeRelease({
  widthDriven,
  pinsHeight,
  settledWidth,
  settledHeight,
  autoWidth,
  autoHeight,
  tolerance = SNAP_TO_AUTO_TOLERANCE,
}) {
  return {
    width: !widthDriven
      ? 'skip'
      : isAimedAtAuto(settledWidth, autoWidth, tolerance)
        ? 'auto'
        : 'pin',
    height: !pinsHeight
      ? 'skip'
      : isAimedAtAuto(settledHeight, autoHeight, tolerance)
        ? 'auto'
        : 'pin',
  };
}
