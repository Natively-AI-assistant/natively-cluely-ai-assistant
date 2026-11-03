import type { TrialUsage } from '../../types/nativelyUsage';
export function usageForEndedCard(
  seen: { usage?: TrialUsage | null; limits?: { ai_tokens?: number } | null } | null | undefined,
  reason: 'clock' | 'allowance' | string,
): TrialUsage | null;
