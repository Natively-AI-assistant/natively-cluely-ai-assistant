export const SNAP_TO_AUTO_TOLERANCE: number;
export function isAimedAtAuto(dragged: number, auto: number, tolerance?: number): boolean;

export type ReleaseAction = 'pin' | 'auto' | 'skip';

export function planResizeRelease(input: {
  widthDriven: boolean;
  pinsHeight: boolean;
  settledWidth: number;
  settledHeight: number;
  autoWidth: number;
  autoHeight: number;
  tolerance?: number;
}): { width: ReleaseAction; height: ReleaseAction };
