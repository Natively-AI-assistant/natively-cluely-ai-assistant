// The overlay's click-through gate must not be able to stay shut over the panel.
//
// While the pointer is over a transparent part of the overlay window, the
// window is click-through (setIgnoreMouseEvents(true, { forward: true })), so
// clicks reach the app underneath. It becomes clickable again only when the
// overlay's page sees a mouse MOVE over the panel and tells main.
//
// There is not always a move. The panel can come under a pointer that is not
// moving: it widens, an answer grows it downward, the overlay is repositioned.
// The gate then stays shut over the panel, and a click made without moving
// first goes to the app behind. Measured 2026-10-05 on a macOS dev build: with
// the gate shut, the overlay was moved so a resting pointer sat over the
// panel. No mouse move reopened the gate within the grace period; the probe
// did, about 100 ms after the move, and logged it. (How long the gate would
// have stayed shut without the probe was not captured: the pointer was in use
// on every later attempt.)
//
// On Windows the moves themselves are a second risk: `forward: true` is a
// low-level mouse hook on the app's main thread (Electron 43,
// native_window_views_win.cc), and Windows silently removes a low-level hook
// whose thread answers too slowly. Read from the source and Microsoft's
// documentation; not reproduced.
//
// So main does not rely on a move. While the gate is shut and the pointer is
// inside the overlay window's rectangle, main tells the page where the pointer
// is ten times a second, and the page answers with the same hit-test it runs
// on a mouse move. The page stays the only judge of what is panel and what is
// margin. A reopen the probe had to make is logged with how long ago the page
// last saw a move.
//
// The page also keeps its own copy of the verdict and reports only changes, so
// main's reset on every show has to reset that copy too. Measured the same
// day, real pointer outside the window: gate shut, overlay hidden and shown,
// then a move over a margin. Without the reset main heard nothing (the margin
// stayed clickable and swallowed clicks); with it main heard "margin" and the
// window went click-through again.
//
// Nothing here branches on the platform. Not executed on Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { blockFrom, methodBody, readSource, repoRoot, restOfBlocks } from './_sourceSlices.mjs';

const require = createRequire(import.meta.url);
const { shouldProbeHover, hoverProbePoint, HOVER_PROBE_INTERVAL_MS } = require(
  path.join(repoRoot, 'dist-electron/electron/utils/overlayHoverProbe.js'),
);

const SHUT = { visible: true, passthrough: false, hoverInteractive: false, forwardSupported: true };

test('the probe runs while the gate is shut on a visible overlay', () => {
  assert.equal(shouldProbeHover(SHUT), true);
});

test('it does not run when the gate is open, the overlay is hidden, or the user chose click-through', () => {
  assert.equal(shouldProbeHover({ ...SHUT, hoverInteractive: true }), false);
  assert.equal(shouldProbeHover({ ...SHUT, visible: false }), false);
  assert.equal(shouldProbeHover({ ...SHUT, passthrough: true }), false, 'stealth passthrough is meant to stay click-through');
  assert.equal(shouldProbeHover({ ...SHUT, forwardSupported: false }), false, 'no hover gate where forward is unsupported');
});

test('a pointer inside the window is reported in window coordinates', () => {
  assert.deepEqual(hoverProbePoint({ x: 500, y: 300 }, { x: 369, y: 117, width: 732, height: 330 }), { x: 131, y: 183 });
});

test('a pointer outside the window is not reported at all', () => {
  const bounds = { x: 369, y: 117, width: 732, height: 330 };
  for (const cursor of [{ x: 368, y: 200 }, { x: 1101, y: 200 }, { x: 500, y: 116 }, { x: 500, y: 447 }]) {
    assert.equal(hoverProbePoint(cursor, bounds), null, JSON.stringify(cursor));
  }
});

test('a display left of or above the primary one (negative origin) still maps', () => {
  assert.deepEqual(hoverProbePoint({ x: -900, y: -40 }, { x: -1200, y: -100, width: 732, height: 300 }), { x: 300, y: 60 });
});

