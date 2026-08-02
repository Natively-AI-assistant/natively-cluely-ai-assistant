import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pendingWork } from './resumability.mjs';

describe('pendingWork', () => {
  test('returns every (promptId, modelId) pair when nothing has run', () => {
    const pending = pendingWork(['p1', 'p2'], ['deepseek-v4-flash', 'gemini-3.6-flash'], []);
    assert.equal(pending.length, 4);
  });

  test('skips pairs already present in existingResults', () => {
    const pending = pendingWork(
      ['p1', 'p2'],
      ['deepseek-v4-flash', 'gemini-3.6-flash'],
      [{ promptId: 'p1', modelId: 'deepseek-v4-flash' }],
    );
    assert.equal(pending.length, 3);
    assert.ok(!pending.some((w) => w.promptId === 'p1' && w.modelId === 'deepseek-v4-flash'));
  });

  test('an errored existing result still counts as pending (only success skips)', () => {
    const pending = pendingWork(
      ['p1'],
      ['deepseek-v4-flash'],
      [{ promptId: 'p1', modelId: 'deepseek-v4-flash', error: 'timeout' }],
    );
    assert.equal(pending.length, 1);
  });

  test('empty prompt/model lists produce no work', () => {
    assert.deepEqual(pendingWork([], [], []), []);
  });
});
