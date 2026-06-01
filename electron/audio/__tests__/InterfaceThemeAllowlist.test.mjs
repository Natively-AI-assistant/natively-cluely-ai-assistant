// Regression test for: theme IPC allowlist must reject unknown strings before
// broadcasting to renderers.
//
// Bug: ipcMain.on('interface-theme:set', ...) accepted any string and
// re-broadcast it to every BrowserWindow. Since the value lands in a
// `data-interface-theme={value}` DOM attribute, an unconstrained string is
// at best a CSS selector mismatch and at worst an attribute-injection
// vector if any consumer ever switches to template literals.
//
// Fix: a `VALID_INTERFACE_THEMES` Set with exactly the three known keys
// ('default', 'liquid-glass', 'modern'), guarded BEFORE the
// BrowserWindow.getAllWindows().forEach broadcast.
//
// Strategy: source-level static check on electron/ipcHandlers.ts. Importing
// that module boots half the app (IPC registration, BrowserWindow refs,
// LLM helper wiring, etc.) so we use the brace-balancing extraction pattern
// from MicRecoveryUsesCanonicalWiring.test.mjs to isolate just the
// 'interface-theme:set' handler body. We also cross-check that the
// allowlist matches the source of truth in src/lib/meetingInterfaceTheme.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcHandlersPath = path.resolve(__dirname, '../../../electron/ipcHandlers.ts');
const themeModulePath = path.resolve(__dirname, '../../../src/lib/meetingInterfaceTheme.ts');

const ipcSource = readFileSync(ipcHandlersPath, 'utf8');
const themeSource = readFileSync(themeModulePath, 'utf8');

// Extract the arrow-function body passed to
//   safeOn('interface-theme:set', (_event, theme: string) => { ... })
// using brace balancing so we only assert on this handler.
function extractInterfaceThemeSetHandlerBody(src) {
    const sigRe = /safeOn\(\s*['"]interface-theme:set['"]\s*,\s*\([^)]*\)\s*=>\s*\{/;
    const m = sigRe.exec(src);
    assert.ok(m, "could not locate ipcMain.on('interface-theme:set', ...) handler");
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, "unbalanced braces while extracting 'interface-theme:set' handler");
    return src.slice(start, i - 1);
}

const handlerBody = extractInterfaceThemeSetHandlerBody(ipcSource);

const EXPECTED_THEMES = ['default', 'liquid-glass', 'modern'];

test('ipcHandlers.ts declares VALID_INTERFACE_THEMES Set with exactly the three valid keys', () => {
    // Locate the Set declaration. Accept either `new Set([...])` or
    // `new Set<string>([...])` flavours.
    const setDeclRe = /VALID_INTERFACE_THEMES\s*=\s*new\s+Set\s*(?:<[^>]+>)?\s*\(\s*\[([^\]]+)\]\s*\)/;
    const m = setDeclRe.exec(ipcSource);
    assert.ok(
        m,
        'BUG: ipcHandlers.ts must declare `VALID_INTERFACE_THEMES = new Set([...])` ' +
        'to constrain which strings can be broadcast as interface themes.',
    );
    const literals = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
    assert.deepEqual(
        literals.slice().sort(),
        EXPECTED_THEMES.slice().sort(),
        `BUG: VALID_INTERFACE_THEMES must contain exactly ${JSON.stringify(EXPECTED_THEMES)}, ` +
        `found ${JSON.stringify(literals)}. Allowlist drift = renderer can paint with an ` +
        'unknown theme or a previously-removed theme breaks silently.',
    );
});

test("'interface-theme:set' handler rejects values not in VALID_INTERFACE_THEMES", () => {
    // The guard must read the Set membership and bail out. We accept the
    // negated `.has(theme)` form (current fix), but require some membership
    // check against VALID_INTERFACE_THEMES specifically.
    const guardRe = /!\s*VALID_INTERFACE_THEMES\.has\s*\(\s*theme\s*\)/;
    assert.ok(
        guardRe.test(handlerBody),
        "BUG: 'interface-theme:set' handler must guard with " +
        '`!VALID_INTERFACE_THEMES.has(theme)` (or equivalent membership check) ' +
        'before broadcasting. Without this, any string the renderer sends is ' +
        'echoed to every BrowserWindow and lands in a data-interface-theme ' +
        'DOM attribute.',
    );
});

