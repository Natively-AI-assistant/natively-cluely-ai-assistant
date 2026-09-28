import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_SUPPRESSION,
  suppressionKeyForArm,
  isAutoScrollSuppressed,
  detectExternalUpwardScroll,
  shouldArmFromWheel,
} from '../scrollFollow.mjs';

describe('suppressionKeyForArm', () => {
  test('keys suppression to the streaming message id while a stream is live', () => {
    assert.equal(suppressionKeyForArm('msg-7'), 'msg-7');
  });

  // Regression: arming with a null streaming id used to store null, which the
  // suppression check reads as "not suppressed" — so a scroll-up in a finished
  // chat (or before the first token) armed nothing and the next message
  // update yanked the user back down.
  test('never returns null when idle — it must still read as armed', () => {
    const key = suppressionKeyForArm(null);
    assert.notEqual(key, null);
    assert.equal(key, IDLE_SUPPRESSION);
  });
});

describe('isAutoScrollSuppressed', () => {
  test('null suppression id is never suppressed', () => {
    assert.equal(isAutoScrollSuppressed(null, 'a'), false);
    assert.equal(isAutoScrollSuppressed(null, null), false);
  });

  test('suppressed while the same stream is live', () => {
    assert.equal(isAutoScrollSuppressed('a', 'a'), true);
  });

  test('stays suppressed after that stream finalizes (streaming id goes null)', () => {
    assert.equal(isAutoScrollSuppressed('a', null), true);
  });

  test('a NEW stream lifts suppression', () => {
    assert.equal(isAutoScrollSuppressed('a', 'b'), false);
  });

  test('an idle arm holds through non-streaming updates and lifts on the next stream', () => {
    assert.equal(isAutoScrollSuppressed(IDLE_SUPPRESSION, null), true);
    assert.equal(isAutoScrollSuppressed(IDLE_SUPPRESSION, 'first-stream'), false);
  });
});

describe('detectExternalUpwardScroll', () => {
  test('scrollTop below where we last left it is somebody else scrolling up', () => {
    assert.equal(
      detectExternalUpwardScroll({ scrollTop: 300, lastScrollTop: 500, maxScroll: 500 }),
      true,
    );
  });

  test('scrollTop where we left it is not an interrupt', () => {
    assert.equal(
      detectExternalUpwardScroll({ scrollTop: 500, lastScrollTop: 500, maxScroll: 500 }),
      false,
    );
  });

  test('a sub-pixel wobble is not an interrupt', () => {
    assert.equal(
      detectExternalUpwardScroll({ scrollTop: 499.4, lastScrollTop: 500, maxScroll: 500 }),
      false,
    );
  });

  // The browser clamps scrollTop down on its own when content shrinks (a code
  // block collapsing, finalize re-rendering shorter). That is not the user.
  test('a native clamp after the content shrank is not an interrupt', () => {
    assert.equal(
      detectExternalUpwardScroll({ scrollTop: 320, lastScrollTop: 500, maxScroll: 320 }),
      false,
    );
  });

  test('content that grew since the last write is not an interrupt', () => {
    assert.equal(
      detectExternalUpwardScroll({ scrollTop: 500, lastScrollTop: 500, maxScroll: 900 }),
      false,
    );
  });

  test('scrolling up when the content also grew is still an interrupt', () => {
    assert.equal(
      detectExternalUpwardScroll({ scrollTop: 380, lastScrollTop: 500, maxScroll: 900 }),
      true,
    );
  });
});

describe('shouldArmFromWheel', () => {
  const scrollable = { scrollTop: 400, scrollHeight: 1000, clientHeight: 500 };

  test('arms on an upward vertical wheel over a scrollable, scrolled container', () => {
    assert.equal(shouldArmFromWheel({ deltaX: 0, deltaY: -40, ...scrollable }), true);
  });

  // Regression guard kept from scrollInterruptDecision: auto-follow leaves the
  // view at the very bottom, and a wheel-up from exactly there must still arm.
  test('arms from exactly the bottom', () => {
    assert.equal(
      shouldArmFromWheel({ deltaX: 0, deltaY: -3, scrollTop: 500, scrollHeight: 1000, clientHeight: 500 }),
      true,
    );
  });

  test('ignores a downward wheel', () => {
    assert.equal(shouldArmFromWheel({ deltaX: 0, deltaY: 40, ...scrollable }), false);
  });

  test('ignores a wheel that is mostly horizontal (code-block swipe jitter)', () => {
    assert.equal(shouldArmFromWheel({ deltaX: 80, deltaY: -6, ...scrollable }), false);
  });

  test('ignores a container with nothing to scroll', () => {
    assert.equal(
      shouldArmFromWheel({ deltaX: 0, deltaY: -40, scrollTop: 0, scrollHeight: 300, clientHeight: 300 }),
      false,
    );
  });

  test('ignores a wheel-up at the very top — nothing can move', () => {
    assert.equal(
      shouldArmFromWheel({ deltaX: 0, deltaY: -40, scrollTop: 0, scrollHeight: 1000, clientHeight: 500 }),
      false,
    );
  });
});
