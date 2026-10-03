// Unit tests for electron/audio/dnsHelpers.ts — ipv4OnlyLookup (IPv4-pinned
// resolver with a 60 s cache, a dns.resolve4 fallback and stale-on-error) and
// streamingStttWsOptions (the standard `ws` options for streaming STT).
//
// No real DNS: dnsHelpers has no injection seam, so node's `dns.lookup` /
// `dns.resolve4` and `Date.now` are replaced per test with node:test mocks
// (restored automatically). The module's cache is process-wide, so every test
// uses its own hostname.
//
// Loads the compiled CommonJS output from dist-electron/ (build first).
// Run from the repo root:
//   node --test electron/audio/__tests__/DnsHelpers.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const dns = require('node:dns');
const { ipv4OnlyLookup, streamingStttWsOptions } = require(
  path.join(repoRoot, 'dist-electron', 'electron', 'audio', 'dnsHelpers.js'),
);

const TTL_MS = 60_000;
const T0 = 1_700_000_000_000;

function enotfound(host) {
  const e = new Error(`getaddrinfo ENOTFOUND ${host}`);
  e.code = 'ENOTFOUND';
  return e;
}

/**
 * Replace dns.lookup / dns.resolve4 / Date.now for one test.
 * `lookup` and `resolve4` are `(hostname) => string | string[] | Error`.
 */
function fakeDns(t, { lookup, resolve4 } = {}) {
  const clock = { now: T0 };
  t.mock.method(Date, 'now', () => clock.now);
  const lookupMock = t.mock.method(dns, 'lookup', (hostname, options, cb) => {
    const r = lookup ? lookup(hostname) : enotfound(hostname);
    if (r instanceof Error) cb(r);
    else cb(null, r, 4);
  });
  const resolve4Mock = t.mock.method(dns, 'resolve4', (hostname, cb) => {
    const r = resolve4 ? resolve4(hostname) : enotfound(hostname);
    if (r instanceof Error) cb(r);
    else cb(null, r);
  });
  return { clock, lookupMock, resolve4Mock };
}

/** Promise wrapper that resolves with the raw callback arguments. */
function lookupArgs(hostname, options) {
  return new Promise((resolve) => {
    if (options === undefined) ipv4OnlyLookup(hostname, (...args) => resolve(args));
    else ipv4OnlyLookup(hostname, options, (...args) => resolve(args));
  });
}

describe('streamingStttWsOptions', () => {
  test('defaults: IPv4 lookup, family 4, 15 s handshake timeout', () => {
    const opts = streamingStttWsOptions();
    assert.deepEqual(Object.keys(opts).sort(), ['family', 'handshakeTimeout', 'lookup']);
    assert.equal(opts.lookup, ipv4OnlyLookup);
    assert.equal(opts.family, 4);
    assert.equal(opts.handshakeTimeout, 15000);
  });

  test('extra options are merged in alongside the defaults', () => {
    const headers = { Authorization: 'Bearer x' };
    const opts = streamingStttWsOptions({ headers, perMessageDeflate: false });
    assert.equal(opts.headers, headers);
    assert.equal(opts.perMessageDeflate, false);
    assert.equal(opts.lookup, ipv4OnlyLookup);
    assert.equal(opts.family, 4);
    assert.equal(opts.handshakeTimeout, 15000);
  });

  test('extra options override the defaults', () => {
    const opts = streamingStttWsOptions({ handshakeTimeout: 5000 });
    assert.equal(opts.handshakeTimeout, 5000);
    assert.equal(opts.family, 4);
  });

  test('an empty or missing extra is fine and each call returns a fresh object', () => {
    assert.deepEqual(streamingStttWsOptions({}), streamingStttWsOptions());
    assert.deepEqual(streamingStttWsOptions(undefined), streamingStttWsOptions());
    const a = streamingStttWsOptions();
    const b = streamingStttWsOptions();
    assert.notEqual(a, b);
    a.family = 6;
    assert.equal(streamingStttWsOptions().family, 4);
  });

  test('does not mutate the extra object', () => {
    const extra = { headers: { a: 1 } };
    streamingStttWsOptions(extra);
    assert.deepEqual(extra, { headers: { a: 1 } });
  });
});

