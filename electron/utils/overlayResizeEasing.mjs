// Shared width-resize easing for the overlay shell.
//
// THE SYNC CONTRACT: the renderer (CSS width on the React shell) and the main
// process (native window setBounds) must trace the SAME width over the SAME
// wall-clock duration. They do NOT chase each other over IPC — each side runs
// its own clock and computes width(t) from THIS module. Identical math + a
// shared start signal ⇒ they land on every keyframe together. That is what
// makes the resize look like one object instead of a CSS layer with the OS
// window lagging a frame behind it.
//
// Pure, dependency-free, importable from:
//   • renderer  (src/components/NativelyInterface.tsx)
//   • main      (electron/WindowHelper.ts, via the compiled copy)
//   • node test (src/lib/__tests__/overlayResizeEasing.test.mjs)
//
// MONOTONIC BY CONSTRUCTION: easeOutQuint is strictly non-overshooting, so the
// native window never receives an out-of-range width to snap back from. This
// replaces the old spring (bounce: 0.16), whose overshoot was pushed verbatim
// to setBounds and read as a cheap end-of-animation snap.

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
