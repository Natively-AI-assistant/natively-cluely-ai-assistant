// electron/rag/__tests__/EmbeddingSpace.test.mjs
//
// Regression tests for the embedding-space identity that gates auto re-index.
// The headline guarantee: a same-name/same-dims model swap
// (gemini-embedding-001 768d → gemini-embedding-2 768d) MUST produce different
// space keys, otherwise re-index never fires and v1 vectors are silently compared
// against v2 queries. See electron/rag/embeddingSpace.ts.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingSpace.js');
const { embeddingSpaceKey, normalizeModel, legacySpaceForProvider, LEGACY_PROVIDER_MODEL } = await import(pathToFileURL(modPath).href);

describe('embeddingSpaceKey', () => {
  test('v1 and v2 Gemini at the same dims produce DIFFERENT spaces (the core bug)', () => {
    const v1 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 768 });
    const v2 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 768 });
    assert.notEqual(v1, v2, 'v1 and v2 spaces must differ so re-index fires');
    assert.equal(v1, 'gemini:gemini-embedding-001:768');
    assert.equal(v2, 'gemini:gemini-embedding-2:768');
  });

  test('strips models/ prefix and lowercases so equivalent ids collapse', () => {
    const a = embeddingSpaceKey({ name: 'gemini', model: 'models/gemini-embedding-2', dimensions: 768 });
    const b = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 768 });
    assert.equal(a, b, 'models/-prefixed and bare ids must collapse to one space');
  });

  test('same dims across DIFFERENT providers produce different spaces (generalizes)', () => {
    // gemini-768 → ollama-768: same dims, different space → must still invalidate
    const gem = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 768 });
    const oll = embeddingSpaceKey({ name: 'ollama', model: 'nomic-embed-text', dimensions: 768 });
    assert.notEqual(gem, oll);
  });

  test('dimension change alone invalidates the space', () => {
    const d768 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 768 });
    const d1536 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 1536 });
    assert.notEqual(d768, d1536);
  });
});

describe('normalizeModel', () => {
  test('strips prefix, trims, lowercases', () => {
    assert.equal(normalizeModel('models/Gemini-Embedding-2'), 'gemini-embedding-2');
    assert.equal(normalizeModel('  nomic-embed-text  '), 'nomic-embed-text');
  });
});

describe('legacySpaceForProvider — must equal the v1 key the DB backfill synthesizes', () => {
  test('gemini legacy → gemini:gemini-embedding-001:<dims>', () => {
    // This MUST match the active provider key embeddingSpaceKey produces for v1,
    // so a DB that was never upgraded reports count=0 (no spurious re-index),
    // and MUST differ from the v2 key so an upgraded DB reports count>0.
    const legacy = legacySpaceForProvider('gemini', 768);
    assert.equal(legacy, 'gemini:gemini-embedding-001:768');
    assert.equal(legacy, embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 768 }));
    assert.notEqual(legacy, embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 768 }));
  });

  test('handles each known provider and unknown/NULL dims', () => {
    assert.equal(legacySpaceForProvider('ollama', 768), 'ollama:nomic-embed-text:768');
    assert.equal(legacySpaceForProvider('openai', 1536), 'openai:text-embedding-3-small:1536');
    assert.equal(legacySpaceForProvider('local', 384), 'local:xenova/all-minilm-l6-v2:384');
    assert.equal(legacySpaceForProvider('mystery', null), 'mystery:unknown:unknown');
  });

  test('LEGACY_PROVIDER_MODEL values are already normalized (lowercase, no models/ prefix)', () => {
    // The DB migration CASE map and the runtime key both depend on these being
    // pre-normalized so the synthesized legacy space equals the normalized runtime key.
    for (const [name, model] of Object.entries(LEGACY_PROVIDER_MODEL)) {
      assert.equal(model, normalizeModel(model), `${name} model must already be normalized`);
    }
  });
});
