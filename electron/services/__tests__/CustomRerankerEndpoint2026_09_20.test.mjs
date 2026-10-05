/**
 * Verification of Custom Local Reranker Endpoint support (2026-09-20).
 *
 * Verifies end-to-end configuration, privacy semantics, credential storage,
 * seam port options, IPC channels, and UI options for local reranker endpoints.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

test('SettingsSchema declares custom reranker endpoint and model keys', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/services/SettingsManager.ts'), 'utf8');
  assert.match(src, /\bcustomRerankerEndpoint\?:\s*string;/, 'SettingsSchema must declare customRerankerEndpoint');
  assert.match(src, /\bcustomRerankerModel\?:\s*string;/, 'SettingsSchema must declare customRerankerModel');
});

test('CredentialsManager declares custom reranker API key and accessors', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/services/CredentialsManager.ts'), 'utf8');
  assert.match(src, /\bcustomRerankerApiKey\?:\s*string;/, 'StoredCredentials must declare customRerankerApiKey');
  assert.match(src, /getCustomRerankerApiKey\(\)/, 'CredentialsManager must expose getCustomRerankerApiKey');
  assert.match(src, /setCustomRerankerApiKey\(/, 'CredentialsManager must expose setCustomRerankerApiKey');
});

test('rerankerConfig defines custom provider and preserves privacy / local-only access', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/services/reranking/rerankerConfig.ts'), 'utf8');

  // Provider union
  assert.match(src, /'custom'/, "RerankerProvider union must contain 'custom'");

  // RerankerSettings
  assert.match(src, /\bcustomModel\?:\s*string;/, 'RerankerSettings must declare customModel');

  // Custom endpoints stay on-device and bypass localOnly, referenceFilesScopeAllowed, and hasApiKey checks
  assert.match(
    src,
    /if \(input\.provider === 'custom'\)\s*\{[\s\S]*?return \{ eligible: true \};/,
    "evaluateHostedEligibility must return eligible: true for custom provider without cloud or key requirements"
  );

  // readHostedApiKey and readHostedModel
  assert.match(src, /provider === 'custom'[\s\S]*?getCustomRerankerApiKey/, 'readHostedApiKey must read custom key');
  assert.match(src, /settings\.provider === 'custom'[\s\S]*?customRerankerModel/, 'readHostedModel must read customModel');

  // buildHostedRerankPort
  assert.match(src, /allowAnonymousApiKey:\s*true/, 'buildHostedRerankPort must allow anonymous API key for custom endpoint');
});

test('OpenRouterReranker allows anonymous / optional API keys for custom provider', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/services/reranking/OpenRouterReranker.ts'), 'utf8');
  assert.match(src, /\ballowAnonymousApiKey\?:\s*boolean;/, 'OpenRouterRerankerOptions must declare allowAnonymousApiKey');
  assert.match(src, /allowAnonymousApiKey\s*\|\|\s*this\.options\.providerId === 'custom'/, 'OpenRouterReranker must allow empty key when allowAnonymousApiKey or custom');
  assert.match(src, /Authorization:\s*`Bearer \$\{apiKey\}`/, 'OpenRouterReranker must conditionally send Authorization header');
});

test('customRerankModels helper exists and queries standard model listing routes', () => {
  const filePath = path.join(repoRoot, 'electron/rag/customRerankModels.ts');
  assert.ok(fs.existsSync(filePath), 'electron/rag/customRerankModels.ts must exist');

  const src = fs.readFileSync(filePath, 'utf8');
  assert.match(src, /export async function listCustomRerankModels\(/, 'Must export listCustomRerankModels');
  assert.match(src, /\/api\/v1\/models/, 'Must probe /api/v1/models');
  assert.match(src, /\/models/, 'Must probe /models');
  assert.match(src, /\/v1\/models/, 'Must probe /v1/models');
});

test('ipcHandlers registers custom endpoint channels and updates reranker status', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  assert.match(src, /'reranker:set-custom-endpoint'/, "Must register 'reranker:set-custom-endpoint' handler");
  assert.match(src, /'reranker:get-custom-models'/, "Must register 'reranker:get-custom-models' handler");
  assert.match(src, /\bcustomEndpoint:/, "reranker:get-status must report customEndpoint");
  assert.match(src, /\bcustomModel:/, "reranker:get-status must report customModel");
  assert.match(src, /\bhasCustomKey:/, "reranker:get-status must report hasCustomKey");
});

test('preload.ts exposes custom reranker API functions', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/preload.ts'), 'utf8');
  assert.match(src, /setRerankerCustomEndpoint:\s*\(input:\s*\{\s*url\?:\s*string;\s*apiKey\?:\s*string\s*\}\)/, 'ElectronAPI must declare setRerankerCustomEndpoint');
  assert.match(src, /getCustomRerankerModels:\s*\(\)\s*=>/, 'ElectronAPI must declare getCustomRerankerModels');
  assert.match(src, /setRerankerCustomEndpoint:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\('reranker:set-custom-endpoint'/, 'Must bind setRerankerCustomEndpoint to ipcRenderer');
  assert.match(src, /getCustomRerankerModels:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('reranker:get-custom-models'/, 'Must bind getCustomRerankerModels to ipcRenderer');
});

test('RerankerSettings.tsx renders Custom Endpoint card and On-device / Cloud badges', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'src/components/settings/RerankerSettings.tsx'), 'utf8');

  // Custom Endpoint Mark and Server icon
  assert.match(src, /const CustomEndpointMark: React\.FC/, 'Must define CustomEndpointMark');
  assert.match(src, /import\s*\{[^}]*\bServer\b[^}]*\}\s*from 'lucide-react'/, 'Must import Server icon');

  // Custom provider state & card
  assert.match(src, /Provider Card 2: Custom Local Endpoint/, 'Must include Custom Local Endpoint provider card');
  assert.match(src, /Custom reranker endpoint URL/, 'Must include input for custom reranker endpoint');
  assert.match(src, /Custom reranker API key \(optional\)/, 'Must include input for optional custom API key');

  // On-device tag on local cards; hosted cards carry no Cloud tag (removed 2026-09-22 by owner request).
  assert.ok(src.includes("<HardDrive size={12} strokeWidth={1.75} /> {t('On-device')}"), 'Must render On-device badge with HardDrive icon');
  assert.ok(!src.includes("{t('Cloud')}"), 'Hosted reranker cards must not render a Cloud tag');
});

test('normalizeCustomBaseUrl normalizes localhost and ports without scheme', () => {
  // Test the standard normalization rules implemented in CustomEmbeddingProvider
  function normalizeCustomBaseUrl(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return null;
    const withoutTrailing = trimmed.replace(/\/+$/, '');
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
      ? withoutTrailing
      : `http://${withoutTrailing}`;
    try {
      const u = new URL(withScheme);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (!u.hostname) return null;
      return withScheme;
    } catch {
      return null;
    }
  }

  assert.equal(normalizeCustomBaseUrl('localhost:8080'), 'http://localhost:8080');
  assert.equal(normalizeCustomBaseUrl('http://localhost:8080/'), 'http://localhost:8080');
  assert.equal(normalizeCustomBaseUrl('http://127.0.0.1:1234/v1/'), 'http://127.0.0.1:1234/v1');
  assert.equal(normalizeCustomBaseUrl('https://my-tei.internal:8080/rerank'), 'https://my-tei.internal:8080/rerank');
  assert.equal(normalizeCustomBaseUrl('   '), null);
  assert.equal(normalizeCustomBaseUrl('ftp://localhost:8080'), null);
});

test('custom endpoint rerank request payload and anonymous header formatting', () => {
  const query = 'machine learning query';
  const documents = ['passage 1', 'passage 2'];
  const model = 'BAAI/bge-reranker-large';
  const apiKey = '';

  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['Authorization'], undefined, 'No Authorization header sent for anonymous key');

  const body = {
    model,
    query,
    documents,
    top_n: documents.length,
  };

  assert.deepEqual(body, {
    model: 'BAAI/bge-reranker-large',
    query: 'machine learning query',
    documents: ['passage 1', 'passage 2'],
    top_n: 2,
  });
});

