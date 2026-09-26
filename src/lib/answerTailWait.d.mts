export const TAIL_WAIT_MS: number;
export const TAIL_GRACE_MS: number;
export interface TranscriptTailWaiter {
  notifyFinal(): void;
  wait(state: { hasCapturedFinal: boolean; hasPendingInterim: boolean }): Promise<'final' | 'timeout'>;
}
export function createTranscriptTailWaiter(timers?: {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}): TranscriptTailWaiter;