test('guard returns BEFORE BrowserWindow.getAllWindows().forEach broadcast', () => {
    const guardIdx = handlerBody.search(/!\s*VALID_INTERFACE_THEMES\.has\s*\(\s*theme\s*\)/);
    const broadcastIdx = handlerBody.search(/BrowserWindow\.getAllWindows\s*\(\s*\)\s*\.forEach/);

    assert.ok(guardIdx >= 0, 'allowlist guard missing from handler body');
    assert.ok(broadcastIdx >= 0, 'BrowserWindow.getAllWindows().forEach broadcast missing from handler body');
    assert.ok(
        guardIdx < broadcastIdx,
        'BUG: allowlist guard must appear BEFORE the BrowserWindow broadcast. ' +
        'A guard placed after the forEach is dead code — the unknown theme has ' +
        'already reached every renderer by then.',
    );

    // Also require that the guard block contains an early `return` so we know
    // execution actually halts before reaching the broadcast.
    const between = handlerBody.slice(guardIdx, broadcastIdx);
    assert.ok(
        /\breturn\b/.test(between),
        'BUG: the allowlist guard must `return` early before the broadcast. ' +
        'Logging a warning without returning still lets the invalid theme reach ' +
        'every BrowserWindow.',
    );
});

test('ipcHandlers.ts allowlist matches src/lib/meetingInterfaceTheme.ts source of truth', () => {
    // Cross-check: the type alias and the VALID_THEMES Set in
    // meetingInterfaceTheme.ts must declare the same three keys.
    const aliasRe = /export\s+type\s+MeetingInterfaceTheme\s*=\s*([^;]+);/;
    const aliasMatch = aliasRe.exec(themeSource);
    assert.ok(aliasMatch, 'could not locate MeetingInterfaceTheme type alias in meetingInterfaceTheme.ts');
    const aliasLiterals = [...aliasMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
    assert.deepEqual(
        aliasLiterals.slice().sort(),
        EXPECTED_THEMES.slice().sort(),
        `MeetingInterfaceTheme type alias drifted from expected ${JSON.stringify(EXPECTED_THEMES)}: ` +
        `found ${JSON.stringify(aliasLiterals)}. If this is intentional, update both this test ` +
        'and the ipcHandlers.ts allowlist together.',
    );

    const validThemesRe = /VALID_THEMES\s*:\s*[^=]+=\s*new\s+Set\s*(?:<[^>]+>)?\s*\(\s*\[([^\]]+)\]\s*\)/;
    const validThemesMatch = validThemesRe.exec(themeSource);
    assert.ok(validThemesMatch, 'could not locate VALID_THEMES Set in meetingInterfaceTheme.ts');
    const validThemesLiterals = [...validThemesMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
    assert.deepEqual(
        validThemesLiterals.slice().sort(),
        EXPECTED_THEMES.slice().sort(),
        `VALID_THEMES Set in meetingInterfaceTheme.ts drifted from expected ${JSON.stringify(EXPECTED_THEMES)}: ` +
        `found ${JSON.stringify(validThemesLiterals)}.`,
    );

    // Final cross-file check: the ipcHandlers allowlist literals must equal
    // the meetingInterfaceTheme.ts VALID_THEMES literals exactly. This is the
    // assertion that catches "someone added a theme on one side only."
    const ipcSetMatch = /VALID_INTERFACE_THEMES\s*=\s*new\s+Set\s*(?:<[^>]+>)?\s*\(\s*\[([^\]]+)\]\s*\)/.exec(ipcSource);
    assert.ok(ipcSetMatch, 'ipcHandlers.ts VALID_INTERFACE_THEMES declaration not found');
    const ipcLiterals = [...ipcSetMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);

    assert.deepEqual(
        ipcLiterals.slice().sort(),
        validThemesLiterals.slice().sort(),
        'BUG: ipcHandlers.ts VALID_INTERFACE_THEMES is out of sync with ' +
        'src/lib/meetingInterfaceTheme.ts VALID_THEMES. The two allowlists must ' +
        'be kept identical — the IPC guard is the trust boundary that enforces ' +
        'the type alias on the wire.',
    );
});
