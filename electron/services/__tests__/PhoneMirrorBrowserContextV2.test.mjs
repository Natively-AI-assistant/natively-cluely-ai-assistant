// electron/services/__tests__/PhoneMirrorBrowserContextV2.test.mjs
//
// Smart Browser Context v2 desktop integration: /dom accepting an optional
// structured `envelope` (back-compatible with the legacy {dom} string), the
// dom-context-received third arg, and the request-auto-context round-trip
// (capture-ack done/none). Mirrors the PhoneMirrorExtensionV2.test.mjs harness:
// stub electron via Module._load, load the compiled service from dist-electron,
// drive it with a real `ws` client + loopback fetch.
//
// Run: npm run test:services

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

const compiledServicePath = path.resolve(repoRoot, 'dist-electron/electron/services/PhoneMirrorService.js');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-bc-test-'));
const safeStorageStub = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
  decryptString: (buf) => Buffer.from(buf).toString('utf8').replace(/^enc:/, ''),
};
class FakeWebContents {
  constructor() { this.sent = []; }
  send(channel, ...args) { this.sent.push({ channel, args }); }
}
class FakeBrowserWindow {
  constructor() { this.webContents = new FakeWebContents(); this._destroyed = false; }
  isDestroyed() { return this._destroyed; }
  static getAllWindows() { return []; }
  static getFocusedWindow() { return null; }
}
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {} },
  BrowserWindow: FakeBrowserWindow,
  safeStorage: safeStorageStub,
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};

let PhoneMirrorService;
before(async () => {
  const mod = await import(pathToFileURL(compiledServicePath).href);
  PhoneMirrorService = mod.PhoneMirrorService;
});
after(() => {
  Module._load = originalLoad;
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
});

const EXT_ORIGIN = 'chrome-extension://macjecgdfliikhplbbdbpljomcigjnjg';

