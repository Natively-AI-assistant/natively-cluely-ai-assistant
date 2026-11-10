/**
 * NativelyProSTT — the end-of-stream finish handshake (2026-11-10).
 *
 * A meeting that ended right after someone spoke lost that sentence whole: the
 * app closed the socket at once and every provider holds its final until it
 * hears silence. natively-api now advertises `finish: true` on `connected`;
 * finish() then sends {"type":"finish"}, the server flushes its provider and
 * answers {"type":"finished"}, and hasPendingWork() covers the wait.
 *
 * An older server reads every text frame as audio, so without the flag
 * nothing is sent. finalize() (mid-meeting: Answer flushes the mic) never
 * sends it either: the stream keeps going after it.
 *
 * Real socket against a local server, like NativelyProSTTUtteranceEnd2026_10_29.
 * Platform-neutral (the same code runs on macOS and Windows).
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
const { NativelyProSTT, NATIVELY_FINISH_WAIT_MS } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/audio/NativelyProSTT.js')).href);
const { WebSocketServer } = require('ws');

function until(cond, ms, what) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => { if (cond()) return resolve(); if (Date.now() - t0 > ms) return reject(new Error(`timeout: ${what}`)); setTimeout(tick, 20); };
    tick();
  });
}

/** A fake natively-api: records every text frame after auth; `connected` says what it supports. */
async function server(connected) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => wss.on('listening', r));
  const s = { wss, sock: null, texts: [], binaries: 0 };
  wss.on('connection', (sock) => {
    s.sock = sock;
    let authed = false;
    sock.on('message', (d, isBinary) => {
      if (!authed) { authed = true; sock.send(JSON.stringify(connected)); return }
      if (isBinary) s.binaries++; else s.texts.push(d.toString());
    });
  });
  return s;
}

async function client(s) {
  const stt = new NativelyProSTT('natively-test-key', 'system', { flags: { isRelayEnabled: () => false } });
  stt.BACKEND_URL = `ws://127.0.0.1:${s.wss.address().port}/v1/transcribe`;
  const events = [];
  stt.on('transcript', (t) => events.push(`${t.isFinal ? 'final' : 'partial'}:${t.text}`));
  stt.on('error', () => {});
  stt.start();
  await until(() => stt.isConnected === true, 5000, 'connect');
  return { stt, events };
}

async function done(stt, s) {
  stt.stop();
  try { s.sock?.terminate(); } catch {}
  await new Promise((r) => s.wss.close(r));
}

test('finish: sent once to a server that supports it; pending until `finished`; the last final still arrives', async () => {
  const s = await server({ status: 'connected', provider: 'soniox', finish: true });
  const { stt, events } = await client(s);
  try {
    assert.equal(stt.hasPendingWork(), false);
    assert.equal(stt.finish(), true);
    assert.equal(stt.finish(), true, 'a second call while waiting is not a second request');
    await until(() => s.texts.length >= 1, 2000, 'finish frame');
    assert.deepEqual(s.texts.map((t) => JSON.parse(t)), [{ type: 'finish' }]);
    assert.equal(stt.hasPendingWork(), true);
    s.sock.send(JSON.stringify({ text: 'how did you handle consumer lag', is_final: true }));
    s.sock.send(JSON.stringify({ type: 'finished', reason: 'flushed' }));
    await until(() => stt.hasPendingWork() === false, 2000, 'finished clears the wait');
    assert.deepEqual(events, ['final:how did you handle consumer lag']);
    assert.equal(stt.isConnected, true, '`finished` is not an error and does not drop the stream');
  } finally { await done(stt, s); }
});

test('finish: an older server (no flag) gets nothing, since it would read the text frame as audio', async () => {
  const s = await server({ status: 'connected', provider: 'deepgram' });
  const { stt } = await client(s);
  try {
    assert.equal(stt.finish(), false);
    assert.equal(stt.hasPendingWork(), false);
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(s.texts, []);
  } finally { await done(stt, s); }
});

test('finalize() (mid-meeting Answer) never sends finish', async () => {
  const s = await server({ status: 'connected', provider: 'soniox', finish: true });
  const { stt } = await client(s);
  try {
    stt.finalize();
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(s.texts, []);
    assert.equal(stt.hasPendingWork(), false);
  } finally { await done(stt, s); }
});

test('finish: the wait ends when the socket closes, and is bounded when the server never answers', async () => {
  assert.ok(NATIVELY_FINISH_WAIT_MS >= 2_620 && NATIVELY_FINISH_WAIT_MS <= 5_000, 'covers the server limit (2.5 s + 120 ms settle) and stays inside the 5 s meeting-end wait');
  const s = await server({ status: 'connected', provider: 'elevenlabs', finish: true });
  const { stt } = await client(s);
  try {
    assert.equal(stt.finish(), true);
    assert.equal(stt.hasPendingWork(), true);
    s.sock.close(1000);
    await until(() => stt.hasPendingWork() === false, 2000, 'close ends the wait');
  } finally { await done(stt, s); }
});

test('stop() clears a pending finish', async () => {
  const s = await server({ status: 'connected', provider: 'soniox', finish: true });
  const { stt } = await client(s);
  try {
    assert.equal(stt.finish(), true);
    stt.stop();
    assert.equal(stt.hasPendingWork(), false);
  } finally { await done(stt, s); }
});

test('meeting end and dictation end ask for the last words, and the meeting-end wait covers Natively Pro', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');
  assert.match(main, /for \(const s of \[this\.googleSTT, this\.googleSTT_User\]\) if \(s instanceof NativelyProSTT\) s\.finish\(\);/);
  assert.match(main, /filter\(\(s\): s is RestSTT \| NativelyProSTT => s instanceof RestSTT \|\| s instanceof NativelyProSTT\)/);
  // the wait still runs AFTER finish was sent and BEFORE the sockets are stopped
  const iFinish = main.indexOf('s.finish();'), iWait = main.indexOf('s instanceof RestSTT || s instanceof NativelyProSTT'), iStop = main.indexOf('// 2. Tear down STT sockets now that finals have arrived.');
  assert.ok(iFinish > 0 && iFinish < iWait && iWait < iStop);
  const dictation = readFileSync(path.resolve(__dirname, '../../services/dictation/dictationSession.ts'), 'utf8');
  assert.match(dictation, /\(stt as \{ finish\?: \(\) => unknown \}\)\.finish\?\.\(\)/);
});
