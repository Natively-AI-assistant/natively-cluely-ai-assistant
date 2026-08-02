// benchmarks/deepseek-vs-gemini/lib/results.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { upsertResult } from './results.mjs';

describe('upsertResult', () => {
  test('a successful retry replaces the prior errored record for the same (promptId, modelId) pair', () => {
    const existing = [
      { promptId: 'meeting-001', category: 'meeting', modelId: 'deepseek-v4-flash', error: 'timeout' },
    ];
    const successRecord = {
      promptId: 'meeting-001',
      category: 'meeting',
      modelId: 'deepseek-v4-flash',
      latencyMs: 812,
      costUsd: 0.0002,
    };

    const results = upsertResult(existing, successRecord);

    const matches = results.filter(
      (r) => r.promptId === 'meeting-001' && r.modelId === 'deepseek-v4-flash',
    );
    assert.equal(matches.length, 1, 'expected exactly one record for the retried pair');
    assert.equal(matches[0].error, undefined, 'the surviving record must be the successful one');
    assert.equal(matches[0].latencyMs, 812);
  });

  test('leaves unrelated (promptId, modelId) records untouched', () => {
    const existing = [
      { promptId: 'meeting-001', modelId: 'gemini-3.6-flash', latencyMs: 100 },
      { promptId: 'sales-002', modelId: 'deepseek-v4-flash', latencyMs: 200 },
    ];
    const newRecord = { promptId: 'meeting-001', modelId: 'deepseek-v4-flash', latencyMs: 300 };

    const results = upsertResult(existing, newRecord);

    assert.equal(results.length, 3);
    assert.ok(results.some((r) => r.promptId === 'meeting-001' && r.modelId === 'gemini-3.6-flash'));
    assert.ok(results.some((r) => r.promptId === 'sales-002' && r.modelId === 'deepseek-v4-flash'));
    assert.ok(results.some((r) => r.promptId === 'meeting-001' && r.modelId === 'deepseek-v4-flash' && r.latencyMs === 300));
  });

  test('appends when no prior record exists for the pair (normal, non-retry case)', () => {
    const existing = [{ promptId: 'meeting-001', modelId: 'gemini-3.6-flash', latencyMs: 100 }];
    const newRecord = { promptId: 'meeting-002', modelId: 'gemini-3.6-flash', latencyMs: 150 };

    const results = upsertResult(existing, newRecord);

    assert.equal(results.length, 2);
  });

  test('simulated full run: error then successful retry via the runner loop leaves exactly one record', () => {
    // Simulates main()'s per-task loop: seed with one errored record for
    // (meeting-001, deepseek-v4-flash) from a prior run, then simulate the
    // retry task succeeding and pushing its record via upsertResult.
    let results = [
      { promptId: 'meeting-001', category: 'meeting', modelId: 'deepseek-v4-flash', error: 'network error', costUsd: 0 },
    ];

    const retrySuccessRecord = {
      promptId: 'meeting-001',
      category: 'meeting',
      modelId: 'deepseek-v4-flash',
      latencyMs: 640,
      inputTokens: 610,
      outputTokens: 340,
      costUsd: 0.00018,
    };
    results = upsertResult(results, retrySuccessRecord);

    assert.equal(results.length, 1, 'exactly one record should remain for the pair');
    assert.equal(results[0].error, undefined);
    assert.equal(results[0].latencyMs, 640);
  });

  test('coding harness shape: a successful retry keyed on problemId replaces the prior errored record', () => {
    // run-coding-harness.mjs records use problemId instead of promptId, so it
    // calls upsertResult(results, record, 'problemId'). Simulates the same
    // error-then-retry sequence as the promptId test above, but for that shape.
    let results = [
      { problemId: 'code-001', modelId: 'deepseek-v4-flash', language: 'javascript', execution: true, error: 'timeout', passCount: null, totalCount: null },
    ];

    const retrySuccessRecord = {
      problemId: 'code-001',
      modelId: 'deepseek-v4-flash',
      language: 'javascript',
      execution: true,
      passCount: 3,
      totalCount: 3,
      error: null,
    };
    results = upsertResult(results, retrySuccessRecord, 'problemId');

    assert.equal(results.length, 1, 'exactly one record should remain for the pair');
    assert.equal(results[0].error, null);
    assert.equal(results[0].passCount, 3);
  });
});
