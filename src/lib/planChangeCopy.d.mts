export interface UpgradeLinkAnswer { ok: boolean; token?: string | null; email?: string | null; error?: string }
export interface CarryBlock {
  ai_tokens: number; transcription_minutes: number; embedding_tokens: number; reranker_tokens: number;
  expires_at: string | null; from_plan: string | null;
}
export function isCheckoutUrl(url: string): boolean;
export function withUpgradeLink(url: string, link: UpgradeLinkAnswer | null | undefined): string;
export function planChangeNote(
  key: { plan?: string | null; billing_period?: string | null; yearly_upgrade?: boolean } | null | undefined,
  view: 'plans' | 'packs',
  cycle?: 'monthly' | 'yearly',
): string | null;
export function carryLine(
  carry: CarryBlock | null | undefined,
  opts?: { formatNumber?: (n: number) => string; formatDate?: (iso: string) => string },
): string | null;

export function isYearlyLocked(key: { plan?: string | null; billing_period?: string | null } | null | undefined): boolean;
export function heldPackNote(state: { held?: boolean; inUse?: boolean; until?: string | null } | null | undefined, opts?: { formatDate?: (iso: string) => string }): string | null;
export function canUpgradeYearlyTo(
  key: { plan?: string | null; billing_period?: string | null; yearly_upgrade?: boolean } | null | undefined,
  planId: string,
  cycle: 'monthly' | 'yearly',
): boolean;
export function formatCharge(amount: number, currency: string): string;
