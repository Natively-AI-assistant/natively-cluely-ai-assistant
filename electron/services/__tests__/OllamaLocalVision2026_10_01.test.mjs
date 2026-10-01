/**
 * Ollama and screenshots that must stay on the machine (2026-10-01).
 *
 * Two things, both on one resolver (LLMHelper.refreshOllamaVisionModel:
 * /api/tags + /api/show, cached):
 *
 *  1. "Keep screenshots on this device", and a denied `screenshots` scope,
 *     decided whether local vision exists from the SELECTED model's NAME, then
 *     sent the image to that model. A user on a text model with a vision model
 *     installed was refused; a vision model whose name is not on the list was
 *     refused too (defect 4).
 *  2. After a screenshot answer, the Ollama model writes the screen's text
 *     record when no cloud provider does (Evin's rule).
 *
 * No Ollama is installed where this runs. A fake Ollama HTTP server stands in,
 * and the requests are asserted ON THE WIRE: the model named, the image bytes.
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-local-vision-'));
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => userData, getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { LLMHelper } = require(dist('LLMHelper.js'));
const { SettingsManager } = require(dist('services/SettingsManager.js'));
const { PRIVATE_VISION_NO_LOCAL_MESSAGE } = require(dist('llm/visionPolicy.js'));
const { renderDigitsPng } = require(dist('llm/visionTestImage.js'));

// ── A fake Ollama ────────────────────────────────────────────────────────────

/** `models`: name → true (reads images, per /api/show), false (text-only), or null (no capabilities reported). */
function fakeOllama(models, { reply = 'local model reply', holdChat = false } = {}) {
  const requests = [];
  const open = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const entry = { path: req.url, body, aborted: false };
      requests.push(entry);
      req.on('close', () => { if (!res.writableEnded) entry.aborted = true; });
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ models: Object.keys(models).map((name) => ({ name })) }));
      }
      if (req.url === '/api/show') {
        const reads = models[body?.name];
        if (reads === undefined) { res.writeHead(404); return res.end('{}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(reads === null ? {} : { capabilities: reads ? ['completion', 'vision'] : ['completion'] }));
      }
      if (req.url === '/api/chat') {
        if (holdChat) { open.add(res); res.writeHead(200, { 'content-type': 'application/x-ndjson' }); return; } // never answers
        if (body?.stream === false) {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ message: { role: 'assistant', content: reply }, done: true }));
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(JSON.stringify({ message: { role: 'assistant', content: reply }, done: false }) + '\n');
        return res.end(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n');
      }
      res.writeHead(404); res.end('{}');
    });
  });
  return {
    requests,
    chats: () => requests.filter((r) => r.path === '/api/chat'),
    start: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    stop: () => new Promise((r) => { for (const res of open) res.destroy(); server.closeAllConnections?.(); server.close(r); }),
  };
}

// ── A helper pointed at it ───────────────────────────────────────────────────

const SETTINGS_SLOT = '__nativelySettingsManagerV1__';
const CRED_SLOT = '__nativelyCredentialsManagerV1__';
let slots;
beforeEach(() => { slots = [globalThis[SETTINGS_SLOT], globalThis[CRED_SLOT]]; });
afterEach(() => {
  for (const [i, slot] of [SETTINGS_SLOT, CRED_SLOT].entries()) { if (slots[i] === undefined) delete globalThis[slot]; else globalThis[slot] = slots[i]; }
});
const setMode = (mode) => SettingsManager.getInstance().setScreenUnderstandingMode(mode);
const setScopes = (scopes) => SettingsManager.getInstance().set('providerDataScopes', scopes);
const fakeCredentials = () => {
  globalThis[CRED_SLOT] = { getDisabledProviders: () => [], anyVisionProviderConfigured: () => true, anyLocalVisionProviderConfigured: () => false };
};

function helper(url, selected) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: true, ollamaUrl: url, ollamaModel: selected, ollamaKeepAlive: '30m',
    ollamaVisionModel: null, ollamaVisionCache: new Map(), ollamaVisionNegativeUntil: 0, ollamaVisionRefreshInFlight: null,
    customProvider: null, activeCurlProvider: null, currentModelId: 'gemini-3.8-flash', isLocalOnlyMode: false,
    pickConfiguredCustomProviderForFallback: () => null, getActiveModeGroundingInfo: () => null,
    visionHealth: new Map(), textHealth: new Map(),
  });
  // No cloud adapter may be reached in any test here.
  h.cloud = [];
  for (const k of Object.getOwnPropertyNames(LLMHelper.prototype)) {
    if ((/^streamWith/.test(k) && k !== 'streamWithOllama') || k === 'streamVisionWithFallback') {
      h[k] = async function* (...args) { h.cloud.push({ provider: k, args }); yield 'CLOUD'; };
    }
  }
  return h;
}
const png = (() => { const p = path.join(userData, 'screen.png'); fs.writeFileSync(p, renderDigitsPng('4816')); return p; })();
const pngBase64 = fs.readFileSync(png).toString('base64');
async function ask(h, message, imagePaths) {
  let out = '';
  for await (const piece of LLMHelper.prototype._streamChatInner.call(h, message, imagePaths, undefined, 'SYS', true, true, [], undefined, 0, { v3Owned: true })) out += piece;
  return out;
}

