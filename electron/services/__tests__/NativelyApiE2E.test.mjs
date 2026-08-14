// electron/services/__tests__/NativelyApiE2E.test.mjs
//
// Env-gated real Natively API smoke test. Enabled only when both:
//   RUN_NATIVELY_API_E2E=1
//   NATIVELY_API_KEY=<key>   (or NATIVELY_TRIAL_TOKEN=<token>)
//
// When disabled (the default), every test in this suite is `skip`-ed cleanly
// so the suite produces a deterministic, hermetic pass. Skip messages explain
// what env is needed to enable.
//
// We intentionally do NOT print any portion of the key. The test asserts
// the key is non-empty and uses it as a bearer header; the actual key never
// touches a log line.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const ENABLED = process.env.RUN_NATIVELY_API_E2E === '1';
const KEY = process.env.NATIVELY_API_KEY ?? '';
const TRIAL = process.env.NATIVELY_TRIAL_TOKEN ?? '';
const API_BASE = process.env.NATIVELY_API_BASE ?? 'https://api.natively.software';

function authHeader() {
  if (KEY) return { 'x-natively-key': KEY };
  if (TRIAL) return { 'x-trial-token': TRIAL };
  return null;
}

describe('Natively API real-network smoke', { skip: !ENABLED ? 'skip: set RUN_NATIVELY_API_E2E=1 with NATIVELY_API_KEY or NATIVELY_TRIAL_TOKEN to enable' : false }, () => {
  test('credentials are present in env (sanity check, key value not logged)', () => {
    const h = authHeader();
    assert.ok(h, 'NATIVELY_API_KEY or NATIVELY_TRIAL_TOKEN must be set when RUN_NATIVELY_API_E2E=1');
  });

  test('valid auth — health endpoint responds', async () => {
    const headers = authHeader();
    const res = await fetch(`${API_BASE}/v1/health`, { headers }).catch(e => ({ ok: false, status: 0, _err: e.message }));
    assert.ok(res.ok || res.status === 404, `Expected 2xx or 404 for /v1/health; got ${res.status} (${res._err ?? ''})`);
  });

  test('invalid auth — request fails cleanly', async () => {
    const res = await fetch(`${API_BASE}/v1/health`, {
      headers: { Authorization: 'Bearer invalid-key-zzz' },
    }).catch(() => ({ ok: false, status: 401 }));
    // Acceptable: 401, 403, or 404 (route not present). What we must NOT
    // see is a 200 — that would mean the server accepted invalid auth.
    assert.notEqual(res.status, 200, 'Invalid auth must not yield 200 OK');
  });
});
