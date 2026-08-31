// electron/rag/__tests__/EmbeddingConfigPassthrough.test.mjs
//
// Every field the embedding config KNOWS must survive the resolver.
//
// THE BUG (third instance of one defect class): resolveEmbeddingCredentials
// forwarded a HAND-WRITTEN list of fields to embeddingConfigFrom and silently
// dropped six of them — embeddingMode, embeddingProvider, and both the OpenAI and
// Gemini model/dims pairs. Settings could read
// {mode:'manual', provider:'gemini', model:'gemini-embedding-001'} while the
// pipeline logged `embeddingMode: 'auto', geminiEmbeddingModel: null` and
// resolved whatever the automatic chain preferred.
//
// The same shape already caused two other bugs this campaign (RAGManager's
// config subset, ProcessingHelper's init object). This test is deliberately
// GENERIC: it round-trips every known field, so a future field added to the
// config cannot be forgotten in the pass-through.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingConfigIdentity.js');
const { resolveEmbeddingCredentials, embeddingConfigFrom } = await import(pathToFileURL(modPath).href);

const STORE = {
  getGeminiApiKey: () => undefined,
  getOpenaiApiKey: () => undefined,
  getNativelyApiKey: () => undefined,
  getCustomEmbeddingApiKey: () => undefined,
  getTrialToken: () => undefined,
};

/** A distinct, recognisable value for every field the config understands. */
const ALL_FIELDS = {
  embeddingMode: 'manual',
  embeddingProvider: 'gemini',
  geminiEmbeddingModel: 'gemini-embedding-001',
  geminiEmbeddingDims: 1536,
  openaiEmbeddingModel: 'text-embedding-3-large',
  openaiEmbeddingDims: 1024,
  ollamaEmbeddingModel: 'bge-m3',
  ollamaEmbeddingDims: 1024,
  customEmbeddingUrl: 'http://localhost:1234/v1',
  customEmbeddingModel: 'nomic',
  customEmbeddingDims: 768,
};

describe('resolveEmbeddingCredentials forwards every known field', () => {
  for (const [field, value] of Object.entries(ALL_FIELDS)) {
    test(`${field} survives the pass-through`, () => {
      const out = resolveEmbeddingCredentials({ ...ALL_FIELDS, explicitKeyManagement: true }, STORE);
      assert.equal(out[field], value,
        `${field} was dropped between resolveEmbeddingCredentials and embeddingConfigFrom`);
    });
  }

  test('no known field is silently missing from the result', () => {
    // Catches the CLASS: anything embeddingConfigFrom names must be reachable
    // through the resolver, so a new field cannot be half-wired.
    const direct = embeddingConfigFrom({ ...ALL_FIELDS });
    const viaResolver = resolveEmbeddingCredentials({ ...ALL_FIELDS, explicitKeyManagement: true }, STORE);
    const dropped = Object.keys(direct).filter(k => {
      const a = direct[k];
      const b = viaResolver[k];
      if (a === undefined || a === null) return false;
      if (Array.isArray(a)) return false;
      return JSON.stringify(a) !== JSON.stringify(b);
    });
    assert.deepEqual(dropped, [],
      `these fields do not survive resolveEmbeddingCredentials: ${dropped.join(', ')}`);
  });
});

describe('the selection specifically', () => {
  test("a manual gemini choice reaches the config intact", () => {
    // The exact shape settings.json holds.
    const out = resolveEmbeddingCredentials({
      embeddingMode: 'manual', embeddingProvider: 'gemini',
      geminiEmbeddingModel: 'gemini-embedding-001',
      explicitKeyManagement: true,
    }, STORE);
    assert.equal(out.embeddingMode, 'manual');
    assert.equal(out.embeddingProvider, 'gemini');
    assert.equal(out.geminiEmbeddingModel, 'gemini-embedding-001');
  });

  test('automatic mode still resolves to no pinned provider', () => {
    const out = resolveEmbeddingCredentials({ explicitKeyManagement: true }, STORE);
    assert.equal(out.embeddingProvider, undefined);
  });
});
