// electron/llm/codeVerification/__tests__/Orchestrator.test.mjs
//
// Tests the verifyCodingAnswer orchestrator: extraction → execute → judge →
// one-shot correction. Most cases use a FAKE runner/corrector for determinism;
// a final block uses the REAL local sandbox to prove the whole pipeline.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { verifyCodingAnswer } from '../../../../dist-electron/electron/llm/codeVerification/verifyCodingAnswer.js';
import { stripVerificationSpec } from '../../../../dist-electron/electron/llm/codingContract.js';
import { localLanguageAvailable } from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';

const answerWithSpec = (code, entry = 'f', lang = 'python', cases = '[{"input":[2],"expected":4}]') =>
  `## Approach\n\nx\n\n## Code\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n## Complexity\n\nTime: O(1). Space: O(1).\n\n<verification_spec>\n{"entry":"${entry}","language":"${lang}","cases":${cases}}\n</verification_spec>`;

// A fake runner keyed on a verdict map: returns pass/fail/error per call.
const fakeRunner = (decide) => async (lang, code, entry, tc) => decide(code, tc);

describe('verifyCodingAnswer — verdicts via fake runner', () => {
  test('all-pass → verdict.passed, not skipped, no correction', async () => {
    const events = [];
    const out = await verifyCodingAnswer({
      answer: answerWithSpec('def f(x): return x*2'),
      runCase: fakeRunner((_c, tc) => ({ case: tc, status: 'pass', stdout: '', actual: tc.expected, ms: 1 })),
      languageAvailable: async () => true,
      onEvent: (n) => events.push(n),
    });
    assert.equal(out.verdict.passed, true);
    assert.equal(out.verdict.skipped, false);
    assert.equal(out.corrected, undefined);
    assert.ok(events.includes('code_verify_passed'));
  });

  test('fail with no corrector → failed verdict, no correction attempted', async () => {
    const out = await verifyCodingAnswer({
      answer: answerWithSpec('def f(x): return x+1'),
      runCase: fakeRunner((_c, tc) => ({ case: tc, status: 'fail', stdout: '', actual: 999, error: 'wrong', ms: 1 })),
      languageAvailable: async () => true,
    });
    assert.equal(out.verdict.passed, false);
    assert.equal(out.corrected, undefined);
    assert.ok(out.verdict.firstFailure);
  });

  test('fail then a CORRECT correction → reVerifiedPassed true + note', async () => {
    let call = 0;
    const out = await verifyCodingAnswer({
      answer: answerWithSpec('def f(x): return x+1'),
      // first code fails; corrected code (contains "FIXED") passes.
      runCase: fakeRunner((code, tc) => code.includes('FIXED')
        ? { case: tc, status: 'pass', stdout: '', actual: tc.expected, ms: 1 }
        : { case: tc, status: 'fail', stdout: '', actual: 1, error: 'wrong', ms: 1 }),
      languageAvailable: async () => true,
      correct: async () => { call++; return answerWithSpec('def f(x): return x*2  # FIXED'); },
    });
    assert.equal(call, 1, 'correction called exactly once');
    assert.ok(out.corrected, 'correction produced');
    assert.equal(out.corrected.reVerifiedPassed, true);
    assert.match(out.corrected.note, /Corrected/);
  });

  test('fail then a STILL-WRONG correction → corrected present but reVerifiedPassed false + review note', async () => {
    const out = await verifyCodingAnswer({
      answer: answerWithSpec('def f(x): return x+1'),
      runCase: fakeRunner((_c, tc) => ({ case: tc, status: 'fail', stdout: '', actual: 1, error: 'wrong', ms: 1 })),
      languageAvailable: async () => true,
      correct: async () => answerWithSpec('def f(x): return x+2  # still wrong'),
    });
    assert.ok(out.corrected);
    assert.equal(out.corrected.reVerifiedPassed, false);
    assert.match(out.corrected.note, /review/i);
  });

  test('correction is attempted at most ONCE (no loop) even if still failing', async () => {
    let calls = 0;
    await verifyCodingAnswer({
      answer: answerWithSpec('def f(x): return x+1'),
      runCase: fakeRunner((_c, tc) => ({ case: tc, status: 'fail', stdout: '', actual: 0, ms: 1 })),
      languageAvailable: async () => true,
      correct: async () => { calls++; return answerWithSpec('def f(x): return x+9'); },
    });
    assert.equal(calls, 1, 'exactly one correction attempt');
  });
});

