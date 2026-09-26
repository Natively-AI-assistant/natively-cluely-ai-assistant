export type CardId =
  | 'browser_extension' | 'trial_promo' | 'natively_api_new'
  | 'max_ultra' | 'natively_api_existing' | 'profile_ad' | 'jd_ad' | 'review_prompt' | 'support';
export type CardClass = 'onboarding' | 'promo';
export type Outcome = 'shown' | 'acted' | 'later' | 'never' | 'interrupted';

export interface CardConfig {
  cls: CardClass;
  priority: number | null;
  followUpAfterActedMs?: number;
  actedRetiresUntilCycleEnd?: boolean;
}

export interface Entry {
  shows: number;
  strikes: number;
  nextEligibleAt: number | null;
  retired: boolean;
  retiredReason: 'acted' | 'never' | 'strikes' | 'migrated' | null;
  retiredUntil: number | null;
  lastShownAt: number | null;
  followUpPending: boolean;
}

export interface Ledger {
  version: 1;
  firstLaunchAt: number;
  launchCount: number;
  lastPromoShownAt: number | null;
  imported: Partial<Record<'main' | 'renderer', number>>;
  cards: Partial<Record<CardId, Partial<Entry>>>;
}

export interface LegacyCardHistory {
  firstSeenAt?: number;
  startupCount?: number;
  reviewed?: boolean;
  reviewNever?: boolean;
  donated?: boolean;
  donationShows?: number;
  donationLastShownAt?: number;
  dismissedAds?: string[];
  trialClaimed?: boolean;
  stageShows?: Partial<Record<CardId, { count: number; lastShownAt: number }>>;
}

export const DAY_MS: number;
export const CARDS: Readonly<Record<CardId, CardConfig>>;
export const OUTCOMES: readonly Outcome[];
export const STRIKE_GAPS_MS: readonly number[];
export const MAX_STRIKES: number;
export const PROMO_BUDGET_MS: number;
export const DAY_ONE_MS: number;

export function emptyLedger(now: number): Ledger;
export function entryOf(ledger: Ledger, id: CardId | string): Entry;
export function applyOutcome(ledger: Ledger, id: CardId | string, outcome: Outcome | string, now: number, meta?: { until?: number }): Ledger;
export function isCardAvailable(ledger: Ledger, id: CardId | string, now: number): boolean;
export function promoBudgetOpen(ledger: Ledger, now: number): boolean;
export function dayOneOver(ledger: Ledger, now: number): boolean;
export function pickPromotional(candidateIds: readonly (CardId | string)[], ledger: Ledger, now: number): CardId | null;
export function migrateLegacy(ledger: Ledger, legacy: LegacyCardHistory | null | undefined, now: number): Ledger;
