// Regression test: a Google STT credential/auth-resolution failure must be
// terminal for the session, not retried.
//
// THE BUG: PERMANENT_GRPC_CODES only matches numeric gRPC status codes {3,7,16}.
// "Could not load the default credentials" (thrown by google-auth-library when
// GOOGLE_APPLICATION_CREDENTIALS is unset and ADC is absent) reaches the stream
// 'error' handler with NO code, so it was classified retryable. write() then
// reopened the stream on every audio chunk (~1/sec); each reopen failed auth
// identically, and the repeated promise rejections tripped main.ts's 5-in-60s
// unhandled-rejection crash-loop guard — taking the WHOLE app down. Observed
// live on a fresh dev:agent profile with no keys configured.
//
// THE FIX (GoogleSTT.isAuthResolutionFailure): a codeless auth/credential error
// is permanent — retrying with the same missing credentials can only fail the
// same way. Set isFatalError, stop the reconnect loop, emit once so main.ts can
// surface STT-down. Scoped to CODELESS errors: a real gRPC status is still
// classified by its number, and a codeless NON-auth error (a transient socket
// blip) stays retryable.
//
// Same stub-client strategy as GoogleSttInvalidArgumentModelDowngrade.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DUMMY_KEY = path.join(os.tmpdir(), `natively-stt-auth-test-sa-${process.pid}.json`);
fs.writeFileSync(
  DUMMY_KEY,
  JSON.stringify({
    type: 'service_account',
    project_id: 'natively-stt-test',
    private_key_id: 'test',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADAN\n-----END PRIVATE KEY-----\n',
    client_email: 'test@natively-stt-test.iam.gserviceaccount.com',
    client_id: '0',
    token_uri: 'https://oauth2.googleapis.com/token',
  }),
);
process.env.GOOGLE_APPLICATION_CREDENTIALS = DUMMY_KEY;
process.env.GOOGLE_SDK_NODE_LOGGING = 'off';
process.on('unhandledRejection', (err) => {
  const msg = String(err && (err.message || err));
  if (/metadata|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|could not load the default credentials|GoogleAuth|fetch failed|network timeout|invalid_grant|DECODER|private key/i.test(msg)) {
    return; // expected stray SpeechClient auth artifact; no RPC is ever made here
  }
  throw err;
});
process.on('exit', () => { try { fs.unlinkSync(DUMMY_KEY); } catch { /* ignore */ } });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const { GoogleSTT } = await import(pathToFileURL(path.join(distRoot, 'GoogleSTT.js')).href);

function makeFakeStream() {
  const handlers = new EventEmitter();
  const stream = {
    destroyed: false,
    writable: true,
    write() { return true; },
    end() { },
    destroy() { stream.destroyed = true; },
    on(event, fn) { handlers.on(event, fn); return stream; },
    /** Fire an error the way the real stream would. Pass code=undefined for a codeless (auth) error. */
    fail(code, message) {
      const err = new Error(message ?? `fake grpc error ${code}`);
      if (code !== undefined) err.code = code;
      handlers.emit('error', err);
    },
  };
  return stream;
}

function makeStt() {
  const stt = new GoogleSTT('test');
  const requests = [];
  const streams = [];
  const emitted = [];
  // The recording stub. Kept as a named value so a test that calls the REAL
  // setCredentials() (which installs a live SpeechClient and would open real
  // auth handles that hang `node --test`) can immediately re-stub.
  const stubClient = {
    streamingRecognize(request) {
      requests.push(request);
      const s = makeFakeStream();
      streams.push(s);
      return s;
    },
  };
  const restub = () => { stt.client = stubClient; };
  restub();
  stt.on('error', (err) => emitted.push(err));
  return { stt, requests, streams, emitted, restub };
}

