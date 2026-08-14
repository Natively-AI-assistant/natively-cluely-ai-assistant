// Launcher maximize/restore animation math.
//
// The animation replaces the OS maximize transition, which composites badly on
// a `transparent: true` (layered) window. These pin the curve and the frame
// interpolation; the cadence itself is measured, not asserted (see the comment
// on the 8ms poll in WindowHelper.animateLauncherBounds).
//
// Platform-independent by construction: pure math, no electron import.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const {
  LAUNCHER_EXPAND_DURATION_MS,
  LAUNCHER_CONTRACT_DURATION_MS,
  LAUNCHER_RESIZE_EASE,
  easeLauncherResize,
  interpolateBounds,
  isLauncherResizeComplete,
} = require(path.join(repoRoot, 'dist-electron/electron/utils/launcherResizeAnimation.js'));

const FROM = { x: 100, y: 100, width: 1200, height: 800 };
const TO = { x: 0, y: 0, width: 1536, height: 864 };

test('the curve is the Material 3 "emphasized" token', () => {
  // md.sys.motion.easing.emphasized = cubic-bezier(0.2, 0, 0, 1). Material
  // specifies it for a surface that TRANSFORMS while staying on screen, which
  // is what a window growing to fill the display is. Accelerate curves are for
  // elements LEAVING the screen — using one here would end the motion at speed
  // instead of settling.
  assert.deepEqual(LAUNCHER_RESIZE_EASE, [0.2, 0, 0, 1]);
});

test('durations are Fluent 2 tokens, with the reverse direction quicker', () => {
  // Fluent durationSlow / durationGentle. Fluent's rule is "give larger
  // elements more time", and a window crossing the screen is the largest thing
  // this app moves — hence the slow end of the scale, not the 150-200ms used
  // for controls.
  assert.equal(LAUNCHER_EXPAND_DURATION_MS, 300);
  assert.equal(LAUNCHER_CONTRACT_DURATION_MS, 250);
  assert.ok(
    LAUNCHER_CONTRACT_DURATION_MS < LAUNCHER_EXPAND_DURATION_MS,
    'BUG: both Fluent and Material make the reverse direction quicker than the forward one.',
  );
});

test('easing is pinned at both ends and never overshoots', () => {
  assert.equal(easeLauncherResize(0), 0);
  assert.equal(easeLauncherResize(1), 1);
  // Out-of-range input clamps instead of extrapolating: a late timer tick can
  // produce t > 1, and an overshoot there would be a visible snap-back.
  assert.equal(easeLauncherResize(-0.5), 0);
  assert.equal(easeLauncherResize(1.5), 1);
  for (let i = 0; i <= 20; i++) {
    const v = easeLauncherResize(i / 20);
    assert.ok(v >= 0 && v <= 1, `eased ${v} out of range at t=${i / 20}`);
  }
});

test('easing is monotonic — the window never moves backwards mid-animation', () => {
  let prev = -Infinity;
  for (let i = 0; i <= 100; i++) {
    const v = easeLauncherResize(i / 100);
    assert.ok(v >= prev, `non-monotonic at t=${i / 100}: ${v} < ${prev}`);
    prev = v;
  }
});

test('easing decelerates — most of the distance is covered early', () => {
  // An ease-OUT curve: past the halfway point in time, well past it in space.
  // If this ever inverts, the motion reads as sluggish-then-snappy.
  assert.ok(
    easeLauncherResize(0.5) > 0.5,
    `expected ease-out, got ${easeLauncherResize(0.5)} at the midpoint`,
  );
});

test('interpolateBounds hits both endpoints exactly', () => {
  assert.deepEqual(interpolateBounds(FROM, TO, 0), FROM);
  assert.deepEqual(interpolateBounds(FROM, TO, 1), TO);
  // Landing exactly on the target matters: a fractional pixel short leaves a
  // gap at the screen edge on maximize.
  assert.deepEqual(interpolateBounds(FROM, TO, 1.2), TO);
  assert.deepEqual(interpolateBounds(FROM, TO, -0.2), FROM);
});

test('interpolateBounds returns whole pixels and stays within the endpoints', () => {
  for (let i = 0; i <= 20; i++) {
    const b = interpolateBounds(FROM, TO, i / 20);
    for (const k of ['x', 'y', 'width', 'height']) {
      assert.ok(Number.isInteger(b[k]), `${k}=${b[k]} is not an integer — setBounds needs integers`);
    }
    assert.ok(b.width >= FROM.width && b.width <= TO.width, `width ${b.width} outside endpoints`);
    assert.ok(b.height >= FROM.height && b.height <= TO.height, `height ${b.height} outside endpoints`);
  }
});

test('interpolateBounds animates position as well as size', () => {
  // Filling the work area moves the origin too; interpolating only the size
  // would make the window grow from a fixed corner and then jump.
  const mid = interpolateBounds(FROM, TO, 0.5);
  assert.ok(mid.x < FROM.x && mid.x > TO.x, `x did not travel: ${mid.x}`);
  assert.ok(mid.y < FROM.y && mid.y > TO.y, `y did not travel: ${mid.y}`);
});

