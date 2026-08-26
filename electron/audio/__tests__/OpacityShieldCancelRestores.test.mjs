// Regression test for: the Windows opacity shield stranding windows invisible.
//
// Bug: switchToOverlay/switchToLauncher implement an "opacity shield" on win32 —
// show the window at opacity 0, then restore opacity 1 sixty milliseconds later,
// once DWM has applied the capture-exclusion flag, so the first painted frame
// cannot leak into a screen capture. The restore lives in a single shared
// `this.opacityTimeout`. minimizeWindow() and closeWindow() cancelled that timer
// with a bare `clearTimeout`, dropping the pending restore on the floor: a
// minimize or a close-to-tray landing inside those 60ms left the launcher and/or
// the overlay chrome shown-but-fully-transparent until the next switch happened
// to re-set their opacity.
//
// This widened when the overlay became unconditionally content-protected
// (OverlayAlwaysContentProtected.test.mjs): the win32 shield branch used to be
// gated on `this.contentProtection`, so the stuck state was only reachable in
// undetectable mode. It is now the default Windows overlay-show path.
//
// Fix: cancelOpacityShield() clears the timer AND flushes the restore it was
// going to perform, on every window the shield can zero. Setting opacity 1 on a
// window about to be minimized/closed is harmless; leaving one stuck invisible
// is not. The `isVisible()` guard keeps it from fighting hideMainWindow, which
// deliberately zeroes opacity on win32 before hide() so a capture frame during
// the hide cannot leak the chrome.
//
// Strategy: source-level static check on WindowHelper.ts, same approach as
// SetContentProtectionDedupe.test.mjs and OverlayAlwaysContentProtected.test.mjs
// (the helper instantiates BrowserWindow on import and pulls in Electron
// main-process APIs, so it cannot be cleanly unit-tested in isolation).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const windowHelperPath = path.resolve(__dirname, '../../../electron/WindowHelper.ts');
const source = readFileSync(windowHelperPath, 'utf8');

/** Every window the opacity shield is capable of zeroing. */
const SHIELDED_WINDOWS = [
    'this.launcherWindow',
    'this.overlayWindow',
    'this.pillWindow',
    'this.toggleWindow',
];

/**
 * Extract a method body via brace-balancing from the first match of `sigRe`.
 * Mirrors the extractor in SetContentProtectionDedupe.test.mjs.
 */
function extractMethodBody(src, sigRe, label) {
    const m = sigRe.exec(src);
    assert.ok(m, `could not locate ${label} in WindowHelper`);
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `unbalanced braces while extracting ${label}`);
    return src.slice(start, i - 1);
}

const sigFor = (name, args = '\\s*') =>
    new RegExp(
        `(?:public\\s+|private\\s+|protected\\s+)?${name}\\s*\\(${args}\\)\\s*:\\s*void\\s*\\{`,
    );

const cancelBody = extractMethodBody(source, sigFor('cancelOpacityShield'), 'cancelOpacityShield');
const minimizeBody = extractMethodBody(source, sigFor('minimizeWindow'), 'minimizeWindow');
const closeBody = extractMethodBody(source, sigFor('closeWindow'), 'closeWindow');

test('cancelOpacityShield clears the shared shield timer', () => {
    assert.ok(
        /clearTimeout\s*\(\s*this\.opacityTimeout\s*\)/.test(cancelBody),
        'BUG: cancelOpacityShield no longer clears this.opacityTimeout — a stale restore can ' +
        'now fire onto a window that has since been minimized, hidden or re-shielded.',
    );
    assert.ok(
        /this\.opacityTimeout\s*=\s*null/.test(cancelBody),
        'BUG: cancelOpacityShield does not null this.opacityTimeout after clearing it, so the ' +
        'early-return guard cannot tell "no shield pending" from "shield already cancelled".',
    );
});

test('cancelOpacityShield FLUSHES the restore instead of dropping it', () => {
    assert.ok(
        /setOpacity\s*\(\s*1\s*\)/.test(cancelBody),
        'BUG: cancelOpacityShield clears the shield timer without restoring opacity. That is ' +
        'the original defect: the pending setOpacity(1) is discarded and the shielded windows ' +
        'stay fully transparent until some later switch re-sets them.',
    );
});

