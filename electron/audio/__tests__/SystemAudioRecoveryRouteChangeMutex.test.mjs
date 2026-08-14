// Regression test for: cross-flow mutex between setupAudioRecoveryHandler's
// 'error' listener and handleDefaultOutputChanged.
//
// Bug: Two flows that both destroy+recreate `this.systemAudioCapture` had no
// shared mutex. Each only checked its OWN in-progress flag:
//   - setupAudioRecoveryHandler's error listener checked _systemAudioRecoveryInProgress
//   - handleDefaultOutputChanged checked _defaultOutputSwitchInProgress
// Both flows `await` resolveMacScreenCaptureCapability, so interleaving was
// trivial: route-change starts, awaits, recovery error fires, awaits, then both
// assign `fresh` to `this.systemAudioCapture` — the loser is orphaned
// (still running, still feeding STT, still holding the CoreAudio Tap).
//
// Fix: each flow now also checks the OTHER flag at entry and bails early:
//   - handleDefaultOutputChanged: `if (this._systemAudioRecoveryInProgress) return;`
//   - error listener: `if (this._defaultOutputSwitchInProgress) return;`
// The bail MUST happen BEFORE the flow sets its own flag, otherwise the cross
// check is moot.
//
// Strategy: source-level static check on electron/main.ts. main.ts is 5000+
// lines and boots DB/IPC/intelligence on import, so we extract method bodies
// via brace balancing — same pattern as MicRecoveryUsesCanonicalWiring.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainTsPath = path.resolve(__dirname, '../../../electron/main.ts');

const source = readFileSync(mainTsPath, 'utf8');

// Walk a balanced `{ ... }` block starting at `openBraceIdx` (the index of the
// opening `{`). Returns the body slice between the braces (exclusive).
function extractBalancedBlock(src, openBraceIdx) {
    assert.equal(src[openBraceIdx], '{', `expected '{' at index ${openBraceIdx}`);
    let depth = 1;
    let i = openBraceIdx + 1;
    const start = i;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        // Skip string/template/regex/comment contents to avoid counting braces
        // inside them. main.ts has plenty of `{` inside strings and template
        // literals. Lightweight skipper that covers the cases actually present
        // in the two methods of interest.
        if (ch === '/' && src[i + 1] === '/') {
            const nl = src.indexOf('\n', i);
            i = nl === -1 ? src.length : nl + 1;
            continue;
        }
        if (ch === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end === -1 ? src.length : end + 2;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            i++;
            while (i < src.length) {
                const c = src[i];
                if (c === '\\') { i += 2; continue; }
                if (c === quote) { i++; break; }
                // For backticks, also need to skip ${...} interpolations, but
                // we deliberately balance braces inside template literals too —
                // that's actually fine because the interpolation braces are
                // themselves balanced and net to zero.
                i++;
            }
            continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `unbalanced braces starting at ${openBraceIdx}`);
    return src.slice(start, i - 1);
}

// Extract a class method body by signature. More flexible than the simple
// `:\s*\w+\s*\{` form because `handleDefaultOutputChanged` returns
// `Promise<void>` which contains non-word chars.
function extractMethodBody(src, methodName) {
    const sigRe = new RegExp(
        `(?:private|public|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::\\s*[^\\{]+)?\\{`,
    );
    const m = sigRe.exec(src);
    assert.ok(m, `could not locate ${methodName} signature in main.ts`);
    const openBraceIdx = m.index + m[0].length - 1;
    return extractBalancedBlock(src, openBraceIdx);
}

