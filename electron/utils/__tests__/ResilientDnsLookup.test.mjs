// electron/utils/resilientDnsLookup.ts — the process-wide dns.lookup that
// survives a stalled resolver (2026-09-10).
//
// Measured on an iPhone-hotspot network: c-ares resolve4 8,009 ms, system
// lookup 11 ms. main.ts used to put c-ares FIRST for api.natively.software,
// unbounded and uncached, so every Natively request blew its 4 s connect
// budget. Each clause of the new contract is asserted here with injected
// resolvers and a fake clock — no real DNS, no real timers.
//
// Run with: npm run build:electron && node --test electron/utils/__tests__/ResilientDnsLookup.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createResilientLookup, DNS_ATTEMPT_TIMEOUT_MS } = require(path.resolve(__dirname, '../../../dist-electron/electron/utils/resilientDnsLookup.js'));

/** A fake timer set: timers fire only when the test advances the clock. */
function fakeClock() {
  let t = 1_000_000;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    advance: (ms) => { t += ms; for (const [id, tm] of [...timers]) if (tm.at <= t) { timers.delete(id); tm.fn(); } },
  };
}

/** Injected system lookup whose behaviour is scripted per call. */
function scriptedLookup(script) {
  const calls = [];
  const pending = [];
  const fn = (hostname, options, cb) => {
    calls.push({ hostname, options });
    const step = script.shift() ?? 'hang';
    if (step === 'hang') { pending.push(cb); return; }
    if (step instanceof Error) { queueMicrotask(() => cb(step)); return; }
    queueMicrotask(() => cb(null, step));
  };
  return { fn, calls, pending };
}

const lookupOnce = (r, hostname, options) => new Promise((resolve) => r.lookup(hostname, options, (err, address, family) => resolve({ err, address, family })));
const tick = () => new Promise((r) => setImmediate(r));

