import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIAL_CAMPAIGN,
  TRIAL_CAMPAIGN_SERVER_RESET_AT,
  RENDERER_TRIAL_KEYS as K,
  resetRendererTrialClaim,
  isTrialClaimedLocally,
  markTrialClaimedLocally,
  runTrialCampaignReset,
} from '../trialCampaign.mjs';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const DAY = 86_400_000;

function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
}

// ── renderer half ───────────────────────────────────────────────────────────

test('renderer: a past claim is cleared, the promo may run again, and the marker is written', () => {
  const s = memoryStorage({
    [K.claimed]: 'true',
    [K.legacyPromoTs]: '123',
    [K.onboardingState]: JSON.stringify({ completed: { trial_promo: 5, permissions: 6 }, skipped: ['trial_promo', 'x'], startupCount: 9 }),
  });
  assert.equal(resetRendererTrialClaim(s), true);
  assert.equal(s.getItem(K.claimed), null);
  assert.equal(s.getItem(K.legacyPromoTs), null);
  const st = JSON.parse(s.getItem(K.onboardingState));
  assert.deepEqual(st.completed, { permissions: 6 }, 'only the trial promo is forgotten');
  assert.deepEqual(st.skipped, ['x']);
  assert.equal(st.startupCount, 9, 'unrelated onboarding state survives');
  assert.equal(s.getItem(K.marker), TRIAL_CAMPAIGN);
});

test('renderer: runs once - a claim made AFTER the reset survives every later read', () => {
  const s = memoryStorage({ [K.claimed]: 'true' });
  assert.equal(isTrialClaimedLocally(s), false, 'the old claim is gone');
  markTrialClaimedLocally(s);
  assert.equal(isTrialClaimedLocally(s), true, 'a new claim sticks');
  assert.equal(resetRendererTrialClaim(s), false, 'second call is a no-op');
  assert.equal(isTrialClaimedLocally(s), true);
});

test('renderer: a marking done before the first read is not erased by the reset that follows', () => {
  const s = memoryStorage();
  markTrialClaimedLocally(s);
  assert.equal(isTrialClaimedLocally(s), true);
});

test('renderer: unparseable onboarding state is left alone, the flag is still cleared', () => {
  const s = memoryStorage({ [K.claimed]: 'true', [K.onboardingState]: '{not json' });
  assert.equal(resetRendererTrialClaim(s), true);
  assert.equal(s.getItem(K.onboardingState), '{not json');
  assert.equal(s.getItem(K.claimed), null);
});

test('renderer: storage that throws never throws out and writes no marker', () => {
  const s = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(resetRendererTrialClaim(s), false);
  assert.equal(isTrialClaimedLocally(s), false);
});

test('renderer: a different campaign id re-runs it', () => {
  const s = memoryStorage({ [K.marker]: '2026-01-01', [K.claimed]: 'true' });
  assert.equal(resetRendererTrialClaim(s), true);
  assert.equal(s.getItem(K.claimed), null);
});

// ── main half ───────────────────────────────────────────────────────────────

function harness(over = {}) {
  const calls = [];
  let marker = over.marker;
  const deps = {
    now: NOW,
    getMarker: () => marker,
    setMarker: (v) => { marker = v; calls.push('marker'); },
    trial: over.trial ?? { hasToken: true, expiresAtMs: NOW - DAY, startedAtMs: TRIAL_CAMPAIGN_SERVER_RESET_AT - 5 * DAY },
    eligible: over.eligible ?? true,
    sentinelActive: over.sentinelActive ?? false,
    endExpiredRuntime: async () => { calls.push('endRuntime'); },
    resetClaim: () => { calls.push('resetClaim'); return { persisted: over.persisted ?? true }; },
    reopenPromo: () => { calls.push('reopen'); return over.ledgerOk ?? true; },
  };
  return { deps, calls, marker: () => marker };
}

test('main: an old expired trial is cleared, the promo reopened, then the marker - in that order', async () => {
  const h = harness();
  assert.deepEqual(await runTrialCampaignReset(h.deps), { status: 'reset' });
  assert.deepEqual(h.calls, ['resetClaim', 'reopen', 'marker']);
  assert.equal(h.marker(), TRIAL_CAMPAIGN);
});

test('main: no token at all (claim already cleared or never made) still reopens the promo', async () => {
  const h = harness({ trial: { hasToken: false, expiresAtMs: NaN, startedAtMs: NaN } });
  assert.deepEqual(await runTrialCampaignReset(h.deps), { status: 'reset' });
});

