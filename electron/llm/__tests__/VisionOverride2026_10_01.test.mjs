/**
 * "Reads images: Auto / On / Off" per model (phase 4, 2026-10-01).
 *
 * The user's own answer, saved beside the provider catalogues and the test
 * results, and asked FIRST by the one resolver every screenshot path uses.
 * Design: docs/plans/2026-10-01-vision-capability-design.md §4.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const S = require(dist('llm/visionCapabilityStore.js'));
const { resolveVision, resolveVisionAuto, gatewaySeatReadsImages, readsImages } = require(dist('llm/visionResolver.js'));

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vision-override-')), 'vision-capabilities.json');
afterEach(() => S.__setVisionCapabilityStore(null));

describe('the saved answer', () => {
  test('On, Off and back to Auto', () => {
    const s = new S.VisionCapabilityStore({ filePath: null });
    assert.equal(s.override('fluxion', '', 'glm-5.3'), undefined, 'Auto is absence');
    s.setOverride('fluxion', '', 'glm-5.3', true);
    assert.equal(s.override('fluxion', '', 'glm-5.3'), true);
    s.setOverride('fluxion', '', 'glm-5.3', false);
    assert.equal(s.override('fluxion', '', 'glm-5.3'), false);
    s.setOverride('fluxion', '', 'glm-5.3', null);
    assert.equal(s.override('fluxion', '', 'glm-5.3'), undefined);
  });
  test('per model AND provider: the same id on another provider is a separate answer', () => {
    const s = new S.VisionCapabilityStore({ filePath: null });
    s.setOverride('agentrouter', '', 'claude-opus-5', false);
    assert.equal(s.override('claude', '', 'claude-opus-5'), undefined);
    assert.equal(s.override('agentrouter', '', 'claude-opus-5'), false);
  });
  test('survives a restart, beside the catalogue and the test results', () => {
    const file = tmpFile();
    const a = new S.VisionCapabilityStore({ filePath: file });
    a.replaceProviderAnswers('openrouter', '', new Map([['a/b', true]]));
    a.recordTest('fluxion', '', 'glm-5.3', false);
    assert.equal(a.setOverride('fluxion', '', 'glm-5.3', true), true, 'reports that the file was written');
    a.setOverride('ollama', '', 'qwen2.5:4b', false);
    const b = new S.VisionCapabilityStore({ filePath: file });
    assert.equal(b.override('fluxion', '', 'glm-5.3'), true);
    assert.equal(b.override('ollama', '', 'qwen2.5:4b'), false);
    assert.equal(b.answer('openrouter', '', 'a/b'), true, 'the catalogue is still there');
    assert.equal(b.tested('fluxion', '', 'glm-5.3').reads, false, 'the test result is still there');
    b.setOverride('fluxion', '', 'glm-5.3', null);
    assert.equal(new S.VisionCapabilityStore({ filePath: file }).override('fluxion', '', 'glm-5.3'), undefined, 'Auto is saved too');
  });
  test('a file written before phase 4 (no overrides section) loads, and a malformed section is ignored', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify({ version: 1, providers: { 'openrouter|': { fetchedAt: 9, models: { 'a/b': true } } }, tests: {} }));
    assert.equal(new S.VisionCapabilityStore({ filePath: file }).answer('openrouter', '', 'a/b'), true);
    fs.writeFileSync(file, JSON.stringify({ version: 1, providers: { 'openrouter|': { fetchedAt: 9, models: { 'a/b': true } } }, overrides: { 'x|': { m: 'yes', n: true }, bad: 5 } }));
    const s = new S.VisionCapabilityStore({ filePath: file });
    assert.equal(s.answer('openrouter', '', 'a/b'), true);
    assert.equal(s.override('x', '', 'm'), undefined);
    assert.equal(s.override('x', '', 'n'), true);
  });
  test('storedVisionOverride takes the ROUTED id and the proxy address, as the catalogue and test readers do', () => {
    const s = new S.VisionCapabilityStore({ filePath: null });
    s.setOverride('litellm', S.normalizeVisionBaseURL('http://localhost:4000/v1/'), 'my-model', true);
    s.setOverride('openrouter', '', 'openai/gpt-4o', false);
    S.__setVisionCapabilityStore(s);
    assert.equal(S.storedVisionOverride('litellm', 'litellm/my-model', S.normalizeVisionBaseURL('http://localhost:4000')), true);
    assert.equal(S.storedVisionOverride('litellm', 'litellm/my-model', S.normalizeVisionBaseURL('http://other:4000')), undefined, 'another proxy is another model');
    assert.equal(S.storedVisionOverride('openrouter', 'openrouter/openai/gpt-4o'), false);
  });
  test('forgetTest drops one saved test and nothing else', () => {
    const s = new S.VisionCapabilityStore({ filePath: null });
    s.recordTest('fluxion', '', 'a', false); s.recordTest('fluxion', '', 'b', true);
    s.forgetTest('fluxion', '', 'a');
    assert.equal(s.tested('fluxion', '', 'a'), undefined);
    assert.equal(s.tested('fluxion', '', 'b').reads, true);
    s.forgetTest('fluxion', '', 'never-tested');
  });
});

describe('the resolver asks the user first', () => {
  const over = (map) => ({ overriddenVision: (p, m) => map[`${p}|${m}`] });
  const EVERY = ['natively', 'gemini', 'openai', 'claude', 'groq', 'deepseek', 'nvidia_nim', 'openrouter', 'fluxion', 'agentrouter', 'litellm', 'ninerouter', 'ollama', 'codex-cli', 'antigravity', 'custom', 'curl'];
  const imageTemplate = { curlCommand: `curl https://x.example/v1 -d '{"image":"{{IMAGE_BASE64}}"}'` };
  const textTemplate = { curlCommand: `curl https://x.example/v1 -d '{"prompt":"{{TEXT}}"}'` };

  test('Off is a no for every provider, whatever else is known', () => {
    for (const provider of EVERY) {
      const model = provider === 'gemini' ? 'gemini-3.8-flash' : `${provider}-model`;
      const facts = { ...over({ [`${provider}|${model}`]: false }), customProvider: imageTemplate,
        ollamaReportsVision: () => true, ninerouterVisionModels: [model], providerReportsVision: () => true, testedVision: () => true };
      assert.deepEqual(resolveVision({ provider, model }, facts), { reads: 'no', source: 'override' }, provider);
    }
  });
  test('On beats a provider that says no, a failed test and a name on no list', () => {
    const on = (provider, model, extra) => resolveVision({ provider, model }, { ...over({ [`${provider}|${model}`]: true }), ...extra });
    assert.deepEqual(on('openrouter', 'openrouter/x/text', { providerReportsVision: () => false }), { reads: 'yes', source: 'override' });
    assert.deepEqual(on('ninerouter', 'ninerouter/x/text', { ninerouterVisionModels: ['other'] }), { reads: 'yes', source: 'override' });
    assert.deepEqual(on('ollama', 'qwen2.5:4b', { ollamaReportsVision: () => false }), { reads: 'yes', source: 'override' });
    assert.deepEqual(on('fluxion', 'fluxion/glm-5.3', { testedVision: () => false }), { reads: 'yes', source: 'override' });
    assert.deepEqual(on('agentrouter', 'agentrouter/never-heard-of-it', {}), { reads: 'yes', source: 'override' });
    assert.deepEqual(on('deepseek', 'deepseek-v4-pro', { testedVision: () => false }), { reads: 'yes', source: 'override' });
  });
  test('On cannot make a route carry an image it has no place for', () => {
    for (const provider of ['custom', 'curl']) {
      const facts = { ...over({ [`${provider}|p1`]: true }), customProvider: textTemplate };
      assert.deepEqual(resolveVision({ provider, model: 'p1' }, facts), { reads: 'no', source: 'route' }, provider);
      assert.equal(resolveVision({ provider, model: 'p1' }, { ...facts, customProvider: imageTemplate }).reads, 'yes');
    }
  });
  test('Auto is exactly what the resolver said before, and resolveVisionAuto never sees the override', () => {
    const facts = { testedVision: () => false };
    assert.deepEqual(resolveVision({ provider: 'fluxion', model: 'fluxion/glm-5.3' }, { ...facts, ...over({}) }), { reads: 'no', source: 'test' });
    assert.deepEqual(resolveVisionAuto({ provider: 'fluxion', model: 'fluxion/glm-5.3' }, { ...facts, ...over({ 'fluxion|fluxion/glm-5.3': true }) }), { reads: 'no', source: 'test' });
  });
  test('the gateway seats follow: On seats an unknown AgentRouter model, Off unseats an unknown OpenRouter one', () => {
    assert.equal(gatewaySeatReadsImages('agentrouter', 'agentrouter/new', {}), false);
    assert.equal(gatewaySeatReadsImages('agentrouter', 'agentrouter/new', over({ 'agentrouter|agentrouter/new': true })), true);
    assert.equal(gatewaySeatReadsImages('openrouter', 'openrouter/a/b', {}), true);
    assert.equal(gatewaySeatReadsImages('openrouter', 'openrouter/a/b', over({ 'openrouter|openrouter/a/b': false })), false);
    assert.equal(readsImages(resolveVision({ provider: 'openai', model: 'gpt-3.5-turbo' }, over({ 'openai|gpt-3.5-turbo': true })), false), true);
  });
});
