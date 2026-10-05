// electron/rag/__tests__/probeError.test.mjs
//
// Covers electron/rag/providers/probeError.ts — masking anything credential
// shaped out of text, and turning an embedding-probe failure into a one-line
// log description (status / name / code / message / cause).
//
// Runs against the compiled output in dist-electron/.
// Run: node --test electron/rag/__tests__/probeError.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { maskCredentials, describeProbeError } = require(
  path.join(repoRoot, 'dist-electron/electron/rag/providers/probeError.js'),
);

// Assembled at runtime so no credential-looking literal sits in the repo.
const secret = (prefix, body = 'Zq8Lm2Xw9Kp4') => `${prefix}${body}`;

describe('maskCredentials — prefixed API keys', () => {
  test('masks every known provider key prefix and keeps the prefix for diagnosis', () => {
    const prefixes = ['sk-', 'sk-or-', 'sk-ant-', 'sk-proj-', 'natively_sk_', 'pa-', 'AIza', 'gsk_', 'xai-', 'jina_', 'hf_', 'nvapi-', 'r8_', 'pplx-'];
    for (const prefix of prefixes) {
      const key = secret(prefix);
      const out = maskCredentials(`Incorrect API key provided: ${key}. Check your key.`);
      assert.equal(out, `Incorrect API key provided: ${prefix}…. Check your key.`, prefix);
      assert.ok(!out.includes('Zq8Lm2Xw9Kp4'), prefix);
    }
  });

  test('masks a key glued to an underscore-joined field name', () => {
    assert.equal(maskCredentials(`x_api_key_${secret('sk-')}`), 'x_api_key_sk-…');
  });

  test('masks every key in the text, not just the first', () => {
    const out = maskCredentials(`${secret('sk-', 'aaaaaa111')} then ${secret('gsk_', 'bbbbbb222')}`);
    assert.equal(out, 'sk-… then gsk_…');
  });

  test('a prefix followed by fewer than six key characters is left alone', () => {
    assert.equal(maskCredentials('sk-abc is not a key'), 'sk-abc is not a key');
    assert.equal(maskCredentials('hf_ab'), 'hf_ab');
  });
});

describe('maskCredentials — authorization schemes and tokens', () => {
  test('masks Bearer, Basic and Token credentials, keeping the scheme as written', () => {
    assert.equal(maskCredentials('Authorization: Bearer abc.DEF-123_xyz'), 'Authorization: Bearer …');
    assert.equal(maskCredentials('header was basic dXNlcjpwYXNzd29yZA=='), 'header was basic …');
    assert.equal(maskCredentials('TOKEN abcdefgh'), 'TOKEN …');
  });

  test('a scheme word followed by a short ordinary word is not treated as a credential', () => {
    assert.equal(maskCredentials('Bearer token missing'), 'Bearer token missing');
    assert.equal(maskCredentials('basic auth failed'), 'basic auth failed');
  });

  test('masks a bare JWT', () => {
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'sflKxwRJSMeKKF2QT4'].join('.');
    assert.equal(maskCredentials(`session ${jwt} was rejected`), 'session eyJ… was rejected');
  });

  test('a JWT sent as a Bearer credential is removed entirely', () => {
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'sflKxwRJSMeKKF2QT4'].join('.');
    assert.equal(maskCredentials(`Authorization: Bearer ${jwt}`), 'Authorization: Bearer …');
  });

  test('masks an unprefixed 32+ character token that mixes letters and digits', () => {
    const hex = 'a1b2c3d4'.repeat(4);
    assert.equal(hex.length, 32);
    assert.equal(maskCredentials(`key=${hex} rejected`), 'key=… rejected');
    assert.equal(maskCredentials(`${'Ab3_-x'.repeat(8)}`), '…');
  });

  test('a 31 character mixed token is below the bar and survives', () => {
    const short = 'a1b2c3d4'.repeat(4).slice(0, 31);
    assert.equal(maskCredentials(`id ${short}`), `id ${short}`);
  });

  test('long runs of only letters or only digits are not tokens', () => {
    const letters = 'abcdefgh'.repeat(5);
    const digits = '12345678'.repeat(5);
    assert.equal(maskCredentials(letters), letters);
    assert.equal(maskCredentials(digits), digits);
  });
});

