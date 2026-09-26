export const OVERLAY_RESIZE_DURATION_MS: number;
export const OVERLAY_RESIZE_EASE: [number, number, number, number];
// Velocity-continuous spring options for the live renderer width channel,
// spread into framer-motion's animate(value, target, { ... }). `type` is the
// literal "spring" so it matches the discriminated transition-options union.
export const OVERLAY_RESIZE_SPRING: {
  type: 'spring';
  visualDuration: number;
  bounce: number;
};
export function easeOverlayResize(t: number): number;
export function easeOutQuint(t: number): number;
export function widthAt(
  fromWidth: number,
  toWidth: number,
  elapsedMs: number,
  durationMs?: number,
): number;
export function isResizeComplete(elapsedMs: number, durationMs?: number): boolean;
export const OVERLAY_RESIZE_TWEEN_MS: number;
export const OVERLAY_RESIZE_TWEEN_EASE: [number, number, number, number];
// Card-resize tween options for framer-motion's animate(value, target, {...}).
// A plain duration+ease tween (no `type` discriminant) so it satisfies the
// keyframe-transition arm of framer's transition-options union.
export const OVERLAY_RESIZE_TWEEN: {
  duration: number;
  ease: [number, number, number, number];
};
export function easeCardResize(t: number): number;
