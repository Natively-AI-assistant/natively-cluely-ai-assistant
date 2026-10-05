// Checkout attribution (checkoutLinks.mjs) and the small decisions behind the
// funnel events (funnelState.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tagCheckoutUrl, parseCheckoutUrl, CHECKOUT_PRODUCT_BY_DODO_ID } from '../checkoutLinks.mjs';
import {
  resolveEntitlement, resolveMeetingAi, usesLocalModel, localDay, minutesSince, daysSince,
  mapTrialStartResult, trialCardActionForChoice, normalizeFunnelState, isFirstRun,
} from '../funnelState.mjs';

const INSTALL = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
const PRO = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';

// ── Checkout links ───────────────────────────────────────────────────────────

test('a checkout link leaves with the install, the surface and the product on it', () => {
  const r = tagCheckoutUrl(PRO, { installId: INSTALL, surface: 'trial_card' });
  assert.equal(r.checkout, true);
  assert.equal(r.product, 'api_pro');
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, PRO);
  assert.equal(u.searchParams.get('metadata_install_id'), INSTALL);
  assert.equal(u.searchParams.get('metadata_surface'), 'trial_card');
  assert.equal(u.searchParams.get('metadata_product'), 'api_pro');
});

test('only those three parameters are added: no hardware id, no email, nothing else', () => {
  const u = new URL(tagCheckoutUrl(PRO, { installId: INSTALL, surface: 'quota_banner', hwid: 'abc', email: 'a@b.c' }).url);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['metadata_install_id', 'metadata_product', 'metadata_surface']);
});

test('a link that is not a Dodo checkout link is returned untouched', () => {
  for (const url of [
    'https://natively.software/pricing',
    'https://customer.dodopayments.com/',
    'http://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA',
    'https://checkout.dodopayments.com.evil.example/buy/pdt_0NcM6Aw0IWdspbsgUeCLA',
    'https://checkout.dodopayments.com/account',
    'x-apple.systempreferences:com.apple.preference.security',
    'not a url',
  ]) {
    assert.deepEqual(tagCheckoutUrl(url, { installId: INSTALL, surface: 'other' }), { url, checkout: false, product: null });
  }
});

test('a malformed install id or surface is left out, not sent', () => {
  const u = new URL(tagCheckoutUrl(PRO, { installId: 'unavailable', surface: 'Has Spaces' }).url);
  assert.equal(u.searchParams.has('metadata_install_id'), false);
  assert.equal(u.searchParams.has('metadata_surface'), false);
  assert.equal(u.searchParams.get('metadata_product'), 'api_pro');
  assert.equal(tagCheckoutUrl(PRO).checkout, true, 'no context at all still opens the link');
});

test('parameters a link already carries are kept, never overwritten', () => {
  const r = tagCheckoutUrl(`${PRO}?email=a%40b.c&metadata_surface=campaign`, { installId: INSTALL, surface: 'trial_card' });
  const u = new URL(r.url);
  assert.equal(u.searchParams.get('email'), 'a@b.c');
  assert.equal(u.searchParams.get('metadata_surface'), 'campaign');
  assert.equal(u.searchParams.get('metadata_install_id'), INSTALL);
});

test('a checkout link to a product this build does not know is still tagged, without a product', () => {
  const r = tagCheckoutUrl('https://checkout.dodopayments.com/buy/pdt_FUTURE123', { installId: INSTALL, surface: 'other' });
  assert.deepEqual([r.checkout, r.product], [true, null]);
  assert.equal(new URL(r.url).searchParams.has('metadata_product'), false);
  assert.deepEqual(parseCheckoutUrl('https://checkout.dodopayments.com/buy/pdt_FUTURE123'), { product: null });
});

test('every checkout link written anywhere in the app maps to a known product', () => {
  // The map lives in one file; the links live in a dozen. A new link to a
  // product the map does not know would be tagged without its product name.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  const found = new Set();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.name === 'node_modules' || f.name === '__tests__') continue;
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full);
      else if (/\.(tsx?|mjs)$/.test(f.name)) {
        for (const m of fs.readFileSync(full, 'utf8').matchAll(/checkout\.dodopayments\.com\/buy\/(pdt_[A-Za-z0-9]+)/g)) found.add(m[1]);
      }
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'premium', 'src'));
  assert.ok(found.size >= 4, 'the scan found the app\'s checkout links');
  for (const id of found) assert.ok(id in CHECKOUT_PRODUCT_BY_DODO_ID, `${id} is linked in the app but missing from CHECKOUT_PRODUCT_BY_DODO_ID`);
});

// ── Entitlement ──────────────────────────────────────────────────────────────

test('entitlement: paid states win over the trial, the trial over own keys', () => {
  assert.equal(resolveEntitlement({}), 'none');
  assert.equal(resolveEntitlement(), 'none');
  assert.equal(resolveEntitlement({ hasOwnAi: true }), 'byok');
  assert.equal(resolveEntitlement({ hasTrialToken: true, hasOwnAi: true }), 'trial');
  assert.equal(resolveEntitlement({ hasTrialToken: true, trialExpired: true }), 'trial_expired');
  assert.equal(resolveEntitlement({ licensed: true, hasTrialToken: true }), 'pro');
  assert.equal(resolveEntitlement({ hasRealApiKey: true, hasTrialToken: true }), 'api');
  assert.equal(resolveEntitlement({ hasRealApiKey: true, licensed: true }), 'api_pro');
});

