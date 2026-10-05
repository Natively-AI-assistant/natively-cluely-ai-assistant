// electron/services/__tests__/PhoneMirrorImageUpload2026_09_27.test.mjs
//
// The Phone Mirror page can now send a photo or screenshot from the phone to
// the desktop (POST /image). main.ts registers the handler that saves it into
// the screenshot queue and attaches it to the next answer; the service only
// checks the upload and hands the bytes over. Pinned here, against the real
// service over real HTTP:
//
//   - POST only; the PHONE token only (the loopback extension token must never
//     be able to put files on this machine), nothing without a token
//   - size cap, whether the size is declared up front or only streamed
//   - the bytes must be an image (JPEG / PNG / WebP by their leading bytes),
//     whatever Content-Type claims
//   - no handler registered → 503; handler fails → 500 (the page shows Retry)
//   - success → the handler gets the exact bytes, typed by what they are
//
// Ports: same 4123-4134 guard as the other PhoneMirror tests.
// Platform-agnostic (loopback HTTP); same on macOS and Windows.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const require = createRequire(path.join(repoRoot, 'package.json'));
const http = require('node:http');

const bundlePath = process.env.PHONE_MIRROR_SERVICE_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_SERVICE_BUNDLE)
  : path.resolve(repoRoot, 'dist-electron/electron/services/PhoneMirrorService.js');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-image-'));
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
const MAX = 12 * 1024 * 1024;

// Smallest well-formed-enough headers for each accepted type.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32, 2)]);

let svc;
let info;
let received;
let clearHandler = null;

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
  info = await svc.start({ exposeOnLan: false, persist: false });
  assert.ok(info.port < 4123 || info.port >= 4135, `must never use a port a real Natively may hold (got ${info.port})`);
});

after(async () => {
  clearHandler?.();
  if (svc?.isRunning()) await svc.stop({ persist: false });
  Module._load = originalLoad;
  http.Server.prototype.listen = originalListen;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

beforeEach(() => {
  received = [];
  clearHandler?.();
  clearHandler = svc.setPhoneImageHandler(async (image) => { received.push(image); });
});

// token null = send none (undefined would take post()'s default, the real token).
const url = (token) => `http://127.0.0.1:${info.port}/image${token === null ? '' : `?t=${encodeURIComponent(token)}`}`;
async function post(body, { token = info.token, type = 'image/jpeg', method = 'POST' } = {}) {
  const res = await fetch(url(token), { method, headers: { 'Content-Type': type }, body: method === 'GET' ? undefined : body });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}

describe('phone image upload (POST /image)', () => {
  test('a JPEG reaches the handler byte for byte', async () => {
    const r = await post(JPEG);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
    assert.equal(received.length, 1);
    assert.ok(received[0].data.equals(JPEG), 'exact bytes');
    assert.equal(received[0].mime, 'image/jpeg');
    assert.equal(received[0].ext, 'jpg');
  });

  test('PNG and WebP are typed by their bytes, not the claimed Content-Type', async () => {
    assert.equal((await post(PNG, { type: 'image/jpeg' })).status, 200);
    assert.equal((await post(WEBP, { type: 'application/octet-stream' })).status, 200);
    assert.deepEqual(received.map((r) => r.ext), ['png', 'webp']);
  });

  test('bytes that are not an image are refused (415)', async () => {
    const r = await post(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), { type: 'image/svg+xml' });
    assert.equal(r.status, 415);
    assert.equal((await post(Buffer.alloc(0))).status, 415);
    assert.equal(received.length, 0);
  });

  test('only POST', async () => {
    const r = await post(null, { method: 'GET' });
    assert.equal(r.status, 405);
    assert.equal(received.length, 0);
  });

  test('no token, a wrong token, or the extension token → 401', async () => {
    assert.equal((await post(JPEG, { token: null })).status, 401);
    assert.equal((await post(JPEG, { token: 'x'.repeat(32) })).status, 401);
    svc.armExtensionPairing();
    const pair = await fetch(`http://127.0.0.1:${info.port}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: DEV_EXTENSION_ORIGIN },
      body: '{}',
    });
    assert.equal(pair.status, 200);
    const extToken = (await pair.json()).token;
    assert.ok(extToken && extToken !== info.token);
    assert.equal((await post(JPEG, { token: extToken })).status, 401);
    assert.equal(received.length, 0);
  });

  test('over the size cap, declared up front → 413 without reading it', async () => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(url(info.token), {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(MAX + 1) },
      }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.write(JPEG);   // never sends the rest
    });
    assert.equal(status, 413);
    assert.equal(received.length, 0);
  });

  test('over the size cap while streaming (no Content-Length) → 413', async () => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(url(info.token), {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'Transfer-Encoding': 'chunked' },
      }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve('reset'));
      const chunk = Buffer.alloc(1024 * 1024, 1);
      let sent = 0;
      const pump = () => {
        while (sent <= MAX + chunk.length) {
          sent += chunk.length;
          if (!req.write(chunk)) { req.once('drain', pump); return; }
        }
        req.end();
      };
      JPEG.copy(chunk, 0, 0, 3);
      pump();
    });
    // The server answers 413 and drops the socket; either is a refusal.
    assert.ok(status === 413 || status === 'reset', String(status));
    assert.equal(received.length, 0);
  });

  test('nobody to take it → 503; the handler fails → 500', async () => {
    clearHandler();
    clearHandler = null;
    assert.equal((await post(JPEG)).status, 503);
    clearHandler = svc.setPhoneImageHandler(async () => { throw new Error('disk full'); });
    const r = await post(JPEG);
    assert.equal(r.status, 500);
    assert.equal(r.json?.ok, false);
  });

  test('a stale unregister does not clear a newer handler', async () => {
    const off = svc.setPhoneImageHandler(async () => {});
    clearHandler = svc.setPhoneImageHandler(async (image) => { received.push(image); });
    off();
    assert.equal((await post(JPEG)).status, 200);
    assert.equal(received.length, 1);
  });

  test('the page itself still loads for the phone token', async () => {
    const res = await fetch(`http://127.0.0.1:${info.port}/?t=${encodeURIComponent(info.token)}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /id="imageInput"/);
    void net;
  });
});
