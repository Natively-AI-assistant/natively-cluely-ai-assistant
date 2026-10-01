// electron/services/__tests__/PhoneMirrorScreenshotTrayWiring2026_09_27.test.mjs
//
// The desktop's attached screenshots reach the phone (see
// PhoneMirrorScreenshotTray2026_09_27.test.mjs for the service itself). This
// file EXECUTES the wiring out of the compiled bundles, from the overlay's
// preload call to a frame on a real phone socket, rather than reading source:
// a source assertion cannot tell a handler that runs from one never reached.
//
//   preload phoneMirrorSetAttachments / phoneMirrorImagesSent
//     → ipcRenderer.send(channel) → the ipcHandlers listener
//     → PhoneMirrorService (started by the real phone-mirror:enable handler)
//     → the phone's socket
//
// Also executed: only the overlay window may report its tray; an oversized
// preview (sharp missing → full-size PNG) is shrunk before it goes out; a
// closed overlay clears the phone's tray; and a question typed on the phone is
// sent with the tray's screenshots (the phone's photos only while the tray
// holds them, or on their own with no overlay) and the overlay is told so it
// can clear its tray.
//
// The renderer half (NativelyInterface reporting its tray) is React state and
// is not executed here; it is pinned at the end by its call sites.
//
// Ports: same 4123-4134 guard as the other PhoneMirror tests. Platform-agnostic
// (loopback ws; paths are opaque keys), same on macOS and Windows.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const IPC_BUNDLE = process.env.PHONE_MIRROR_IPC_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_IPC_BUNDLE)
  : path.join(ROOT, 'dist-electron/electron/ipcHandlers.js');
const PRELOAD_BUNDLE = process.env.PHONE_MIRROR_PRELOAD_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_PRELOAD_BUNDLE)
  : path.join(ROOT, 'dist-electron/electron/preload.js');
const WS = createRequire(path.join(ROOT, 'package.json'))('ws').WebSocket;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-tray-wiring-')));
const shotDir = path.join(userData, 'screenshots');
const extraDir = path.join(userData, 'extra_screenshots');
fs.mkdirSync(shotDir, { recursive: true });
fs.mkdirSync(extraDir, { recursive: true });
const CAPTURE = path.join(shotDir, 'capture-1.png');
const PHONE_PHOTO = path.join(extraDir, 'phone-1a2b.jpg');
fs.writeFileSync(CAPTURE, 'png');
fs.writeFileSync(PHONE_PHOTO, 'jpg');
const thumb = (seed) => 'data:image/jpeg;base64,' + Buffer.from('thumb-' + seed).toString('base64');

const invokeHandlers = new Map();
const onListeners = new Map();
const resized = [];
const streamChatCalls = [];
const dropped = [];
let exposed = null;

function fakeWebContents(name) {
  const once = new Map();
  return {
    name,
    sent: [],
    send(channel, data) { this.sent.push({ channel, data }); },
    once(event, fn) { once.set(event, fn); },
    fire(event) { once.get(event)?.(); },
    isDestroyed: () => false,
  };
}
const overlay = { id: 2, isDestroyed: () => false, webContents: fakeWebContents('overlay') };
const launcher = { id: 1, isDestroyed: () => false, webContents: fakeWebContents('launcher') };

const noop = () => {};
const fakeElectron = {
  app: {
    getPath: () => userData, getAppPath: () => ROOT, isPackaged: false, isReady: () => true,
    getVersion: () => '0.0.0-test', getName: () => 'natively',
    on: noop, once: noop, off: noop, removeAllListeners: noop,
    whenReady: () => Promise.resolve(),
  },
  BrowserWindow: Object.assign(function BrowserWindow() {}, { getAllWindows: () => [launcher, overlay], getFocusedWindow: () => null }),
  ipcMain: {
    handle: (channel, fn) => invokeHandlers.set(channel, fn),
    handleOnce: (channel, fn) => invokeHandlers.set(channel, fn),
    on: (channel, fn) => onListeners.set(channel, fn),
    once: noop, off: noop,
    removeHandler: noop, removeListener: noop, removeAllListeners: noop,
    listenerCount: () => 0, emit: noop,
  },
  // The overlay's preload, sending as the overlay window does.
  ipcRenderer: {
    send: (channel, ...args) => onListeners.get(channel)?.({ sender: overlay.webContents }, ...args),
    invoke: async () => undefined,
    on: noop, once: noop, removeListener: noop, removeAllListeners: noop,
  },
  contextBridge: { exposeInMainWorld: (key, api) => { if (key === 'electronAPI') exposed = api; } },
  webFrame: { setZoomFactor: noop, setVisualZoomLevelLimits: noop },
  nativeImage: {
    createFromDataURL: () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 3024, height: 1964 }),
      resize: (size) => {
        resized.push(size);
        return { toJPEG: () => Buffer.from('small-jpeg') };
      },
    }),
  },
  dialog: {}, desktopCapturer: {}, shell: {}, systemPreferences: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8'),
    getSelectedStorageBackend: () => 'basic_text',
  },
  nativeTheme: { on: noop }, screen: { on: noop },
  session: {}, globalShortcut: {}, Menu: {}, Tray: {}, clipboard: {},
};

