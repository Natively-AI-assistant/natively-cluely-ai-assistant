// Phase 7/8 — resolveRelaySession + buildFallbackChain + per-channel cache.
//
// Loads the COMPILED relaySession.js (dist-electron) and drives it with an
// injected fetch so no network is touched. Covers:
//   - happy path → parsed RelaySessionConfig (snake_case → camelCase mapping)
//   - non-2xx → null
//   - timeout (AbortError) → null
//   - malformed JSON body → null
//   - 402 quota → null (discriminable log, no throw)
//   - the token NEVER appears in console output
//   - buildFallbackChain ordering + dedup + null-drop + null-config → [railway]
//   - cache get/set + 15s-skew expiry

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const rs = await import(path.join(distRoot, 'relaySession.js'));
const {
  resolveRelaySession,
  buildFallbackChain,
  getCachedSession,
  setCachedSession,
  clearCachedSession,
  clearAllCachedSessions,
  getHardcodedRailwayUrl,
} = rs;

const SECRET_TOKEN = 'v1.SUPERSECRETPAYLOAD.SUPERSECRETSIG';

function validServerResponse(overrides = {}) {
  return {
    session_id: 'st_abc123',
    session_token: SECRET_TOKEN,
    relay_ws_url: 'wss://us-relay.natively.software/ws',
    fallback_relay_ws_url: 'wss://asia-relay.natively.software/ws',
    railway_fallback_ws_url: 'wss://api.natively.software/v1/transcribe',
    selected_region: 'us',
    stt_config: {
      sample_rate: 16000,
      audio_channels: 1,
      language: 'en-US',
      language_alternates: ['en-GB'],
      channel: 'system',
    },
    limits: {
      max_sample_rate: 16000,
      max_channels: 1,
      allow_dual_stream: false,
      max_session_seconds: 14400,
      max_bytes_per_session: 0,
    },
    quota_remaining: 28800,
    expires_at: new Date(Date.now() + 180_000).toISOString(),
    ...overrides,
  };
}

function makeFetch({ status = 200, json, throwName } = {}) {
  return async (_url, _init) => {
    if (throwName) {
      const e = new Error('fetch failed');
      e.name = throwName;
      throw e;
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (typeof json === 'function') return json();
        return json;
      },
    };
  };
}

const baseOpts = {
  apiKey: 'natively_sk_test',
  channel: 'system',
  language: 'en-US',
  languageAlternates: ['en-GB'],
  sampleRate: 16000,
  audioChannels: 1,
  appVersion: '2.7.0',
  platform: 'mac',
  controlPlaneBaseUrl: 'https://api.natively.software',
};

test('resolveRelaySession happy path → parsed RelaySessionConfig (snake→camel)', async () => {
  const config = await resolveRelaySession({
    ...baseOpts,
    fetchImpl: makeFetch({ status: 200, json: validServerResponse() }),
  });
  assert.ok(config, 'expected a config on a valid 200 response');
  assert.equal(config.sessionId, 'st_abc123');
  assert.equal(config.sessionToken, SECRET_TOKEN);
  assert.equal(config.relayWsUrl, 'wss://us-relay.natively.software/ws');
  assert.equal(config.fallbackRelayWsUrl, 'wss://asia-relay.natively.software/ws');
  assert.equal(config.railwayFallbackWsUrl, 'wss://api.natively.software/v1/transcribe');
  assert.equal(config.selectedRegion, 'us');
  assert.equal(config.sttConfig.sampleRate, 16000);
  assert.equal(config.sttConfig.language, 'en-US');
  assert.deepEqual(config.sttConfig.languageAlternates, ['en-GB']);
  assert.equal(config.limits.maxSampleRate, 16000);
  assert.equal(config.limits.allowDualStream, false);
  assert.equal(config.limits.maxSessionSeconds, 14400);
  assert.equal(config.quotaRemaining, 28800);
  assert.ok(config.expiresAt > Date.now(), 'expiresAt should be parsed to a future epoch ms');
});

