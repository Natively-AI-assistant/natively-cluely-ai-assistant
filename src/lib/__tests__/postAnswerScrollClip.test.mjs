// Regression: fast scroll after ⌘⇧Enter made the answer look like it vanished.
//
// Mechanism (not a state clear): scroll-away from [data-code-msg] contracted the
// shell (scrollMaxH 560→320) while sticky-bottom pin forced scrollTop during the
// shrink, clipping the tall answer out of view.
//
// Contract: post-answer width hold blocks scroll-triggered contraction; sticky
// pin only runs on expand; session reset clears the hold.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  path.resolve(__dirname, '../../components/NativelyInterface.tsx'),
  'utf8',
);

describe('post-answer scroll clip regression', () => {
  test('tracks a postAnswerWidthHoldRef', () => {
    assert.match(source, /postAnswerWidthHoldRef/, 'must declare postAnswerWidthHoldRef');
  });

  test('blocks scroll-away contraction while the hold is active', () => {
    assert.match(
      source,
      /postAnswerWidthHoldRef\.current && !visible && codeExpandedRef\.current/,
      'checkCodeVisibility must early-return on scroll-away while hold is set',
    );
  });

  test('sticky-bottom pin only runs while expanding', () => {
    assert.match(
      source,
      /const isExpanding = targetWidth > fromWidth/,
      'startTransition must distinguish expand vs contract',
    );
    assert.match(
      source,
      /if \(isExpanding\) pinScrollBottomIfNeeded\(\)/,
      'pinScrollBottomIfNeeded must be gated on isExpanding',
    );
    // Ensure the unguarded per-frame pin is gone from onUpdate.
    const onUpdateIdx = source.indexOf('onUpdate: () => {');
    assert.ok(onUpdateIdx > 0, 'animation onUpdate present');
    const onUpdateBlock = source.slice(onUpdateIdx, onUpdateIdx + 400);
    assert.match(
      onUpdateBlock,
      /if \(isExpanding\) pinScrollBottomIfNeeded\(\)/,
      'onUpdate must only pin when expanding',
    );
  });

  test('user scroll updates wasAtBottomRef', () => {
    assert.match(
      source,
      /wasAtBottomRef\.current = distanceFromBottom <= 8/,
      'scroll listener must refresh sticky-bottom intent',
    );
  });
});
