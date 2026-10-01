/**
 * Shared harness for the Ollama tests (not a test file): a fake Ollama HTTP
 * server, and a bare LLMHelper pointed at it. No Ollama is installed where the
 * suite runs, so requests are asserted on the wire against this stand-in.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const require = createRequire(import.meta.url);
export const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
export const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-local-vision-'));
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => userData, getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
export const { LLMHelper } = require(dist('LLMHelper.js'));
const { SettingsManager } = require(dist('services/SettingsManager.js'));
const { renderDigitsPng } = require(dist('llm/visionTestImage.js'));

// ── A fake Ollama ────────────────────────────────────────────────────────────

/** `models`: name → true (reads images, per /api/show), false (text-only), or null (no capabilities reported). */
export function fakeOllama(models, { reply = 'local model reply', holdChat = false, showFails = false } = {}) {
  const requests = [];
  const open = new Set();
  let busy = null;            // a held chat: like a real daemon, the next chat waits until this one ends
  const waiting = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
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
          open.add(res); busy = res;
          res.on('close', () => { if (busy === res) busy = null; for (const run of waiting.splice(0)) run(); });
          res.writeHead(200, { 'content-type': 'application/x-ndjson' }); res.flushHeaders(); return;
        }
        if (busy) { await new Promise((r) => waiting.push(r)); }
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
export const CRED_SLOT = '__nativelyCredentialsManagerV1__';
/** Call once per test file: saves and restores the two global singletons around every test. */
export function isolateSingletons() {
  let slots;
  beforeEach(() => { slots = [globalThis[SETTINGS_SLOT], globalThis[CRED_SLOT]]; });
  afterEach(() => {
    for (const [i, slot] of [SETTINGS_SLOT, CRED_SLOT].entries()) { if (slots[i] === undefined) delete globalThis[slot]; else globalThis[slot] = slots[i]; }
  });
}
export const setMode = (mode) => SettingsManager.getInstance().setScreenUnderstandingMode(mode);
export const setScopes = (scopes) => SettingsManager.getInstance().set('providerDataScopes', scopes);
export const fakeCredentials = () => {
  globalThis[CRED_SLOT] = { getDisabledProviders: () => [], anyVisionProviderConfigured: () => true, anyLocalVisionProviderConfigured: () => false };
};

export function helper(url, selected) {
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
export const png = (() => { const p = path.join(userData, 'screen.png'); fs.writeFileSync(p, renderDigitsPng('4816')); return p; })();
export const pngBase64 = fs.readFileSync(png).toString('base64');
export async function ask(h, message, imagePaths) {
  let out = '';
  for await (const piece of LLMHelper.prototype._streamChatInner.call(h, message, imagePaths, undefined, 'SYS', true, true, [], undefined, 0, { v3Owned: true })) out += piece;
  return out;
}