describe('maskCredentials — ordinary text', () => {
  test('leaves normal error messages untouched', () => {
    for (const text of [
      '',
      'fetch failed',
      'connect ECONNREFUSED 127.0.0.1:20128',
      'Request failed with status code 503 (auth_unavailable)',
      'getaddrinfo ENOTFOUND api.example.com',
      'model text-embedding-3-small not found',
    ]) {
      assert.equal(maskCredentials(text), text, text);
    }
  });

  test('is stable across repeated calls (global regexes keep no state)', () => {
    const text = `bad key ${secret('sk-')}`;
    const first = maskCredentials(text);
    assert.equal(maskCredentials(text), first);
    assert.equal(maskCredentials(text), first);
    assert.equal(first, 'bad key sk-…');
  });

  test('masking is idempotent', () => {
    const once = maskCredentials(`Bearer abcdefgh12345678 and ${secret('pplx-')}`);
    assert.equal(maskCredentials(once), once);
  });
});

describe('describeProbeError', () => {
  test('a plain Error is described by its message alone', () => {
    assert.equal(describeProbeError(new Error('model not loaded')), 'model not loaded');
  });

  test('a non-generic error name is included before the message', () => {
    assert.equal(describeProbeError(new TypeError('fetch failed')), 'TypeError · fetch failed');
  });

  test('missing errors are "unknown error"', () => {
    assert.equal(describeProbeError(undefined), 'unknown error');
    assert.equal(describeProbeError(null), 'unknown error');
  });

  test('a thrown string or number is used as the message', () => {
    assert.equal(describeProbeError('socket hang up'), 'socket hang up');
    assert.equal(describeProbeError(429), '429');
  });

  test('parts appear in the order status, name, code, message, cause', () => {
    const err = Object.assign(new TypeError('fetch failed'), { status: 503, code: 'auth_unavailable', cause: { code: 'ECONNRESET' } });
    assert.equal(describeProbeError(err), 'HTTP 503 · TypeError · auth_unavailable · fetch failed · cause: ECONNRESET');
  });

  test('an SDK-style plain object with status and message', () => {
    assert.equal(describeProbeError({ status: 401, message: 'Unauthorized' }), 'HTTP 401 · Unauthorized');
  });

  test('a missing or zero status is omitted', () => {
    assert.equal(describeProbeError({ status: 0, message: 'nope' }), 'nope');
    assert.equal(describeProbeError({ status: undefined, message: 'nope' }), 'nope');
  });

  test('the fetch cause distinguishes DNS, refused and TLS failures', () => {
    const fetchFailed = (cause) => Object.assign(new TypeError('fetch failed'), { cause });
    assert.equal(describeProbeError(fetchFailed({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND host' })), 'TypeError · fetch failed · cause: ENOTFOUND');
    assert.equal(describeProbeError(fetchFailed(new Error('self-signed certificate'))), 'TypeError · fetch failed · cause: self-signed certificate');
    assert.equal(describeProbeError(fetchFailed('connection refused')), 'TypeError · fetch failed · cause: connection refused');
  });

  test('no cause part when there is no cause', () => {
    assert.doesNotMatch(describeProbeError(new TypeError('fetch failed')), /cause/);
    assert.doesNotMatch(describeProbeError(Object.assign(new Error('x'), { cause: null })), /cause/);
  });

  test('credentials are masked in the message, code, name and cause', () => {
    const key = secret('sk-proj-');
    const err = Object.assign(new Error(`401 Incorrect API key provided: ${key}`), {
      status: 401,
      code: `invalid_${key}`,
      cause: new Error(`upstream rejected Bearer ${key}`),
    });
    err.name = `AuthError_${key}`;
    const out = describeProbeError(err);
    assert.ok(!out.includes('Zq8Lm2Xw9Kp4'), out);
    assert.equal(out, 'HTTP 401 · AuthError_sk-proj-… · invalid_sk-proj-… · 401 Incorrect API key provided: sk-proj-… · cause: upstream rejected Bearer …');
  });

  test('the message is capped at 200 characters', () => {
    const out = describeProbeError(new Error('e'.repeat(500)));
    assert.equal(out, 'e'.repeat(200));
  });

  test('name and code are capped at 40 characters, the cause at 80', () => {
    const err = Object.assign(new Error('m'), { code: 'c'.repeat(100), cause: { code: 'k'.repeat(200) } });
    err.name = 'n'.repeat(100);
    assert.equal(describeProbeError(err), ['n'.repeat(40), 'c'.repeat(40), 'm', `cause: ${'k'.repeat(80)}`].join(' · '));
  });

  test('masking happens before truncation, so a key straddling the cut is never half-printed', () => {
    const key = secret('sk-', 'Qw3rTy7UiOp9AsDf5GhJk1');
    const err = new Error(`${'x'.repeat(190)} ${key}`);
    const out = describeProbeError(err);
    assert.ok(out.length <= 200);
    assert.ok(!out.includes('Qw3r'), out);
    assert.ok(out.endsWith(' sk-…'));
  });
});
