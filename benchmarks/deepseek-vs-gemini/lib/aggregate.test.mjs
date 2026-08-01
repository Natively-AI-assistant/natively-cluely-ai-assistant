import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateQuality, aggregateCoding, aggregateLatencyCost, renderMarkdownReport } from './aggregate.mjs';

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
});
