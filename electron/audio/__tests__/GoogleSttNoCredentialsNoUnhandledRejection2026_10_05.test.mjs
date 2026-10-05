// Regression test: with NO Google credentials, GoogleSTT must not leave a
// single unhandled promise rejection behind, however many times a meeting
// starts.
//
// THE BUG (follow-up to PR #632): the rejections that tripped main.ts's
// 5-in-60s crash-loop guard do not come from GoogleSTT's stream 'error'
// handler — that one is handled. They come from inside @google-cloud/speech:
//
//     _streamingRecognize(options) {
//         this.initialize().catch(err => { throw err; });   // <- re-throws into a promise nobody holds
//
// so EVERY streamingRecognize() call on a client whose credentials cannot be
// resolved leaves one unhandled rejection, retry loop or not. One meeting
// start makes four such calls (two channels, each restarted once by the
// debounced language change) and main.ts builds fresh instances for the next
// meeting, so making the failure "permanent" after the first stream (#632)
// still leaves 4 of the 5 allowed, and a second start inside the minute exits
// the app.
//
// THE FIX under test: GoogleSTT resolves the client's credentials itself, with
// the failure handled, BEFORE it ever calls streamingRecognize(). No stream is
// opened on a client that cannot authenticate; one worded error reaches
// main.ts per channel.
//
// Strategy: the REAL SpeechClient, not a stub — the leak lives in the library,
// so a stubbed client cannot see it. Hermetic: no key in the environment, the
// well-known gcloud file lookup pointed at an empty directory (HOME on
// macOS/Linux, APPDATA on Windows), and the GCE metadata probe switched off so
// the failure is immediate and no network is touched.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-stt-nocreds-'));
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.HOME = SANDBOX;
process.env.APPDATA = SANDBOX;
process.env.METADATA_SERVER_DETECTION = 'none';
process.env.GOOGLE_SDK_NODE_LOGGING = 'off';
after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* ignore */ } });

// Deliberately NOT the filtering handler the stub-client suites use: that one
// swallows "could not load the default credentials", which is exactly the
// rejection this test exists to count.
const unhandled = [];
process.on('unhandledRejection', (err) => { unhandled.push(err); });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const { GoogleSTT } = await import(pathToFileURL(path.join(distRoot, 'GoogleSTT.js')).href);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const AUDIO = Buffer.alloc(1920, 1); // non-zero, so it is not dropped as a keepalive

/** One channel the way main.ts builds it: real client, an 'error' listener, a call counter. */
function makeChannel(label) {
  const stt = new GoogleSTT(label);
  const errors = [];
  stt.on('error', (err) => errors.push(err));
  const calls = { streamingRecognize: 0 };
  const real = stt.client.streamingRecognize.bind(stt.client);
  stt.client.streamingRecognize = (...args) => {
    calls.streamingRecognize++;
    return real(...args);
  };
  return { stt, errors, calls };
}

/** A meeting start as the crash log shows it: start, the debounced language restart, then audio. */
async function runMeeting(channels) {
  for (const { stt } of channels) {
    stt.setRecognitionLanguage('auto'); // 250ms debounce -> stop() + start()
    stt.start();
  }
  // ~1.6s of audio: long enough to pass write()'s 1s lazy-reconnect gate.
  for (let i = 0; i < 16; i++) {
    for (const { stt } of channels) stt.write(AUDIO);
    await sleep(100);
  }
}

function endMeeting(channels) {
  for (const { stt } of channels) {
    stt.stop();
    stt.removeAllListeners();
  }
}

