// electron/llm/codeVerification/__tests__/LocalRunner.test.mjs
//
// REAL execution tests — actually spawn python3 / node in the sandbox. Skips
// gracefully if an interpreter isn't available so CI without a runtime stays
// green. Proves correct pass/fail/error verdicts, timeout, output cap, and that
// the exact firstMissingPositive bug class (wrong logic) is caught.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  runCase,
  localLanguageAvailable,
} from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';

const tc = (input, expected, source = 'problem') => ({ input, expected, source });

describe('localRunner — python (real execution)', async () => {
  const havePy = await localLanguageAvailable('python');
  const maybe = (name, fn) => test(name, { skip: havePy ? false : 'python3 unavailable' }, fn);

  maybe('correct twoSum passes its problem cases', async () => {
    const code = `def twoSum(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        if target - x in seen:
            return [seen[target - x], i]
        seen[x] = i
    return []`;
    const r = await runCase('python', code, 'twoSum', tc([[2, 7, 11, 15], 9], [0, 1]));
    assert.equal(r.status, 'pass', r.error);
  });

  maybe('WRONG firstMissingPositive is caught as fail', async () => {
    // Off-by-one bug: returns i (0-based) instead of i+1.
    const code = `def firstMissingPositive(nums):
    n = len(nums)
    for i in range(n):
        while 0 < nums[i] <= n and nums[nums[i]-1] != nums[i]:
            j = nums[i]-1
            nums[i], nums[j] = nums[j], nums[i]
    for i in range(n):
        if nums[i] != i + 1:
            return i  # BUG: should be i + 1
    return n + 1`;
    const r = await runCase('python', code, 'firstMissingPositive', tc([[1, 2, 0]], 3));
    assert.equal(r.status, 'fail');
    assert.match(r.error, /expected 3, got 2/);
  });

  maybe('a syntax error is reported as error (the ", 1" class)', async () => {
    const code = `def f(nums):
    return nums[nums[i], 1]`; // invalid
    const r = await runCase('python', code, 'f', tc([[1]], 1));
    assert.equal(r.status, 'error');
  });

  maybe('infinite loop is killed by the timeout', async () => {
    const code = `def f(x):
    while True:
        pass`;
    const r = await runCase('python', code, 'f', tc([1], 1));
    assert.equal(r.status, 'error');
    assert.match(r.error, /timed out/);
  });

  maybe('debug prints do not confuse the judge (sentinel parsing)', async () => {
    const code = `def f(x):
    print("debugging", x)
    return x * 2`;
    const r = await runCase('python', code, 'f', tc([21], 42));
    assert.equal(r.status, 'pass', r.error);
  });

  maybe('Solution-class method entry is supported', async () => {
    const code = `class Solution:
    def add(self, a, b):
        return a + b`;
    const r = await runCase('python', code, 'add', tc([2, 3], 5));
    assert.equal(r.status, 'pass', r.error);
  });

  // SECURITY INVARIANT (review P0): the executed code must NOT see the parent's
  // env secrets. The runner rebuilds a minimal scrubbed env; if a regression
  // ever spreads process.env, this test fails and the leak is caught.
  maybe('executed code CANNOT read parent env secrets (env is scrubbed)', async () => {
    const SECRET = 'sk-leak-canary-' + Date.now();
    process.env.NATIVELY_TEST_SECRET = SECRET;
    process.env.OPENAI_API_KEY = SECRET;
    try {
      const code = `import os
def leak(x):
    return os.environ.get("NATIVELY_TEST_SECRET", "ABSENT") + "|" + os.environ.get("OPENAI_API_KEY", "ABSENT")`;
      const r = await runCase('python', code, 'leak', tc([1], 'ABSENT|ABSENT'));
      assert.equal(r.status, 'pass', `secret leaked into sandbox: ${r.actual}`);
      assert.doesNotMatch(JSON.stringify(r.actual ?? ''), new RegExp(SECRET), 'secret value must never appear');
    } finally {
      delete process.env.NATIVELY_TEST_SECRET;
      delete process.env.OPENAI_API_KEY;
    }
  });

  maybe('a detached grandchild does NOT outlive the timeout (process-group kill)', async () => {
    // Fork a detached grandchild that would sleep 30s, then the parent loops.
    // The group kill must take down both within the 3s bound.
    const code = `import subprocess, sys, time
def f(x):
    subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    while True:
        time.sleep(0.01)`;
    const start = Date.now();
    const r = await runCase('python', code, 'f', tc([1], 1));
    const elapsed = Date.now() - start;
    assert.equal(r.status, 'error');
    assert.match(r.error, /timed out/);
    assert.ok(elapsed < 6000, `must be bounded near 3s, took ${elapsed}ms`);
  });

  maybe('output cap kills a runaway print and reports error', async () => {
    const code = `def f(x):
    while True:
        print("x" * 1000)`;
    const r = await runCase('python', code, 'f', tc([1], 1));
    assert.equal(r.status, 'error');
    assert.match(r.error, /output limit|timed out/);
  });

  maybe('float inf becomes an honest error, not a silent string-pass', async () => {
    const code = `def f(x):
    return float('inf')`;
    const r = await runCase('python', code, 'f', tc([1], 'whatever'));
    assert.equal(r.status, 'error', 'inf is not valid JSON → honest error, never a coerced pass');
  });

  maybe('temp dirs are cleaned up after a run (no leak)', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const before = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('natively-verify-')).length;
    await runCase('python', 'def f(x):\n    return x', 'f', tc([1], 1));
    await runCase('python', 'def f(x):\n    while True: pass', 'f', tc([1], 1)); // timeout path
    const after = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('natively-verify-')).length;
    assert.ok(after <= before, `temp dirs leaked: before=${before} after=${after}`);
  });
});

describe('localRunner — javascript (real execution)', async () => {
  const haveJs = await localLanguageAvailable('javascript');
  const maybe = (name, fn) => test(name, { skip: haveJs ? false : 'node unavailable' }, fn);

  maybe('correct JS function passes', async () => {
    const code = `function twoSum(nums, target){const m=new Map();for(let i=0;i<nums.length;i++){if(m.has(target-nums[i]))return [m.get(target-nums[i]),i];m.set(nums[i],i);}return[];}`;
    const r = await runCase('javascript', code, 'twoSum', tc([[2, 7, 11, 15], 9], [0, 1]));
    assert.equal(r.status, 'pass', r.error);
  });

  maybe('WRONG JS output is caught as fail', async () => {
    const code = `function add(a,b){return a-b;}`; // bug: minus not plus
    const r = await runCase('javascript', code, 'add', tc([2, 3], 5));
    assert.equal(r.status, 'fail');
  });

  maybe('JS runtime error is reported as error', async () => {
    const code = `function f(x){ return x.nope.crash; }`;
    const r = await runCase('javascript', code, 'f', tc([1], 1));
    assert.equal(r.status, 'error');
  });
});
