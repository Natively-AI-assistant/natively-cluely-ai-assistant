// Groq bills every request as at least 10 s of audio; Natively sent it 3-6 s
// chunks, so a meeting cost 2-4x its audio.
//
// 2026-10-28, issue #698: a Groq usage page showed 6.4K s of audio billed as
// 27.2K s ("Extra Billed Seconds" 20.9K). console.groq.com/docs/speech-to-text:
// "Minimum Billed Length: 10 seconds". The free tier also allows only 20
// requests a minute for both channels. Groq chunks now end at a pause only
// once they hold 10 s and are cut by 11.5 s. On the user's mic only
// (setHoldSpeechEnds), a native speech end uploads at once only when the
// channel has not uploaded in the last 10 s; otherwise it waits for that, the
// interviewer talking (releaseHeldSpeech) or finalize(). The interviewer's
// speech ends are never held: Auto Answer and Answer wait on them.
//
// Runs the compiled RestSTT (dist-electron) against a local HTTP server that
// stands in for api.groq.com. The 10 s pacing reads Date.now(), which the
// tests shift forward instead of waiting.
//
// Platform: no platform branch here — one run covers darwin and win32.
//
// Run: npm run build:electron && node --test electron/audio/__tests__/RestSttGroqBilling2026_10_28.test.mjs

import { test, describe, before, after, afterEach } from 'node:test';
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

const { RestSTT } = require(path.join(distDir, 'RestSTT.js'));

const realNow = Date.now;
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BYTES_PER_MS = 32; // 16 kHz mono int16
const tone = (ms, amp = 3000, phase = { t: 0 }) => {
  const b = Buffer.alloc(ms * BYTES_PER_MS);
  for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin(phase.t++ * 0.07) * amp), i * 2);
  return b;
};
const zeros = (ms) => Buffer.alloc(ms * BYTES_PER_MS);
/** Writes in 60 ms pieces, as the native capture batches them. */
const feed = (stt, buf) => { for (let o = 0; o < buf.length; o += 1920) stt.write(buf.subarray(o, o + 1920)); };
/** Groq's bill for a set of uploads, in seconds. */
const billedS = (uploads) => uploads.reduce((a, u) => a + Math.max(10_000, u.pcmMs), 0) / 1000;
const audioS = (uploads) => uploads.reduce((a, u) => a + u.pcmMs, 0) / 1000;

