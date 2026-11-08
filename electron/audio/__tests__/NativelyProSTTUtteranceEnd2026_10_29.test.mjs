/**
 * NativelyProSTT — the relay's end-of-utterance frame (2026-10-29).
 *
 * natively-api now sends `{"utterance_end":true}` once after each utterance's
 * final text (Deepgram UtteranceEnd/speech_final, Soniox <end>, ElevenLabs
 * commits). The client must turn it into the same 'endpoint' event Deepgram,
 * Soniox and OpenAI emit directly, which is what lets Auto Answer close a
 * question at the speaker's real stop. Before this, a customer on the Natively
 * relay got one merged "question" per stretch of speech.
 *
 * Real socket against a local server, like
 * NativelyProSTTReconnectAfterLanguageDetect2026_09_27.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const origLoad = Module._load;
Module._load = function patchedLoad(request) {
  if (request === 'electron') return { app: { getAppPath: () => '/tmp/fake-natively-app', isPackaged: false, isReady: () => false } };
  return origLoad.apply(this, arguments);
};
const { NativelyProSTT } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/audio/NativelyProSTT.js')).href);
const { WebSocketServer } = require('ws');

function until(cond, ms, what) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => { if (cond()) return resolve(); if (Date.now() - t0 > ms) return reject(new Error(`timeout: ${what}`)); setTimeout(tick, 20); };
    tick();
  });
}

test('each utterance_end frame is one endpoint event, after its final; nothing else changes', async () => {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => wss.on('listening', r));
  let sock;
  wss.on('connection', (s) => {
    sock = s;
    s.once('message', () => s.send(JSON.stringify({ status: 'connected', provider: 'deepgram' })));
  });
  const stt = new NativelyProSTT('natively-test-key', 'system', { flags: { isRelayEnabled: () => false } });
  stt.BACKEND_URL = `ws://127.0.0.1:${wss.address().port}/v1/transcribe`;
  const events = [];
  stt.on('transcript', (t) => events.push(`${t.isFinal ? 'final' : 'partial'}:${t.text}`));
  stt.on('endpoint', (e) => events.push(`endpoint:${e.type}`));
  stt.on('error', (e) => events.push(`error:${e.message}`));
  try {
    stt.start();
    await until(() => stt.isConnected === true, 5000, 'connect');
    sock.send(JSON.stringify({ text: '¿Cómo diseñarías', is_final: false }));
    sock.send(JSON.stringify({ text: '¿Cómo diseñarías una cola de mensajes?', is_final: true }));
    sock.send(JSON.stringify({ utterance_end: true }));
    sock.send(JSON.stringify({ text: '¿Y cómo la escalarías?', is_final: true }));
    sock.send(JSON.stringify({ utterance_end: true }));
    await until(() => events.length >= 5, 3000, 'all frames');
    assert.deepEqual(events, [
      'partial:¿Cómo diseñarías',
      'final:¿Cómo diseñarías una cola de mensajes?',
      'endpoint:utterance_end',
      'final:¿Y cómo la escalarías?',
      'endpoint:utterance_end',
    ]);
    assert.equal(stt.isConnected, true, 'the frame is not an error and does not drop the stream');
  } finally {
    stt.stop();
    try { sock?.terminate(); } catch {}
    await new Promise((r) => wss.close(r));
  }
});
