/**
 * NativelyProSTT — three relay behaviours measured in production on 2026-10-16:
 *
 *  1. `account_suspended` / `subscription_inactive` are verdicts on the credential;
 *     the client used to reconnect every 15-30 s forever (1,141 + 146 rejections/33 h).
 *  2. A `language_detected` frame on a Soniox session must not reconnect (Soniox
 *     follows the language per token; the reconnect only froze an early guess).
 *  3. A link with no server frame or ping for 75 s is dead and must be torn down so
 *     the normal reconnect runs, instead of "listening" into a half-open socket.
 *
 * Loads the built module like NativelyProSTTCloseUpstreamTimers.test.mjs does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const source = readFileSync(path.resolve(__dirname, '../NativelyProSTT.ts'), 'utf8');

const origLoad = Module._load;
Module._load = function patchedLoad(request) {
  if (request === 'electron') {
    return { app: { getAppPath: () => '/tmp/fake-natively-app', isPackaged: false, isReady: () => false } };
  }
  return origLoad.apply(this, arguments);
};
const { NativelyProSTT } = await import(pathToFileURL(path.join(distRoot, 'NativelyProSTT.js')).href);

test('account_suspended and subscription_inactive are fatal server errors', () => {
  const fatal = NativelyProSTT.FATAL_SERVER_ERRORS;
  for (const code of ['account_suspended', 'subscription_inactive', 'auth_required', 'trial_expired', 'transcription_quota_exceeded', 'invalid_key_format', 'auth_timeout']) {
    assert.ok(fatal.has(code), `${code} must stop the reconnect loop`);
  }
  assert.ok(/FATAL_SERVER_ERRORS\.has\(String\(msg\.error\)\)/.test(source), 'the message handler must consult FATAL_SERVER_ERRORS');
  assert.ok(/this\.isActive = false;/.test(source), 'a fatal verdict must deactivate the client');
});

// 2026-11-03: widened from Soniox to every provider. Auto follows the speaker;
// a pin reconnect froze it on the first verdict (user log 2026-11-01: a mic
// session stayed Russian after "hello" was heard as "Алло").
test('in auto mode language_detected never reconnects, on any provider; a pinned language still does', () => {
  const stt = new NativelyProSTT('verdict-key', 'mic');
  stt.setRecognitionLanguage('auto');
  for (const provider of ['soniox', 'deepgram', 'elevenlabs', 'google', null]) {
    stt.connectedProvider = provider;
    assert.equal(stt.shouldReconnectForDetectedLanguage(), false, `auto must not pin on ${provider}`);
  }
  stt.setRecognitionLanguage('spanish');
  stt.connectedProvider = 'deepgram';
  assert.equal(stt.shouldReconnectForDetectedLanguage(), true, 'a user-pinned language keeps the historical reconnect');
  assert.ok(/if \(!this\.shouldReconnectForDetectedLanguage\(\)\) \{/.test(source), 'the language_detected branch must consult shouldReconnectForDetectedLanguage');
  // languageBcp47 is assigned only AFTER the check, so an auto session never pins.
  const idx = source.indexOf('if (!this.shouldReconnectForDetectedLanguage()) {');
  const assignIdx = source.indexOf('this.languageBcp47      = detected;', idx);
  assert.ok(idx > 0 && assignIdx > idx, 'languageBcp47 must only be pinned when a reconnect will follow');
});

test('a link silent for LIVENESS_STALE_MS is terminated; a live one is left alone', () => {
  const stt = new NativelyProSTT('liveness-key', 'system');
  const ws = { terminated: 0, terminate() { this.terminated++; } };
  stt.ws = ws;
  stt.isActive = true;
  const now = 10_000_000;
  stt.lastServerActivityAt = now - 20_000;
  assert.equal(stt.checkLiveness(ws, now), false, '20 s of silence is normal (pings are 25 s apart)');
  assert.equal(ws.terminated, 0);
  stt.lastServerActivityAt = now - NativelyProSTT.LIVENESS_STALE_MS;
  assert.equal(stt.checkLiveness(ws, now), true);
  assert.equal(ws.terminated, 1, 'the dead socket must be terminated so the close handler reconnects');
  assert.equal(stt.livenessTimer, null, 'the watch stops once it has acted');
});

test('the liveness check ignores a socket that is no longer the current one', () => {
  const stt = new NativelyProSTT('liveness-key-2', 'mic');
  const old = { terminated: 0, terminate() { this.terminated++; } };
  stt.ws = { terminate() {} };
  stt.isActive = true;
  stt.lastServerActivityAt = 0;
  assert.equal(stt.checkLiveness(old, 10_000_000), false);
  assert.equal(old.terminated, 0);
});

test('liveness constants: stale window exceeds the relay ping interval with margin', () => {
  assert.ok(NativelyProSTT.LIVENESS_STALE_MS >= 60_000 && NativelyProSTT.LIVENESS_STALE_MS <= 120_000);
  assert.ok(NativelyProSTT.LIVENESS_CHECK_MS <= NativelyProSTT.LIVENESS_STALE_MS / 2);
  assert.ok(/ws\.on\('ping'/.test(source), 'server pings must refresh the activity stamp');
});