async function startServer() {
  const uploads = [];
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      const riff = body.indexOf('RIFF');
      const fmt = /name="response_format"\r\n\r\n([a-z_]+)/.exec(body.toString('latin1'))?.[1];
      uploads.push({ pcmMs: body.readUInt32LE(riff + 40) / BYTES_PER_MS, at: Date.now(), responseFormat: fmt });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: 'x', segments: [{ text: ' x', no_speech_prob: 0.01, avg_logprob: -0.2 }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  serverPort = server.address().port;
  return { uploads, close: () => new Promise((r) => server.close(r)) };
}

/** A Groq channel; `hold` as main.ts sets it for the user's mic. */
function groq({ hold = true } = {}) {
  const stt = new RestSTT('groq', 'gsk-test', undefined, undefined, hold ? 'user' : 'interviewer');
  stt.setSampleRate(16000);
  stt.on('error', () => {});
  if (hold) stt.setHoldSpeechEnds(true);
  stt.start();
  return stt;
}

describe('Groq: requests hold its 10 s minimum bill and stay ~10 s apart', () => {
  let restoreConsole;
  before(() => {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = () => {};
    restoreConsole = () => Object.assign(console, saved);
  });
  after(() => { restoreConsole(); Date.now = realNow; });
  afterEach(() => { clockOffset = 0; });

  test('a pause ends the chunk only once it holds 10 s', async () => {
    const server = await startServer();
    const stt = groq();
    feed(stt, tone(3500));
    feed(stt, zeros(240));
    await sleep(150);
    assert.equal(server.uploads.length, 0, 'a 3.5 s chunk went up: billed as 10 s');
    feed(stt, tone(6600));
    feed(stt, zeros(240));
    await sleep(150);
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 1, 'the pause after 10 s did not end the chunk');
    assert.ok(Math.abs(server.uploads[0].pcmMs - 10_580) <= 60, `uploaded ${server.uploads[0].pcmMs} ms`);
    assert.equal(server.uploads[0].responseFormat, 'verbose_json');
  });

  test('continuous speech is cut between 10 and 11.5 s, at the quietest point, losing nothing', async () => {
    const server = await startServer();
    const stt = groq();
    const phase = { t: 0 };
    feed(stt, tone(10_500, 3000, phase));
    feed(stt, tone(60, 400, phase)); // a soft stretch between words, 10.50-10.56 s
    feed(stt, tone(1000, 3000, phase));
    await sleep(150);
    const kept = stt.totalBufferedBytes / BYTES_PER_MS;
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 1, 'the cap did not cut');
    const cutMs = server.uploads[0].pcmMs;
    assert.ok(cutMs >= 10_500 && cutMs <= 10_580, `cut at ${cutMs} ms, not in the soft stretch`);
    assert.ok(Math.abs(cutMs + kept - 11_560) <= 20, `lost audio at the cut: ${cutMs} + ${kept}`);
  });

  test('a speech end after 10 s without an upload goes at once (a question is not held)', async () => {
    const server = await startServer();
    const stt = groq();
    feed(stt, tone(1500));
    stt.notifySpeechEnded();
    await sleep(150);
    assert.equal(server.uploads.length, 1, 'the first speech end was held');
    clockOffset = 10_050;
    feed(stt, tone(2000));
    stt.notifySpeechEnded();
    await sleep(150);
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 2, 'a speech end 10 s after the last upload was held');
    assert.ok(Math.abs(server.uploads[1].pcmMs - 2000) <= 60);
  });

  test('a speech end within 10 s of the last upload waits for the rest of the 10 s, and later speech joins it', async () => {
    const server = await startServer();
    const stt = groq();
    feed(stt, tone(1500));
    stt.notifySpeechEnded();
    await sleep(150);
    assert.equal(server.uploads.length, 1);

    clockOffset = 9_500; // 0.5 s left of the 10 s
    feed(stt, tone(1200));
    stt.notifySpeechEnded();
    await sleep(100);
    assert.equal(server.uploads.length, 1, 'a second request inside 10 s');
    feed(stt, tone(800));
    stt.notifySpeechEnded(); // still held: no second timer
    await sleep(700);
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 2, 'the held audio never went up');
    assert.ok(Math.abs(server.uploads[1].pcmMs - 2000) <= 60, `held request carried ${server.uploads[1].pcmMs} ms, not both utterances`);
  });

  test('finalize() still sends held audio at once (Answer, meeting end, dictation)', async () => {
    const server = await startServer();
    const stt = groq();
    feed(stt, tone(1500));
    stt.notifySpeechEnded();
    await sleep(150);
    feed(stt, tone(1000));
    stt.notifySpeechEnded();
    await sleep(100);
    assert.equal(server.uploads.length, 1);
    stt.finalize();
    await sleep(150);
    assert.equal(stt.heldSpeechEndTimer, null, 'the held timer outlived the upload');
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 2);
    assert.ok(Math.abs(server.uploads[1].pcmMs - 1000) <= 60);
  });

  test('stop() cancels a held speech end', async () => {
    const server = await startServer();
    const stt = groq();
    feed(stt, tone(1500));
    stt.notifySpeechEnded();
    await sleep(150);
    feed(stt, tone(1000));
    stt.notifySpeechEnded();
    assert.ok(stt.heldSpeechEndTimer);
    stt.stop();
    assert.equal(stt.heldSpeechEndTimer, null);
    await server.close();
  });

  test('the interviewer channel never holds a speech end (Auto Answer, Answer)', async () => {
    const server = await startServer();
    const stt = groq({ hold: false });
    feed(stt, tone(1500));
    stt.notifySpeechEnded();
    await sleep(150);
    feed(stt, tone(1200));
    stt.notifySpeechEnded(); // 0.15 s after the last upload
    await sleep(150);
    assert.equal(stt.heldSpeechEndTimer, null);
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 2, 'an interviewer question was held back');
  });

  test('releaseHeldSpeech() sends held words at once (the interviewer started talking)', async () => {
    const server = await startServer();
    const stt = groq();
    feed(stt, tone(1500));
    stt.notifySpeechEnded();
    await sleep(150);
    feed(stt, tone(1000));
    stt.notifySpeechEnded();
    assert.equal(stt.hasPendingWork(), true, 'held words did not count as pending work');
    stt.releaseHeldSpeech();
    assert.equal(stt.heldSpeechEndTimer, null);
    await sleep(150);
    stt.releaseHeldSpeech(); // nothing held: no request
    await sleep(100);
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 2);
    assert.ok(Math.abs(server.uploads[1].pcmMs - 1000) <= 60);
  });

  test('setHoldSpeechEnds(false) releases a held speech end', async () => {
    const server = await startServer();
    const stt = groq();
    feed(stt, tone(1500));
    stt.notifySpeechEnded();
    await sleep(150);
    feed(stt, tone(1000));
    stt.notifySpeechEnded();
    stt.setHoldSpeechEnds(false);
    await sleep(150);
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 2);
  });

  test('a new session does not wait on the last one\'s upload (start() resets the pacing)', async () => {
    const server = await startServer();
    const stt = groq();
    feed(stt, tone(1500));
    stt.notifySpeechEnded();
    await sleep(150);
    stt.stop();
    stt.start();
    feed(stt, tone(1000));
    stt.notifySpeechEnded();
    await sleep(150);
    stt.stop();
    await server.close();
    assert.equal(server.uploads.length, 2, 'the first speech end of the new session was held');
  });

  test('a failed upload (not 429) does not make the next speech end wait', async () => {
    let n = 0;
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        n++;
        if (n === 1) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{}'); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ text: 'x', segments: [{ text: ' x', no_speech_prob: 0.01, avg_logprob: -0.2 }] }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    serverPort = server.address().port;
    const stt = groq();
    feed(stt, tone(1500));
    stt.notifySpeechEnded(); // → 500
    await sleep(200);
    feed(stt, tone(1000));
    stt.notifySpeechEnded();
    await sleep(200);
    stt.stop();
    await new Promise((r) => server.close(r));
    assert.equal(n, 2, 'the speech end after a failed upload was held');
  });

  test('a conversation: requests at least 8.5 s apart, billed within 25% of the audio (was 2.4x)', async () => {
    const server = await startServer();
    const stt = groq();
    // When each request leaves (the server sees it a turn later in this test).
    const sentAt = [];
    const upload = stt.uploadAudio;
    stt.uploadAudio = function (wav) { sentAt.push(Date.now()); return upload.call(this, wav); };
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    // 3 minutes of turns of 1-5 s, each ending in a native speech end after
    // a 300 ms pause; the clock moves with each 60 ms piece, as it does live.
    const feedLive = (buf) => {
      for (let o = 0; o < buf.length; o += 1920) { clockOffset += 60; stt.write(buf.subarray(o, o + 1920)); }
    };
    for (let i = 0; i < 60; i++) {
      feedLive(tone(1000 + Math.round(rnd() * 4000)));
      feedLive(zeros(300));
      stt.notifySpeechEnded();
      await sleep(5);
    }
    stt.finalize();
    for (let i = 0; i < 100 && stt.hasPendingWork(); i++) await sleep(20);
    stt.stop();
    await server.close();

    const ups = server.uploads;
    const fakeMinutes = clockOffset / 60_000;
    assert.equal(sentAt.length, ups.length);
    // The last one is finalize(): it goes at once by design.
    for (let i = 1; i < sentAt.length - 1; i++) {
      assert.ok(sentAt[i] - sentAt[i - 1] >= 8_400, `requests ${i - 1} and ${i} only ${sentAt[i] - sentAt[i - 1]} ms apart`);
    }
    assert.ok(ups.length / fakeMinutes <= 7.1, `${ups.length} requests in ${fakeMinutes.toFixed(1)} min`);
    const ratio = billedS(ups) / audioS(ups);
    assert.ok(ratio < 1.25, `Groq bills ${billedS(ups)} s for ${audioS(ups)} s of audio (${ratio.toFixed(2)}x)`);
  });
});

