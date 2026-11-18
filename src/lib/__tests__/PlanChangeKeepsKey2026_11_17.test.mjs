// src/lib/__tests__/PlanChangeKeepsKey2026_11_17.test.mjs
//
// 2026-11-17 (Evin, revised): one pack key and one monthly/yearly key per
// customer; a change within a family keeps that key. The Plans tab tags
// checkout links with the key's signed upgrade token so the purchase lands on
// that key, and says what a change does to it. The server
// rules live in natively-api lib/planChange.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { isCheckoutUrl, withUpgradeLink, planChangeNote, carryLine, isYearlyLocked, heldPackNote, canUpgradeYearlyTo, formatCharge, planChangeNote as noteFor } from '../planChangeCopy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(__dirname, '..', '..', '..', rel), 'utf8');
const MAX = 'https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf';

test('only Dodo checkout links are tagged', () => {
  assert.equal(isCheckoutUrl(MAX), true);
  assert.equal(isCheckoutUrl('https://heynatively.com/pricing'), false);
  assert.equal(isCheckoutUrl('not a url'), false);
  assert.equal(withUpgradeLink('https://heynatively.com/pricing', { ok: true, token: 't' }), 'https://heynatively.com/pricing');
});

test('the token and email ride on the checkout link; a failed lookup leaves it untouched', () => {
  const u = new URL(withUpgradeLink(MAX, { ok: true, token: 'v1.abc.123.sig', email: 'me@example.com' }));
  assert.equal(u.searchParams.get('metadata_natively_upgrade'), 'v1.abc.123.sig');
  assert.equal(u.searchParams.get('email'), 'me@example.com');
  assert.equal(u.pathname, '/buy/pdt_0NcM7JElX4Af6LNVFS1Yf');
  assert.equal(withUpgradeLink(MAX, { ok: false, error: 'network_error' }), MAX);
  assert.equal(withUpgradeLink(MAX, null), MAX);
  // no secret on the server: no token, email still prefilled
  assert.equal(new URL(withUpgradeLink(MAX, { ok: true, token: null, email: 'me@example.com' })).searchParams.has('metadata_natively_upgrade'), false);
  // an email already on the link is kept
  assert.equal(new URL(withUpgradeLink(MAX + '?email=a@b.co', { ok: true, email: 'me@example.com' })).searchParams.get('email'), 'a@b.co');
});

