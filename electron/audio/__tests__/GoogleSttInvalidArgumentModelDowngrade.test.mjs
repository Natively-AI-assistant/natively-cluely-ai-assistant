// Regression test for the CLASS behind the "Chinese never transcribes" bug
// that PR #494 fixed for one language.
//
// PR #494 established the chain: an unsupported model+language pair makes
// Google reject the very first streamingRecognize with INVALID_ARGUMENT
// (gRPC code 3) -> PERMANENT_GRPC_CODES -> isFatalError = true -> write()'s
// guard drops every subsequent chunk -> the session transcribes NOTHING,
// silently. #494 answered it with a static two-entry allowlist
// (LANGUAGES_WITHOUT_LATEST_LONG = cmn-Hans-CN, cmn-Hant-TW).
//
// The allowlist cannot be proven complete: Google retired the STT *v1*
// language x model table (cloud.google.com/speech-to-text/docs/languages and
// .../speech-to-text-supported-languages both now redirect to the v2 doc,
// which uses chirp/long/short and has no latest_long column). Any other locale
// lacking latest_long is therefore still a silent total-failure waiting to
// happen, and no amount of list-curation can rule that out.
//
// Fix under test: a code-3 rejection of a `latest_long` stream downgrades the
// model to `default` ONCE and lets write()'s lazy reconnect reopen the stream,
// instead of killing STT for the session. The retry is bounded — a second
// code 3, or one raised while already on `default`, is treated as permanent
// exactly as before. Codes 7/16 (PERMISSION_DENIED/UNAUTHENTICATED) are
// untouched: no model change can fix those.
//
// Strategy: drive the REAL compiled GoogleSTT with a stubbed SpeechClient that
// records each request config and hands back a controllable emitter, so we
// assert on the model that actually goes on the wire — not on source text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

// GoogleSTT's ctor does `new SpeechClient({ keyFilename })`. With NO credentials
// google-auth-library probes the GCE metadata server, which rejects
// asynchronously AFTER these synchronous tests finish and can abort the shared
// test process. A syntactically valid dummy key file makes it use the file and
// never probe. No RPC is ever issued — the client is replaced below.
// (Same preamble as GoogleSTTDropsKeepaliveSilence.test.mjs.)
const DUMMY_KEY = path.join(os.tmpdir(), `natively-stt-dg-test-sa-${process.pid}.json`);
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
    return; // expected: stray SpeechClient auth artifact; no RPC is ever made
  }
  throw err;
});
process.on('exit', () => { try { fs.unlinkSync(DUMMY_KEY); } catch { /* ignore */ } });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const { GoogleSTT } = await import(pathToFileURL(path.join(distRoot, 'GoogleSTT.js')).href);

/** A stream stand-in: chainable .on(), plus a way to fire what Google would send. */
function makeFakeStream() {
  const handlers = new EventEmitter();
  const stream = {
    destroyed: false,
    write() { return true; },
    end() { },
    destroy() { stream.destroyed = true; },
    on(event, fn) { handlers.on(event, fn); return stream; },
    /** Fire a gRPC error the way the real stream would. */
    fail(code, message) {
      const err = new Error(message ?? `fake grpc error ${code}`);
      err.code = code;
      handlers.emit('error', err);
    },
  };
  return stream;
}

/**
 * A GoogleSTT wired to a recording stub client. `requests` collects the config
 * of every streamingRecognize call; `streams` the corresponding fake streams.
 */
function makeStt() {
  const stt = new GoogleSTT('test');
  const requests = [];
  const streams = [];
  const emitted = [];
  stt.client = {
    streamingRecognize(request) {
      requests.push(request);
      const s = makeFakeStream();
      streams.push(s);
      return s;
    },
  };
  // GoogleSTT re-emits genuine failures. Capture them: an EventEmitter with no
  // 'error' listener rethrows, and what it emits is itself part of the contract
  // — main.ts counts consecutive 'error' events and tears the session down, so
  // the self-healing downgrade must stay silent the way the idle timeout does.
  stt.on('error', (err) => emitted.push(err));
  return { stt, requests, streams, emitted };
}

/** The model actually sent on the Nth streamingRecognize call. */
const modelOf = (requests, i) => requests[i]?.config?.model;

test('a supported language opens on latest_long (the quality default is preserved)', () => {
  const { stt, requests } = makeStt();
  stt.start();

  assert.equal(requests.length, 1, 'start() must open exactly one stream');
  assert.equal(
    modelOf(requests, 0),
    'latest_long',
    'BUG: the default language (en-US) must still request latest_long — the downgrade must not ' +
    'become the blanket default and silently cost transcription quality everywhere.',
  );
  stt.stop();
});

