export const OVERLAY_RESIZE_DURATION_MS: number;
export const OVERLAY_RESIZE_EASE: [number, number, number, number];
export function easeOverlayResize(t: number): number;
export function easeOutQuint(t: number): number;
export function widthAt(
  fromWidth: number,
  toWidth: number,
  elapsedMs: number,
  durationMs?: number,
): number;
export function isResizeComplete(elapsedMs: number, durationMs?: number): boolean;
