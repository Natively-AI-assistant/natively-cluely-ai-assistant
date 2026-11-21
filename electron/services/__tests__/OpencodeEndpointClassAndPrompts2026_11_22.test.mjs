/**
 * OpenCode's endpoint class and system prompts agree everywhere.
 *
 * Endpoint class. The comment on FAST_PICK_USER_ENDPOINT_FAMILIES requires it
 * to name the same families as activeModelIsUserEndpoint(), and
 * answerLatencyKey() already measured OpenCode as a user endpoint. OpenCode was
 * in only that last list, so it was measured like a gateway but budgeted like a
 * first-party provider (8 s first token, against first tokens measured up to
 * 6 s through Go), and hasEngineLevelRetry() said "no engine retry" for a route
 * that does go through streamSelectedProviderWithFailover — so the engine AND
 * IntelligenceEngine could both retry the same turn.
 *
 * Prompts. The main streaming path picks the base prompt by protocol
 * (opencodeDefaultSystemPrompt). The Background Model and blocking paths sent
 * the OpenAI prompt to Messages and Gemini models; AgentRouter, the closest
 * analogue, picks per protocol in the same switch.
 *
 * Run: node --test electron/services/__tests__/OpencodeEndpointClassAndPrompts2026_11_22.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.join(__dirname, '../../..');
const dist = (p) => path.join(root, 'dist-electron/electron', p);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));
const { opencodePresetMeta } = require(dist('llm/opencode/catalog.js'));
const src = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');

function activeModel(currentModelId) {
  const h = Object.create(LLMHelper.prototype);
  h.customProvider = null;
  h.activeCurlProvider = null;
  h.useOllama = false;
  h.currentModelId = currentModelId;
  h.opencodeModelMeta = opencodePresetMeta();
  return h;
}

describe('OpenCode is a user endpoint, in every list that asks', () => {
  test('the Active Model classification', () => {
    assert.equal(activeModel('opencode/glm-5.3').activeModelIsUserEndpoint(), true);
    assert.equal(activeModel('gemini-3.7-flash').activeModelIsUserEndpoint(), false, 'a first-party control');
  });

  test('the Background Model classification names the same family', () => {
    const line = src.slice(src.indexOf('const FAST_PICK_USER_ENDPOINT_FAMILIES'), src.indexOf('\n', src.indexOf('const FAST_PICK_USER_ENDPOINT_FAMILIES')));
    assert.match(line, /'opencode'/);
  });

  test('hasEngineLevelRetry() reports the failover engine the route really uses', () => {
    const h = activeModel('opencode/glm-5.3');
    h.fastPickForTextTurn = () => null;
    h.isUsingCodexCli = () => false;
    assert.equal(h.hasEngineLevelRetry(), true);
  });
});

describe('the base prompt follows the protocol on every path', () => {
  test('opencodeDefaultSystemPrompt differs by protocol', () => {
    const h = activeModel('opencode/glm-5.3');
    const chat = h.opencodeDefaultSystemPrompt('opencode/glm-5.3');
    const messages = h.opencodeDefaultSystemPrompt('opencode/claude-sonnet-5');
    const gemini = h.opencodeDefaultSystemPrompt('opencode/gemini-3.8-flash');
    assert.notEqual(chat, messages);
    assert.notEqual(chat, gemini);
    assert.notEqual(messages, gemini);
  });

  test('the Background Model path uses it', () => {
    assert.match(src, /case 'opencode': stream = this\.streamWithOpencode\(userContent, system\(this\.opencodeDefaultSystemPrompt\(modelId\)\)/);
  });

  test('the blocking path uses it, honouring skipSystemPrompt and the override', () => {
    assert.match(src, /const opencodeSystemPrompt = skipSystemPrompt\s*\? undefined\s*: this\.injectLanguageInstruction\(systemPromptOverride \|\| this\.opencodeDefaultSystemPrompt\(this\.currentModelId\)\);/);
    assert.match(src, /this\.generateWithOpencode\(cloudUserContent, opencodeSystemPrompt,/);
  });
});
