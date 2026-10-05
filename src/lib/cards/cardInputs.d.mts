export function quotaPercent(usage: unknown): number;
export function quotaCycleEnd(usage: unknown): number | undefined;
export function cardInputsFromSources(sources?: {
  creds?: Record<string, unknown> | null;
  licence?: { isPremium?: boolean; plan?: string } | null;
  profile?: Record<string, unknown> | null;
  trialLocal?: { hasToken?: boolean; expired?: boolean; trialClaimed?: boolean } | null;
  extension?: { extensionConnected?: boolean } | null;
  usage?: unknown;
}): Partial<import('../onboarding/orchestrator').UserState>;
