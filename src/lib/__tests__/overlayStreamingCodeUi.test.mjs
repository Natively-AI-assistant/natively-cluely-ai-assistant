import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseStreamingCodeUi } from '../overlayStreamingCodeUi.mjs';

describe('overlayStreamingCodeUi', () => {
  test('detects unclosed fenced code in accumulated answer stream', () => {
    assert.equal(
      shouldUseStreamingCodeUi('what_to_answer', '```python\nprint(1)', ''),
      true,
    );
  });

  test('detects fenced code split across token boundary', () => {
    assert.equal(
      shouldUseStreamingCodeUi('chat', '`python\nprint(1)', '``'),
      true,
    );
  });

  test('does not trigger for inline code backticks', () => {
    assert.equal(
      shouldUseStreamingCodeUi('what_to_answer', 'Use `map` here.', ''),
      false,
    );
  });

  test('keeps non-answer streams on the imperative generic path', () => {
    assert.equal(shouldUseStreamingCodeUi('recap', '```text\nnotes', ''), false);
    assert.equal(shouldUseStreamingCodeUi('clarify', '```text\nexplain', ''), false);
  });
});
