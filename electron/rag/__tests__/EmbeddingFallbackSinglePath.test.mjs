// electron/rag/__tests__/EmbeddingFallbackSinglePath.test.mjs
//
// Regression tests for the single-text embedding paths. Batch embedding already
// had local fallback promotion; getEmbedding() and getEmbeddingForQuery() also
// need it so resume/JD/reference-file ingestion and live query embeddings do not
// fail into lexical-only rows after a cloud provider dies.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function methodBlock(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} must exist`);
  const next = source.indexOf('\n    /**', start + 1);
  return source.slice(start, next > start ? next : start + 1800);
}

describe('EmbeddingPipeline single-text fallback promotion', () => {
  test('getEmbedding() falls back to fallbackProvider and promotes it after primary failure', () => {
    const source = read('electron/rag/EmbeddingPipeline.ts');
    const block = methodBlock(source, 'async getEmbedding(text: string)');
    assert.match(block, /try\s*\{[\s\S]*embedWithTimeout\(this\.provider, text, 'live-chunk'\)/, 'primary single embed should be attempted first');
    assert.match(block, /catch\s*\(primaryError\)[\s\S]*const fallback = this\.fallbackProvider/, 'primary failure should enter fallback branch');
    assert.match(block, /embedWithTimeout\(fallback, text, 'fallback-live-chunk'\)/, 'fallback provider should perform the single embed');
    assert.match(block, /this\.promoteFallbackProvider\(fallback\)/, 'successful fallback should become the active provider/space');
  });

  test('getEmbeddingForQuery() falls back to fallbackProvider and promotes it after primary failure', () => {
    const source = read('electron/rag/EmbeddingPipeline.ts');
    const block = methodBlock(source, 'async getEmbeddingForQuery(text: string)');
    assert.match(block, /const provider = this\.provider/, 'query path should capture the starting provider');
    assert.match(block, /const runQuery = \(p: IEmbeddingProvider, label: string\)/, 'query path should support running against either provider');
    assert.match(block, /return await runQuery\(provider, 'live-query'\)/, 'primary query embed should be attempted first');
    assert.match(block, /runQuery\(fallback, 'fallback-live-query'\)/, 'fallback provider should perform the query embed');
    assert.match(block, /this\.promoteFallbackProvider\(fallback\)/, 'successful query fallback should become active');
  });

  test('fallback promotion persists last_embedding_space and emits a warning if persistence fails', () => {
    const source = read('electron/rag/EmbeddingPipeline.ts');
    const block = methodBlock(source, 'private promoteFallbackProvider');
    assert.match(block, /this\.provider\s*=\s*fallback/, 'promotion should replace the active provider');
    assert.match(block, /last_embedding_space/, 'promotion should persist the active embedding space');
    assert.match(block, /embedding:space-persist-failed/, 'persist failure should be visible to the renderer');
  });
});
