// electron/services/__tests__/PhoneMirrorScreenshotTray2026_09_27.test.mjs
//
// "The screenshot taken from the PC doesn't appear in the web app as a preview
// like in the desktop overlay." The overlay's attached-screenshot tray was
// renderer state only; the phone never heard of it. Now the overlay reports
// the tray on every change (setAttachments) and the screenshots each question
// was sent with (publishSentImages); the phone shows both. Pinned here against
// the REAL service over a real socket: the frames, replay on connect, the caps,
// that no local path ever reaches the phone, and that the phone's own photos
// are not echoed back as "sent from your desktop".
//
// Same electron stub and 4123-4134 port guard as the other PhoneMirror tests.
// Platform-agnostic (loopback ws; paths are opaque keys, never read), so the
// Windows-shaped paths below behave exactly like the macOS ones.

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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-tray-'));
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
const thumb = (seed) => 'data:image/jpeg;base64,' + Buffer.from('jpeg-bytes-' + seed).toString('base64');
const MAC = '/Users/someone/Library/Application Support/natively/screenshots/cap-1.png';
const WIN = 'C:\\Users\\someone\\AppData\\Roaming\\natively\\screenshots\\cap-2.png';
const PHONE = '/Users/someone/Library/Application Support/natively/extra_screenshots/phone-3f2a.jpg';

beforeEach(async () => {
  if (svc.isRunning()) await svc.stop({ persist: false });
  svc.history = [];
  svc.setAttachments([]);
  svc.publishMeetingState(false);
  const info = await svc.start({ exposeOnLan: false, persist: false });
  port = info.port;
  token = info.token;
  assert.ok(port < 4123 || port >= 4135);
});

