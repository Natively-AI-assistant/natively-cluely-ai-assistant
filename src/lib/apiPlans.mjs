// src/lib/apiPlans.mjs
//
// What the Plans tab says about Natively API billing: the yearly prices, the
// one-time Pro packs, and how a key's plan name and pack clock read on screen.
//
// Mirrors natively-api lib/plans.js (price_usd_yearly on each tier, PACKS) and
// lib/proPacks.js (packView). The checkout links live in src/config/urls.ts.
//
// Pure. No React, no Electron, no network.

/** Monthly and yearly price per API tier, in whole dollars. Yearly = 10x monthly. */
export const API_PLAN_PRICES = Object.freeze({
  standard: Object.freeze({ monthly: 8, yearly: 80 }),
  pro: Object.freeze({ monthly: 15, yearly: 150 }),
  max: Object.freeze({ monthly: 25, yearly: 250 }),
  ultra: Object.freeze({ monthly: 35, yearly: 350 }),
});

/** Months a yearly plan saves against twelve monthly payments. */
export const YEARLY_MONTHS_FREE = 2;

/**
 * The one-time Pro packs. Each one is Natively Pro plus the API until the hours
 * OR the days run out, whichever comes first. Same figures as the server's PACKS.
 */
export const PRO_PACKS = Object.freeze([
  Object.freeze({ id: 'pack_light', name: 'Light pack', price: 5, hours: 2, days: 7 }),
  Object.freeze({ id: 'pack_heavy', name: 'Heavy pack', price: 10, hours: 5, days: 14 }),
]);

const PACK_NAMES = Object.freeze({ pack_light: 'Light pack', pack_heavy: 'Heavy pack' });

/** Is this a pack plan name the server sends (pack_light / pack_heavy)? */
export function isPackPlan(plan) {
  return typeof plan === 'string' && Object.prototype.hasOwnProperty.call(PACK_NAMES, plan.toLowerCase());
}

/**
 * The name a plan reads as on screen: "Light pack" / "Heavy pack" for packs,
 * the capitalised name for everything else ("pro" -> "Pro"). null for nothing.
 */
