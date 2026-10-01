// The funnel queue (src/lib/funnel/funnelClient.mjs): what is recorded, what is
// refused, and what happens to the queue on every answer the server can give.
// Storage, clock, ids and fetch are all fakes; nothing here touches a network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFunnelClient, parseFunnelQueue, funnelIdentityHeaders,
  FUNNEL_QUEUE_MAX, FUNNEL_BATCH, FUNNEL_MAX_AGE_MS, FUNNEL_BACKOFF_MS,
} from '../funnelClient.mjs';

const INSTALL = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
const SESSION = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const T0 = Date.parse('2026-10-01T12:00:00Z');

function harness(over = {}) {
  const h = {
    file: over.file ?? null,
    now: T0,
    enabled: true,
    entitlement: 'trial',
    calls: [],
    respond: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, rejected_ids: [] }) }),
    n: 0,
    warnings: [],
  };
  h.client = createFunnelClient({
    load: () => h.file,
    save: (text) => { h.file = text; return true; },
    fetchImpl: async (url, init) => { h.calls.push({ url, init, body: JSON.parse(init.body) }); return h.respond(url, init); },
    endpoint: 'https://example.test/v1/telemetry/funnel',
    now: () => h.now,
    newId: () => `00000000-0000-4000-8000-${String(++h.n).padStart(12, '0')}`,
    installId: () => ('installId' in over ? over.installId : INSTALL),
    appVersion: () => '2.9.2',
    platform: over.platform ?? 'darwin',
    appSessionId: SESSION,
    isEnabled: () => h.enabled,
    getEntitlement: () => h.entitlement,
    deviceId: () => h.device,
    getCredentials: () => h.credentials,
    random: () => 0,
    log: { warn: (...a) => h.warnings.push(a.join(' ')) },
  });
  h.stored = () => parseFunnelQueue(h.file);
  return h;
}

test('a tracked event is written to storage before any network call', () => {
  const h = harness();
  assert.equal(h.client.track('checkout_opened', { product: 'api_pro', surface: 'trial_card', opened: true }), 'queued');
  assert.equal(h.calls.length, 0);
  const [e] = h.stored().events;
  assert.deepEqual(e, {
    event_id: '00000000-0000-4000-8000-000000000001',
    event_type: 'checkout_opened',
    client_event_ts: '2026-10-01T12:00:00.000Z',
    install_id: INSTALL,
    app_session_id: SESSION,
    app_version: '2.9.2',
    platform: 'darwin',
    entitlement: 'trial',
    props: { product: 'api_pro', surface: 'trial_card', opened: true },
  });
});

test('the platform is reported as given, on both desktop platforms', () => {
  for (const platform of ['darwin', 'win32']) {
    const h = harness({ platform });
    h.client.track('app_first_run');
    assert.equal(h.stored().events[0].platform, platform);
  }
  const odd = harness({ platform: 'sunos' });
  odd.client.track('app_first_run');
  assert.equal('platform' in odd.stored().events[0], false, 'an unknown platform is left out, never sent as a wrong one');
});

test('nothing outside the catalogue is queued', () => {
  const h = harness();
  assert.equal(h.client.track('made_up_event', {}), 'invalid');
  assert.equal(h.client.track('checkout_opened', { product: 'api_pro', email: 'a@b.c' }), 'invalid');
  assert.equal(h.client.track('key_entered', { kind: 'api_key', result: 'natively_sk_live_abcdef' }), 'invalid');
  assert.equal(h.client.pending(), 0);
  assert.equal(h.warnings.length, 3, 'each refusal is logged');
});

test('without a real install id nothing is queued', () => {
  for (const installId of [undefined, '', 'unavailable', 'not-a-uuid']) {
    const h = harness({ installId });
    assert.equal(h.client.track('app_first_run'), 'no_install');
    assert.equal(h.client.pending(), 0);
  }
});

test('telemetry turned off: nothing is recorded, and what was queued before is discarded unsent', async () => {
  const h = harness();
  h.client.track('app_first_run');
  h.enabled = false;
  assert.equal(h.client.track('trial_expired'), 'disabled');
  const r = await h.client.dispatchOnce();
  assert.equal(r.skipped, 'disabled');
  assert.equal(h.calls.length, 0, 'no request while off');
  assert.equal(h.client.pending(), 0);
  h.enabled = true;
  await h.client.dispatchOnce();
  assert.equal(h.calls.length, 0, 'turning it back on does not send what was recorded before');
});

