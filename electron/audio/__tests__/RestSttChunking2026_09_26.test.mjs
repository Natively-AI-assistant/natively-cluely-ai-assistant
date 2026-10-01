// REST speech chunks end at short pauses and never grow past 6 s; Whisper's
// "Thank you." on silent audio is dropped.
//
// 2026-09-26, Groq report (transcripts every 20-30 s). A REST speech API
// returns text only for a finished upload, so the first word of a chunk
// appears only when the whole chunk does. Chunks used to end only at the
// native speech end (a 500-600 ms pause) or after 10 s; the live log showed a
// 9.5 s interviewer chunk from continuous TV dialogue. The same log had four
// "[ME]: Thank you." lines while the user was silent — Whisper's stock output
// for audio without speech — each passed to the AI as something they said.
//
// Runs the compiled RestSTT (dist-electron) against a local HTTP server that
// stands in for api.groq.com (https.request hands it to the local port: the
// build bundles axios). Chunk decisions ride on the audio itself, not the
// clock, so audio is written as fast as the test likes.
//
// Platform: no platform branch here — one run covers darwin and win32.
//
// Run: npm run build:electron && node --test electron/audio/__tests__/RestSttChunking2026_09_26.test.mjs

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

let serverPort = 0;
const realHttpsRequest = https.request;
https.request = function (opts, ...rest) {
  if (opts && typeof opts === 'object' && (opts.host === 'api.groq.com' || opts.hostname === 'api.groq.com')) {
    const local = { ...opts, host: '127.0.0.1', hostname: '127.0.0.1', port: serverPort, protocol: 'http:', agent: undefined, lookup: undefined };
    local.createConnection = () => net.connect(serverPort, '127.0.0.1');
    return http.request(local, ...rest);
  }
  return realHttpsRequest.call(this, opts, ...rest);
};

const { RestSTT, whisperTextWithoutHallucinations } = require(path.join(distDir, 'RestSTT.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BYTES_PER_MS = 32; // 16 kHz mono int16
/** ms of 16 kHz mono speech-like tone at amplitude `amp`. */
const tone = (ms, amp = 3000, phase = { t: 0 }) => {
  const b = Buffer.alloc(ms * BYTES_PER_MS);
  for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin(phase.t++ * 0.07) * amp), i * 2);
  return b;
};
const zeros = (ms) => Buffer.alloc(ms * BYTES_PER_MS);
/** Writes in 60 ms pieces, as the native capture batches them. */
const feed = (stt, buf) => { for (let o = 0; o < buf.length; o += 1920) stt.write(buf.subarray(o, o + 1920)); };

