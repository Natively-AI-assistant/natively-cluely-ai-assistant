/**
 * The vision resolver (2026-10-01): one answer to "can this selection read a
 * screenshot?", three-valued, with where the answer came from.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
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
const { resolveVision, readsImages, gatewaySeatReadsImages } = require(dist('llm/visionResolver.js'));

const v = (provider, model, facts) => resolveVision({ provider, model }, facts);
const yes = (source) => ({ reads: 'yes', source });
const no = (source) => ({ reads: 'no', source });
const unknown = { reads: 'unknown', source: null };

describe('decided by the route', () => {
  test('Natively, Codex and Antigravity always carry the image to a model that reads it', () => {
    assert.deepEqual(v('natively', 'natively'), yes('route'));
    assert.deepEqual(v('codex-cli', 'gpt-5.5'), yes('route'));
    assert.deepEqual(v('antigravity', 'antigravity:gemini-3.1-pro'), yes('route'));
  });
  test("direct DeepSeek's adapter never attaches an image, whatever the model", () => {
    assert.deepEqual(v('deepseek', 'deepseek-v4-flash'), no('route'));
  });
  test("custom and cURL follow the provider's template", () => {
    assert.deepEqual(v('custom', 'id', { customProvider: { multimodal: true } }), yes('route'));
    assert.deepEqual(v('custom', 'id', { customProvider: { multimodal: false } }), no('route'));
    assert.deepEqual(v('curl', 'id', { customProvider: { curlCommand: 'curl -d \'{"image":"{{IMAGE_BASE64}}"}\' https://x' } }), yes('route'));
    assert.deepEqual(v('curl', 'id', { customProvider: { curlCommand: 'curl -d \'{"prompt":"{{TEXT}}"}\' https://x' } }), no('route'));
    assert.deepEqual(v('custom', 'id', {}), no('route'), 'no provider object: nothing can carry an image');
  });
});

describe('Ollama', () => {
  test("Ollama's own answer beats the name list, both ways", () => {
    assert.deepEqual(v('ollama', 'my-finetune:latest', { ollamaReportsVision: () => true }), yes('provider'));
    assert.deepEqual(v('ollama', 'llava:7b', { ollamaReportsVision: () => false }), no('provider'));
  });
  test('not probed: the name list can say yes, and never says no', () => {
    assert.deepEqual(v('ollama', 'qwen2.5vl:7b'), yes('names'));
    assert.deepEqual(v('ollama', 'llama3.1:8b'), unknown);
  });
});

describe('9Router', () => {
  const facts = { ninerouterVisionModels: ['openai/gpt-5'] };
  test("a fetched catalogue is the provider's answer, both ways", () => {
    assert.deepEqual(v('ninerouter', 'ninerouter/openai/gpt-5', facts), yes('provider'));
    assert.deepEqual(v('ninerouter', 'ninerouter/openai/gpt-3.5-turbo', facts), no('provider'));
  });
  test('an unfetched catalogue falls to the name list', () => {
    assert.deepEqual(v('ninerouter', 'ninerouter/openai/gpt-5'), yes('names'));
    assert.deepEqual(v('ninerouter', 'ninerouter/alicode/glm-5'), unknown);
  });
});

describe('everything else: the name list, which proves yes and never no', () => {
  test('gateways and direct vendors', () => {
    assert.deepEqual(v('agentrouter', 'agentrouter/claude-opus-5'), yes('names'));
    assert.deepEqual(v('agentrouter', 'agentrouter/glm-5.3'), unknown);
    assert.deepEqual(v('openai', 'o3'), yes('names'));
    assert.deepEqual(v('openai', 'gpt-3.5-turbo'), unknown);
    assert.deepEqual(v('gemini', 'gemini-2.5-flash'), yes('names'));
    assert.deepEqual(v('openrouter', 'openrouter/qwen/qwen2.5-vl-72b-instruct'), yes('names'));
  });
});

describe('readsImages: the caller states what unknown means', () => {
  test('yes and no ignore the policy', () => {
    assert.equal(readsImages(yes('names'), false), true);
    assert.equal(readsImages(no('route'), true), false);
  });
  test('unknown takes the policy', () => {
    assert.equal(readsImages(unknown, true), true);
    assert.equal(readsImages(unknown, false), false);
  });
});

describe('gatewaySeatReadsImages: one rule for both screenshot paths', () => {
  test('9Router seats on unknown (an unfetched catalogue is not "text-only"); AgentRouter does not', () => {
    assert.equal(gatewaySeatReadsImages('ninerouter', 'ninerouter/alicode/glm-5'), true);
    assert.equal(gatewaySeatReadsImages('agentrouter', 'agentrouter/glm-5.3'), false);
  });
  test('a catalogue "no" is never seated', () => {
    assert.equal(gatewaySeatReadsImages('ninerouter', 'ninerouter/alicode/glm-5', { ninerouterVisionModels: ['openai/gpt-5'] }), false);
  });
});
describe('a one-time test result (phase 3)', () => {
  const tested = (map) => ({ testedVision: (provider, routed) => map[`${provider}:${routed}`] });
  test('beats the name list, both ways', () => {
    assert.deepEqual(v('agentrouter', 'agentrouter/glm-5.3', tested({ 'agentrouter:agentrouter/glm-5.3': true })), { reads: 'yes', source: 'test' });
    assert.deepEqual(v('openai', 'gpt-5.5', tested({ 'openai:gpt-5.5': false })), { reads: 'no', source: 'test' });
  });
  test("loses to the provider's own data", () => {
    const facts = { ...tested({ 'openrouter:openrouter/a/b': true }), providerReportsVision: () => false };
    assert.deepEqual(v('openrouter', 'openrouter/a/b', facts), { reads: 'no', source: 'provider' });
    const nine = { ...tested({ 'ninerouter:ninerouter/a/b': true }), ninerouterVisionModels: ['x/y'] };
    assert.deepEqual(v('ninerouter', 'ninerouter/a/b', nine), { reads: 'no', source: 'provider' });
  });
  test('fills in where a catalogue has no entry', () => {
    assert.deepEqual(v('openrouter', 'openrouter/new/model', { ...tested({ 'openrouter:openrouter/new/model': false }), providerReportsVision: () => undefined }), { reads: 'no', source: 'test' });
    assert.deepEqual(v('ninerouter', 'ninerouter/a/b', tested({ 'ninerouter:ninerouter/a/b': true })), { reads: 'yes', source: 'test' });
  });
  test('never applies to route-decided providers or Ollama', () => {
    assert.deepEqual(v('deepseek', 'deepseek-v4-flash', tested({ 'deepseek:deepseek-v4-flash': true })), { reads: 'no', source: 'route' });
    assert.deepEqual(v('natively', 'natively', tested({ 'natively:natively': false })), { reads: 'yes', source: 'route' });
    assert.deepEqual(v('ollama', 'llama3.1:8b', tested({ 'ollama:llama3.1:8b': true })), unknown);
  });
  test('gateway seats: a tested "no" is skipped; unknown seats as it always did', () => {
    for (const p of ['litellm', 'nvidia_nim', 'fluxion']) {
      const id = `${p}/some/model`;
      assert.equal(gatewaySeatReadsImages(p, id), true, `${p} unknown`);
      assert.equal(gatewaySeatReadsImages(p, id, tested({ [`${p}:${id}`]: false })), false, `${p} tested no`);
    }
    assert.equal(gatewaySeatReadsImages('agentrouter', 'agentrouter/glm-5.3', tested({ 'agentrouter:agentrouter/glm-5.3': true })), true);
  });
});