describe('other REST providers keep their 3-6 s chunks', () => {
  test('OpenAI has no billed minimum: its speech end still uploads at once', async () => {
    const stt = new RestSTT('openai', 'sk-test');
    assert.equal(stt.config.minBilledMs, undefined);
    assert.equal(stt.chunkMinMs(), 3_000);
    assert.equal(stt.chunkMaxMs(), 6_000);
    const groqStt = new RestSTT('groq', 'gsk-test');
    groqStt.setRecognitionLanguage('english-us');
    assert.equal(groqStt.config.minBilledMs, 10_000, 'a language change dropped the billed minimum');
    assert.equal(groqStt.chunkMaxMs(), 11_500);
  });
});

// main.ts is not loadable here (Electron), so its three hooks are checked in
// the source, as RestSttSafetyNetGate.test.mjs does for RestSTT.
describe('main.ts wiring', () => {
  const fs = require('node:fs');
  const main = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');

  test('only the user\'s mic holds speech ends', () => {
    assert.match(main, /if \(speaker === 'user'\) rest\.setHoldSpeechEnds\(true\)/);
    assert.equal((main.match(/setHoldSpeechEnds\(/g) || []).length, 1);
  });

  test('the interviewer starting and stopping both release the user\'s held words', () => {
    const edge = /edge\?\.channel === 'interviewer' && edge\.speaking\) \{[\s\S]{0,400}?this\.googleSTT_User\?\.releaseHeldSpeech\?\.\(\)/;
    assert.match(main, edge);
    const end = /this\._sttFailover\.system\?\.notifySpeechEnded\(\);[\s\S]{0,200}?this\.googleSTT_User\?\.releaseHeldSpeech\?\.\(\)/;
    assert.match(main, end);
  });

  test('meeting end waits for a REST upload still on its way before stop()', () => {
    const i = main.indexOf('restStts.some((s) => s.hasPendingWork())');
    const stop = main.indexOf('this.googleSTT?.stop();\n        this.googleSTT_User?.stop();');
    assert.ok(i > 0 && stop > i, 'the wait is missing or comes after stop()');
  });
});
