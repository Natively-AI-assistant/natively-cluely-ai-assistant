export function hasOwnAiKey(creds: Record<string, unknown> | null | undefined, routes?: { codexReady?: boolean }): boolean;

export function resolveExpiredTrial(
  s: {
    hasToken: boolean;
    expired: boolean;
    licensed: boolean;
    hasRealNativelyKey: boolean;
    hasOwnAiKey: boolean;
    wipedForThisTrial: boolean;
  } | null | undefined,
): { showEndedCard: boolean; wipe: boolean; clearToken: boolean };
