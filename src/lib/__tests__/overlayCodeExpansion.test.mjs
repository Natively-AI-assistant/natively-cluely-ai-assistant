import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldEagerExpandForCodeToken,
  shouldHoldEagerCodeExpansion,
  CODE_EXPANSION_TRANSITION,
} from '../overlayCodeExpansion.mjs';

describe('overlayCodeExpansion', () => {
  test('eagerly expands for what-to-answer code fences before DOM visibility scan', () => {
    assert.equal(
      shouldEagerExpandForCodeToken('what_to_answer', '```python\nprint(1)\n```'),
      true,
    );
  });

  test('eagerly expands for manual chat code fences before finalize marks isCode', () => {
    assert.equal(
      shouldEagerExpandForCodeToken('chat', '```ts\nconsole.log(1)\n```'),
      true,
    );
  });

  test('eagerly expands when a streamed code fence is split across token boundary', () => {
    assert.equal(shouldEagerExpandForCodeToken('what_to_answer', '`python\nprint(1)', '``'), true);
  });

  test('does not eagerly expand non-answer streams just because they contain code fences', () => {
    assert.equal(shouldEagerExpandForCodeToken('recap', '```text\nnotes\n```'), false);
    assert.equal(shouldEagerExpandForCodeToken('clarify', '```text\nexplain\n```'), false);
  });

  test('does not eagerly expand plain answer text', () => {
    assert.equal(shouldEagerExpandForCodeToken('what_to_answer', 'Use a sliding window.'), false);
    assert.equal(shouldEagerExpandForCodeToken('chat', 'Use a sliding window.'), false);
  });

  test('holds eager expansion until the code DOM row exists', () => {
    assert.equal(
      shouldHoldEagerCodeExpansion({
        hasCodeElements: false,
        hasVisibleCodeElement: false,
        eagerExpansionHold: true,
      }),
      true,
    );
  });

  test('releases eager expansion hold once code DOM rows exist', () => {
    assert.equal(
      shouldHoldEagerCodeExpansion({
        hasCodeElements: true,
        hasVisibleCodeElement: false,
        eagerExpansionHold: true,
      }),
      false,
    );
  });

  test('uses a short subtle spring for Apple-like coding expansion', () => {
    assert.equal(CODE_EXPANSION_TRANSITION.type, 'spring');
    assert.equal(CODE_EXPANSION_TRANSITION.duration <= 0.28, true);
    assert.equal(CODE_EXPANSION_TRANSITION.bounce, 0.16);
    assert.equal(CODE_EXPANSION_TRANSITION.restDelta, 0.5);
    assert.equal(CODE_EXPANSION_TRANSITION.restSpeed, 12);
  });
});
