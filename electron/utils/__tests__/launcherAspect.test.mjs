// Launcher 3:2 aspect-ratio contract.
//
// The lock has two halves:
//   1. Native: BrowserWindow.setAspectRatio(3/2) constrains USER drags.
//   2. Pure math (this file): every size THIS process picks — default size,
//      min size, the "maximize" zoom box, and any programmatic resize — must
//      already be 3:2, because Electron does not apply setAspectRatio to
//      programmatic setBounds/setSize.
//
// Platform-independent by construction: no process.platform, no electron
// import, so both platform branches are covered on either OS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const {
  LAUNCHER_ASPECT_RATIO,
  LAUNCHER_DEFAULT_WIDTH,
  LAUNCHER_DEFAULT_HEIGHT,
  LAUNCHER_MIN_WIDTH,
  LAUNCHER_MIN_HEIGHT,
  fitToAspectRatio,
  clampSizeToAspectRatio,
  zoomedLauncherBounds,
} = require(path.join(repoRoot, 'dist-electron/electron/utils/launcherAspect.js'));

const ratioOf = (w, h) => w / h;
const isThreeTwo = (w, h, tol = 0.01) =>
  Math.abs(ratioOf(w, h) - LAUNCHER_ASPECT_RATIO) <= tol;

test('the locked ratio is 3:2', () => {
  assert.equal(LAUNCHER_ASPECT_RATIO, 1.5);
});

test('1200x800 is both the default AND the minimum — the launcher only scales up', () => {
  assert.equal(LAUNCHER_DEFAULT_WIDTH, 1200);
  assert.equal(LAUNCHER_DEFAULT_HEIGHT, 800);
  assert.equal(LAUNCHER_MIN_WIDTH, 1200);
  assert.equal(LAUNCHER_MIN_HEIGHT, 800);
  assert.ok(isThreeTwo(LAUNCHER_DEFAULT_WIDTH, LAUNCHER_DEFAULT_HEIGHT));
  // A non-3:2 minimum would fight the native lock at the smallest corner drag.
  assert.ok(isThreeTwo(LAUNCHER_MIN_WIDTH, LAUNCHER_MIN_HEIGHT));
});

test('fitToAspectRatio is height-limited on a wide box', () => {
  // 1920x1032 work area (typical 1080p minus taskbar): 1032*1.5 = 1548 <= 1920.
  const box = fitToAspectRatio(1920, 1032);
  assert.deepEqual(box, { width: 1548, height: 1032 });
  assert.ok(isThreeTwo(box.width, box.height));
});

test('fitToAspectRatio is width-limited on a tall box', () => {
  // Portrait / rotated display: width is the binding constraint.
  const box = fitToAspectRatio(1080, 1800);
  assert.deepEqual(box, { width: 1080, height: 720 });
  assert.ok(isThreeTwo(box.width, box.height));
});

test('fitToAspectRatio never exceeds the available box', () => {
  const cases = [
    [1920, 1032],
    [1080, 1800],
    [2560, 1440],
    [1366, 728],
    [3840, 2160],
    [800, 600],
  ];
  for (const [w, h] of cases) {
    const box = fitToAspectRatio(w, h);
    assert.ok(box.width <= w, `width ${box.width} > available ${w}`);
    assert.ok(box.height <= h, `height ${box.height} > available ${h}`);
    assert.ok(isThreeTwo(box.width, box.height), `${box.width}x${box.height} is not 3:2`);
  }
});

test('clampSizeToAspectRatio pulls an off-ratio programmatic request back onto 3:2', () => {
  // A 16:9-ish request must not produce a 16:9 window.
  const locked = clampSizeToAspectRatio(1600, 900);
  assert.ok(isThreeTwo(locked.width, locked.height));
  assert.ok(locked.width <= 1600 && locked.height <= 900);
  // Already-3:2 requests pass through untouched.
  assert.deepEqual(clampSizeToAspectRatio(1200, 800), { width: 1200, height: 800 });
});

test('zoomedLauncherBounds fills the work area with the largest centered 3:2 box', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
  const bounds = zoomedLauncherBounds(workArea);
  assert.ok(isThreeTwo(bounds.width, bounds.height));
  assert.equal(bounds.height, 1032); // height-limited: touches top and bottom
  assert.equal(bounds.width, 1548);
  assert.equal(bounds.x, Math.round((1920 - 1548) / 2));
  assert.equal(bounds.y, 0);
});

test('zoomedLauncherBounds honours a non-zero work area origin (secondary display)', () => {
  // Second monitor to the right, with a top menu bar / taskbar offset.
  const workArea = { x: 1920, y: 25, width: 2560, height: 1415 };
  const bounds = zoomedLauncherBounds(workArea);
  assert.ok(isThreeTwo(bounds.width, bounds.height));
  assert.ok(bounds.x >= workArea.x, 'zoom box must start inside the work area');
  assert.ok(bounds.y >= workArea.y, 'zoom box must not overlap the menu bar/taskbar');
  assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width);
  assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height);
});