test('no credentials: two meeting starts leave zero unhandled rejections and open no stream', async () => {
  const first = [makeChannel('interviewer'), makeChannel('user')];
  await runMeeting(first);
  const firstErrors = first.map((c) => c.errors.slice());
  endMeeting(first);

  // main.ts drops the instances at meeting end and builds new ones.
  const second = [makeChannel('interviewer'), makeChannel('user')];
  await runMeeting(second);
  const secondErrors = second.map((c) => c.errors.slice());
  endMeeting(second);

  await sleep(300); // let any stray rejection surface before counting

  const opened = [...first, ...second].reduce((n, c) => n + c.calls.streamingRecognize, 0);
  assert.equal(
    opened,
    0,
    `BUG: streamingRecognize() was called ${opened} time(s) on a client with no credentials. Each ` +
    'call leaves one unhandled rejection inside @google-cloud/speech that nothing outside can catch.',
  );
  assert.equal(
    unhandled.length,
    0,
    `BUG: ${unhandled.length} unhandled rejection(s) (${unhandled[0]?.message}). main.ts exits the ` +
    'app at 5 inside 60 seconds — this is the crash.',
  );

  for (const errors of [...firstErrors, ...secondErrors]) {
    // At least once: the failure itself, plus a repeat for a restart that
    // lands after it (the language debounce does, when the failure is fast).
    assert.ok(errors.length >= 1, 'each channel must report the failure so the UI can show it');
    for (const err of errors) {
      assert.equal(
        err.code,
        GoogleSTT.CREDENTIALS_UNAVAILABLE_CODE,
        'the error must carry the code main.ts uses to mark the channel failed instead of "reconnecting"',
      );
      assert.doesNotMatch(
        err.message,
        /https?:\/\/|default credentials/i,
        'the message is shown in the overlay — it must be worded for the user, not the library\'s raw text',
      );
    }
  }
});

test('a key file that does not exist fails the same way: one error, no stream, nothing unhandled', async () => {
  const before = unhandled.length;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(SANDBOX, 'missing-key.json');
  try {
    const channel = makeChannel('user');
    await runMeeting([channel]);
    endMeeting([channel]);
    await sleep(300);

    assert.equal(channel.calls.streamingRecognize, 0, 'no stream may be opened when the key file is missing');
    assert.equal(unhandled.length - before, 0, 'a missing key file must not leave an unhandled rejection');
    assert.ok(channel.errors.length >= 1, 'the failure must be reported');
    for (const err of channel.errors) assert.equal(err.code, GoogleSTT.CREDENTIALS_UNAVAILABLE_CODE);
  } finally {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
});

// ── Ordering of the asynchronous check against the synchronous restarts ─────
// A client whose initialize() we control, so the check can be held open while
// start()/stop()/write() run around it.

function makeFakeStream() {
  const handlers = new EventEmitter();
  const stream = {
    destroyed: false,
    writable: true,
    written: 0,
    write() { stream.written++; return true; },
    end() { },
    destroy() { stream.destroyed = true; },
    on(event, fn) { handlers.on(event, fn); return stream; },
  };
  return stream;
}

function makeGatedStt() {
  const stt = new GoogleSTT('test');
  const streams = [];
  const errors = [];
  const gate = { initializeCalls: 0, resolve: null, reject: null };
  const pending = new Promise((resolve, reject) => { gate.resolve = resolve; gate.reject = reject; });
  stt.client = {
    initialize() { gate.initializeCalls++; return pending; },
    streamingRecognize() {
      const s = makeFakeStream();
      streams.push(s);
      return s;
    },
  };
  stt.on('error', (err) => errors.push(err));
  return { stt, streams, errors, gate };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a restart while the check is in flight opens exactly one stream, and buffered audio reaches it', async () => {
  const { stt, streams, gate } = makeGatedStt();
  stt.start();
  assert.equal(streams.length, 0, 'no stream may be opened before the credentials are known to resolve');

  stt.write(AUDIO);            // buffered, not dropped
  stt.stop(); stt.start();     // the language/sample-rate restart
  stt.write(AUDIO);
  assert.equal(gate.initializeCalls, 1, 'one check per client, however many restarts happen around it');

  gate.resolve({});
  await settle();

  assert.equal(streams.length, 1, 'BUG: the check resolving must open one stream — not zero, not one per start()');
  assert.equal(streams[0].written, 2, 'audio written while the check ran must be flushed to the stream');

  stt.stop(); stt.start();
  assert.equal(streams.length, 2, 'once verified, a restart opens its stream synchronously as before');
  assert.equal(gate.initializeCalls, 1, 'a verified client is not checked again');
  stt.stop();
});

test('stop() while the check is in flight means no stream is opened for the ended session', async () => {
  const { stt, streams, gate } = makeGatedStt();
  stt.start();
  stt.stop();
  gate.resolve({});
  await settle();
  assert.equal(streams.length, 0, 'BUG: a stream was opened for a session that had already stopped');

  stt.start();
  assert.equal(streams.length, 1, 'the verdict is kept: the next start opens without another check');
  stt.stop();
});

