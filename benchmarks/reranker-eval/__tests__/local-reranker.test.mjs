import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLocalReranker } from '../lib/rerankers/local.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

describe('runLocalReranker', () => {
  test('bge-reranker-base ranks the relevant passage first, reports latency and no failure', async () => {
    const poolEntries = [
      {
        queryId: 'q-test-1',
        query: 'What is the capital of France?',
        pool: [
          { text: 'Bananas are a good source of potassium.' },
          { text: 'Paris is the capital and most populous city of France.' },
          { text: 'The mitochondria is the powerhouse of the cell.' },
        ],
      },
    ];
    const result = await runLocalReranker(repoRoot, 'Xenova/bge-reranker-base', poolEntries);
    assert.equal(result.failed, false, `expected success, got error: ${result.error}`);
    assert.equal(result.perQuery.length, 1);
    assert.equal(result.perQuery[0].order[0], 1, 'the Paris passage (pool index 1) must rank first');
    assert.ok(result.perQuery[0].latencyMs > 0, 'latency must be recorded');
    assert.ok(result.peakRssMb > 0, 'peak RSS must be recorded');
  });

  test('a nonexistent model id reports failed:true with an error, never throws', async () => {
    const poolEntries = [{ queryId: 'q-test-1', query: 'x', pool: [{ text: 'a' }, { text: 'b' }] }];
    const result = await runLocalReranker(repoRoot, 'Xenova/this-model-does-not-exist-xyz', poolEntries);
    assert.equal(result.failed, true);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
  });
});
