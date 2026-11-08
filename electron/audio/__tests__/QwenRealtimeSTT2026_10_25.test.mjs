// QwenRealtimeSTT (PR #671): the parts that need no live DashScope socket.
// Loads the compiled class like the Soniox tests do and hands it a fake open
// socket, so the real resampler, queue cap, language map and stop() run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patchedLoad(request) {
  if (request === 'electron') {
    return { app: { getAppPath: () => '/tmp/fake-natively-app', isPackaged: false, isReady: () => false } };
  }
  return origLoad.apply(this, arguments);
};

const { QwenRealtimeSTT } = await import(pathToFileURL(path.join(distRoot, 'QwenRealtimeSTT.js')).href);

/** An open socket that records what is sent (readyState 1 = OPEN). */
function openSocket() {
  return { readyState: 1, sent: [], send(m) { this.sent.push(JSON.parse(m)); }, on() {}, close() {}, terminate() {} };
}

function tone(rate, channels, ms, value) {
  const frames = Math.round(rate * ms / 1000);
  const buf = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames * channels; i++) buf.writeInt16LE(value, i * 2);
  return buf;
}

function live(stt, sock) {
  stt.active = true;
  stt.ready = true;
  stt.socket = sock;
}

test('48 kHz stereo is sent as 16 kHz mono, the two channels averaged', () => {
  const stt = new QwenRealtimeSTT('k');
  stt.setSampleRate(48000);
  stt.setAudioChannelCount(2);
  const sock = openSocket();
  live(stt, sock);
  const chunk = Buffer.alloc(480 * 2 * 2); // 10 ms, left 1000, right 3000
  for (let i = 0; i < 480; i++) { chunk.writeInt16LE(1000, i * 4); chunk.writeInt16LE(3000, i * 4 + 2); }
  stt.write(chunk);
  const append = sock.sent.find((e) => e.type === 'input_audio_buffer.append');
  const pcm = Buffer.from(append.audio, 'base64');
  assert.equal(pcm.length, 160 * 2);
  assert.equal(pcm.readInt16LE(0), 2000);
});

test('audio before the session is ready is held, at most 2 s of it', () => {
  const stt = new QwenRealtimeSTT('k');
  stt.setSampleRate(16000);
  stt.active = true;
  for (let i = 0; i < 30; i++) stt.write(tone(16000, 1, 100, 500));
  assert.ok(stt.queuedBytes <= 16000 * 2 * 2, `queued ${stt.queuedBytes} bytes`);
  assert.ok(stt.queuedBytes > 0);
});

test('language: auto and unsupported languages send no hint; French sends fr', () => {
  const stt = new QwenRealtimeSTT('k');
  stt.setRecognitionLanguage('auto');
  assert.equal(stt.language, undefined);
  stt.setRecognitionLanguage('french');
  assert.equal(stt.language, 'fr');
  stt.setRecognitionLanguage('greek'); // a real key, but not one Qwen transcribes
  assert.equal(stt.language, undefined);
  stt.setRecognitionLanguage('french');
  stt.setRecognitionLanguage('no-such-language');
  assert.equal(stt.language, undefined);
});

test('stop() asks the server to finish instead of dropping the last utterance', () => {
  const stt = new QwenRealtimeSTT('k');
  const sock = openSocket();
  live(stt, sock);
  stt.stop();
  assert.equal(sock.sent.at(-1).type, 'session.finish');
  assert.equal(stt.socket, null);
});