test('a meeting torn down while the check is in flight: the late failure throws nothing and is reported at the next start', async () => {
  const before = unhandled.length;
  const { stt, streams, errors, gate } = makeGatedStt();
  stt.start();
  stt.stop();
  stt.removeAllListeners();     // what main.ts does when the meeting ends
  gate.reject(new Error('Could not load the default credentials.'));
  await settle();
  await settle();

  assert.equal(
    unhandled.length - before,
    0,
    'BUG: the failure was emitted as an \'error\' with no listener, which throws inside the check\'s ' +
    'promise — an unhandled rejection of our own making.',
  );
  assert.equal(stt.isFatalError, true, 'the verdict must still be recorded');

  stt.on('error', (err) => errors.push(err));
  stt.start();                  // the instance is reused for the next meeting
  await settle();
  assert.equal(streams.length, 0);
  assert.equal(errors.length, 1, 'the next meeting must be told why nothing is transcribed');
  assert.equal(errors[0].code, GoogleSTT.CREDENTIALS_UNAVAILABLE_CODE);
  stt.stop();
});

test('a failed check disables the channel until setCredentials(), which revives a running meeting', async () => {
  const { stt, streams, errors, gate } = makeGatedStt();
  stt.start();
  gate.reject(new Error('Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started'));
  await settle();

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, GoogleSTT.CREDENTIALS_UNAVAILABLE_CODE);
  assert.equal(stt.isFatalError, true);

  stt.write(AUDIO);
  stt.stop(); stt.start();   // main.ts can reuse the instance for the next meeting
  stt.stop(); stt.start();   // ...and a restart can follow in the same tick
  stt.write(AUDIO);
  assert.equal(streams.length, 0, 'nothing may reopen a channel whose credentials are known not to resolve');
  assert.equal(gate.initializeCalls, 1, 'the dead client must not be checked again');

  // The overlay resets to "Listening for audio…" at every meeting start, so a
  // start() that opens nothing has to say why again — once, not per restart.
  assert.equal(errors.length, 1, 'the repeat report is deferred past the caller\'s own start-of-meeting status');
  await settle();
  assert.equal(
    errors.length,
    2,
    'BUG: a reused instance started a new meeting without reporting that it is disabled — the ' +
    'overlay then shows a healthy "Listening for audio…" and never transcribes.',
  );
  assert.equal(errors[1].code, GoogleSTT.CREDENTIALS_UNAVAILABLE_CODE);

  // The user adds a key in Settings while the meeting is still running.
  const DUMMY_KEY = path.join(SANDBOX, 'dummy-key.json');
  fs.writeFileSync(DUMMY_KEY, JSON.stringify({
    type: 'service_account',
    project_id: 'natively-stt-test',
    private_key_id: 'test',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADAN\n-----END PRIVATE KEY-----\n',
    client_email: 'test@natively-stt-test.iam.gserviceaccount.com',
    client_id: '0',
    token_uri: 'https://oauth2.googleapis.com/token',
  }));
  try {
    stt.setCredentials(DUMMY_KEY);
    const revived = [];
    stt.client = { streamingRecognize() { const s = makeFakeStream(); revived.push(s); return s; } };
    assert.equal(stt.isFatalError, false, 'BUG: a new key must re-enable the running meeting, not only the next one');

    stt.lastConnectAttempt = 0; // step past write()'s 1s reconnect gate
    stt.write(AUDIO);
    assert.equal(revived.length, 1, 'the next audio chunk must open a stream on the new credentials');
  } finally {
    stt.stop();
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
});

// ── main.ts side of the contract ────────────────────────────────────────────
// main.ts matches the code as a string literal (as it does for
// local_stt_unavailable), so the two can drift apart silently. If they do, the
// channel sits on "reconnecting" forever instead of showing the failure.
test('main.ts treats the credentials-unavailable code as a terminal auth failure', () => {
  const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');
  const start = mainSource.indexOf('const isAuthError =');
  assert.notEqual(start, -1, 'precondition: main.ts still has the isAuthError classification');
  const expression = mainSource.slice(start, mainSource.indexOf(';', start));
  assert.ok(
    expression.includes(`=== '${GoogleSTT.CREDENTIALS_UNAVAILABLE_CODE}'`),
    `BUG: main.ts's isAuthError no longer checks for '${GoogleSTT.CREDENTIALS_UNAVAILABLE_CODE}'. ` +
    'A Google STT credential failure is then counted as a retryable blip and never shown as failed.',
  );
});
