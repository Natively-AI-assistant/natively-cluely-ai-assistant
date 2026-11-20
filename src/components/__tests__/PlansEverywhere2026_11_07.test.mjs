// src/components/__tests__/PlansEverywhere2026_11_07.test.mjs
//
// Yearly plans and Pro packs on the surfaces outside Settings › Plans:
//  - the quota banner sends a subscriber to Settings › Plans, never to a pack
//    (a pack bought next to a subscription is a SEPARATE key on the server),
//    and offers a pack holder more hours;
//  - the Unlock Pro page keeps three cards and adds two quiet second offers
//    (the Heavy pack, API Pro yearly) on the paywall's own surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { isPackPlan } from '../../lib/apiPlans.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const banner = read('components/NativelyQuotaBanner.tsx');
const bannerCode = stripComments(banner);
const unlock = read('components/upgrade/UnlockProPlans.tsx');
const unlockCode = stripComments(unlock);

/** quotaBannerOffer, run for real with stand-in links. */
function loadOffer() {
  const start = banner.indexOf('export function quotaBannerOffer');
  const end = banner.indexOf('\n}\n', start) + 2;
  const src = banner.slice(start, end)
    .replace('export function', 'function')
    .replace('(plan: string | undefined, billingPeriod: string | undefined): Offer', '(plan, billingPeriod)');
  const CHECKOUT_URLS = { packLight: 'LIGHT', packHeavy: 'HEAVY' };
  return new Function('CHECKOUT_URLS', 'isPackPlan', `${src}; return quotaBannerOffer;`)(CHECKOUT_URLS, isPackPlan);
}

test('quota banner: subscribers are pointed at Settings › Plans, never a pack', () => {
  const offer = loadOffer();
  for (const [plan, period] of [['standard', 'monthly'], ['pro', 'yearly'], ['max', undefined], ['ultra', 'monthly'], ['starter', undefined]]) {
    assert.deepEqual(offer(plan, period), { kind: 'plans' }, `${plan} / ${period}`);
  }
});

test('quota banner: a pack holder is offered more hours on their own pack', () => {
  const offer = loadOffer();
  assert.deepEqual(offer('pack_light', 'pack'), { kind: 'pack', url: 'LIGHT' });
  assert.deepEqual(offer('pack_heavy', 'pack'), { kind: 'pack', url: 'HEAVY' });
  // A server before billing_period: the plan name alone says pack.
  assert.deepEqual(offer('pack_heavy', undefined), { kind: 'pack', url: 'HEAVY' });
});

test('quota banner: no hardcoded checkout, plans open in Settings, trials stay out', () => {
  assert.doesNotMatch(bannerCode, /pdt_0N|checkout\.dodopayments/, 'no product id or checkout URL in the banner');
  assert.ok(bannerCode.includes("void window.electronAPI?.openSettingsTab?.('plans');"));
  assert.ok(bannerCode.includes("openExternal?.(offer.url, { surface: 'quota_banner' })"), 'only the pack offer opens a checkout');
  assert.ok(bannerCode.includes("if (result.plan === 'trial') return;"), 'a trial has its own card');
  assert.ok(bannerCode.includes("setOffer(quotaBannerOffer(result.plan, result.billing_period));"));
  assert.ok(bannerCode.includes("'Packs do not reset'"), 'a pack is not promised a billing-date reset');
});

test('Unlock Pro: still three cards, each a checkout from CHECKOUT_URLS or PLANS', () => {
  const ids = [...unlockCode.matchAll(/^\s*id: ('pack_heavy'|apiPro\.id|'pro_yearly'),/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ["'pack_heavy'", 'apiPro.id', "'pro_yearly'"]);
  assert.doesNotMatch(unlockCode, /pdt_0N/, 'no product id on the page');
});

test('Unlock Pro: the pack card sells the Heavy pack, and no card carries a second-offer link', () => {
  // 2026-11-20: buyers took the $5 Light pack instead of API Pro, so the card is the Heavy pack and the Light pack is not offered here.
  assert.ok(unlockCode.includes('url: CHECKOUT_URLS.packHeavy,'));
  // The Light pack is only the exit card's (buildExitTier), never one of the three.
  const tiersFn = unlockCode.slice(unlockCode.indexOf('function buildTiers'), unlockCode.indexOf('function buildExitTier'));
  assert.ok(!tiersFn.includes('packLight'), 'the Light pack is not on the three-card page');
  // The "or $150/yr, 2 months free" line (and the row reserved for it) is gone, so the cards are Settings' size.
  assert.doesNotMatch(unlockCode, /\balt\b|yearlyUrl|YEARLY_MONTHS_FREE|months free/, 'no second-offer link under any button');
  // One checkout path: the paywall's surface, the same "opened" callback, so the funnel and the startup card see it.
  assert.ok(unlockCode.includes('onClick={() => choose(tier.id, tier.url)}'));
  assert.ok(unlockCode.includes('api.openExternal(url, { surface })'));
  const choose = unlockCode.slice(unlockCode.indexOf('const choose'), unlockCode.indexOf('const iconBtn'));
  assert.ok(choose.includes('await openUrl(url)') && choose.includes('onCheckoutOpened?.(id)'));
});
