// electron/audio/__tests__/SttEndpointLatency2026_09_23.test.mjs
//
// Time from "the interviewer stopped talking" to a FINAL transcript, per
// provider. The audit (2026-09-23) found, besides the shared keepalive stretch
// that RealtimeSilenceTail fixes:
//   - ElevenLabs BYOK never committed and ran the default MANUAL strategy, so
//     finals arrived once per ~36 s of audio (the natively-api relay has always
//     sent commit_strategy=vad).
//   - OpenAI ran gpt-4o-transcribe, whose deltas exist only after a server-VAD
//     commit; gpt-live-transcribe streams while the person speaks.
//   - Soniox ran its dictation endpoint defaults (0 / 0.0 / 2000 ms).
//   - Deepgram's smart_format can hold a final up to 3 s of silence on an
//     entity that looks incomplete; no_delay releases it.
//   - OpenAI and ElevenLabs batched 250 ms per message.
//
// These drive the REAL compiled classes over stub sockets. The tail waits use
// real timers (each window is < 1.5 s) and poll for completion, so the byte
// totals asserted are exact, not timing-sensitive.
//
// Platform: no platform branch in any of this — one run covers darwin and win32.
//
// Run: npm run build:electron && node --test electron/audio/__tests__/SttEndpointLatency2026_09_23.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const distDir = path.resolve(repoRoot, 'dist-electron/electron/audio');
const load = (f) => require(path.join(distDir, f));
const src = (rel) => fs.readFileSync(path.resolve(repoRoot, rel), 'utf8');

const { DeepgramStreamingSTT, DEEPGRAM_SILENCE_TAIL_MS } = load('DeepgramStreamingSTT.js');
const { SonioxStreamingSTT, SONIOX_ENDPOINT_TUNING, SONIOX_SILENCE_TAIL_MS } = load('SonioxStreamingSTT.js');
const { ElevenLabsStreamingSTT, ELEVENLABS_SILENCE_TAIL_MS, ELEVENLABS_SEND_THRESHOLD_SAMPLES, ELEVENLABS_VAD_SILENCE_SECS } = load('ElevenLabsStreamingSTT.js');
const { OpenAIStreamingSTT, OPENAI_SILENCE_TAIL_MS, OPENAI_LIVE_TRANSCRIBE_DELAY, SEND_THRESHOLD_SAMPLES } = load('OpenAIStreamingSTT.js');
const { NvidiaNimStreamingSTT, NVIDIA_NIM_SILENCE_TAIL_MS } = load('NvidiaNimStreamingSTT.js');

const WS_OPEN = 1;
const BYTES_PER_MS_16K = 32; // 16 kHz mono int16