/** Stand-in for Groq: records each upload's PCM length and form fields. */
async function startServer() {
  const uploads = [];
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      const riff = body.indexOf('RIFF');
      const pcmBytes = riff >= 0 ? body.readUInt32LE(riff + 40) : -1;
      const fmt = /name="response_format"\r\n\r\n([a-z_]+)/.exec(body.toString('latin1'))?.[1];
      uploads.push({ pcmMs: pcmBytes / BYTES_PER_MS, responseFormat: fmt });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: `chunk ${uploads.length}`, segments: [{ text: ` chunk ${uploads.length}`, no_speech_prob: 0.01, avg_logprob: -0.2 }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  serverPort = server.address().port;
  return { uploads, close: () => new Promise((r) => server.close(r)) };
}

function groq() {
  const stt = new RestSTT('groq', 'gsk-test', undefined, undefined, 'interviewer');
  stt.setSampleRate(16000);
  stt.start();
  return stt;
}

describe('chunks end sooner', () => {
  let restoreConsole;
  before(() => {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = () => {};
    restoreConsole = () => Object.assign(console, saved);
  });
  after(() => restoreConsole());

  test('after 3 s, a 200 ms pause ends the chunk — no waiting for the 600 ms speech end or 10 s', async () => {
    const server = await startServer();
    const stt = groq();
    feed(stt, tone(3500));
    feed(stt, zeros(240));
    await sleep(200);
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 1, 'the pause did not end the chunk');
    assert.ok(Math.abs(server.uploads[0].pcmMs - 3740) <= 60, `uploaded ${server.uploads[0].pcmMs} ms`);
    assert.equal(server.uploads[0].responseFormat, 'verbose_json');
  });

  test('before 3 s, a short pause does not end it (the native speech end still does)', async () => {
    const server = await startServer();
    const stt = groq();
    feed(stt, tone(2000));
    feed(stt, zeros(400));
    feed(stt, tone(300));
    await sleep(200);
    assert.equal(server.uploads.length, 0);
    stt.notifySpeechEnded();
    await sleep(200);
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 1);
    assert.ok(Math.abs(server.uploads[0].pcmMs - 2700) <= 60, `uploaded ${server.uploads[0].pcmMs} ms`);
  });

  test('continuous speech is cut at 6 s, at the quietest point of the last 1.5 s', async () => {
    const server = await startServer();
    const stt = groq();
    const phase = { t: 0 };
    feed(stt, tone(5000, 3000, phase));
    feed(stt, tone(60, 400, phase)); // a soft stretch between words, 5.00-5.06 s
    feed(stt, tone(1500, 3000, phase));
    await sleep(200);
    const kept = stt.totalBufferedBytes / BYTES_PER_MS;
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 1, 'the cap did not cut');
    const cutMs = server.uploads[0].pcmMs;
    assert.ok(cutMs >= 5000 && cutMs <= 5080, `cut at ${cutMs} ms, not in the soft stretch`);
    assert.ok(Math.abs(cutMs + kept - 6560) <= 20, `lost audio at the cut: ${cutMs} + ${kept}`);
  });

  test('one loud click does not make ordinary speech count as a pause', async () => {
    const server = await startServer();
    const stt = groq();
    const phase = { t: 0 };
    feed(stt, tone(1000, 3000, phase));
    feed(stt, tone(20, 30000, phase));
    feed(stt, tone(2500, 1500, phase)); // quieter than the click, never silent
    await sleep(200);
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 0, 'speech was cut as if it were a pause');
  });
});

describe('Whisper silence hallucinations', () => {
  const seg = (text, no_speech_prob, avg_logprob = -0.3) => ({ text, no_speech_prob, avg_logprob });

  test('"Thank you." rated as probably not speech is dropped', () => {
    assert.equal(whisperTextWithoutHallucinations({ text: ' Thank you.', segments: [seg(' Thank you.', 0.87)] }), '');
    assert.equal(whisperTextWithoutHallucinations({ text: ' Thanks for watching!', segments: [seg(' Thanks for watching!', 0.7)] }), '');
  });

  test('a clearly spoken "thank you" stays', () => {
    assert.equal(whisperTextWithoutHallucinations({ text: ' Thank you.', segments: [seg(' Thank you.', 0.04)] }), ' Thank you.');
  });

  test('only the hallucinated segment goes; real speech around it stays', () => {
    const data = {
      text: ' So the rate limiter sits in front of the API. Thank you.',
      segments: [seg(' So the rate limiter sits in front of the API.', 0.02, -0.15), seg(' Thank you.', 0.81)],
    };
    assert.equal(whisperTextWithoutHallucinations(data), 'So the rate limiter sits in front of the API.');
  });

  test('any low-confidence segment Whisper rates as not speech is dropped (its own decoder rule)', () => {
    assert.equal(whisperTextWithoutHallucinations({ text: ' mumble words', segments: [seg(' mumble words', 0.75, -1.4)] }), '');
    assert.equal(whisperTextWithoutHallucinations({ text: ' real words', segments: [seg(' real words', 0.75, -0.4)] }), ' real words');
  });

  test('no segments (plain json, another server) passes the text through', () => {
    assert.equal(whisperTextWithoutHallucinations({ text: 'hello' }), 'hello');
    assert.equal(whisperTextWithoutHallucinations('hello'), 'hello');
    assert.equal(whisperTextWithoutHallucinations({ text: 'hello', segments: [] }), 'hello');
  });
});
