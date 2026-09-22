// A failed embedding probe must say WHY (2026-09-19). Measured on a live
// instance: natively /v1/embed answered 503 auth_unavailable for minutes; the
// startup probe printed "probe 1/3 failed", the session was demoted to the
// bundled model (new uploads left lexical_only, every query lexical), and the
// re-probe announced at boot failed once a minute in total silence. Neither
// the status nor the message reached the log — `isAvailable()` returned a bare
// false and the re-probe was `catch { return false }`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { NativelyEmbeddingProvider, describeProbeError } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag/providers/NativelyEmbeddingProvider.js')).href);

const captureWarn = async (fn) => {
  const lines = []; const orig = console.warn; console.warn = (...a) => lines.push(a.join(' '));
  try { return { result: await fn(), lines }; } finally { console.warn = orig; }
};

describe('describeProbeError', () => {
  test('status, code and message — and nothing else', () => {
    const e = Object.assign(new Error('Natively embedding failed: 503 Service Unavailable (auth_unavailable)'), { status: 503, headers: { authorization: 'Bearer sk-secret' }, apiKey: 'sk-secret' });
    const out = describeProbeError(e);
    assert.match(out, /HTTP 503/);
    assert.match(out, /auth_unavailable/);
    assert.ok(!out.includes('sk-secret'), out);
  });
  test('a non-Error and an over-long message are handled', () => {
    assert.equal(describeProbeError('boom'), 'boom');
    // Credential shapes the first mask missed (review finding) — none may survive.
    for (const secret of ['Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop', 'jina_0123456789abcdefABCDEF', 'hf_abcdefghijklmnopqrstuv', 'nvapi-ABCDEFGH12345678', 'x_api_key_sk-abcdef123456789', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08']) {
      const out = describeProbeError(Object.assign(new Error(`401 invalid key ${secret} for request`), { code: secret }));
      assert.ok(!out.includes(secret.replace(/^Bearer /, '').slice(-12)), `leaked: ${out}`);
    }
    // Node's fetch hides the reason on `cause`; without it DNS and refused connections look the same.
    assert.match(describeProbeError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })), /ECONNREFUSED/);
    assert.ok(describeProbeError(new Error('x'.repeat(5000))).length <= 220);
  });
});

describe('NativelyEmbeddingProvider.isAvailable', () => {
  test('a transient failure still answers false, but the reason is logged', async () => {
    const p = new NativelyEmbeddingProvider('nat_live_testkey');
    p.embed = async () => { throw Object.assign(new Error('Natively embedding failed: 503 Service Unavailable (auth_unavailable)'), { status: 503 }); };
    const { result, lines } = await captureWarn(() => p.isAvailable());
    assert.equal(result, false);
    assert.ok(lines.some((l) => /availability probe failed: HTTP 503 .*auth_unavailable/.test(l)), lines.join('\n'));
    assert.ok(!lines.some((l) => l.includes('nat_live_testkey')), 'the key must never be logged');
  });
  test('a permanent auth failure is still thrown to the resolver, unlogged here', async () => {
    const p = new NativelyEmbeddingProvider('nat_live_testkey');
    p.embed = async () => { throw Object.assign(new Error('401'), { status: 401, permanentAuthFailure: true }); };
    await assert.rejects(() => p.isAvailable(), /401/);
  });
});

describe('every hosted provider says why its probe failed', () => {
  const load = (f) => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag/providers', f)).href);
  const CASES = [
    ['VoyageEmbeddingProvider.js', 'VoyageEmbeddingProvider', (C) => new C({ apiKey: 'pa-testkey12345678', model: 'voyage-4', dimensions: 1024 })],
    ['OpenRouterEmbeddingProvider.js', 'OpenRouterEmbeddingProvider', (C) => new C({ apiKey: 'sk-or-testkey12345678', model: 'voyageai/voyage-4', dimensions: 1024 })],
    ['OpenAIEmbeddingProvider.js', 'OpenAIEmbeddingProvider', (C) => new C('sk-testkey12345678')],
    ['GeminiEmbeddingProvider.js', 'GeminiEmbeddingProvider', (C) => new C('AIzaTestKey12345678')],
  ];
  for (const [file, name, make] of CASES) {
    test(`${name}: false + a logged reason, key masked`, async () => {
      const mod = await load(file);
      const p = make(mod[name]);
      p.embed = async () => { throw Object.assign(new Error('429 Too Many Requests for key sk-or-leakedsecret99887766'), { status: 429 }); };
      const { result, lines } = await captureWarn(() => p.isAvailable());
      assert.equal(result, false);
      assert.ok(lines.some((l) => /availability probe failed: HTTP 429/.test(l)), lines.join('\n') || '(nothing logged)');
      assert.ok(!lines.join('\n').includes('leakedsecret'), 'a key-like token in the message must be masked');
    });
  }
  test('describeProbeError masks key-shaped tokens from any vendor', () => {
    for (const k of ['sk-abcdef123456', 'sk-or-abcdef123456', 'natively_sk_abcdef123456', 'pa-abcdef123456', 'AIzaabcdef123456', 'gsk_abcdef123456']) {
      const out = describeProbeError(new Error(`bad key ${k} rejected`));
      assert.ok(!out.includes('abcdef123456'), `${k} leaked: ${out}`);
    }
  });
});
