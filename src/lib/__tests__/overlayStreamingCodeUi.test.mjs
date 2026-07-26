import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldUseStreamingCodeUi,
  isUnclosedCodeFencePart,
  splitStreamingCodeLines,
} from '../overlayStreamingCodeUi.mjs';

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

describe('isUnclosedCodeFencePart', () => {
  test('bare opening marker with no content yet is unclosed', () => {
    assert.equal(isUnclosedCodeFencePart('```'), true);
  });

  test('opening marker plus language tag with no newline yet is unclosed', () => {
    assert.equal(isUnclosedCodeFencePart('```python'), true);
  });

  test('fence still growing without a closer is unclosed', () => {
    assert.equal(isUnclosedCodeFencePart('```python\ndef f():\n    pass'), true);
  });

  test('fence terminated by a later ``` is closed', () => {
    assert.equal(isUnclosedCodeFencePart('```python\nprint(1)\n```'), false);
  });

  test('minimal empty closed fence (six backticks) is closed', () => {
    assert.equal(isUnclosedCodeFencePart('``````'), false);
  });

  test('non-fence text is never treated as a fence part', () => {
    assert.equal(isUnclosedCodeFencePart('plain text'), false);
    assert.equal(isUnclosedCodeFencePart(''), false);
  });
});

describe('splitStreamingCodeLines', () => {
  test('no newline yet: everything is the partial (in-progress) line', () => {
    assert.deepEqual(splitStreamingCodeLines('def f('), {
      completedLines: [],
      partialLine: 'def f(',
    });
  });

  test('one completed line plus a growing partial line', () => {
    assert.deepEqual(splitStreamingCodeLines('def f():\n    return'), {
      completedLines: ['def f():'],
      partialLine: '    return',
    });
  });

  test('multiple completed lines', () => {
    assert.deepEqual(splitStreamingCodeLines('a\nb\nc\nd'), {
      completedLines: ['a', 'b', 'c'],
      partialLine: 'd',
    });
  });

  test('trailing newline: last completed line is followed by an empty in-progress line', () => {
    assert.deepEqual(splitStreamingCodeLines('a\nb\n'), {
      completedLines: ['a', 'b'],
      partialLine: '',
    });
  });

  test('leading newline: first completed line is blank', () => {
    assert.deepEqual(splitStreamingCodeLines('\nfoo'), {
      completedLines: [''],
      partialLine: 'foo',
    });
  });

  test('empty input', () => {
    assert.deepEqual(splitStreamingCodeLines(''), { completedLines: [], partialLine: '' });
  });
});
