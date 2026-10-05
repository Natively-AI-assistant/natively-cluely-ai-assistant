// electron/services/cards/mainLegacy.ts
//
// What the main process already knows about cards from before the card ledger
// existed (toaster policy spec §8), gathered once at startup and handed to
// CardLedger.importLegacy('main', …). Each source is read on its own: one that
// fails (a missing module, an unreadable store) must not lose the others.

import type { LegacyCardHistory } from '../../../src/lib/cards/cardPolicy.mjs';
import type { CardLedger } from './CardLedger';

export function gatherMainLegacy(): LegacyCardHistory {
  const legacy: LegacyCardHistory = {};

  // Review ledger: a submitted review or "Never ask" retires the prompt.
  try {
    const { ReviewService } = require('../ReviewService');
    const state = ReviewService.getInstance().getLocalState();
    if (state?.has_reviewed === true) legacy.reviewed = true;
    if (state?.dont_show_again === true) legacy.reviewNever = true;
  } catch (e: any) {
    console.warn('[CardLedger] Review history not imported:', e?.message);
  }

  // Donation ledger: a (presumed) donation retires the support card; past
  // showings become strikes.
  try {
    const { DonationManager } = require('../../DonationManager');
    const d = DonationManager.getInstance().getDonationState();
    if (d?.hasDonated === true) legacy.donated = true;
    if (typeof d?.lifetimeShows === 'number') legacy.donationShows = d.lifetimeShows;
    if (typeof d?.lastShownAt === 'number') legacy.donationLastShownAt = d.lastShownAt;
  } catch (e: any) {
    console.warn('[CardLedger] Donation history not imported:', e?.message);
  }

  // One free trial per device: once claimed, the trial promo never returns.
  try {
    const { CredentialsManager } = require('../CredentialsManager');
    if (CredentialsManager.getInstance().getTrialClaimed() === true) legacy.trialClaimed = true;
  } catch (e: any) {
    console.warn('[CardLedger] Trial claim not imported:', e?.message);
  }

  return legacy;
}

/** The review card's outcome implied by the review ledger, if any. */
export function reviewCardOutcome(
  state: { has_reviewed?: boolean; dont_show_again?: boolean } | null | undefined,
): 'acted' | 'never' | null {
  if (state?.has_reviewed === true) return 'acted';
  if (state?.dont_show_again === true) return 'never';
  return null;
}

/**
 * Retire the review card when the review ledger says so. A review or "Never
 * ask" from another install arrives only through ReviewService's backend sync,
 * which lands after the one-time import above, so this runs again then.
 * Returns the new ledger, or null when there was nothing to do.
 */
export function settleReviewCard(
  cardLedger: CardLedger,
  state: { has_reviewed?: boolean; dont_show_again?: boolean } | null | undefined,
): ReturnType<CardLedger['get']> | null {
  const outcome = reviewCardOutcome(state);
  if (!outcome || !cardLedger.isReadable()) return null;
  if (cardLedger.get().cards?.review_prompt?.retired) return null;
  return cardLedger.record('review_prompt', outcome);
}