test('the same event twice inside two seconds is one event; later it is two', () => {
  const h = harness();
  const p = { mode: 'expired', action: 'shown' };
  assert.equal(h.client.track('trial_card', p), 'queued');
  h.now += 500;
  assert.equal(h.client.track('trial_card', p), 'duplicate');
  assert.equal(h.client.track('trial_card', { mode: 'expired', action: 'dismissed' }), 'queued');
  h.now += 5000;
  assert.equal(h.client.track('trial_card', p), 'queued');
  assert.equal(h.client.pending(), 3);
});

test('a delivered batch is removed and nothing else', async () => {
  const h = harness();
  h.client.track('app_first_run');
  h.now += 3000;
  h.client.track('trial_expired');
  const r = await h.client.dispatchOnce();
  assert.deepEqual([r.sent, r.delivered, r.rejected], [2, 2, 0]);
  assert.equal(h.calls[0].url, 'https://example.test/v1/telemetry/funnel');
  assert.deepEqual(Object.keys(h.calls[0].init.headers), ['Content-Type'], 'no key and no token is ever sent');
  assert.equal(h.calls[0].body.events.length, 2);
  assert.equal(h.client.pending(), 0);
});

test('events the server rejects are dropped with the batch, never retried', async () => {
  const h = harness();
  h.client.track('app_first_run');
  h.now += 3000;
  h.client.track('trial_expired');
  h.respond = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, rejected_ids: ['00000000-0000-4000-8000-000000000002'] }) });
  const r = await h.client.dispatchOnce();
  assert.deepEqual([r.delivered, r.rejected], [1, 1]);
  assert.equal(h.client.pending(), 0);
});

for (const status of [503, 404, 429, 500]) {
  test(`HTTP ${status} keeps every event and backs off`, async () => {
    const h = harness();
    h.client.track('app_first_run');
    h.respond = async () => ({ ok: false, status, json: async () => ({}) });
    const r = await h.client.dispatchOnce();
    assert.equal(r.failed, `http_${status}`);
    assert.equal(h.client.pending(), 1);
    assert.equal(h.stored().attempt, 1);
    assert.equal(h.stored().nextAttemptAt, T0 + FUNNEL_BACKOFF_MS[0]);
    // Before the wait is over: no request.
    h.now = T0 + FUNNEL_BACKOFF_MS[0] - 1;
    assert.equal((await h.client.dispatchOnce()).skipped, 'backoff');
    assert.equal(h.calls.length, 1);
    // After it: a second attempt, and a longer wait on the second failure.
    h.now = T0 + FUNNEL_BACKOFF_MS[0];
    await h.client.dispatchOnce();
    assert.equal(h.calls.length, 2);
    assert.equal(h.stored().nextAttemptAt, h.now + FUNNEL_BACKOFF_MS[1]);
  });
}

test('a network failure keeps every event and backs off', async () => {
  const h = harness();
  h.client.track('app_first_run');
  h.respond = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  const r = await h.client.dispatchOnce();
  assert.equal(r.failed, 'network');
  assert.equal(h.client.pending(), 1);
});

test('the wait is capped at the last backoff step', async () => {
  const h = harness();
  h.client.track('app_first_run');
  h.respond = async () => ({ ok: false, status: 503, json: async () => ({}) });
  for (let i = 0; i < 20; i++) {
    h.now = h.stored().nextAttemptAt || h.now;
    await h.client.dispatchOnce();
  }
  assert.equal(h.stored().nextAttemptAt - h.now, FUNNEL_BACKOFF_MS.at(-1));
});

test('a request the server refuses outright (400/413) is dropped so the queue cannot wedge', async () => {
  for (const status of [400, 413]) {
    const h = harness();
    h.client.track('app_first_run');
    h.respond = async () => ({ ok: false, status, json: async () => ({ ok: false }) });
    const r = await h.client.dispatchOnce();
    assert.equal(r.rejected, 1);
    assert.equal(h.client.pending(), 0);
    assert.equal(h.stored().attempt, 0);
  }
});

test('success after failures clears the backoff', async () => {
  const h = harness();
  h.client.track('app_first_run');
  h.respond = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await h.client.dispatchOnce();
  h.now = h.stored().nextAttemptAt;
  h.respond = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await h.client.dispatchOnce();
  assert.deepEqual([h.stored().attempt, h.stored().nextAttemptAt, h.client.pending()], [0, 0, 0]);
});