test('resolveRelaySession sends the correct request body (key, hints, channel)', async () => {
  let captured = null;
  const fetchSpy = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => validServerResponse() };
  };
  await resolveRelaySession({
    ...baseOpts,
    regionHint: 'us',
    latencyProbes: { us: 42, asia: 187 },
    fetchImpl: fetchSpy,
  });
  assert.equal(captured.url, 'https://api.natively.software/v1/stt/session');
  assert.equal(captured.body.key, 'natively_sk_test');
  assert.equal(captured.body.trial_token, undefined, 'paid key must not send trial_token');
  assert.equal(captured.body.region_hint, 'us');
  assert.deepEqual(captured.body.latency_probes, { us: 42, asia: 187 });
  assert.equal(captured.body.channel, 'system');
  assert.equal(captured.body.app_version, '2.7.0');
  assert.equal(captured.body.platform, 'mac');
  assert.equal(captured.body.sample_rate, 16000);
});

test('resolveRelaySession trial token path sends trial_token, not key', async () => {
  let captured = null;
  const fetchSpy = async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => validServerResponse() };
  };
  await resolveRelaySession({
    ...baseOpts,
    apiKey: undefined,
    trialToken: 'natively_trial_xyz',
    fetchImpl: fetchSpy,
  });
  assert.equal(captured.trial_token, 'natively_trial_xyz');
  assert.equal(captured.key, undefined, 'trial path must not send key');
});

test('resolveRelaySession non-2xx → null', async () => {
  const config = await resolveRelaySession({
    ...baseOpts,
    fetchImpl: makeFetch({ status: 500, json: { error: 'boom' } }),
  });
  assert.equal(config, null);
});

test('resolveRelaySession 401 auth → null', async () => {
  const config = await resolveRelaySession({
    ...baseOpts,
    fetchImpl: makeFetch({ status: 401, json: { error: 'key_not_found' } }),
  });
  assert.equal(config, null);
});

test('resolveRelaySession 402 quota → null (no throw)', async () => {
  const config = await resolveRelaySession({
    ...baseOpts,
    fetchImpl: makeFetch({ status: 402, json: { error: 'transcription_quota_exceeded', resets_at: 'x' } }),
  });
  assert.equal(config, null, '402 must collapse to null so the WS path surfaces the real quota error');
});

test('resolveRelaySession timeout (AbortError) → null', async () => {
  const config = await resolveRelaySession({
    ...baseOpts,
    timeoutMs: 50,
    fetchImpl: makeFetch({ throwName: 'AbortError' }),
  });
  assert.equal(config, null);
});

test('resolveRelaySession network error → null', async () => {
  const config = await resolveRelaySession({
    ...baseOpts,
    fetchImpl: makeFetch({ throwName: 'TypeError' }),
  });
  assert.equal(config, null);
});

test('resolveRelaySession malformed JSON → null', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200, json: async () => { throw new Error('Unexpected token'); },
  });
  const config = await resolveRelaySession({ ...baseOpts, fetchImpl });
  assert.equal(config, null);
});

test('resolveRelaySession missing session_token → null', async () => {
  const r = validServerResponse();
  delete r.session_token;
  const config = await resolveRelaySession({ ...baseOpts, fetchImpl: makeFetch({ json: r }) });
  assert.equal(config, null, 'a response with no token is unusable → null');
});

test('resolveRelaySession missing relay_ws_url → null', async () => {
  const r = validServerResponse();
  delete r.relay_ws_url;
  const config = await resolveRelaySession({ ...baseOpts, fetchImpl: makeFetch({ json: r }) });
  assert.equal(config, null);
});

test('resolveRelaySession no credential → null (never calls fetch)', async () => {
  let called = false;
  const config = await resolveRelaySession({
    ...baseOpts,
    apiKey: undefined,
    trialToken: undefined,
    fetchImpl: async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; },
  });
  assert.equal(config, null);
  assert.equal(called, false, 'must not POST without a credential');
});

