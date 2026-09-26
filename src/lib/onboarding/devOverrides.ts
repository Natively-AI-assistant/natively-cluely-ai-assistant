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

/** Cards drawn by the premium submodule; without it they render nothing. */
const PREMIUM_CARDS = new Set<string>(['natively_api_new', 'natively_api_existing', 'profile_ad', 'jd_ad', 'max_ultra']);

function requested(params: URLSearchParams): ToasterId | null {
  const card = params.get('forceCard');
  if (card) return card as ToasterId;
  const ad = params.get('forceAd');
  if (ad) return FORCE_AD_ALIASES[ad] ?? (ad as ToasterId);
  if (params.get('review') === 'force') return 'review_prompt';
  if (params.get('extToaster') === 'force') return 'browser_extension';
  return null;
}

/**
 * The card a DEV URL asks for: `?forceCard=<stage id>`, or the older
 * `?forceAd=<ad>`, `?review=force` and `?extToaster=force`. Null for none, and
 * null for an ad when the premium module is absent: it would render nothing
 * that could ever close, and hold the one card slot for the whole session.
 */
export function forcedCardFromQuery(search: string, opts: { adsAvailable?: boolean } = {}): ToasterId | null {
  const id = requested(new URLSearchParams(search));
  if (id && PREMIUM_CARDS.has(id) && opts.adsAvailable === false) {
    console.warn(`[DEV] card override ${id} skipped: the ads need the premium module`);
    return null;
  }
  return id;
}
