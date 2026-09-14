import test from 'node:test';
import assert from 'node:assert/strict';
import { isAimedAtAuto, SNAP_TO_AUTO_TOLERANCE } from '../overlaySnapToAuto.mjs';

test('the default band is 10%', () => {
  assert.equal(SNAP_TO_AUTO_TOLERANCE, 0.1);
});

test('a near miss at the empty default height snaps back to auto', () => {
  // 154 is the chrome-only height; a drag that lands anywhere in 139..169 was
  // aiming at it.
  for (const h of [139, 145, 154, 161, 169]) {
    assert.equal(isAimedAtAuto(h, 154), true, `${h}`);
  }
});

test('a deliberate drag away from the empty default still pins', () => {
  for (const h of [120, 138, 170, 400]) {
    assert.equal(isAimedAtAuto(h, 154), false, `${h}`);
  }
});

test('the band scales with the auto size', () => {
  assert.equal(isAimedAtAuto(720, 800), true);
  assert.equal(isAimedAtAuto(880, 800), true);
  assert.equal(isAimedAtAuto(719, 800), false);
  assert.equal(isAimedAtAuto(881, 800), false);
});

test('the boundary is inclusive, so an exact 10% miss still counts as aiming', () => {
  assert.equal(isAimedAtAuto(732 * 1.1, 732), true);
  assert.equal(isAimedAtAuto(732 * 0.9, 732), true);
});

test('an exact hit obviously snaps', () => {
  assert.equal(isAimedAtAuto(732, 732), true);
});

test('an unknown auto size NEVER snaps — discarding a wanted pin is the bad failure', () => {
  for (const auto of [0, -1, NaN, Infinity, undefined]) {
    assert.equal(isAimedAtAuto(500, auto), false, `${auto}`);
  }
});

test('a nonsense dragged size never snaps either', () => {
  for (const d of [0, -5, NaN, Infinity, undefined]) {
    assert.equal(isAimedAtAuto(d, 500), false, `${d}`);
  }
});

test('the tolerance is tunable and a zero band means exact-only', () => {
  assert.equal(isAimedAtAuto(500, 500, 0), true);
  assert.equal(isAimedAtAuto(501, 500, 0), false);
  assert.equal(isAimedAtAuto(600, 500, 0.25), true);
});
