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
// SetContentProtectionDedupe.test.mjs). We parse the applyContentProtection body
// and assert the actual MAPPING — each overlay-chrome window is iterated by a
// forEach that applies `setContentProtection(true)`, while the launcher follows
// `enable` — so a refactor that drops one window into the mode-dependent group
// (or flips its argument to `enable`/`false`) fails here instead of silently
// re-introducing the screen-capture leak.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const windowHelperPath = path.resolve(__dirname, '../../../electron/WindowHelper.ts');
const source = readFileSync(windowHelperPath, 'utf8');

const OVERLAY_CHROME = ['this.overlayWindow', 'this.pillWindow', 'this.toggleWindow'];

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

/**
 * Parse applyContentProtection into { members, arg } groups: each window-array
 * literal paired with the argument the immediately-following
 * `setContentProtection(...)` call applies to it. This binds each window to the
 * protection value it actually receives, rather than checking for the array and
 * the literal `true` independently (which a per-window regression could slip
 * past).
 */
function parseProtectionGroups(body) {
    const groups = [];
    const arrayRe = /\[([^\][]*)\]/g; // window arrays contain no nested brackets
    let m;
    while ((m = arrayRe.exec(body)) !== null) {
        const members = m[1].split(',').map((s) => s.trim()).filter(Boolean);
        if (!members.some((x) => x.startsWith('this.'))) continue; // not a window array
        const after = body.slice(m.index + m[0].length);
        const callMatch = /\.\s*setContentProtection\s*\(\s*([A-Za-z0-9_.]+)\s*\)/.exec(after);
        if (!callMatch) continue;
        groups.push({ members, arg: callMatch[1] });
    }
    return groups;
}

const body = extractApplyContentProtectionBody(source);
const groups = parseProtectionGroups(body);

test('applyContentProtection maps at least two window groups (chrome + followers)', () => {
    assert.ok(
        groups.length >= 2,
        `BUG: applyContentProtection no longer splits windows into an always-protected ` +
        `overlay-chrome group and a mode-dependent follower group (found ${groups.length} ` +
        `window group(s)). Parsed groups: ${JSON.stringify(groups)}`,
    );
});

for (const win of OVERLAY_CHROME) {
    test(`applyContentProtection protects ${win} unconditionally (setContentProtection(true))`, () => {
        const owning = groups.filter((g) => g.members.includes(win));
        assert.ok(
            owning.length > 0,
            `BUG: ${win} is not handled in applyContentProtection. It is on-screen meeting ` +
            `chrome and must be force-protected there, independent of undetectable mode.`,
        );
        for (const g of owning) {
            assert.equal(
                g.arg,
                'true',
                `BUG: ${win} receives \`setContentProtection(${g.arg})\` in applyContentProtection, ` +
                `not \`true\`. The overlay chrome must be protected unconditionally — coupling it to ` +
                `\`enable\` (undetectable mode) re-exposes the overlay in screen shares whenever ` +
                `undetectable mode is off (its default).`,
            );
        }
    });
}

test('applyContentProtection keeps the launcher on the undetectable-mode toggle (enable)', () => {
    // Sanity that the split is real: the launcher is NOT meeting chrome and must
    // still follow the toggle, so we are not just blanket-forcing everything true.
    const owning = groups.filter((g) => g.members.includes('this.launcherWindow'));
    assert.ok(
        owning.length > 0,
        'BUG: applyContentProtection no longer references this.launcherWindow — the launcher ' +
        'must follow undetectable mode.',
    );
    for (const g of owning) {
        assert.equal(
            g.arg,
            'enable',
            `BUG: the launcher receives \`setContentProtection(${g.arg})\` instead of following ` +
            `\`enable\`. It is the main window shown outside a meeting and the native module ` +
            `deliberately does not force-hide it.`,
        );
    }
});

test('the overlay body is never protected via this.contentProtection', () => {
    // The exact leak: creating/showing the overlay with the undetectable-mode
    // value flips sharingType back to ReadOnly in normal mode.
    assert.ok(
        !/this\.overlayWindow\.setContentProtection\s*\(\s*this\.contentProtection\s*\)/.test(source),
        `BUG: WindowHelper still calls ` +
        `\`this.overlayWindow.setContentProtection(this.contentProtection)\`. The overlay must ` +
        `always be protected (pass \`true\`); gating it on undetectable mode leaks the overlay ` +
        `onto shared screens.`,
    );
});

test('the overlay is created/shown with content protection forced on', () => {
    assert.ok(
        /this\.overlayWindow\.setContentProtection\s*\(\s*true\s*\)/.test(source),
        `BUG: the overlay window is not created/shown with \`setContentProtection(true)\`. It ` +
        `must be protected from the first frame, independent of undetectable mode.`,
    );
});

test('the pill/toggle aux windows are protected with a literal true, not this.contentProtection', () => {
    assert.ok(
        /win\.setContentProtection\s*\(\s*true\s*\)/.test(source),
        `BUG: the overlay aux windows (pill/toggle) are not protected with ` +
        `\`win.setContentProtection(true)\` at creation. They are on-screen meeting chrome and ` +
        `must never leak into a shared screen.`,
    );
    assert.ok(
        !/win\.setContentProtection\s*\(\s*this\.contentProtection\s*\)/.test(source),
        `BUG: the overlay aux windows are still protected via ` +
        `\`win.setContentProtection(this.contentProtection)\`, which re-exposes them in normal mode.`,
    );
});
