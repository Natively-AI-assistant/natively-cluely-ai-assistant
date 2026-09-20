/**
 * Test Connection for 9Router must be a POST.
 *
 * Every other gateway's connection test is `GET /v1/models`
 * (FluxionProvider2026_09_18.test.mjs:410-440). Against a real 9Router that is
 * a FALSE GREEN, verified live on 2026-09-20:
 *
 *   GET  /api/health          -> 200 {"ok":true}          no key
 *   GET  /v1/models           -> 200, 47 models           no key
 *   POST /v1/chat/completions -> 401 "Missing API key"    key REQUIRED
 *   POST /v1/embeddings       -> 401 "Missing API key"    key REQUIRED
 *
 * So a GET-based test passes with an empty key on an instance that cannot
 * answer a single question — the shape recorded in
 * elevenlabs-probe-false-green-2026-09-09, where a probe that fired on connect
 * rather than on work green-lit four spent keys.
 *
 * `POST /v1/messages/count_tokens` is NOT an alternative: it answered 200
 * unauthenticated too.
 *
 * The probe therefore POSTs a deliberately invalid model id. Auth is evaluated
 * BEFORE model validation — proven live, since a POST of `{}` carrying no
 * `model` at all still returns 401 rather than a validation error. So:
 *   401 -> the key is missing or wrong
 *   400 -> the key was accepted and the request reached model validation
 * and nothing is spent upstream, because no real model is ever named.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { probeNinerouter, NINEROUTER_PROBE_MODEL } =
  require(path.join(__dirname, '../../../dist-electron/electron/llm/ninerouterProbe.js'));

/** Records every call so the test can assert on the REQUEST, not just the reply. */
function stubFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, headers: init?.headers || {}, body: init?.body });
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body ?? {},
      text: async () => JSON.stringify(reply.body ?? {}),
    };
  };
  return { fn, calls };
}

describe('the 9Router probe exercises an authenticated route', () => {
  test('it POSTs to /v1/chat/completions — never GETs /v1/models', async () => {
    const { fn, calls } = stubFetch({ status: 400, body: { error: { message: 'Invalid model format' } } });
    await probeNinerouter('http://localhost:20128/v1', 'sk-real', { fetchImpl: fn });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST',
      'a GET-based probe passes with no key at all — that is the false green this exists to stop');
    assert.match(calls[0].url, /\/v1\/chat\/completions$/);
    assert.equal(calls[0].headers['Authorization'], 'Bearer sk-real');
  });

  test('the probe model is deliberately invalid, so nothing is spent upstream', async () => {
    const { fn, calls } = stubFetch({ status: 400, body: {} });
    await probeNinerouter('http://localhost:20128/v1', 'sk-real', { fetchImpl: fn });

    const sent = JSON.parse(calls[0].body);
    assert.equal(sent.model, NINEROUTER_PROBE_MODEL);
    // If this ever became a real id, a Test Connection would bill the user's
    // upstream account every time they pressed the button.
    assert.ok(!sent.model.includes('/'),
      'a 9Router catalogue id is `alias/model`; the probe id must not look routable');
    assert.equal(sent.max_tokens, 1, 'even if it somehow routed, it must not generate');
  });
});

describe('the probe reports what actually happened', () => {
  test('401 is a key problem, not an unreachable instance', async () => {
    const { fn } = stubFetch({ status: 401, body: { error: { message: 'Missing API key', code: 'invalid_api_key' } } });
    const r = await probeNinerouter('http://localhost:20128/v1', '', { fetchImpl: fn });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'auth');
    assert.match(r.error, /key/i, 'the message must send the user to the dashboard, not to their network');
  });

  test('400 means the key was ACCEPTED — validation is downstream of auth', async () => {
    const { fn } = stubFetch({ status: 400, body: { error: { message: 'Invalid model format' } } });
    const r = await probeNinerouter('http://localhost:20128/v1', 'sk-real', { fetchImpl: fn });
    assert.equal(r.ok, true, 'reaching model validation proves the credential passed');
  });

  test('a keyless instance that accepts the request is reported working', async () => {
    // REQUIRE_API_KEY defaults to false in 9Router, so this is a normal local
    // install and must not be reported as broken.
    const { fn } = stubFetch({ status: 404, body: { error: { message: 'model not found' } } });
    const r = await probeNinerouter('http://localhost:20128/v1', '', { fetchImpl: fn });
    assert.equal(r.ok, true);
  });

  test('a refused connection is an unreachable instance, not a bad key', async () => {
    const { fn } = stubFetch(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    const r = await probeNinerouter('http://localhost:20128/v1', 'sk-real', { fetchImpl: fn });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unreachable');
    assert.match(r.error, /reach|running|start/i,
      'the user needs to be told their instance is not running, not that their key is wrong');
  });

  test('no base URL configured is not a network probe at all', async () => {
    const { fn, calls } = stubFetch({ status: 200, body: {} });
    const r = await probeNinerouter('   ', 'sk-real', { fetchImpl: fn });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unconfigured');
    assert.equal(calls.length, 0, 'an unconfigured provider must not hit the network');
  });
});

describe('the base URL the user pasted is accepted either way', () => {
  test('a root URL and a /v1 URL both reach /v1/chat/completions', async () => {
    for (const base of [
      'http://localhost:20128',
      'http://localhost:20128/',
      'http://localhost:20128/v1',
      'http://localhost:20128/v1/',
    ]) {
      const { fn, calls } = stubFetch({ status: 400, body: {} });
      await probeNinerouter(base, 'sk-real', { fetchImpl: fn });
      assert.equal(calls[0].url, 'http://localhost:20128/v1/chat/completions',
        `"${base}" must normalise to exactly one /v1`);
    }
  });
});
