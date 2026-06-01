// Regression test for: setContentProtection dedupe in window helpers.
//
// Bug: Repeated identical calls to setContentProtection triggered redundant
// DWM affinity churn on Windows. setContentProtection is called from multiple
// converging paths (settings IPC, switchToOverlay/switchToLauncher show events,
// Windows mute-on-Win+Tab workaround, global toggles). Reapplying the same
// value caused the HWND to drop into a transient black/blank frame state for
// a few hundred ms on Windows.
//
// Fix: Each setContentProtection method now early-returns when
//   this.contentProtection === enable
// (and, for helpers that own a single window, when the window still exists).
//
// Strategy: source-level static check on the three helpers. These helpers
// instantiate BrowserWindow on import and pull in Electron's main process
// APIs, so they cannot be cleanly unit-tested in isolation. Instead we
// extract the method body via brace-balancing and assert that the early-return
// guard exists AND appears textually BEFORE any native
//   <window>.setContentProtection(enable)
// call. If anyone removes the guard or reorders it after the native call,
// the regression returns and this test fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoElectronDir = path.resolve(__dirname, '../../../electron');

/**
 * Extract the body of `setContentProtection(enable: boolean): void { ... }`
 * via brace-balancing. Mirrors the extractor in
 * MicRecoveryUsesCanonicalWiring.test.mjs.
 */
function extractSetContentProtectionBody(src, fileLabel) {
    const sigRe = /(?:public\s+|private\s+|protected\s+)?setContentProtection\s*\(\s*enable\s*:\s*boolean\s*\)\s*:\s*void\s*\{/;
    const m = sigRe.exec(src);
    assert.ok(m, `could not locate setContentProtection signature in ${fileLabel}`);
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `unbalanced braces while extracting setContentProtection from ${fileLabel}`);
    return src.slice(start, i - 1);
}

/**
 * For helpers that call setContentProtection on a *single* BrowserWindow
 * field (e.g. this.settingsWindow / this.window), the regression-prone
 * native call is `<window>.setContentProtection(enable)`. We exclude the
 * method's own *recursive* signature match by anchoring on a `.` before
 * `setContentProtection`.
 *
 * For WindowHelper, the native call lives inside applyContentProtection,
 * not setContentProtection itself, so we treat the windows-array call
 * `win.setContentProtection(enable)` as the gated native call when present;
 * otherwise we accept the call to applyContentProtection as the gated step.
 */
function findGatedNativeCallIndex(body) {
    // Any `.setContentProtection(enable)` (i.e. a method call, not the
    // method definition) — this is what the guard must precede.
    const nativeRe = /\.\s*setContentProtection\s*\(\s*enable\s*\)/;
    const nativeMatch = nativeRe.exec(body);
    if (nativeMatch) return nativeMatch.index;
    // Fallback: WindowHelper delegates to applyContentProtection(enable).
    const applyRe = /this\.applyContentProtection\s*\(\s*enable\s*\)/;
    const applyMatch = applyRe.exec(body);
    if (applyMatch) return applyMatch.index;
    return -1;
}

function findGuardIndex(body) {
    // Matches the early-return guard:
    //   if (<...this.contentProtection === enable...>) return;
    // The condition may contain nested parens (e.g.
    //   `&& !this.settingsWindow.isDestroyed()`), so we balance parens
    // manually rather than using a regex with `[^)]*`.
    const ifRe = /if\s*\(/g;
    let m;
    while ((m = ifRe.exec(body)) !== null) {
        const openIdx = m.index + m[0].length - 1; // position of '('
        let depth = 1;
        let i = openIdx + 1;
        while (i < body.length && depth > 0) {
            const ch = body[i];
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
            i++;
        }
        if (depth !== 0) continue;
        const condition = body.slice(openIdx + 1, i - 1);
        if (!/this\.contentProtection\s*===\s*enable/.test(condition)) continue;
        // After the closing `)`, require `return` before the next `;`.
        const tail = body.slice(i);
        const stmtEnd = tail.indexOf(';');
        if (stmtEnd === -1) continue;
        const stmt = tail.slice(0, stmtEnd);
        if (/^\s*return\b/.test(stmt)) {
            return m.index;
        }
    }
    return -1;
}

const targets = [
    {
        file: path.join(repoElectronDir, 'WindowHelper.ts'),
        label: 'WindowHelper',
    },
    {
        file: path.join(repoElectronDir, 'SettingsWindowHelper.ts'),
        label: 'SettingsWindowHelper',
    },
    {
        file: path.join(repoElectronDir, 'ModelSelectorWindowHelper.ts'),
        label: 'ModelSelectorWindowHelper',
    },
];

for (const { file, label } of targets) {
    const source = readFileSync(file, 'utf8');
    const body = extractSetContentProtectionBody(source, label);

    test(`${label}.setContentProtection contains the dedupe comparison`, () => {
        assert.ok(
            body.includes('this.contentProtection === enable'),
            `BUG: ${label}.setContentProtection is missing the dedupe comparison ` +
            `\`this.contentProtection === enable\`. Without it, repeated identical ` +
            `calls trigger redundant DWM affinity churn on Windows and can leave ` +
            `the HWND in a transient black/blank frame state.`,
        );
    });

    test(`${label}.setContentProtection has an early-return guard before the native call`, () => {
        const guardIdx = findGuardIndex(body);
        assert.ok(
            guardIdx >= 0,
            `BUG: ${label}.setContentProtection has no early-return guard of the form ` +
            `\`if (this.contentProtection === enable ...) return;\`. The dedupe ` +
            `comparison must short-circuit, not just be evaluated.`,
        );

        const nativeIdx = findGatedNativeCallIndex(body);
        assert.ok(
            nativeIdx >= 0,
            `${label}.setContentProtection does not appear to invoke the native ` +
            `\`<window>.setContentProtection(enable)\` (or delegate via ` +
            `applyContentProtection(enable)). Test assumption broken — review file.`,
        );

        assert.ok(
            guardIdx < nativeIdx,
            `BUG: ${label}.setContentProtection guard is positioned AFTER the native ` +
            `setContentProtection call (guard@${guardIdx}, native@${nativeIdx}). The ` +
            `guard must short-circuit BEFORE the DWM-affinity-mutating call, otherwise ` +
            `the dedupe is a no-op and the original regression returns.`,
        );
    });
}