export function apiPlanLabel(plan) {
  if (typeof plan !== 'string' || !plan) return null;
  const key = plan.toLowerCase();
  if (isPackPlan(key)) return PACK_NAMES[key];
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/**
 * "$15" monthly, "$150" yearly. Unknown tiers come back null so the caller
 * keeps its own fallback rather than printing "$undefined".
 */
export function apiPlanPrice(planKey, cycle) {
  const row = API_PLAN_PRICES[planKey];
  if (!row) return null;
  return `$${cycle === 'yearly' ? row.yearly : row.monthly}`;
}

/**
 * Seconds as meeting time: "2 h", "1 h 20 min", "45 min", "0 min".
 * Rounded DOWN to the minute, so it never promises time the key does not have.
 */
export function formatMeetingTime(seconds) {
  const s = Number(seconds);
  const total = Number.isFinite(s) && s > 0 ? Math.floor(s / 60) : 0;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/**
 * Where a pack stands, for the usage card. Reads the `pack` block of
 * GET /v1/usage (seconds_total, seconds_used, seconds_left, ends_at, ended,
 * ended_reason). Returns null when there is no pack.
 *
 * `ended` is also worked out here from the use-by date and the hours, because a
 * cached response can outlive the pack: once a pack ends the server refuses the
 * key, so the last good response is all the panel has.
 */
export function packStatus(pack, now = Date.now()) {
  if (!pack || typeof pack !== 'object') return null;
  const total = Number(pack.seconds_total);
  const hoursKnown = Number.isFinite(total) && total > 0;
  const leftRaw = Number(pack.seconds_left);
  const usedRaw = Number(pack.seconds_used);
  const secondsLeft = hoursKnown
    ? Math.max(0, Number.isFinite(leftRaw) ? leftRaw : total - (Number.isFinite(usedRaw) ? usedRaw : 0))
    : null;
  const endsMs = pack.ends_at ? Date.parse(pack.ends_at) : NaN;
  const windowClosed = Number.isFinite(endsMs) && endsMs <= now;
  const hoursUsed = hoursKnown && secondsLeft === 0;
  const ended = pack.ended === true || windowClosed || hoursUsed;
  const endedReason = pack.ended_reason || (hoursUsed ? 'hours_used' : windowClosed ? 'window_closed' : null);
  return {
    hoursKnown,
    secondsTotal: hoursKnown ? total : null,
    secondsLeft,
    /** 0-100, how much of the pack's time is used. 0 when the hours are unknown. */
    usedPercent: hoursKnown ? Math.min(100, Math.max(0, ((total - secondsLeft) / total) * 100)) : 0,
    endsAt: Number.isFinite(endsMs) ? new Date(endsMs).toISOString() : null,
    ended,
    endedReason: ended ? endedReason : null,
  };
}

/**
 * The pack a refused GET /v1/usage describes, or null.
 *
 * WHY (2026-11-09). When a pack's hours run out the server switches the key
 * off, so every read of it, the usage read included, is refused with 403
 * subscription_inactive. The usage card kept the last answer it had and went on
 * saying "4 h 57 min left" under a green "Heavy pack" after Pro had locked.
 *
 * The server (natively-api d8de36a, 2026-11-09) says so outright: reason
 * 'pack_ended', the pack's own block and why it ended. Only that counts. A bare
 * subscription_inactive is a pack that was refunded or revoked, or a lapsed
 * plan, not one whose hours or days ran out, and "Add hours" would not fix it.
 * `lastKnown` only fills in the pack's block when the refusal has none. Anything
 * else (no key, network) is null and the caller keeps what it shows.
 *
 * @param {{ ok?: boolean, error?: string, reason?: string, pack_ended_reason?: string|null, pack?: object|null } | null | undefined} answer
 * @param {{ plan?: string, billing_period?: string, pack?: object|null } | null | undefined} lastKnown
 * @returns {{ plan: string|null, pack: object } | null}
 */
export function endedPackFromRefusal(answer, lastKnown) {
  if (!answer || answer.ok) return null;
  if (answer.reason !== 'pack_ended') return null;
  const lastWasPack = !!lastKnown && (lastKnown.billing_period === 'pack' || isPackPlan(lastKnown.plan));
  const fresh = answer.pack && typeof answer.pack === 'object' ? answer.pack : null;
  const base = fresh ?? (lastWasPack && lastKnown.pack && typeof lastKnown.pack === 'object' ? lastKnown.pack : {});
  const plan = (typeof base.plan === 'string' && base.plan) || (lastWasPack ? lastKnown.plan : null) || null;
  return {
    plan,
    pack: { ...base, ended: true, ended_reason: answer.pack_ended_reason ?? base.ended_reason ?? null },
  };
}

/**
 * The meeting-time line for the start-up quota banner, or null.
 *
 * A pack is sold in meeting hours, so they are what runs out first; the banner
 * only watched the AI, knowledge, voice and research meters and never warned a
 * pack holder at all. Shown from `thresholdPct` used, and always once ended.
 *
 * @returns {{ label: string, detail: string, pct: number } | null}
 */
export function packMeetingBucket(pack, thresholdPct = 90, now = Date.now()) {
  const s = packStatus(pack, now);
  if (!s) return null;
  if (s.ended) {
    return { label: 'Meeting time', detail: s.endedReason === 'hours_used' ? 'Hours used up' : 'Pack ended', pct: 100 };
  }
  if (!s.hoursKnown || s.usedPercent < thresholdPct) return null;
  return {
    label: 'Meeting time',
    detail: `${formatMeetingTime(s.secondsLeft)} left of ${formatMeetingTime(s.secondsTotal)}`,
    pct: Math.round(s.usedPercent),
  };
}
