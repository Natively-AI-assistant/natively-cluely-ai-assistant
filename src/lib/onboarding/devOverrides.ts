// src/lib/onboarding/devOverrides.ts
//
// DEV-build card overrides (toaster policy spec §10). Callers read this only
// when import.meta.env.DEV; a packaged renderer never forces a card. A forced
// card goes through the orchestrator (forceCard): it takes the one card slot
// like any other card and records no ledger outcome.

import type { ToasterId } from './orchestrator.ts';

/** The older override names, kept for scripts/audit/toaster-preview.mjs and habits. */
const FORCE_AD_ALIASES: Record<string, ToasterId> = {
  natively_api: 'natively_api_existing',
  natively_api_new: 'natively_api_new',
  profile: 'profile_ad',
  jd: 'jd_ad',
  max_ultra_upgrade: 'max_ultra',
};

/**
 * The card a DEV URL asks for: `?forceCard=<stage id>`, or the older
 * `?forceAd=<ad>`, `?review=force` and `?extToaster=force`. Null for none.
 */
export function forcedCardFromQuery(search: string): ToasterId | null {
  const params = new URLSearchParams(search);
  const card = params.get('forceCard');
  if (card) return card as ToasterId;
  const ad = params.get('forceAd');
  if (ad) return FORCE_AD_ALIASES[ad] ?? (ad as ToasterId);
  if (params.get('review') === 'force') return 'review_prompt';
  if (params.get('extToaster') === 'force') return 'browser_extension';
  return null;
}
