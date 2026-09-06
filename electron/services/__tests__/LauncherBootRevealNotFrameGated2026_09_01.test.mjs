// Regression test for: "the app only completes the startup sequence if the app
// is in focus".
//
// THE BUG. The launcher's boot reveal — the black logo splash
// (src/components/StartupSequence.tsx) handing over to the launcher UI — is
// driven by Framer Motion inside an AnimatePresence in src/App.tsx. Framer
// Motion advances only on requestAnimationFrame. Chromium STOPS rAF outright
// (not throttles it — stops it) for any window whose document is hidden, and a
// window counts as hidden when it is merely covered by another app's window,
// when the app is hidden with Cmd+H, or when it sits on an inactive macOS Space
// / Windows virtual desktop.
//
// Timers, by contrast, are only throttled to ~1Hz. So on a launcher that boots
// while covered, StartupSequence's 2.2s dismissal timer still fires and
// `showStartup` still flips to false — but the AnimatePresence exit animation
// never completes, so the full-screen black splash is never unmounted, and the
// launcher layer underneath never leaves its `initial` opacity 0. The window
// stays painted on the black logo indefinitely, and snaps to the loaded UI the
// moment the user brings it forward.
//
// Measured on macOS (Electron 43.1.0 / Chrome 150) with the app genuinely
// hidden, confirmed independently via System Events:
//
//   BEFORE: rAF frozen at a constant 215 ticks for 60s; `showStartup=false`
//           fired on schedule, but the splash-exit, splash-unmount and
//           launcher-entrance completions never fired. They all fired within
//           one frame of the window becoming visible again.
//   AFTER:  rAF ticking at a full 60fps while hidden (1202 ticks at t=20s), and
//           the entire reveal — exit, unmount, launcher entrance — completed
//           while the app was still hidden.
//
// THE FIX, guarded here: the launcher BrowserWindow opts out of Chromium's
// background throttling, so rAF keeps running and the boot sequence completes
// wherever the window happens to be.
//
// STRATEGY. Source-level static check on WindowHelper.ts. The helper
// instantiates BrowserWindow on import and pulls in Electron main-process APIs,
// so it cannot be cleanly unit-tested in isolation — same approach as
// OverlayContentProtectionFollowsUndetectable.test.mjs and SetContentProtectionDedupe.test.mjs.
//
// IMPORTANT — why the assertion is anchored to the `launcherSettings` object
// literal rather than run against the whole file: WindowHelper.ts creates
// several windows, and the aux pill/toggle settings in `auxSettings` already
// carry their own webPreferences. A whole-source regex for
// `backgroundThrottling: false` would therefore pass even if the launcher's own
// flag were deleted (verified with a mutation probe — see the test body). The
// check below extracts the launcher's settings literal and asserts the flag is
// inside THAT object, so deleting it fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const windowHelperSource = readFileSync(path.join(repoRoot, 'electron/WindowHelper.ts'), 'utf8');
const launcherSource = readFileSync(path.join(repoRoot, 'src/components/Launcher.tsx'), 'utf8');

/** Strip both comment styles so prose *about* the bug never satisfies a check. */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Extract a brace-balanced object literal starting at the first match of
 * `sigRe` (whose match must end on the literal's opening brace).
 */
function extractObjectLiteral(src, sigRe, label) {
    const m = sigRe.exec(src);
    assert.ok(m, `could not locate ${label} in WindowHelper.ts`);
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

const launcherSettings = extractObjectLiteral(
    stripComments(windowHelperSource),
    /const\s+launcherSettings\s*:\s*Electron\.BrowserWindowConstructorOptions\s*=\s*\{/,
    'launcherSettings',
);

const launcherWebPreferences = extractObjectLiteral(
    launcherSettings,
    /webPreferences\s*:\s*\{/,
    'launcherSettings.webPreferences',
);

test('the launcher window opts out of background throttling so its boot reveal is not gated on requestAnimationFrame', () => {
    assert.match(
        launcherWebPreferences,
        /backgroundThrottling\s*:\s*false/,
        'launcherSettings.webPreferences must set backgroundThrottling: false. Without it Chromium ' +
        'stops requestAnimationFrame whenever the launcher is covered/hidden, the AnimatePresence ' +
        'reveal in src/App.tsx never completes, and the app stays painted on the black startup ' +
        'splash until the user focuses it.',
    );
});

test('mutation probe: the assertion is scoped to the launcher, not satisfied by another window', () => {
    // Deleting ONLY the launcher's flag must break the check above. If this
    // probe fails, the real assertion is vacuous — some other window's
    // `backgroundThrottling: false` is satisfying it.
    const mutated = launcherWebPreferences.replace(/backgroundThrottling\s*:\s*false\s*,?/, '');
    assert.doesNotMatch(
        mutated,
        /backgroundThrottling\s*:\s*false/,
        'removing the launcher flag left a match behind — the guard above is not actually scoped ' +
        'to the launcher window',
    );
});

test('the launcher usage-tick gate does not read document.visibilityState', () => {
    // `backgroundThrottling: false` also makes the Page Visibility API report
    // this window as 'visible' while it is hidden. The usage-time accumulator
    // therefore cannot gate on visibilityState — it would bill time for a
    // launcher the user has hidden or covered. It samples document.hasFocus()
    // at tick time instead — the ground truth the focus/blur events report,
    // with no seeded state to fall out of sync.
    const body = stripComments(launcherSource);
    assert.doesNotMatch(
        body,
        /document\.visibilityState/,
        'Launcher.tsx must not gate on document.visibilityState: the launcher window sets ' +
        'backgroundThrottling: false, which makes that API report "visible" even while the window ' +
        'is hidden. Gate on the focus/blur foreground state instead.',
    );
    assert.match(
        body,
        /if\s*\(\s*document\.hasFocus\(\)\s*\)\s*\{\s*emitOrchestratorEvent\(\{\s*type:\s*'usage:tick'/,
        'the usage-tick accumulator should fire only while the launcher window holds focus',
    );
});
