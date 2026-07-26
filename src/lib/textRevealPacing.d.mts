export const MAX_REVEAL_CHARACTERS_PER_SECOND: number;
export const INITIAL_BUFFER_MS: number;
export const INITIAL_BUFFER_CHAR_THRESHOLD: number;
export const USE_ANIMATION_FRAME: boolean;
export const FLUSH_IMMEDIATELY_ON_COMPLETE: boolean;
export const SENTENCE_END_PAUSE_MS: number;
export const CLAUSE_PAUSE_MS: number;
export const MAX_REVEAL_CHARS_PER_MS: number;

export interface StreamRenderConfig {
  maxCharactersPerSecond: number;
  initialBufferMs: number;
  initialBufferCharacterThreshold: number;
  useAnimationFrame: boolean;
  flushImmediatelyOnComplete: boolean;
}

export const STREAM_RENDER_CONFIG: StreamRenderConfig;

export interface PacerState {
  revealedLen: number;
  charBudget: number;
  bufferStartMs: number | null;
  buffering: boolean;
  pauseUntilMs: number;
}

export function snapRevealBoundary(
  text: string,
  candidateLen: number,
  minLen: number,
): number;

export function createPacerState(): PacerState;

export function tickPacer(
  state: PacerState,
  fullText: string,
  nowMs: number,
  deltaMs: number,
  opts?: { reducedMotion?: boolean },
): PacerState;

export function estimateRevealDurationMs(charCount: number): number;
