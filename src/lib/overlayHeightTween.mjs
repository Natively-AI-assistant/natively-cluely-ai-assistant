// Auto expand / contract — the HEIGHT half of the overlay's card-resize motion.
//
// WHAT ANIMATES, AND WHY IT IS THE VIEWPORT AND NOT THE CARD
// ---------------------------------------------------------
// The shell card is `overflow-hidden` with a fixed chrome stack — status pills
// on top, quick actions / input / footer at the bottom — and the chat scroll
// viewport in between. Only the viewport is elastic. Tweening the CARD's height
// would mean the card is briefly shorter than its own flex column, and
// `overflow-hidden` would slice the FOOTER (model selector / settings / send)
// off for the whole 300ms. That is the exact failure the streaming height
// machinery's "commit ahead of need, never chase" rule exists to prevent.
//
// So the animated box is a clipping wrapper around the viewport. The card's
// laid-out height is then always exactly `chrome + wrapperHeight`, at every
// instant of the tween — there is no frame at which the window can be shorter
// than the panel, whatever the tween is doing. The cost is that content below
// the wrapper's current height is hidden mid-tween, which is what a resize
// reveal IS.
//
// WHEN IT MAY NOT TWEEN
// ---------------------
// A tween is by construction BEHIND its target. That is right for a discrete
// jump (a row mounts, the panel clears) and wrong for continuous growth, where
// "behind" just means permanently lagging. The overlay has three channels that
// must therefore SNAP:
//
//   • STREAMING THAT HAS PRODUCED TEXT — `driveStreamingHeight` owns the native
//     height channel there, committing `measured + 96px` of headroom AHEAD of
//     the content so the window is never short. A tween chases; routing that
//     through one reintroduces the +96/-96 bounce fixed in 02848d54.
//
//     "HAS PRODUCED TEXT" IS LOAD-BEARING, not a nicety. A typed question
//     RESERVES its streaming id before the first token, and the wait for that
//     token can be many seconds. Keying the snap on the id alone therefore
//     classified the single most visible moment in the product — send a
//     question, the empty overlay opens to make room for the answer — as
//     "streaming", and it cut instead of gliding. Measured live before the fix:
//     the box went 0 → 145px in ONE frame. The gate here is deliberately the
//     SAME predicate decideStreamingHeightCommit uses for its own headroom
//     (`hasText`), so the two subsystems hand the channel over at one instant
//     rather than at two.
//   • A WIDTH TRANSITION — the panel's width owns the height for its duration.
//     This one is not an optimisation, it is the DEFINITION of the motion. When
//     the panel widens, text re-wraps to fewer lines and the viewport's natural
//     height changes as a CONSEQUENCE, every frame. Before this channel existed
//     the card's height simply WAS the content height, so the two axes moved in
//     perfect lockstep. Give the height its own 300ms curve and it lags the
//     width spring instead, and each frame's fresh measurement retargets that
//     curve from zero velocity — which reads, exactly as reported, as "the width
//     grows, then the height grows". Snapping restores the lockstep: the height
//     becomes a pure function of the current width again.
//   • A USER RESIZE DRAG — the pointer is the clock. Anything else animating
//     the same box fights it frame for frame.
//   • prefers-reduced-motion (WCAG 2.3.3) — snap to the target, no travel.
//
// And the FIRST measurement snaps: the shell has its own entry flourish
// (opacity/scale/y), and a height tween from 0 on top of it reads as a second,
// competing animation on the same moment.
//
// Pure and dependency-free so the branching is table-tested rather than judged
// by eye in a live overlay — see __tests__/overlayHeightTween.test.mjs.

/** Changes at or below this are layout noise (sub-pixel rounding, a 1px
 *  border) — committing them animated would start a 300ms tween that travels
 *  less than it costs to schedule. */
export const HEIGHT_TWEEN_EPSILON_PX = 1;

/**
 * @typedef {Object} HeightCommitInput
 * @property {number|null} from          current animated wrapper height; null = never measured
 * @property {number} to                 freshly measured natural height of the viewport
 * @property {boolean} streamingWithText a stream is live AND has produced text
 * @property {boolean} widthAnimating    a panel width transition is in flight
 * @property {boolean} resizing          the user is dragging a resize handle
 * @property {boolean} reducedMotion     OS "Reduce Motion" is on
 */

/**
 * @typedef {Object} HeightCommitDecision
 * @property {'none'|'snap'|'tween'} action
 * @property {number} height           the height to apply (target for 'tween')
 * @property {string} reason           why this branch — surfaced in the dev trace
 */

/**
 * Decide how the viewport wrapper should move to a newly measured height.
 * @param {HeightCommitInput} input
 * @returns {HeightCommitDecision}
 */
export function decideHeightCommit({
  from,
  to,
  streamingWithText,
  widthAnimating,
  resizing,
  reducedMotion,
}) {
  const target = Math.max(0, Math.round(to));
  if (from === null) return { action: 'snap', height: target, reason: 'first-measure' };
  if (Math.abs(target - from) <= HEIGHT_TWEEN_EPSILON_PX) {
    return { action: 'none', height: from, reason: 'noise' };
  }
  if (resizing) return { action: 'snap', height: target, reason: 'resize-drag' };
  if (widthAnimating) return { action: 'snap', height: target, reason: 'width-transition' };
  if (streamingWithText) return { action: 'snap', height: target, reason: 'streaming' };
  if (reducedMotion) return { action: 'snap', height: target, reason: 'reduced-motion' };
  return { action: 'tween', height: target, reason: 'discrete' };
}

/**
 * The window must follow the ANIMATED panel height, not the target — following
 * the target would leave the window tall under a shrinking panel (a transparent
 * dead strip that still swallows clicks) and short over a growing one.
 * Reporting every frame, though, means a native setBounds per frame, and each
 * one re-rasterizes the transparent backdrop-blur window. This is the same
 * ~30fps + integer-dedupe gate the width transition already uses.
 *
 * @param {Object} input
 * @param {number} input.now              ms clock
 * @param {number} input.lastReportAt     ms clock of the previous report
 * @param {number} input.lastReported     px height of the previous report
 * @param {number} input.height           freshly measured px height
 * @param {number} [input.intervalMs=33]  ~30fps
 * @returns {boolean} whether to push this height to the OS window now
 */
export function shouldReportTweenHeight({
  now,
  lastReportAt,
  lastReported,
  height,
  intervalMs = 33,
}) {
  if (!(height > 0)) return false;
  if (Math.round(height) === lastReported) return false;
  return now - lastReportAt >= intervalMs;
}
