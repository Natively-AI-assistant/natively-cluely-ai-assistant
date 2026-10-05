/**
 * OpenRouter's own answer to "does this model read images" (2026-10-01): the
 * `architecture.input_modalities` array on GET /api/v1/models. Trusted both
 * ways, because OpenRouter itself refuses an image sent to a model it lists as
 * text-only ("No endpoints found that support image input").
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const { parseOpenRouterVision } = require(dist('llm/providerVisionData.js'));
const { resolveVision, gatewaySeatReadsImages } = require(dist('llm/visionResolver.js'));
const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/openrouterModels2026_10_01.json'), 'utf8'));

describe('parseOpenRouterVision, on the real catalogue', () => {
  const parsed = parseOpenRouterVision(catalogue);
  test('every listed model gets an answer, keyed by its OpenRouter id', () => {
    const listed = catalogue.data.filter((m) => !m.id.endsWith(':batch') && Array.isArray(m.architecture.input_modalities));
    assert.equal(parsed.size, listed.length);
    for (const m of listed) assert.equal(parsed.get(m.id), m.architecture.input_modalities.includes('image'), m.id);
  });
  test('known answers', () => {
    assert.equal(parsed.get('openai/gpt-4o'), true);
    assert.equal(parsed.get('deepseek/deepseek-v4-flash'), false);
    assert.equal(parsed.get('google/gemma-4-31b-it'), true);
  });
  test(':batch duplicates are dropped, as the model picker drops them', () => {
    for (const id of parsed.keys()) assert.ok(!id.endsWith(':batch'), id);
  });
  test('malformed input is no answers, never a throw', () => {
    for (const bad of [null, undefined, {}, { data: 'x' }, { data: [null, { id: 5 }, { id: 'a/b', architecture: null }] }]) {
      assert.equal(parseOpenRouterVision(bad).size, 0);
    }
  });
});

describe('the resolver consults the provider for OpenRouter', () => {
  const facts = (map) => ({ providerReportsVision: (provider, routed) => provider === 'openrouter' ? map[routed.replace(/^openrouter\//, '')] : undefined });
  test("OpenRouter's answer beats the name list, both ways", () => {
    assert.deepEqual(resolveVision({ provider: 'openrouter', model: 'openrouter/openai/gpt-4o' }, facts({ 'openai/gpt-4o': false })), { reads: 'no', source: 'provider' });
    assert.deepEqual(resolveVision({ provider: 'openrouter', model: 'openrouter/x-ai/grok-4.7' }, facts({ 'x-ai/grok-4.7': true })), { reads: 'yes', source: 'provider' });
  });
  test('no answer: the name list, as in phase 1', () => {
    assert.deepEqual(resolveVision({ provider: 'openrouter', model: 'openrouter/openai/gpt-4o' }, facts({})), { reads: 'yes', source: 'names' });
    assert.deepEqual(resolveVision({ provider: 'openrouter', model: 'openrouter/x-ai/grok-4.7' }, facts({})), { reads: 'unknown', source: null });
  });
  test('the seat: unknown keeps today\'s seat; OpenRouter\'s "no" skips it', () => {
    assert.equal(gatewaySeatReadsImages('openrouter', 'openrouter/x-ai/grok-4.7', facts({})), true);
    assert.equal(gatewaySeatReadsImages('openrouter', 'openrouter/deepseek/deepseek-v4-flash', facts({ 'deepseek/deepseek-v4-flash': false })), false);
  });
  test('only OpenRouter (both ways) and LiteLLM (a yes) read a provider\'s published answer', () => {
    // The stub used to enforce this rule itself (it answered for 'openrouter'
    // only), so a resolver that read provider data for EVERY provider passed.
    // This one answers whoever asks.
    const says = (answer) => ({ providerReportsVision: () => answer });
    for (const provider of ['fluxion', 'agentrouter', 'nvidia_nim', 'ninerouter', 'openai', 'claude', 'gemini', 'groq', 'deepseek']) {
      assert.equal(resolveVision({ provider, model: `${provider}/never-heard-of-it` }, says(true)).reads, 'unknown', `${provider}: a published "yes" is not its answer`);
    }
    assert.equal(resolveVision({ provider: 'fluxion', model: 'fluxion/gpt-4o' }, says(false)).reads, 'yes', 'a published "no" does not beat the name list either');
    assert.equal(resolveVision({ provider: 'openrouter', model: 'openrouter/x/y' }, says(false)).reads, 'no');
    assert.equal(resolveVision({ provider: 'litellm', model: 'litellm/x' }, says(true)).reads, 'yes');
    assert.equal(resolveVision({ provider: 'litellm', model: 'litellm/x' }, says(false)).reads, 'unknown', 'LiteLLM: nothing there is not "no"');
  });
});
