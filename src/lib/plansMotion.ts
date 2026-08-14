// Shared motion vocabulary for the Plans & Billing tab.
//
// ── WHY THIS IS FLIP AND NOT RESIZING ───────────────────────────────────────
// The first version of this animated `height` and `marginTop` between 0 and
// auto on every region that appeared or disappeared — eighteen of them. Both
// are LAYOUT properties: each frame ran layout and then paint for the animating
// element and everything below it in the flow. In this tab that repainted
// subtree carries stacked radial-gradient tier fills, 12-32px blur shadows, and
// two pseudo-element layers, and each animating wrapper had `overflow: hidden`
// with changing bounds — which defeats layer caching by definition, since a
// layer whose size changes must be re-rasterised rather than re-composited. It
// was choppy, and it was choppy for a structural reason rather than a tuning
// one.
//
// The fix is not to animate the size more smoothly. It is to compute the final
// layout ONCE and animate transforms between the old and new positions:
//
//   * the LEAVING region is popped to `position: absolute` at its measured box
//     (AnimatePresence mode="popLayout"), so it exits the flow in a single
//     commit and merely fades where it used to be;
//   * the ENTERING region takes its full space immediately at opacity 0;
//   * everything that merely SHIFTS carries `layout="position"`, which FLIPs
//     with `transform: translate()` only — never `scale`, so borders, radii and
//     specular hairlines are not distorted.
//
// Layout therefore runs twice — at commit and at settle — instead of every
// frame, and the per-frame cost collapses to recomputing a matrix.
//
// ── WHAT THIS DELETED, AND WHY IT IS NOT A LOSS ─────────────────────────────
// The previous version had a per-region schedule (AT), a separate activation
// schedule whose curves deliberately CROSSED (ACTIVATE), and a marginTop
// animation paired with every height. All of it existed to paper over one
// artifact: two boxes independently resizing meant everything below them got
// pushed twice, so the page pumped. Under FLIP the leaver exits the flow and
// the enterer claims its space in the SAME commit, so every displaced element
// has exactly one net delta, animated once. The pump is not compensated for —
// it is structurally impossible. The compensation goes; the intent stays.

/**
 * Arrivals. Moves immediately but spreads its travel across the middle. The
 * house `EASE_OUT` ([0.23, 1, 0.32, 1]) front-loads ~83% of its travel into the
 * first 30% of the duration, which is right for a control that must feel like
 * it snapped under a finger and reads as a cut for anything larger.
 */
export const EASE_ENTER: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** Departures. easeOutCubic — gentle, long tail, right for something receding. */
export const EASE_LEAVE: [number, number, number, number] = [0.33, 1, 0.68, 1];

/**
 * The layout settle: one FLIP transform per displaced region.
 *
 * There is no per-region schedule any more because there is no per-region
 * layout animation left to schedule. Removal is the longer of the two because
 * its displacements are larger and because it has more to say — the user is not
 * waiting on it, whereas activation follows a Save they already sat through.
 */
export const SETTLE = { activate: 0.32, remove: 0.38 };

/**
 * Ink. Departing content fades over its own (now out-of-flow) box; arriving
 * content follows one BEAT later so it lands as the layout finishes settling.
 */
export const INK = { out: 0.16, in: 0.24 };

/** The pause between what left and what arrives. */
export const BEAT = 0.08;
