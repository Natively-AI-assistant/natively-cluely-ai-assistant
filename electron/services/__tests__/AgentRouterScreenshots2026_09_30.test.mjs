/**
 * Screenshots on AgentRouter's DeepSeek and GPT-6 (2026-09-30).
 *
 * Reproduced in the real app on an AgentRouter-only profile: a screenshot on the
 * DEFAULT model (agentrouter/deepseek-v4-flash) and on gpt-6-astra failed in
 * under 80 ms with "all vision models are unavailable", while both models read
 * the same screenshot correctly when it was sent to them through AgentRouter.
 * The capability table said text-only for both — DeepSeek because Natively's
 * DIRECT DeepSeek path is text-only, gpt-6 because the table did not know it.
 *
 * These pin the capability entries the fix added, and that the DeepSeek one is
 * scoped to AgentRouter: direct DeepSeek must stay text-only, because its
 * adapter never attaches an image and would answer blind.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { getModelCapabilities } = require(dist('llm/modelCapabilities.js'));
const { LLMHelper } = require(dist('LLMHelper.js'));

const reads = (id) => getModelCapabilities(id, false).supportsImages;

describe('capability table', () => {
  test('AgentRouter DeepSeek Flash reads images', () => {
    assert.equal(reads('agentrouter/deepseek-v4-flash'), true);
  });

  test('direct DeepSeek stays text-only — its adapter never sends an image', () => {
    assert.equal(reads('deepseek-flash'), false);
    assert.equal(reads('deepseek-v4-flash'), false);
  });

  test('the DeepSeek entry is AgentRouter\'s alone, and Flash only', () => {
    assert.equal(reads('openrouter/deepseek/deepseek-v4-flash'), false, 'other gateways are not measured');
    assert.equal(reads('fluxion/deepseek-v4-flash-0731'), false);
    assert.equal(reads('agentrouter/deepseek-v4-pro'), false, "DeepSeek's docs list no vision for V4 Pro");
  });

  test('gpt-6 reads images, on AgentRouter and directly', () => {
    assert.equal(reads('agentrouter/gpt-6-astra'), true);
    assert.equal(reads('gpt-6-astra'), true);
    assert.equal(reads('gpt-5.5'), true, 'unchanged');
  });

  test('Claude unchanged', () => {
    assert.equal(reads('agentrouter/claude-opus-5'), true);
  });
});

describe('Code Hint reads the same table', () => {
  test('a screenshot on AgentRouter DeepSeek is no longer refused as "doesn\'t support image input"', () => {
    const h = Object.create(LLMHelper.prototype);
    Object.assign(h, { useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: 'agentrouter/deepseek-v4-flash' });
    assert.equal(h.getCapabilities().supportsImages, true);
    h.currentModelId = 'agentrouter/gpt-6-astra';
    assert.equal(h.getCapabilities().supportsImages, true);
  });
});