// Extract the body of the arrow function passed to
// `this.systemAudioCapture.on('error', async (err: Error) => { ... })` inside
// setupAudioRecoveryHandler. We locate setupAudioRecoveryHandler, then within
// its body find the on('error', ...) callback and walk to its `{`.
function extractRecoveryErrorListenerBody(src) {
    const handlerBody = extractMethodBody(src, 'setupAudioRecoveryHandler');
    const onErrRe = /this\.systemAudioCapture\.on\(\s*['"]error['"]\s*,\s*async\s*\([^)]*\)\s*=>\s*\{/;
    const m = onErrRe.exec(handlerBody);
    assert.ok(m, "could not locate `this.systemAudioCapture.on('error', async (...) => {` inside setupAudioRecoveryHandler");
    const openBraceIdx = m.index + m[0].length - 1;
    return extractBalancedBlock(handlerBody, openBraceIdx);
}

const handleDefaultOutputChangedBody = extractMethodBody(source, 'handleDefaultOutputChanged');
const recoveryErrorListenerBody = extractRecoveryErrorListenerBody(source);

// ---------- handleDefaultOutputChanged checks the recovery flag ----------

test('handleDefaultOutputChanged bails when _systemAudioRecoveryInProgress is true', () => {
    // Look for an `if (this._systemAudioRecoveryInProgress) ...` followed by a
    // `return` inside the same if-block (either inline or in a braced body).
    const guardRe = /if\s*\(\s*this\._systemAudioRecoveryInProgress\s*\)\s*(?:\{[^}]*\breturn\b[^}]*\}|[^;]*\breturn\b)/;
    assert.ok(
        guardRe.test(handleDefaultOutputChangedBody),
        'BUG: handleDefaultOutputChanged must check `this._systemAudioRecoveryInProgress` and `return` early. ' +
        'Without this cross-flow guard, a route change racing with a recovery can orphan one of the two ' +
        'newly-created SystemAudioCapture instances (still running, still feeding STT, still holding the tap).',
    );
});

test('handleDefaultOutputChanged checks _systemAudioRecoveryInProgress BEFORE setting its own flag', () => {
    const crossCheckIdx = handleDefaultOutputChangedBody.search(/this\._systemAudioRecoveryInProgress/);
    const ownFlagSetIdx = handleDefaultOutputChangedBody.search(/this\._defaultOutputSwitchInProgress\s*=\s*true/);
    assert.ok(crossCheckIdx >= 0, 'expected `this._systemAudioRecoveryInProgress` to be referenced in handleDefaultOutputChanged');
    assert.ok(ownFlagSetIdx >= 0, 'expected `this._defaultOutputSwitchInProgress = true` to be set in handleDefaultOutputChanged');
    assert.ok(
        crossCheckIdx < ownFlagSetIdx,
        'BUG: handleDefaultOutputChanged must check `_systemAudioRecoveryInProgress` BEFORE setting `_defaultOutputSwitchInProgress = true`. ' +
        'Otherwise the cross-flow mutex is moot — the flag is already claimed by the time we notice the other flow.',
    );
});

// ---------- recovery error listener checks the route-change flag ----------

test("setupAudioRecoveryHandler's error listener bails when _defaultOutputSwitchInProgress is true", () => {
    const guardRe = /if\s*\(\s*this\._defaultOutputSwitchInProgress\s*\)\s*(?:\{[^}]*\breturn\b[^}]*\}|[^;]*\breturn\b)/;
    assert.ok(
        guardRe.test(recoveryErrorListenerBody),
        "BUG: the error listener inside setupAudioRecoveryHandler must check `this._defaultOutputSwitchInProgress` " +
        'and `return` early. Without this cross-flow guard, a recovery firing during a route-change rebuild can ' +
        "orphan the route-change's fresh SystemAudioCapture (or vice versa) — both flows assign their own `fresh` " +
        'to `this.systemAudioCapture` and the loser keeps running invisibly.',
    );
});

test("setupAudioRecoveryHandler's error listener checks _defaultOutputSwitchInProgress BEFORE setting its own flag", () => {
    const crossCheckIdx = recoveryErrorListenerBody.search(/this\._defaultOutputSwitchInProgress/);
    const ownFlagSetIdx = recoveryErrorListenerBody.search(/this\._systemAudioRecoveryInProgress\s*=\s*true/);
    assert.ok(crossCheckIdx >= 0, 'expected `this._defaultOutputSwitchInProgress` to be referenced inside the recovery error listener');
    assert.ok(ownFlagSetIdx >= 0, 'expected `this._systemAudioRecoveryInProgress = true` to be set inside the recovery error listener');
    assert.ok(
        crossCheckIdx < ownFlagSetIdx,
        'BUG: the recovery error listener must check `_defaultOutputSwitchInProgress` BEFORE setting ' +
        '`_systemAudioRecoveryInProgress = true`. Otherwise the cross-flow mutex is moot — the flag is already ' +
        'claimed by the time we notice the other flow is mid-rebuild.',
    );
});
