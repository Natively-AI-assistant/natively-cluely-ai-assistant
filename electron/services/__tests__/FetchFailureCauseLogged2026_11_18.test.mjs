// A network failure names its cause in the log (2026-11-18, issue #759).
//
// Node's fetch throws "TypeError: fetch failed" for DNS, TLS and reset
// failures alike and puts the reason on `cause`. The debug log printed only
// the stack, so a customer's certificate failure read exactly like being
// offline, and on this machine a DNS outage read the same way
// ("[CalendarManager] ... TypeError: fetch failed", once a minute).
//
// Run with: npm run build:electron && node --test electron/services/__tests__/FetchFailureCauseLogged2026_11_18.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProEntitlementReconciler } from '../ProEntitlementReconciler.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (rel) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', rel)).href;
const { redactForLog } = await import(dist('utils/redactForLog.js'));
const { NativelyEmbeddingProvider } = await import(dist('rag/providers/NativelyEmbeddingProvider.js'));

function fetchFailed(cause) {
  return new TypeError('fetch failed', { cause });
}
const certExpired = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });

describe('redactForLog keeps the cause of an error', () => {
  test('on the first line of a logged error, before the stack frames', () => {
    const line = redactForLog(['[CalendarManager] failed:', fetchFailed(certExpired)]);
    const first = line.split('\n')[0];
    assert.equal(first, '[CalendarManager] failed: TypeError: fetch failed (cause: CERT_HAS_EXPIRED certificate has expired)');
  });

  test('a code already in the message is not repeated', () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND api.natively.software'), { code: 'ENOTFOUND' });
    assert.match(redactForLog([fetchFailed(dns)]), /^TypeError: fetch failed \(cause: getaddrinfo ENOTFOUND api\.natively\.software\)/);
  });

  test('a nested cause chain is followed', () => {
    const inner = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const outer = new Error('request failed', { cause: fetchFailed(inner) });
    assert.match(redactForLog([outer]), /\(cause: fetch failed <- ECONNRESET socket hang up\)/);
  });

  test('an error inside an object gets a cause field', () => {
    const parsed = JSON.parse(redactForLog([{ err: fetchFailed(certExpired) }]));
    assert.equal(parsed.err.cause, 'CERT_HAS_EXPIRED certificate has expired');
    assert.equal(parsed.err.message, 'fetch failed');
  });

  test('an error without a cause is written exactly as before', () => {
    const err = new Error('plain');
    assert.equal(redactForLog([err]), err.stack);
    assert.equal('cause' in JSON.parse(redactForLog([{ err }])).err, false);
  });

  test('a credential inside a cause is still masked', () => {
    const leaky = new Error('rejected key sk-abcdefghijklmnopqrstuvwxyz0123456789');
    assert.doesNotMatch(redactForLog([fetchFailed(leaky)]), /abcdefghijklmnopqrstuvwxyz0123456789/);
    assert.doesNotMatch(redactForLog([{ err: fetchFailed(leaky) }]), /abcdefghijklmnopqrstuvwxyz0123456789/);
  });
});

describe('a cause that misbehaves never breaks logging', () => {
  test('a throwing cause getter logs the error without it', () => {
    const err = new TypeError('fetch failed');
    Object.defineProperty(err, 'cause', { get() { throw new Error('boom'); } });
    assert.equal(redactForLog(['x', err]), `x ${err.stack}`);
  });

  test('a very long cause message is capped', () => {
    const line = redactForLog([fetchFailed(new Error('y'.repeat(10_000)))]).split('\n')[0];
    assert.ok(line.length < 400, `first line was ${line.length} chars`);
  });
});

describe('the Natively embedding probe keeps the transport cause', () => {
  async function failWith(thrown) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw thrown; };
    try {
      await new NativelyEmbeddingProvider('nk_test_key', { baseUrl: 'https://embed.invalid' }).embed('x');
      return null;
    } catch (err) {
      return err;
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  test('a TLS failure carries its code', async () => {
    const err = await failWith(fetchFailed(certExpired));
    assert.equal(err.message, 'Natively embedding request failed');
    assert.equal(err.cause?.code, 'CERT_HAS_EXPIRED');
  });

  test('a timeout is reported as a timeout, with no numeric DOMException code as its "cause"', async () => {
    const err = await failWith(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    assert.equal(err.message, 'Natively embedding request timed out');
    assert.equal(err.cause, undefined);
  });
});

describe('the Pro reconciler reports why the plan lookup failed', () => {
  test('the cause code reaches the retry status, not just "fetch failed"', async () => {
    const reasons = [];
    const r = createProEntitlementReconciler({
      getApiKey: () => 'natively_sk_test',
      isTrialKey: () => false,
      isPremium: () => false,
      fetchPlan: async () => { throw fetchFailed(certExpired); },
      activate: async () => ({ success: true }),
      onActivated: () => {},
      onStatus: (s) => { if (s.lastError) reasons.push(s.lastError); },
      schedule: () => () => {},
      now: () => 0,
      log: { log() {}, warn() {} },
    });
    assert.equal(await r.run('startup'), 'retrying');
    assert.deepEqual(reasons, ['plan lookup failed: fetch failed (CERT_HAS_EXPIRED)']);
  });
});
