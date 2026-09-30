/**
 * Every decision phase 1 moved onto the vision resolver (2026-10-01), executed.
 * The characterization test proves the move changed no answer across the
 * corpus; these pin the answers that SHOULD change: getCapabilities() used to
 * classify a display string (a custom provider's name, a cURL UUID, a 9Router
 * id without its catalogue) and now asks the selection that will actually run.
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
const { LLMHelper } = require(dist('LLMHelper.js'));
const { gatewaySeatReadsImages } = require(dist('llm/visionResolver.js'));

function helper(state = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: '',
    ollamaModel: '', ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(), ...state,
  });
  return h;
}
const caps = (state) => helper(state).getCapabilities().supportsImages;

describe('getCapabilities().supportsImages follows the selection that will run', () => {
  test('a custom provider whose template carries images', () => {
    const customProvider = { id: 'c1', name: 'My Vision Box', curlCommand: 'curl -d \'{"img":"{{IMAGE_BASE64}}"}\' https://x' };
    assert.equal(caps({ customProvider }), true, 'was false: the NAME "My Vision Box" matches no rule');
  });
  test('a selected cURL provider follows its template, not its UUID', () => {
    const activeCurlProvider = { id: '6f1c2a4e-uuid', name: 'curl', curlCommand: 'curl -d \'{"prompt":"{{TEXT}}"}\' https://x' };
    assert.equal(caps({ activeCurlProvider }), false);
    activeCurlProvider.multimodal = true;
    assert.equal(caps({ activeCurlProvider }), true);
  });
  test("an Ollama model Ollama itself reports as vision, whatever it's called", () => {
    assert.equal(caps({ useOllama: true, ollamaModel: 'my-finetune:latest', ollamaVisionCache: new Map([['my-finetune:latest', true]]) }), true);
  });
  test("a 9Router model its catalogue calls text-only", () => {
    assert.equal(caps({ currentModelId: 'ninerouter/openai/gpt-5', ninerouterVisionModels: new Set(['gemini/gemini-3.6-flash']) }), false);
  });
  test('unchanged for plain selections', () => {
    assert.equal(caps({ currentModelId: 'gpt-5.5' }), true);
    assert.equal(caps({ currentModelId: 'deepseek-v4-flash' }), false);
    assert.equal(caps({ currentModelId: 'agentrouter/deepseek-v4-flash' }), true);
  });
  test('no usable selection never throws; it keeps the name answer', () => {
    assert.doesNotThrow(() => helper({ currentModelId: '' }).getCapabilities());
    assert.equal(caps({ currentModelId: 'some-unknown-model-xyz' }), false);
  });
  test('tier and budgets still come from the name', () => {
    const h = helper({ currentModelId: 'gpt-5.5' });
    const c = h.getCapabilities();
    assert.equal(c.tier, 'cloud');
    assert.ok(c.outputBudgetTokens > 0);
  });
});

describe('the gateway seat rule is the one shared function', () => {
  const ids = ['ninerouter/openai/gpt-5', 'ninerouter/alicode/glm-5', 'ninerouter/gemini/gemini-3.6-flash'];
  for (const catalogue of [[], ['gemini/gemini-3.6-flash']]) {
    test(`9Router, catalogue ${JSON.stringify(catalogue)}`, () => {
      const h = helper({ ninerouterVisionModels: new Set(catalogue) });
      for (const id of ids) {
        assert.equal(h.ninerouterModelSupportsVision(id), gatewaySeatReadsImages('ninerouter', id, { ninerouterVisionModels: catalogue }), id);
      }
    });
  }
  test('AgentRouter', () => {
    const h = helper();
    for (const id of ['agentrouter/claude-opus-5', 'agentrouter/deepseek-v4-flash', 'agentrouter/glm-5.3', 'agentrouter/o3']) {
      assert.equal(h.agentRouterModelSupportsVision(id), gatewaySeatReadsImages('agentrouter', id), id);
    }
  });
});

describe('VisionProviderRegistry asks the same function', () => {
  // Its bundle inlines CredentialsManager, so the rungs cannot be built here;
  // the shared function they call is executed above against LLMHelper's.
  const src = fs.readFileSync(path.join(__dirname, '../screen/VisionProviderRegistry.ts'), 'utf8');
  const body = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)));
  test('9Router rung', () => {
    assert.match(body('ninerouter'), /gatewaySeatReadsImages\('ninerouter'/);
    assert.doesNotMatch(body('ninerouter'), /visionModels\.length === 0/, 'the private copy of the rule is gone');
  });
  test('AgentRouter rung', () => {
    assert.match(body('agentrouter'), /gatewaySeatReadsImages\('agentrouter'/);
    assert.doesNotMatch(body('agentrouter'), /getModelCapabilities/, 'the private copy of the rule is gone');
  });
});

describe('the chain says why when nothing can read the screenshot', () => {
  test('local-only mode with no local vision model names local-only, not cloud keys', async () => {
    const h = helper({
      isLocalOnlyMode: true, currentModelId: 'deepseek-v4-flash',
      modelVersionManager: { getAllVisionTiers: () => [] }, visionHealth: new Map(),
    });
    let error = null;
    try {
      for await (const _ of h.streamVisionWithFallback({ userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' })) { /* drain */ }
    } catch (e) { error = e; }
    assert.ok(error, 'must throw: nothing can read it');
    assert.match(error.message, /^No vision-capable provider configured\./, '_streamChatInner keys its user message on this prefix');
    assert.match(error.message, /local-only mode/i);
    assert.doesNotMatch(error.message, /OpenAI, Claude, Gemini, or Groq/);
    // It must not claim nothing is INSTALLED: the chain also comes up empty when
    // Ollama isn't the selected provider, or its daemon is slow or down, and a
    // user with llava installed would be told to install what they have.
    assert.match(error.message, /select an Ollama vision model/i);
    assert.match(error.message, /Ollama is running/i);
    assert.doesNotMatch(error.message, /is set up/);
  });
});
