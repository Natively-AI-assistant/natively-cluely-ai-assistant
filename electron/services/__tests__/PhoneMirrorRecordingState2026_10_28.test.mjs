// electron/services/__tests__/PhoneMirrorRecordingState2026_10_28.test.mjs
//
// "Tapping Answer on the phone silently starts recording the laptop mic." The
// phone's Answer chip toggles the overlay's Answer / Stop recording, but the
// phone never heard whether a recording was running, so it kept reading
// "Answer" and nobody knew a second tap was needed. Now the overlay reports its
// recording (setRecording) and the phone's chip reads Stop while it runs.
//
// Pinned here against the REAL service over a real socket: the frame, replay to
// a phone that connects later, no repeats, and the resets (meeting start/end,
// service teardown). Also pinned: the page handles the frame (the placeholder
// it shows after a stop waits on the labels the desktop answers with). The chip
// itself is driven in a real browser by tests/phone-mirror (the 'recording'
// scenario); the IPC path is executed in PhoneMirrorScreenshotTrayWiring.
//
// Same electron stub and 4123-4134 port guard as the other PhoneMirror tests.
// Platform-agnostic (loopback ws), same on macOS and Windows.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const require = createRequire(path.join(repoRoot, 'package.json'));
const WS = require('ws').WebSocket;
const http = require('node:http');

const serviceBundle = process.env.PHONE_MIRROR_SERVICE_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_SERVICE_BUNDLE)
  : path.resolve(repoRoot, 'dist-electron/electron/services/PhoneMirrorService.js');
const clientBundle = process.env.PHONE_MIRROR_CLIENT_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_CLIENT_BUNDLE)
  : path.resolve(repoRoot, 'dist-electron/electron/services/phoneMirrorClient.js');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-recording-'));
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {} },
  BrowserWindow: class {
    static getFocusedWindow() {
      return null;
    }
    static getAllWindows() {
      return [];
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (buf) => Buffer.from(buf).toString('utf8').replace(/^enc:/, ''),
  },
};
const originalLoad = Module._load;
const originalListen = http.Server.prototype.listen;
let svc;
let port = 0;
let token = '';

before(async () => {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  http.Server.prototype.listen = function (...args) {
    if (typeof args[0] === 'number' && args[0] >= 4123 && args[0] < 4135) {
      process.nextTick(() => this.emit('error', Object.assign(new Error('taken (test)'), { code: 'EADDRINUSE' })));
      return this;
    }
    return originalListen.apply(this, args);
  };
  svc = (await import(pathToFileURL(serviceBundle).href)).PhoneMirrorService.getInstance();
});

