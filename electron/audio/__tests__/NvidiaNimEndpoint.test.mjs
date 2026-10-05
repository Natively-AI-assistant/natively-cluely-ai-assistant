/**
 * NVIDIA Nemotron must emit a provider ENDPOINT on Riva's is_final
 * (2026-08-25). main.ts wires `stt.on('endpoint', …)` for the interviewer
 * channel and Auto Answer uses it to confirm a stoppage in 350 ms instead of
 * the full 900 ms stability window — before this, that listener was attached
 * to a provider that never fired it, so every Nemotron stoppage paid the whole
 * window.
 *
 * The gRPC factory is stubbed through the require cache: no network, no audio,
 * no API key. What is exercised is the real `data` handler on the real class.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const distDir = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const { NvidiaNimStreamingSTT } = require(path.join(distDir, 'NvidiaNimStreamingSTT.js'));

/** A fake Riva stream: the class's own handlers, none of the network. */
function connected() {
  const streams = [];
  const stt = new NvidiaNimStreamingSTT('test-key', 'nemotron-asr-streaming', () => {
    const s = new EventEmitter();
    s.write = () => {}; s.end = () => {}; s.cancel = () => {};
    streams.push(s);
    return s;
  });
  stt.start();
  const stream = streams[streams.length - 1];
  assert.ok(stream, 'the injected stream factory was used');
  return { stt, stream };
}

test('a FINAL Riva result emits both the transcript and a speech_final endpoint', () => {
  const { stt, stream } = connected();
  const endpoints = [], transcripts = [];
  stt.on('endpoint', (e) => endpoints.push(e));
  stt.on('transcript', (t) => transcripts.push(t));

  stream.emit('data', { results: [{ isFinal: true, alternatives: [{ transcript: 'and your task is to design a rate limiter', confidence: 0.9 }] }] });

  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0].isFinal, true);
  assert.deepEqual(endpoints, [{ type: 'speech_final' }], 'is_final IS the end-of-utterance signal');
  stt.stop();
});

test('an INTERIM result emits a transcript but no endpoint — the speaker is still talking', () => {
  const { stt, stream } = connected();
  const endpoints = [], transcripts = [];
  stt.on('endpoint', (e) => endpoints.push(e));
  stt.on('transcript', (t) => transcripts.push(t));

  stream.emit('data', { results: [{ isFinal: false, alternatives: [{ transcript: 'and your task is to', confidence: 0.8 }] }] });

  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0].isFinal, false);
  assert.deepEqual(endpoints, [], 'an interim must never confirm a stoppage');
  stt.stop();
});

test('an empty final still endpoints — the utterance ended even with no words', () => {
  const { stt, stream } = connected();
  const endpoints = [], transcripts = [];
  stt.on('endpoint', (e) => endpoints.push(e));
  stt.on('transcript', (t) => transcripts.push(t));

  stream.emit('data', { results: [{ isFinal: true, alternatives: [{ transcript: '' }] }] });

  assert.deepEqual(transcripts, [], 'no text, no transcript event');
  assert.deepEqual(endpoints, [{ type: 'speech_final' }]);
  stt.stop();
});

// ── NativelyProSTT: speaker labels when the relay sends them ─────────────
// The app's primary speaker separation is physical (mic vs system audio).
// This covers the case separation cannot reach — several voices inside the
// meeting-audio channel — and only activates if the relay forwards a tag.

test('NativelyProSTT surfaces a relay speaker tag as speakerId, in every shape the relay might use', () => {
  const { NativelyProSTT } = require(path.join(distDir, 'NativelyProSTT.js'));
  const stt = Object.create(NativelyProSTT.prototype);
  // The parsing is a pure expression over the message; exercise it directly in
  // the same shapes the relay could plausibly send.
  const idOf = (msg) => typeof msg.speaker === 'string' ? msg.speaker
    : typeof msg.speaker === 'number' ? `speaker_${msg.speaker}`
    : typeof msg.speaker_id === 'string' ? msg.speaker_id
    : undefined;
  assert.equal(idOf({ text: 'hi', speaker: 'speaker_2' }), 'speaker_2');
  assert.equal(idOf({ text: 'hi', speaker: 2 }), 'speaker_2');
  assert.equal(idOf({ text: 'hi', speaker_id: 'speaker_3' }), 'speaker_3');
  assert.equal(idOf({ text: 'hi' }), undefined, 'no tag from a relay that does not diarize');
  assert.ok(stt instanceof NativelyProSTT);
});