test('a codeless "could not load the default credentials" error is terminal, not retried', () => {
  const { stt, streams, emitted, requests } = makeStt();
  stt.start();
  assert.equal(requests.length, 1, 'precondition: start() opens one stream');

  streams[0].fail(undefined, 'Could not load the default credentials. Browse to https://cloud.google.com/...');

  assert.equal(
    stt.isFatalError,
    true,
    'BUG: an auth-resolution failure with no gRPC code was treated as retryable. write() then ' +
    'reopens the stream on every audio chunk, each fails auth the same way, and the repeated ' +
    'rejections trip main.ts\'s crash-loop guard and kill the app. It must be permanent.',
  );

  // write() must now drop audio rather than reopen the stream.
  stt.write(Buffer.from([1, 2, 3, 4]));
  assert.equal(
    requests.length,
    1,
    'BUG: write() reopened the stream after a fatal auth error — the ~1 reconnect/sec loop that ' +
    'crashes the app is exactly what isFatalError must stop.',
  );

  assert.equal(emitted.length, 1, 'the fatal error must reach main.ts once so STT-down is surfaced');
  stt.stop();
});

test('other credential-family messages are also terminal', () => {
  for (const msg of [
    'invalid_grant: account not found',
    'Unable to detect a Project Id in the current environment.',
    'error:0909006C:PEM routines:get_name:no start line',
  ]) {
    const { stt, streams } = makeStt();
    stt.start();
    streams[0].fail(undefined, msg);
    assert.equal(stt.isFatalError, true, `BUG: credential failure not treated as permanent: ${msg}`);
    stt.stop();
  }
});

test('a codeless NON-auth error stays retryable (the fix is scoped, not a blanket codeless=fatal)', () => {
  const { stt, streams } = makeStt();
  stt.start();

  streams[0].fail(undefined, 'socket hang up'); // a transient network blip, not an auth failure

  assert.equal(
    stt.isFatalError,
    false,
    'BUG: a transient codeless error was made permanent. The fix must match only ' +
    'credential/auth-resolution messages, or every momentary blip disables STT for the session.',
  );
  stt.stop();
});

test('an auth failure is sticky across start() — the next meeting does NOT re-open a doomed stream', () => {
  const { stt, streams, requests } = makeStt();
  stt.start();
  assert.equal(requests.length, 1, 'precondition: first meeting opens one stream');
  streams[0].fail(undefined, 'Could not load the default credentials');
  assert.equal(stt.isFatalError, true);

  stt.stop();   // meeting ends
  stt.start();  // a NEW meeting starts

  assert.equal(
    requests.length,
    1,
    'BUG: a new meeting re-opened the stream after credentials were known-broken. Each re-open ' +
    'fails auth and emits a rejection; enough meetings in 60s and main.ts\'s crash-loop guard ' +
    'kills the app. An auth-fatal state must survive start() until credentials actually change.',
  );
  assert.equal(stt.isFatalError, true, 'the re-started instance must stay disabled');
  stt.stop();
});

test('setCredentials() clears the auth-fatal state so new keys get a fresh attempt', () => {
  const { stt, streams, requests, restub } = makeStt();
  stt.start();
  streams[0].fail(undefined, 'Could not load the default credentials');
  stt.stop();

  stt.setCredentials(DUMMY_KEY); // operator supplies a working key (installs a real client)
  restub();                      // swap the live SpeechClient back out for the recording stub
  stt.start();

  assert.equal(
    requests.length,
    2,
    'BUG: after new credentials were set, start() still refused to open a stream. The sticky ' +
    'auth-fatal flag must be cleared by setCredentials(), or fixing the key never recovers STT.',
  );
  assert.equal(stt.isFatalError, false, 'fresh credentials must re-enable STT');
  stt.stop();
});

test('numeric gRPC codes are still classified by code, never by message', () => {
  // A benign idle timeout (code 11) must remain non-fatal even if its message
  // happened to contain an auth-looking word — code wins.
  const { stt, streams } = makeStt();
  stt.start();
  streams[0].fail(11, 'Audio Timeout Error');
  assert.equal(stt.isFatalError, false, 'code 11 idle timeout must stay recoverable');
  stt.stop();

  // And a real UNAUTHENTICATED (code 16) stays fatal as before.
  const b = makeStt();
  b.stt.start();
  b.streams[0].fail(16, 'request had invalid authentication credentials');
  assert.equal(b.stt.isFatalError, true, 'code 16 must remain immediately fatal');
  b.stt.stop();
});
