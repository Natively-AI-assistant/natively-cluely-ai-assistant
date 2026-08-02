import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { callDeepseek, callGemini } from './clients.mjs';

// Fake streaming clients: the SDKs return async-iterables of chunks, so the
// fakes are async generators. No network, no API keys, no cost.
function fakeDeepseekClient(chunks, { capture } = {}) {
  return {
    chat: {
      completions: {
        create: async (req) => {
          if (capture) capture(req);
          return (async function* () { for (const c of chunks) yield c; })();
        },
      },
    },
  };
}

function fakeGeminiClient(chunks, { capture } = {}) {
  return {
    models: {
      generateContentStream: async (req) => {
        if (capture) capture(req);
        return (async function* () { for (const c of chunks) yield c; })();
      },
    },
  };
}

describe('callDeepseek', () => {
  test('accumulates streamed content and reads usage from the terminal chunk', async () => {
    const client = fakeDeepseekClient([
      { choices: [{ delta: { content: 'hi ' } }] },
      { choices: [{ delta: { content: 'there' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 12, completion_tokens: 3 } },
    ]);
    const r = await callDeepseek(client, { model: 'deepseek-v4-flash', systemPrompt: 'be terse', userPrompt: 'hello' });
    assert.equal(r.text, 'hi there');
    assert.equal(r.inputTokens, 12);
    assert.equal(r.outputTokens, 3);
    assert.equal(r.error, null);
    assert.ok(r.ttftMs !== null && r.ttftMs >= 0, 'ttft recorded');
    assert.ok(r.latencyMs >= r.ttftMs, 'total latency >= ttft');
  });

  test('disables thinking and pins the 64k ceiling, seed, and streaming usage', async () => {
    let req;
    const client = fakeDeepseekClient([{ choices: [{ delta: { content: 'x' } }] }], { capture: (r) => { req = r; } });
    await callDeepseek(client, { model: 'deepseek-v4-flash', userPrompt: 'x' });
    assert.deepEqual(req.thinking, { type: 'disabled' }, 'thinking disabled for production parity');
    assert.equal(req.max_tokens, 65536);
    assert.equal(req.seed, 7);
    assert.equal(req.stream, true);
    assert.deepEqual(req.stream_options, { include_usage: true });
  });

  test('honors an explicit maxOutputTokens override', async () => {
    let req;
    const client = fakeDeepseekClient([{ choices: [{ delta: { content: 'x' } }] }], { capture: (r) => { req = r; } });
    await callDeepseek(client, { model: 'deepseek-v4-flash', userPrompt: 'x', maxOutputTokens: 16384 });
    assert.equal(req.max_tokens, 16384);
  });

  test('omits the system message when systemPrompt is absent', async () => {
    let req;
    const client = fakeDeepseekClient([{ choices: [{ delta: { content: 'x' } }] }], { capture: (r) => { req = r; } });
    await callDeepseek(client, { model: 'deepseek-v4-flash', userPrompt: 'x' });
    assert.equal(req.messages.length, 1);
    assert.equal(req.messages[0].role, 'user');
  });

  test('captures errors instead of throwing', async () => {
    const client = {
      chat: { completions: { create: async () => { throw new Error('rate limited'); } } },
    };
    const r = await callDeepseek(client, { model: 'deepseek-v4-flash', userPrompt: 'x' });
    assert.equal(r.text, '');
    assert.equal(r.error, 'rate limited');
    assert.equal(r.ttftMs, null);
  });
});

describe('callGemini', () => {
  test('accumulates streamed text and reads usageMetadata from the terminal chunk', async () => {
    const client = fakeGeminiClient([
      { text: 'gemini ' },
      { text: 'says hi' },
      { text: '', usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 } },
    ]);
    const r = await callGemini(client, { model: 'gemini-3.6-flash', systemPrompt: 'be terse', userPrompt: 'hello' });
    assert.equal(r.text, 'gemini says hi');
    assert.equal(r.inputTokens, 20);
    assert.equal(r.outputTokens, 5);
    assert.equal(r.error, null);
    assert.ok(r.ttftMs !== null && r.ttftMs >= 0);
  });

  test('pins thinkingLevel MINIMAL for production parity', async () => {
    let req;
    const client = fakeGeminiClient([{ text: 'x' }], { capture: (r) => { req = r; } });
    await callGemini(client, { model: 'gemini-3.6-flash', userPrompt: 'x' });
    assert.deepEqual(req.config.thinkingConfig, { thinkingLevel: 'MINIMAL' });
    assert.equal(req.config.maxOutputTokens, 65536);
  });

  test('honors an explicit maxOutputTokens override', async () => {
    let req;
    const client = fakeGeminiClient([{ text: 'x' }], { capture: (r) => { req = r; } });
    await callGemini(client, { model: 'gemini-3.6-flash', userPrompt: 'x', maxOutputTokens: 8192 });
    assert.equal(req.config.maxOutputTokens, 8192);
  });

  test('captures errors instead of throwing', async () => {
    const client = { models: { generateContentStream: async () => { throw new Error('quota exceeded'); } } };
    const r = await callGemini(client, { model: 'gemini-3.1-flash-lite', userPrompt: 'x' });
    assert.equal(r.text, '');
    assert.equal(r.error, 'quota exceeded');
  });
});

describe('performance metrics', () => {
  test('throughputTps is end-to-end and genTps is post-first-token', async () => {
    // Two content chunks with a delay between them so genMs is non-zero.
    const slow = (async function* () {
      yield { choices: [{ delta: { content: 'a' } }] };
      await new Promise((r) => setTimeout(r, 30));
      yield { choices: [{ delta: { content: 'b' } }], usage: { prompt_tokens: 1, completion_tokens: 10 } };
    })();
    const client = { chat: { completions: { create: async () => slow } } };
    const r = await callDeepseek(client, { model: 'deepseek-v4-flash', userPrompt: 'x' });
    assert.equal(r.outputTokens, 10);
    assert.ok(r.throughputTps > 0, 'end-to-end throughput computed');
    assert.ok(r.genTps > 0, 'post-first-token rate computed');
    // genTps ignores the TTFT portion, so it is always >= end-to-end throughput.
    assert.ok(r.genTps >= r.throughputTps, 'genTps >= throughputTps by construction');
  });

  test('metrics are null rather than NaN when no tokens were produced', async () => {
    const client = fakeDeepseekClient([{ choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 0 } }]);
    const r = await callDeepseek(client, { model: 'deepseek-v4-flash', userPrompt: 'x' });
    assert.equal(r.text, '');
    assert.equal(r.ttftMs, null);
    assert.equal(r.throughputTps, null);
    assert.equal(r.genTps, null);
  });
});
