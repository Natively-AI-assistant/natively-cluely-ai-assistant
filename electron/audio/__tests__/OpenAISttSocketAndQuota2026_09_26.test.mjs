// OpenAI speech: one socket at a time, out-of-credits stops, OpenAI's own base
// URL is not a custom server, and the 24 kHz upsampler interpolates.
//
// 2026-09-26, from a user report ("OpenAI Whisper doesn't transcribe, or the
// latency is too much"). Live against the Realtime API with this repo's key:
//   - the account was out of credits: the server sends session.created, then
//     error {type: insufficient_quota, code: credit_balance_exhausted}, then
//     closes. session.created reset the failure count, so the class reconnected
//     every ~2 s for the whole meeting and main.ts showed "reconnecting".
//   - 'open' → session.created took 0-8 ms (10 connects). A chunk written in
//     that window saw isConnecting=false and isSessionReady=false and opened a
//     SECOND socket; the first one's session.created then flushed the ring
//     buffer (the ~1 s of speech buffered during the handshake) into the new,
//     still-connecting socket, where it was dropped.
//
// These run the compiled class (dist-electron) against a local ws server that
// stands in for api.openai.com, so the socket lifecycle is the real one. The
// build bundles `ws` into the class, so the redirect is one level down: wss://
// goes through https.request, which here hands api.openai.com to plain TCP on
// the local port.
//
// Platform: no platform branch here — one run covers darwin and win32.
//
// Run: npm run build:electron && node --test electron/audio/__tests__/OpenAISttSocketAndQuota2026_09_26.test.mjs

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const distDir = path.resolve(repoRoot, 'dist-electron/electron/audio');

const { WebSocketServer } = require(require.resolve('ws', { paths: [repoRoot] }));
let serverPort = 0;
const realHttpsRequest = https.request;
https.request = function (opts, ...rest) {
  if (opts && typeof opts === 'object' && (opts.host === 'api.openai.com' || opts.hostname === 'api.openai.com')) {
    const local = { ...opts, host: '127.0.0.1', hostname: '127.0.0.1', port: serverPort, protocol: 'http:', agent: undefined, lookup: undefined };
    local.createConnection = () => net.connect(serverPort, '127.0.0.1');
    return http.request(local, ...rest);
  }
  return realHttpsRequest.call(this, opts, ...rest);
};

const { OpenAIStreamingSTT } = require(path.join(distDir, 'OpenAIStreamingSTT.js'));
const { isDefaultOpenAiSttBase } = require(path.join(distDir, 'openaiSttBaseUrl.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAME_16K_20MS = Buffer.alloc(640, 0x11); // non-zero: not a native keepalive

/** A stand-in Realtime server. `onConnection(ws, id)` scripts each socket. */
async function startServer({ handshakeMs = 0, onConnection }) {
  const wss = new WebSocketServer({
    port: 0,
    host: '127.0.0.1',
    verifyClient: (_info, cb) => setTimeout(() => cb(true), handshakeMs),
  });
  await new Promise((r) => wss.on('listening', r));
  serverPort = wss.address().port;
  const sockets = [];
  wss.on('connection', (ws) => {
    const s = { ws, appended24k: 0 };
    sockets.push(s);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'input_audio_buffer.append') s.appended24k += Buffer.from(m.audio, 'base64').length / 2;
    });
    onConnection(ws, sockets.length - 1);
  });
  // Terminate every client first: a socket the class orphaned keeps the
  // server open, and a regression must fail here, not hang the run.
  return {
    sockets,
    close: () => new Promise((r) => { for (const s of sockets) s.ws.terminate(); wss.close(r); }),
  };
}

function quiet() {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  return () => Object.assign(console, saved);
}

describe('one socket at a time', () => {
  let restore;
  before(() => { restore = quiet(); });
  after(() => restore());

  test('audio written between open and session.created opens no second socket, and none of it is lost', async () => {
    // 300 ms handshake so audio queues in the ring buffer; session.created
    // 40 ms after open, so 20 ms chunks land in the window every time.
    const server = await startServer({
      handshakeMs: 300,
      onConnection: (ws) => setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'session.created', session: {} })), 40),
    });
    const stt = new OpenAIStreamingSTT('sk-test', undefined, 'gpt-live-transcribe');
    stt.setSampleRate(16000);
    stt.setAudioChannelCount(1);
    stt.start();
    let written16k = 0;
    const iv = setInterval(() => { stt.write(FRAME_16K_20MS); written16k += 320; }, 20);
    await sleep(1400);
    clearInterval(iv);
    await sleep(100);

    const opened = server.sockets.length;
    const reached = server.sockets.reduce((a, s) => a + s.appended24k, 0);
    const writtenMs = (written16k * 1.5) / 24;
    const lostMs = writtenMs - reached / 24;
    stt.stop();
    await server.close();

    assert.equal(opened, 1, `opened ${opened} sockets — a write in the open→session.created window must not connect again`);
    // Up to one unsent 100 ms batch can still sit in the accumulator.
    assert.ok(lostMs <= 100, `${Math.round(lostMs)} ms of ${Math.round(writtenMs)} ms never reached the server (the handshake's ring buffer was dropped)`);
  });

  test('a server close reconnects once, onto one new socket', async () => {
    const server = await startServer({
      onConnection: (ws, id) => {
        ws.send(JSON.stringify({ type: 'session.created', session: {} }));
        if (id === 0) setTimeout(() => ws.close(1011, 'server went away'), 200);
      },
    });
    const stt = new OpenAIStreamingSTT('sk-test', undefined, 'gpt-live-transcribe');
    stt.setSampleRate(16000);
    stt.start();
    const iv = setInterval(() => stt.write(FRAME_16K_20MS), 20);
    await sleep(1800); // close at 200 ms + 1 s backoff + connect
    clearInterval(iv);
    const opened = server.sockets.length;
    const open = server.sockets.filter((s) => s.ws.readyState === 1).length;
    const ready = stt.isSessionReady;
    stt.stop();
    await server.close();
    assert.equal(opened, 2, `opened ${opened} sockets`);
    assert.equal(open, 1, 'exactly one live socket after the reconnect');
    assert.equal(ready, true);
  });
});

