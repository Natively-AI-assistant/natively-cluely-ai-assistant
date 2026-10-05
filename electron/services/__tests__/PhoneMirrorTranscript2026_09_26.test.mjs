// electron/services/__tests__/PhoneMirrorTranscript2026_09_26.test.mjs
//
// "The phone mirror doesn't show the transcript STT running like the overlay."
// The phone never received a transcript: main.ts sent `native-audio-transcript`
// to the launcher and overlay only. main.ts now also calls
// PhoneMirrorService.publishTranscript from that same display-only send, and
// publishMeetingState from broadcastMeetingState. This pins the service side:
//
//   - interviewer segments reach phone sockets; the user's own mic does not
//     (the overlay's rolling bar shows the interviewer only)
//   - a phone that connects mid-meeting gets the finals so far + the live partial
//   - a meeting START clears the transcript, a meeting END keeps it
//   - the replay buffer stays bounded over a long meeting
//   - a stopped mirror keeps nothing
//   - the companion extension never gets live transcript frames
//
// Loads the REAL compiled service (or PHONE_MIRROR_SERVICE_BUNDLE) with the
// electron stub and the 4123-4134 port guard from
// PhoneMirrorExtensionConnectLatency2026_09_25.test.mjs, so it can never bind
// or talk to a real Natively's port.
//
// Platform-agnostic (loopback HTTP + ws); runs the same on macOS and Windows.

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

const bundlePath = process.env.PHONE_MIRROR_SERVICE_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_SERVICE_BUNDLE)
  : path.resolve(repoRoot, 'dist-electron/electron/services/PhoneMirrorService.js');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-transcript-'));
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
const DEV_EXTENSION_ORIGIN = 'chrome-extension://macjecgdfliikhplbbdbpljomcigjnjg';

let svc;
let port = 0;
let phoneToken = '';

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
  const mod = await import(pathToFileURL(bundlePath).href);
  svc = mod.PhoneMirrorService.getInstance();
});

