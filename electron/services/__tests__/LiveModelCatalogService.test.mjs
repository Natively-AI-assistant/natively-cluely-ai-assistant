// electron/services/__tests__/LiveModelCatalogService.test.mjs
// Unit tests for LiveModelCatalogService caching, TTL expiration, and refresh lifecycle.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/services/LiveModelCatalogService.js');

// Mock CredentialsManager for unit test isolation
class MockCredentialsManager {
  constructor() {
    this.credentials = {
      cloudFetchedModels: {},
      cloudFetchedAt: {},
      apiKeys: {},
    };
  }

  getOpenaiApiKey() { return this.credentials.apiKeys.openai || ''; }
  getGeminiApiKey() { return this.credentials.apiKeys.gemini || ''; }
  getClaudeApiKey() { return this.credentials.apiKeys.claude || ''; }
  getGroqApiKey() { return this.credentials.apiKeys.groq || ''; }
  getDeepseekApiKey() { return this.credentials.apiKeys.deepseek || ''; }
  getNvidiaNimApiKey() { return this.credentials.apiKeys.nvidia_nim || ''; }
  getOpenrouterApiKey() { return this.credentials.apiKeys.openrouter || ''; }
  getFluxionApiKey() { return this.credentials.apiKeys.fluxion || ''; }
  getAgentRouterApiKey() { return this.credentials.apiKeys.agentrouter || ''; }

  getCloudFetchedModels(provider) {
    return this.credentials.cloudFetchedModels[provider] || [];
  }

  getCloudFetchedAt() {
    return this.credentials.cloudFetchedAt || {};
  }

  setCloudFetchedModels(provider, models, fetchedAt) {
    this.credentials.cloudFetchedModels[provider] = models;
    this.credentials.cloudFetchedAt[provider] = fetchedAt;
    return true;
  }
}

describe('LiveModelCatalogService', () => {
  let LiveModelCatalogService;

  beforeEach(async () => {
    // Dynamic import to test compiled output
    const mod = await import(`${pathToFileURL(modPath).href}?t=${Date.now()}`);
    LiveModelCatalogService = mod.LiveModelCatalogService;
  });

  test('isStale returns true when provider was never fetched', () => {
    const mockCm = new MockCredentialsManager();
    const service = new LiveModelCatalogService({ credentialsManager: mockCm });

    assert.equal(service.isStale('openai'), true);
  });

  test('isStale returns false when cache is within TTL, and true when older than TTL', () => {
    const mockCm = new MockCredentialsManager();
    const service = new LiveModelCatalogService({ credentialsManager: mockCm });

    const now = Date.now();
    // Fetched 1 hour ago (within 24h TTL)
    mockCm.setCloudFetchedModels('openai', [{ id: 'gpt-5.4', label: 'GPT-5.4' }], now - 3600000);
    assert.equal(service.isStale('openai'), false);

    // Fetched 25 hours ago (expired 24h TTL)
    mockCm.setCloudFetchedModels('openai', [{ id: 'gpt-5.4', label: 'GPT-5.4' }], now - 25 * 3600000);
    assert.equal(service.isStale('openai'), true);
  });

  test('refreshProvider fetches and caches models when provider has key', async () => {
    const mockCm = new MockCredentialsManager();
    mockCm.credentials.apiKeys.openai = 'sk-mock-key';

    let fetchCalledWith = null;
    const mockFetcher = async (provider, apiKey) => {
      fetchCalledWith = { provider, apiKey };
      return [
        { id: 'gpt-5.4', label: 'GPT-5.4' },
        { id: 'o3-mini', label: 'o3-mini' }
      ];
    };

    let broadcastCalled = false;
    const service = new LiveModelCatalogService({
      credentialsManager: mockCm,
      fetcher: mockFetcher,
      onUpdated: () => { broadcastCalled = true; }
    });

    const result = await service.refreshProvider('openai', true);
    assert.equal(result.success, true);
    assert.equal(result.models.length, 2);
    assert.deepEqual(fetchCalledWith, { provider: 'openai', apiKey: 'sk-mock-key' });
    assert.equal(mockCm.getCloudFetchedModels('openai').length, 2);
    assert.equal(broadcastCalled, true);
  });

  test('refreshProvider preserves cached models if fetch fails', async () => {
    const mockCm = new MockCredentialsManager();
    mockCm.credentials.apiKeys.openai = 'sk-mock-key';
    const oldModels = [{ id: 'gpt-4o', label: 'GPT-4o' }];
    mockCm.setCloudFetchedModels('openai', oldModels, Date.now() - 10000);

    const failingFetcher = async () => {
      throw new Error('Network timeout');
    };

    const service = new LiveModelCatalogService({
      credentialsManager: mockCm,
      fetcher: failingFetcher
    });

    const result = await service.refreshProvider('openai', true);
    assert.equal(result.success, false);
    // Preserves existing cache
    assert.deepEqual(mockCm.getCloudFetchedModels('openai'), oldModels);
  });

  test('credential rotation does not reuse old in-flight request and discards old results', async () => {
    const mockCm = new MockCredentialsManager();
    mockCm.credentials.apiKeys.openai = 'old-key';

    let resolveOldFetch;
    let oldFetchStarted = false;
    let newFetchStarted = false;

    const mockFetcher = async (provider, apiKey) => {
      if (apiKey === 'old-key') {
        oldFetchStarted = true;
        return new Promise((resolve) => {
          resolveOldFetch = () => resolve([{ id: 'old-model', label: 'Old Model' }]);
        });
      }
      if (apiKey === 'new-key') {
        newFetchStarted = true;
        return [{ id: 'new-model', label: 'New Model' }];
      }
      return [];
    };

    const service = new LiveModelCatalogService({
      credentialsManager: mockCm,
      fetcher: mockFetcher,
    });

    // Start fetch with old-key
    const oldPromise = service.refreshProvider('openai', true);
    assert.equal(oldFetchStarted, true);

    // User updates key to new-key
    mockCm.credentials.apiKeys.openai = 'new-key';

    // Forced refresh for new key should NOT reuse old-key's in-flight request
    const newPromise = service.refreshProvider('openai', true);
    assert.equal(newFetchStarted, true);

    const newResult = await newPromise;
    assert.equal(newResult.success, true);
    assert.equal(newResult.models[0].id, 'new-model');
    assert.equal(mockCm.getCloudFetchedModels('openai')[0].id, 'new-model');

    // Now complete the old fetch
    resolveOldFetch();
    const oldResult = await oldPromise;
    // Old fetch must fail/abort writing because credentials changed
    assert.equal(oldResult.success, false);
    // Crucial: Cache must still contain new-model, NOT overwritten by old-model
    assert.equal(mockCm.getCloudFetchedModels('openai')[0].id, 'new-model');
  });
});