function connectExtension(port, token) {
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
async function freshService() {
  const svc = PhoneMirrorService.getInstance();
  if (svc.isRunning()) await svc.stop({ persist: false });
  const info = await svc.start({ exposeOnLan: false, persist: false });
  return { svc, info };
}
async function postDom(port, token, body, origin) {
  const res = await fetch(`http://127.0.0.1:${port}/dom?t=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const VALID_ENVELOPE = {
  envelopeVersion: 1,
  contextId: 'ctx-1',
  source: 'browser_extension',
  captureMode: 'auto',
  category: 'coding_problem',
  sensitivity: 'low',
  confidence: 'high',
  meta: { platform: 'LeetCode', title: 'Two Sum', host: 'leetcode.com', capturedAt: 1, charCount: 5, extractionSource: 'editor-dom' },
  payload: { problemTitle: 'Two Sum', visibleCode: 'def two_sum(): pass' },
};

describe('Smart Browser Context v2 — /dom envelope acceptance', () => {
  test('valid envelope is delivered as the 3rd dom-context-received arg', async () => {
    const { svc, info } = await freshService();
    const overlay = new FakeBrowserWindow();
    svc.setOverlayResolver(() => overlay);

    const r = await postDom(info.port, info.extToken, { dom: 'def two_sum(): pass', envelope: VALID_ENVELOPE }, EXT_ORIGIN);
    assert.equal(r.status, 200);
    const delivered = overlay.webContents.sent.filter((s) => s.channel === 'dom-context-received');
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].args[0], 'def two_sum(): pass'); // legacy dom string
    const env = delivered[0].args[2];
    assert.ok(env, 'envelope must be the 3rd arg');
    assert.equal(env.category, 'coding_problem');
    assert.equal(env.meta.platform, 'LeetCode');

    svc.setOverlayResolver(() => null);
    await svc.stop({ persist: false });
  });

  test('legacy {dom} POST still works (envelope arg is undefined)', async () => {
    const { svc, info } = await freshService();
    const overlay = new FakeBrowserWindow();
    svc.setOverlayResolver(() => overlay);

    const r = await postDom(info.port, info.extToken, { dom: 'plain legacy capture' }, EXT_ORIGIN);
    assert.equal(r.status, 200);
    const delivered = overlay.webContents.sent.filter((s) => s.channel === 'dom-context-received');
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].args[0], 'plain legacy capture');
    assert.equal(delivered[0].args[2], undefined, 'no envelope on a legacy POST');

    svc.setOverlayResolver(() => null);
    await svc.stop({ persist: false });
  });

  test('a malformed envelope is dropped but the dom string still delivers', async () => {
    const { svc, info } = await freshService();
    const overlay = new FakeBrowserWindow();
    svc.setOverlayResolver(() => overlay);

    const r = await postDom(info.port, info.extToken, { dom: 'ok', envelope: { envelopeVersion: 99, category: 'evil' } }, EXT_ORIGIN);
    assert.equal(r.status, 200);
    const delivered = overlay.webContents.sent.filter((s) => s.channel === 'dom-context-received');
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].args[0], 'ok');
    assert.equal(delivered[0].args[2], undefined, 'malformed envelope must be dropped');

    svc.setOverlayResolver(() => null);
    await svc.stop({ persist: false });
  });

  test('envelope POST still honors the no_active_session 409 gate', async () => {
    const { svc, info } = await freshService();
    svc.setOverlayResolver(() => null); // no overlay → no session

    const r = await postDom(info.port, info.extToken, { dom: 'x', envelope: VALID_ENVELOPE }, EXT_ORIGIN);
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'no_active_session');

    await svc.stop({ persist: false });
  });
});

describe('Smart Browser Context v2 — request-auto-context round-trip', () => {
  test('desktop sends request-auto-context; extension "done" resolves attached:true', async () => {
    const { svc, info } = await freshService();
    const { ws, frames } = await connectExtension(info.port, info.extToken);

    const p = svc.requestAutoContext({ timeoutMs: 1000 });
    // Wait for the desktop frame, then ack done.
    await new Promise((r) => setTimeout(r, 80));
    const req = frames.find((f) => f.type === 'request-auto-context');
    assert.ok(req && typeof req.reqId === 'string', 'desktop must send request-auto-context with a reqId');
    ws.send(JSON.stringify({ type: 'capture-ack', reqId: req.reqId, status: 'done', category: 'coding_problem' }));

    const result = await p;
    assert.equal(result.attached, true);
    assert.equal(result.category, 'coding_problem');

    ws.close();
    await svc.stop({ persist: false });
  });

  test('extension "none" (nothing eligible) resolves attached:false, reason none', async () => {
    const { svc, info } = await freshService();
    const { ws, frames } = await connectExtension(info.port, info.extToken);

    const p = svc.requestAutoContext({ timeoutMs: 1000 });
    await new Promise((r) => setTimeout(r, 80));
    const req = frames.find((f) => f.type === 'request-auto-context');
    ws.send(JSON.stringify({ type: 'capture-ack', reqId: req.reqId, status: 'none', reason: 'policy=manual' }));

    const result = await p;
    assert.equal(result.attached, false);
    assert.equal(result.reason, 'none');

    ws.close();
    await svc.stop({ persist: false });
  });

  test('no extension connected → attached:false, reason no-extension', async () => {
    const { svc } = await freshService();
    const result = await svc.requestAutoContext({ timeoutMs: 500 });
    assert.equal(result.attached, false);
    assert.equal(result.reason, 'no-extension');
    await svc.stop({ persist: false });
  });

  test('silent extension → timeout resolves attached:false', async () => {
    const { svc, info } = await freshService();
    const { ws } = await connectExtension(info.port, info.extToken);
    const result = await svc.requestAutoContext({ timeoutMs: 300 });
    assert.equal(result.attached, false);
    assert.equal(result.reason, 'timeout');
    ws.close();
    await svc.stop({ persist: false });
  });

  test('request-auto-context frame carries aiClassify + extraCategories', async () => {
    const { svc, info } = await freshService();
    const { ws, frames } = await connectExtension(info.port, info.extToken);
    const p = svc.requestAutoContext({ timeoutMs: 1000, aiClassify: true, extraCategories: ['job_description'] });
    await new Promise((r) => setTimeout(r, 80));
    const req = frames.find((f) => f.type === 'request-auto-context');
    assert.ok(req);
    assert.equal(req.aiClassify, true);
    assert.deepEqual(req.extraCategories, ['job_description']);
    ws.send(JSON.stringify({ type: 'capture-ack', reqId: req.reqId, status: 'none', reason: 'x' }));
    await p;
    ws.close();
    await svc.stop({ persist: false });
  });
});

async function postClassify(port, token, body, origin) {
  const res = await fetch(`http://127.0.0.1:${port}/classify?t=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const SAFE_META = {
  host: 'assess.acme.com',
  sanitizedUrl: 'https://assess.acme.com/challenge/42',
  pathTokens: ['challenge', '42'],
  titleTokens: ['coding', 'challenge'],
  hasCodeEditorSignal: true,
};

describe('Smart Browser Context v2 — /classify endpoint', () => {
  test('404 when no classifier is injected (feature off)', async () => {
    const { svc, info } = await freshService();
    svc.setMetadataClassifier(null);
    const r = await postClassify(info.port, info.extToken, { meta: SAFE_META }, EXT_ORIGIN);
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'classifier_unavailable');
    await svc.stop({ persist: false });
  });

  test('401 without the extension token', async () => {
    const { svc, info } = await freshService();
    svc.setMetadataClassifier(async () => ({ autoPolicy: 'auto', category: 'coding_problem' }));
    const r = await postClassify(info.port, 'wrong-token', { meta: SAFE_META }, EXT_ORIGIN);
    assert.equal(r.status, 401);
    svc.setMetadataClassifier(null);
    await svc.stop({ persist: false });
  });

  test('routes sanitized metadata through the injected classifier and returns its verdict', async () => {
    const { svc, info } = await freshService();
    let received = null;
    svc.setMetadataClassifier(async (meta) => {
      received = meta;
      return { autoPolicy: 'auto', category: 'coding_problem' };
    });
    const r = await postClassify(info.port, info.extToken, { meta: SAFE_META }, EXT_ORIGIN);
    assert.equal(r.status, 200);
    assert.equal(r.json.autoPolicy, 'auto');
    assert.equal(r.json.category, 'coding_problem');
    // The classifier received the sanitized metadata (host present, no raw URL).
    assert.equal(received.host, 'assess.acme.com');
    assert.ok(!JSON.stringify(received).includes('?'), 'no raw query string in classified metadata');
    svc.setMetadataClassifier(null);
    await svc.stop({ persist: false });
  });

  test('classifier throw → conservative manual verdict (never a 500)', async () => {
    const { svc, info } = await freshService();
    svc.setMetadataClassifier(async () => { throw new Error('provider down'); });
    const r = await postClassify(info.port, info.extToken, { meta: SAFE_META }, EXT_ORIGIN);
    assert.equal(r.status, 200);
    assert.equal(r.json.autoPolicy, 'manual');
    svc.setMetadataClassifier(null);
    await svc.stop({ persist: false });
  });

  test('400 on a missing meta field', async () => {
    const { svc, info } = await freshService();
    svc.setMetadataClassifier(async () => ({ autoPolicy: 'auto' }));
    const r = await postClassify(info.port, info.extToken, { notMeta: true }, EXT_ORIGIN);
    assert.equal(r.status, 400);
    svc.setMetadataClassifier(null);
    await svc.stop({ persist: false });
  });
});
