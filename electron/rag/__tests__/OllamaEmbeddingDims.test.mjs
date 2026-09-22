// electron/rag/__tests__/OllamaEmbeddingDims.test.mjs
//
// OllamaEmbeddingProvider used to declare `dimensions = 768` unconditionally
// while taking any model name, so choosing a 4096-d model stamped a 768-d space
// key over 4096-d vectors. Dimensions are now supplied by the caller, measured.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = p => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag', p)).href);
const { OllamaEmbeddingProvider } = await load('providers/OllamaEmbeddingProvider.js');
const { EmbeddingProviderResolver } = await load('EmbeddingProviderResolver.js');

describe('OllamaEmbeddingProvider dimensions', () => {
  test('the DEFAULT is byte-identical to the historical space key', () => {
    // Non-negotiable: any change here re-spaces every existing Ollama user and
    // triggers a full re-index of their corpus on next launch.
    const p = new OllamaEmbeddingProvider('http://localhost:11434');
    assert.equal(p.model, 'nomic-embed-text');
    assert.equal(p.dimensions, 768);
    assert.equal(p.space, 'ollama:nomic-embed-text:768');
  });

  test('a large model carries its real width into the space key', () => {
    const p = new OllamaEmbeddingProvider('http://localhost:11434', 'qwen3-embedding:8b', 4096);
    assert.equal(p.dimensions, 4096);
    assert.equal(p.space, 'ollama:qwen3-embedding:8b:4096');
  });

  test('two models at the same width still occupy different spaces', () => {
    const a = new OllamaEmbeddingProvider('http://x', 'model-a', 1024);
    const b = new OllamaEmbeddingProvider('http://x', 'model-b', 1024);
    assert.notEqual(a.space, b.space);
  });

  test('the same model at different widths occupies different spaces', () => {
    const a = new OllamaEmbeddingProvider('http://x', 'shrinkable', 1024);
    const b = new OllamaEmbeddingProvider('http://x', 'shrinkable', 256);
    assert.notEqual(a.space, b.space);
  });
});

describe('resolver wiring', () => {
  const names = c => EmbeddingProviderResolver.buildCandidates(c).map(p => p.name);
  const ollama = c => EmbeddingProviderResolver.buildCandidates(c).find(p => p.name === 'ollama');

  test('no configured model keeps the historical default candidate', () => {
    assert.equal(ollama({}).space, 'ollama:nomic-embed-text:768');
  });

  test('a configured model with measured dims becomes the candidate', () => {
    const p = ollama({ ollamaEmbeddingModel: 'qwen3-embedding:8b', ollamaEmbeddingDims: 4096 });
    assert.equal(p.model, 'qwen3-embedding:8b');
    assert.equal(p.space, 'ollama:qwen3-embedding:8b:4096');
  });

  test('a configured model WITHOUT measured dims is dropped, never guessed at', () => {
    // Falling back to the 768 default here is the whole bug: it would write
    // 4096-d vectors under a 768-d space key. No candidate is strictly better.
    assert.ok(!names({ ollamaEmbeddingModel: 'qwen3-embedding:8b' }).includes('ollama'));
  });

  test('an implausible dimension count is rejected rather than trusted', () => {
    for (const dims of [0, -1, 1.5, Number.NaN]) {
      assert.ok(
        !names({ ollamaEmbeddingModel: 'weird', ollamaEmbeddingDims: dims }).includes('ollama'),
        `dims=${dims} must not produce a candidate`,
      );
    }
  });
});
