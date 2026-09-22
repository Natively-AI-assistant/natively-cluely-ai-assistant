// The structured-generation ladder (résumé / JD structuring, STAR stories, salary, research) tries
// the user's own OpenAI key, then Claude, then Gemini. The Gemini rungs had a 429 breaker; the
// OpenAI and Claude rungs did not. Measured live (2026-09-20, 45-role résumé, rate-limited OpenAI
// key): 140 of 141 calls burned ~9.7 s of 429 backoff on OpenAI before Gemini answered in ~4.4 s —
// 1,334 s of a 33-minute ingest spent on a provider that never succeeded once.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js');

const err429 = () => Object.assign(new Error('429 rate limit'), { status: 429 });

function bareHelper() {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    rateLimitCircuit: new Map(), isLocalOnlyMode: false, client: null, openaiClient: null, claudeClient: null,
    currentModelId: 'gemini-test', useOllama: false, customProvider: null, activeCurlProvider: null, nativelyKey: null,
    rateLimiters: { openai: { acquire: async () => {} }, claude: { acquire: async () => {} }, gemini: { acquire: async () => {} } },
  });
  h.assertOutboundScopes = () => {}; h.isCodexAvailable = () => false; h.isProviderDisabled = () => false;
  h.delay = async () => {}; h.getOpenAiPromptCacheKey = () => undefined;
  return h;
}

describe('structured ladder: a rate-limited own-key rung is skipped, not re-tried on every call', () => {
  test('OpenAI: three structured calls cost at most one tripped attempt, and every call still answers', async () => {
    const h = bareHelper(); let creates = 0;
    h.openaiClient = { chat: { completions: { create: async () => { creates++; throw err429(); } } } };
    h.claudeClient = {}; h.generateWithClaude = async () => '{"ok":true}';
    for (let i = 0; i < 3; i++) assert.equal(await h.generateContentStructured('extract'), '{"ok":true}');
    // Before: 3 attempts x 3 calls = 9 requests and ~8.4 s of backoff. Now: the 2nd consecutive 429 opens the breaker.
    assert.ok(creates <= 2, `OpenAI was called ${creates} times`);
    assert.ok(h.rateLimitCircuit.get('structured:openai')?.openUntil > Date.now(), 'breaker not open');
  });

  test('Claude: same', async () => {
    const h = bareHelper(); let streams = 0;
    h.claudeClient = { messages: { stream: () => { streams++; return { finalMessage: async () => { throw err429(); } }; } } };
    h.getClaudeMaxOutput = () => 1024;
    h.generateWithFlashFallbackForTest = null;
    // The rung after Claude: a custom provider stub, so the ladder has somewhere to land.
    h.customProvider = { name: 'stub', curlCommand: '', responsePath: '' }; h.executeCustomProvider = async () => '{"ok":true}';
    for (let i = 0; i < 3; i++) assert.equal(await h.generateContentStructured('extract'), '{"ok":true}');
    assert.ok(streams <= 2, `Claude was called ${streams} times`);
  });

  test('the breaker is scoped to the structured ladder — a direct OpenAI call carries no breaker key', async () => {
    const h = bareHelper(); let creates = 0;
    h.openaiClient = { chat: { completions: { create: async () => { creates++; throw err429(); } } } };
    h.isOpenAiModel = () => false;
    await assert.rejects(() => h.generateWithOpenai('hi'), /Model busy/);
    assert.equal(creates, 3, 'the chat path keeps its three attempts');
    assert.equal(h.rateLimitCircuit.size, 0);
  });

  // Review finding, reproduced: with the key set unconditionally, a user whose ONLY provider is OpenAI
  // lost all structured generation for 60 s after two 429s — before the breaker, the third attempt
  // answered in 1.2 s. A breaker may skip a rung only when there is another rung to fall to.
  test('a user with ONLY an OpenAI key keeps the old retry behaviour — no breaker, the third attempt answers', async () => {
    const h = bareHelper(); let creates = 0;
    h.openaiClient = { chat: { completions: { create: async () => { creates++; if (creates <= 2) throw err429(); return { choices: [{ message: { content: '{"ok":true}' } }] }; } } } };
    h.isOpenAiModel = () => false;
    assert.equal(await h.generateContentStructured('extract'), '{"ok":true}');
    assert.equal(creates, 3); assert.equal(h.rateLimitCircuit.size, 0, 'no breaker entry for a sole rung');
  });
  test('"consecutive" means consecutive: a non-429 error resets the count', async () => {
    const h = bareHelper(); const seq = [err429(), Object.assign(new Error('400 bad request'), { status: 400 })]; let i = 0;
    await assert.rejects(() => LLMHelper.prototype.withRetry.call(h, async () => { throw seq[Math.min(i++, 1)]; }, 3, 'k'));
    assert.equal(h.rateLimitCircuit.has('k'), false, 'a stale count of 1 used to make the NEXT lone 429 trip the breaker');
  });
  test('a success closes the breaker again', async () => {
    const h = bareHelper(); let mode = 'down';
    h.openaiClient = { chat: { completions: { create: async () => { if (mode === 'down') throw err429(); return { choices: [{ message: { content: '{"from":"openai"}' } }] }; } } } };
    h.isOpenAiModel = () => false;
    h.claudeClient = {}; h.generateWithClaude = async () => '{"from":"claude"}';
    assert.equal(await h.generateContentStructured('x'), '{"from":"claude"}');
    h.rateLimitCircuit.set('structured:openai', { openUntil: 0, consecutive429: 2 });   // cooldown elapsed
    mode = 'up';
    assert.equal(await h.generateContentStructured('x'), '{"from":"openai"}');
    assert.equal(h.rateLimitCircuit.has('structured:openai'), false);
  });
});