test('the probe is frequent enough to beat a click, and not a per-frame timer', () => {
  assert.ok(HOVER_PROBE_INTERVAL_MS >= 50 && HOVER_PROBE_INTERVAL_MS <= 200);
});

// ── Wiring ──

const helper = readSource('electron/WindowHelper.ts');

test('main starts and stops the probe from the one place the gate changes', () => {
  assert.match(methodBody(helper, 'syncOverlayInteractionPolicy'), /this\.syncHoverProbe\(\)/);
  const sync = methodBody(helper, 'syncHoverProbe');
  assert.match(sync, /shouldProbeHover\(/);
  assert.match(sync, /clearInterval\(this\.hoverProbeTimer\)/, 'stopped as soon as the gate opens');
});

test('each tick re-checks the conditions, so a hidden or destroyed overlay ends the timer', () => {
  const tick = methodBody(helper, 'probeOverlayHover');
  assert.match(tick, /this\.syncHoverProbe\(\)/);
  assert.match(tick, /hoverProbePoint\(screen\.getCursorScreenPoint\(\), overlay\.getBounds\(\)\)/);
  assert.match(tick, /webContents\.send\('overlay-hover-probe', point\)/);
});

test('a gate reopened by the probe is logged, with how long the page had seen no move', () => {
  const set = methodBody(helper, 'setOverlayHoverInteractive');
  assert.match(set, /source === 'probe'/);
  assert.match(set, /console\.warn\(/);
  assert.match(set, /idleMs/);
  const handler = blockFrom(readSource('electron/ipcHandlers.ts'), "safeHandle('overlay-hover-interactive'");
  assert.match(handler, /setOverlayHoverInteractive\(!!interactive, source === 'probe' \? 'probe' : undefined, idleMs\)/);
});

const ui = readSource('src/components/NativelyInterface.tsx');
// The hover-gate effect: from its handshake to the end of its cleanup.
const gate = restOfBlocks(ui, ui.indexOf('let interactive = true;'), 1);
const probe = gate.slice(gate.indexOf('onOverlayHoverProbe'), gate.indexOf('return () => {'));

test('the page answers a probe with its own hit-test, and only to open the gate', () => {
  assert.ok(probe.length > 0);
  assert.match(probe, /if \(isResizingRef\.current\) return/, 'a resize drag owns the window');
  assert.match(probe, /pointerOverPanel\(point, contentRef\.current\?\.getBoundingClientRect\(\) \?\? null, PAD\)/, 'the same hit-test as a mouse move');
  assert.match(probe, /if \(!inside\) return/, 'a probe never shuts the gate: only a real mouse move over a margin does');
  assert.match(probe, /setOverlayHoverInteractive\?\.\(true, 'probe', idleMs\)/);
  assert.doesNotMatch(probe, /setOverlayHoverInteractive\?\.\(false/);
});

test('a real mouse move gets the first chance, so an ordinary entry is not logged as a recovery', () => {
  assert.match(probe, /window\.setTimeout\(\(\) => \{[^]*if \(interactive \|\| isResizingRef\.current\) return;[^]*\}, OVERLAY_HOVER_PROBE_GRACE_MS\)/);
  assert.match(gate, /window\.clearTimeout\(probeTimer\)/, 'the timer does not outlive the effect');
});

// ── The page's copy of the verdict is reset whenever main resets its own ──

test('main tells the page when it resets the gate on show', () => {
  const show = restOfBlocks(helper, helper.indexOf("this.overlayWindow.on('show'"), 1);
  const reset = show.indexOf('this.overlayHoverInteractive = true');
  const told = show.indexOf("webContents.send('overlay-hover-reset')");
  assert.ok(reset !== -1 && told !== -1, 'a page left at "margin" reports nothing for a pointer still over a margin');
});

test('the page takes the reset, and nothing else touches its copy from outside', () => {
  assert.match(gate, /onOverlayHoverReset\?\.\(\(\) => \{\s*interactive = true;\s*\}\)/);
  assert.match(gate, /unsubscribeReset\?\.\(\)/);
  assert.match(readSource('electron/preload.ts'), /ipcRenderer\.on\('overlay-hover-reset', subscription\)/);
});
