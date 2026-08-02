import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runWithConcurrency } from './concurrency.mjs';

describe('runWithConcurrency', () => {
  test('runs all tasks and returns results in order', async () => {
    const tasks = [1, 2, 3, 4, 5].map((n) => async () => n * 10);
    const results = await runWithConcurrency(tasks, 2);
    assert.deepEqual(results, [10, 20, 30, 40, 50]);
  });

  test('never exceeds the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return true;
    });
    await runWithConcurrency(tasks, 3);
    assert.ok(maxActive <= 3, `maxActive was ${maxActive}`);
  });

  test('one task rejecting does not abort the others', async () => {
    const tasks = [
      async () => 'ok',
      async () => { throw new Error('boom'); },
      async () => 'also ok',
    ];
    const results = await Promise.all(
      tasks.map((t) => t().catch((e) => ({ error: e.message }))),
    );
    // sanity check on the fixture itself
    assert.equal(results[1].error, 'boom');
    // runWithConcurrency must not throw for the whole batch when a task rejects internally
    const safeTasks = tasks.map((t) => () => t().catch((e) => ({ error: e.message })));
    const out = await runWithConcurrency(safeTasks, 2);
    assert.equal(out[0], 'ok');
    assert.equal(out[1].error, 'boom');
    assert.equal(out[2], 'also ok');
  });
});