const originalLoad = Module._load;
const originalListen = http.Server.prototype.listen;
let phone;

const intelligenceManager = new Proxy({
  getContextEpoch: () => 1,
  getFormattedContext: () => '',
}, { get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : noop) });
const appState = {
  getWindowHelper: () => ({ getOverlayWindow: () => overlay, getLauncherWindow: () => launcher }),
  getMainWindow: () => overlay,
  getIntelligenceManager: () => intelligenceManager,
  takePhoneChatImages: () => [PHONE_PHOTO],
  dropPhoneImage: (p) => dropped.push(p),
  processingHelper: {
    // Whatever else the phone path asks the helper answers "no".
    getLLMHelper: () => new Proxy({
      getKnowledgeOrchestrator: () => null,
      streamChat: (message, imagePaths) => {
        streamChatCalls.push({ message, imagePaths });
        return (async function* () { yield 'ok'; })();
      },
    }, { get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : () => false) }),
  },
};

before(async () => {
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return fakeElectron;
    if (/[\\/]native-module[\\/]index\.[^\\/]+\.node$/.test(request)) {
      return new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : function nativeStub() {}) });
    }
    return originalLoad.call(this, request, ...rest);
  };
  http.Server.prototype.listen = function (...args) {
    if (typeof args[0] === 'number' && args[0] >= 4123 && args[0] < 4135) {
      process.nextTick(() => this.emit('error', Object.assign(new Error('taken (test)'), { code: 'EADDRINUSE' })));
      return this;
    }
    return originalListen.apply(this, args);
  };
  const ipc = require(IPC_BUNDLE);
  // Registration reaches every handler this file needs before the app-lifecycle
  // wiring at the end, which these stubs cannot satisfy.
  try { ipc.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }
  require(PRELOAD_BUNDLE);
  assert.ok(exposed, 'the preload exposed electronAPI');

  const info = await invokeHandlers.get('phone-mirror:enable')({}, false);
  assert.ok(info?.port && info?.token, 'the real enable handler started the mirror: ' + JSON.stringify(info?.error || ''));
  assert.ok(info.port < 4123 || info.port >= 4135);
  const ws = new WS(`ws://127.0.0.1:${info.port}/ws?t=${encodeURIComponent(info.token)}`);
  const frames = [];
  const raw = [];
  ws.on('message', (d) => { raw.push(String(d)); frames.push(JSON.parse(String(d))); });
  ws.on('error', noop);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await settle(40);
  phone = { ws, frames, raw, of: (t) => frames.filter((f) => f.type === t) };
});

