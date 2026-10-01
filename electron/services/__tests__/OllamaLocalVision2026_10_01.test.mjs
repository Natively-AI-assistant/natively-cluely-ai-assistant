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
function fakeOllama(models, { reply = 'local model reply', holdChat = false, showFails = false } = {}) {
  const requests = [];
  const open = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const entry = { path: req.url, body, aborted: false };
      requests.push(entry);
      res.on('close', () => { if (!res.writableEnded) entry.aborted = true; });
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ models: Object.keys(models).map((name) => ({ name })) }));
      }
      if (req.url === '/api/show') {
        if (showFails) { res.writeHead(500); return res.end('{}'); }
        const reads = models[body?.name];
        if (reads === undefined) { res.writeHead(404); return res.end('{}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(reads === null ? {} : { capabilities: reads ? ['completion', 'vision'] : ['completion'] }));
      }
      if (req.url === '/api/chat') {
        if (typeof holdChat === 'function' ? holdChat(body) : holdChat) {            // accepted, never answered
          open.add(res); res.writeHead(200, { 'content-type': 'application/x-ndjson' }); res.flushHeaders(); return;
        }
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
  afterEach(async () => { await ollama?.stop(); ollama = null; setScopes({}); });
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
  // Scopes and mode persist in the settings file: reset what the previous block denied.
  beforeEach(() => { fakeCredentials(); setScopes({}); setMode('vision_first'); });

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
  test('fails CLOSED: a daemon that lists models but cannot describe them is not "local vision available"', async () => {
    // With /api/show failing the resolver falls back to the model's NAME, and
    // `llava` looks like a vision model. A guess must not light the indicator
    // or admit a screenshot: the answer has to be confirmed by the daemon.
    ollama = fakeOllama({ 'llava:7b': true }, { showFails: true });
    const h = helper(await ollama.start(), 'llava:7b');
    assert.equal(await h.scopeFallbackAvailable(true), false);
    setMode('private_vision');
    assert.equal(await ask(h, 'what is on my screen?', [png]), PRIVATE_VISION_NO_LOCAL_MESSAGE);
    assert.equal(ollama.chats().length, 0);
  });
  test('the remembered vision model was uninstalled: refused once, forgotten, and the next check finds the new one', async () => {
    const models = { 'qwen2.5:4b': false, 'llava:7b': true };
    ollama = fakeOllama(models);
    const h = helper(await ollama.start(), 'qwen2.5:4b');
    assert.equal(await h.scopeFallbackAvailable(true), true);
    delete models['llava:7b']; models['bakllava:latest'] = true;       // `ollama rm llava:7b && ollama pull bakllava`
    assert.equal(await h.scopeFallbackAvailable(true), false, 'the remembered model is gone: not available');
    assert.equal(await h.scopeFallbackAvailable(true), true, 'and it is looked up again, not remembered as gone');
    assert.equal(h.getOllamaRecordTarget().model, 'bakllava:latest');
  });
});

// ── 2. The Ollama model writes the after-the-answer screen record ────────────

const { getScreenUnderstandingService, OLLAMA_RECORD_BUDGET_MS } = require(dist('services/screen/ScreenUnderstandingService.js'));
const { composeScreenDescription } = require(dist('services/screen/screenDescription.js'));
const SYSTEM = 'Extract what is on the screen.';

describe('runVisionRequest("ollama"): the record request, on the wire', () => {
  let ollama;
  afterEach(async () => { await ollama?.stop(); ollama = null; });
  beforeEach(() => fakeCredentials());

  test('the resolved vision model, the image and the system prompt', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false, 'llava:7b': true }, { reply: 'A terminal with a build error.' });
    const url = await ollama.start();
    const h = helper(url, 'qwen2.5:4b');
    assert.equal(h.getOllamaRecordTarget(), null, 'nothing is known before the resolver has run');
    assert.deepEqual(await h.resolveOllamaRecordTarget(), { model: 'llava:7b', url });
    assert.deepEqual(h.getOllamaRecordTarget(), { model: 'llava:7b', url });
    assert.equal(await h.runVisionRequest('ollama', 'What is on the screen?', SYSTEM, png, {}), 'A terminal with a build error.');
    const [chat] = ollama.chats();
    assert.equal(chat.body.model, 'llava:7b');
    assert.deepEqual(chat.body.messages.at(-1).images, [pngBase64]);
    assert.equal(chat.body.messages[0].content, SYSTEM);
    assert.equal(h.ollamaModel, 'qwen2.5:4b');
  });
  test('no model that reads images: no target, and the request is refused before it is made', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false });
    const h = helper(await ollama.start(), 'qwen2.5:4b');
    assert.equal(await h.resolveOllamaRecordTarget(), null);
    await assert.rejects(() => h.runVisionRequest('ollama', 'u', SYSTEM, png, {}), /No local model that reads images/);
    assert.equal(ollama.chats().length, 0);
  });
  test('Ollama not selected: no target and no request to any daemon', async () => {
    ollama = fakeOllama({ 'llava:7b': true });
    const h = Object.assign(helper(await ollama.start(), 'llava:7b'), { useOllama: false });
    assert.equal(await h.resolveOllamaRecordTarget(), null);
    assert.equal(ollama.requests.length, 0);
  });
});