for (const win of SHIELDED_WINDOWS) {
    test(`cancelOpacityShield covers ${win}`, () => {
        assert.ok(
            cancelBody.includes(win),
            `BUG: ${win} can be zeroed by the opacity shield (see the win32 branches of ` +
            `switchToOverlay/switchToLauncher and hideMainWindow) but is not restored by ` +
            `cancelOpacityShield, so it can be stranded invisible.`,
        );
    });
}

test('cancelOpacityShield only touches windows that are actually visible', () => {
    // hideMainWindow zeroes opacity on win32 *deliberately* before hide(), so a
    // capture frame during the hide cannot leak the chrome. Restoring opacity on
    // those hidden windows would re-open exactly that leak.
    assert.ok(
        /isVisible\s*\(\s*\)/.test(cancelBody),
        'BUG: cancelOpacityShield restores opacity without an isVisible() guard. hideMainWindow ' +
        'zeroes opacity on purpose before hide() to stop a capture frame leaking the chrome — ' +
        'un-zeroing a hidden window fights that.',
    );
});

for (const [label, body] of [['minimizeWindow', minimizeBody], ['closeWindow', closeBody]]) {
    test(`${label} cancels the shield through cancelOpacityShield, not a bare clearTimeout`, () => {
        assert.ok(
            /this\.cancelOpacityShield\s*\(\s*\)/.test(body),
            `BUG: ${label} does not call cancelOpacityShield().`,
        );
        assert.ok(
            !/clearTimeout\s*\(\s*this\.opacityTimeout\s*\)/.test(body),
            `BUG: ${label} still clears this.opacityTimeout directly. A bare clearTimeout drops ` +
            `the pending opacity restore, stranding the launcher and overlay chrome at opacity 0 ` +
            `when the ${label} lands inside the shield's 60ms window.`,
        );
    });
}

test('the shield timer marks itself spent when it fires', () => {
    // Without this the field holds an already-fired Timeout forever, so
    // cancelOpacityShield()'s "nothing pending" early return never fires — the
    // guard reads as meaningful while every later minimize/close runs a
    // pointless restore pass. Nulling here is what makes that guard real.
    for (const name of ['switchToOverlay', 'switchToLauncher']) {
        const body = extractMethodBody(source, sigFor(name, '[^)]*'), name);
        const callback = extractMethodBody(
            body,
            /this\.opacityTimeout\s*=\s*setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{/,
            `${name}'s opacity-shield callback`,
        );
        assert.ok(
            /this\.opacityTimeout\s*=\s*null/.test(callback),
            `BUG: ${name}'s opacity-shield callback does not null this.opacityTimeout when it ` +
            `fires, leaving a stale non-null Timeout behind. cancelOpacityShield()'s early ` +
            `return then never triggers.`,
        );
    }
});

test('the shield ARM sites still use a bare clearTimeout', () => {
    // The arm sites call setOpacity(0) and *then* clear the previous timer.
    // Routing them through cancelOpacityShield would immediately un-zero the
    // shield they just applied — i.e. reintroduce the first-frame leak the
    // shield exists to prevent. This asserts the asymmetry is intentional.
    for (const name of ['switchToOverlay', 'switchToLauncher']) {
        const body = extractMethodBody(
            source,
            sigFor(name, '[^)]*'),
            name,
        );
        assert.ok(
            /clearTimeout\s*\(\s*this\.opacityTimeout\s*\)/.test(body),
            `BUG: ${name} no longer clears the previous this.opacityTimeout before arming a new ` +
            `shield, so an in-flight restore from the previous switch can fire mid-shield and ` +
            `un-zero the window before DWM has applied the capture-exclusion flag.`,
        );
        assert.ok(
            !/this\.cancelOpacityShield\s*\(\s*\)/.test(body),
            `BUG: ${name} arms the opacity shield via cancelOpacityShield(), which restores ` +
            `opacity to 1 — that undoes the setOpacity(0) it just applied and re-opens the ` +
            `first-frame capture leak. Arm sites must use a bare clearTimeout.`,
        );
    }
});
