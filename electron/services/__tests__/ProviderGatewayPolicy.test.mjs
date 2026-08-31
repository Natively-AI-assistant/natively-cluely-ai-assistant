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

  // The three cloud embedding providers are now scope-gated through ONE helper
  // (pushScoped) instead of three inline assert calls, so the scope name is a
  // parameter. The guarantee is unchanged and additionally asserted
  // behaviourally in electron/rag/__tests__/EmbeddingResolverNativelyFirst.test.mjs,
  // which proves a denying policy leaves ONLY the local-capable provider.
  assert.match(src, /assertProviderDataScopes\(scopeName, \['embeddings'\], config\.providerDataScopes\)/);
  for (const scope of ['openai_embeddings', 'gemini_embeddings', 'natively_embeddings']) {
    assert.match(src, new RegExp(`pushScoped\\('${scope}'`), `${scope} must be scope-gated`);
  }
});

test('RAGManager forwards providerDataScopes from config and runtime keys', () => {
  // 2026-08-30: RAGManager stopped hand-declaring a SUBSET of the embedding
  // config and now takes AppAPIConfig wholesale. The old assertions anchored on
  // that hand-written subset (`providerDataScopes?: ProviderDataScopePolicy`
  // plus a `providerDataScopes: config.providerDataScopes` copy line), both of
  // which correctly disappeared with it.
  //
  // The subset was the BUG, not the contract: every field it forgot to list —
  // the Ollama, custom-endpoint and cloud embedding settings — was silently
  // dropped on the way to the resolver. Inheriting the type forwards
  // providerDataScopes (and everything else) without a list anyone can forget
  // to update, so this now asserts the inheritance rather than the copy.
  const src = read('electron/rag/RAGManager.ts');

  assert.match(src, /import type \{ AppAPIConfig \} from '\.\/EmbeddingProviderResolver'/);
  assert.match(src, /interface RAGManagerConfig extends Partial<AppAPIConfig>/);
  assert.match(src, /initializeEmbeddings\(keys: AppAPIConfig\)/);
  // And the field must still exist on the inherited type.
  const resolver = read('electron/rag/EmbeddingProviderResolver.ts');
  assert.match(resolver, /providerDataScopes\?: ProviderDataScopePolicy/);
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
  // 2026-08-01: the handler no longer rebuilds the policy from the incoming
  // payload (`sanitized`), which deleted any key the sender did not repeat and
  // silently erased the enforced `code_execution` scope. It merges over the
  // stored policy and broadcasts the merged result — broadcasting the incoming
  // payload would reintroduce the erasure on the renderer's next write.
  assert.match(ipc, /webContents\.send\('provider-data-scopes-changed', merged\)/);
  assert.match(ipc, /const merged = mergeProviderDataScopes\(settings\.get\('providerDataScopes'\), scopes\)/);
  assert.match(ipc, /settings\.set\('providerDataScopes', merged/);
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

test('AIProvidersSettings renders cloud provider data scope controls wired to real IPC', () => {
  const src = read('src/components/settings/AIProvidersSettings.tsx');

  assert.match(src, /Cloud provider data scopes/);
  assert.match(src, /getProviderDataScopes\?\.\(\)\.then\(setProviderDataScopes\)/);
  assert.match(src, /setProviderDataScopes\?\.\(next\)/);
  assert.match(src, /onProviderDataScopesChanged\(setProviderDataScopes\)/);
});

test('main and ProcessingHelper hydrate ragManager.initializeEmbeddings with policy', () => {
  const ph = read('electron/ProcessingHelper.ts');
  assert.match(ph, /providerDataScopes/);

  // main.ts no longer names the policy directly: it goes through
  // buildEmbeddingConfig(), the single builder shared by all four embedding
  // config entry points (they had already drifted once, silently dropping
  // geminiKeys at three of the four). The policy still reaches the resolver —
  // assert the chain rather than the old inline mention.
  const main = read('electron/main.ts');
  assert.match(main, /initializeEmbeddings\(buildEmbeddingConfig\(/);
  assert.match(main, /new RAGManager\(\{[\s\S]{0,200}?\.\.\.buildEmbeddingConfig\(\)/);
  const builder = read('electron/rag/embeddingConfigIdentity.ts');
  // The builder resolves SettingsManager once into a local, then reads the
  // policy from it — assert the READ and the hand-off, not the call shape.
  assert.match(builder, /settings\?\.get\('providerDataScopes'\)/);
  assert.match(builder, /SettingsManager\.getInstance\(\)/);
  assert.match(builder, /providerDataScopes: sources\.providerDataScopes/);
});