test('meeting AI: ours, the user\'s own, or nobody\'s', () => {
  assert.equal(resolveMeetingAi({ defaultModel: 'natively', hasOwnAi: true }), 'natively');
  assert.equal(resolveMeetingAi({ defaultModel: 'gemini-3.1-flash-lite', hasOwnAi: true }), 'own');
  assert.equal(resolveMeetingAi({ defaultModel: 'gemini-3.1-flash-lite', hasOwnAi: false }), 'none');
  assert.equal(resolveMeetingAi(), 'none');
});

test('a selected local model is the user\'s own AI, even with no key stored anywhere', () => {
  assert.equal(usesLocalModel('ollama-llama3.2'), true);
  for (const m of ['natively', 'gemini-3.1-flash-lite', 'openrouter/ollama-thing', '', null, undefined, 42]) assert.equal(usesLocalModel(m), false);
  assert.equal(resolveMeetingAi({ defaultModel: 'ollama-llama3.2', hasOwnAi: false }), 'own');
});

// ── Time ─────────────────────────────────────────────────────────────────────

test('localDay is the LOCAL calendar day', () => {
  const d = new Date(2026, 9, 1, 23, 59, 59);
  assert.equal(localDay(d.getTime()), '2026-10-01');
  assert.equal(localDay(d.getTime() + 1000), '2026-10-02');
});

test('minutesSince: whole minutes, never negative, undefined when there is no moment', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(minutesSince(now - 4 * 60_000 - 59_000, now), 4);
  assert.equal(minutesSince('2026-10-01T11:30:00Z', now), 30);
  assert.equal(minutesSince(now + 60_000, now), 0, 'a clock that moved back reads as zero');
  for (const v of [null, undefined, '', 'yesterday', NaN]) assert.equal(minutesSince(v, now), undefined);
  assert.equal(daysSince(now - 3.9 * 86_400_000, now), 3);
  assert.equal(daysSince(NaN, now), 0);
});

// ── Trial start ──────────────────────────────────────────────────────────────

test('every way a trial start can end has its own word', () => {
  assert.equal(mapTrialStartResult({ hwidUnavailable: true }), 'hwid_unavailable');
  assert.equal(mapTrialStartResult({ threw: true }), 'network');
  assert.equal(mapTrialStartResult({ status: 403, error: 'trial_ip_limit' }), 'ip_limit');
  assert.equal(mapTrialStartResult({ status: 429, error: 'trial_start_rate_limited' }), 'rate_limited');
  assert.equal(mapTrialStartResult({ status: 429, error: 'ip_blocked' }), 'rate_limited');
  assert.equal(mapTrialStartResult({ status: 500, error: 'trial_creation_failed' }), 'server_error');
  assert.equal(mapTrialStartResult({ status: 400, error: 'invalid_hwid' }), 'server_error');
  assert.equal(mapTrialStartResult({ body: { ok: true, already_used: false, expired: false } }), 'ok');
  assert.equal(mapTrialStartResult({ body: { ok: true, already_used: true, expired: false } }), 'already_used');
  assert.equal(mapTrialStartResult({ body: { ok: true, already_used: true, expired: true } }), 'already_used_expired');
  assert.equal(mapTrialStartResult({ body: {} }), 'server_error');
  assert.equal(mapTrialStartResult(), 'server_error');
});

test('a plan tile maps to its trial_card action; anything else maps to nothing', () => {
  assert.equal(trialCardActionForChoice('standard'), 'plan_standard');
  assert.equal(trialCardActionForChoice('ultra'), 'plan_ultra');
  assert.equal(trialCardActionForChoice('byok'), 'byok');
  assert.equal(trialCardActionForChoice('enterprise'), null);
  assert.equal(trialCardActionForChoice(undefined), null);
});

// ── Stored state ─────────────────────────────────────────────────────────────

test('a missing or damaged state file is an install that has reported nothing', () => {
  const blank = { firstRunSent: false, lastActiveDay: '', trialStartedAt: null, byokExitAt: null, meetings: 0 };
  for (const raw of [null, undefined, 'x', [], { lastActiveDay: 'today', meetings: -3, trialStartedAt: 'soon', firstRunSent: 'yes' }]) {
    assert.deepEqual(normalizeFunnelState(raw), blank);
  }
  assert.deepEqual(
    normalizeFunnelState({ firstRunSent: true, lastActiveDay: '2026-10-01', trialStartedAt: 5, byokExitAt: 9, meetings: 2 }),
    { firstRunSent: true, lastActiveDay: '2026-10-01', trialStartedAt: 5, byokExitAt: 9, meetings: 2 },
  );
});

test('first run: only an install whose id is minutes old and that never reported', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(isFirstRun({ firstRunSent: false, installCreatedAtMs: now - 30_000, nowMs: now }), true);
  assert.equal(isFirstRun({ firstRunSent: true, installCreatedAtMs: now - 30_000, nowMs: now }), false);
  assert.equal(isFirstRun({ firstRunSent: false, installCreatedAtMs: now - 90 * 86_400_000, nowMs: now }), false,
    'an install that upgrades into this code has been here all along');
  assert.equal(isFirstRun({ firstRunSent: false, installCreatedAtMs: NaN, nowMs: now }), false);
  assert.equal(isFirstRun({ firstRunSent: false, installCreatedAtMs: now + 5000, nowMs: now }), false);
  assert.equal(isFirstRun({ firstRunSent: false, installCreatedAtMs: now + 0.75, nowMs: now }), true,
    'a file time a fraction of a millisecond ahead of the clock is still "now"');
  assert.equal(isFirstRun({ firstRunSent: false, installCreatedAtMs: now - 11 * 60_000, nowMs: now }), false);
});