async function connectPhone() {
  const ws = new WS(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(token)}`);
  const frames = [];
  const raw = [];
  ws.on('message', (d) => {
    raw.push(String(d));
    frames.push(JSON.parse(String(d)));
  });
  ws.on('error', () => {});
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await settle(30);
  return { ws, frames, raw, of: (t) => frames.filter((f) => f.type === t) };
}

describe('the overlay tray, mirrored', () => {
  test('each change reaches the phone as the whole tray: ids and thumbnails, never paths', async () => {
    const phone = await connectPhone();
    assert.deepEqual(phone.of('attachments').at(-1).items, [], 'an empty tray is replayed on connect');
    svc.setAttachments([{ path: MAC, thumb: thumb(1) }]);
    svc.setAttachments([{ path: MAC, thumb: thumb(1) }, { path: WIN, thumb: thumb(2) }]);
    await settle(30);
    const [, one, two] = phone.of('attachments');
    assert.equal(one.items.length, 1);
    assert.equal(two.items.length, 2);
    assert.equal(two.items[0].id, one.items[0].id, 'a screenshot keeps its id while it stays');
    assert.deepEqual(two.items.map((i) => i.thumb), [thumb(1), thumb(2)]);
    assert.deepEqual(Object.keys(two.items[0]).sort(), ['id', 'thumb']);
    for (const frame of phone.raw) {
      assert.doesNotMatch(frame, /someone|screenshots|cap-1|cap-2|phone-3f2a/, 'no path, user name or file name on the wire');
    }
    svc.setAttachments([]);
    await settle(30);
    assert.deepEqual(phone.of('attachments').at(-1).items, [], 'cleared or sent: the tray empties');
    phone.ws.close();
  });

  test('a phone that connects later gets the current tray', async () => {
    svc.setAttachments([{ path: MAC, thumb: thumb(1) }]);
    const phone = await connectPhone();
    assert.equal(phone.of('attachments').at(-1).items.length, 1);
    phone.ws.close();
  });

  test('an unchanged tray is not re-sent', async () => {
    const phone = await connectPhone();
    svc.setAttachments([{ path: MAC, thumb: thumb(1) }]);
    svc.setAttachments([{ path: MAC, thumb: thumb(1) }]);
    await settle(30);
    assert.equal(phone.of('attachments').length, 2, 'the replay + one change');
    phone.ws.close();
  });

  test('only small JPEG/PNG data URLs, at most the last 5', async () => {
    const phone = await connectPhone();
    svc.setAttachments([
      { path: '/a', thumb: 'https://example.com/x.png' },
      { path: '/b', thumb: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { path: '/c', thumb: 'data:image/jpeg;base64,' + 'A'.repeat(400_001) },
      { path: '/d', thumb: 'data:image/png;base64,abc"><img src=x onerror=alert(1)>' },
      { path: '', thumb: thumb(9) },
    ]);
    await settle(30);
    assert.equal(phone.of('attachments').length, 1, 'nothing valid, nothing sent');
    svc.setAttachments([1, 2, 3, 4, 5, 6, 7].map((n) => ({ path: '/shot-' + n, thumb: thumb(n) })));
    await settle(30);
    assert.deepEqual(phone.of('attachments').at(-1).items.map((i) => i.thumb), [3, 4, 5, 6, 7].map(thumb));
    phone.ws.close();
  });

  test('a new meeting leaves the tray to the overlay, which clears its own', async () => {
    svc.setAttachments([{ path: MAC, thumb: thumb(1) }]);
    svc.publishMeetingState(true);
    const phone = await connectPhone();
    assert.equal(phone.of('attachments').at(-1).items.length, 1);
    phone.ws.close();
  });

  test('a question typed on the phone can take the tray', () => {
    svc.setAttachments([{ path: MAC, thumb: thumb(1) }, { path: PHONE, thumb: thumb(3) }]);
    assert.deepEqual(svc.getAttachmentPaths(), [MAC, PHONE]);
    const copy = svc.getAttachmentPaths();
    copy.push('/x');
    assert.deepEqual(svc.getAttachmentPaths(), [MAC, PHONE], 'a copy, not the list itself');
    svc.setAttachments([]);
    assert.deepEqual(svc.getAttachmentPaths(), []);
  });
});

describe('screenshots a question was sent with', () => {
  test('arrive once as a row, in history for a phone that reconnects', async () => {
    svc.setAttachments([{ path: MAC, thumb: thumb(1) }, { path: WIN, thumb: thumb(2) }]);
    const phone = await connectPhone();
    const trayIds = phone.of('attachments').at(-1).items.map((i) => i.id);
    svc.setAttachments([]);
    svc.publishSentImages('card-1', [MAC, WIN]);
    svc.publishSentImages('card-1', [MAC, WIN]);
    await settle(30);
    const sent = phone.of('images');
    assert.equal(sent.length, 1, 'a card is sent once');
    assert.equal(sent[0].id, 'i:card-1');
    assert.deepEqual(sent[0].images.map((i) => i.id), trayIds, 'the same screenshots the tray showed');
    assert.deepEqual(sent[0].images.map((i) => i.thumb), [thumb(1), thumb(2)]);
    const later = await connectPhone();
    const row = later.of('history')[0].messages.find((m) => m.id === 'i:card-1');
    assert.equal(row.role, 'user');
    assert.equal(row.images.length, 2);
    for (const frame of [...phone.raw, ...later.raw]) assert.doesNotMatch(frame, /someone|cap-1|cap-2/);
    later.ws.close();
    phone.ws.close();
  });

  test('screenshots the tray never held are ignored (a card restored after a reload)', async () => {
    const phone = await connectPhone();
    svc.publishSentImages('old-card', ['/never/in/the/tray.png']);
    await settle(30);
    assert.equal(phone.of('images').length, 0);
    phone.ws.close();
  });

  test("the phone's own photos are not sent back to it", async () => {
    svc.setAttachments([{ path: PHONE, thumb: thumb(3) }, { path: MAC, thumb: thumb(1) }]);
    const phone = await connectPhone();
    svc.publishSentImages('card-2', [PHONE]);
    svc.publishSentImages('card-3', [PHONE, MAC]);
    await settle(30);
    const sent = phone.of('images');
    assert.deepEqual(sent.map((s) => s.id), ['i:card-3'], 'phone-only card: no row');
    assert.deepEqual(sent[0].images.map((i) => i.thumb), [thumb(1)]);
    phone.ws.close();
  });

  test('history keeps the newest screenshots within a budget', async () => {
    const big = (n) => 'data:image/jpeg;base64,' + String(n).repeat(1).padEnd(390_000, 'A');
    const paths = Array.from({ length: 8 }, (_, n) => '/big-' + n);
    for (let n = 0; n < 8; n++) {
      svc.setAttachments([{ path: paths[n], thumb: big(n) }]);
      svc.publishSentImages('big-' + n, [paths[n]]);
    }
    const phone = await connectPhone();
    const kept = phone.of('history')[0].messages.filter((m) => m.images).map((m) => m.id);
    assert.ok(kept.length >= 1 && kept.length < 8, `older rows dropped (${kept.length} kept)`);
    assert.equal(kept.at(-1), 'i:big-7', 'the newest is always kept');
    phone.ws.close();
  });

  test('nothing is recorded while the mirror is off', async () => {
    svc.setAttachments([{ path: MAC, thumb: thumb(1) }]);
    await svc.stop({ persist: false });
    svc.publishSentImages('card-off', [MAC]);
    assert.ok(!svc.history.some((m) => m.id === 'i:card-off'));
  });
});

// 2026-09-27, Evin: "we can't delete or remove a screenshot or image uploaded
// from the phone". The phone names a tray item by its id; the service turns it
// back into the path for the desktop (the overlay removes it from its tray).
// An upload now answers with the id its photo will be listed under, so the
// page can offer Remove on the photo it sent.
describe('removing from the phone', () => {
  const commands = [];
  let unsubscribe = null;
  before(() => { unsubscribe = svc.onPhoneCommand((cmd) => commands.push(cmd)); });
  after(() => unsubscribe?.());

  test('detach by id reaches the desktop as the path; unknown or malformed ids do nothing', async () => {
    commands.length = 0;
    svc.setAttachments([{ path: MAC, thumb: thumb(1) }, { path: PHONE, thumb: thumb(3) }]);
    const phone = await connectPhone();
    const [mac, photo] = phone.of('attachments').at(-1).items;
    phone.ws.send(JSON.stringify({ type: 'detach', id: photo.id }));
    phone.ws.send(JSON.stringify({ type: 'detach', id: '00000000-0000-4000-8000-000000000000' }));
    phone.ws.send(JSON.stringify({ type: 'detach', id: MAC }));
    phone.ws.send(JSON.stringify({ type: 'detach' }));
    await settle(60);
    assert.deepEqual(commands, [{ type: 'detach', path: PHONE }]);
    assert.ok(mac.id !== photo.id);
    phone.ws.close();
  });

  test('an upload answers with the id its photo is listed under in the tray', async () => {
    const saved = [];
    const release = svc.setPhoneImageHandler(async () => {
      const path = PHONE.replace('3f2a', 'up-' + saved.length);
      saved.push(path);
      return path;
    });
    try {
      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
      const res = await fetch(`http://127.0.0.1:${port}/image?t=${encodeURIComponent(token)}`, { method: 'POST', body: jpeg, headers: { 'Content-Type': 'image/jpeg' } });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.match(body.id, /^[0-9a-f-]{36}$/);
      assert.doesNotMatch(JSON.stringify(body), /someone|phone-up/, 'the id, never the path');
      // The overlay lists it moments later: under the same id.
      const phone = await connectPhone();
      svc.setAttachments([{ path: saved[0], thumb: thumb(4) }]);
      await settle(30);
      assert.equal(phone.of('attachments').at(-1).items[0].id, body.id);
      // ...so removing it by that id works before or after the tray lists it.
      const seen = [];
      const stop = svc.onPhoneCommand((cmd) => seen.push(cmd));
      phone.ws.send(JSON.stringify({ type: 'detach', id: body.id }));
      await settle(40);
      stop();
      assert.deepEqual(seen, [{ type: 'detach', path: saved[0] }]);
      phone.ws.close();
    } finally {
      release?.();
    }
  });
});