test('an event tracked while a batch is in flight survives that batch', async () => {
  const h = harness();
  h.client.track('app_first_run');
  let release;
  h.respond = () => new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }); });
  const inFlight = h.client.dispatchOnce();
  await new Promise((r) => setImmediate(r));
  h.now += 3000;
  h.client.track('trial_expired');
  assert.equal((await h.client.dispatchOnce()).skipped, 'in_flight', 'overlapping timers do not double-send');
  release();
  await inFlight;
  assert.deepEqual(h.stored().events.map((e) => e.event_type), ['trial_expired']);
});

test('at most one batch per request; the rest waits for the next one', async () => {
  const h = harness();
  for (let i = 0; i < FUNNEL_BATCH + 7; i++) { h.now += 3000; h.client.track('trial_expired'); }
  await h.client.dispatchOnce();
  assert.equal(h.calls[0].body.events.length, FUNNEL_BATCH);
  assert.equal(h.client.pending(), 7);
});

test('a queue holding events for two install ids sends them in two requests and drops nothing', async () => {
  // An install whose id file cannot be written has a different id each launch.
  const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let current = INSTALL;
  const h = harness({});
  const c = createFunnelClient({
    load: () => h.file, save: (t) => { h.file = t; return true; },
    fetchImpl: async (url, init) => { h.calls.push({ body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
    endpoint: 'https://example.test/x', now: () => h.now, newId: () => `00000000-0000-4000-8000-${String(++h.n).padStart(12, '0')}`,
    installId: () => current, appVersion: () => '2.9.2', platform: 'win32', isEnabled: () => true,
  });
  c.track('app_first_run');
  h.now += 3000; c.track('trial_expired');
  current = OTHER;
  h.now += 3000; c.track('app_first_run');
  current = INSTALL;
  h.now += 3000; c.track('paywall_hit', { feature: 'modes' });

  await c.dispatchOnce();
  assert.deepEqual(h.calls[0].body.events.map((e) => e.install_id), [INSTALL, INSTALL, INSTALL], 'every event in a request is for one install');
  assert.equal(c.pending(), 1, 'the other install\'s event waits; it is not dropped');
  await c.dispatchOnce();
  assert.deepEqual(h.calls[1].body.events.map((e) => e.install_id), [OTHER]);
  assert.equal(c.pending(), 0);
  assert.equal(c.stats().delivered, 4);
  assert.equal(c.stats().dropped + c.stats().rejected, 0);
});

test('the queue is bounded: past the cap the OLDEST events go', () => {
  const h = harness();
  for (let i = 0; i < FUNNEL_QUEUE_MAX + 5; i++) { h.now += 3000; h.client.track('trial_expired'); }
  assert.equal(h.client.pending(), FUNNEL_QUEUE_MAX);
  assert.equal(h.stored().events[0].event_id, '00000000-0000-4000-8000-000000000006');
  assert.equal(h.client.stats().dropped, 5);
});

test('an event older than the age limit is dropped instead of sent', async () => {
  const h = harness();
  h.client.track('app_first_run');
  h.now += FUNNEL_MAX_AGE_MS + 1;
  h.client.track('trial_expired');
  await h.client.dispatchOnce();
  assert.deepEqual(h.calls[0].body.events.map((e) => e.event_type), ['trial_expired']);
});

test('the queue survives a restart, and a damaged file is an empty queue', async () => {
  const first = harness();
  first.client.track('app_first_run');
  const second = harness({ file: first.file });
  assert.equal(second.client.pending(), 1);
  await second.client.dispatchOnce();
  assert.equal(second.calls[0].body.events[0].event_type, 'app_first_run');

  for (const file of ['', '{', 'null', '[]', '{"events":"x"}', '{"events":[null,{"event_id":1}]}']) {
    assert.deepEqual(parseFunnelQueue(file), { events: [], attempt: 0, nextAttemptAt: 0 });
  }
});

test('storage that throws never reaches the caller', async () => {
  const client = createFunnelClient({
    load: () => { throw new Error('EACCES'); },
    save: () => { throw new Error('ENOSPC'); },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    endpoint: 'https://example.test/x', now: () => T0, newId: () => SESSION,
    installId: () => INSTALL, appVersion: () => '2.9.2', platform: 'win32', isEnabled: () => true,
  });
  assert.equal(client.track('app_first_run'), 'queued');
  await assert.doesNotReject(client.dispatchOnce());
});

test('an entitlement the catalogue does not know, or a resolver that throws, is simply left out', () => {
  const h = harness();
  h.entitlement = 'superuser';
  h.client.track('app_first_run');
  assert.equal('entitlement' in h.stored().events[0], false);
  const throwing = createFunnelClient({
    load: () => null, save: () => true, fetchImpl: async () => ({}), endpoint: 'x', now: () => T0,
    newId: () => SESSION, installId: () => INSTALL, appVersion: () => undefined, platform: 'darwin',
    isEnabled: () => true, getEntitlement: () => { throw new Error('boom'); },
  });
  assert.equal(throwing.track('app_first_run'), 'queued');
});

// ── Who the event is about ───────────────────────────────────────────────────

const HWID = 'a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const KEY = 'natively_sk_' + 'k'.repeat(40);
const TOKEN = 'natively_trial_eyJpZCI6IngifQ.c2lnbmF0dXJl';

test('an event carries the device id when the machine has one', () => {
  const h = harness();
  h.device = HWID;
  h.client.track('app_first_run');
  assert.equal(h.stored().events[0].device_id, HWID);
});

test('no device id, or the "unavailable" placeholder, is simply left out', () => {
  for (const device of [undefined, '', 'unavailable', 'Unavailable', 'short', 'has spaces in it']) {
    const h = harness();
    h.device = device;
    assert.equal(h.client.track('app_first_run'), 'queued', `${String(device)} must not cost the event`);
    assert.equal('device_id' in h.stored().events[0], false);
  }
});

test('a request carries the trial token and the key the app holds, in headers, read when it is sent', async () => {
  const h = harness();
  h.client.track('app_first_run');
  h.credentials = { trialToken: TOKEN, apiKey: KEY };   // set AFTER the event was recorded
  await h.client.dispatchOnce();
  assert.deepEqual(h.calls[0].init.headers, { 'Content-Type': 'application/json', 'x-trial-token': TOKEN, 'x-natively-key': KEY });
  assert.ok(!JSON.stringify(h.calls[0].body).includes(KEY), 'the key is never in the body');
  assert.ok(!JSON.stringify(h.calls[0].body).includes(TOKEN));
});

test('credentials never reach the queue file', () => {
  const h = harness();
  h.credentials = { trialToken: TOKEN, apiKey: KEY };
  h.client.track('app_first_run');
  assert.ok(!h.file.includes(KEY));
  assert.ok(!h.file.includes(TOKEN));
});

test('the trial sentinel is not a key and is never sent as one', async () => {
  assert.deepEqual(funnelIdentityHeaders({ apiKey: '__trial__' }), {});
  assert.deepEqual(funnelIdentityHeaders({ apiKey: '__trial__', trialToken: TOKEN }), { 'x-trial-token': TOKEN });
  for (const junk of [undefined, null, {}, { apiKey: '' }, { apiKey: 'sk-openai-abc' }, { trialToken: 'not a token' }, { apiKey: 42 }]) {
    assert.deepEqual(funnelIdentityHeaders(junk), {});
  }
  const h = harness();
  h.credentials = { apiKey: '__trial__' };
  h.client.track('app_first_run');
  await h.client.dispatchOnce();
  assert.deepEqual(Object.keys(h.calls[0].init.headers), ['Content-Type']);
});

test('a credentials resolver that throws costs the identity, not the delivery', async () => {
  const c = createFunnelClient({
    load: () => null, save: () => true,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    endpoint: 'x', now: () => T0, newId: () => SESSION, installId: () => INSTALL, appVersion: () => '2.9.2',
    platform: 'darwin', isEnabled: () => true,
    deviceId: () => { throw new Error('native module missing'); },
    getCredentials: () => { throw new Error('credential store locked'); },
  });
  assert.equal(c.track('app_first_run'), 'queued');
  assert.equal((await c.dispatchOnce()).delivered, 1);
});

test('with telemetry off no request is made, so no device id and no credentials leave', async () => {
  const h = harness();
  h.device = HWID;
  h.credentials = { trialToken: TOKEN, apiKey: KEY };
  h.client.track('app_first_run');
  h.enabled = false;
  await h.client.dispatchOnce();
  assert.equal(h.calls.length, 0);
});
