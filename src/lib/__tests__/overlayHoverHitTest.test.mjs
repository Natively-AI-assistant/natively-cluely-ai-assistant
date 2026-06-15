import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPointerOverContent } from '../overlayHoverHitTest.mjs';

// Simulate the collapsed shell (600px) centered in the fixed 780px window:
// ~90px transparent margins each side. Window-local coords here for clarity.
const collapsedRect = { left: 90, top: 40, right: 690, bottom: 400 };

test('pointer inside the painted content → over content (capture)', () => {
  assert.equal(isPointerOverContent(collapsedRect, 390, 200), true);
});

test('pointer in the LEFT transparent margin → NOT over content (pass-through)', () => {
  assert.equal(isPointerOverContent(collapsedRect, 30, 200), false);
});

test('pointer in the RIGHT transparent margin → NOT over content (pass-through)', () => {
  assert.equal(isPointerOverContent(collapsedRect, 740, 200), false);
});

test('pointer above the content (top margin / pill gap) → NOT over content', () => {
  assert.equal(isPointerOverContent(collapsedRect, 390, 10), false);
});

test('pointer below the content → NOT over content', () => {
  assert.equal(isPointerOverContent(collapsedRect, 390, 500), false);
});

test('edges are inclusive (exact boundary counts as over content)', () => {
  assert.equal(isPointerOverContent(collapsedRect, 90, 40), true);
  assert.equal(isPointerOverContent(collapsedRect, 690, 400), true);
});

test('null/undefined rect → not over content (window not yet measured)', () => {
  assert.equal(isPointerOverContent(null, 390, 200), false);
  assert.equal(isPointerOverContent(undefined, 390, 200), false);
});

test('NaN / non-numeric coords → not over content (defensive)', () => {
  assert.equal(isPointerOverContent(collapsedRect, NaN, 200), false);
  assert.equal(isPointerOverContent(collapsedRect, 390, NaN), false);
  // @ts-expect-error intentional bad input
  assert.equal(isPointerOverContent(collapsedRect, undefined, 200), false);
});

test('expanded shell (780 == window width) → margins vanish, full width is content', () => {
  // When expanded the panel fills the window; only top/bottom margins remain.
  const expandedRect = { left: 0, top: 40, right: 780, bottom: 600 };
  assert.equal(isPointerOverContent(expandedRect, 5, 200), true);
  assert.equal(isPointerOverContent(expandedRect, 775, 200), true);
  assert.equal(isPointerOverContent(expandedRect, 390, 10), false);
});