test('zoomedLauncherBounds never returns a box below the 1200x800 minimum', () => {
  // Work area smaller than the minimum (small laptop / scaled display): the
  // floor wins, so the window can be larger than the work area rather than
  // shrinking below the product minimum.
  const bounds = zoomedLauncherBounds({ x: 0, y: 0, width: 1024, height: 640 });
  assert.equal(bounds.width, LAUNCHER_MIN_WIDTH);
  assert.equal(bounds.height, LAUNCHER_MIN_HEIGHT);
  assert.ok(isThreeTwo(bounds.width, bounds.height));
});

// ── Source assertions: the native half of the lock ──────────────────────────
// The math above is worthless if createWindow stops applying the ratio to the
// actual BrowserWindow, so pin the wiring too.

const windowHelperSource = fs.readFileSync(
  path.join(repoRoot, 'electron/WindowHelper.ts'),
  'utf8',
);

test('createWindow applies the native aspect lock via the shared constant', () => {
  assert.match(
    windowHelperSource,
    /this\.setLauncherAspectLock\(true\)/,
    'BUG: createWindow must arm the aspect lock — without it, user drags are unconstrained and ' +
      'the 3:2 lock only exists on paper.',
  );
  assert.match(
    windowHelperSource,
    /setAspectRatio\(enabled \? LAUNCHER_ASPECT_RATIO : 0\)/,
    "BUG: the lock helper must apply the shared constant (and Electron's documented 0 to clear).",
  );
  assert.match(
    windowHelperSource,
    /minWidth:\s*LAUNCHER_MIN_WIDTH[\s\S]{0,160}minHeight:\s*LAUNCHER_MIN_HEIGHT/,
    'BUG: min size must come from the 3:2-derived constants; a hand-typed non-3:2 minimum ' +
      'fights the aspect lock at the smallest corner drag.',
  );
});

test('the in-app maximize button is the ONE sanctioned exemption from 3:2', () => {
  const maximizeBody = windowHelperSource.slice(
    windowHelperSource.indexOf('public maximizeWindow('),
    windowHelperSource.indexOf('  // Smoothly expands/contracts the launcher'),
  );
  assert.ok(maximizeBody.length > 0, 'maximizeWindow() not found');
  assert.match(
    maximizeBody,
    /animateLauncherBounds\([\s\S]{0,40}this\.getDisplayWorkArea\(/,
    "BUG: the maximize button must fill the work area at the display's own shape — that is the " +
      'one deliberate exception to the 3:2 lock.',
  );
  assert.match(
    maximizeBody,
    /this\.launcherFilled = true/,
    'BUG: the fill is a setBounds, so the OS has no "maximized" state to read back — the flag is ' +
      'the only record of it.',
  );
});

test('maximize/restore must NOT use native maximize (it flickers on a transparent window)', () => {
  // MEASURED/OBSERVED on Windows 11: this launcher is `transparent: true` and
  // frameless. Windows composites the animated maximize/restore of a layered
  // window badly — the transition visibly flickers and glitches. A single
  // setBounds changes the frame in one step with no OS transition to glitch.
  const maximizeBody = windowHelperSource.slice(
    windowHelperSource.indexOf('public maximizeWindow('),
    windowHelperSource.indexOf('  // Smoothly expands/contracts the launcher'),
  );
  assert.ok(
    !/win\.maximize\(\)/.test(maximizeBody),
    'BUG: native maximize() re-introduces the flickering OS transition on a transparent frameless ' +
      'window. Fill via setBounds instead.',
  );
  // The one unmaximize() that remains is defensive: leaving an OS-initiated
  // maximized state before filling.
  assert.match(
    maximizeBody,
    /if \(win\.isMaximized\(\)\) win\.unmaximize\(\);/,
    'BUG: an OS-initiated maximize must be unwound first, or the window is both natively ' +
      'maximized and filled.',
  );
});

test('the fill state is reported as "maximized" to the renderer', () => {
  const isMaxBody = windowHelperSource.slice(
    windowHelperSource.indexOf('public isMainWindowMaximized('),
    windowHelperSource.indexOf('public hideMainWindow('),
  );
  assert.match(
    isMaxBody,
    /this\.launcherFilled \|\| this\.launcherZoomed \|\| win\.isMaximized\(\)/,
    'BUG: WindowControls reads this for its restore/maximize icon. A setBounds fill leaves ' +
      'win.isMaximized() false, so omitting the flag shows the wrong icon.',
  );
});

test('the ratio enforcement stands down while the fill is in effect', () => {
  const enforceBody = windowHelperSource.slice(
    windowHelperSource.indexOf('private enforceLauncherAspectRatio('),
    windowHelperSource.indexOf('private emitLauncherMaximizedState('),
  );
  assert.match(
    enforceBody,
    /if \(this\.launcherFilled\) return;/,
    'BUG: without this the enforcement immediately claws the filled window back to 3:2 and the ' +
      'maximize button appears to do nothing.',
  );
});

test('programmatic launcher resizes are normalized to 3:2', () => {
  const setDims = windowHelperSource.slice(
    windowHelperSource.indexOf('public setWindowDimensions('),
    windowHelperSource.indexOf('public setOverlayDimensions('),
  );
  assert.match(
    setDims,
    /clampSizeToAspectRatio\(/,
    'BUG: setWindowDimensions() can target the launcher, and setAspectRatio does not apply to ' +
      'programmatic setBounds — the size must be clamped onto 3:2 here.',
  );
});
