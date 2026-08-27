// Tests for scripts/lib/notary-preflight.cjs — the "is the notary reachable"
// gate that runs FIRST in the signed build.
//
// WHY IT EXISTS (2026-08-27): two signed builds spent the full ~10 minutes of
// tsc + Vite + Rust + pack + Developer-ID sign, then died on the first network
// call with NSURLErrorDomain Code=-1009 "The Internet connection appears to be
// offline… (No network route)". The retry in notary-transient.cjs is right for a
// blip, but a machine with no route just spends the retry budget reaching the
// same failure.
//
// The probe and the sleep are injected, so nothing here touches the network.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { decidePreflight, checkNotaryReachable, NOTARY_HOST } = require('../lib/notary-preflight.cjs');

describe('decidePreflight', () => {
  test('runs for a signed darwin build', () => {
    assert.equal(decidePreflight({ platform: 'darwin', env: {} }).run, true);
  });

  test('never runs on Windows — nothing there notarizes', () => {
    const d = decidePreflight({ platform: 'win32', env: {} });
    assert.equal(d.run, false);
    assert.match(d.reason, /not darwin/);
  });

  test('respects its own escape hatch, for packaging while offline', () => {
    const d = decidePreflight({ platform: 'darwin', env: { NATIVELY_SKIP_NOTARY_PREFLIGHT: '1' } });
    assert.equal(d.run, false);
  });

  test('respects NATIVELY_SKIP_NOTARIZE — a build that will not notarize must not be blocked', () => {
    // Otherwise an unreachable notary would fail a build that never intended to
    // contact it, which is strictly worse than the problem being solved.
    const d = decidePreflight({ platform: 'darwin', env: { NATIVELY_SKIP_NOTARIZE: '1' } });
    assert.equal(d.run, false);
  });
});

describe('checkNotaryReachable', () => {
  const okProbe = async () => ({ ok: true, detail: 'connected' });
  const deadProbe = async () => ({ ok: false, detail: 'ENETUNREACH' });

  test('passes on the first attempt when the host answers', async () => {
    const r = await checkNotaryReachable({ probe: okProbe, sleep: async () => {} });
    assert.deepEqual({ ok: r.ok, attempts: r.attempts }, { ok: true, attempts: 1 });
  });

  test('ONE dropped probe must not fail the build — it retries', async () => {
    // Erring toward passing is deliberate: a false "unreachable" blocks a build
    // that would have worked, which is worse than letting it proceed and fail later.
    let n = 0;
    const flaky = async () => (++n === 1 ? { ok: false, detail: 'ETIMEDOUT' } : { ok: true, detail: 'connected' });
    const r = await checkNotaryReachable({ probe: flaky, sleep: async () => {} });
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 2);
  });

  test('a genuinely dead network fails, carrying the reason', async () => {
    const r = await checkNotaryReachable({ probe: deadProbe, sleep: async () => {}, attempts: 2 });
    assert.equal(r.ok, false);
    assert.equal(r.attempts, 2);
    assert.equal(r.detail, 'ENETUNREACH');
  });

  test('it targets the host that actually failed in the -1009 error', () => {
    assert.equal(NOTARY_HOST, 'appstoreconnect.apple.com');
  });

  test('the probe receives the host/port/timeout it was configured with', async () => {
    const seen = [];
    await checkNotaryReachable({
      host: 'example.invalid', port: 8443, timeoutMs: 1234, attempts: 1,
      probe: async (args) => { seen.push(args); return { ok: true }; },
      sleep: async () => {},
    });
    assert.deepEqual(seen, [{ host: 'example.invalid', port: 8443, timeoutMs: 1234 }]);
  });

  test('a probe that resolves nothing is treated as unreachable, not as success', async () => {
    const r = await checkNotaryReachable({ probe: async () => undefined, sleep: async () => {}, attempts: 1 });
    assert.equal(r.ok, false);
  });
});