describe('ipv4OnlyLookup — primary dns.lookup path', () => {
  test('resolves via dns.lookup with family forced to 4', async (t) => {
    const { lookupMock, resolve4Mock } = fakeDns(t, { lookup: () => '10.0.0.1' });
    const args = await lookupArgs('primary.test', {});
    assert.deepEqual(args, [null, '10.0.0.1', 4]);
    assert.equal(lookupMock.mock.callCount(), 1);
    assert.equal(lookupMock.mock.calls[0].arguments[0], 'primary.test');
    assert.equal(lookupMock.mock.calls[0].arguments[1].family, 4);
    assert.equal(resolve4Mock.mock.callCount(), 0, 'no fallback when lookup succeeds');
  });

  test('a caller-supplied family is overridden, other options are forwarded', async (t) => {
    const { lookupMock } = fakeDns(t, { lookup: () => '10.0.0.2' });
    const options = { family: 6, hints: 1024 };
    await lookupArgs('override.test', options);
    assert.deepEqual(lookupMock.mock.calls[0].arguments[1], { family: 4, hints: 1024 });
    assert.deepEqual(options, { family: 6, hints: 1024 }, 'caller options are not mutated');
  });

  test('supports the (hostname, callback) signature', async (t) => {
    const { lookupMock } = fakeDns(t, { lookup: () => '10.0.0.3' });
    const args = await lookupArgs('twoarg.test');
    assert.deepEqual(args, [null, '10.0.0.3', 4]);
    assert.deepEqual(lookupMock.mock.calls[0].arguments[1], { family: 4 });
  });
});

describe('ipv4OnlyLookup — cache', () => {
  test('a fresh entry is served without touching the resolver, asynchronously', async (t) => {
    const { clock, lookupMock, resolve4Mock } = fakeDns(t, { lookup: () => '10.0.1.1' });
    await lookupArgs('cached.test', {});
    assert.equal(lookupMock.mock.callCount(), 1);

    clock.now = T0 + TTL_MS - 1;
    let calledSync = true;
    const pending = new Promise((resolve) => {
      ipv4OnlyLookup('cached.test', {}, (...args) => resolve({ args, calledSync }));
    });
    calledSync = false;
    const { args, calledSync: wasSync } = await pending;
    assert.deepEqual(args, [null, '10.0.1.1', 4]);
    assert.equal(wasSync, false, 'cache hits must not call back synchronously');
    assert.equal(lookupMock.mock.callCount(), 1, 'resolver not consulted on a cache hit');
    assert.equal(resolve4Mock.mock.callCount(), 0);
  });

  test('a cache hit also works with the (hostname, callback) signature', async (t) => {
    const { lookupMock } = fakeDns(t, { lookup: () => '10.0.1.2' });
    await lookupArgs('cached-twoarg.test');
    assert.deepEqual(await lookupArgs('cached-twoarg.test'), [null, '10.0.1.2', 4]);
    assert.equal(lookupMock.mock.callCount(), 1);
  });

  test('the entry expires after 60 s and is re-resolved', async (t) => {
    let addr = '10.0.2.1';
    const { clock, lookupMock } = fakeDns(t, { lookup: () => addr });
    await lookupArgs('expiry.test', {});

    addr = '10.0.2.2';
    clock.now = T0 + TTL_MS;            // exactly at expiry -> no longer fresh
    assert.deepEqual(await lookupArgs('expiry.test', {}), [null, '10.0.2.2', 4]);
    assert.equal(lookupMock.mock.callCount(), 2);

    // The refreshed entry is fresh for another full TTL from the refresh time.
    addr = '10.0.2.3';
    clock.now = T0 + 2 * TTL_MS - 1;
    assert.deepEqual(await lookupArgs('expiry.test', {}), [null, '10.0.2.2', 4]);
    assert.equal(lookupMock.mock.callCount(), 2);
  });

  test('entries are per hostname', async (t) => {
    const { lookupMock } = fakeDns(t, {
      lookup: (h) => (h === 'host-a.test' ? '10.0.3.1' : '10.0.3.2'),
    });
    assert.deepEqual(await lookupArgs('host-a.test', {}), [null, '10.0.3.1', 4]);
    assert.deepEqual(await lookupArgs('host-b.test', {}), [null, '10.0.3.2', 4]);
    assert.equal(lookupMock.mock.callCount(), 2);
    assert.deepEqual(await lookupArgs('host-a.test', {}), [null, '10.0.3.1', 4]);
    assert.deepEqual(await lookupArgs('host-b.test', {}), [null, '10.0.3.2', 4]);
    assert.equal(lookupMock.mock.callCount(), 2);
  });
});

