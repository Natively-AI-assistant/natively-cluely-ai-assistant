// electron/services/__tests__/PhoneMirrorExtensionConnectLatency2026_09_25.test.mjs
//
// "When I connect the browser extension it takes extra time to reflect in the
// app." Two causes, both in PhoneMirrorService:
//
//   1. The extension's `hello` flipped extensionConnected through the 150 ms
//      status debounce, so every connect reached Settings 150 ms late.
//   2. A Re-pair while already connected (same persisted token, same socket)
//      changed nothing the status carried: /pair succeeded and NO status was
//      emitted, so Settings' "Waiting for extension" ran out its 60 s window.
//
// The fix emits the extension flag at once and stamps `extPairedAt` on /pair.
// The debounce still has a job — the extension's raw socket counts as a phone
// for the 1-3 ms before its hello — and stop/rotate/restart must still END on
// the right state, so those are pinned here too.
//
// Loads the REAL compiled service with the same electron stub as
// PhoneMirrorExtensionV2.test.mjs. Set PHONE_MIRROR_SERVICE_BUNDLE to test a
// bundle built elsewhere (e.g. a scratch esbuild of the service alone).
//
// Ports: the service binds 127.0.0.1:4123+. On macOS a loopback bind succeeds
// even while an installed Natively holds *:4123 with LAN on, and then takes
// that app's extension traffic for the length of the test. Here 4123-4134
// refuse to bind (as if taken), so the service falls through to its own
// ephemeral-port fallback — and info.port is the port actually serving.
//
// Platform-agnostic (loopback HTTP + ws); runs the same on macOS and Windows.

import { test, describe, before, after } from 'node:test';
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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-latency-'));
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
// Well under the 150 ms debounce the fix removed, with room for a slow CI box.
const PROMPT_MS = 120;

let svc;

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

// ---- helpers ----
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

let port = 0;
const boundPort = () => port;

async function fresh() {
  if (svc.isRunning()) await svc.stop({ persist: false });
  port = (await svc.start({ exposeOnLan: false, persist: false })).port;
  assert.ok(port < 4123 || port >= 4135, `must never use a port a real Natively may hold (got ${port})`);
}

function record() {
  const emits = [];
  const off = svc.onStatusChange((info) => emits.push({ at: performance.now(), info }));
  return { emits, off };
}

async function pair() {
  svc.armExtensionPairing();
  const res = await fetch(`http://127.0.0.1:${boundPort()}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: DEV_EXTENSION_ORIGIN },
    body: '{}',
  });
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

/** Open the extension's socket; resolves with the socket and the hello send time. */
async function connectExtension(token) {
  const ws = new WS(`ws://127.0.0.1:${boundPort()}/ws?t=${encodeURIComponent(token)}`);
  ws.on('error', () => {});
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const helloAt = performance.now();
  ws.send(JSON.stringify({ type: 'hello', role: 'extension', v: 1 }));
  return { ws, helloAt };
}

describe('extension connect reaches Settings promptly', () => {
  test('hello → extensionConnected:true emits well inside the old 150 ms debounce', async () => {
    await fresh();
    const token = await pair();
    const rec = record();
    const { ws, helloAt } = await connectExtension(token);
    await settle(400);
    rec.off();
    const first = rec.emits.find((e) => e.info.extensionConnected);
    assert.ok(first, 'a connected status must be emitted');
    assert.ok(first.at - helloAt < PROMPT_MS, `connected status took ${(first.at - helloAt).toFixed(1)} ms`);
    ws.close();
    await settle(200);
  });

  test('a first connect never reports the extension socket as a phone', async () => {
    await fresh();
    const rec = record();
    const token = await pair();
    const { ws } = await connectExtension(token);
    await settle(400);
    rec.off();
    assert.ok(rec.emits.length > 0);
    assert.ok(rec.emits.every((e) => e.info.clients === 0), `saw ${rec.emits.map((e) => e.info.clients).join(',')}`);
    assert.equal(rec.emits.at(-1).info.extensionConnected, true);
    ws.close();
    await settle(200);
  });

  test('Re-pair while connected emits a fresh extPairedAt, promptly', async () => {
    await fresh();
    const { ws } = await connectExtension(await pair());
    await settle(300);
    const rec = record();
    const armedAt = Date.now();
    const t0 = performance.now();
    await pair();
    await settle(400);
    rec.off();
    const stamped = rec.emits.find((e) => (e.info.extPairedAt ?? 0) >= armedAt);
    assert.ok(stamped, 'a Re-pair must reach Settings (it used to emit nothing)');
    assert.equal(stamped.info.extensionConnected, true);
    assert.ok(stamped.at - t0 < PROMPT_MS, `pair status took ${(stamped.at - t0).toFixed(1)} ms`);
    ws.close();
    await settle(200);
  });
});

describe('lifecycle still ends on the right state with the extension connected', () => {
  test('stop → the last status says not running', async () => {
    await fresh();
    const { ws } = await connectExtension(await pair());
    await settle(300);
    const rec = record();
    await svc.stop({ persist: false });
    await settle(500);
    rec.off();
    assert.equal(rec.emits.at(-1)?.info.running, false);
    ws.close();
  });

  test('rotate → the last status carries the NEW extension token, disconnected', async () => {
    await fresh();
    const { ws } = await connectExtension(await pair());
    await settle(300);
    const rec = record();
    const rotated = await svc.rotateToken();
    await settle(500);
    rec.off();
    const last = rec.emits.at(-1)?.info;
    assert.equal(last?.extToken, rotated.extToken);
    assert.equal(last?.extensionConnected, false);
    assert.equal(last?.running, true);
    ws.close();
    await settle(200);
  });

  test('restart → the last status is the new server, disconnected, no phantom phone', async () => {
    await fresh();
    const { ws } = await connectExtension(await pair());
    await settle(300);
    const rec = record();
    const restarted = await svc.restart({ exposeOnLan: false, persist: false });
    port = restarted.port;
    await settle(500);
    rec.off();
    const last = rec.emits.at(-1)?.info;
    assert.equal(last?.running, true);
    assert.equal(last?.port, restarted.port);
    assert.equal(last?.extensionConnected, false);
    assert.ok(rec.emits.every((e) => e.info.clients === 0));
    ws.close();
    await settle(200);
  });
});
