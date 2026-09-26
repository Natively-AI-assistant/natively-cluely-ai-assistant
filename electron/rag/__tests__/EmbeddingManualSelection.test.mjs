// electron/rag/__tests__/EmbeddingManualSelection.test.mjs
//
// Choosing a provider in Settings must actually switch to it.
//
// THE BUG: buildCandidates() ordered candidates purely by which credentials
// existed (natively -> custom -> openai -> gemini -> ollama -> local) and
// resolve() took the first AVAILABLE one. The user's explicit choice was written
// to settings and then ignored, so clicking MiniLM, Gemini or Natively changed
// nothing whenever some higher-priority provider was also configured.
//
// Selecting a provider is an EXPLICIT act. It outranks the automatic chain, and
// a failed manual choice must NOT silently fall through to a different provider:
// that would change the embedding SPACE behind the user's back and re-index
// their corpus into vectors they never asked for.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/EmbeddingProviderResolver.js');
const { EmbeddingProviderResolver } = await import(pathToFileURL(modPath).href);

const names = (c) => EmbeddingProviderResolver.buildCandidates(c).map(p => p.name);

/** Every provider configured at once — so the chain would otherwise decide. */
const ALL = {
  nativelyApiKey: 'nk_live',
  openaiKey: 'sk-openai',
  geminiKey: 'gem-key',
  ollamaUrl: 'http://localhost:11434',
  customEmbeddingUrl: 'http://localhost:1234/v1',
  customEmbeddingModel: 'bge-m3',
  customEmbeddingDims: 1024,
};

describe('automatic mode is unchanged', () => {
  test('with no explicit choice, the priority chain still decides', () => {
    assert.deepEqual(names(ALL), ['natively', 'custom', 'openai', 'gemini', 'ollama']);
  });
});

describe('an explicit choice wins over the chain', () => {
  test('choosing Gemini yields ONLY Gemini, even though Natively ranks higher', () => {
    // The headline bug: natively is first in the chain, so picking gemini did nothing.
    assert.deepEqual(names({ ...ALL, embeddingMode: 'manual', embeddingProvider: 'gemini' }), ['gemini']);
  });

  test('choosing OpenAI yields ONLY OpenAI', () => {
    assert.deepEqual(names({ ...ALL, embeddingMode: 'manual', embeddingProvider: 'openai' }), ['openai']);
  });

  test('choosing Ollama yields ONLY Ollama', () => {
    assert.deepEqual(names({ ...ALL, embeddingMode: 'manual', embeddingProvider: 'ollama' }), ['ollama']);
  });

  test('choosing the custom endpoint yields ONLY it', () => {
    assert.deepEqual(names({ ...ALL, embeddingMode: 'manual', embeddingProvider: 'custom' }), ['custom']);
  });

  test('choosing Natively yields ONLY Natively', () => {
    assert.deepEqual(names({ ...ALL, embeddingMode: 'manual', embeddingProvider: 'natively' }), ['natively']);
  });

  test('choosing Built-in yields NO candidate, so resolve falls to the bundled model', () => {
    // LocalEmbeddingProvider is resolve()'s terminal fallback and is never a
    // candidate (probing it loads the ONNX model). An empty list is therefore
    // exactly how "use the built-in one" is expressed.
    assert.deepEqual(names({ ...ALL, embeddingMode: 'manual', embeddingProvider: 'local' }), []);
  });
});

describe('a manual choice never silently substitutes another provider', () => {
  test('choosing a provider with no credentials yields NO other provider', () => {
    // Falling through to a different provider would change the embedding SPACE
    // and re-index the corpus into vectors the user never chose. Better to have
    // no candidate and degrade than to switch spaces behind their back.
    const order = names({ ...ALL, embeddingMode: 'manual', embeddingProvider: 'openai', openaiKey: undefined });
    assert.deepEqual(order, [], 'no substitute may be offered');
  });

  test('a privacy policy still overrides an explicit cloud choice', () => {
    // The user's own policy outranks their model pick — it is the stronger
    // statement, and it is about where data goes, not which model is best.
    const order = names({ ...ALL, embeddingMode: 'manual', embeddingProvider: 'gemini', providerDataScopes: { embeddings: false } });
    assert.deepEqual(order, []);
  });
});

describe('mode gating', () => {
  test("a provider named without manual mode does not pin the chain", () => {
    // 'auto' means "you decide" — a stale provider field must not silently pin.
    assert.deepEqual(names({ ...ALL, embeddingMode: 'auto', embeddingProvider: 'gemini' }), ['natively', 'custom', 'openai', 'gemini', 'ollama']);
  });

  test('manual mode with no provider named falls back to the chain', () => {
    assert.deepEqual(names({ ...ALL, embeddingMode: 'manual' }), ['natively', 'custom', 'openai', 'gemini', 'ollama']);
  });
});
