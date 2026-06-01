// Regression test for the "DefaultOutputWatcher interval leaks during quit"
// bug.
//
// Symptom: quitting Natively mid-meeting extended shutdown by 1-2 seconds
// because `_defaultOutputWatcherInterval` (a setInterval polling CoreAudio's
// default output device) was only ever cleared inside `endMeeting()`. If the
// user quit while a meeting was active, the interval kept firing while V8
// tore down native handles, racing the shutdown sequence.
//
// Fix: a public method `stopDefaultOutputWatcherForShutdown()` was added on
// AppState (delegating to the existing private `stopDefaultOutputWatcher()`),
// and the `app.on('before-quit', ...)` handler now invokes it BEFORE other
// heavyweight cleanup (notably `OllamaManager.getInstance().stop()`).
//
// Strategy: main.ts is a 5000+ line module that cannot be safely imported in
// a unit test (it boots Electron, registers IPC handlers, spawns native
// modules, etc). Instead we perform source-level static assertions on the
// TypeScript source — verifying the symbols exist, that they appear inside
// the before-quit handler, and that the call ordering matches the fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainTsPath = path.resolve(__dirname, '../../../electron/main.ts');
const source = readFileSync(mainTsPath, 'utf8');

// ---------------------------------------------------------------------------
// Helper: extract the body of the `app.on("before-quit", ...)` handler so we
// can assert against its contents in isolation, instead of grepping the whole
// file (which would let a stray `stopDefaultOutputWatcherForShutdown` call in
// some unrelated handler pass the test).
// ---------------------------------------------------------------------------
function extractBeforeQuitHandlerBody(src) {
    // Match both quote styles used in this codebase.
    const startRe = /app\.on\(\s*["']before-quit["']\s*,\s*\(([^)]*)\)\s*=>\s*\{/;
    const startMatch = startRe.exec(src);
    assert.ok(startMatch, 'could not locate app.on("before-quit", ...) handler');

    // Brace-balance from the opening `{` of the arrow body.
    const openIdx = src.indexOf('{', startMatch.index + startMatch[0].length - 1);
    let depth = 0;
    let i = openIdx;
    for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    assert.ok(i < src.length, 'before-quit handler body braces are unbalanced');
    return src.slice(openIdx + 1, i);
}

test('AppState defines a public stopDefaultOutputWatcherForShutdown method', () => {
    // The fix introduces a public wrapper around the existing private
    // `stopDefaultOutputWatcher()` so the before-quit handler (which has no
    // access to private members) can cancel the interval.
    const re = /public\s+stopDefaultOutputWatcherForShutdown\s*\(\s*\)\s*:\s*void\s*\{/;
    assert.ok(
        re.test(source),
        'BUG: public method `stopDefaultOutputWatcherForShutdown(): void` is missing from main.ts — ' +
        'the before-quit handler will not be able to cancel the DefaultOutputWatcher interval ' +
        'because the underlying `stopDefaultOutputWatcher()` is private.',
    );
});

test('before-quit handler cancels the DefaultOutputWatcher interval', () => {
    const body = extractBeforeQuitHandlerBody(source);

    // Accept either the public-shutdown wrapper (preferred) or the private
    // method name if it was made callable directly. Both close the interval.
    // Allow optional-chaining `?.` between the identifier and the call parens,
    // since the production code uses `appState.stopDefaultOutputWatcherForShutdown?.()`.
    const callsShutdownWrapper = /stopDefaultOutputWatcherForShutdown\s*\??\.?\s*\(/.test(body);
    const callsPrivateDirectly = /\bstopDefaultOutputWatcher\b\s*\??\.?\s*\(/.test(body);

    assert.ok(
        callsShutdownWrapper || callsPrivateDirectly,
        'BUG: the before-quit handler does not call stopDefaultOutputWatcherForShutdown() ' +
        '(nor stopDefaultOutputWatcher() directly). The _defaultOutputWatcherInterval will ' +
        'continue firing during V8 teardown, extending shutdown by 1-2s when the user quits ' +
        'mid-meeting.',
    );
});

test('DefaultOutputWatcher shutdown call precedes OllamaManager.stop() in before-quit', () => {
    const body = extractBeforeQuitHandlerBody(source);

    const watcherIdx = (() => {
        // Allow optional-chaining `?.` between identifier and call parens.
        const a = body.search(/stopDefaultOutputWatcherForShutdown\s*\??\.?\s*\(/);
        const b = body.search(/\bstopDefaultOutputWatcher\b\s*\??\.?\s*\(/);
        // Return the first match present.
        const candidates = [a, b].filter((n) => n !== -1);
        return candidates.length === 0 ? -1 : Math.min(...candidates);
    })();
    const ollamaIdx = body.search(/OllamaManager\.getInstance\(\)\s*\.\s*stop\s*\(/);

    assert.notStrictEqual(
        watcherIdx, -1,
        'expected a stopDefaultOutputWatcher* call inside the before-quit handler',
    );
    assert.notStrictEqual(
        ollamaIdx, -1,
        'expected OllamaManager.getInstance().stop() inside the before-quit handler',
    );
    assert.ok(
        watcherIdx < ollamaIdx,
        `BUG: stopDefaultOutputWatcher* (offset ${watcherIdx}) must run BEFORE ` +
        `OllamaManager.getInstance().stop() (offset ${ollamaIdx}) in the before-quit ` +
        `handler. The interval must be cancelled before native modules begin teardown, ` +
        `otherwise the next tick fires into a half-released native handle.`,
    );
});
