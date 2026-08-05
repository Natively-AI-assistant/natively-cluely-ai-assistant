// electron/utils/__tests__/flattenStructuredJsonAnswer.test.mjs
//
// Regression test for issue #404: a cURL provider's responsePath resolving to
// OpenAI Structured Outputs content (a JSON-encoded string, e.g.
// '{"bullet_points": ["a", "b"]}') was dumped raw into the overlay instead of
// being rendered as text.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/utils/curlUtils.js');
const { flattenStructuredJsonAnswer } = await import(pathToFileURL(modPath).href);

describe('flattenStructuredJsonAnswer (obs #404)', () => {
  test('renders a JSON object with a single array field as a bullet list', () => {
    const raw = JSON.stringify({ bullet_points: ['Led migration to v2', 'Cut latency 40%'] });
    const result = flattenStructuredJsonAnswer(raw);
    assert.equal(result, '- Led migration to v2\n- Cut latency 40%');
  });

  test('renders a bare JSON array as a bullet list', () => {
    const raw = JSON.stringify(['one', 'two', 'three']);
    const result = flattenStructuredJsonAnswer(raw);
    assert.equal(result, '- one\n- two\n- three');
  });

  test('unwraps a single string field', () => {
    const raw = JSON.stringify({ answer: 'Hello there' });
    const result = flattenStructuredJsonAnswer(raw);
    assert.equal(result, 'Hello there');
  });

  test('returns null for plain (non-JSON) text so callers fall back to the raw string', () => {
    const result = flattenStructuredJsonAnswer('Just a normal answer, not JSON.');
    assert.equal(result, null);
  });

  test('returns null for ambiguous multi-field objects rather than guessing', () => {
    const raw = JSON.stringify({ title: 'Report', tags: ['a', 'b'], notes: ['x', 'y'] });
    const result = flattenStructuredJsonAnswer(raw);
    assert.equal(result, null);
  });
});
