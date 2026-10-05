export const WORD_FADE_DURATION_MS: number;
export const MAX_ANIMATED_WORDS: number;
export const WORD_OPACITY_DURATION_MS: number;
export const WORD_FADE_BLUR_PX: number;
export const REDUCED_MOTION_BLOCK_FADE_MS: number;
export const GIST_CHIP_FADE_MS: number;
export const REVEAL_WORD_CLASS: string;

export interface RevealSample {
  ts: number;
  len: number;
}

export interface RevealHistory {
  samples: RevealSample[];
}

export interface WordRun {
  text: string;
  isWord: boolean;
}

export function createRevealHistory(): RevealHistory;

export function resetRevealHistory(history: RevealHistory): void;

export function pushRevealSample(
  history: RevealHistory,
  nowMs: number,
  revealedLen: number,
  durationMs?: number,
): void;

export function revealTimeForIndex(
  history: RevealHistory,
  index: number,
): number | null;

export function animatedTailStart(
  history: RevealHistory,
  nowMs: number,
  revealedLen: number,
  durationMs?: number,
): number;

export function remainingFadeMs(
  history: RevealHistory,
  nowMs: number,
  revealedLen: number,
  durationMs?: number,
): number;

export function splitIntoWordRuns(text: string): WordRun[];