test('the note says what a change does to this key', () => {
  assert.match(planChangeNote({ plan: 'max', billing_period: 'monthly' }, 'packs'), /own API key.*it is used first, then your Max plan carries on when the pack ends/);
  assert.match(planChangeNote({ plan: 'pack_light', billing_period: 'pack' }, 'packs'), /adds its hours.*ends when the new pack ends/);
  assert.match(planChangeNote({ plan: 'pack_heavy', billing_period: 'pack' }, 'plans', 'monthly'), /own API key.*pack keeps running/);
  const yearly = planChangeNote({ plan: 'pro', billing_period: 'yearly' }, 'plans', 'monthly');
  assert.match(yearly, /can't be changed until its year is up/);
  assert.equal(planChangeNote({ plan: 'pro', billing_period: 'yearly' }, 'plans', 'yearly'), yearly, 'same on either switch');
  const general = planChangeNote({ plan: 'standard', billing_period: 'monthly' }, 'plans', 'monthly');
  assert.match(general, /keep this API key.*up or down/);
  assert.match(general, /research starts fresh/);
  assert.match(general, /not refunded/);
  assert.equal(planChangeNote({}, 'plans'), null);
  assert.equal(planChangeNote(null, 'packs'), null);
});

test('carry line', () => {
  const fmt = { formatNumber: (n) => `${n / 1e6}M`, formatDate: () => 'Dec 17' };
  assert.equal(
    carryLine({ ai_tokens: 2e6, transcription_minutes: 180, embedding_tokens: 1e6, reranker_tokens: 1e6, expires_at: 'x', from_plan: 'pack_light' }, fmt),
    'Includes 2M AI tokens, 180 voice min, 2M knowledge tokens carried over from the Light pack, until Dec 17.',
  );
  assert.equal(carryLine({ ai_tokens: 0, transcription_minutes: 0, embedding_tokens: 0, reranker_tokens: 0 }, fmt), null);
  assert.equal(carryLine(null, fmt), null);
});

test('the Plans tab uses the helper and the bridge exists', () => {
  const panel = read('src/components/settings/NativelyApiSettings.tsx');
  assert.match(panel, /getNativelyUpgradeLink\(family\)/);
  assert.match(panel, /withUpgradeLink\(url, link\)/);
  assert.match(panel, /planChangeNote\(usageData, 'packs'\)/);
  assert.match(read('electron/preload.ts'), /getNativelyUpgradeLink: \(family\?: 'pack' \| 'plan'\) => ipcRenderer\.invoke\('get-natively-upgrade-link', family\)/);
  assert.match(read('electron/ipcHandlers.ts'), /safeHandle\('get-natively-upgrade-link'/);
});

test('a yearly key is offered no other plan; checkout clicks are guarded while the link is signed', () => {
  assert.equal(isYearlyLocked({ plan: 'pro', billing_period: 'yearly' }), true);
  assert.equal(isYearlyLocked({ plan: 'pro', billing_period: 'monthly' }), false);
  assert.equal(isYearlyLocked({ plan: 'pack_light', billing_period: 'pack' }), false);
  assert.equal(isYearlyLocked(null), false);
  const panel = read('src/components/settings/NativelyApiSettings.tsx');
  assert.match(panel, /isSaved && isYearlyLocked\(usageData\) \?/);
  assert.match(panel, /if \(checkoutPendingRef\.current\) return;/);
  assert.match(panel, /\.finally\(\(\) => \{ checkoutPendingRef\.current = false; \}\)/);
});

test('the held pack key\'s line says when it is used', () => {
  assert.equal(heldPackNote({ held: true, inUse: false, until: null, stoppedEarly: true }), 'Your plan covers what this pack has used up. The pack is used again if your plan runs out of it too.');
  // just pasted, not answered yet: nothing rather than something untrue
  assert.equal(heldPackNote({ held: true, inUse: false, until: null }), null);
  assert.equal(heldPackNote({ held: true, inUse: false, until: null, stoppedEarly: false }), null);
  assert.equal(heldPackNote({ held: true, inUse: true, until: '2026-12-01T00:00:00Z' }, { formatDate: () => 'Nov 22' }), 'In use until Nov 22. Anything left then expires and your plan is used again.');
  assert.equal(heldPackNote({ held: true, inUse: true, until: null }), 'In use now. Anything left expires when the pack ends, then your plan is used again.', 'no made-up date');
  assert.equal(heldPackNote({ held: false }), null);
  assert.equal(heldPackNote(null), null);
});

test('yearly policy (2026-11-17): a yearly key moves UP a yearly tier in place only when the server offers it', () => {
  const key = { plan: 'pro', billing_period: 'yearly', yearly_upgrade: true };
  assert.equal(canUpgradeYearlyTo(key, 'max', 'yearly'), true);
  assert.equal(canUpgradeYearlyTo(key, 'ultra', 'yearly'), true);
  assert.equal(canUpgradeYearlyTo(key, 'standard', 'yearly'), false, 'never down');
  assert.equal(canUpgradeYearlyTo(key, 'pro', 'yearly'), false, 'not the same tier');
  assert.equal(canUpgradeYearlyTo(key, 'max', 'monthly'), false, 'not to monthly');
  assert.equal(canUpgradeYearlyTo({ ...key, yearly_upgrade: false }, 'max', 'yearly'), false, 'server switch off');
  assert.equal(canUpgradeYearlyTo({ ...key, billing_period: 'monthly' }, 'max', 'yearly'), false);
  assert.equal(formatCharge(9876, 'USD'), '$98.76');
  assert.match(noteFor(key, 'plans', 'yearly'), /move up to a higher yearly plan now/);
  assert.match(noteFor({ plan: 'pro', billing_period: 'yearly' }, 'plans', 'yearly'), /can't be changed until its year is up/);
  const panel = read('src/components/settings/NativelyApiSettings.tsx');
  assert.match(panel, /canUpgradeYearlyTo\(usageData, plan\.planKey, billingCycle\)/);
  assert.match(panel, /api\(planId, confirming \? yearlyUp!\.amount : undefined\)/, 'the second press pays exactly the previewed amount');
  assert.match(read('electron/preload.ts'), /nativelyYearlyUpgrade: \(plan: string, expectedAmount\?: number\) => ipcRenderer\.invoke\('natively-yearly-upgrade', plan, expectedAmount\)/);
  assert.match(read('electron/ipcHandlers.ts'), /safeHandle\('natively-yearly-upgrade'[\s\S]{0,600}getMainNativelyApiKey\(\)/);
});

test('Evin 11-18: on a plan, the pack card says the pack is used first', () => {
  assert.equal(planChangeNote({ plan: 'pro', billing_period: 'monthly' }, 'packs'),
    'A pack comes with its own API key, sent by email. Paste it here: it is used first, then your Pro plan carries on when the pack ends.');
  assert.equal(planChangeNote({ plan: 'starter', billing_period: 'yearly' }, 'packs'),
    'A pack comes with its own API key, sent by email. Paste it here: it is used first, then your Standard plan carries on when the pack ends.');
  // on a pack, the packs card still says the next pack stacks on this key
  assert.match(planChangeNote({ plan: 'pack_heavy', billing_period: 'pack' }, 'packs'), /^Another pack adds its hours to this key/);
});