describe('ipv4OnlyLookup — dns.resolve4 fallback', () => {
  test('falls back to resolve4 when lookup fails, returning the first A record', async (t) => {
    const { lookupMock, resolve4Mock } = fakeDns(t, {
      resolve4: () => ['10.0.4.1', '10.0.4.2'],
    });
    const args = await lookupArgs('fallback.test', {});
    assert.deepEqual(args, [null, '10.0.4.1', 4]);
    assert.equal(lookupMock.mock.callCount(), 1);
    assert.equal(resolve4Mock.mock.callCount(), 1);
    assert.equal(resolve4Mock.mock.calls[0].arguments[0], 'fallback.test');
  });

  test('a resolve4 result is cached like a lookup result', async (t) => {
    const { lookupMock, resolve4Mock } = fakeDns(t, { resolve4: () => ['10.0.4.3'] });
    await lookupArgs('fallback-cached.test', {});
    assert.deepEqual(await lookupArgs('fallback-cached.test', {}), [null, '10.0.4.3', 4]);
    assert.equal(lookupMock.mock.callCount(), 1);
    assert.equal(resolve4Mock.mock.callCount(), 1);
  });
});

describe('ipv4OnlyLookup — total resolver failure', () => {
  test('with no cache entry the callback gets an ENOTFOUND error', async (t) => {
    const { lookupMock, resolve4Mock } = fakeDns(t);
    const args = await lookupArgs('nowhere.test', {});
    assert.equal(args.length, 1);
    assert.ok(args[0] instanceof Error);
    assert.equal(args[0].code, 'ENOTFOUND');
    assert.match(args[0].message, /nowhere\.test/);
    assert.equal(lookupMock.mock.callCount(), 1);
    assert.equal(resolve4Mock.mock.callCount(), 1);
  });

  test('an empty A-record list counts as a failure', async (t) => {
    fakeDns(t, { resolve4: () => [] });
    const [err] = await lookupArgs('empty-records.test', {});
    assert.ok(err instanceof Error);
    assert.equal(err.code, 'ENOTFOUND');
  });

  test('a failure is not cached: the next call resolves normally', async (t) => {
    let up = false;
    const { lookupMock } = fakeDns(t, { lookup: (h) => (up ? '10.0.5.1' : enotfound(h)) });
    const [err] = await lookupArgs('recovers.test', {});
    assert.equal(err.code, 'ENOTFOUND');
    up = true;
    assert.deepEqual(await lookupArgs('recovers.test', {}), [null, '10.0.5.1', 4]);
    assert.equal(lookupMock.mock.callCount(), 2);
  });

  test('an expired cache entry is served stale (with a warning) instead of failing', async (t) => {
    let up = true;
    const { clock, lookupMock, resolve4Mock } = fakeDns(t, {
      lookup: (h) => (up ? '10.0.6.1' : enotfound(h)),
    });
    const warn = t.mock.method(console, 'warn', () => {});
    await lookupArgs('stale.test', {});

    up = false;
    clock.now = T0 + TTL_MS + 5000;
    const args = await lookupArgs('stale.test', {});
    assert.deepEqual(args, [null, '10.0.6.1', 4]);
    assert.equal(lookupMock.mock.callCount(), 2, 'resolver was tried first');
    assert.equal(resolve4Mock.mock.callCount(), 1, 'fallback was tried too');
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0].arguments[0]), /stale\.test/);
    assert.match(String(warn.mock.calls[0].arguments[0]), /10\.0\.6\.1/);
  });

  test('serving stale does not refresh the entry: the resolver is retried next time', async (t) => {
    let up = true;
    let addr = '10.0.7.1';
    const { clock, lookupMock } = fakeDns(t, {
      lookup: (h) => (up ? addr : enotfound(h)),
    });
    t.mock.method(console, 'warn', () => {});
    await lookupArgs('stale-retry.test', {});

    up = false;
    clock.now = T0 + TTL_MS + 1;
    await lookupArgs('stale-retry.test', {});          // stale
    assert.equal(lookupMock.mock.callCount(), 2);

    up = true;
    addr = '10.0.7.2';
    clock.now += 1;
    assert.deepEqual(await lookupArgs('stale-retry.test', {}), [null, '10.0.7.2', 4]);
    assert.equal(lookupMock.mock.callCount(), 3);
  });
});