test('a known-unsupported language opens on default without any round-trip (PR #494 path)', () => {
  const { stt, requests } = makeStt();
  stt.languageCode = 'cmn-Hans-CN'; // what setRecognitionLanguage('chinese') resolves to
  stt.start();

  assert.equal(
    modelOf(requests, 0),
    'default',
    "BUG: cmn-Hans-CN is in LANGUAGES_WITHOUT_LATEST_LONG, so the FIRST request must already be " +
    "model=default. Paying a failed round-trip for a pair we know about would re-introduce a " +
    'visible gap at the start of every Mandarin meeting.',
  );
  stt.stop();
});

test('code 3 on latest_long downgrades to default and does NOT disable STT', () => {
  const { stt, requests, streams, emitted } = makeStt();
  // A locale NOT on the static allowlist — this is the unknown-unknown case the
  // allowlist cannot cover, and the whole point of the runtime downgrade.
  stt.languageCode = 'ms-MY';
  stt.start();
  assert.equal(modelOf(requests, 0), 'latest_long', 'precondition: first attempt uses latest_long');

  streams[0].fail(3, 'Invalid recognition \'config\': bad model: latest_long');

  assert.equal(
    stt.isFatalError,
    false,
    'BUG: a code-3 rejection of latest_long was treated as permanent. That is exactly the ' +
    'failure mode of #494 — STT is disabled for the whole session and the meeting transcribes ' +
    'nothing, silently. The first one must be answered by downgrading the model instead.',
  );

  // write()'s lazy reconnect reopens the stream; startStream() must now ask for `default`.
  stt.startStream();
  assert.equal(
    modelOf(requests, 1),
    'default',
    'BUG: the stream reopened on latest_long again after Google rejected it. The downgrade must ' +
    'persist for the reconnect, or the session just loops on the same rejection.',
  );

  assert.deepEqual(
    emitted,
    [],
    "BUG: the downgrade re-emitted 'error'. main.ts counts consecutive STT errors and tears the " +
    'session down, so a failure we are already self-healing from must stay quiet — exactly how ' +
    'the code-11 idle timeout is handled one branch above.',
  );

  stt.stop();
});

test('the downgrade is bounded — a SECOND code 3 is permanent, as before', () => {
  const { stt, requests, streams, emitted } = makeStt();
  stt.languageCode = 'ms-MY';
  stt.start();

  streams[0].fail(3, 'bad model');          // first: downgrade
  stt.startStream();                        // reopen on `default`
  assert.equal(modelOf(requests, 1), 'default');
  streams[1].fail(3, 'genuinely invalid');  // second: not a model problem

  assert.equal(
    stt.isFatalError,
    true,
    'BUG: code 3 on model=default was retried too. Nothing is left to downgrade, so this is a ' +
    'real permanent config error — retrying forever is the ~1 reconnect/sec loop that ' +
    'PERMANENT_GRPC_CODES exists to stop (issue #171).',
  );
  assert.equal(
    emitted.length,
    1,
    "BUG: the genuinely-permanent failure was swallowed. Only the first, self-healing code 3 is " +
    'silent; once we stop retrying, the error must reach main.ts so the user is told STT is down ' +
    'instead of watching an empty transcript.',
  );
  stt.stop();
});

test('codes 7 and 16 stay immediately fatal — no model change can fix auth', () => {
  for (const code of [7, 16]) {
    const { stt, streams } = makeStt();
    stt.start();
    streams[0].fail(code, `fatal ${code}`);
    assert.equal(
      stt.isFatalError,
      true,
      `BUG: gRPC code ${code} (PERMISSION_DENIED/UNAUTHENTICATED) must remain immediately fatal. ` +
      'The downgrade is scoped to INVALID_ARGUMENT; widening it would restore the reconnect ' +
      'storm on a misconfigured Google project.',
    );
    stt.stop();
  }
});

test('a fresh start() clears a previous downgrade', () => {
  const { stt, requests, streams } = makeStt();
  stt.languageCode = 'ms-MY';
  stt.start();
  streams[0].fail(3, 'bad model');
  stt.stop();

  stt.start();
  assert.equal(
    modelOf(requests, 1),
    'latest_long',
    'BUG: the downgrade leaked into the next session. It is a fact about one stream attempt, not ' +
    'a permanent property of the instance — a new meeting must get its own latest_long attempt.',
  );
  stt.stop();
});
