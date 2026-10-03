// src/lib/__tests__/plansMotion.test.mjs
//
// Covers src/lib/plansMotion.ts — the shared motion constants for the Plans &
// Billing tab. The module is data only, so these tests pin the exact values and
// the relationships its doc comments promise (removal settles longer than
// activation, arriving ink is slower than departing ink, easings are valid
// cubic-bezier control points).
//
// Run: node --experimental-strip-types --test src/lib/__tests__/plansMotion.test.mjs
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as plansMotion from '../plansMotion.ts';
import { EASE_ENTER, EASE_LEAVE, SETTLE, INK, BEAT } from '../plansMotion.ts';

/** Cubic-bezier y at a given x, solved by bisection (x(t) is monotonic). */
function bezierY([x1, y1, x2, y2], x) {
  const at = (a, b, t) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

describe('plansMotion — exports', () => {
  test('exports exactly the documented vocabulary', () => {
    assert.deepEqual(Object.keys(plansMotion).sort(), ['BEAT', 'EASE_ENTER', 'EASE_LEAVE', 'INK', 'SETTLE']);
  });

  test('pinned values', () => {
    assert.deepEqual(EASE_ENTER, [0.32, 0.72, 0, 1]);
    assert.deepEqual(EASE_LEAVE, [0.33, 1, 0.68, 1]);
    assert.deepEqual(SETTLE, { activate: 0.32, remove: 0.38 });
    assert.deepEqual(INK, { out: 0.16, in: 0.24 });
    assert.equal(BEAT, 0.08);
  });
});

describe('plansMotion — easings', () => {
  for (const [name, ease] of [['EASE_ENTER', EASE_ENTER], ['EASE_LEAVE', EASE_LEAVE]]) {
    test(`${name} is a valid cubic-bezier 4-tuple`, () => {
      assert.ok(Array.isArray(ease));
      assert.equal(ease.length, 4);
      for (const n of ease) assert.ok(Number.isFinite(n));
      // CSS / framer-motion require the x control points to stay within [0, 1].
      assert.ok(ease[0] >= 0 && ease[0] <= 1);
      assert.ok(ease[2] >= 0 && ease[2] <= 1);
    });

    test(`${name} is an ease-out curve that never overshoots`, () => {
      let prev = 0;
      for (let i = 1; i <= 20; i++) {
        const x = i / 20;
        const y = bezierY(ease, x);
        assert.ok(y >= prev - 1e-9, `monotonic at x=${x}`);
        assert.ok(y <= 1 + 1e-9, `no overshoot at x=${x}`);
        prev = y;
      }
      // Decelerating: ahead of linear at the midpoint.
      assert.ok(bezierY(ease, 0.5) > 0.5);
      assert.ok(Math.abs(bezierY(ease, 1) - 1) < 1e-6);
    });
  }

  test('the two easings are distinct tuples', () => {
    assert.notStrictEqual(EASE_ENTER, EASE_LEAVE);
    assert.notDeepEqual(EASE_ENTER, EASE_LEAVE);
  });
});

describe('plansMotion — durations', () => {
  test('all durations are positive, finite seconds well under one second', () => {
    for (const n of [SETTLE.activate, SETTLE.remove, INK.out, INK.in, BEAT]) {
      assert.equal(typeof n, 'number');
      assert.ok(Number.isFinite(n) && n > 0 && n < 1, String(n));
    }
  });

  test('removal settles longer than activation', () => {
    assert.ok(SETTLE.remove > SETTLE.activate);
  });

  test('arriving ink is slower than departing ink', () => {
    assert.ok(INK.in > INK.out);
  });

  test('the beat is shorter than either ink phase', () => {
    assert.ok(BEAT < INK.out);
    assert.ok(BEAT < INK.in);
  });

  test('departing ink plus the beat finishes within the shortest layout settle', () => {
    // "arriving content follows one BEAT later so it lands as the layout
    // finishes settling" — the arrival must be able to start before the settle ends.
    assert.ok(INK.out + BEAT < Math.min(SETTLE.activate, SETTLE.remove));
  });
});