async function until(cond, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const speech = (ms) => Buffer.alloc(ms * BYTES_PER_MS_16K, 0x11);
const zeros = (ms) => Buffer.alloc(ms * BYTES_PER_MS_16K);

describe('shared keepalive stretch: each server-endpointing provider gets a real-time silence tail', { concurrency: true }, () => {
  test('Deepgram: 700 ms of real silence after speech end, and resumed speech ends it', async () => {
    const stt = new DeepgramStreamingSTT('k');
    let sent = 0;
    stt.isActive = true; stt.isOpen = true;
    stt.live = { send: (c) => { sent += c.length; } };
    stt.notifySpeechEnded();
    await until(() => !stt.silenceTail.active);
    assert.equal(DEEPGRAM_SILENCE_TAIL_MS, 700);
    assert.equal(sent, 700 * BYTES_PER_MS_16K);

    // write() feeds the tail: speech after the grace window ends it at once.
    sent = 0;
    stt.notifySpeechEnded();
    await new Promise((r) => setTimeout(r, 200));
    stt.write(speech(60));
    assert.equal(stt.silenceTail.active, false);
    stt.isActive = false;
  });

  test('Soniox: 1200 ms tail (covers its 1500 ms endpoint cap with the hangover)', async () => {
    const stt = new SonioxStreamingSTT('k');
    let sent = 0;
    stt.isActive = true; stt.configSent = true;
    stt.ws = { readyState: WS_OPEN, send: (c) => { if (Buffer.isBuffer(c)) sent += c.length; } };
    stt.notifySpeechEnded();
    await until(() => !stt.silenceTail.active);
    assert.equal(sent, SONIOX_SILENCE_TAIL_MS * BYTES_PER_MS_16K);
    stt.isActive = false; stt.ws = null;
  });

  test('ElevenLabs: 600 ms tail, sent in 100 ms messages carrying the required fields', async () => {
    const stt = new ElevenLabsStreamingSTT('k');
    const msgs = [];
    stt.isActive = true; stt.isSessionReady = true;
    stt.setSampleRate(16000);
    stt.ws = { readyState: WS_OPEN, send: (p) => msgs.push(JSON.parse(p)), close() {} };
    stt.notifySpeechEnded();
    await until(() => !stt.silenceTail.active);
    const sentBytes = msgs.reduce((n, m) => n + Buffer.from(m.audio_base_64, 'base64').length, 0);
    assert.equal(sentBytes + stt.pcmAccumulatorLen * 2, ELEVENLABS_SILENCE_TAIL_MS * BYTES_PER_MS_16K);
    for (const m of msgs) {
      assert.equal(m.message_type, 'input_audio_chunk');
      assert.equal(m.commit, false);
      assert.equal(m.sample_rate, 16000);
    }
    stt.isActive = false; stt.ws = null;
  });

  test('OpenAI (server-VAD models): 700 ms tail after speech end', async () => {
    const stt = new OpenAIStreamingSTT('sk-test');
    const msgs = [];
    stt.isActive = true; stt.isSessionReady = true; stt.mode = 'ws';
    stt.wsModelIndex = 1; // gpt-4o-transcribe
    stt.ws = { readyState: WS_OPEN, send: (p) => msgs.push(JSON.parse(p)) };
    stt.notifySpeechEnded();
    await until(() => !stt.silenceTail.active);
    const appended = msgs.filter((m) => m.type === 'input_audio_buffer.append')
      .reduce((n, m) => n + Buffer.from(m.audio, 'base64').length / 2, 0) + stt.pcmAccumulatorLen;
    const expected = OPENAI_SILENCE_TAIL_MS * 24; // resampled to 24 kHz
    assert.ok(Math.abs(appended - expected) <= expected * 0.02, `appended ${appended} samples, expected ~${expected}`);
    assert.ok(!msgs.some((m) => m.type === 'input_audio_buffer.commit'), 'server VAD commits, not the client');
    stt.isActive = false; stt.ws = null;
  });

  test('NVIDIA NIM (Riva): 700 ms tail', async () => {
    const stt = new NvidiaNimStreamingSTT('k', undefined, () => { throw new Error('no network in tests'); });
    let sent = 0;
    stt.active = true;
    stt.stream = { write: (o) => { if (o.audioContent) sent += o.audioContent.length; } };
    stt.notifySpeechEnded();
    await until(() => !stt.silenceTail.active);
    assert.equal(sent, NVIDIA_NIM_SILENCE_TAIL_MS * BYTES_PER_MS_16K);
    stt.active = false; stt.stream = null;
  });

  test('Google gets NO tail: it drops all-zero chunks on purpose (GoogleSTTDropsKeepaliveSilence)', () => {
    const google = src('electron/audio/GoogleSTT.ts');
    assert.doesNotMatch(google, /RealtimeSilenceTail/);
    assert.match(google, /if \(this\.isAllZeroChunk\(audioData\)\) return;/);
  });

  test('main.ts delivers the local speech end to BOTH channels\' providers', () => {
    const main = src('electron/main.ts');
    assert.match(main, /this\.googleSTT\?\.notifySpeechEnded\?\.\(\);/);
    assert.match(main, /this\.googleSTT_User\?\.notifySpeechEnded\?\.\(\);/);
  });
});

describe('Deepgram: smart_format no longer holds finals', () => {
  test('no_delay: true rides with smart_format', () => {
    const dg = src('electron/audio/DeepgramStreamingSTT.ts');
    const opts = dg.slice(dg.indexOf('deepgram.listen.live({'), dg.indexOf('});', dg.indexOf('deepgram.listen.live({')));
    assert.match(opts, /smart_format: true,/);
    assert.match(opts, /no_delay: true,/);
  });
});

describe('Soniox: voice-AI endpoint tuning', () => {
  test('the config frame carries Soniox\'s own recommended starting point', () => {
    const stt = new SonioxStreamingSTT('k');
    const frame = stt.buildConfigFrame();
    assert.equal(frame.model, 'stt-rt-v5', 'the tuning knobs are v5-only');
    assert.equal(frame.enable_endpoint_detection, true);
    assert.deepEqual(
      { level: frame.endpoint_latency_adjustment_level, sens: frame.endpoint_sensitivity, max: frame.max_endpoint_delay_ms },
      { level: 2, sens: 0.3, max: 1500 },
    );
    assert.deepEqual(SONIOX_ENDPOINT_TUNING, { endpoint_latency_adjustment_level: 2, endpoint_sensitivity: 0.3, max_endpoint_delay_ms: 1500 });
  });
});

describe('ElevenLabs: finals every ~0.8 s of silence, not every ~36 s of audio', () => {
  test('THE BUG: the session asks for VAD commits', () => {
    const el = src('electron/audio/ElevenLabsStreamingSTT.ts');
    assert.match(el, /&commit_strategy=vad&vad_silence_threshold_secs=\$\{ELEVENLABS_VAD_SILENCE_SECS\}/);
    assert.equal(ELEVENLABS_VAD_SILENCE_SECS, 0.8);
    assert.ok(ELEVENLABS_VAD_SILENCE_SECS >= 0.3 && ELEVENLABS_VAD_SILENCE_SECS <= 3.0, 'inside the documented range');
  });

  test('audio goes out every 100 ms, not every 250 ms', () => {
    assert.equal(ELEVENLABS_SEND_THRESHOLD_SAMPLES, 1600);
    const stt = new ElevenLabsStreamingSTT('k');
    const msgs = [];
    stt.isActive = true; stt.isSessionReady = true; stt.setSampleRate(16000);
    stt.ws = { readyState: WS_OPEN, send: (p) => msgs.push(JSON.parse(p)), close() {} };
    stt.write(speech(100));
    assert.equal(msgs.length, 1, '100 ms of audio is one message');
    stt.isActive = false; stt.ws = null;
  });

  // LIVE (2026-09-23): a commit with < 0.3 s of uncommitted audio is answered
  // with commit_throttled AND the server closes the socket (1000,
  // "commit_throttled"). The VAD's own commits are invisible until their
  // transcript arrives, so the client can never know a manual commit is safe.
  test('"Answer now" flushes pending audio but NEVER commits (a short commit kills the session)', () => {
    const stt = new ElevenLabsStreamingSTT('k');
    const msgs = [];
    stt.isActive = true; stt.isSessionReady = true; stt.setSampleRate(16000);
    stt.ws = { readyState: WS_OPEN, send: (p) => msgs.push(JSON.parse(p)), close() {} };
    stt.finalize();
    assert.equal(msgs.length, 0, 'nothing buffered → nothing sent');
    stt.write(speech(50));
    stt.finalize();
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].commit, false);
    assert.equal(Buffer.from(msgs[0].audio_base_64, 'base64').length, 50 * BYTES_PER_MS_16K);
    assert.doesNotMatch(src('electron/audio/ElevenLabsStreamingSTT.ts'), /audioMessage\([^)]*,\s*true\)/);
    stt.isActive = false; stt.ws = null;
  });

  test('one commit reported twice (plain + with_timestamps) is ONE final', () => {
    const stt = new ElevenLabsStreamingSTT('k');
    const finals = [];
    stt.on('transcript', (t) => { if (t.isFinal) finals.push(t.text); });
    stt.emitCommitted('Why Postgres?');
    stt.emitCommitted('Why Postgres?');
    assert.deepEqual(finals, ['Why Postgres?']);
    assert.match(src('electron/audio/ElevenLabsStreamingSTT.ts'), /case 'committed_transcript_with_timestamps':/);
  });
});

