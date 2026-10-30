/**
 * NativelyProSTT — the relay's `language_heard` frame (2026-10-29).
 *
 * Auto language used to lock onto the first language recognised: natively-api
 * sent `language_detected`, and on any provider but Soniox this client
 * reconnected pinned to it for the rest of the meeting. The relay now keeps
 * every provider multilingual in auto mode and reports each change of language
 * as `language_heard`. The client shows it (the 'languageDetected' event feeds
 * the settings label) and must never reconnect for it, on any provider.
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

for (const provider of ['deepgram', 'elevenlabs', 'soniox']) {
  test(`${provider}: each language_heard is reported and the stream stays in auto, unpinned`, async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise((r) => wss.on('listening', r));
    const auths = [];
    let sock;
    wss.on('connection', (s) => {
      sock = s;
      s.once('message', (raw) => {
        try { auths.push(JSON.parse(raw.toString())); } catch { auths.push(null); }
        s.send(JSON.stringify({ status: 'connected', provider }));
      });
    });
    const stt = new NativelyProSTT('natively-test-key', 'system', { flags: { isRelayEnabled: () => false } });
    stt.BACKEND_URL = `ws://127.0.0.1:${wss.address().port}/v1/transcribe`;
    stt.setRecognitionLanguage?.('auto');
    const heard = [];
    stt.on('languageDetected', (lang) => heard.push(lang));
    stt.on('error', () => {});
    try {
      stt.start();
      await until(() => stt.isConnected === true, 5000, 'connect');
      sock.send(JSON.stringify({ language_heard: 'es-ES', provider }));
      sock.send(JSON.stringify({ text: '¿Cómo diseñarías una cola de mensajes?', is_final: true }));
      sock.send(JSON.stringify({ language_heard: 'en-US', provider }));
      await until(() => heard.length >= 2, 3000, 'both reports');
      await new Promise((r) => setTimeout(r, 600));   // a pin reconnect fires after 250 ms
      assert.deepEqual(heard, ['es-ES', 'en-US']);
      assert.equal(auths.length, 1, 'no reconnect for a heard language');
      assert.equal(stt.isConnected, true);
    } finally {
      stt.stop();
      try { sock?.terminate(); } catch {}
      await new Promise((r) => wss.close(r));
    }
  });
}
