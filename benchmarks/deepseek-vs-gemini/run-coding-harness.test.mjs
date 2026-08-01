// benchmarks/deepseek-vs-gemini/run-coding-harness.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { executeAndScore } from './run-coding-harness.mjs';

describe('executeAndScore', () => {
  test('a correct JS answer passes all test cases', async () => {
    const problem = {
      language: 'javascript', execution: true, function_name: 'add',
      test_cases: [{ input: [1, 2], expected: 3 }, { input: [5, 5], expected: 10 }],
    };
    const result = await executeAndScore(problem, 'function add(a, b) { return a + b; }');
    assert.equal(result.passCount, 2);
    assert.equal(result.totalCount, 2);
    assert.equal(result.error, null);
  });

  test('a wrong JS answer fails its test case', async () => {
    const problem = { language: 'javascript', execution: true, function_name: 'add', test_cases: [{ input: [1, 2], expected: 3 }] };
    const result = await executeAndScore(problem, 'function add(a, b) { return 0; }');
    assert.equal(result.passCount, 0);
  });

  test('a syntax error is recorded as an error, not a crash', async () => {
    const problem = { language: 'javascript', execution: true, function_name: 'add', test_cases: [{ input: [1, 2], expected: 3 }] };
    const result = await executeAndScore(problem, 'function add(a, b) { return a +');
    assert.equal(result.passCount, 0);
    assert.ok(result.error);
  });

  test('a correct Python answer passes', async () => {
    const problem = { language: 'python', execution: true, function_name: 'mul', test_cases: [{ input: [3, 4], expected: 12 }] };
    const result = await executeAndScore(problem, 'def mul(a, b):\n    return a * b\n');
    assert.equal(result.passCount, 1);
  });

  test('null extracted code is recorded as "no code extracted" without executing', async () => {
    const problem = { language: 'javascript', execution: true, function_name: 'add', test_cases: [{ input: [1, 2], expected: 3 }] };
    const result = await executeAndScore(problem, null);
    assert.equal(result.error, 'no code extracted from response');
  });

  test('a TS answer with real type annotations executes via --experimental-strip-types and scores correctly', async () => {
    const problem = {
      language: 'typescript', execution: true, function_name: 'add',
      test_cases: [{ input: [1, 2], expected: 3 }, { input: [5, 5], expected: 10 }],
    };
    const result = await executeAndScore(problem, 'function add(a: number, b: number): number { return a + b; }');
    assert.equal(result.error, null);
    assert.equal(result.passCount, 2);
    assert.equal(result.totalCount, 2);
  });
});
