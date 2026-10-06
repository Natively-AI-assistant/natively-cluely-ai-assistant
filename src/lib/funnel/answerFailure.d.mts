export function looksLikeUserStop(raw: unknown): boolean;
export function answerFailureCause(failure: {
  code?: string; status?: number; waitedMs?: number; partial?: boolean; unreachable?: boolean;
} | null | undefined): string | null;