describe('verifyCodingAnswer — skips (never throws, never false-positive)', () => {
  test('no code block → skipped(no_code)', async () => {
    const out = await verifyCodingAnswer({ answer: 'just prose, no code', languageAvailable: async () => true });
    assert.equal(out.verdict.skipped, true);
    assert.equal(out.verdict.skipReason, 'no_code');
    assert.equal(out.verdict.passed, false);
  });
  test('cloud-only language (c) → skipped(unsupported) — not a failure', async () => {
    const out = await verifyCodingAnswer({
      answer: '```c\nint f(int x){ return x; }\n```',
      languageAvailable: async () => true,
    });
    assert.equal(out.verdict.skipped, true);
    assert.equal(out.verdict.skipReason, 'unsupported_language');
    assert.equal(out.verdict.language, 'c');
  });
  // REGRESSION: an UNKNOWN language declared in the spec (rust/kotlin/php/…) must
  // SKIP cleanly — NOT fall through to inference and run foreign code in the wrong
  // interpreter (the spec used to default language to 'python', silently running
  // e.g. Rust as Python). Must never execute a subprocess, never a false verdict.
  for (const [label, lang, code] of [
    ['rust', 'rust', 'fn f(a:i32)->i32{a}'],
    ['kotlin', 'kotlin', 'fun f(a:Int)=a'],
    ['ruby', 'ruby', 'def f(a)=a'],
    ['php', 'php', 'function f($a){return $a;}'],
    ['csharp', 'csharp', 'int F(int a)=>a;'],
  ]) {
    test(`unsupported declared language (${label}) → skipped(unsupported), never executed`, async () => {
      let executed = false;
      const out = await verifyCodingAnswer({
        answer: `\`\`\`${lang}\n${code}\n\`\`\`\n<verification_spec>{"entry":"f","language":"${lang}","cases":[{"input":[1],"expected":1}]}</verification_spec>`,
        languageAvailable: async () => true,
        runCase: async () => { executed = true; return { case: { input: [1], expected: 1, source: 'model' }, status: 'pass', stdout: '', actual: 1, ms: 0 }; },
        onEvent: (n) => { if (n === 'code_executed') executed = true; },
      });
      assert.equal(out.verdict.passed, false, 'must never falsely pass');
      assert.equal(out.verdict.skipped, true, 'must be a clean skip');
      assert.equal(out.verdict.skipReason, 'unsupported_language');
      assert.equal(executed, false, 'must NOT run a subprocess for an unsupported language');
    });
  }

  test('java with NO toolchain → skipped(runtime_unavailable), never run, never false verdict', async () => {
    const out = await verifyCodingAnswer({
      answer: '```java\nclass Solution { int f(int x){return x;} }\n```',
      languageAvailable: async () => false, // simulate no JDK
    });
    assert.equal(out.verdict.skipped, true);
    assert.equal(out.verdict.skipReason, 'runtime_unavailable');
    assert.equal(out.verdict.language, 'java');
  });
  test('runtime unavailable → skipped(runtime_unavailable)', async () => {
    const out = await verifyCodingAnswer({
      answer: answerWithSpec('def f(x): return x'),
      languageAvailable: async () => false,
    });
    assert.equal(out.verdict.skipped, true);
    assert.equal(out.verdict.skipReason, 'runtime_unavailable');
  });
});

describe('stripVerificationSpec', () => {
  test('removes the hidden block, leaves the visible answer', () => {
    const a = answerWithSpec('def f(x): return x*2');
    const stripped = stripVerificationSpec(a);
    assert.doesNotMatch(stripped, /verification_spec/);
    assert.match(stripped, /## Approach/);
    assert.match(stripped, /def f\(x\)/);
  });
  test('idempotent + safe when no spec present', () => {
    assert.equal(stripVerificationSpec('## Approach\n\nhi'), '## Approach\n\nhi');
  });
});

describe('verifyCodingAnswer — REAL end-to-end (local sandbox)', async () => {
  const havePy = await localLanguageAvailable('python');
  const maybe = (name, fn) => test(name, { skip: havePy ? false : 'python3 unavailable' }, fn);

  maybe('a correct python answer passes against problem + model cases', async () => {
    const answer = answerWithSpec(
      'def add(a, b):\n    return a + b', 'add', 'python', '[{"input":[2,3],"expected":5},{"input":[0,0],"expected":0}]');
    const out = await verifyCodingAnswer({ answer, question: 'add two numbers' });
    assert.equal(out.verdict.passed, true, JSON.stringify(out.verdict.firstFailure));
    assert.equal(out.verdict.total, 2);
  });

  maybe('a WRONG python answer fails, and a real correction callback fixes it', async () => {
    const wrong = answerWithSpec('def add(a, b):\n    return a - b', 'add', 'python', '[{"input":[2,3],"expected":5}]');
    const out = await verifyCodingAnswer({
      answer: wrong,
      question: 'add two numbers',
      correct: async () => answerWithSpec('def add(a, b):\n    return a + b', 'add', 'python', '[{"input":[2,3],"expected":5}]'),
    });
    assert.equal(out.verdict.passed, false, 'wrong code must fail');
    assert.ok(out.corrected, 'correction produced');
    assert.equal(out.corrected.reVerifiedPassed, true, 'corrected code re-verifies');
  });

  maybe('problem-example parsing feeds real cases (no model spec needed)', async () => {
    const answer = '## Approach\n\nadd\n\n## Code\n\n```python\ndef add(a, b):\n    return a + b\n```\n\n## Complexity\n\nO(1)';
    const out = await verifyCodingAnswer({ answer, question: 'Example: Input: a = 2, b = 3 Output: 5' });
    // entry guessed = add ; case parsed from problem.
    assert.equal(out.verdict.passed, true, JSON.stringify(out.verdict));
    assert.ok(out.verdict.results.some(r => r.case.source === 'problem'));
  });
});
