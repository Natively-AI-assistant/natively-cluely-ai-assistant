// Regression test for: the dev launcher load-retry loop never terminated.
//
// THE BUG. WindowHelper.createWindow() self-heals a failed dev load (the Vite
// server at http://localhost:5180 being momentarily down) by re-issuing
// loadURL() once a second, bounded by MAX_LAUNCHER_LOAD_RETRIES = 10. The bound
// was unreachable. The counter was reset inside the `did-finish-load` handler —
// but when a load fails, Chromium commits its OWN error page, and that error
// page fires `did-finish-load` like any other document. So every failure ran:
//
//     did-fail-load -> launcherLoadRetries = 1 -> schedule retry
//     (error page commits) -> did-finish-load -> launcherLoadRetries = 0
//
// and the counter never passed 1. The result was an unbounded 1 Hz navigation
// loop for as long as the dev server stayed down.
//
// MEASURED on macOS (Electron 43.1.0), `electron .` with port 5180 closed:
//
//   BEFORE: 39 retries in a 40s run, every one logged "(1/10)". A prior session
//           log (natively_debug.prev.log, 2026-08-15 11:07->11:36) shows the
//           same loop running 1447 times across 29 minutes, all "(1/10)".
//   AFTER:  exactly 10 retries in the same 40s window, logged "(1/10)" through
//           "(10/10)", then silence.
//
// THE FIX, guarded here: the budget is reset from the `loadURL()` promise's
// resolution — the only signal that distinguishes a real load from a committed
// error page, because loadURL() REJECTS on a failed load — and the
// `did-finish-load` handler no longer touches the counter.
//
// STRATEGY. Source-level static check, same as the neighbouring
// LauncherBootRevealNotFrameGated2026_09_01 / OverlayAlwaysContentProtected
// tests: WindowHelper.ts instantiates BrowserWindow on import and pulls in
// main-process-only Electron APIs, so the handler cannot be exercised in
// isolation without standing up a real app.
//
// The assertion is scoped to the extracted `did-finish-load` handler body
// rather than run against the whole file, because `launcherLoadRetries = 0`
// legitimately appears elsewhere (in the loadLauncher success path). A
// whole-source check could not tell the two apart. A mutation probe below
// re-inserts the reset into the handler and asserts the guard catches it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const source = readFileSync(path.join(repoRoot, 'electron/WindowHelper.ts'), 'utf8');

/**
 * Extract the balanced body of the callback that follows `marker`, by scanning
 * braces from the first `{` after it. Returns the body WITHOUT the outer braces.
 */
function callbackBodyAfter(text, marker) {
    const at = text.indexOf(marker);
    assert.notEqual(at, -1, `could not find ${marker} in WindowHelper.ts — the test anchor moved`);
    const open = text.indexOf('{', at);
    assert.notEqual(open, -1, `no callback body found after ${marker}`);
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) return text.slice(open + 1, i);
        }
    }
    assert.fail(`unbalanced braces after ${marker}`);
}

const didFinishLoadBody = callbackBodyAfter(source, "webContents.on('did-finish-load'");

test('the did-finish-load handler does not reset the launcher load-retry budget', () => {
    // A failed load commits a Chromium error page, which fires did-finish-load.
    // Resetting the counter here makes MAX_LAUNCHER_LOAD_RETRIES unreachable
    // and turns the self-heal into an unbounded 1 Hz navigation loop.
    assert.doesNotMatch(
        didFinishLoadBody,
        /launcherLoadRetries/,
        "the launcher's did-finish-load handler must not touch launcherLoadRetries. Chromium " +
        'fires did-finish-load for its own error page after a failed load, so resetting the ' +
        'counter there means the retry cap is never reached and the dev self-heal retries ' +
        'forever (measured: 39 retries in 40s, all logged "1/10").',
    );
});

test('the retry budget is reset from the loadURL() promise resolution', () => {
    // loadURL() rejects on a failed load, so its resolution is the only signal
    // that separates a real document from a committed error page.
    const loadLauncherBody = callbackBodyAfter(source, 'const loadLauncher =');
    assert.match(
        loadLauncherBody,
        /\.then\(\s*\(\s*\)\s*=>\s*\{[^}]*launcherLoadRetries\s*=\s*0/,
        'loadLauncher() must reset launcherLoadRetries inside the loadURL().then() success ' +
        'handler — that is the only place a genuine load can be distinguished from an error page.',
    );
});

test('the scheduled retry routes back through loadLauncher so a successful retry resets the budget', () => {
    const didFailLoadBody = callbackBodyAfter(source, "webContents.on('did-fail-load'");
    assert.match(
        didFailLoadBody,
        /loadLauncher\(\)/,
        'the did-fail-load retry must call loadLauncher(), not loadURL() directly — a bare ' +
        'loadURL() call would never reset the budget on a successful retry, which is the ' +
        'behaviour the original did-finish-load reset was there to provide.',
    );
    assert.match(
        didFailLoadBody,
        /launcherLoadRetries\s*<\s*MAX_LAUNCHER_LOAD_RETRIES/,
        'the retry must stay bounded by MAX_LAUNCHER_LOAD_RETRIES',
    );
});

test('mutation probe: re-inserting the reset into did-finish-load fails the guard', () => {
    // If this probe fails, the guard above is vacuous — it would pass even with
    // the original bug present.
    const mutated = `${didFinishLoadBody}\n      launcherLoadRetries = 0;`;
    assert.match(
        mutated,
        /launcherLoadRetries/,
        'the mutation probe did not reproduce the bug shape, so the guard above proves nothing',
    );
});
