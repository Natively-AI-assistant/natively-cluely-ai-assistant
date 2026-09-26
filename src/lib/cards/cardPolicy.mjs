// src/lib/cards/cardPolicy.mjs
//
// Every rule for when an onboarding or promotional card may show, as pure
// functions over a plain ledger object (toaster policy,
// docs/superpowers/specs/2026-09-26-toaster-policy-design.md §2–§4, §8).
//
// The ledger lives in the main process (electron/services/cards/CardLedger.ts)
// and the launcher's scheduler reads it; both apply these functions, so the
// rules cannot drift between them. No platform branches, no I/O.

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Onboarding cards may show from day 1 and do not spend the promo budget.
 * Promotional cards share the budget; lower priority numbers win.
 */
export const CARDS = Object.freeze({
  browser_extension: Object.freeze({ cls: 'onboarding', priority: null, followUpAfterActedMs: 7 * DAY_MS }),
  trial_promo: Object.freeze({ cls: 'onboarding', priority: null }),
  natively_api_new: Object.freeze({ cls: 'onboarding', priority: null }),
  max_ultra: Object.freeze({ cls: 'promo', priority: 1, actedRetiresUntilCycleEnd: true }),
  natively_api_existing: Object.freeze({ cls: 'promo', priority: 2 }),
  profile_ad: Object.freeze({ cls: 'promo', priority: 3 }),
  jd_ad: Object.freeze({ cls: 'promo', priority: 4 }),
  review_prompt: Object.freeze({ cls: 'promo', priority: 5 }),
  support: Object.freeze({ cls: 'promo', priority: 6 }),
});

export const OUTCOMES = Object.freeze(['shown', 'acted', 'later', 'never', 'interrupted']);

/**
 * Wait after the 1st and 2nd "not now". A card shows at most three times, so
 * the 3rd "not now" retires it (the user's chosen rule: "each promo shows at
 * most 3 times ever").
 */
export const STRIKE_GAPS_MS = Object.freeze([7 * DAY_MS, 21 * DAY_MS]);
export const MAX_STRIKES = 3;

/** At most one promotional card per rolling 72 hours. */
export const PROMO_BUDGET_MS = 3 * DAY_MS;

/** No promotional card in the first 24 hours after the first launch. */
export const DAY_ONE_MS = DAY_MS;

const DEFAULT_ENTRY = Object.freeze({
  shows: 0,
  strikes: 0,
  nextEligibleAt: null,
  retired: false,
  retiredReason: null,
  retiredUntil: null,
  lastShownAt: null,
  followUpPending: false,
});

/** @returns {import('./cardPolicy.d.mts').Ledger} */
export function emptyLedger(now) {
  return { version: 1, firstLaunchAt: now, launchCount: 0, lastPromoShownAt: null, imported: {}, cards: {} };
}

/** A card's record, with defaults for a card never seen. */
export function entryOf(ledger, id) {
  return { ...DEFAULT_ENTRY, ...(ledger?.cards?.[id] ?? {}) };
}

function assertCard(id) {
  if (!Object.prototype.hasOwnProperty.call(CARDS, id)) throw new Error(`unknown card: ${id}`);
}

function withEntry(ledger, id, entry) {
  return { ...ledger, cards: { ...ledger.cards, [id]: entry } };
}

/**
 * Apply what happened to a card. Returns a NEW ledger; the input is untouched.
 *
 * - shown: counts the showing; a promotional card also spends the budget.
 * - acted: retires the card, except the browser extension (one follow-up
 *   after 7 days) and Max/Ultra (retired until `meta.until`, the cycle end).
 * - later: a strike; wait 7 days, then 21; the 3rd strike retires. A "later"
 *   on the extension's follow-up retires it.
 * - never: retires at once.
 * - interrupted (app quit or crashed while open): nothing changes.
 */
export function applyOutcome(ledger, id, outcome, now, meta = {}) {
  assertCard(id);
  if (!OUTCOMES.includes(outcome)) throw new Error(`unknown outcome: ${outcome}`);
  const card = CARDS[id];
  const e = entryOf(ledger, id);

  switch (outcome) {
    case 'interrupted':
      return ledger;

    case 'shown': {
      const next = withEntry(ledger, id, { ...e, shows: e.shows + 1, lastShownAt: now });
      return card.cls === 'promo' ? { ...next, lastPromoShownAt: now } : next;
    }

    case 'never':
      return withEntry(ledger, id, { ...e, retired: true, retiredReason: 'never' });

    case 'acted': {
      if (card.followUpAfterActedMs && !e.followUpPending) {
        return withEntry(ledger, id, { ...e, followUpPending: true, nextEligibleAt: now + card.followUpAfterActedMs });
      }
      if (card.actedRetiresUntilCycleEnd && typeof meta.until === 'number') {
        return withEntry(ledger, id, { ...e, retiredUntil: meta.until });
      }
      return withEntry(ledger, id, { ...e, retired: true, retiredReason: 'acted', followUpPending: false });
    }

    case 'later': {
      if (e.followUpPending) {
        return withEntry(ledger, id, { ...e, retired: true, retiredReason: 'acted', followUpPending: false });
      }
      const strikes = e.strikes + 1;
      if (strikes >= MAX_STRIKES) {
        return withEntry(ledger, id, { ...e, strikes, retired: true, retiredReason: 'strikes' });
      }
      return withEntry(ledger, id, { ...e, strikes, nextEligibleAt: now + STRIKE_GAPS_MS[strikes - 1] });
    }

    default:
      return ledger;
  }
}

