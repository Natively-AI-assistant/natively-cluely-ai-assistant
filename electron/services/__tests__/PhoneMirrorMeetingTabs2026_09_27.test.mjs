// The Companion extension's meeting tabs, over the REAL PhoneMirrorService
// socket (compiled bundle + a real `ws` client). Pins that:
//   - the app asks each extension for its meeting tabs on hello, and stops asking;
//   - tabs are taken only from a socket that authenticated with the EXTENSION
//     token (a `hello` only self-declares a role, and the phone token travels in
//     the LAN QR code);
//   - a closed socket, or the server stopping, takes its tabs along;
//   - an extension may send more than 4 KB (a `tabs` reply for 20+ tabs used to
//     be dropped), a phone still may not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Module, { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const require = createRequire(path.join(repoRoot, 'package.json'));
const WS = require('ws').WebSocket;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-meetingtabs-'));
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {} },
  BrowserWindow: class { static getFocusedWindow() { return null; } static getAllWindows() { return []; } },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (buf) => Buffer.from(buf).toString('utf8').replace(/^enc:/, ''),
  },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};

let PhoneMirrorService;
before(async () => {
  ({ PhoneMirrorService } = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/services/PhoneMirrorService.js')).href));
});
after(() => {
  Module._load = originalLoad;
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function connect(port, token) {
  return new Promise((resolve, reject) => {
    const ws = new WS(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(token)}`);
    const frames = [];
    ws.on('message', (d) => { try { frames.push(JSON.parse(d.toString())); } catch {} });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'extension', v: 1 }));
      setTimeout(() => resolve({ ws, frames }), 60);
    });
  });
}
const subscribes = (frames) => frames.filter((f) => f.type === 'meeting-tabs-subscribe').map((f) => f.on);

test('meeting tabs flow from extension-token sockets only, and go when the socket goes', async () => {
  const svc = PhoneMirrorService.getInstance();
  if (svc.isRunning()) await svc.stop({ persist: false });
  const calls = [];
  svc.onMeetingTabs((socket, tabs) => calls.push({ socket, tabs }));
  svc.setMeetingTabsWanted(true);
  const info = await svc.start({ exposeOnLan: false, persist: false });
  try {
    const ext = await connect(info.port, info.extToken);
    const phone = await connect(info.port, info.token);
    assert.deepEqual(subscribes(ext.frames), [true], 'the extension is asked on hello');
    assert.deepEqual(subscribes(phone.frames), [], 'a phone-token socket is never asked');

    const tabs = [{ key: 'meet:abc-defg-hij', title: 'Meet', audible: true, active: true }];
    phone.ws.send(JSON.stringify({ type: 'meeting-tabs', tabs }));
    ext.ws.send(JSON.stringify({ type: 'meeting-tabs', tabs }));
    await wait(80);
    const delivered = calls.filter((c) => c.socket !== null && c.tabs !== null);
    assert.equal(delivered.length, 1, 'only the extension-token socket is heard');
    assert.deepEqual(delivered[0].tabs, tabs);

    // An extension's frame may pass 4 KB. (The phone-token socket goes first:
    // its self-declared hello made it a list-tabs target, a pre-existing gap the
    // meeting-tab path above refuses to inherit.)
    phone.ws.close();
    await wait(60);
    const big = Array.from({ length: 60 }, (_, i) => ({ id: i, title: 'x'.repeat(90), url: `https://example.com/${i}` }));
    const reply = svc.listTabs(2000);
    await wait(40);
    const req = ext.frames.find((f) => f.type === 'list-tabs');
    assert.ok(req, 'the desktop asked the extension for its tabs');
    ext.ws.send(JSON.stringify({ type: 'tabs', reqId: req.reqId, tabs: big }));
    const got = await reply;
    assert.ok(JSON.stringify({ type: 'tabs', reqId: req.reqId, tabs: big }).length > 4096);
    assert.equal(got.length, 60, 'a 20+ tab reply arrives');

    svc.setMeetingTabsWanted(false);
    await wait(40);
    assert.deepEqual(subscribes(ext.frames), [true, false], 'turning it off tells the extension');
    assert.ok(calls.some((c) => c.socket === null), 'and forgets every browser');
    svc.setMeetingTabsWanted(true);
    await wait(40);

    const before = calls.length;
    ext.ws.close();
    await wait(80);
    assert.ok(calls.slice(before).some((c) => c.socket !== null && c.tabs === null), 'a closed socket takes its tabs along');
  } finally {
    await svc.stop({ persist: false });
    svc.onMeetingTabs(null);
    svc.setMeetingTabsWanted(false);
  }
  assert.ok(calls.some((c) => c.socket === null), 'stopping the server forgets every browser');
});
