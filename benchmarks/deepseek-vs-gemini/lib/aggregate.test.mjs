import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateQuality,
  aggregateCoding,
  aggregateLatencyCost,
  detectFailedModels,
  renderMarkdownReport,
} from './aggregate.mjs';

describe('aggregateQuality', () => {
  test('averages correctness+completeness+actionability per model per category', () => {
    const perPrompt = [
      { promptId: 'meeting-001', detail: [
        { promptId: 'meeting-001', modelId: 'deepseek-v4-flash', scores: { correctness: 5, completeness: 4, actionability: 5 } },
        { promptId: 'meeting-001', modelId: 'gemini-3.6-flash', scores: { correctness: 4, completeness: 4, actionability: 4 } },
      ] },
    ];
    const categoryByPrompt = { 'meeting-001': 'meeting' };
    const rows = aggregateQuality(perPrompt, categoryByPrompt);
    const ds = rows.find((r) => r.modelId === 'deepseek-v4-flash' && r.category === 'meeting');
    assert.ok(Math.abs(ds.meanScore - 14) < 1e-9);
    assert.equal(ds.promptCount, 1);
  });

  test('sorts rows by modelId then category regardless of insertion order', () => {
    const perPrompt = [
      { promptId: 'p1', detail: [
        { promptId: 'p1', modelId: 'zeta-model', scores: { correctness: 5, completeness: 5, actionability: 5 } },
        { promptId: 'p1', modelId: 'alpha-model', scores: { correctness: 5, completeness: 5, actionability: 5 } },
      ] },
      { promptId: 'p2', detail: [
        { promptId: 'p2', modelId: 'alpha-model', scores: { correctness: 5, completeness: 5, actionability: 5 } },
      ] },
    ];
    const categoryByPrompt = { p1: 'zzz-category', p2: 'aaa-category' };
    const rows = aggregateQuality(perPrompt, categoryByPrompt);
    assert.equal(rows[0].modelId, 'alpha-model');
    assert.equal(rows[0].category, 'aaa-category');
    assert.equal(rows[1].modelId, 'alpha-model');
    assert.equal(rows[1].category, 'zzz-category');
    assert.equal(rows[2].modelId, 'zeta-model');
  });
});

describe('aggregateCoding', () => {
  test('computes pass rate per model per difficulty for executed problems only', () => {
    const codingResults = [
      { modelId: 'deepseek-v4-flash', difficulty: 'easy', execution: true, passCount: 3, totalCount: 3 },
      { modelId: 'deepseek-v4-flash', difficulty: 'easy', execution: true, passCount: 1, totalCount: 3 },
      { modelId: 'deepseek-v4-flash', difficulty: 'hard', execution: false, passCount: null, totalCount: null },
    ];
    const rows = aggregateCoding(codingResults);
    const easy = rows.find((r) => r.modelId === 'deepseek-v4-flash' && r.difficulty === 'easy');
    assert.ok(Math.abs(easy.passRate - (4 / 6)) < 1e-9);
    assert.equal(easy.problemCount, 2);
    assert.equal(rows.some((r) => r.difficulty === 'hard'), false);
  });

  test('sorts rows by modelId then difficulty regardless of insertion order', () => {
    const codingResults = [
      { modelId: 'zeta-model', difficulty: 'zzz', execution: true, passCount: 1, totalCount: 1 },
      { modelId: 'alpha-model', difficulty: 'zzz', execution: true, passCount: 1, totalCount: 1 },
      { modelId: 'alpha-model', difficulty: 'aaa', execution: true, passCount: 1, totalCount: 1 },
    ];
    const rows = aggregateCoding(codingResults);
    assert.equal(rows[0].modelId, 'alpha-model');
    assert.equal(rows[0].difficulty, 'aaa');
    assert.equal(rows[1].modelId, 'alpha-model');
    assert.equal(rows[1].difficulty, 'zzz');
    assert.equal(rows[2].modelId, 'zeta-model');
  });
});

describe('aggregateLatencyCost', () => {
  test('computes p50/p95 latency and cost totals per model', () => {
    const raw = [
      { modelId: 'deepseek-v4-flash', latencyMs: 100, costUsd: 0.001, error: null },
      { modelId: 'deepseek-v4-flash', latencyMs: 200, costUsd: 0.002, error: null },
      { modelId: 'deepseek-v4-flash', latencyMs: 300, costUsd: 0.003, error: null },
      { modelId: 'deepseek-v4-flash', latencyMs: 9999, costUsd: 0, error: 'timeout' },
    ];
    const rows = aggregateLatencyCost(raw);
    const ds = rows.find((r) => r.modelId === 'deepseek-v4-flash');
    assert.equal(ds.p50LatencyMs, 200);
    assert.ok(Math.abs(ds.totalCostUsd - 0.006) < 1e-9);
  });

  test('sorts rows by modelId regardless of insertion order', () => {
    const raw = [
      { modelId: 'zeta-model', latencyMs: 100, costUsd: 0.001, error: null },
      { modelId: 'alpha-model', latencyMs: 100, costUsd: 0.001, error: null },
    ];
    const rows = aggregateLatencyCost(raw);
    assert.equal(rows[0].modelId, 'alpha-model');
    assert.equal(rows[1].modelId, 'zeta-model');
  });
});