// ── 1. Keep on device, and a denied screenshots scope ────────────────────────

describe('"Keep screenshots on this device": the screenshot goes to the Ollama model that reads images', () => {
  let ollama; let url;
  const boot = async (models, opts) => { ollama = fakeOllama(models, opts); url = await ollama.start(); };
  afterEach(async () => { await ollama?.stop(); ollama = null; });
  beforeEach(() => { fakeCredentials(); setScopes({}); });

  test('a text model is selected and a vision model is installed: the vision model answers, with the image', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true });
    setMode('private_vision');
    const h = helper(url, 'qwen2.5:4b');
    const out = await ask(h, 'what is on my screen?', [png]);
    assert.notEqual(out, PRIVATE_VISION_NO_LOCAL_MESSAGE, 'refused although an installed local model reads images');
    assert.equal(out, 'local model reply');
    const chat = ollama.chats();
    assert.equal(chat.length, 1);
    assert.equal(chat[0].body.model, 'llava:7b', 'the model the check found must be the model the image is sent to');
    assert.deepEqual(chat[0].body.messages.at(-1).images, [pngBase64]);
    assert.deepEqual(h.cloud, [], 'nothing cloud');
    assert.equal(h.ollamaModel, 'qwen2.5:4b', 'the selected text model is not replaced by the vision model');
  });
  test('the selected model reads images but its name is on no list: /api/show is believed', async () => {
    await boot({ 'acme-sight:latest': true });
    setMode('private_vision');
    const out = await ask(helper(url, 'acme-sight:latest'), 'what is on my screen?', [png]);
    assert.equal(out, 'local model reply');
    assert.equal(ollama.chats()[0].body.model, 'acme-sight:latest');
  });
  test('no installed model reads images: refused as before, and nothing is sent', async () => {
    await boot({ 'qwen2.5:4b': false, 'mistral:7b': false });
    setMode('private_vision');
    const h = helper(url, 'qwen2.5:4b');
    assert.equal(await ask(h, 'what is on my screen?', [png]), PRIVATE_VISION_NO_LOCAL_MESSAGE);
    assert.equal(ollama.chats().length, 0);
    assert.deepEqual(h.cloud, []);
  });
  test('a text turn in that mode still goes to the selected text model', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true });
    setMode('private_vision');
    const h = helper(url, 'qwen2.5:4b');
    h.streamWithOllama = async function* (...args) { h.cloud.push({ provider: 'ollama-text', args }); yield 'text'; };
    await ask(h, 'hello', undefined);
    assert.ok(!ollama.chats().some((c) => c.body.model === 'llava:7b'), 'the vision model is for screenshots only');
  });
});

describe('screenshots scope denied, Ollama selected', () => {
  let ollama; let url;
  afterEach(async () => { await ollama?.stop(); ollama = null; });
  beforeEach(() => { fakeCredentials(); setMode('vision_first'); });

  test('a screenshot turn goes to the installed vision model, not the selected text model', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false, 'llava:7b': true }); url = await ollama.start();
    setScopes({ screenshots: false });
    const h = helper(url, 'qwen2.5:4b');
    assert.equal(await ask(h, 'what is on my screen?', [png]), 'local model reply');
    const chat = ollama.chats();
    assert.equal(chat.length, 1);
    assert.equal(chat[0].body.model, 'llava:7b');
    assert.deepEqual(chat[0].body.messages.at(-1).images, [pngBase64]);
    assert.deepEqual(h.cloud, []);
  });
});

describe('the Privacy panel\'s "local vision available" indicator', () => {
  let ollama;
  afterEach(async () => { await ollama?.stop(); ollama = null; });
  beforeEach(() => fakeCredentials());

  test('true when ANY installed model reads images; false when none does; never rewrites the selection', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false, 'llava:7b': true });
    const h = helper(await ollama.start(), 'qwen2.5:4b');
    assert.equal(await h.scopeFallbackAvailable(true), true);
    assert.equal(await h.scopeFallbackAvailable(false), true);
    assert.equal(h.ollamaModel, 'qwen2.5:4b');
    await ollama.stop();
    ollama = fakeOllama({ 'qwen2.5:4b': false });
    const none = helper(await ollama.start(), 'qwen2.5:4b');
    assert.equal(await none.scopeFallbackAvailable(true), false);
    assert.equal(await none.scopeFallbackAvailable(false), true, 'text fallback is still available');
  });
  test('Ollama not selected: no request is made to any daemon', async () => {
    ollama = fakeOllama({ 'llava:7b': true });
    const h = Object.assign(helper(await ollama.start(), 'llava:7b'), { useOllama: false });
    assert.equal(await h.scopeFallbackAvailable(true), false);
    assert.equal(ollama.requests.length, 0);
  });
});

export { fakeOllama, helper, png, pngBase64, setMode, setScopes, fakeCredentials, userData, dist, require as requireFromTest };
