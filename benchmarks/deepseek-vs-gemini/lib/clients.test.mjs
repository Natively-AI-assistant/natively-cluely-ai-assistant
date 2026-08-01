import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { callDeepseek, callGemini } from './clients.mjs';

describe('callDeepseek', () => {
  test('extracts text and token usage from a successful completion', async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async (req) => {
            assert.equal(req.model, 'deepseek-v4-flash');
            assert.equal(req.messages[0].role, 'system');
            assert.equal(req.messages[1].content, 'hello');
            assert.equal(req.max_tokens, 8192);
            return {
              choices: [{ message: { content: 'hi there' } }],
              usage: { prompt_tokens: 12, completion_tokens: 3 },
            };
          },
        },
      },
    };
    const result = await callDeepseek(fakeClient, {
      model: 'deepseek-v4-flash',
      systemPrompt: 'be terse',
      userPrompt: 'hello',
    });
    assert.equal(result.text, 'hi there');
    assert.equal(result.inputTokens, 12);
    assert.equal(result.outputTokens, 3);
    assert.equal(result.error, null);
    assert.ok(result.latencyMs >= 0);
  });

  test('captures errors instead of throwing', async () => {
    const fakeClient = {
      chat: { completions: { create: async () => { throw new Error('rate limited'); } } },
    };
    const result = await callDeepseek(fakeClient, { model: 'deepseek-v4-flash', userPrompt: 'x' });
    assert.equal(result.text, '');
    assert.equal(result.error, 'rate limited');
  });

  test('omits system message when systemPrompt is not provided', async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async (req) => {
            assert.equal(req.messages.length, 1);
            assert.equal(req.messages[0].role, 'user');
            return { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
          },
        },
      },
    };
    await callDeepseek(fakeClient, { model: 'deepseek-v4-flash', userPrompt: 'x' });
  });
});

describe('callGemini', () => {
  test('extracts text and usageMetadata token counts', async () => {
    const fakeClient = {
      models: {
        generateContent: async (req) => {
          assert.equal(req.model, 'gemini-3.6-flash');
          assert.equal(req.config.systemInstruction.parts[0].text, 'be terse');
          assert.equal(req.config.maxOutputTokens, 2048);
          return {
            text: 'gemini says hi',
            usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
          };
        },
      },
    };
    const result = await callGemini(fakeClient, {
      model: 'gemini-3.6-flash',
      systemPrompt: 'be terse',
      userPrompt: 'hello',
    });
    assert.equal(result.text, 'gemini says hi');
    assert.equal(result.inputTokens, 20);
    assert.equal(result.outputTokens, 5);
    assert.equal(result.error, null);
  });

  test('captures errors instead of throwing', async () => {
    const fakeClient = { models: { generateContent: async () => { throw new Error('quota exceeded'); } } };
    const result = await callGemini(fakeClient, { model: 'gemini-3.1-flash-lite', userPrompt: 'x' });
    assert.equal(result.text, '');
    assert.equal(result.error, 'quota exceeded');
  });
});
