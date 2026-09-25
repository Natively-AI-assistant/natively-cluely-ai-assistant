// The hosted Natively STT path (NativelyProSTT → natively-api relay → Soniox)
// must finalize an utterance soon after the speaker stops (2026-09-24).
//
// Measured live in a two-channel meeting: the interviewer's words were only
// finalized when the interviewer spoke AGAIN — a sentence could sit unfinal
// for a minute, and the transcript then showed the user's reply in the middle
// of the interviewer's sentence. Mechanism: after the native hangover the
// client sends one 20 ms keepalive per 100 ms, so the provider's audio clock
// runs at 1/5 speed; the relay's VAD gate stops forwarding after 2.5 s of wall
// time without voice, before Soniox has seen its 0.9 s of AUDIO silence. PR 599
// fixed exactly this with RealtimeSilenceTail for the direct providers, but
// NativelyProSTT — the default hosted path — kept notifySpeechEnded() a no-op.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { NativelyProSTT } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/audio/NativelyProSTT.js')).href);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BYTES_PER_MS = 16000 * 2 / 1000;  // 16 kHz mono int16

function connected(channel) {
  const stt = new NativelyProSTT('fake-key', channel);
  stt.connect = () => {};
  const sent = [];
  stt.start();
  stt.isConnected = true;
  stt.ws = { readyState: 1, send: (b) => sent.push({ at: Date.now(), bytes: b.length }), close() {}, removeAllListeners() {}, on() {} };
  return { stt, sent };
}

test('after speech ends, ~1 s of real-time silence reaches the server within ~1.5 s', async () => {
  const { stt, sent } = connected('system');
  try {
    const speech = Buffer.alloc(640, 1);  // 20 ms of non-silent audio
    for (let i = 0; i < 30; i++) { stt.write(speech); await sleep(20); }
    stt.notifySpeechEnded();
    const endedAt = Date.now();
    const keepalive = Buffer.alloc(640);  // the native keepalive: 20 ms of zeros per 100 ms
    while (Date.now() - endedAt < 1500) { stt.write(keepalive); await sleep(100); }
    const after = sent.filter((s) => s.at >= endedAt).reduce((a, s) => a + s.bytes, 0);
    assert.ok(after >= 1000 * BYTES_PER_MS,
      `only ${Math.round(after / BYTES_PER_MS)} ms of audio reached the server in the 1.5 s after speech ended`);
  } finally { stt.stop(); }
});

test('the tail is bounded — long silence goes back to keepalive cadence', async () => {
  const { stt, sent } = connected('mic');
  try {
    stt.write(Buffer.alloc(640, 1));
    stt.notifySpeechEnded();
    const endedAt = Date.now();
    while (Date.now() - endedAt < 3000) { stt.write(Buffer.alloc(640)); await sleep(100); }
    const after = sent.filter((s) => s.at >= endedAt).reduce((a, s) => a + s.bytes, 0);
    assert.ok(after <= 2200 * BYTES_PER_MS, `${Math.round(after / BYTES_PER_MS)} ms sent over 3 s of silence — the tail must stop`);
  } finally { stt.stop(); }
});

test('stop() cancels a running tail', async () => {
  const { stt, sent } = connected('system');
  stt.write(Buffer.alloc(640, 1));
  stt.notifySpeechEnded();
  stt.stop();
  const n = sent.length;
  await sleep(400);
  assert.equal(sent.length, n, 'no silence may be sent after stop()');
});
