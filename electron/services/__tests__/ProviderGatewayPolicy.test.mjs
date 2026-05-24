import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

async function loadRouter() {
  const routerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/ProviderRouter.js');
  return import(pathToFileURL(routerPath).href);
}

test('assertProviderDataScopes throws ProviderScopeError when a denied scope is requested', async () => {
  const { assertProviderDataScopes, ProviderScopeError } = await loadRouter();

  assert.throws(
    () => assertProviderDataScopes('openai', ['transcript'], { transcript: false }),
    (err) => err instanceof ProviderScopeError && err.deniedScopes.includes('transcript')
  );
});

test('assertProviderDataScopes is a no-op when scopes are allowed or unset', async () => {
  const { assertProviderDataScopes } = await loadRouter();

  assert.doesNotThrow(() => assertProviderDataScopes('openai', ['transcript'], { transcript: true }));
  assert.doesNotThrow(() => assertProviderDataScopes('openai', ['transcript'], {}));
  assert.doesNotThrow(() => assertProviderDataScopes('openai', ['transcript'], undefined));
  assert.doesNotThrow(() => assertProviderDataScopes('openai', [], { transcript: false }));
});

test('routeLLMProviders marks all providers unavailable when scope is denied', async () => {
  const { routeLLMProviders } = await loadRouter();

  const attempts = routeLLMProviders({
    capability: 'chat',
    availability: { hasOpenAI: true, hasGroq: true, hasGemini: true },
    dataScopes: ['transcript'],
    scopePolicy: { transcript: false },
  });

  for (const attempt of attempts) {
    assert.equal(attempt.status, 'unavailable', `${attempt.provider} should be unavailable`);
    assert.equal(attempt.unavailableReason, 'disabled');
  }
});

test('routeLLMProviders keeps providers available when scopes are allowed', async () => {
  const { routeLLMProviders } = await loadRouter();

  const attempts = routeLLMProviders({
    capability: 'chat',
    availability: { hasOpenAI: true, hasGroq: true, hasGemini: true },
    dataScopes: ['transcript'],
    scopePolicy: { transcript: true },
  });

  const available = attempts.filter(a => a.status === 'available');
  assert.ok(available.length > 0, 'expected at least one provider to be available');
});

test('LLMHelper guards every outbound provider with assertOutboundScopes', () => {
  const src = read('electron/LLMHelper.ts');

  for (const guardSite of [
    "this.assertOutboundScopes('groq'",
    "this.assertOutboundScopes('openai'",
    "this.assertOutboundScopes('claude'",
    "this.assertOutboundScopes('gemini'",
    "this.assertOutboundScopes('natively'",
    "this.assertOutboundScopes('custom_curl'",
    "this.assertOutboundScopes('custom_provider'",
  ]) {
    assert.ok(src.includes(guardSite), `LLMHelper missing scope guard for ${guardSite}`);
  }
});

test('LLMHelper passes data scopes and policy to routeLLMProviders for fallback rotation', () => {
  const src = read('electron/LLMHelper.ts');

  assert.match(src, /dataScopes: outboundScopes/);
  assert.match(src, /scopePolicy,/);
});

test('Embedding provider resolver fails closed when embeddings scope is denied', () => {
  const src = read('electron/rag/EmbeddingProviderResolver.ts');

  assert.match(src, /assertProviderDataScopes\('openai_embeddings', \['embeddings'\], config\.providerDataScopes\)/);
  assert.match(src, /assertProviderDataScopes\('gemini_embeddings', \['embeddings'\], config\.providerDataScopes\)/);
});

test('RAGManager forwards providerDataScopes from config and runtime keys', () => {
  const src = read('electron/rag/RAGManager.ts');

  assert.match(src, /providerDataScopes\?: ProviderDataScopePolicy/);
  assert.match(src, /providerDataScopes: config\.providerDataScopes/);
});

test('SettingsManager exposes providerDataScopes setting', () => {
  const src = read('electron/services/SettingsManager.ts');

  assert.match(src, /providerDataScopes\?:\s*\{[\s\S]+transcript\?: boolean;/);
  assert.match(src, /post_call_summary\?: boolean;/);
});

test('IPC handlers expose get/set provider-data-scopes and broadcast updates', () => {
  const ipc = read('electron/ipcHandlers.ts');

  assert.match(ipc, /safeHandle\(['"]get-provider-data-scopes['"]/);
  assert.match(ipc, /safeHandle\(['"]set-provider-data-scopes['"]/);
  assert.match(ipc, /webContents\.send\('provider-data-scopes-changed', sanitized\)/);
  assert.match(ipc, /SettingsManager\.getInstance\(\)\.set\('providerDataScopes'/);
});

test('preload and renderer types expose provider data scope controls', () => {
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(preload, /getProviderDataScopes:/);
  assert.match(preload, /setProviderDataScopes:/);
  assert.match(preload, /onProviderDataScopesChanged:/);
  assert.match(preload, /ipcRenderer\.invoke\('get-provider-data-scopes'\)/);
  assert.match(preload, /ipcRenderer\.invoke\('set-provider-data-scopes', scopes\)/);

  assert.match(types, /getProviderDataScopes:\s*\(\)\s*=>\s*Promise/);
  assert.match(types, /setProviderDataScopes:\s*\(scopes:/);
});

test('SettingsOverlay renders cloud provider data scope controls wired to real IPC', () => {
  const src = read('src/components/SettingsOverlay.tsx');

  assert.match(src, /Cloud provider data scopes/);
  assert.match(src, /getProviderDataScopes\?\.\(\)\.then\(setProviderDataScopes\)/);
  assert.match(src, /setProviderDataScopes\?\.\(next\)/);
  assert.match(src, /onProviderDataScopesChanged\(setProviderDataScopes\)/);
});

test('main and ProcessingHelper hydrate ragManager.initializeEmbeddings with policy', () => {
  const main = read('electron/main.ts');
  const ph = read('electron/ProcessingHelper.ts');

  assert.match(main, /providerDataScopes/);
  assert.match(ph, /providerDataScopes/);
});
