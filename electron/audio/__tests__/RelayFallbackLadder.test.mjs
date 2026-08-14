// Phase 7/8 — fallback ladder advance + the flag-OFF unchanged-behavior proof.
//
// The full WebSocket state machine is exercised by Phase 11 integration tests.
// Here we drive the EXTRACTED pure helpers that the ladder is built from
// (installTarget, connectUrl, maybeAdvanceTarget, forceAdvanceTarget) and
// assert target advancement relay → alternate → railway, token-fatal advance,
// and — critically — that with the flag OFF the resolver is never called and
// connect() dials BACKEND_URL with the legacy frame.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return { app: { getAppPath: () => '/tmp/x', isPackaged: false, isReady: () => false } };
  }
  return origLoad.apply(this, arguments);
};

const { NativelyProSTT } = await import(path.join(distRoot, 'NativelyProSTT.js'));

const RELAY_URL = 'wss://us-relay.natively.software/ws';
const ALT_URL = 'wss://asia-relay.natively.software/ws';
const RAILWAY_URL = 'wss://api.natively.software/v1/transcribe';

function makeConfig() {
  return {
    sessionId: 'st_1',
    sessionToken: 'v1.PAYLOAD.SIG',
    relayWsUrl: RELAY_URL,
    fallbackRelayWsUrl: ALT_URL,
    railwayFallbackWsUrl: RAILWAY_URL,
    selectedRegion: 'us',
    sttConfig: { sampleRate: 16000, audioChannels: 1, language: 'en-US', languageAlternates: [], channel: 'system' },
    limits: { maxSampleRate: 16000, maxChannels: 1, allowDualStream: false, maxSessionSeconds: 14400, maxBytesPerSession: 0 },
    quotaRemaining: 1000,
    expiresAt: Date.now() + 180_000,
  };
}

function flagsOn(overrides = {}) {
  return {
    isRelayEnabled: () => true,
    getForceRegion: () => null,
    isRailwayFallbackEnabled: () => true,
    getMaxSampleRate: () => 16000,
    getMaxChannels: () => 1,
    getAllowDualStream: () => false,
    ...overrides,
  };
}

function relayInstance(flags = flagsOn()) {
  const stt = new NativelyProSTT('natively_sk_paid', 'system', { appVersion: '2.7.0', platform: 'mac', flags });
  stt.installTarget(makeConfig());
  return stt;
}

test('installTarget builds a relay → alternate → railway chain; connectUrl starts at relay', () => {
  const stt = relayInstance();
  assert.deepEqual(stt.target.chain, [RELAY_URL, ALT_URL, RAILWAY_URL]);
  assert.equal(stt.connectUrl(), RELAY_URL);
  stt.removeAllListeners();
});

test('maybeAdvanceTarget advances only after 2 same-relay failures', () => {
  const stt = relayInstance();
  // 1st failure on relay → stays on relay (retry budget = 2)
  stt.maybeAdvanceTarget(RELAY_URL, 1006);
  assert.equal(stt.connectUrl(), RELAY_URL, 'first failure keeps the relay (same-url retry)');
  // 2nd failure → advance to alternate
  stt.maybeAdvanceTarget(RELAY_URL, 1006);
  assert.equal(stt.connectUrl(), ALT_URL, 'second relay failure advances to alternate');
  stt.removeAllListeners();
});

test('ladder walks relay → alternate → railway and then sticks on railway', () => {
  const stt = relayInstance();
  // Relay ×2
  stt.maybeAdvanceTarget(RELAY_URL, 1006);
  stt.maybeAdvanceTarget(RELAY_URL, 1006);
  assert.equal(stt.connectUrl(), ALT_URL);
  // Alternate ×2
  stt.maybeAdvanceTarget(ALT_URL, 1006);
  stt.maybeAdvanceTarget(ALT_URL, 1006);
  assert.equal(stt.connectUrl(), RAILWAY_URL);
  assert.equal(stt.target.onRailway, true, 'reaching railway sets the terminal flag');
  // Further failures on railway must NOT advance (no flap-back; nowhere to go)
  stt.maybeAdvanceTarget(RAILWAY_URL, 1006);
  stt.maybeAdvanceTarget(RAILWAY_URL, 1006);
  assert.equal(stt.connectUrl(), RAILWAY_URL, 'railway is the terminal rung — no further advance');
  stt.removeAllListeners();
});

