// electron/utils/__tests__/modelFetcher.test.mjs
// Unit tests for model discovery and filtering logic across all AI providers.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/utils/modelFetcher.js');
const {
  formatClaudeLabel,
  pickLatestSnapshotPerModel,
  filterOpenAIModels,
  filterGeminiModels,
  filterGroqModels,
} = await import(pathToFileURL(modPath).href);

describe('OpenAI Model Filtering', () => {
  test('includes gpt-4o, gpt-4.5, gpt-5+, o1, o3, o4+ reasoning models', () => {
    const raw = [
      { id: 'gpt-4o' },
      { id: 'gpt-4o-mini' },
      { id: 'gpt-4o-2024-11-20' },
      { id: 'gpt-4.5-preview' },
      { id: 'chatgpt-4o-latest' },
      { id: 'gpt-5.4' },
      { id: 'o1' },
      { id: 'o1-mini' },
      { id: 'o3-mini' },
      { id: 'o4-preview' },
      // Excluded:
      { id: 'text-embedding-3-small' },
      { id: 'text-embedding-3-large' },
      { id: 'whisper-1' },
      { id: 'tts-1' },
      { id: 'tts-1-hd' },
      { id: 'dall-e-3' },
      { id: 'gpt-4o-realtime-preview' },
      { id: 'gpt-4o-audio-preview' },
      { id: 'babbage-002' },
      { id: 'gpt-3.5-turbo-instruct' },
    ];

    const filtered = filterOpenAIModels(raw);
    const ids = filtered.map(m => m.id);

    assert.ok(ids.includes('gpt-4o'), 'should include gpt-4o');
    assert.ok(ids.includes('gpt-4o-mini'), 'should include gpt-4o-mini');
    assert.ok(ids.includes('gpt-4.5-preview'), 'should include gpt-4.5-preview');
    assert.ok(ids.includes('gpt-5.4'), 'should include gpt-5.4');
    assert.ok(ids.includes('o1'), 'should include o1');
    assert.ok(ids.includes('o1-mini'), 'should include o1-mini');
    assert.ok(ids.includes('o3-mini'), 'should include o3-mini');
    assert.ok(ids.includes('o4-preview'), 'should include o4-preview');

    assert.ok(!ids.includes('text-embedding-3-small'), 'should exclude embeddings');
    assert.ok(!ids.includes('whisper-1'), 'should exclude whisper');
    assert.ok(!ids.includes('tts-1'), 'should exclude tts');
    assert.ok(!ids.includes('dall-e-3'), 'should exclude dall-e');
    assert.ok(!ids.includes('gpt-4o-realtime-preview'), 'should exclude realtime');
    assert.ok(!ids.includes('gpt-4o-audio-preview'), 'should exclude audio');
    assert.ok(!ids.includes('gpt-3.5-turbo-instruct'), 'should exclude instruct completion models');
  });
});

describe('Gemini Model Filtering', () => {
  test('includes gemini-1.5, gemini-2.0, gemini-2.5, gemini-3+ generateContent models', () => {
    const raw = [
      { name: 'models/gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
      // Excluded:
      { name: 'models/text-embedding-004', displayName: 'Text Embedding 004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/imagen-3.0', displayName: 'Imagen 3.0', supportedGenerationMethods: ['imageGeneration'] },
      { name: 'models/gemini-nano', displayName: 'Gemini Nano', supportedGenerationMethods: ['generateContent'] },
    ];

    const filtered = filterGeminiModels(raw);
    const ids = filtered.map(m => m.id);

    assert.ok(ids.includes('gemini-1.5-flash'), 'should include gemini-1.5-flash');
    assert.ok(ids.includes('gemini-1.5-pro'), 'should include gemini-1.5-pro');
    assert.ok(ids.includes('gemini-2.0-flash'), 'should include gemini-2.0-flash');
    assert.ok(ids.includes('gemini-2.5-pro'), 'should include gemini-2.5-pro');
    assert.ok(ids.includes('gemini-3.8-flash'), 'should include gemini-3.8-flash');

    assert.ok(!ids.includes('text-embedding-004'), 'should exclude embeddings');
    assert.ok(!ids.includes('imagen-3.0'), 'should exclude imagen');
    assert.ok(!ids.includes('gemini-nano'), 'should exclude nano');
  });
});

describe('Groq Model Filtering', () => {
  test('includes chat models and excludes speech/guard models', () => {
    const raw = [
      { id: 'llama-3.3-70b-versatile' },
      { id: 'qwen/qwen3.8-27b' },
      { id: 'openai/gpt-oss-120b' },
      // Excluded:
      { id: 'whisper-large-v3' },
      { id: 'distil-whisper-large-v3-en' },
      { id: 'llama-guard-3-8b' },
    ];

    const filtered = filterGroqModels(raw);
    const ids = filtered.map(m => m.id);

    assert.ok(ids.includes('llama-3.3-70b-versatile'), 'should include llama');
    assert.ok(ids.includes('qwen/qwen3.8-27b'), 'should include qwen');
    assert.ok(ids.includes('openai/gpt-oss-120b'), 'should include gpt-oss');

    assert.ok(!ids.includes('whisper-large-v3'), 'should exclude whisper');
    assert.ok(!ids.includes('distil-whisper-large-v3-en'), 'should exclude distil');
    assert.ok(!ids.includes('llama-guard-3-8b'), 'should exclude guard');
  });
});
