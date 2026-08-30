// benchmarks/reranker-eval/__tests__/candidates.test.mjs
//
// Run via: cd benchmarks/reranker-eval && node --test __tests__/candidates.test.mjs
// Requires: npm run build:electron (from repo root) already run, and the
// all-MiniLM-L6-v2 embedder model present under resources/models/ (already
// true if `node scripts/download-models.js` has run).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Embedder } from '../lib/embedder.mjs';
import { buildCandidatePools } from '../lib/candidates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const documents = JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/documents.json'), 'utf8'));
const queries = JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/queries.json'), 'utf8'));

describe('buildCandidatePools', () => {
  test('every query gets a non-empty pool, and at least 90% resolve a gold chunk within the pool', async () => {
    const embedder = new Embedder(repoRoot);
    const available = await embedder.isAvailable();
    assert.equal(available, true, 'local embedder must be available for this test (run npm run scripts/download-models.js)');

    const results = await buildCandidatePools(repoRoot, documents, queries.slice(0, 5), embedder);
    assert.equal(results.length, 5);
    for (const r of results) {
      assert.ok(r.pool.length > 0, `query ${r.queryId} got an empty pool`);
      assert.ok(r.pool.length <= 30, `query ${r.queryId} pool exceeds RERANK_CANDIDATE_POOL=30`);
    }
    const resolvedCount = results.filter((r) => r.goldChunkPoolIndices.length > 0).length;
    assert.ok(resolvedCount / results.length >= 0.9, `only ${resolvedCount}/${results.length} queries resolved a gold chunk in the pool`);
  });
});
