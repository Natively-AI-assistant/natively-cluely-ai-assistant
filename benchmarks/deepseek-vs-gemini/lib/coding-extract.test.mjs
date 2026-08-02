// benchmarks/deepseek-vs-gemini/lib/coding-extract.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractCode } from './coding-extract.mjs';

describe('extractCode', () => {
  test('extracts a fenced code block with a language tag', () => {
    const text = 'Here is the solution:\n```javascript\nfunction add(a, b) { return a + b; }\n```\nDone.';
    assert.equal(extractCode(text, 'javascript').trim(), 'function add(a, b) { return a + b; }');
  });

  test('extracts a fenced code block with no language tag', () => {
    const text = '```\ndef add(a, b):\n    return a + b\n```';
    assert.equal(extractCode(text, 'python').trim(), 'def add(a, b):\n    return a + b');
  });

  test('prefers the fenced block matching the requested language when multiple blocks exist', () => {
    const text = '```python\n# wrong one\n```\n```javascript\nfunction add(a, b) { return a + b; }\n```';
    assert.ok(extractCode(text, 'javascript').includes('function add'));
  });

  test('falls back to the whole text when no fenced block is present', () => {
    const text = 'function add(a, b) { return a + b; }';
    assert.equal(extractCode(text, 'javascript').trim(), text.trim());
  });

  test('returns null for empty input', () => {
    assert.equal(extractCode('', 'javascript'), null);
  });
});