after(async () => {
  if (svc?.isRunning()) await svc.stop({ persist: false });
  Module._load = originalLoad;
  http.Server.prototype.listen = originalListen;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function fresh() {
  if (svc.isRunning()) await svc.stop({ persist: false });
  // Each test starts from "no meeting, empty transcript".
  svc.publishMeetingState(false);
  const info = await svc.start({ exposeOnLan: false, persist: false });
  port = info.port;
  phoneToken = info.token;
  assert.ok(port < 4123 || port >= 4135, `must never use a port a real Natively may hold (got ${port})`);
}

/** Connect a phone socket and collect every frame it receives. */
async function connectPhone() {
  const ws = new WS(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(phoneToken)}`);
  const frames = [];
  ws.on('message', (data) => frames.push(JSON.parse(String(data))));
  ws.on('error', () => {});
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await settle(30);
  return { ws, frames, of: (type) => frames.filter((f) => f.type === type) };
}

describe('phone mirror live transcript', () => {
  beforeEach(fresh);

  test('interviewer partials and finals reach the phone; the user mic does not', async () => {
    svc.publishMeetingState(true);
    const phone = await connectPhone();
    svc.publishTranscript({ speaker: 'interviewer', text: 'tell me about', final: false, timestamp: 1 });
    svc.publishTranscript({ speaker: 'user', text: 'my own words', final: true, timestamp: 2 });
    svc.publishTranscript({ speaker: 'interviewer', text: 'Tell me about yourself.', final: true, timestamp: 3 });
    await settle(40);

    const live = phone.of('transcript');
    assert.deepEqual(
      live.map((f) => [f.speaker, f.text, f.final, f.ts]),
      [
        ['interviewer', 'tell me about', false, 1],
        ['interviewer', 'Tell me about yourself.', true, 3],
      ],
    );
    phone.ws.close();
  });

  test('a phone joining mid-meeting replays the finals so far and the live partial', async () => {
    svc.publishMeetingState(true);
    svc.publishTranscript({ speaker: 'interviewer', text: 'First question?', final: true, timestamp: 10 });
    svc.publishTranscript({ speaker: 'interviewer', text: 'Second question?', final: true, timestamp: 20 });
    svc.publishTranscript({ speaker: 'interviewer', text: 'and a third', final: false, timestamp: 30 });

    const phone = await connectPhone();
    const [replay] = phone.of('transcript-history');
    assert.ok(replay, 'connect must send transcript-history');
    assert.deepEqual(
      replay.segments.map((s) => s.text),
      ['First question?', 'Second question?'],
    );
    assert.equal(replay.partial?.text, 'and a third');
    assert.equal(replay.meetingActive, true);
    // It follows the chat history frame, so the page renders both on first paint.
    assert.ok(
      phone.frames.findIndex((f) => f.type === 'history') < phone.frames.findIndex((f) => f.type === 'transcript-history'),
    );
    phone.ws.close();
  });

  test('a final clears the replayed partial', async () => {
    svc.publishMeetingState(true);
    svc.publishTranscript({ speaker: 'interviewer', text: 'what is', final: false });
    svc.publishTranscript({ speaker: 'interviewer', text: 'What is a monad?', final: true });
    const phone = await connectPhone();
    const [replay] = phone.of('transcript-history');
    assert.equal(replay.partial, null);
    assert.deepEqual(replay.segments.map((s) => s.text), ['What is a monad?']);
    phone.ws.close();
  });

  // 2026-09-27, Evin: "if I stop a meeting, the phone should behave like the
  // meeting is over (check the summary on the desktop) and open a clean new
  // canvas". The end used to keep the transcript; it now clears it too, and a
  // phone that connects afterwards is told the meeting ended.
  test('meeting start and end both clear the transcript; an end is reported as ended', async () => {
    const phone = await connectPhone();
    svc.publishMeetingState(true);
    svc.publishTranscript({ speaker: 'interviewer', text: 'Old meeting line.', final: true });
    svc.publishMeetingState(false);
    await settle(30);

    const afterEnd = await connectPhone();
    const [endReplay] = afterEnd.of('transcript-history');
    assert.deepEqual(endReplay.segments, [], 'the end leaves a clean canvas');
    assert.equal(endReplay.meetingActive, false);
    assert.equal(endReplay.meetingEnded, true, 'a phone arriving later hears the meeting ended');
    afterEnd.ws.close();

    svc.publishMeetingState(true);
    await settle(30);
    const afterStart = await connectPhone();
    const [startReplay] = afterStart.of('transcript-history');
    assert.deepEqual(startReplay.segments, [], 'start clears the previous meeting');
    assert.equal(startReplay.meetingActive, true);
    assert.equal(startReplay.meetingEnded, false);
    afterStart.ws.close();

    assert.deepEqual(
      phone.of('meeting').map((f) => [f.active, f.reset]),
      [
        [true, true],
        [false, true],
        [true, true],
      ],
    );
    phone.ws.close();
  });

  test('a repeated active=true does not wipe a meeting in progress', async () => {
    svc.publishMeetingState(true);
    svc.publishTranscript({ speaker: 'interviewer', text: 'Keep me.', final: true });
    svc.publishMeetingState(true);
    const phone = await connectPhone();
    assert.deepEqual(phone.of('transcript-history')[0].segments.map((s) => s.text), ['Keep me.']);
    phone.ws.close();
  });

  test('the replay buffer stays bounded over a long meeting and keeps the newest lines', async () => {
    svc.publishMeetingState(true);
    for (let i = 0; i < 300; i++) {
      svc.publishTranscript({ speaker: 'interviewer', text: `Line ${i} ` + 'x'.repeat(120), final: true });
    }
    const phone = await connectPhone();
    const segs = phone.of('transcript-history')[0].segments;
    const chars = segs.reduce((n, s) => n + s.text.length, 0);
    assert.ok(segs.length <= 80, `segments bounded (got ${segs.length})`);
    assert.ok(chars <= 12_000, `chars bounded (got ${chars})`);
    assert.ok(segs[segs.length - 1].text.startsWith('Line 299 '), 'newest line kept');
    phone.ws.close();
  });

  test('a single oversized final is still kept', async () => {
    svc.publishMeetingState(true);
    svc.publishTranscript({ speaker: 'interviewer', text: 'y'.repeat(20_000), final: true });
    const phone = await connectPhone();
    assert.equal(phone.of('transcript-history')[0].segments.length, 1);
    phone.ws.close();
  });

  test('a stopped mirror keeps no transcript', async () => {
    await svc.stop({ persist: false });
    svc.publishMeetingState(true);
    svc.publishTranscript({ speaker: 'interviewer', text: 'Said while the mirror was off.', final: true });
    const info = await svc.start({ exposeOnLan: false, persist: false });
    port = info.port;
    phoneToken = info.token;
    const phone = await connectPhone();
    const [replay] = phone.of('transcript-history');
    assert.deepEqual(replay.segments, []);
    // The meeting itself is still reported, so the page can say it is listening.
    assert.equal(replay.meetingActive, true);
    phone.ws.close();
  });

  test('blank and whitespace segments are dropped', async () => {
    svc.publishMeetingState(true);
    const phone = await connectPhone();
    svc.publishTranscript({ speaker: 'interviewer', text: '   ', final: false });
    svc.publishTranscript({ speaker: 'interviewer', text: '', final: true });
    await settle(30);
    assert.equal(phone.of('transcript').length, 0);
    phone.ws.close();
  });

  test('the companion extension never receives live transcript frames', async () => {
    svc.publishMeetingState(true);
    svc.armExtensionPairing();
    const res = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: DEV_EXTENSION_ORIGIN },
      body: '{}',
    });
    assert.equal(res.status, 200);
    const extToken = (await res.json()).token;
    const ext = new WS(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(extToken)}`);
    const extFrames = [];
    ext.on('message', (d) => extFrames.push(JSON.parse(String(d))));
    ext.on('error', () => {});
    await new Promise((resolve, reject) => {
      ext.once('open', resolve);
      ext.once('error', reject);
    });
    ext.send(JSON.stringify({ type: 'hello', role: 'extension', v: 1 }));
    await settle(40);

    const phone = await connectPhone();
    svc.publishTranscript({ speaker: 'interviewer', text: 'Only for phones.', final: true });
    svc.publishMeetingState(false);
    await settle(40);

    assert.equal(phone.of('transcript').length, 1);
    assert.equal(extFrames.filter((f) => f.type === 'transcript' || f.type === 'meeting').length, 0);
    ext.close();
    phone.ws.close();
  });
});