after(async () => {
  if (svc?.isRunning()) await svc.stop({ persist: false });
  Module._load = originalLoad;
  http.Server.prototype.listen = originalListen;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function startFresh() {
  if (svc.isRunning()) await svc.stop({ persist: false });
  svc.setRecording(false);
  svc.publishMeetingState(false);
  const info = await svc.start({ exposeOnLan: false, persist: false });
  port = info.port;
  token = info.token;
  assert.ok(port < 4123 || port >= 4135);
}

beforeEach(startFresh);

async function connectPhone() {
  const ws = new WS(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(token)}`);
  const frames = [];
  ws.on('message', (d) => frames.push(JSON.parse(String(d))));
  ws.on('error', () => {});
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await settle(30);
  return { ws, frames, recording: () => frames.filter((f) => f.type === 'recording').map((f) => f.active) };
}

describe('the overlay recording, mirrored', () => {
  test('start and stop reach a connected phone', async () => {
    const phone = await connectPhone();
    assert.deepEqual(phone.recording(), [false], 'not recording is replayed on connect');
    svc.setRecording(true);
    await settle(30);
    assert.deepEqual(phone.recording(), [false, true]);
    svc.setRecording(false);
    await settle(30);
    assert.deepEqual(phone.recording(), [false, true, false]);
    assert.deepEqual(Object.keys(phone.frames.findLast((f) => f.type === 'recording')).sort(), ['active', 'type']);
    phone.ws.close();
  });

  test('a phone that connects mid-recording reads Stop', async () => {
    svc.setRecording(true);
    const phone = await connectPhone();
    assert.deepEqual(phone.recording(), [true]);
    phone.ws.close();
  });

  test('the replay comes after the history and transcript, so it is the last word', async () => {
    svc.setRecording(true);
    const phone = await connectPhone();
    const types = phone.frames.map((f) => f.type);
    assert.ok(types.indexOf('recording') > types.indexOf('transcript-history'), types.join(','));
    phone.ws.close();
  });

  test('an unchanged state is not re-sent; anything but true is false', async () => {
    const phone = await connectPhone();
    svc.setRecording(true);
    svc.setRecording(true);
    svc.setRecording('yes');
    svc.setRecording(undefined);
    await settle(30);
    assert.deepEqual(phone.recording(), [false, true, false]);
    phone.ws.close();
  });

  test('tracked while stopped, so enabling the mirror mid-recording reports it', async () => {
    await svc.stop({ persist: false });
    svc.setRecording(true);
    await svc.start({ exposeOnLan: false, persist: false }).then((info) => { port = info.port; token = info.token; });
    const phone = await connectPhone();
    assert.deepEqual(phone.recording(), [true]);
    phone.ws.close();
  });
});

describe('resets', () => {
  test('a meeting ending drops the recording, for a phone already open and one that connects after', async () => {
    svc.publishMeetingState(true);
    svc.setRecording(true);
    const open = await connectPhone();
    assert.deepEqual(open.recording(), [true]);
    svc.publishMeetingState(false);
    await settle(30);
    // The open phone resets its chip on the meeting frame (reset: true).
    assert.deepEqual(open.frames.findLast((f) => f.type === 'meeting'), { type: 'meeting', active: false, reset: true });
    const late = await connectPhone();
    assert.deepEqual(late.recording(), [false]);
    // The overlay then reports its own reset; nothing new to send.
    svc.setRecording(false);
    await settle(30);
    assert.deepEqual(open.recording(), [true]);
    open.ws.close();
    late.ws.close();
  });

  test('a meeting starting drops it too', async () => {
    svc.setRecording(true);
    svc.publishMeetingState(true);
    const phone = await connectPhone();
    assert.deepEqual(phone.recording(), [false]);
    phone.ws.close();
  });

  test('stopping the mirror clears it', async () => {
    svc.setRecording(true);
    await svc.stop({ persist: false });
    const info = await svc.start({ exposeOnLan: false, persist: false });
    port = info.port;
    token = info.token;
    const phone = await connectPhone();
    assert.deepEqual(phone.recording(), [false]);
    phone.ws.close();
  });

  test('dispose clears it', async () => {
    svc.setRecording(true);
    await svc.dispose();
    assert.equal(svc.recording, false);
  });
});

describe('the page handles it', () => {
  const { PHONE_MIRROR_HTML: html } = require(clientBundle);
  const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

  test('the recording frame is dispatched and repaints the Answer chip', () => {
    assert.match(script, /case 'recording': onRecording\(ev\); break;/);
    assert.match(html, /<button class="chip" type="button" data-action="answer">Answer<\/button>/);
    assert.match(script, /answerChip\.textContent = recording \? 'Stop' : 'Answer';/);
    assert.match(script, /answerChip\.classList\.toggle\('is-recording', recording\);/);
  });

  test('a stop seen live adds a placeholder that the desktop answers resolve', () => {
    // A question heard → its stream (takeAnswerPending); a silent mic → What
    // to Answer (issue #540); the manual fallback → "Answer".
    assert.match(script, /if \(stopped && live\) addPending\('answer', 'Answer', \['What to Answer', 'Answer'\]\);/);
    assert.match(script, /takePending\(function \(e\) \{ return e\.action === 'answer' && !e\.streamId; \}\)/);
  });

  test('the state replayed on (re)connect never adds a placeholder', () => {
    assert.match(script, /var live = recordingSynced;\s*recordingSynced = true;/);
    assert.match(script, /recordingSynced = false;\s*reconnectDelay = 800;/);
  });
});