describe('out of credits', () => {
  let restore;
  before(() => { restore = quiet(); });
  after(() => restore());

  test('insufficient_quota stops reconnecting and surfaces a quota error once', async () => {
    const server = await startServer({
      onConnection: (ws) => {
        ws.send(JSON.stringify({ type: 'session.created', session: {} }));
        ws.send(JSON.stringify({
          type: 'error',
          event_id: 'evt_1',
          error: {
            type: 'insufficient_quota',
            code: 'credit_balance_exhausted',
            message: 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
            param: null,
          },
        }));
        setTimeout(() => ws.terminate(), 30);
      },
    });
    const stt = new OpenAIStreamingSTT('sk-test', undefined, 'gpt-live-transcribe');
    stt.setSampleRate(16000);
    const errors = [];
    const warnings = [];
    stt.on('error', (e) => errors.push(e));
    stt.on('warning', (w) => warnings.push(w));
    stt.start();
    const iv = setInterval(() => stt.write(FRAME_16K_20MS), 20);
    await sleep(2600); // two backoff windows (1 s, 2 s) would have reconnected
    clearInterval(iv);
    const opened = server.sockets.length;
    const buffered = stt.ringBufferBytes;
    stt.stop();
    await server.close();

    assert.equal(opened, 1, `reconnected ${opened - 1} times into an account with no credits`);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /^insufficient_quota: You have no credits remaining/);
    assert.equal(errors[0].code, 'insufficient_quota');
    // main.ts fails the channel at once on this (isQuotaError), instead of
    // counting it as one of five retryable errors.
    assert.ok(errors[0].message.toLowerCase().includes('quota'));
    // No socket will open this meeting: audio is not piled into a pre-buffer
    // that ~30 s later evicts with a misleading "leading audio dropped".
    assert.equal(buffered, 0, 'audio kept buffering after the channel stopped');
    assert.deepEqual(warnings, []);
  });

  test('a new meeting tries again (the user may have added credits)', () => {
    const stt = new OpenAIStreamingSTT('sk-test');
    stt.shouldReconnect = false;
    stt.outOfCredits = true;
    stt.isActive = false;
    stt._connectWs = () => {};
    stt.start();
    assert.equal(stt.shouldReconnect, true);
    assert.equal(stt.outOfCredits, false);
    stt.isActive = false;
  });
});

describe('base URL: OpenAI itself is not a custom server', () => {
  test('blank and OpenAI\'s own API, with or without /v1', () => {
    for (const u of ['', '   ', undefined, null, 'https://api.openai.com', 'https://api.openai.com/', 'https://api.openai.com/v1', 'https://api.openai.com/v1/', 'HTTPS://API.OPENAI.COM/v1']) {
      assert.equal(isDefaultOpenAiSttBase(u), true, String(u));
    }
  });

  test('anything else is a custom server', () => {
    for (const u of ['http://api.openai.com/v1', 'https://api.openai.com.evil.test/v1', 'https://api.openai.com/v2', 'https://my-openai-proxy.example/v1', 'http://localhost:8000', 'https://api.openai.com/v1/audio']) {
      assert.equal(isDefaultOpenAiSttBase(u), false, u);
    }
  });

  test('the class keeps Realtime for https://api.openai.com/v1, REST for a real custom server', () => {
    const restore = quiet();
    try {
      assert.equal(new OpenAIStreamingSTT('sk', 'https://api.openai.com/v1').isCustomEndpoint, false);
      const custom = new OpenAIStreamingSTT('sk', 'http://localhost:8000');
      assert.equal(custom.isCustomEndpoint, true);
      assert.equal(custom.restEndpoint, 'http://localhost:8000/v1/audio/transcriptions');
    } finally { restore(); }
  });
});

describe('16 → 24 kHz upsampling interpolates', () => {
  test('a ramp comes out as a ramp, and the length is unchanged', () => {
    const stt = new OpenAIStreamingSTT('sk');
    stt.inputSampleRate = 16000;
    stt.numChannels = 1;
    const input = Buffer.alloc(320 * 2);
    for (let i = 0; i < 320; i++) input.writeInt16LE(i * 30, i * 2);
    const out = stt._resamplePcm16(input, 24000);
    assert.equal(out.length / 2, 480);
    const s = (i) => out.readInt16LE(i * 2);
    // Output sample i sits at input position i·2/3: 0, 20, 40, 60 … (nearest-
    // sample picking gave 0, 0, 30, 60 — every third sample repeated).
    assert.deepEqual([s(0), s(1), s(2), s(3), s(4)], [0, 20, 40, 60, 80]);
  });

  test('whole-number ratios are unchanged (48 → 24 kHz picks every other sample)', () => {
    const stt = new OpenAIStreamingSTT('sk');
    stt.inputSampleRate = 48000;
    stt.numChannels = 1;
    const input = Buffer.alloc(8 * 2);
    for (let i = 0; i < 8; i++) input.writeInt16LE(i * 100 + (i % 2) * 7, i * 2);
    const out = stt._resamplePcm16(input, 24000);
    assert.deepEqual([0, 1, 2, 3].map((i) => out.readInt16LE(i * 2)), [0, 200, 400, 600]);
  });
});
