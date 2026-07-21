import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERLAY_RESIZE_DURATION_MS,
  OVERLAY_RESIZE_EASE,
  easeOverlayResize,
  easeOutQuint,
  widthAt,
  isResizeComplete,
} from '../overlayResizeEasing.mjs';

test('OVERLAY_RESIZE_EASE is the iOS drawer curve', () => {
  assert.deepEqual(OVERLAY_RESIZE_EASE, [0.32, 0.72, 0, 1]);
});

test('OVERLAY_RESIZE_DURATION_MS is the tuned 420ms', () => {
  assert.equal(OVERLAY_RESIZE_DURATION_MS, 420);
});

test('easeOverlayResize endpoints are exact', () => {
  assert.equal(easeOverlayResize(0), 0);
  assert.equal(easeOverlayResize(1), 1);
});

test('easeOverlayResize clamps out-of-range input', () => {
  assert.equal(easeOverlayResize(-0.5), 0);
  assert.equal(easeOverlayResize(1.5), 1);
});

test('easeOverlayResize is monotonic and never overshoots [0,1]', () => {
  // Overshoot is forbidden: an eased value >1 would push the CSS panel past the
  // fixed window edge. The drawer curve must stay strictly within [0,1].
  let prev = -Infinity;
  for (let i = 0; i <= 200; i++) {
    const v = easeOverlayResize(i / 200);
    assert.ok(v >= 0 && v <= 1, `value ${v} at t=${i / 200} escaped [0,1]`);
    assert.ok(v >= prev - 1e-9, `not monotonic at t=${i / 200}: ${v} < ${prev}`);
    prev = v;
  }
});

test('easeOverlayResize is ease-OUT (past halfway by the midpoint, gentle tail)', () => {
  // Drawer curve: decelerating, so >0.5 progress by t=0.5, but NOT as violently
  // front-loaded as quint — it should land in a tasteful band, not teleport.
  const mid = easeOverlayResize(0.5);
  assert.ok(mid > 0.5 && mid < 0.97, `expected 0.5<mid<0.97, got ${mid}`);
  // Late tail still moving but nearly done.
  assert.ok(easeOverlayResize(0.9) > 0.97, `expected >0.97 at t=0.9, got ${easeOverlayResize(0.9)}`);
});

test('easeOutQuint endpoints are exact', () => {
  assert.equal(easeOutQuint(0), 0);
  assert.equal(easeOutQuint(1), 1);
});

test('easeOutQuint clamps out-of-range input', () => {
  assert.equal(easeOutQuint(-0.5), 0);
  assert.equal(easeOutQuint(1.5), 1);
});

test('easeOutQuint is strictly monotonic and never overshoots [0,1]', () => {
  // The whole point of replacing the spring: no value may exceed 1 (overshoot),
  // because the main process pushes f(t)*width to setBounds verbatim.
  let prev = -Infinity;
  for (let i = 0; i <= 100; i++) {
    const v = easeOutQuint(i / 100);
    assert.ok(v >= 0 && v <= 1, `value ${v} at t=${i / 100} escaped [0,1]`);
    assert.ok(v >= prev, `not monotonic at t=${i / 100}: ${v} < ${prev}`);
    prev = v;
  }
});

test('easeOutQuint front-loads progress (ease-OUT shape)', () => {
  // At the halfway point an ease-out curve should already be well past 50%.
  assert.ok(easeOutQuint(0.5) > 0.9, `expected >0.9 at midpoint, got ${easeOutQuint(0.5)}`);
});

test('widthAt hits both endpoints exactly', () => {
  assert.equal(widthAt(600, 780, 0), 600);
  assert.equal(widthAt(600, 780, OVERLAY_RESIZE_DURATION_MS), 780);
});

test('widthAt clamps elapsed beyond duration to target', () => {
  assert.equal(widthAt(600, 780, OVERLAY_RESIZE_DURATION_MS * 2), 780);
  assert.equal(widthAt(600, 780, -100), 600);
});

test('widthAt stays inside the [from,to] envelope for collapse too', () => {
  // Shrinking (780 -> 600): monotonic, never below 600, never above 780.
  for (let ms = 0; ms <= OVERLAY_RESIZE_DURATION_MS; ms += 8) {
    const w = widthAt(780, 600, ms);
    assert.ok(w >= 600 && w <= 780, `width ${w} at ${ms}ms escaped envelope`);
  }
});

test('widthAt never produces a value outside endpoints (no native snap-back)', () => {
  const lo = Math.min(600, 780);
  const hi = Math.max(600, 780);
  for (let ms = 0; ms <= OVERLAY_RESIZE_DURATION_MS; ms += 4) {
    const w = widthAt(600, 780, ms);
    assert.ok(w >= lo && w <= hi, `overshoot/undershoot ${w} at ${ms}ms`);
  }
});

test('widthAt with zero duration jumps to target', () => {
  assert.equal(widthAt(600, 780, 0, 0), 780);
});

test('isResizeComplete boundary', () => {
  assert.equal(isResizeComplete(OVERLAY_RESIZE_DURATION_MS - 1), false);
  assert.equal(isResizeComplete(OVERLAY_RESIZE_DURATION_MS), true);
  assert.equal(isResizeComplete(OVERLAY_RESIZE_DURATION_MS + 50), true);
});
