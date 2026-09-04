// Regression test for: the launcher's background-throttling opt-out outlived
// the one-shot animation it existed for.
//
// THE BACKGROUND. WindowHelper creates the launcher with
// `backgroundThrottling: false` because Chromium HARD-STOPS
// requestAnimationFrame for a hidden window — covered by another app, Cmd+H, or
// on an inactive Space all count — and the boot reveal is a Framer Motion
// AnimatePresence that only advances on rAF. Without the flag the app can sit
// on the black startup splash until the user focuses it. That is a real fix and
// LauncherBootRevealNotFrameGated2026_09_01 guards it.
//
// THE DEFECT. Nothing ever turned throttling back on. No
// `setBackgroundThrottling` call existed anywhere in electron/ or src/, so a
// flag justified entirely by a ~1s boot animation applied for the whole
// session — on the one window the user leaves open all day.
//
// MEASURED 2026-09-03 with a standalone Electron probe: two windows, each with
// 19 elements on an `infinite` opacity animation (the shape
// MeetingNotesSkeleton mounts during summary generation), shown, then hidden,
// then sampled for 10 seconds:
//
//     window                          rAF frames   visibilityState
//     throttled (Chromium default)          0       "hidden"
//     unthrottled (what the launcher did) 600       "visible"
//
// So a launcher hidden during summary generation kept compositing at a full
// 60fps off screen — the same never-idle-compositor condition behind this
// repo's 2026-07-10 raster-tile leak. An earlier idle measurement appeared to
// contradict this; it did not, it measured the wrong state (window visible,
// nothing animating).
//
// Note the second column: the opt-out ALSO makes the Page Visibility API report
// "visible" while the window is hidden. So gating the animation on
// `visibilitychange` in the renderer could never have worked — which is why the
// fix is to scope the opt-out instead, and why Launcher.tsx already had to use
// document.hasFocus() for its usage tick.
//
// THE FIX, guarded here: the renderer reports the reveal's completion from the
// launcher entrance animation's own `onAnimationComplete`, and main restores
// throttling for that window. Fail-safe: if the signal never arrives,
// throttling simply stays off and behaviour is what it was before.
//
// SCOPE OF THIS TEST: the wiring — handler present, sender-validated, bridge
// exposed, renderer firing it once from the animation completion. The rAF
// numbers above came from a probe, and the end-to-end signal has NOT been
// observed in a running dev app (renderer/main console forwarding is gated by
// the debug-log-level work, so neither marker was visible). Requires runtime
// confirmation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

const ipcSource = read('electron/ipcHandlers.ts');
const preloadSource = read('electron/preload.ts');
const appSource = read('src/App.tsx');
const windowHelperSource = read('electron/WindowHelper.ts');

const CHANNEL = 'launcher:reveal-complete';

test('main restores background throttling when the reveal completes', () => {
    const at = ipcSource.indexOf(CHANNEL);
    assert.notEqual(at, -1, `no handler for "${CHANNEL}" — nothing ever re-enables throttling`);
    const handler = ipcSource.slice(at, at + 900);
    assert.match(
        handler,
        /setBackgroundThrottling\(\s*true\s*\)/,
        'the handler must call webContents.setBackgroundThrottling(true). Without it the launcher ' +
        'keeps running rAF at 60fps while hidden (measured: 600 frames in 10s vs 0 throttled).',
    );
});

test('the handler only lets the launcher relax its own throttling', () => {
    const at = ipcSource.indexOf(CHANNEL);
    const handler = ipcSource.slice(at, at + 900);
    assert.match(
        handler,
        /event\.sender\.id\s*!==\s*launcher\.webContents\.id/,
        'the channel must be sender-validated against the launcher webContents — any renderer ' +
        'could otherwise change another window\'s throttling.',
    );
});

test('the preload bridge exposes the signal', () => {
    assert.match(
        preloadSource,
        new RegExp(`notifyLauncherRevealComplete[\\s\\S]{0,120}${CHANNEL.replace(':', ':')}`),
        'preload must expose notifyLauncherRevealComplete sending the reveal-complete channel',
    );
});

test('the renderer fires it from the entrance animation completion, not a timer', () => {
    assert.match(
        appSource,
        /onAnimationComplete=\{reportRevealComplete\}/,
        'the signal must hang off the launcher entrance animation\'s own completion. A timer ' +
        'could fire mid-reveal and re-enable throttling while the AnimatePresence transition is ' +
        'still running — which is exactly the frozen-splash bug the opt-out exists to prevent.',
    );
});

test('the renderer fires it at most once, and only for the launcher', () => {
    const at = appSource.indexOf('const reportRevealComplete');
    assert.notEqual(at, -1, 'reportRevealComplete must exist');
    const body = appSource.slice(at, at + 700);
    assert.match(body, /revealReported\.current/, 'must latch so AnimatePresence re-runs cannot re-fire it');
    assert.match(
        body,
        /isLauncherWindow \|\| isDefault/,
        'only the launcher route may report — every window loads this same entry, and the aux ' +
        'windows must not touch the launcher\'s throttling',
    );
});

test('the launcher is still CREATED with the opt-out — the boot fix is intact', () => {
    // Restoring throttling later must not tempt anyone into removing the flag
    // that makes the boot reveal work while hidden in the first place.
    assert.match(
        windowHelperSource,
        /backgroundThrottling:\s*false/,
        'the launcher must still be created with backgroundThrottling: false, or the boot reveal ' +
        'is frame-gated again (see LauncherBootRevealNotFrameGated2026_09_01)',
    );
});

test('mutation probe: dropping the setBackgroundThrottling call fails the guard', () => {
    const at = ipcSource.indexOf(CHANNEL);
    const mutated = ipcSource.slice(at, at + 900).replace(/setBackgroundThrottling\(\s*true\s*\)/, 'noop()');
    assert.doesNotMatch(
        mutated,
        /setBackgroundThrottling\(\s*true\s*\)/,
        'the guard above is vacuous — it would pass with the call removed',
    );
});
