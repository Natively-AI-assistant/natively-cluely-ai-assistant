// benchmarks/deepseek-vs-gemini/fixtures/check-coding-fixtures.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReferenceSolution } from './check-coding-fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('runReferenceSolution', () => {
  test('a correct JS reference solution passes all its own test cases', async () => {
    const problem = {
      id: 'code-000',
      language: 'javascript',
      execution: true,
      function_name: 'add',
      reference_solution: 'function add(a, b) { return a + b; }',
      test_cases: [
        { input: [1, 2], expected: 3 },
        { input: [-1, 5], expected: 4 },
      ],
    };
    const result = await runReferenceSolution(problem);
    assert.equal(result.pass, true);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((r) => r.ok));
  });

  test('a correct Python reference solution passes all its own test cases', async () => {
    const problem = {
      id: 'code-001',
      language: 'python',
      execution: true,
      function_name: 'add',
      reference_solution: 'def add(a, b):\n    return a + b\n',
      test_cases: [{ input: [2, 3], expected: 5 }],
    };
    const result = await runReferenceSolution(problem);
    assert.equal(result.pass, true);
  });

  test('a wrong reference solution is caught (fails its own test case)', async () => {
    const problem = {
      id: 'code-002',
      language: 'javascript',
      execution: true,
      function_name: 'add',
      reference_solution: 'function add(a, b) { return a - b; }',
      test_cases: [{ input: [1, 2], expected: 3 }],
    };
    const result = await runReferenceSolution(problem);
    assert.equal(result.pass, false);
    assert.equal(result.results[0].ok, false);
  });

  test('every real coding.json problem with execution:true has a self-consistent reference solution', async () => {
    const problems = JSON.parse(fs.readFileSync(path.join(__dirname, 'coding.json'), 'utf8'));
    assert.ok(problems.length >= 45, `only ${problems.length} coding problems`);
    for (const p of problems.filter((p) => p.execution)) {
      const result = await runReferenceSolution(p);
      assert.equal(result.pass, true, `${p.id} reference solution fails its own test cases: ${JSON.stringify(result.results)}`);
    }
  });

  test('difficulty distribution is roughly even thirds', () => {
    const problems = JSON.parse(fs.readFileSync(path.join(__dirname, 'coding.json'), 'utf8'));
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const p of problems) counts[p.difficulty] = (counts[p.difficulty] || 0) + 1;
    for (const tier of ['easy', 'medium', 'hard']) {
      assert.ok(counts[tier] >= 10, `only ${counts[tier]} ${tier} problems`);
    }
  });
});
