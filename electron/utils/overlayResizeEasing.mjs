// Shared width-resize easing for the overlay shell.
//
// HISTORICAL "SYNC CONTRACT" (now superseded — kept for context):
// There USED to be a hard contract that the renderer (CSS width on the React
// shell) and the main process (native window width setBounds) trace the SAME
// width over the SAME wall-clock duration, each running its own clock and
// computing width(t) from THIS module, so the CSS layer and the OS window
// landed on every keyframe together. That mattered when the OS window itself
// width-resized in lockstep with the shell.
//
// THAT IS NO LONGER TRUE. The OS overlay window is now a FIXED WIDTH (780) for
// its entire visible lifetime; only the panel animates 600↔780 centered inside
// it (see WindowHelper.setOverlayDimensionsCentered + the startTransition in
// NativelyInterface). The main process never animates width and never imports
// this module's width sampler — grep WindowHelper.ts: no widthAt /
// easeOverlayResize / resize loop. So the width channel is now PURELY
// renderer-side, and nothing downstream consumes an in-between width. That
// freedom is why the renderer can use a velocity-continuous SPRING for the
// width motion value (see OVERLAY_RESIZE_SPRING): an interrupted/retargeted
// scroll-driven transition no longer restarts a bezier from zero velocity (the
// old hitch), and any spring micro-overshoot stays entirely renderer-side — it
// can NOT reach a native width setBounds, because there is no native one.
//
// HOW THE RENDERER ANIMATES IT: the OVERLAY_RESIZE_SPRING drives a `shellWidth`
// MOTION VALUE that is bound directly to the panel's CSS `width`. The content
// reflows (text re-wrap + code re-layout) to the real panel width on every
// frame, so the layout is correct at every in-between width — there is NO
// clipping, scaleX, or transform that would distort the content. The per-frame
// reflow cost is held down on the renderer side (`contain: layout style` scopes
// it to the shell subtree; syntax highlighting is memoized on code string +
// language so a width change re-wraps without re-tokenizing), NOT by faking the
// width. `shellWidth` is consumed by the CSS width, the resize-button anchor,
// the width-derived scroll-max, and the rate-limited height channel.
//
// The bezier (OVERLAY_RESIZE_EASE / easeOverlayResize / widthAt) is RETAINED:
//   • it documents the original curve intent,
//   • the pure samplers remain unit-tested,
//   • a future consumer that needs a deterministic non-spring width(t) (e.g. a
//     reduced-motion fallback, or a re-introduced native width loop) can use it.
//
// Pure, dependency-free, importable from:
//   • renderer  (src/components/NativelyInterface.tsx)
//   • node test (electron/utils/__tests__/overlayResizeEasing.test.mjs)
//
// MONOTONIC BY CONSTRUCTION: easeOverlayResize / easeOutQuint are strictly
// non-overshooting — relevant for any pure deterministic consumer. The live
// width spring is allowed a tiny overshoot precisely because it is renderer-
// only (CSS width) and never pushed to a native setBounds.

/** Total resize duration in milliseconds. 420ms for ~180px of glass travel:
 *  long enough to read as a weighted physical object settling (280ms felt
 *  thin/teleporty), short enough that frequent coding-expansion isn't sluggish. */
export const OVERLAY_RESIZE_DURATION_MS = 420;

/**
 * The iOS drawer / sheet curve (Ionic/Vaul `cubic-bezier(0.32, 0.72, 0, 1)`).
 * Heavy front-loaded ease-out that decelerates into a dead stop with ZERO
 * overshoot — reads as a weighted pane settling, not a spring bounce. Exposed
 * as a 4-tuple so framer-motion can consume it directly as `ease`.
 * @type {[number, number, number, number]}
 */
export const OVERLAY_RESIZE_EASE = [0.32, 0.72, 0, 1];

