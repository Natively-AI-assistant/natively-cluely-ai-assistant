// src/lib/planChangeCopy.mjs
//
// Plan changes (natively-api lib/planChange.js, 2026-11-17, revised): a
// customer holds one PACK key and one SUBSCRIPTION key (monthly or yearly). A
// pack lands on the pack key (hours stack, leftovers carry, it ends with the
// new pack); a monthly or yearly plan lands on the subscription key (up or
// down, the unused AI, voice and knowledge carry until the first reset;
// research starts fresh). Nothing crosses between the two keys, and no plan
// change is refunded.
//
// Pure, so the rules the Plans tab shows are testable without React:
//   withUpgradeLink   tags a Dodo checkout link with the key's signed upgrade
//                     token and prefills the key's email, so the purchase lands
//                     on THIS key even if the customer types another address
//   planChangeNote    the one sentence under the plans / packs for this key
//   isYearlyLocked    a yearly key is offered no other plan until its year ends

const CHECKOUT_HOST = 'checkout.dodopayments.com';

/** Is this one of our Dodo checkout links? Anything else is opened untouched. */
export function isCheckoutUrl(url) {
  try {
    return new URL(url).hostname === CHECKOUT_HOST;
  } catch {
    return false;
  }
}

/**
 * The checkout link with the upgrade token and email added. A non-checkout
 * URL, or no link answer, returns the URL unchanged: the server then matches
 * the purchase by email, which is what a website purchase always does.
 */
export function withUpgradeLink(url, link) {
  if (!isCheckoutUrl(url) || !link || link.ok !== true) return url;
  const u = new URL(url);
  if (typeof link.token === 'string' && link.token) u.searchParams.set('metadata_natively_upgrade', link.token);
  if (typeof link.email === 'string' && link.email.includes('@') && !u.searchParams.has('email')) u.searchParams.set('email', link.email);
  return u.toString();
}

const RANK = { pack_light: 0, pack_heavy: 1, starter: 2, standard: 2, pro: 3, max: 4, ultra: 5 };
const isPack = (plan) => plan === 'pack_light' || plan === 'pack_heavy';

/**
 * The note shown for the key's current plan, or null with no plan.
 *
 * @param {{ plan?: string, billing_period?: string }} key
 * @param {'plans'|'packs'} view    which list is on screen
 * @param {'monthly'|'yearly'} cycle the plans' Monthly/Yearly switch
 */
export function planChangeNote(key, view, cycle = 'monthly') {
  const plan = typeof key?.plan === 'string' ? key.plan.toLowerCase() : '';
  if (!(plan in RANK)) return null;
  const period = isPack(plan) ? 'pack' : key.billing_period === 'yearly' ? 'yearly' : 'monthly';
  const name = plan === 'starter' ? 'Standard' : plan.charAt(0).toUpperCase() + plan.slice(1);
  if (view === 'packs') {
    if (period === 'pack') return 'Another pack adds its hours to this key and carries what is left over; it ends when the new pack ends.';
    return `A pack comes with its own API key, sent by email. Paste it here: it is used first, then your ${name} plan carries on when the pack ends.`;
  }
  if (period === 'pack') {
    return 'A monthly or yearly plan comes with its own API key, sent by email. Your pack keeps running on this key until it ends.';
  }
  if (period === 'yearly') {
    if (key.yearly_upgrade) {
      return 'You can move up to a higher yearly plan now: what is left of your year is credited, the new plan\'s year starts today, and your key stays the same. Moving down or to monthly waits until your year ends. Packs still work alongside it.';
    }
    return 'A yearly plan can\'t be changed until its year is up. To move to another plan, turn off renewal and pick the new one when the year ends. Packs still work alongside it.';
  }
  return 'You keep this API key when you change plan, up or down. Unused AI, voice and knowledge carry over until the first reset; research starts fresh. Plan changes are not refunded.';
}

/**
 * A yearly key cannot change plan before its year is up (natively-api
 * lib/planChange.js isYearlyLocked): the Plans tab offers no other plan to it.
 * Only a key the server answered for (a live key) reaches here.
 */
export function isYearlyLocked(key) {
  return !!key && key.billing_period === 'yearly' && !isPack(typeof key.plan === 'string' ? key.plan.toLowerCase() : '');
}

/**
 * May this yearly key move up to `planId` in place now? Only when the server
 * offers it (usage.yearly_upgrade), on the Yearly view, to a higher tier.
 *
 * @param {{ plan?: string, billing_period?: string, yearly_upgrade?: boolean }} key
 * @param {string} planId  standard | pro | max | ultra
 * @param {'monthly'|'yearly'} cycle
 */
export function canUpgradeYearlyTo(key, planId, cycle) {
  if (!isYearlyLocked(key) || key.yearly_upgrade !== true || cycle !== 'yearly') return false;
  const from = RANK[typeof key.plan === 'string' ? key.plan.toLowerCase() : ''];
  const to = RANK[typeof planId === 'string' ? planId.toLowerCase() : ''];
  return from !== undefined && to !== undefined && !isPack(planId) && to > from;
}

/** "$98.76" from Dodo's minor units. */
export function formatCharge(amount, currency) {
  const n = Number(amount) / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'USD') }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || ''}`.trim();
  }
}

/** "Includes 2M AI tokens and 180 voice min carried over from Light, until Dec 17." or null. */
export function carryLine(carry, { formatNumber = (n) => String(n), formatDate = (iso) => iso } = {}) {
  if (!carry || typeof carry !== 'object') return null;
  const parts = [];
  if (carry.ai_tokens > 0) parts.push(`${formatNumber(carry.ai_tokens)} AI tokens`);
  if (carry.transcription_minutes > 0) parts.push(`${carry.transcription_minutes} voice min`);
  const knowledge = (carry.embedding_tokens || 0) + (carry.reranker_tokens || 0);
  if (knowledge > 0) parts.push(`${formatNumber(knowledge)} knowledge tokens`);
  if (!parts.length) return null;
  const from = carry.from_plan ? ` from ${labelOf(carry.from_plan)}` : '';
  const until = carry.expires_at ? `, until ${formatDate(carry.expires_at)}` : '';
  return `Includes ${parts.join(', ')} carried over${from}${until}.`;
}

function labelOf(plan) {
  if (plan === 'pack_light') return 'the Light pack';
  if (plan === 'pack_heavy') return 'the Heavy pack';
  if (plan === 'starter') return 'Standard';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/**
 * The line under the held pack key's row (one app, two keys, 2026-11-17):
 * when it is used, or until when it is in use now. `formatDate` renders the ISO
 * pack's use-by date.
 */
export function heldPackNote(state, { formatDate = (iso) => iso } = {}) {
  if (!state || !state.held) return null;
  if (state.inUse && state.until) return `In use until ${formatDate(state.until)}. Anything left then expires and your plan is used again.`;
  // In use, but the server has not named the pack's use-by date: no made-up date.
  if (state.inUse) return 'In use now. Anything left expires when the pack ends, then your plan is used again.';
  // Not in use while it lives: it used up something the plan still has. Any
  // other "not in use" (just pasted, not answered yet) says nothing rather than
  // something untrue.
  if (state.stoppedEarly) return 'Your plan covers what this pack has used up. The pack is used again if your plan runs out of it too.';
  return null;
}
