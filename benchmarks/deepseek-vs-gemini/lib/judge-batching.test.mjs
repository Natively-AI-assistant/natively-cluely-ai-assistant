import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildJudgeBatches, flagContested, seededShuffle } from './judge-batching.mjs';

describe('seededShuffle', () => {
  test('is deterministic for a given seed', () => {
    const a = seededShuffle(['A', 'B', 'C', 'D'], 42);
    const b = seededShuffle(['A', 'B', 'C', 'D'], 42);
    assert.deepEqual(a, b);
  });

  test('different seeds usually produce different orders', () => {
    const a = seededShuffle(['A', 'B', 'C', 'D', 'E'], 1);
    const b = seededShuffle(['A', 'B', 'C', 'D', 'E'], 2);
    assert.notDeepEqual(a, b);
  });

  test('is a permutation (same elements, same length)', () => {
    const input = ['A', 'B', 'C'];
    const out = seededShuffle(input, 7);
    assert.equal(out.length, input.length);
    assert.deepEqual([...out].sort(), [...input].sort());
  });
});

describe('buildJudgeBatches', () => {
  test('groups prompts into batches of the requested size, anonymizing model identity', () => {
    const answersByPrompt = {
      p1: { A: 'deepseek-v4-flash', B: 'gemini-3.6-flash', C: 'gemini-3.1-flash-lite' },
      p2: { A: 'deepseek-v4-flash', B: 'gemini-3.6-flash', C: 'gemini-3.1-flash-lite' },
      p3: { A: 'deepseek-v4-flash', B: 'gemini-3.6-flash', C: 'gemini-3.1-flash-lite' },
    };
    const batches = buildJudgeBatches(answersByPrompt, 2, 99);
    assert.equal(batches.length, 2);
    assert.equal(batches[0].promptIds.length, 2);
    assert.equal(batches[1].promptIds.length, 1);
  });

  test('each item exposes a label distinct from the real model id', () => {
    const answersByPrompt = { p1: { A: 'deepseek-v4-flash', B: 'gemini-3.6-flash', C: 'gemini-3.1-flash-lite' } };
    const batches = buildJudgeBatches(answersByPrompt, 5, 1);
    const item = batches[0].anonymizedItems[0];
    assert.ok(item.label);
    assert.notEqual(item.label, item.modelId);
  });
});

describe('flagContested', () => {
  test('returns the n prompts with the smallest top-2 score margin', () => {
    const allScored = [
      { promptId: 'p1', totalsByModel: { 'deepseek-v4-flash': 12, 'gemini-3.6-flash': 12, 'gemini-3.1-flash-lite': 8 } },
      { promptId: 'p2', totalsByModel: { 'deepseek-v4-flash': 15, 'gemini-3.6-flash': 5, 'gemini-3.1-flash-lite': 5 } },
      { promptId: 'p3', totalsByModel: { 'deepseek-v4-flash': 10, 'gemini-3.6-flash': 9, 'gemini-3.1-flash-lite': 9 } },
    ];
    const contested = flagContested(allScored, 2);
    assert.deepEqual(contested.map((c) => c.promptId), ['p1', 'p3']);
  });
});
