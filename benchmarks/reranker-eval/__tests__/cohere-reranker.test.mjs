import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCohereReranker } from '../lib/rerankers/cohere.mjs';

describe('runCohereReranker', () => {
  test('reports skipped:true when COHERE_API_KEY is unset, never throws', async () => {
    const saved = process.env.COHERE_API_KEY;
    delete process.env.COHERE_API_KEY;
    try {
      const result = await runCohereReranker([{ queryId: 'q1', query: 'x', pool: [{ text: 'a' }] }]);
      assert.equal(result.skipped, true);
      assert.equal(result.failed, false);
      assert.equal(result.perQuery.length, 0);
    } finally {
      if (saved !== undefined) process.env.COHERE_API_KEY = saved;
    }
  });

  test('ranks the relevant passage first when a real key is present', { skip: !process.env.COHERE_API_KEY ? 'COHERE_API_KEY not set' : false }, async () => {
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
    const result = await runCohereReranker(poolEntries);
    assert.equal(result.skipped, false);
    assert.equal(result.failed, false, `expected success, got error: ${result.error}`);
    assert.equal(result.perQuery[0].order[0], 1, 'the Paris passage (pool index 1) must rank first');
    assert.ok(result.perQuery[0].latencyMs > 0);
  });
});
