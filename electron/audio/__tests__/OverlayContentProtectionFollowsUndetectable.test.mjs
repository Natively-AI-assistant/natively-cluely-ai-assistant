// Contract test for: the overlay's screen-capture visibility follows
// UNDETECTABLE MODE, and nothing else.
//
// Product contract (restored 2026-09-07, reverting PR #509):
//   • undetectable mode ON  → overlay chrome is content-protected (invisible to
//     screen capture), same as the launcher and popover catcher.
//   • undetectable mode OFF → overlay chrome is NOT protected; it is meant to be
//     visible in a shared screen or recording (demos, support captures).
//
// PR #509 decoupled the overlay body + pill + toggle from the toggle and forced
// them permanently protected. That made the overlay invisible to captures even
// in normal mode, which is not the intended behaviour. This test locks the
// mode-gated mapping in BOTH directions: a future change that hard-codes a
// literal `true` on the chrome fails here, and so does one that drops a window
// out of applyContentProtection entirely.
//
// Note the flag itself only sets NSWindowSharingNone. On macOS 15+,
// ScreenCaptureKit (Zoom 5.16+, Teams, Chrome getDisplayMedia → Google Meet)
// ignores it — see native-module/src/stealth_window.rs. So this contract governs
// the legacy CoreGraphics capture paths; it is not a claim about SCK.
//
// Strategy: source-level static check on WindowHelper.ts. The helper instantiates
// BrowserWindow on import and pulls in Electron main-process APIs, so it cannot be
// cleanly unit-tested in isolation (same approach as
// SetContentProtectionDedupe.test.mjs).
//
// IMPORTANT — why the positive assertions are scoped to a specific method body
// rather than run against the whole file: several methods contain the literal
// text `setContentProtection(this.contentProtection)`, so a whole-source regex
// passes even when the *creation* site it claims to guard has been changed
// (the predecessor of this file verified that with a mutation probe: reverting
// both creation sites still gave 8/8 green on unscoped regexes). Each positive
// check below is anchored to the body of the method that owns the site.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const windowHelperPath = path.resolve(__dirname, '../../../electron/WindowHelper.ts');
const source = readFileSync(windowHelperPath, 'utf8');

const OVERLAY_CHROME = ['this.overlayWindow', 'this.pillWindow', 'this.toggleWindow'];
const MODE_FOLLOWERS = ['this.launcherWindow', 'this.popoverCatcher'];

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