describe('resilient dns.lookup', () => {
  test('serves the system lookup and caches it — the second call never touches a resolver', async () => {
    const clock = fakeClock();
    const sys = scriptedLookup([[{ address: '69.46.46.59', family: 4 }]]);
    const r = createResilientLookup({ lookup: sys.fn, resolve4: () => { throw new Error('must not run'); }, ...clock, log: () => {} });
    const a = await lookupOnce(r, 'api.natively.software', {});
    assert.equal(a.address, '69.46.46.59'); assert.equal(a.family, 4);
    const b = await lookupOnce(r, 'api.natively.software', {});
    assert.equal(b.address, '69.46.46.59');
    assert.equal(sys.calls.length, 1, 'one resolver call for two lookups');
  });

  test('a stale entry is served IMMEDIATELY while the resolver is re-asked in the background', async () => {
    const clock = fakeClock();
    const sys = scriptedLookup([[{ address: '69.46.46.59', family: 4 }], 'hang']);
    const cares = { calls: 0 };
    const r = createResilientLookup({ lookup: sys.fn, resolve4: (h, cb) => { cares.calls++; cb(null, ['1.1.1.1']); }, ...clock, ttlMs: 60_000, log: () => {} });
    await lookupOnce(r, 'api.natively.software', {});
    clock.advance(61_000); // entry is now stale
    let answered = null;
    r.lookup('api.natively.software', {}, (err, address) => { answered = { err, address }; });
    assert.equal(answered, null, 'a lookup NEVER calls back in the same tick — net.connect assumes an async lookup');
    await tick();
    assert.deepEqual(answered, { err: null, address: '69.46.46.59' }, 'served on the next tick — the caller never waits on a hanging resolver');
    assert.equal(sys.calls.length, 2, 'a background refresh was started');
    assert.equal(cares.calls, 0, 'c-ares is not consulted while a stale entry exists');
    // A second stale hit while the refresh hangs does not start another refresh.
    r.lookup('api.natively.software', {}, () => {});
    assert.equal(sys.calls.length, 2, 'refreshes are deduplicated per host');
    clock.advance(DNS_ATTEMPT_TIMEOUT_MS + 1); await tick();
    r.lookup('api.natively.software', {}, () => {});
    assert.equal(sys.calls.length, 3, 'after the bound expires the next stale hit may refresh again');
  });

  test('a background refresh that succeeds replaces the cached address', async () => {
    const clock = fakeClock();
    const sys = scriptedLookup([[{ address: '69.46.46.59', family: 4 }], [{ address: '69.46.46.60', family: 4 }]]);
    const r = createResilientLookup({ lookup: sys.fn, ...clock, ttlMs: 60_000, log: () => {} });
    await lookupOnce(r, 'api.natively.software', {});
    clock.advance(61_000);
    const stale = await lookupOnce(r, 'api.natively.software', {});
    assert.equal(stale.address, '69.46.46.59');
    await tick(); await tick();
    const fresh = await lookupOnce(r, 'api.natively.software', {});
    assert.equal(fresh.address, '69.46.46.60', 'the refreshed address is served once the resolver answers');
    assert.equal(sys.calls.length, 2);
  });

  test('with no cache, a failed system lookup falls back to a BOUNDED c-ares resolve4', async () => {
    const clock = fakeClock();
    const sys = scriptedLookup([Object.assign(new Error('getaddrinfo ENOTFOUND api.natively.software'), { code: 'ENOTFOUND' })]);
    const r = createResilientLookup({ lookup: sys.fn, resolve4: (h, cb) => cb(null, ['69.46.46.59']), ...clock, log: () => {} });
    const a = await lookupOnce(r, 'api.natively.software', {});
    assert.equal(a.err, null); assert.equal(a.address, '69.46.46.59'); assert.equal(a.family, 4);
  });

  test('a c-ares fallback that stalls is abandoned too, and the system error is reported', async () => {
    const clock = fakeClock();
    const sysErr = Object.assign(new Error('getaddrinfo ENOTFOUND nope.example'), { code: 'ENOTFOUND' });
    const sys = scriptedLookup([sysErr]);
    const r = createResilientLookup({ lookup: sys.fn, resolve4: () => { /* never answers */ }, ...clock, log: () => {} });
    const p = lookupOnce(r, 'nope.example', {});
    await tick(); await tick();
    clock.advance(DNS_ATTEMPT_TIMEOUT_MS + 1);
    const a = await p;
    assert.equal(a.err, sysErr, 'the caller sees the real resolver error, not a synthetic one');
  });

  test('honours the all:true option shape and the family cache key', async () => {
    const clock = fakeClock();
    const sys = scriptedLookup([
      [{ address: '64:ff9b::452e:2e3b', family: 6 }, { address: '69.46.46.59', family: 4 }],
      [{ address: '69.46.46.59', family: 4 }],
    ]);
    const r = createResilientLookup({ lookup: sys.fn, resolve4: () => { throw new Error('must not run'); }, ...clock, log: () => {} });
    const all = await lookupOnce(r, 'api.natively.software', { all: true });
    assert.deepEqual(all.address, [{ address: '64:ff9b::452e:2e3b', family: 6 }, { address: '69.46.46.59', family: 4 }]);
    const v4 = await lookupOnce(r, 'api.natively.software', { family: 4 });
    assert.equal(v4.address, '69.46.46.59');
    assert.equal(sys.calls.length, 2, 'family:4 is a separate cache key from family:0');
    assert.equal(sys.calls[1].options.family, 4, 'the family option reaches the system resolver');
  });

  test('literal IPs and localhost bypass the cache and go straight to the system lookup', async () => {
    const clock = fakeClock();
    const sys = scriptedLookup([[{ address: '127.0.0.1', family: 4 }], [{ address: '127.0.0.1', family: 4 }]]);
    const r = createResilientLookup({ lookup: sys.fn, ...clock, log: () => {} });
    await lookupOnce(r, 'localhost', {});
    await lookupOnce(r, 'localhost', {});
    assert.equal(sys.calls.length, 2);
    assert.equal(r.cacheSize(), 0);
  });

  test('a fresh cache hit also calls back asynchronously', async () => {
    const clock = fakeClock();
    const sys = scriptedLookup([[{ address: '69.46.46.59', family: 4 }]]);
    const r = createResilientLookup({ lookup: sys.fn, ...clock, log: () => {} });
    await lookupOnce(r, 'api.natively.software', {});
    let sync = true; let fired = false;
    r.lookup('api.natively.software', {}, () => { fired = true; assert.equal(sync, false, 'fired synchronously from a cache hit'); });
    sync = false;
    await tick();
    assert.equal(fired, true);
  });

  test('callback-only signature (no options) is accepted', async () => {
    const clock = fakeClock();
    const sys = scriptedLookup([[{ address: '69.46.46.59', family: 4 }]]);
    const r = createResilientLookup({ lookup: sys.fn, ...clock, log: () => {} });
    const out = await new Promise((resolve) => r.lookup('api.natively.software', (err, address, family) => resolve({ err, address, family })));
    assert.equal(out.address, '69.46.46.59'); assert.equal(out.family, 4);
  });
});