/** Not retired, not retired-until-later, and past any waiting period. */
export function isCardAvailable(ledger, id, now) {
  const e = entryOf(ledger, id);
  if (e.retired) return false;
  if (typeof e.retiredUntil === 'number' && now < e.retiredUntil) return false;
  if (typeof e.nextEligibleAt === 'number' && now < e.nextEligibleAt) return false;
  return true;
}

/**
 * One promotional card per rolling 72 hours. A clock set backwards (now
 * before the last showing) only delays: the budget reopens 72 hours after the
 * stored time.
 */
export function promoBudgetOpen(ledger, now) {
  const last = ledger?.lastPromoShownAt;
  if (typeof last !== 'number') return true;
  return now >= last + PROMO_BUDGET_MS;
}

/** True once 24 hours have passed since the first launch. */
export function dayOneOver(ledger, now) {
  return now >= ledger.firstLaunchAt + DAY_ONE_MS;
}

/**
 * The promotional card to show now, or null: past day one, budget open, and
 * the highest-priority available card among the eligible candidates.
 */
export function pickPromotional(candidateIds, ledger, now) {
  if (!dayOneOver(ledger, now) || !promoBudgetOpen(ledger, now)) return null;
  const promos = candidateIds
    .filter((id) => CARDS[id]?.cls === 'promo' && isCardAvailable(ledger, id, now))
    .sort((a, b) => CARDS[a].priority - CARDS[b].priority);
  return promos[0] ?? null;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const AD_CAMPAIGN_CARDS = Object.freeze({
  natively_api: ['natively_api_new', 'natively_api_existing'],
  profile: ['profile_ad'],
  jd: ['jd_ad'],
  max_ultra_upgrade: ['max_ultra'],
});

/**
 * Seed the ledger from what users already did before it existed, so nobody is
 * asked again. Never overwrites a card the ledger already knows (any show or
 * strike, or retired); ignores fields of the wrong type.
 *
 * legacy: { firstSeenAt?, startupCount?, reviewed?, reviewNever?, donated?,
 *           donationShows?, donationLastShownAt?, dismissedAds?: string[],
 *           trialClaimed?, stageShows?: { [cardId]: { count, lastShownAt } } }
 */
export function migrateLegacy(ledger, legacy, now) {
  if (!legacy || typeof legacy !== 'object') return ledger;
  let l = ledger;
  const untouched = (id) => {
    const e = entryOf(l, id);
    return !e.retired && e.shows === 0 && e.strikes === 0;
  };
  const retire = (id) => {
    if (untouched(id)) l = withEntry(l, id, { ...entryOf(l, id), retired: true, retiredReason: 'migrated' });
  };
  const strike = (id, count, lastShownAt) => {
    if (!isNum(count) || count < 1 || !isNum(lastShownAt) || !untouched(id)) return;
    const strikes = Math.min(count, MAX_STRIKES - 1);
    l = withEntry(l, id, { ...entryOf(l, id), strikes, lastShownAt, nextEligibleAt: lastShownAt + STRIKE_GAPS_MS[strikes - 1] });
  };

  if (legacy.reviewed === true || legacy.reviewNever === true) retire('review_prompt');
  if (legacy.donated === true) retire('support');
  if (legacy.trialClaimed === true) retire('trial_promo');
  if (Array.isArray(legacy.dismissedAds)) {
    for (const ad of legacy.dismissedAds) for (const id of AD_CAMPAIGN_CARDS[ad] ?? []) retire(id);
  }

  if (legacy.stageShows && typeof legacy.stageShows === 'object') {
    for (const [id, v] of Object.entries(legacy.stageShows)) {
      if (Object.prototype.hasOwnProperty.call(CARDS, id) && v && typeof v === 'object') strike(id, v.count, v.lastShownAt);
    }
  }
  strike('support', legacy.donationShows, legacy.donationLastShownAt);

  if (isNum(legacy.firstSeenAt) && legacy.firstSeenAt < l.firstLaunchAt) l = { ...l, firstLaunchAt: legacy.firstSeenAt };
  if (isNum(legacy.startupCount) && legacy.startupCount > l.launchCount) l = { ...l, launchCount: legacy.startupCount };
  return l;
}
