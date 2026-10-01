export const TRIAL_CAMPAIGN: string;
export const TRIAL_CAMPAIGN_SERVER_RESET_AT: number;
export const TRIAL_PROMO_ID: 'trial_promo';
export const RENDERER_TRIAL_KEYS: Readonly<{
  marker: string;
  claimed: string;
  legacyPromoTs: string;
  onboardingState: string;
}>;

export interface TrialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function resetRendererTrialClaim(storage: TrialStorage, campaign?: string): boolean;
export function isTrialClaimedLocally(storage: TrialStorage): boolean;
export function markTrialClaimedLocally(storage: TrialStorage): void;

export interface MainResetDeps {
  campaign?: string;
  cutoffMs?: number;
  now: number;
  getMarker: () => string | undefined;
  setMarker: (v: string) => void;
  trial: { hasToken: boolean; expiresAtMs: number; startedAtMs: number };
  eligible: boolean;
  sentinelActive: boolean;
  endExpiredRuntime: () => Promise<unknown>;
  resetClaim: () => { persisted: boolean };
  reopenPromo: () => boolean;
}

export type MainResetStatus = 'already' | 'ineligible' | 'live' | 'newer-trial' | 'degraded' | 'ledger-unreadable' | 'reset';

export function runTrialCampaignReset(d: MainResetDeps): Promise<{ status: MainResetStatus }>;
