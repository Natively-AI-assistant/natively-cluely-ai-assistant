// electron/llm/codeVerification/__tests__/PureCore.test.mjs
//
// Unit tests for the dependency-free core of verified code execution:
// extraction (spec, code block, problem examples, merge), drivers (templating +
// result parsing), and the judge (safe value comparison).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  normalizeLanguage,
  inferLanguageFromText,
  extractCodeBlock,
  extractVerificationSpec,
  parseProblemExamples,
  mergeTestCases,
} from '../../../../dist-electron/electron/llm/codeVerification/extractTests.js';
import {
  buildDriver,
  parseDriverResult,
  isLocallyRunnable,
  RESULT_SENTINEL_START,
  RESULT_SENTINEL_END,
} from '../../../../dist-electron/electron/llm/codeVerification/drivers.js';
import { valuesEqual, renderValue } from '../../../../dist-electron/electron/llm/codeVerification/judge.js';

describe('language normalization + inference', () => {
  test('normalizeLanguage maps aliases', () => {
    assert.equal(normalizeLanguage('py'), 'python');
    assert.equal(normalizeLanguage('Python3'), 'python');
    assert.equal(normalizeLanguage('JS'), 'javascript');
    assert.equal(normalizeLanguage('c++'), 'cpp');
    assert.equal(normalizeLanguage('nonsense'), null);
    assert.equal(normalizeLanguage(undefined), null);
  });
  test('inferLanguageFromText reads explicit requests and code shape', () => {
    assert.equal(inferLanguageFromText('write this in Java'), 'java');
    assert.equal(inferLanguageFromText('public class Solution { }'), 'java');
    assert.equal(inferLanguageFromText('def solve(n):'), 'python');
    assert.equal(inferLanguageFromText('const f = (x) => x'), 'javascript');
    assert.equal(inferLanguageFromText('just some prose'), null);
  });
});

describe('extractCodeBlock', () => {
  test('extracts first fenced block + language + raw block', () => {
    const ans = 'text\n```python\ndef f(x):\n    return x\n```\nmore';
    const e = extractCodeBlock(ans);
    assert.equal(e.language, 'python');
    assert.match(e.code, /def f\(x\)/);
    assert.match(e.block, /```python/);
  });
  test('returns nulls when no code block', () => {
    const e = extractCodeBlock('no code here');
    assert.equal(e.code, '');
    assert.equal(e.language, null);
    assert.equal(e.block, null);
  });
});

describe('extractVerificationSpec', () => {
  test('parses a valid spec and returns the raw block for stripping', () => {
    const ans = `## Code\n\`\`\`python\ndef twoSum(a,t): return [0,1]\n\`\`\`\n<verification_spec>\n{"entry":"twoSum","language":"python","cases":[{"input":[[2,7,11,15],9],"expected":[0,1]}]}\n</verification_spec>`;
    const { spec, block } = extractVerificationSpec(ans);
    assert.ok(spec, 'spec parsed');
    assert.equal(spec.entry, 'twoSum');
    assert.equal(spec.language, 'python');
    assert.equal(spec.cases.length, 1);
    assert.equal(spec.cases[0].source, 'model');
    assert.match(block, /<verification_spec>/);
  });
  test('tolerates a ```json-fenced spec body', () => {
    const ans = '<verification_spec>\n```json\n{"entry":"f","language":"js","cases":[]}\n```\n</verification_spec>';
    const { spec } = extractVerificationSpec(ans);
    assert.ok(spec);
    assert.equal(spec.language, 'javascript');
  });
  test('returns null spec (but the block) on malformed JSON', () => {
    const ans = '<verification_spec>\n{not json}\n</verification_spec>';
    const { spec, block } = extractVerificationSpec(ans);
    assert.equal(spec, null);
    assert.ok(block, 'block still returned so it can be stripped');
  });
  test('returns null/null when absent', () => {
    const { spec, block } = extractVerificationSpec('no spec');
    assert.equal(spec, null);
    assert.equal(block, null);
  });
});

describe('parseProblemExamples', () => {
  test('parses Input/Output with named assignments', () => {
    const cases = parseProblemExamples('Example 1: Input: nums = [2,7,11,15], target = 9 Output: [0,1]');
    assert.equal(cases.length, 1);
    assert.deepEqual(cases[0].input, [[2, 7, 11, 15], 9]);
    assert.deepEqual(cases[0].expected, [0, 1]);
    assert.equal(cases[0].source, 'problem');
  });
  test('parses a bare single value input', () => {
    const cases = parseProblemExamples('Input: [1,2,0] Output: 3');
    assert.equal(cases.length, 1);
    assert.deepEqual(cases[0].input, [[1, 2, 0]]);
    assert.equal(cases[0].expected, 3);
  });
  test('returns [] when no examples', () => {
    assert.deepEqual(parseProblemExamples('Find the first missing positive.'), []);
    assert.deepEqual(parseProblemExamples(undefined), []);
  });
});

describe('mergeTestCases', () => {
  test('problem cases first, dedupes identical, caps', () => {
    const problem = [{ input: [[1]], expected: 1, source: 'problem' }];
    const model = [
      { input: [[1]], expected: 1, source: 'model' }, // dup of problem
      { input: [[2]], expected: 2, source: 'model' },
    ];
    const merged = mergeTestCases(problem, model);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].source, 'problem');
    assert.deepEqual(merged[1].input, [[2]]);
  });
});