/**
 * Parse applyContentProtection into { members, arg } groups: each window-array
 * literal paired with the argument the immediately-following
 * `setContentProtection(...)` call applies to it. This binds each window to the
 * protection value it actually receives, rather than checking for the array and
 * the argument independently (which a per-window regression could slip past).
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

const body = extractMethodBody(
    source,
    /(?:public\s+|private\s+|protected\s+)?applyContentProtection\s*\(\s*enable\s*:\s*boolean\s*\)\s*:\s*void\s*\{/,
    'applyContentProtection',
);
const groups = parseProtectionGroups(body);

// The overlay body is created here (createWindow builds the launcher AND the
// overlay); the pill/toggle are created in createOverlayAuxWindows. Scoping the
// creation assertions to these bodies is what makes them bite — see the note at
// the top of this file.
const createWindowBody = extractMethodBody(
    source,
    /(?:public\s+|private\s+|protected\s+)?createWindow\s*\(\s*\)\s*:\s*void\s*\{/,
    'createWindow',
);
const createAuxBody = extractMethodBody(
    source,
    /(?:public\s+|private\s+|protected\s+)?createOverlayAuxWindows\s*\(\s*startUrl\s*:\s*string\s*\)\s*:\s*void\s*\{/,
    'createOverlayAuxWindows',
);
const switchToOverlayBody = extractMethodBody(
    source,
    /(?:public\s+|private\s+|protected\s+)?switchToOverlay\s*\(\s*inactive\s*\??\s*:\s*boolean[^)]*\)\s*:\s*void\s*\{/,
    'switchToOverlay',
);

for (const win of [...OVERLAY_CHROME, ...MODE_FOLLOWERS]) {
    test(`applyContentProtection routes ${win} through \`enable\` (undetectable mode)`, () => {
        const owning = groups.filter((g) => g.members.includes(win));
        assert.ok(
            owning.length > 0,
            `BUG: ${win} is not handled in applyContentProtection, so toggling undetectable ` +
            `mode no longer updates its screen-capture visibility.`,
        );
        for (const g of owning) {
            assert.equal(
                g.arg,
                'enable',
                `BUG: ${win} receives \`setContentProtection(${g.arg})\` in applyContentProtection ` +
                `instead of \`enable\`. Screen-capture invisibility must follow undetectable mode: ` +
                `hard-coding it re-introduces PR #509's behaviour, where the overlay was hidden ` +
                `from captures even in normal (detectable) mode.`,
            );
        }
    });
}

test('applyContentProtection pushes the value unconditionally (no early return)', () => {
    // reassertContentProtection() routes through here precisely BECAUSE the value
    // is unchanged: app.dock.hide()/show() flips the macOS activation policy and
    // WindowServer silently resets sharingType, so the OS must be re-told even
    // when this.contentProtection already matches. A guard here would make the
    // dock-enforcement paths in main.ts silently no-op.
    assert.ok(
        !/\breturn\b/.test(body),
        'BUG: applyContentProtection contains an early return. It must always re-push the ' +
        'value — reassertContentProtection() depends on that to recover from macOS dock flips ' +
        'silently resetting sharingType. The dedupe guard belongs in setContentProtection().',
    );
});

test('the overlay body is CREATED following undetectable mode', () => {
    // Scoped to createWindow so the show-path call sites cannot satisfy it.
    assert.ok(
        /this\.overlayWindow\.setContentProtection\s*\(\s*this\.contentProtection\s*\)/.test(
            createWindowBody,
        ),
        'BUG: the overlay window is not created with ' +
        '`setContentProtection(this.contentProtection)` in createWindow. The native stealth ' +
        'module force-applies NSWindowSharingNone on ready-to-show regardless of mode, so this ' +
        'JS push is what restores capture visibility in normal mode.',
    );
    assert.ok(
        !/this\.overlayWindow\.setContentProtection\s*\(\s*true\s*\)/.test(createWindowBody),
        'BUG: the overlay window is created with a hard-coded `setContentProtection(true)`, ' +
        'which pins it invisible to captures even in normal mode (PR #509 behaviour).',
    );
});

test('the pill/toggle aux windows are CREATED following undetectable mode', () => {
    // Scoped to createOverlayAuxWindows so applyContentProtection's own
    // `win.setContentProtection(enable)` cannot satisfy it.
    assert.ok(
        /win\.setContentProtection\s*\(\s*this\.contentProtection\s*\)/.test(createAuxBody),
        'BUG: the overlay aux windows (pill/toggle) are not created with ' +
        '`win.setContentProtection(this.contentProtection)` in createOverlayAuxWindows. They are ' +
        'the same on-screen chrome as the overlay body and must share its capture visibility.',
    );
    assert.ok(
        !/win\.setContentProtection\s*\(\s*true\s*\)/.test(createAuxBody),
        'BUG: the overlay aux windows are created with a hard-coded ' +
        '`win.setContentProtection(true)`, pinning them invisible to captures in normal mode.',
    );
});

test('the overlay SHOW path follows undetectable mode', () => {
    // switchToOverlay has two show branches. The win32 opacity-shield branch is
    // itself gated on this.contentProtection, so its literal `true` is consistent
    // (it only runs in undetectable mode); the other branch must pass the field.
    assert.ok(
        /this\.overlayWindow\.setContentProtection\s*\(\s*this\.contentProtection\s*\)/.test(
            switchToOverlayBody,
        ),
        'BUG: switchToOverlay no longer shows the overlay with ' +
        '`setContentProtection(this.contentProtection)`. Every show re-asserts the flag, so a ' +
        'hard-coded value here overrides the toggle on the next overlay show.',
    );
    const forced = switchToOverlayBody.match(
        /this\.overlayWindow\.setContentProtection\s*\(\s*true\s*\)/g,
    );
    assert.equal(
        forced?.length ?? 0,
        1,
        `BUG: switchToOverlay has ${forced?.length ?? 0} hard-coded ` +
        `\`setContentProtection(true)\` call(s) on the overlay, expected exactly 1 (inside the ` +
        `win32 opacity-shield branch, which only runs in undetectable mode). Any other one pins ` +
        `the overlay invisible to captures in normal mode.`,
    );
});

test('the pill/toggle follow undetectable mode on BOTH show branches', () => {
    // Measured on macOS: the creation-time push in createOverlayAuxWindows is
    // overridden by the native applyStealthToWindow, which runs later (on
    // 'ready-to-show') and force-sets NSWindowSharingNone regardless of mode. So
    // without a push on the show path the pill/toggle stay capture-protected even
    // with undetectable mode off — the overlay body flips to ReadOnly and its own
    // chrome does not. Both branches must push, or the default path is half-hidden.
    for (const win of ['this.pillWindow', 'this.toggleWindow']) {
        const pushes = switchToOverlayBody.match(
            new RegExp(
                win.replace('.', '\\.') +
                    '\\?\\.setContentProtection\\(\\s*this\\.contentProtection\\s*\\)',
                'g',
            ),
        );
        assert.equal(
            pushes?.length ?? 0,
            2,
            `BUG: switchToOverlay pushes the content-protection value to ${win} ` +
            `${pushes?.length ?? 0} time(s), expected 2 (the win32 opacity-shield branch and ` +
            `the other branch). A missing push leaves the pill/toggle force-protected by the ` +
            `native stealth module while the overlay body follows the mode.`,
        );
    }
});

test('the win32 opacity shield only runs in undetectable mode', () => {
    // The shield exists to stop a pre-flag frame leaking before DWM applies the
    // capture-exclusion affinity. With undetectable mode off there is no flag to
    // wait for and the overlay is meant to be capture-visible, so running the
    // shield there is both pointless and the widening that produced issue #529
    // (shown-but-transparent on Windows).
    assert.ok(
        /process\.platform\s*===\s*'win32'\s*&&\s*this\.contentProtection/.test(switchToOverlayBody),
        "BUG: switchToOverlay's win32 opacity shield is no longer gated on " +
        '`this.contentProtection`. Ungating it runs the 0-opacity shield on every Windows ' +
        'overlay show, which is what widened issue #529 beyond undetectable mode.',
    );
});

test('the non-shielded show branch keeps the win32 z-order re-assert', () => {
    // Follows directly from the gate above: once the shield is mode-gated, win32
    // reaches the plain branch in normal mode, and that branch owns the only
    // setAlwaysOnTop for it. PR #509 deleted this call on the premise that
    // "Windows always takes the shielded branch" — true only while ungated.
    const reasserts = switchToOverlayBody.match(
        /setAlwaysOnTop\s*\(\s*true\s*,\s*'screen-saver'\s*\)/g,
    );
    assert.equal(
        reasserts?.length ?? 0,
        2,
        `BUG: switchToOverlay has ${reasserts?.length ?? 0} \`setAlwaysOnTop(true, 'screen-saver')\` ` +
        `call(s), expected 2 — one in the shield's un-shield timer and one in the non-shielded ` +
        `branch, which win32 now reaches whenever undetectable mode is off. Without the second, ` +
        `the overlay can land demoted behind the meeting window on Windows (issue #136).`,
    );
});
