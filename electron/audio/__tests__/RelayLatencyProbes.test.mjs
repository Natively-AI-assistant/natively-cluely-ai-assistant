// Client-side relay latency probes (best-effort, off the connect path).
//
// Loads the COMPILED relaySession.js and drives the probe functions with an
// injected fetch + clock so no network/timers are touched. Covers:
//   - deriveHealthUrl: wss→https /healthz, ws→http, junk → null
//   - refreshRelayLatencyProbes measures ok regions, omits failing/timing-out ones
//   - getRelayLatencyProbes never blocks: returns null first call, cached after refresh
//   - cache TTL: a fresh cache is reused (no re-probe); clear resets

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const rs = await import(path.join(distRoot, 'relaySession.js'));
const {
  deriveHealthUrl,
  refreshRelayLatencyProbes,
  getRelayLatencyProbes,
  clearRelayLatencyProbes,
} = rs;

test('deriveHealthUrl: wss→https /healthz, ws→http, junk→null', () => {
  assert.equal(deriveHealthUrl('wss://us-relay.natively.software/v1/transcribe'), 'https://us-relay.natively.software/healthz');
  assert.equal(deriveHealthUrl('ws://localhost:8080/v1/transcribe'), 'http://localhost:8080/healthz');
  assert.equal(deriveHealthUrl('not a url'), null);
});

test('refreshRelayLatencyProbes measures ok regions and omits failures', async () => {
  clearRelayLatencyProbes();
  let t = 1000;
  const now = () => t;
  // us responds ok (advance the clock 30ms mid-fetch), asia throws.
  const fetchImpl = async (url) => {
    if (String(url).includes('us-relay')) { t += 30; return { ok: true }; }
    throw new Error('asia down');
  };
  const probes = await refreshRelayLatencyProbes(fetchImpl, now);
  assert.equal(probes.us, 30, 'us latency measured');
  assert.ok(!('asia' in probes), 'asia omitted on failure');
});

test('getRelayLatencyProbes never blocks: null first, cached after a refresh', async () => {
  clearRelayLatencyProbes();
  let t = 5000;
  const now = () => t;
  const fetchImpl = async (url) => { t += 10; return { ok: String(url).includes('us-relay') }; };

  // First call: cache empty → returns null, kicks off a background refresh.
  const first = getRelayLatencyProbes(fetchImpl, now);
  assert.equal(first, null, 'first call returns null (non-blocking)');

  // Let the background refresh settle.
  await new Promise((r) => setTimeout(r, 20));
  const second = getRelayLatencyProbes(fetchImpl, now);
  assert.ok(second && typeof second.us === 'number', 'cached probes available after refresh');
});

test('a non-2xx /healthz omits that region (no negative/zero latency leaks)', async () => {
  clearRelayLatencyProbes();
  const now = () => 1;
  const fetchImpl = async () => ({ ok: false });   // both relays 5xx/404
  const probes = await refreshRelayLatencyProbes(fetchImpl, now);
  assert.deepEqual(probes, {}, 'no region recorded when none are ok');
});

test('clearRelayLatencyProbes resets the cache', async () => {
  let t = 1;
  const now = () => t;
  const fetchImpl = async (url) => { t += 5; return { ok: String(url).includes('us-relay') }; };
  await refreshRelayLatencyProbes(fetchImpl, now);
  assert.ok(getRelayLatencyProbes(fetchImpl, now), 'cache populated');
  clearRelayLatencyProbes();
  assert.equal(getRelayLatencyProbes(undefined, now), null, 'cache cleared (no fetch impl → stays null)');
});