describe('buildDriver + parseDriverResult', () => {
  test('python driver embeds code, entry, and sentinels', () => {
    const d = buildDriver('python', 'def f(x):\n    return x*2', 'f');
    assert.equal(d.localCmd, 'python3');
    assert.equal(d.ext, 'py');
    assert.match(d.source, /def f\(x\)/);
    assert.match(d.source, /NATIVELY_TC/);
    assert.match(d.source, new RegExp(RESULT_SENTINEL_START.replace(/\$/g, '\\$')));
  });
  test('javascript driver supports bare fn and Solution class', () => {
    const d = buildDriver('javascript', 'function f(x){return x}', 'f');
    assert.equal(d.localCmd, 'node');
    assert.match(d.source, /typeof f === 'function'/);
    assert.match(d.source, /new Solution\(\)/);
  });
  test('unsupported language → null driver', () => {
    assert.equal(buildDriver('go', 'x', 'f'), null);
  });
  test('REJECTS a non-identifier entry (template-injection guard) → null driver', () => {
    // An entry that tries to break out of the template / inject code must yield
    // null (orchestrator then skips) — never an injectable driver.
    assert.equal(buildDriver('javascript', 'x', 'f; require("fs").writeFileSync("/tmp/x","y")'), null);
    assert.equal(buildDriver('python', 'x', 'f"); import os; os.system("id'), null);
    assert.equal(buildDriver('python', 'x', 'has space'), null);
    assert.equal(buildDriver('python', 'x', ''), null);
    // A normal identifier is still accepted.
    assert.ok(buildDriver('python', 'def f(x): return x', 'f'));
    assert.ok(buildDriver('javascript', 'function twoSum(){}', 'twoSum'));
  });
  test('isLocallyRunnable: python/js/cpp/java/go (compiled langs gated on toolchain at run time)', () => {
    assert.equal(isLocallyRunnable('python'), true);
    assert.equal(isLocallyRunnable('javascript'), true);
    assert.equal(isLocallyRunnable('cpp'), true);
    assert.equal(isLocallyRunnable('java'), true);
    assert.equal(isLocallyRunnable('go'), true);
    // SQL runs locally too but via its OWN orchestrator branch (not the
    // entry(args) path), so it is intentionally NOT in LOCAL_LANGUAGES.
    assert.equal(isLocallyRunnable('sql'), false);
    assert.equal(isLocallyRunnable('c'), false);
  });
  test('parseDriverResult extracts the sentinel-delimited JSON, ignoring debug prints', () => {
    const out = `debug line\n${RESULT_SENTINEL_START}[0,1]${RESULT_SENTINEL_END}`;
    const r = parseDriverResult(out);
    assert.equal(r.found, true);
    assert.deepEqual(r.value, [0, 1]);
  });
  test('parseDriverResult reports not-found when no sentinels', () => {
    assert.equal(parseDriverResult('just output').found, false);
  });
});

describe('judge valuesEqual', () => {
  test('exact deep equality', () => {
    assert.ok(valuesEqual([0, 1], [0, 1]));
    assert.ok(valuesEqual({ a: 1, b: [2] }, { b: [2], a: 1 }));
    assert.ok(!valuesEqual([0, 1], [1, 0]));
  });
  test('numeric int/float and string-number normalization', () => {
    assert.ok(valuesEqual(1, 1.0));
    assert.ok(valuesEqual(3, '3'));
    assert.ok(!valuesEqual(3, '3.5'));
  });
  test('order-insensitive opt-in', () => {
    assert.ok(valuesEqual([1, 2, 3], [3, 2, 1], { orderInsensitive: true }));
    assert.ok(!valuesEqual([1, 2, 2], [1, 1, 2], { orderInsensitive: true }));
  });
  test('boolean vs stringified bool', () => {
    assert.ok(valuesEqual(true, 'true'));
    assert.ok(!valuesEqual(true, 'false'));
  });
  test('renderValue truncates + is safe on weird input', () => {
    assert.equal(renderValue([1, 2]), '[1,2]');
    assert.ok(renderValue('x'.repeat(200)).length <= 80);
  });
  test('edge values: null/undefined/NaN behave safely (documented, no false pass)', () => {
    assert.ok(valuesEqual(null, null));
    assert.ok(!valuesEqual(null, undefined), 'null != undefined');
    assert.ok(!valuesEqual(NaN, NaN), 'NaN never equals NaN (honest non-match)');
    assert.ok(!valuesEqual(0.1 + 0.2, 0.3), 'no implicit float epsilon — exact by default');
  });
  test('deeply nested structures compare recursively (incl. reordered nested keys)', () => {
    assert.ok(valuesEqual([[1, [2]], 3], [[1, [2]], 3]));
    assert.ok(valuesEqual({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } }));
    assert.ok(!valuesEqual([[1, [2]], 3], [[1, [9]], 3]));
  });
  test('non-numeric strings never coerce to numbers', () => {
    assert.ok(!valuesEqual('3', 'three'));
    assert.ok(!valuesEqual(3, 'three'));
  });
});
