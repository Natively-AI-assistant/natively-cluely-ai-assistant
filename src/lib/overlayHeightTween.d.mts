export const HEIGHT_TWEEN_EPSILON_PX: number;

export interface HeightCommitInput {
  from: number | null;
  to: number;
  streamingWithText: boolean;
  widthAnimating: boolean;
  resizing: boolean;
  reducedMotion: boolean;
}

export interface HeightCommitDecision {
  action: 'none' | 'snap' | 'tween';
  height: number;
  reason: string;
}

export function decideHeightCommit(input: HeightCommitInput): HeightCommitDecision;

export function shouldReportTweenHeight(input: {
  now: number;
  lastReportAt: number;
  lastReported: number;
  height: number;
  intervalMs?: number;
}): boolean;