describe('OpenAI: gpt-live-transcribe first, committed at the local speech end', () => {
  const ready = (modelIndex = 0) => {
    const stt = new OpenAIStreamingSTT('sk-test');
    const msgs = [];
    stt.isActive = true; stt.isSessionReady = true; stt.mode = 'ws';
    stt.wsModelIndex = modelIndex;
    stt.ws = { readyState: WS_OPEN, send: (p) => msgs.push(JSON.parse(p)), removeAllListeners() {}, close() {}, on() {} };
    return { stt, msgs, done: () => { stt.isActive = false; stt.ws = null; } };
  };

  test('100 ms appends (was 250 ms)', () => {
    assert.equal(SEND_THRESHOLD_SAMPLES, 2400);
  });

  test('live session: turn_detection null, delay, `languages` list, no noise_reduction', () => {
    const { stt, done } = ready();
    stt.languageKey = 'english-us';
    const upd = stt._buildSessionUpdate('gpt-live-transcribe');
    const input = upd.session.audio.input;
    assert.equal(upd.session.type, 'transcription');
    assert.deepEqual(input.format, { type: 'audio/pcm', rate: 24000 });
    assert.deepEqual(input.transcription, { model: 'gpt-live-transcribe', delay: OPENAI_LIVE_TRANSCRIBE_DELAY, languages: ['en'] });
    assert.equal(OPENAI_LIVE_TRANSCRIBE_DELAY, 'low');
    assert.ok('turn_detection' in input && input.turn_detection === null);
    assert.ok(!('noise_reduction' in input));
    done();
  });

  test('fallback session keeps the server-VAD shape it had', () => {
    const { stt, done } = ready(1);
    stt.languageKey = 'english-us';
    const input = stt._buildSessionUpdate('gpt-4o-transcribe').session.audio.input;
    assert.deepEqual(input.transcription, { model: 'gpt-4o-transcribe', language: 'en' });
    assert.equal(input.turn_detection.type, 'server_vad');
    assert.equal(input.turn_detection.silence_duration_ms, 1000);
    assert.deepEqual(input.noise_reduction, { type: 'near_field' });
    done();
  });

  test('speech end commits the live turn (after flushing what is buffered)', () => {
    const { stt, msgs, done } = ready();
    stt.write(speech(200));
    stt.notifySpeechEnded();
    const types = msgs.map((m) => m.type);
    assert.equal(types.at(-1), 'input_audio_buffer.commit');
    assert.ok(types.indexOf('input_audio_buffer.append') < types.lastIndexOf('input_audio_buffer.commit'));
    assert.equal(stt.silenceTail.active, false, 'no tail on the live model — the commit IS the endpoint');
    done();
  });

  test('never commits keepalive-only or < 100 ms buffers (each rejected commit is an upstream error)', () => {
    const a = ready();
    a.stt.write(zeros(400));
    a.stt.notifySpeechEnded();
    assert.ok(!a.msgs.some((m) => m.type === 'input_audio_buffer.commit'), 'zeros only');
    a.done();
    const b = ready();
    b.stt.write(speech(50));
    b.stt.notifySpeechEnded();
    assert.ok(!b.msgs.some((m) => m.type === 'input_audio_buffer.commit'), '50 ms');
    b.done();
  });

  test('live events: deltas preview per item, completed is the final + endpoint', () => {
    const { stt, done } = ready();
    const out = []; let endpoints = 0;
    stt.on('transcript', (t) => out.push(`${t.isFinal ? 'F' : 'P'}:${t.text}`));
    stt.on('endpoint', () => { endpoints++; });
    stt._handleWsMessage({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'a', delta: 'Why did' });
    stt._handleWsMessage({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'a', delta: ' you' });
    stt._handleWsMessage({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'b', delta: 'And' });
    stt._handleWsMessage({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'a', transcript: 'Why did you?' });
    assert.deepEqual(out, ['P:Why did', 'P:Why did you', 'P:Why did you And', 'F:Why did you?', 'P:And']);
    assert.equal(endpoints, 1);
    done();
  });

  test('server-VAD models: the final lands on the completed that FOLLOWS speech_stopped, not a turn later', () => {
    // Live capture order (gpt-4o-transcribe): speech_stopped → delta… → completed.
    const { stt, done } = ready(1);
    const out = [];
    stt.on('transcript', (t) => out.push(`${t.isFinal ? 'F' : 'P'}:${t.text}`));
    stt._handleWsMessage({ type: 'input_audio_buffer.speech_started' });
    stt._handleWsMessage({ type: 'input_audio_buffer.speech_stopped' });
    stt._handleWsMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Why did' });
    stt._handleWsMessage({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Why did you?' });
    assert.deepEqual(out, ['P:Why did', 'F:Why did you?']);
    done();
  });

  test('stop() finalizes pending live text (nothing more will complete)', () => {
    const { stt } = ready();
    const finals = [];
    stt.on('transcript', (t) => { if (t.isFinal) finals.push(t.text); });
    stt._handleWsMessage({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'a', delta: 'tail words' });
    stt.stop();
    assert.deepEqual(finals, ['tail words']);
  });

  test('an account without the live model steps down silently, once per process', () => {
    const { stt, done } = ready();
    let connects = 0; const errors = [];
    stt._connectWs = () => { connects++; };
    stt.on('error', (e) => errors.push(e));
    stt.sessionConfigAcked = false;
    stt._handleWsMessage({ type: 'error', error: { message: "Invalid value: 'gpt-live-transcribe'.", param: 'session.audio.input.transcription.model' } });
    assert.equal(stt.wsModelIndex, 1, 'now on gpt-4o-transcribe');
    assert.equal(connects, 1);
    assert.equal(errors.length, 0, 'not a user-facing STT failure');
    assert.equal(OpenAIStreamingSTT.liveModelRejected, true);
    OpenAIStreamingSTT.liveModelRejected = false;
    done();
  });

  test('errors AFTER the session config was accepted are still real errors', () => {
    const { stt, done } = ready();
    const errors = [];
    stt.on('error', (e) => errors.push(e));
    stt._handleWsMessage({ type: 'session.updated' });
    stt._handleWsMessage({ type: 'error', error: { message: 'model overloaded', param: null } });
    assert.equal(errors.length, 1);
    assert.equal(stt.wsModelIndex, 0);
    done();
  });
});
