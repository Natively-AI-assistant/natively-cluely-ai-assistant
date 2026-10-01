// A 429 from a REST speech provider keeps its audio and waits out retry-after.
//
// 2026-09-26, from a Groq report (transcripts every 20-30 s). Groq's free tier
// allows 20 requests a minute per organisation — both channels share it — and
// bills every request as at least 10 s of audio (console.groq.com/docs). With
// a flush at every pause, a conversation reaches that; each 429 then DROPPED
// the audio it carried, and the next pause sent again straight into the limit.
//
// Runs the compiled RestSTT (dist-electron) against a local HTTP server that
// stands in for api.groq.com: the build bundles axios, so the redirect is one
// level down — https.request hands api.groq.com to plain TCP on the local port.
//
// Platform: no platform branch here — one run covers darwin and win32.
//
// Run: npm run build:electron && node --test electron/audio/__tests__/RestSttRateLimit2026_09_26.test.mjs

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

const { RestSTT, retryAfterMs } = require(path.join(distDir, 'RestSTT.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** ms of loud 16 kHz mono PCM (well above the 50 RMS silence skip). */
const speech = (ms) => {
  const b = Buffer.alloc(ms * 32);
  for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin(i * 0.07) * 3000), i * 2);
  return b;
};

/** Scripted stand-in for Groq's transcription endpoint. */
async function startServer(respond) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      requests.push({ at: Date.now(), bytes: body.length });
      respond(requests.length, res);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  serverPort = server.address().port;
  return { requests, close: () => new Promise((r) => server.close(r)) };
}

const tooMany = (res, retryAfter) => {
  res.writeHead(429, { 'content-type': 'application/json', ...(retryAfter !== undefined ? { 'retry-after': String(retryAfter) } : {}) });
  res.end(JSON.stringify({ error: { message: 'Rate limit reached for model `whisper-large-v3-turbo` on requests per minute (RPM): Limit 20, Used 20, Requested 1.', type: 'requests', code: 'rate_limit_exceeded' } }));
};
const ok = (res, text) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text })); };

describe('a 429 keeps the audio and waits out retry-after', () => {
  let restoreConsole;
  before(() => {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = () => {};
    restoreConsole = () => Object.assign(console, saved);
  });
  after(() => restoreConsole());

  test('the refused audio goes up again, with what came after it, once the wait is over', async () => {
    const server = await startServer((n, res) => (n === 1 ? tooMany(res, 1) : ok(res, 'how would you design a rate limiter')));
    const stt = new RestSTT('groq', 'gsk-test');
    stt.setSampleRate(16000);
    const transcripts = [];
    const errors = [];
    stt.on('transcript', (t) => transcripts.push(t));
    stt.on('error', (e) => errors.push(e));
    stt.start();

    stt.write(speech(1000));
    stt.notifySpeechEnded(); // request 1 → 429, retry-after: 1
    await sleep(300);
    stt.write(speech(500));
    stt.notifySpeechEnded(); // inside the wait: must NOT go out
    await sleep(300);
    const duringWait = server.requests.length;
    await sleep(1000); // retry timer fires at ~1 s
    stt.stop();
    await server.close();

    assert.equal(duringWait, 1, 'a pause inside the retry-after window sent another request into the limit');
    assert.equal(server.requests.length, 2);
    const [first, second] = server.requests;
    // 0.5 s of 16 kHz mono = 16,000 bytes more than the refused upload.
    assert.ok(second.bytes >= first.bytes + 15_000, `retry carried ${second.bytes} bytes vs ${first.bytes}: the refused second of audio was dropped`);
    assert.ok(second.at - first.at >= 950, `retried after ${second.at - first.at} ms, before retry-after (1 s)`);
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0].text, 'how would you design a rate limiter');
    assert.equal(errors.length, 1, 'the 429 is still reported (main.ts shows Rate Limited)');
    assert.equal(errors[0].response?.status, 429);
  });

  test('retry-after: delta-seconds, an HTTP date, or absent', () => {
    assert.equal(retryAfterMs(undefined), null);
    assert.equal(retryAfterMs(''), null);
    assert.equal(retryAfterMs('2'), 2000);
    assert.equal(retryAfterMs('0.5'), 500);
    assert.equal(retryAfterMs(['3']), 3000);
    const now = Date.parse('2026-09-26T12:00:00Z');
    assert.equal(retryAfterMs('Sat, 26 Sep 2026 12:00:07 GMT', now), 7000);
    assert.equal(retryAfterMs('soon'), null);
  });

  test('while waiting, at most the newest 60 s of audio is held', () => {
    const stt = new RestSTT('groq', 'gsk-test');
    stt.setSampleRate(16000);
    stt.isActive = true;
    stt.chunks = [speech(1000)];
    stt.totalBufferedBytes = 32_000;
    const refused = Array.from({ length: 70 }, () => speech(1000)); // 70 s refused
    stt.holdForRateLimit(refused, 70 * 32_000, 60_000);
    clearTimeout(stt.rateLimitRetryTimer);
    stt.isActive = false;
    assert.equal(stt.totalBufferedBytes, 60 * 32_000);
    assert.equal(stt.chunks.length, 60);
    assert.equal(stt.chunks.reduce((a, c) => a + c.length, 0), stt.totalBufferedBytes);
  });

  test('stop() cancels a pending retry', () => {
    const stt = new RestSTT('groq', 'gsk-test');
    stt.start();
    stt.holdForRateLimit([speech(500)], 16_000, 60_000);
    assert.ok(stt.rateLimitRetryTimer);
    stt.stop();
    assert.equal(stt.rateLimitRetryTimer, null);
    assert.equal(stt.rateLimitedUntil, 0);
  });
});