after(async () => {
  phone?.ws.close();
  try { await invokeHandlers.get('phone-mirror:disable')?.({}); } catch { /* best effort */ }
  Module._load = originalLoad;
  http.Server.prototype.listen = originalListen;
  fs.rmSync(userData, { recursive: true, force: true });
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const lastTray = () => phone.of('attachments').at(-1)?.items;
async function askFromPhone(message) {
  const before = streamChatCalls.length;
  phone.ws.send(JSON.stringify({ type: 'chat', message }));
  for (let i = 0; i < 100 && streamChatCalls.length === before; i++) await settle(20);
  assert.equal(streamChatCalls.length, before + 1, 'the phone question reached streamChat');
  return streamChatCalls.at(-1);
}

describe('overlay → phone, executed', () => {
  test('a screenshot attached in the overlay shows in the phone tray, without its path', async () => {
    exposed.phoneMirrorSetAttachments([{ path: CAPTURE, preview: thumb(1) }]);
    await settle(40);
    assert.equal(lastTray()?.length, 1);
    assert.equal(lastTray()[0].thumb, thumb(1));
    for (const frame of phone.raw) assert.doesNotMatch(frame, /capture-1|natively-pm-tray-wiring/);
  });

  test('another window cannot write the tray', async () => {
    const before = phone.of('attachments').length;
    onListeners.get('phone-mirror:attachments')({ sender: launcher.webContents }, []);
    onListeners.get('phone-mirror:images-sent')({ sender: launcher.webContents }, 'x', [CAPTURE]);
    await settle(40);
    assert.equal(phone.of('attachments').length, before);
    assert.equal(phone.of('images').length, 0);
  });

  test('a full-size preview is shrunk to 480 px before it goes out', async () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(500_000);
    exposed.phoneMirrorSetAttachments([{ path: CAPTURE, preview: thumb(1) }, { path: path.join(shotDir, 'big.png'), preview: huge }]);
    await settle(40);
    assert.deepEqual(resized.at(-1), { width: 480, height: 312, quality: 'good' });
    assert.equal(lastTray()[1].thumb, 'data:image/jpeg;base64,' + Buffer.from('small-jpeg').toString('base64'));
    exposed.phoneMirrorSetAttachments([{ path: CAPTURE, preview: thumb(1) }]);
    await settle(40);
  });

  test('a question typed on the phone goes out with the tray; the overlay hears of it', async () => {
    exposed.phoneMirrorSetAttachments([{ path: CAPTURE, preview: thumb(1) }, { path: PHONE_PHOTO, preview: thumb(2) }]);
    await settle(20);
    assert.deepEqual((await askFromPhone('what is on my screen?')).imagePaths, [CAPTURE, PHONE_PHOTO]);
    assert.ok(overlay.webContents.sent.some((s) => s.channel === 'phone-mirror:incoming-chat'), 'the overlay is told (it clears its tray)');
  });

  test('a phone photo the overlay has sent or removed does not ride along again', async () => {
    exposed.phoneMirrorSetAttachments([{ path: CAPTURE, preview: thumb(1) }]);
    await settle(20);
    assert.deepEqual((await askFromPhone('and now?')).imagePaths, [CAPTURE]);
    exposed.phoneMirrorSetAttachments([{ path: CAPTURE, preview: thumb(1) }]);
    await settle(20);
  });

  test('the screenshots a question was sent with arrive as a row', async () => {
    exposed.phoneMirrorSetAttachments([]);
    exposed.phoneMirrorImagesSent('card-7', [CAPTURE]);
    await settle(40);
    assert.deepEqual(lastTray(), []);
    const [row] = phone.of('images');
    assert.equal(row.id, 'i:card-7');
    assert.equal(row.images[0].thumb, thumb(1));
  });

  test('Remove on the phone takes it off the overlay\'s tray (and off later phone questions)', async () => {
    exposed.phoneMirrorSetAttachments([{ path: CAPTURE, preview: thumb(1) }, { path: PHONE_PHOTO, preview: thumb(2) }]);
    await settle(40);
    const photo = lastTray()[1];
    phone.ws.send(JSON.stringify({ type: 'detach', id: photo.id }));
    await settle(60);
    const told = overlay.webContents.sent.filter((s) => s.channel === 'phone-mirror:detach');
    assert.deepEqual(told.map((s) => s.data), [{ path: PHONE_PHOTO }], 'the overlay is told which one, by path');
    assert.deepEqual(dropped, [PHONE_PHOTO]);
    assert.equal(typeof exposed.onPhoneMirrorDetach, 'function', 'the overlay can listen for it');
  });

  test('a closed overlay leaves no tray on the phone', async () => {
    exposed.phoneMirrorSetAttachments([{ path: CAPTURE, preview: thumb(1) }]);
    await settle(40);
    assert.equal(lastTray().length, 1);
    overlay.webContents.fire('destroyed');
    await settle(40);
    assert.deepEqual(lastTray(), []);
  });

  test('with no overlay to hold them, the phone\'s own photos still go with its question', async () => {
    assert.deepEqual((await askFromPhone('what about this photo?')).imagePaths, [PHONE_PHOTO]);
  });
});

describe('the overlay reports its tray (renderer call sites)', () => {
  const src = read('src/components/NativelyInterface.tsx');
  // The effect around a call, and the dependency list that closes it.
  const effectAround = (call, dep) => {
    const at = src.indexOf(call);
    assert.ok(at > 0, `${call} is called`);
    const start = src.lastIndexOf('useEffect(() => {', at);
    const end = src.indexOf('}, [', at);
    assert.equal(src.slice(end, src.indexOf(']);', end) + 3), `}, [${dep}]);`, `${call} runs in an effect on [${dep}]`);
    return src.slice(start, end);
  };

  test('every tray change is reported whole', () => {
    assert.match(effectAround('phoneMirrorSetAttachments?.(', 'attachedContext'), /phoneMirrorSetAttachments\?\.\(\s*attachedContext\.map/);
  });

  test('a new screenshot question card reports the screenshots it was sent with', () => {
    const body = effectAround('phoneMirrorImagesSent?.(', 'messages');
    assert.match(body, /msg\.hasScreenshot/);
    assert.match(body, /phoneMirrorImagesSent\?\.\(msg\.id, paths\)/);
  });

  test('Remove from the phone leaves the overlay tray', () => {
    const start = src.indexOf('window.electronAPI?.onPhoneMirrorDetach?.(');
    assert.ok(start > 0, 'the overlay listens');
    assert.match(src.slice(start, start + 240), /setAttachedContext\(\(prev\) => prev\.filter\(\(shot\) => shot\.path !== path\)\)/);
  });

  test('a phone question takes the tray, as a question typed in the overlay does', () => {
    const start = src.indexOf('window.electronAPI.onPhoneMirrorIncomingChat(');
    const handler = src.slice(start, src.indexOf('}),', start));
    assert.match(handler, /const shots = attachedContextRef\.current;/);
    assert.match(handler, /if \(shots\.length\) setAttachedContext\(\[\]\);/);
    assert.match(handler, /hasScreenshot: true/);
  });
});
