import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  widthDerivedScrollMax,
  verticalScrollCap,
  computeScrollMaxHeight,
} from '../overlayScrollBudget.mjs';

describe('overlayScrollBudget', () => {
  test('clamp bounds a value into [lo, hi]', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(99, 0, 10), 10);
  });

  describe('widthDerivedScrollMax', () => {
    test('collapsed width → minHeight (320)', () => {
      assert.equal(widthDerivedScrollMax(600), 320);
    });
    test('expanded width → maxHeight (560)', () => {
      assert.equal(widthDerivedScrollMax(780), 560);
    });
    test('midpoint interpolates linearly', () => {
      assert.equal(widthDerivedScrollMax(690), 440);
    });
    test('clamps below collapsed and above expanded', () => {
      assert.equal(widthDerivedScrollMax(400), 320);
      assert.equal(widthDerivedScrollMax(900), 560);
    });
  });

  describe('verticalScrollCap', () => {
    test('returns Infinity when availHeight is unknown (SSR / not measured)', () => {
      assert.equal(verticalScrollCap({ availHeight: 0, chromeHeight: 200 }), Infinity);
      assert.equal(
        verticalScrollCap({ availHeight: NaN, chromeHeight: 200 }),
        Infinity,
      );
    });

    test('budget = floor(availHeight*0.9) - safetyMargin - chrome', () => {
      // 900*0.9 = 810; -8 margin = 802; -300 chrome = 502
      assert.equal(
        verticalScrollCap({ availHeight: 900, chromeHeight: 300 }),
        502,
      );
    });

    test('never collapses below minScroll on a very short display', () => {
      // 500*0.9=450; -8=442; chrome 400 → 42, floored to minScroll 120
      assert.equal(
        verticalScrollCap({ availHeight: 500, chromeHeight: 400, minScroll: 120 }),
        120,
      );
    });
  });

  describe('computeScrollMaxHeight (the regression guard)', () => {
    // The bug: expanded coding view + a screenshot on a short laptop screen.
    // Chrome (TopPill + quick-actions + input + attached-screenshot preview +
    // footer + paddings) ≈ 360px. Old behavior used the width bound (560)
    // unconditionally → content 360+560 = 920 > 0.9*900 = 810 budget, so the
    // window was clamped and the footer (~110px) got cropped.
    test('SHORT display: vertical cap wins, keeps footer visible', () => {
      const chrome = 360;
      const availHeight = 900; // e.g. 1080p with menubar/dock work area, or a 900px laptop
      const got = computeScrollMaxHeight({
        width: 780,
        availHeight,
        chromeHeight: chrome,
      });
      // vertical cap = floor(810)-8-360 = 442; width bound = 560 → min = 442
      assert.equal(got, 442);
      // Invariant the bug violated: chrome + scroll must fit the budget.
      const budget = Math.floor(availHeight * 0.9);
      assert.ok(
        chrome + got <= budget,
        `content ${chrome + got} must fit budget ${budget}`,
      );
    });

    test('TALL display: width bound wins, chat looks unchanged', () => {
      const got = computeScrollMaxHeight({
        width: 780,
        availHeight: 1400, // tall external monitor
        chromeHeight: 360,
      });
      assert.equal(got, 560); // unchanged aesthetic max
    });

    test('attaching a screenshot (chrome grows) shrinks the scroll, not the footer', () => {
      const availHeight = 880;
      const base = computeScrollMaxHeight({
        width: 780,
        availHeight,
        chromeHeight: 300,
      });
      const withShot = computeScrollMaxHeight({
        width: 780,
        availHeight,
        chromeHeight: 300 + 72, // ~screenshot preview strip
      });
      assert.ok(
        withShot < base,
        `scroll should shrink when a screenshot is attached (${withShot} < ${base})`,
      );
      const budget = Math.floor(availHeight * 0.9);
      assert.ok((300 + 72) + withShot <= budget);
    });

    test('unmeasured viewport falls back to width bound (no clamp)', () => {
      const got = computeScrollMaxHeight({
        width: 780,
        availHeight: 0,
        chromeHeight: 300,
      });
      assert.equal(got, 560);
    });
  });
});