test('the session token NEVER appears in console output', async () => {
  const origLog = console.log;
  const origWarn = console.warn;
  const captured = [];
  console.log = (...a) => captured.push(a.join(' '));
  console.warn = (...a) => captured.push(a.join(' '));
  try {
    // success path (logs region/expiry) + failure path (logs reason)
    await resolveRelaySession({ ...baseOpts, fetchImpl: makeFetch({ json: validServerResponse() }) });
    await resolveRelaySession({ ...baseOpts, fetchImpl: makeFetch({ status: 402, json: { error: 'q' } }) });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  const joined = captured.join('\n');
  assert.ok(!joined.includes(SECRET_TOKEN), `BUG: the session token leaked to logs:\n${joined}`);
});

// ── buildFallbackChain ──────────────────────────────────────────────────────

test('buildFallbackChain ordering: relay → alternate → railway', () => {
  const chain = buildFallbackChain({
    relayWsUrl: 'wss://us/ws',
    fallbackRelayWsUrl: 'wss://asia/ws',
    railwayFallbackWsUrl: 'wss://railway/ws',
  });
  assert.deepEqual(chain, ['wss://us/ws', 'wss://asia/ws', 'wss://railway/ws']);
});

test('buildFallbackChain drops null alternate', () => {
  const chain = buildFallbackChain({
    relayWsUrl: 'wss://us/ws',
    fallbackRelayWsUrl: null,
    railwayFallbackWsUrl: 'wss://railway/ws',
  });
  assert.deepEqual(chain, ['wss://us/ws', 'wss://railway/ws']);
});

test('buildFallbackChain dedups identical urls', () => {
  const chain = buildFallbackChain({
    relayWsUrl: 'wss://railway/ws',     // relay == railway (selected_region === railway)
    fallbackRelayWsUrl: null,
    railwayFallbackWsUrl: 'wss://railway/ws',
  });
  assert.deepEqual(chain, ['wss://railway/ws'], 'duplicate railway url must collapse to one entry');
});

test('buildFallbackChain(null) → [hardcoded railway]', () => {
  const chain = buildFallbackChain(null);
  assert.deepEqual(chain, [getHardcodedRailwayUrl()]);
});

// ── cache ────────────────────────────────────────────────────────────────────

test('cache get/set returns the same config while fresh', () => {
  clearAllCachedSessions();
  const cfg = { ...validServerResponseAsConfig(), expiresAt: Date.now() + 180_000 };
  setCachedSession('system', cfg);
  assert.equal(getCachedSession('system'), cfg);
  assert.equal(getCachedSession('mic'), null, 'cache is keyed by channel');
});

test('cache respects the 15s skew (expires 15s before expiresAt)', () => {
  clearAllCachedSessions();
  // expiresAt 10s from now → already inside the 15s skew → must be treated expired.
  const cfg = { ...validServerResponseAsConfig(), expiresAt: Date.now() + 10_000 };
  setCachedSession('system', cfg);
  assert.equal(getCachedSession('system'), null, 'config within 15s of expiry must not be served');
});

test('clearCachedSession evicts one channel only', () => {
  clearAllCachedSessions();
  const a = { ...validServerResponseAsConfig(), expiresAt: Date.now() + 180_000 };
  const b = { ...validServerResponseAsConfig(), expiresAt: Date.now() + 180_000 };
  setCachedSession('system', a);
  setCachedSession('mic', b);
  clearCachedSession('system');
  assert.equal(getCachedSession('system'), null);
  assert.equal(getCachedSession('mic'), b);
});

function validServerResponseAsConfig() {
  return {
    sessionId: 'st_x',
    sessionToken: SECRET_TOKEN,
    relayWsUrl: 'wss://us/ws',
    fallbackRelayWsUrl: 'wss://asia/ws',
    railwayFallbackWsUrl: 'wss://railway/ws',
    selectedRegion: 'us',
    sttConfig: { sampleRate: 16000, audioChannels: 1, language: 'en-US', languageAlternates: [], channel: 'system' },
    limits: { maxSampleRate: 16000, maxChannels: 1, allowDualStream: false, maxSessionSeconds: 14400, maxBytesPerSession: 0 },
    quotaRemaining: 1000,
    expiresAt: Date.now() + 180_000,
  };
}
