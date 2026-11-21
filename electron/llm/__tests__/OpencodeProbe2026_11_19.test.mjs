/**
 * Connection probe.
 *
 * The probe's whole reason to exist: `GET /inference/v1/models` answers 200
 * WITHOUT a key, so a GET-only connection test green-lights an empty
 * credential. These cases pin the second, POST leg — and the 403 discriminator,
 * which otherwise reads like a dead key.
 *
 * Failure MESSAGES live in OpencodeFailureMessage2026_11_19.test.mjs.
 *
 * Run: node --test electron/llm/__tests__/OpencodeProbe2026_11_19.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const { probeOpencode } = require(dist('llm/opencode/probe.js'));

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

describe('probeOpencode', () => {
  test('no key → unconfigured, before any network call', async () => {
    let called = false;
    const r = await probeOpencode('', { fetchImpl: async () => { called = true; return json({}); } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unconfigured');
    assert.equal(called, false);
  });

  test('catalogue 401 → auth', async () => {
    const r = await probeOpencode('bad', {
      fetchImpl: async () => json({ error: { message: 'invalid key' } }, 401),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'auth');
    assert.match(r.error, /invalid key|rejected/i);
  });

  test('catalogue 403 → auth with the service-account hint', async () => {
    const r = await probeOpencode('svc', {
      fetchImpl: async () => json({ error: { message: 'missing scope' } }, 403),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'auth');
    assert.match(r.error, /Models › Read|rejected|scope/i);
  });

  test('catalogue 200 + POST 400 (unroutable id) → the key works', async () => {
    const calls = [];
    const r = await probeOpencode('good', {
      fetchImpl: async (url) => {
        calls.push(String(url));
        return calls.length === 1
          ? json({ object: 'list', data: [] })
          : json({ error: { message: 'model not found' } }, 400);
      },
    });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 2, 'a GET-only probe is the false green this test exists to prevent');
    assert.match(calls[1], /\/openai\/v1\/chat\/completions$/);
  });

  test('catalogue 200 + POST 401 → auth (the key never reached validation)', async () => {
    let n = 0;
    const r = await probeOpencode('bad', {
      fetchImpl: async () => (++n === 1 ? json({ data: [] }) : json({ error: { message: 'bad key' } }, 401)),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'auth');
  });

  test('catalogue 200 + POST 403 → billing, not auth', async () => {
    let n = 0;
    const r = await probeOpencode('broke', {
      fetchImpl: async () => (++n === 1 ? json({ data: [] }) : json({ error: { message: 'no balance' } }, 403)),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'billing');
  });

  test('transport failure → unreachable, never "bad key"', async () => {
    const r = await probeOpencode('k', {
      fetchImpl: async () => { throw new Error('ENOTFOUND'); },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unreachable');
  });

  test('catalogue 5xx → unreachable, not a green light', async () => {
    const r = await probeOpencode('k', { fetchImpl: async () => json({}, 503) });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unreachable');
    assert.equal(r.status, 503);
  });
});