/**
 * Velocity-continuous spring for the LIVE renderer width channel (600↔780 CSS
 * panel inside the fixed-width window). framer-motion consumes this object as
 * the `animate(shellWidth, target, { ...OVERLAY_RESIZE_SPRING })` options.
 *
 * WHY A SPRING (not the bezier tween it replaces for the live channel):
 * the scroll scanner re-triggers a transition whenever a code block crosses the
 * viewport edge. A duration+bezier RESTARTS from progress 0 at the current
 * width on every re-trigger, so a fast scroll through mixed code/text produced a
 * velocity discontinuity each time (decelerating tail → abrupt fast restart) —
 * the "stutter". framer retargets a spring IN-FLIGHT, carrying the current
 * velocity into the new target, so consecutive expand/contract scans blend into
 * one continuous motion instead of a stack of restarts.
 *
 * Tuning: visualDuration ≈ the old 420ms perceived settle so the feel matches
 * the established drawer timing; bounce 0 = critically-damped, NO overshoot at
 * the resting target for an uninterrupted run (reads as a weighted pane settling
 * exactly like the bezier did). The only time the spring can momentarily pass
 * the target is during an interruption, and that excursion is renderer-only
 * (fixed-width window → never reaches a native width setBounds), so it is safe.
 *
 * NOTE: the renderer (TS) consumes this via the hand-maintained sibling
 * overlayResizeEasing.d.mts, which types `type` as the literal "spring" so it
 * matches framer-motion's discriminated transition-options union. Keep that
 * declaration in sync if this shape changes.
 */
export const OVERLAY_RESIZE_SPRING = {
  type: 'spring',
  visualDuration: OVERLAY_RESIZE_DURATION_MS / 1000,
  bounce: 0,
};

/**
 * Cubic-bezier evaluator for the drawer curve above. framer-motion handles the
 * tween itself from OVERLAY_RESIZE_EASE; this is here so any pure consumer
 * (tests, a main-process sampler) can compute eased progress identically.
 * Solves the bezier for x(t)=progress via Newton/​bisection. f(0)=0, f(1)=1,
 * monotonic, no overshoot.
 * @param {number} t normalized time in [0,1]
 * @returns {number} eased progress in [0,1]
 */
export function easeOverlayResize(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const [x1, y1, x2, y2] = OVERLAY_RESIZE_EASE;
  // Cubic bezier with P0=(0,0), P3=(1,1). Find the parameter u where x(u)=t,
  // then return y(u). x(u) is monotonic for these control points, so bisection
  // converges cleanly without derivatives.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u) => ((ay * u + by) * u + cy) * u;
  let lo = 0;
  let hi = 1;
  let u = t;
  for (let i = 0; i < 24; i++) {
    const x = sampleX(u) - t;
    if (Math.abs(x) < 1e-5) break;
    if (x > 0) hi = u;
    else lo = u;
    u = (lo + hi) / 2;
  }
  return sampleY(u);
}

/**
 * easeOutQuint — retained for any legacy caller. Prefer easeOverlayResize.
 * @param {number} t normalized time in [0,1]
 * @returns {number} eased progress in [0,1]
 */
export function easeOutQuint(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const inv = 1 - t;
  return 1 - inv * inv * inv * inv * inv;
}

/**
 * Interpolated width at a given elapsed time. Both the renderer tween and the
 * main-process timer loop call this with their own `elapsedMs` so they agree
 * on the width at any instant without exchanging per-frame messages.
 *
 * @param {number} fromWidth  width at animation start (px)
 * @param {number} toWidth    target width (px)
 * @param {number} elapsedMs  ms since the shared start instant
 * @param {number} [durationMs=OVERLAY_RESIZE_DURATION_MS]
 * @returns {number} current width (px), clamped to the [from,to] envelope
 */
export function widthAt(fromWidth, toWidth, elapsedMs, durationMs = OVERLAY_RESIZE_DURATION_MS) {
  if (durationMs <= 0) return toWidth;
  const t = elapsedMs <= 0 ? 0 : elapsedMs >= durationMs ? 1 : elapsedMs / durationMs;
  return fromWidth + (toWidth - fromWidth) * easeOverlayResize(t);
}

/**
 * True once the animation has reached or passed its end instant.
 * @param {number} elapsedMs
 * @param {number} [durationMs=OVERLAY_RESIZE_DURATION_MS]
 */
export function isResizeComplete(elapsedMs, durationMs = OVERLAY_RESIZE_DURATION_MS) {
  return elapsedMs >= durationMs;
}
