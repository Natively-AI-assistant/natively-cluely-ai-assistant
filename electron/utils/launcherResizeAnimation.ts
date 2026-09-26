// Smooth expand/contract for the launcher's maximize/restore.
//
// WHY THIS EXISTS: Windows' own maximize/restore animation composites badly for
// this window — it is `transparent: true`, i.e. a layered window, which does not
// take DWM's normal fast path, so the OS transition tears and flickers. Driving
// the frame ourselves replaces that transition entirely: a fixed number of
// setBounds steps along an easing curve, at a duration we choose.
//
// TIMING AND CURVE COME FROM THE PLATFORM DESIGN SYSTEMS, not from taste:
//
//   • Curve — Material 3 "emphasized", cubic-bezier(0.2, 0, 0, 1)
//     (md.sys.motion.easing.emphasized). This is the documented curve for a
//     surface that TRANSFORMS while staying on screen, which is exactly a
//     window growing to fill the display. Both ends are eased, so it leaves
//     cleanly and settles instead of arriving at speed. Accelerate curves are
//     specified for elements LEAVING the screen — the launcher never does.
//
//   • Durations — Fluent 2 tokens (fluentui/packages/tokens durations.ts):
//     durationSlow (300ms) to expand, durationGentle (250ms) to contract.
//     Fluent's rule is "give larger elements more time"; a window crossing most
//     of the screen is the largest thing this app moves, so it sits at the slow
//     end of the scale rather than the 150-200ms used for controls. The
//     asymmetry is also standard — in both Fluent and Material, the reverse
//     direction is quicker than the forward one, because a user contracting a
//     window has already seen it and is waiting to get on with something else.
//
// Material would put a full-screen expand at 500ms (long2), but that token is
// calibrated for phone-sized travel and touch; on desktop it reads as sluggish
// next to the OS's own ~250ms window animations. Fluent is the closer standard
// for this app's primary platform.
//
// Pure math, no electron import — testable on either platform.

/** Fluent 2 durationSlow — growing to fill the work area. */
export const LAUNCHER_EXPAND_DURATION_MS = 300;

/** Fluent 2 durationGentle — the reverse direction, deliberately quicker. */
export const LAUNCHER_CONTRACT_DURATION_MS = 250;

/** cubic-bezier(0.2, 0, 0, 1) — Material 3 `emphasized`. */
export const LAUNCHER_RESIZE_EASE: [number, number, number, number] = [0.2, 0, 0, 1];

export interface AnimatedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Cubic-bezier solver for a curve with fixed endpoints (0,0)→(1,1). Newton's
// method on x(t)=progress, then evaluate y. Ten iterations is far more than
// needed for sub-pixel accuracy at these sizes.
function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const ax = 3 * p1x - 3 * p2x + 1;
  const bx = -6 * p1x + 3 * p2x;
  const cx = 3 * p1x;
  const ay = 3 * p1y - 3 * p2y + 1;
  const by = -6 * p1y + 3 * p2y;
  const cy = 3 * p1y;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleDerivX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  let t = x;
  for (let i = 0; i < 10; i++) {
    const dx = sampleX(t) - x;
    if (Math.abs(dx) < 1e-6) break;
    const d = sampleDerivX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= dx / d;
  }
  t = Math.min(1, Math.max(0, t));

  return ((ay * t + by) * t + cy) * t;
}

/** Eased progress 0→1 for a linear time fraction. */
export function easeLauncherResize(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const [p1x, p1y, p2x, p2y] = LAUNCHER_RESIZE_EASE;
  return cubicBezier(p1x, p1y, p2x, p2y, clamped);
}

/**
 * Bounds at eased progress `p` (0 = from, 1 = to). Rounded to whole pixels —
 * setBounds takes integers, and rounding per-frame keeps the motion even
 * instead of letting truncation bias every step toward the origin.
 */
export function interpolateBounds(
  from: AnimatedRect,
  to: AnimatedRect,
  p: number,
): AnimatedRect {
  const clamped = Math.min(1, Math.max(0, p));
  if (clamped >= 1) return { ...to };
  const at = (a: number, b: number) => Math.round(a + (b - a) * clamped);
  return {
    x: at(from.x, to.x),
    y: at(from.y, to.y),
    width: at(from.width, to.width),
    height: at(from.height, to.height),
  };
}

/** True once the animation has run its course. */
export function isLauncherResizeComplete(
  elapsedMs: number,
  durationMs: number = LAUNCHER_EXPAND_DURATION_MS,
): boolean {
  return elapsedMs >= durationMs;
}
