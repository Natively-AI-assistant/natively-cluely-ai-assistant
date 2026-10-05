// Windows: the pill and the resize toggle must stay above the overlay.
//
// On Windows the three are separate always-on-top windows of the same band, so
// which one is in front is decided by whichever was raised last. The overlay
// is raised again and again on purpose: setAlwaysOnTop(true, 'screen-saver')
// on blur, before every show, and after an interrupted switch, to climb back
// over a screen-share surface. Nothing raised the pill or the toggle after
// it, and showInactive() keeps whatever z-order slot a window had while hidden
// (the cropper needed moveTop() for the same reason, issue #518).
//
// The toggle hangs over the overlay's top-right corner: its 36px window
// overlaps the overlay's rectangle by 16px, and the lower-left part of its
// button lies inside the area where the overlay takes clicks. With the overlay
// in front, a click there lands on the overlay's transparent gutter and does
// nothing. The pill overlaps the same way when it is clamped under the top of
// the screen.
//
// macOS is not affected and is left alone: the pill and toggle are child
// windows of the overlay there, and AppKit keeps children above their parent.
//
// Both platform branches run below on any OS (the platform is a parameter).
// The z-order itself was not observed on a Windows machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { methodBody, readSource, repoRoot, restOfBlocks } from './_sourceSlices.mjs';

const require = createRequire(import.meta.url);
const { raiseAboveOverlay } = require(path.join(repoRoot, 'dist-electron/electron/utils/overlayStackOrder.js'));

function fakeWindow({ visible = true, destroyed = false, throws = false } = {}) {
  const win = {
    raised: 0,
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    moveTop() {
      if (throws) throw new Error('moveTop failed');
      win.raised++;
    },
  };
  return win;
}

test('win32: every visible aux window is raised, in the order given', () => {
  const order = [];
  const pill = fakeWindow();
  const toggle = fakeWindow();
  pill.moveTop = () => order.push('pill');
  toggle.moveTop = () => order.push('toggle');
  assert.equal(raiseAboveOverlay([pill, toggle], 'win32'), 2);
  assert.deepEqual(order, ['pill', 'toggle']);
});

test('win32: a hidden window is left alone (moveTop would show it)', () => {
  const hiddenToggle = fakeWindow({ visible: false });
  assert.equal(raiseAboveOverlay([hiddenToggle], 'win32'), 0);
  assert.equal(hiddenToggle.raised, 0, 'the toggle is hidden on purpose while the overlay has no content');
});

test('win32: missing and destroyed windows are skipped, a throwing one does not stop the rest', () => {
  const pill = fakeWindow({ throws: true });
  const toggle = fakeWindow();
  assert.equal(raiseAboveOverlay([null, undefined, fakeWindow({ destroyed: true }), pill, toggle], 'win32'), 1);
  assert.equal(toggle.raised, 1);
});

test('darwin: nothing is raised (child windows already sit above the overlay)', () => {
  const pill = fakeWindow();
  assert.equal(raiseAboveOverlay([pill], 'darwin'), 0);
  assert.equal(pill.raised, 0);
});

test('linux: nothing is raised (the overlay is never re-raised there either)', () => {
  const pill = fakeWindow();
  assert.equal(raiseAboveOverlay([pill], 'linux'), 0);
  assert.equal(pill.raised, 0);
});

// ── Wiring: whatever raises the overlay on a live group raises the aux windows after it ──

const helper = readSource('electron/WindowHelper.ts');

test('showing the aux windows raises them, after they are shown', () => {
  const body = methodBody(helper, 'applyOverlayAuxVisibility');
  const raised = body.indexOf('this.raiseOverlayAuxWindows()');
  assert.ok(raised !== -1, 'showInactive() keeps the stale z-order slot');
  assert.ok(raised > body.lastIndexOf('apply(this.toggleWindow'));
});

test('EVERY re-assert of the overlay level is followed by an aux raise', () => {
  // Enumerated, not listed: a re-assert added later must not be able to skip
  // this. The one at creation is exempt (no aux windows exist yet).
  const sites = [...helper.matchAll(/(?:this\.overlayWindow|overlay)\.setAlwaysOnTop\(true, 'screen-saver'\)/g)];
  const creation = helper.indexOf("this.overlayWindow.loadURL(`${startUrl}?window=overlay`)");
  const live = sites.filter((m) => m.index > creation);
  assert.equal(sites.length - live.length, 1, 'exactly one re-assert belongs to window creation');
  assert.ok(live.length >= 5, `expected the blur, showOverlay, both switchToOverlay and the shield-flush sites, found ${live.length}`);
  for (const site of live) {
    // Same block, or the rest of the block around it (the `if (win32)` wrapper
    // followed by the show and the aux show). Never beyond: a timer callback
    // must raise inside the callback.
    const after = restOfBlocks(helper, site.index, 2);
    assert.match(
      after,
      /this\.raiseOverlayAuxWindows\(\)|this\.applyOverlayAuxVisibility\(true\)/,
      `no aux raise after the re-assert at offset ${site.index}: ${helper.slice(site.index - 120, site.index + 60)}`,
    );
  }
});

test('an activated overlay (no no-activate policy) raises them too', () => {
  const blur = restOfBlocks(helper, helper.indexOf("this.overlayWindow.on('blur'"), 1);
  assert.match(blur, /this\.overlayWindow\.on\('focus', \(\) => this\.raiseOverlayAuxWindows\(\)\)/);
});

test('only the pill and the toggle are raised: the popovers are owned by the overlay and follow it', () => {
  const body = methodBody(helper, 'raiseOverlayAuxWindows');
  assert.match(body, /raiseAboveOverlay\(\[this\.pillWindow, this\.toggleWindow\]\)/);
});