test('maybeAdvanceTarget ignores a stale close for a non-head url', () => {
  const stt = relayInstance();
  // We are dialing RELAY (index 0). A close arriving for the alternate url is
  // stale (e.g. a previously-closed socket) and must not advance.
  stt.maybeAdvanceTarget(ALT_URL, 1006);
  stt.maybeAdvanceTarget(ALT_URL, 1006);
  assert.equal(stt.connectUrl(), RELAY_URL, 'stale close for a non-head url must not advance the ladder');
  stt.removeAllListeners();
});

test('forceAdvanceTarget (token-fatal on relay) advances immediately, skipping the ×2 budget', () => {
  const stt = relayInstance();
  stt.forceAdvanceTarget(RELAY_URL, 'token_fatal');
  assert.equal(stt.connectUrl(), ALT_URL, 'token-fatal on a relay must advance on the FIRST failure, not after 2');
  // And it must NOT have killed the session.
  // (isActive is only set by start(); we never started, so just assert no crash + advance.)
  stt.removeAllListeners();
});

test('token-fatal advance does not run when already on railway (lets normal fatal apply)', () => {
  const stt = relayInstance();
  // Walk to railway first.
  stt.maybeAdvanceTarget(RELAY_URL, 1006); stt.maybeAdvanceTarget(RELAY_URL, 1006);
  stt.maybeAdvanceTarget(ALT_URL, 1006);   stt.maybeAdvanceTarget(ALT_URL, 1006);
  assert.equal(stt.connectUrl(), RAILWAY_URL);
  // A forceAdvance on railway is a no-op (railway uses legacy auth; invalid_key_format there is genuinely fatal).
  stt.forceAdvanceTarget(RAILWAY_URL, 'token_fatal');
  assert.equal(stt.connectUrl(), RAILWAY_URL);
  stt.removeAllListeners();
});

test('sttRailwayFallbackEnabled=false strips the railway url from the chain', () => {
  const stt = relayInstance(flagsOn({ isRailwayFallbackEnabled: () => false }));
  assert.deepEqual(stt.target.chain, [RELAY_URL, ALT_URL], 'railway must be absent when the fallback flag is off');
  stt.removeAllListeners();
});

// ── The flag-OFF unchanged-behavior proof ───────────────────────────────────

test('flag OFF: resolver never called, connect() dials BACKEND_URL, legacy frame', async () => {
  let resolverCalls = 0;
  const stt = new NativelyProSTT('natively_sk_paid', 'system', {
    appVersion: '2.7.0',
    platform: 'mac',
    flags: flagsOn({ isRelayEnabled: () => false }),  // master OFF
    resolveSession: async () => { resolverCalls++; return null; },
  });

  // Stub the socket-open path: replace connect()'s WS construction by spying on
  // the url that connect() would dial. We capture it by overriding connectUrl
  // observation — call the real maybeResolveRelayTarget() (the gate) directly.
  const startedResolve = stt.maybeResolveRelayTarget();
  assert.equal(startedResolve, false, 'flag OFF → maybeResolveRelayTarget returns false synchronously (no async resolve)');
  assert.equal(resolverCalls, 0, 'BUG: resolver must NEVER be called when the flag is off');
  assert.equal(stt.target, null, 'flag OFF → no relay target installed');
  assert.equal(stt.connectUrl(), 'wss://api.natively.software/v1/transcribe', 'flag OFF → connect() dials the hardcoded BACKEND_URL');

  // And the auth frame must be the legacy shape for that url.
  const frame = stt.buildAuthFrame(stt.connectUrl());
  assert.equal(frame.key, 'natively_sk_paid');
  assert.equal(frame.session_token, undefined);
  stt.removeAllListeners();
});

test('flag ON with no cache: maybeResolveRelayTarget starts an async resolve (returns true)', async () => {
  let resolverCalls = 0;
  const stt = new NativelyProSTT('natively_sk_paid', 'system', {
    appVersion: '2.7.0',
    platform: 'mac',
    flags: flagsOn(),
    resolveSession: async () => { resolverCalls++; return makeConfig(); },
  });
  // Make connect() a no-op so the resolver continuation doesn't try a real socket.
  stt.connect = function () { /* no-op for the re-entry */ };
  stt.isActive = true;
  const started = stt.maybeResolveRelayTarget();
  assert.equal(started, true, 'flag ON + no cache → starts an async resolve and blocks this connect');
  // Let the microtask/finally run.
  await new Promise(r => setTimeout(r, 10));
  assert.equal(resolverCalls, 1, 'resolver called exactly once');
  assert.ok(stt.target, 'a target should be installed after resolution');
  assert.equal(stt.connectUrl(), RELAY_URL, 'resolved target dials the relay url first');
  stt.removeAllListeners();
});
