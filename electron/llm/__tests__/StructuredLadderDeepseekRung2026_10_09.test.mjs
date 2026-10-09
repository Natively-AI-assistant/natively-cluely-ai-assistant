// The structured-generation ladder (résumé / JD structuring, STAR stories, salary, research) had no DeepSeek rung.
// A user whose only key is DeepSeek got "No reasoning model available" on every structured call, and Profile
// Intelligence fell back to its rule-based résumé parser, which paired job titles with the wrong employers
// (measured on the evidence-rich benchmark, 2026-10-09). The rung is LAST: nobody with a working rung today is
// moved to another model; it only catches what used to fall through to that error.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/StructuredLadderDeepseekRung2026_10_09.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js');
const SOURCE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'LLMHelper.ts'), 'utf8');

function bareHelper() {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    rateLimitCircuit: new Map(), isLocalOnlyMode: false, client: null, openaiClient: null, claudeClient: null,
    currentModelId: 'deepseek-flash', useOllama: false, customProvider: null, activeCurlProvider: null, nativelyKey: null,
    deepseekPermanentlyDead: false,
    rateLimiters: { openai: { acquire: async () => {} }, claude: { acquire: async () => {} }, gemini: { acquire: async () => {} }, deepseek: { acquire: async () => {} } },
  });
  h.assertOutboundScopes = () => {}; h.isCodexAvailable = () => false; h.isProviderDisabled = () => false;
  h.delay = async () => {}; h.getOpenAiPromptCacheKey = () => undefined;
  return h;
}
/** A DeepSeek client that records every request body and answers with `reply` (or throws it). */
function deepseek(reply = '{"ok":"deepseek"}') {
  const calls = [];
  const client = { chat: { completions: { create: async (body) => { calls.push(body); if (reply instanceof Error) throw reply; return { choices: [{ message: { content: reply } }] }; } } } };
  return { client, calls };
}

describe('structured ladder: a user whose only key is DeepSeek gets a model', () => {
  test('before the rung existed this configuration had no rung at all', async () => {
    const h = bareHelper();
    await assert.rejects(() => h.generateContentStructured('extract'), /No reasoning model available/);
  });

  test('DeepSeek answers the structured call', async () => {
    const h = bareHelper(); const d = deepseek(); h.deepseekClient = d.client;
    assert.equal(await h.generateContentStructured('extract this résumé'), '{"ok":"deepseek"}');
    assert.equal(d.calls.length, 1);
  });

  test('the request: the default DeepSeek model, thinking off, the extraction temperature, the prompt as the only message', async () => {
    const h = bareHelper(); const d = deepseek(); h.deepseekClient = d.client;
    await h.generateContentStructured('extract this résumé');
    const body = d.calls[0];
    assert.equal(body.model, 'deepseek-flash');
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.temperature, 0.4);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'extract this résumé' }]);
  });

  test('it follows the user\'s default DeepSeek model, not whatever chat model is selected', async () => {
    const h = bareHelper(); const d = deepseek(); h.deepseekClient = d.client; h.currentModelId = 'deepseek-pro';
    await h.generateContentStructured('extract');
    assert.equal(d.calls[0].model, 'deepseek-flash');
  });
});

describe('structured ladder: DeepSeek is last, so nobody with a working rung is moved', () => {
  test('an OpenAI key that answers: DeepSeek is never called', async () => {
    const h = bareHelper(); const d = deepseek(); h.deepseekClient = d.client;
    h.openaiClient = {}; h.generateWithOpenai = async () => '{"from":"openai"}';
    assert.equal(await h.generateContentStructured('extract'), '{"from":"openai"}');
    assert.equal(d.calls.length, 0);
  });
  test('a Natively key that answers: the server\'s extraction loop still runs, DeepSeek is never called', async () => {
    const h = bareHelper(); const d = deepseek(); h.deepseekClient = d.client;
    let purpose = null;
    h.nativelyKey = 'k'; h.generateWithNatively = async (_m, _s, _i, opts) => { purpose = opts?.purpose; return '{"from":"natively"}'; };
    assert.equal(await h.generateContentStructured('extract'), '{"from":"natively"}');
    assert.equal(purpose, 'extraction');
    assert.equal(d.calls.length, 0);
  });
  test('a custom provider that answers: DeepSeek is never called', async () => {
    const h = bareHelper(); const d = deepseek(); h.deepseekClient = d.client;
    h.customProvider = { name: 'stub', curlCommand: '', responsePath: '' }; h.executeCustomProvider = async () => '{"from":"custom"}';
    assert.equal(await h.generateContentStructured('extract'), '{"from":"custom"}');
    assert.equal(d.calls.length, 0);
  });
  test('every other rung fails: DeepSeek answers instead of the call failing', async () => {
    const h = bareHelper(); const d = deepseek(); h.deepseekClient = d.client;
    h.nativelyKey = 'k'; h.generateWithNatively = async () => { throw new Error('402 no credit'); };
    assert.equal(await h.generateContentStructured('extract'), '{"ok":"deepseek"}');
    assert.equal(d.calls.length, 1);
  });
  test('in the source the rung is pushed after the Natively rung and before the no-provider error', () => {
    const natively = SOURCE.indexOf("name: 'Natively API',");
    const rung = SOURCE.indexOf('name: `DeepSeek (${DEEPSEEK_MODEL})`,');
    const none = SOURCE.indexOf("throw new Error('No reasoning model available.");
    assert.ok(natively > 0 && rung > natively && none > rung, `order natively ${natively} < deepseek ${rung} < error ${none}`);
  });
});

describe('structured ladder: when DeepSeek must not be used', () => {
  test('the provider is switched off in Settings: no rung', async () => {
    const h = bareHelper(); const d = deepseek(); h.deepseekClient = d.client;
    h.isProviderDisabled = (p) => p === 'deepseek';
    await assert.rejects(() => h.generateContentStructured('extract'), /No reasoning model available/);
    assert.equal(d.calls.length, 0);
  });
  test('the key failed permanently this session (no balance): no rung, no request', async () => {
    const h = bareHelper(); const d = deepseek(); h.deepseekClient = d.client; h.deepseekPermanentlyDead = true;
    await assert.rejects(() => h.generateContentStructured('extract'), /No reasoning model available/);
    assert.equal(d.calls.length, 0);
  });
  test('local-only mode: nothing leaves the machine', async () => {
    const h = bareHelper(); const d = deepseek(); h.deepseekClient = d.client; h.isLocalOnlyMode = true;
    await assert.rejects(() => h.generateContentStructured('extract'), /All reasoning models failed/);
    assert.equal(d.calls.length, 0);
  });
  test('the outbound scope guard is consulted before the request', async () => {
    const h = bareHelper(); const d = deepseek(); h.deepseekClient = d.client;
    const seen = []; h.assertOutboundScopes = (provider, payload) => { seen.push([provider, payload]); throw new Error('scope withheld'); };
    await assert.rejects(() => h.generateContentStructured('extract'), /All reasoning models failed/);
    assert.deepEqual(seen[0], ['deepseek', 'extract']);
    assert.equal(d.calls.length, 0);
  });
});

describe('the DeepSeek chat call is unchanged', () => {
  test('a caller that passes no temperature sends none (the provider default stays)', async () => {
    const h = bareHelper(); const d = deepseek('hello'); h.deepseekClient = d.client;
    assert.equal(await h.generateWithDeepseek('hi', 'system text'), 'hello');
    assert.equal('temperature' in d.calls[0], false);
    assert.deepEqual(d.calls[0].messages, [{ role: 'system', content: 'system text' }, { role: 'user', content: 'hi' }]);
  });
});
