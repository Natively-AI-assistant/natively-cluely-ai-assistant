// Regression test for: the meeting overlay leaking into screen captures.
//
// Bug (issue: "Natively is visible on Google Meet calls"): the overlay chrome
// (overlay body + pill + toggle) is a ghost surface that must NEVER appear in a
// screen capture — that is the app's core promise, and the native stealth module
// force-applies NSWindowSharingNone to exactly those three windows regardless of
// mode. But the JS side coupled the overlay's screen-capture invisibility to
// `this.contentProtection`, which only tracks *undetectable/dock* mode. With
// undetectable mode off (its default), every overlay show called
// `setContentProtection(false)`, flipping sharingType back to
// NSWindowSharingReadOnly and re-exposing the overlay — overriding the native
// module and leaking the overlay onto the shared screen.
//
// Fix: the overlay chrome is ALWAYS content-protected, independent of
// undetectable mode. `applyContentProtection` forces it on for the overlay/pill/
// toggle group and only lets the launcher/popover follow `enable`; the creation
// and show sites pass `true` rather than `this.contentProtection`.
//
// Strategy: source-level static check on WindowHelper.ts. The helper instantiates
// BrowserWindow on import and pulls in Electron main-process APIs, so it cannot be
// cleanly unit-tested in isolation (same approach as
// SetContentProtectionDedupe.test.mjs). We extract the applyContentProtection body
// via brace-balancing and assert the invariant, and we assert the leak-prone call
// `this.overlayWindow.setContentProtection(this.contentProtection)` is gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const windowHelperPath = path.resolve(__dirname, '../../../electron/WindowHelper.ts');
const source = readFileSync(windowHelperPath, 'utf8');

/**
 * Extract the body of `applyContentProtection(enable: boolean): void { ... }`
 * via brace-balancing. Mirrors the extractor in
 * SetContentProtectionDedupe.test.mjs.
 */
function extractApplyContentProtectionBody(src) {
    const sigRe = /(?:public\s+|private\s+|protected\s+)?applyContentProtection\s*\(\s*enable\s*:\s*boolean\s*\)\s*:\s*void\s*\{/;
    const m = sigRe.exec(src);
    assert.ok(m, 'could not locate applyContentProtection signature in WindowHelper');
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, 'unbalanced braces while extracting applyContentProtection');
    return src.slice(start, i - 1);
}

const body = extractApplyContentProtectionBody(source);

test('applyContentProtection references all three overlay-chrome windows', () => {
    for (const field of ['this.overlayWindow', 'this.pillWindow', 'this.toggleWindow']) {
        assert.ok(
            body.includes(field),
            `BUG: applyContentProtection no longer references ${field}. The overlay ` +
            `chrome (overlay body + pill + toggle) must be handled here so it can be ` +
            `force-protected independent of undetectable mode.`,
        );
    }
});

test('applyContentProtection force-enables protection with a literal true', () => {
    assert.ok(
        /\.\s*setContentProtection\s*\(\s*true\s*\)/.test(body),
        `BUG: applyContentProtection has no \`setContentProtection(true)\` call. The ` +
        `overlay chrome must be content-protected unconditionally — coupling it to ` +
        `\`enable\` re-exposes the overlay in screen shares whenever undetectable ` +
        `mode is off (its default).`,
    );
});

test('the overlay body is never protected via this.contentProtection', () => {
    // The exact leak: showing/creating the overlay with the undetectable-mode
    // value flips sharingType back to ReadOnly in normal mode.
    assert.ok(
        !/this\.overlayWindow\.setContentProtection\s*\(\s*this\.contentProtection\s*\)/.test(source),
        `BUG: WindowHelper still calls ` +
        `\`this.overlayWindow.setContentProtection(this.contentProtection)\`. The ` +
        `overlay must always be protected (pass \`true\`); gating it on ` +
        `undetectable mode leaks the overlay onto shared screens.`,
    );
});

test('the overlay is created with content protection forced on', () => {
    assert.ok(
        /this\.overlayWindow\.setContentProtection\s*\(\s*true\s*\)/.test(source),
        `BUG: the overlay window is not created/shown with ` +
        `\`setContentProtection(true)\`. It must be protected from the first frame, ` +
        `independent of undetectable mode.`,
    );
});

test('the pill/toggle aux windows are protected with a literal true, not this.contentProtection', () => {
    assert.ok(
        /win\.setContentProtection\s*\(\s*true\s*\)/.test(source),
        `BUG: the overlay aux windows (pill/toggle) are not protected with ` +
        `\`win.setContentProtection(true)\`. They are on-screen meeting chrome and ` +
        `must never leak into a shared screen.`,
    );
    assert.ok(
        !/win\.setContentProtection\s*\(\s*this\.contentProtection\s*\)/.test(source),
        `BUG: the overlay aux windows are still protected via ` +
        `\`win.setContentProtection(this.contentProtection)\`, which re-exposes them ` +
        `in normal mode.`,
    );
});
