// electron/services/__tests__/PhoneMirrorRefusedLinkPage2026_09_27.test.mjs
//
// "The 'Opened without a valid link' screen is a bare sentence; make it like
// the Link expired page." Without a valid token the desktop answered the page
// request with a plain-text 401 ("Pairing token missing or invalid."), so a
// link with no token, or a reload after Rotate token, never reached the
// page's own lock screen. It now serves the page itself (still 401, marked
// data-link="refused") and the page opens on the lock screen. HEAD stays
// bodiless: the page probes it to tell an expired link. The socket and every
// endpoint still need the token.
//
// Against the REAL server over loopback; platform-agnostic.

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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-refused-'));
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {} },
  BrowserWindow: class {
    static getFocusedWindow() { return null; }
    static getAllWindows() { return []; }
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

beforeEach(async () => {
  if (svc.isRunning()) await svc.stop({ persist: false });
  svc.history = [];
  svc.livePartial = null;
  const info = await svc.start({ exposeOnLan: false, persist: false });
  port = info.port;
  token = info.token;
  assert.ok(port < 4123 || port >= 4135);
});

const page = (q, method = 'GET') => fetch(`http://127.0.0.1:${port}/${q}`, { method, cache: 'no-store' });

describe('a link without a valid token opens on the lock screen', () => {
  test('no token: 401 with the page, marked refused', async () => {
    const r = await page('');
    const body = await r.text();
    assert.equal(r.status, 401);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(body, /<html lang="en" data-link="refused">/);
    assert.match(body, /id="lock"/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test('a stale token (reload after Rotate token): the same', async () => {
    const r = await page('?t=' + encodeURIComponent(token + 'x'));
    assert.equal(r.status, 401);
    assert.match(await r.text(), /data-link="refused"/);
  });

  test('HEAD stays a bare 401 for a refused link, 200 for a good one', async () => {
    const bad = await page('?t=nope', 'HEAD');
    assert.equal(bad.status, 401);
    assert.equal((await bad.text()).length, 0);
    const good = await page('?t=' + encodeURIComponent(token), 'HEAD');
    assert.equal(good.status, 200);
  });

  test('a good token: 200, not marked', async () => {
    const r = await page('?t=' + encodeURIComponent(token));
    assert.equal(r.status, 200);
    const body = await r.text();
    assert.doesNotMatch(body, /data-link="refused"/);
    assert.match(body, /<html lang="en">/);
  });

  test('the socket still refuses a stale token', async () => {
    const ws = new WS(`ws://127.0.0.1:${port}/ws?t=nope`);
    const outcome = await new Promise((resolve) => {
      ws.once('open', () => resolve('open'));
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.once('error', () => resolve('error'));
    });
    assert.notEqual(outcome, 'open');
  });
});