describe('the screen record through the service', () => {
  let ollama; let h; let n = 0;
  const svc = getScreenUnderstandingService();
  const cloudKeys = (keys) => {
    const has = (k) => (keys.includes(k) ? `key-${k}` : undefined);
    globalThis[CRED_SLOT] = {
      getDisabledProviders: () => [], anyVisionProviderConfigured: () => true, anyLocalVisionProviderConfigured: () => false,
      getNativelyApiKey: () => undefined, getOpenaiApiKey: () => undefined, getGeminiApiKey: () => has('gemini'), getClaudeApiKey: () => undefined,
      getGroqApiKey: () => undefined, getDeepseekApiKey: () => undefined, getOpenrouterApiKey: () => undefined, getNvidiaNimApiKey: () => undefined,
      getFluxionApiKey: () => undefined, getAgentRouterApiKey: () => undefined, getLitellmBaseURL: () => undefined, getNinerouterBaseURL: () => undefined,
      getNinerouterVisionModels: () => [], getAllCredentials: () => ({}),
    };
  };
  const boot = async (models, opts, selected = 'qwen2.5:4b') => {
    ollama = fakeOllama(models, opts);
    h = helper(await ollama.start(), selected);
    globalThis.__nativelyGetLLMHelper = () => h;
  };
  const understand = (userAction, mode = 'vision_first') => {
    const shot = path.join(userData, `record-${++n}.png`);
    fs.writeFileSync(shot, renderDigitsPng(String(2000 + n)));          // a new image each time: no cache hit
    return svc.understand({ imagePaths: [shot], userAction, transcript: 'q', screenUnderstandingMode: mode, providerPolicy: { allowScreenshots: true, localOnly: mode === 'private_vision' } });
  };
  beforeEach(() => { cloudKeys([]); svc.rungHealth.clear(); });
  afterEach(async () => { delete globalThis.__nativelyGetLLMHelper; await ollama?.stop(); ollama = null; });

  test('no cloud provider: the Ollama vision model writes the record', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true }, { reply: 'FATAL: disk quota exceeded (code E4012).' });
    const result = await understand('transcribe');
    assert.equal(result.status, 'available');
    assert.equal(result.providerUsed, 'ollama');
    assert.match(composeScreenDescription(result), /E4012/, 'the text a later turn will quote');
    assert.equal(ollama.chats()[0].body.model, 'llava:7b');
  });
  test('"keep on this device": the record stays local, written by Ollama', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true }, { reply: 'A login form.' });
    cloudKeys(['gemini']);
    const cloud = [];
    const real = h.runVisionRequest;
    h.runVisionRequest = function (id, ...rest) { if (id !== 'ollama') { cloud.push(id); return Promise.resolve('CLOUD'); } return real.call(this, id, ...rest); };
    const result = await understand('transcribe', 'private_vision');
    assert.equal(result.providerUsed, 'ollama');
    assert.deepEqual(cloud, [], 'no cloud provider may be asked in this mode');
  });
  test('a cloud provider is available: it writes the record, and Ollama is not asked', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true });
    cloudKeys(['gemini']);
    const real = h.runVisionRequest;
    h.runVisionRequest = function (id, ...rest) { return id === 'ollama' ? real.call(this, id, ...rest) : Promise.resolve('Cloud transcription of the screen.'); };
    const result = await understand('transcribe');
    assert.equal(result.providerUsed, 'gemini_flash_lite');
    assert.equal(ollama.chats().length, 0);
  });
  test('every cloud provider fails: Ollama still writes it', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true }, { reply: 'A stack trace.' });
    cloudKeys(['gemini']);
    const real = h.runVisionRequest;
    h.runVisionRequest = function (id, ...rest) { return id === 'ollama' ? real.call(this, id, ...rest) : Promise.reject(Object.assign(new Error('503 unavailable'), { status: 503 })); };
    assert.equal((await understand('transcribe')).providerUsed, 'ollama');
  });
  test('the PRE-PASS never asks Ollama: it runs before the answer, inside 6 seconds', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true });
    for (const action of ['what_to_say', 'what_to_answer', 'manual_use_screen']) {
      const result = await understand(action);
      assert.notEqual(result.status, 'available', action);
    }
    assert.equal(ollama.chats().length, 0);
  });
  test('whatever shape the local model answers in, a record is kept', async () => {
    for (const reply of [
      JSON.stringify({ visibleSummary: 'A build log.', extractedText: 'error TS2345 at src/app.ts:12' }),
      'The screen shows a build log. Line 12 reports error TS2345 in src/app.ts.',
      '```json\n' + JSON.stringify({ visibleSummary: 'A build log.', extractedText: 'error TS2345 at src/app.ts:12' }) + '\n```',
    ]) {
      await boot({ 'llava:7b': true }, { reply }, 'llava:7b');
      const text = composeScreenDescription(await understand('transcribe'));
      assert.match(text, /TS2345/, `lost for reply: ${reply.slice(0, 40)}`);
      assert.doesNotMatch(text, /```json/, 'a fenced JSON reply is unwrapped, not stored as raw markup');
      await ollama.stop(); ollama = null; svc.rungHealth.clear();
    }
  });
  test('the record gets its own time limit, far longer than the pre-pass', () => {
    assert.ok(OLLAMA_RECORD_BUDGET_MS >= 30_000 && OLLAMA_RECORD_BUDGET_MS <= 60_000, String(OLLAMA_RECORD_BUDGET_MS));
  });
  test('an Ollama ANSWER cancels a record still in flight, and nothing is kept for it', async () => {
    await boot({ 'llava:7b': true }, { holdChat: (body) => Boolean(body?.messages?.at(-1)?.images) }, 'llava:7b');
    const record = understand('transcribe');
    for (let i = 0; i < 200 && ollama.chats().length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(ollama.chats().length, 1, 'the record request is in flight');
    let answer = '';
    for await (const piece of h.streamWithOllama('the next question', undefined, 'SYS')) answer += piece;
    assert.equal(answer, 'local model reply', 'the user\'s next answer is not queued behind the record');
    const result = await record;
    assert.equal(ollama.chats()[0].aborted, true, 'the record request was cancelled on the wire');
    assert.equal(composeScreenDescription(result), '');
  });
});

export { fakeOllama, helper, png, pngBase64, setMode, setScopes, fakeCredentials, userData, dist, require as requireFromTest };
