export const IDLE_SUPPRESSION: string;
export function suppressionKeyForArm(streamingId: string | null): string;
export function isAutoScrollSuppressed(suppressedId: string | null, streamingId: string | null): boolean;
export function detectExternalUpwardScroll(input: {
  scrollTop: number;
  lastScrollTop: number;
  maxScroll: number;
  tolerancePx?: number;
  viewportResized?: boolean;
}): boolean;
export function shouldArmFromWheel(input: {
  deltaX: number;
  deltaY: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean;
export function canScrollUp(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean;