describe('detectFailedModels', () => {
  test('flags a model whose every record has an error, ignores a healthy model', () => {
    const raw = [
      { modelId: 'gemini-3.1-flash-lite', latencyMs: 0, costUsd: 0, error: 'API key expired' },
      { modelId: 'gemini-3.1-flash-lite', latencyMs: 0, costUsd: 0, error: 'API key expired' },
      { modelId: 'deepseek-v4-flash', latencyMs: 100, costUsd: 0.001, error: null },
    ];
    const failed = detectFailedModels(raw);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].modelId, 'gemini-3.1-flash-lite');
    assert.equal(failed[0].failureCount, 2);
    assert.equal(failed[0].sampleError, 'API key expired');
  });

  test('does not flag a model with at least one successful call', () => {
    const raw = [
      { modelId: 'deepseek-v4-flash', latencyMs: 0, costUsd: 0, error: 'timeout' },
      { modelId: 'deepseek-v4-flash', latencyMs: 100, costUsd: 0.001, error: null },
    ];
    assert.deepEqual(detectFailedModels(raw), []);
  });

  test('returns empty array when raw is empty', () => {
    assert.deepEqual(detectFailedModels([]), []);
  });
});

describe('renderMarkdownReport', () => {
  test('includes model names and a contested-pairs section', () => {
    const md = renderMarkdownReport({
      quality: [{ modelId: 'deepseek-v4-flash', category: 'meeting', meanScore: 13, promptCount: 5 }],
      coding: [{ modelId: 'deepseek-v4-flash', difficulty: 'easy', passRate: 0.9, problemCount: 10 }],
      latencyCost: [{ modelId: 'deepseek-v4-flash', p50LatencyMs: 500, p95LatencyMs: 900, totalCostUsd: 0.05, avgCostPerCall: 0.001 }],
      contested: [{ promptId: 'meeting-014', marginBetweenTop2: 0.5 }],
    });
    assert.ok(md.includes('deepseek-v4-flash'));
    assert.ok(md.includes('Contested'));
    assert.ok(md.includes('meeting-014'));
  });

  test('does not throw when contested is omitted entirely', () => {
    assert.doesNotThrow(() => {
      renderMarkdownReport({
        quality: [],
        coding: [],
        latencyCost: [],
        // contested intentionally omitted
      });
    });
  });

  test('does not throw when contested is explicitly undefined', () => {
    assert.doesNotThrow(() => {
      renderMarkdownReport({
        quality: [],
        coding: [],
        latencyCost: [],
        contested: undefined,
      });
    });
  });

  test('renders a "no successful calls" section naming a fully-failed model, distinct from the other tables', () => {
    const md = renderMarkdownReport({
      quality: [{ modelId: 'deepseek-v4-flash', category: 'meeting', meanScore: 13, promptCount: 5 }],
      coding: [{ modelId: 'deepseek-v4-flash', difficulty: 'easy', passRate: 0.9, problemCount: 10 }],
      latencyCost: [{ modelId: 'deepseek-v4-flash', p50LatencyMs: 500, p95LatencyMs: 900, totalCostUsd: 0.05, avgCostPerCall: 0.001 }],
      contested: [],
      failedModels: [{ modelId: 'gemini-3.1-flash-lite', failureCount: 5, sampleError: 'API key expired' }],
    });
    assert.ok(md.includes('no successful calls') || md.includes('No successful calls'));
    assert.ok(md.includes('gemini-3.1-flash-lite'));
    assert.ok(md.includes('API key expired'));
    // The failed model must appear in its own section, not just be silently absent from the other tables.
    const failedSectionIndex = md.search(/no successful calls/i);
    const qualitySectionIndex = md.indexOf('## Quality by category');
    assert.ok(failedSectionIndex !== -1 && failedSectionIndex < qualitySectionIndex);
  });

  test('omits the "no successful calls" section entirely when failedModels is empty or omitted', () => {
    const md = renderMarkdownReport({
      quality: [{ modelId: 'deepseek-v4-flash', category: 'meeting', meanScore: 13, promptCount: 5 }],
      coding: [],
      latencyCost: [],
      contested: [],
    });
    assert.ok(!/no successful calls/i.test(md));
  });

  test('end-to-end: a raw array with one all-error model and one healthy model surfaces the failed model by name via detectFailedModels + renderMarkdownReport', () => {
    const raw = [
      { modelId: 'gemini-3.1-flash-lite', latencyMs: 0, costUsd: 0, error: 'API key expired' },
      { modelId: 'gemini-3.1-flash-lite', latencyMs: 0, costUsd: 0, error: 'API key expired' },
      { modelId: 'gemini-3.1-flash-lite', latencyMs: 0, costUsd: 0, error: 'API key expired' },
      { modelId: 'deepseek-v4-flash', latencyMs: 100, costUsd: 0.001, error: null },
      { modelId: 'deepseek-v4-flash', latencyMs: 150, costUsd: 0.001, error: null },
    ];
    const failedModels = detectFailedModels(raw);
    const latencyCost = aggregateLatencyCost(raw);

    // Sanity: gemini really did vanish from the latency table, same as the original bug.
    assert.equal(latencyCost.some((l) => l.modelId === 'gemini-3.1-flash-lite'), false);

    const md = renderMarkdownReport({
      quality: [],
      coding: [],
      latencyCost,
      contested: [],
      failedModels,
    });

    assert.ok(/no successful calls/i.test(md));
    assert.ok(md.includes('gemini-3.1-flash-lite'));
    assert.ok(md.includes('deepseek-v4-flash'));
  });
});