test('main: a trial with time left is never touched and leaves no marker (retries next launch)', async () => {
  const h = harness({ trial: { hasToken: true, expiresAtMs: NOW + 60_000, startedAtMs: NOW - 60_000 } });
  assert.deepEqual(await runTrialCampaignReset(h.deps), { status: 'live' });
  assert.deepEqual(h.calls, []);
  assert.equal(h.marker(), undefined);
});

test('main: an unreadable expiry is treated as live, not as expired', async () => {
  const h = harness({ trial: { hasToken: true, expiresAtMs: NaN, startedAtMs: NaN } });
  assert.equal((await runTrialCampaignReset(h.deps)).status, 'live');
  assert.deepEqual(h.calls, []);
});

test('main: a trial that started AFTER the server reset is the new campaign - no third trial', async () => {
  const h = harness({ trial: { hasToken: true, expiresAtMs: NOW - DAY, startedAtMs: TRIAL_CAMPAIGN_SERVER_RESET_AT + 1 } });
  assert.deepEqual(await runTrialCampaignReset(h.deps), { status: 'newer-trial' });
  assert.deepEqual(h.calls, ['marker'], 'nothing cleared, but done for good');
});

test('main: exactly at the cutoff counts as the new campaign', async () => {
  const h = harness({ trial: { hasToken: true, expiresAtMs: NOW - DAY, startedAtMs: TRIAL_CAMPAIGN_SERVER_RESET_AT } });
  assert.equal((await runTrialCampaignReset(h.deps)).status, 'newer-trial');
});

test('main: while the trial sentinel is still the Natively key its routing is stood down BEFORE the token goes', async () => {
  const h = harness({ sentinelActive: true });
  await runTrialCampaignReset(h.deps);
  assert.deepEqual(h.calls, ['endRuntime', 'resetClaim', 'reopen', 'marker']);
});

test('main: the sentinel is irrelevant when there is no token to clear', async () => {
  const h = harness({ sentinelActive: true, trial: { hasToken: false, expiresAtMs: NaN, startedAtMs: NaN } });
  await runTrialCampaignReset(h.deps);
  assert.ok(!h.calls.includes('endRuntime'));
});

test('main: a degraded credential store writes no marker and skips the ledger, so the next launch retries', async () => {
  const h = harness({ persisted: false });
  assert.deepEqual(await runTrialCampaignReset(h.deps), { status: 'degraded' });
  assert.deepEqual(h.calls, ['resetClaim']);
  assert.equal(h.marker(), undefined);
});

test('main: an unreadable ledger writes no marker (credentials were reset; the retry is idempotent)', async () => {
  const h = harness({ ledgerOk: false });
  assert.deepEqual(await runTrialCampaignReset(h.deps), { status: 'ledger-unreadable' });
  assert.equal(h.marker(), undefined);
});

test('main: a user with a licence, a real key or their own AI key is left exactly as they are', async () => {
  const h = harness({ eligible: false });
  assert.deepEqual(await runTrialCampaignReset(h.deps), { status: 'ineligible' });
  assert.deepEqual(h.calls, [], 'nothing cleared, reopened or recorded');
  assert.equal(h.marker(), undefined, 'no marker: if they later drop their keys they are eligible then');
});

test('main: ineligible wins even over an old expired token with the sentinel set', async () => {
  const h = harness({ eligible: false, sentinelActive: true });
  assert.equal((await runTrialCampaignReset(h.deps)).status, 'ineligible');
  assert.ok(!h.calls.includes('endRuntime') && !h.calls.includes('resetClaim'));
});

test('main: the same user, once eligible, is reset on a later launch', async () => {
  const first = harness({ eligible: false });
  await runTrialCampaignReset(first.deps);
  const later = harness({ eligible: true, marker: first.marker() });
  assert.equal((await runTrialCampaignReset(later.deps)).status, 'reset');
});

test('main: once the marker is set nothing runs again', async () => {
  const h = harness({ marker: TRIAL_CAMPAIGN });
  assert.deepEqual(await runTrialCampaignReset(h.deps), { status: 'already' });
  assert.deepEqual(h.calls, []);
});

test('main: retry after a degraded launch completes the reset', async () => {
  const first = harness({ persisted: false });
  await runTrialCampaignReset(first.deps);
  const second = harness({ marker: first.marker() });
  assert.equal((await runTrialCampaignReset(second.deps)).status, 'reset');
});
