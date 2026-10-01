// After the auto-language reconnect, a real network drop must still reconnect.
//
// Live 2026-09-27 (looking for work, Natively STT, auto language): every
// session starts with the server's `language_detected` → the client sets
// `intentionalClose = true`, closes the socket and dials again. closeUpstream()
// DETACHES the dying socket's 'close' listener (21c4e22f, 2026-08-09), so the
// handler that consumes the flag never ran and it stayed TRUE on the healthy
// new socket. Minutes later the relay dropped with 1006 — read as intentional,
// no reconnect, both channels buffered with ws=null for the rest of the
// meeting: no transcript, so no Auto Answer. Shipped in V2.8.8.
//
// A REAL WebSocket server on loopback drives the real class.
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

test('a 1006 drop after the language-detect reconnect schedules a reconnect', async () => {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => wss.on('listening', r));
  const sockets = [];
  wss.on('connection', (sock) => {
    sockets.push(sock);
    const n = sockets.length;
    sock.once('message', () => {                        // the auth frame
      sock.send(JSON.stringify({ status: 'connected', provider: 'test' }));
      if (n === 1) sock.send(JSON.stringify({ language_detected: 'en-US' }));
    });
  });
  const stt = new NativelyProSTT('natively-test-key', 'system', { flags: { isRelayEnabled: () => false } });
  stt.BACKEND_URL = `ws://127.0.0.1:${wss.address().port}/v1/transcribe`;
  try {
    stt.start();
    await until(() => sockets.length >= 2, 5000, 'the language-detect reconnect');
    await until(() => stt.isConnected === true, 5000, 'the second socket to connect');
    sockets[1].terminate();                               // abrupt drop → 1006 on the client
    await until(() => sockets.length >= 3, 5000, 'a reconnect after the drop');
    assert.ok(sockets.length >= 3);
  } finally {
    stt.stop();
    for (const s of sockets) { try { s.terminate(); } catch {} }
    await new Promise((r) => wss.close(r));
  }
});