test('completion is time-based, so a dropped frame cannot extend the animation', () => {
  assert.equal(isLauncherResizeComplete(0), false);
  assert.equal(isLauncherResizeComplete(LAUNCHER_EXPAND_DURATION_MS - 1), false);
  assert.equal(isLauncherResizeComplete(LAUNCHER_EXPAND_DURATION_MS), true);
  // A tick that arrives very late still ends the animation.
  assert.equal(isLauncherResizeComplete(LAUNCHER_EXPAND_DURATION_MS * 3), true);
  // The contract direction is shorter, so it must be honoured explicitly.
  assert.equal(isLauncherResizeComplete(260, LAUNCHER_CONTRACT_DURATION_MS), true);
  assert.equal(isLauncherResizeComplete(260, LAUNCHER_EXPAND_DURATION_MS), false);
});

test('durations stay inside the platform-standard range', () => {
  // Fluent's scale tops out at durationUltraSlow (500ms); Material's full-screen
  // expand is 500ms but is calibrated for phone travel and touch. Anything past
  // 400ms on desktop reads as sluggish beside the OS's own window animations.
  for (const ms of [LAUNCHER_EXPAND_DURATION_MS, LAUNCHER_CONTRACT_DURATION_MS]) {
    assert.ok(ms >= 200 && ms <= 400, `${ms}ms is outside the desktop-standard range`);
  }
});

// ── Source assertions: the wiring ───────────────────────────────────────────

const windowHelperSource = fs.readFileSync(
  path.join(repoRoot, 'electron/WindowHelper.ts'),
  'utf8',
);

test('maximize and restore both go through the animation', () => {
  const maximizeBody = windowHelperSource.slice(
    windowHelperSource.indexOf('public maximizeWindow('),
    windowHelperSource.indexOf('  // Smoothly expands/contracts the launcher'),
  );
  assert.match(
    maximizeBody,
    /LAUNCHER_EXPAND_DURATION_MS/,
    'BUG: expanding must use the longer (forward) duration.',
  );
  assert.match(
    maximizeBody,
    /LAUNCHER_CONTRACT_DURATION_MS/,
    'BUG: contracting must use the shorter (reverse) duration.',
  );
  const calls = maximizeBody.match(/this\.animateLauncherBounds\(/g) ?? [];
  assert.equal(
    calls.length,
    2,
    'BUG: both directions must animate — a snapping restore next to an animated maximize is the ' +
      'asymmetry that reads as broken.',
  );
});

test('per-frame bookkeeping is suppressed while the animation drives the frame', () => {
  // ~14 resize events in 220ms. Running the settings reposition, bounds tracking
  // and ratio enforcement on each is what turns a smooth resize into a stutter.
  assert.match(
    windowHelperSource,
    /on\('resize'[\s\S]{0,600}if \(this\.launcherAnimating\) return;/,
    'BUG: the resize listener must stand down during our own animation.',
  );
  assert.match(
    windowHelperSource,
    /on\('move'[\s\S]{0,200}if \(this\.launcherAnimating\) return;/,
    'BUG: the move listener must stand down too — filling the work area moves the origin on ' +
      'every frame.',
  );
});

test('the animation timer is always cleaned up', () => {
  const animBody = windowHelperSource.slice(
    windowHelperSource.indexOf('private animateLauncherBounds('),
    windowHelperSource.indexOf('  // BISECT ONLY'),
  );
  assert.match(
    animBody,
    /this\.cancelLauncherResizeAnimation\(\);/,
    'BUG: starting an animation must cancel any in-flight one, or two timers fight over bounds.',
  );
  assert.match(
    animBody,
    /if \(!w \|\| w\.isDestroyed\(\)\)/,
    'BUG: the tick must survive the window being destroyed mid-animation.',
  );
  assert.match(
    windowHelperSource,
    /on\('closed'[\s\S]{0,400}this\.cancelLauncherResizeAnimation\(\)/,
    'BUG: a window closed mid-animation must not leave an interval running against it.',
  );
});

test('the OS reduce-motion setting is honoured', () => {
  // Required by both Fluent and Material. shouldRenderRichAnimation also covers
  // remote desktop, where animating a window frame pushes a full repaint per
  // frame over the wire.
  assert.match(
    windowHelperSource,
    /systemPreferences\.getAnimationSettings\(\)/,
    'BUG: the animation must check the OS animation settings.',
  );
  assert.match(
    windowHelperSource,
    /settings\.shouldRenderRichAnimation && !settings\.prefersReducedMotion/,
    'BUG: both signals matter — prefersReducedMotion is the accessibility setting, ' +
      'shouldRenderRichAnimation additionally covers remote sessions.',
  );
  assert.match(
    windowHelperSource,
    /if \(duration <= 0 \|\| !this\.shouldAnimateLauncherResize\(\)\) \{[\s\S]{0,80}win\.setBounds\(target\);/,
    'BUG: with motion reduced the window must still reach the target — instantly, not not-at-all.',
  );
});
