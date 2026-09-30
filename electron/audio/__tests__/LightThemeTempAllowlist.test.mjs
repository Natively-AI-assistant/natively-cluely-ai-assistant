// Regression test for: light-theme-temp IPC allowlist must reject unknown
// strings before broadcasting to renderers, and must stay in sync with
// src/lib/lightThemeTemperature.ts. Same bug class as
// InterfaceThemeAllowlist.test.mjs — the value lands in a
// `data-light-temp={value}` DOM attribute, so an unconstrained broadcast is
// at best a CSS mismatch and at worst an attribute-injection vector.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcHandlersPath = path.resolve(__dirname, '../../../electron/ipcHandlers.ts');
const tempModulePath = path.resolve(__dirname, '../../../src/lib/lightThemeTemperature.ts');

const ipcSource = readFileSync(ipcHandlersPath, 'utf8');
const tempSource = readFileSync(tempModulePath, 'utf8');

function extractHandlerBody(src) {
    const sigRe = /safeOn\(\s*['"]light-theme-temp:set['"]\s*,\s*\([^)]*\)\s*=>\s*\{/;
    const m = sigRe.exec(src);
    assert.ok(m, "could not locate safeOn('light-theme-temp:set', ...) handler");
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, "unbalanced braces while extracting 'light-theme-temp:set' handler");
    return src.slice(start, i - 1);
}

const handlerBody = extractHandlerBody(ipcSource);
const EXPECTED_TEMPS = ['neutral', 'warm', 'cool'];

test('ipcHandlers.ts declares VALID_LIGHT_TEMPS Set with exactly the three valid keys', () => {
    const setDeclRe = /VALID_LIGHT_TEMPS\s*=\s*new\s+Set\s*(?:<[^>]+>)?\s*\(\s*\[([^\]]+)\]\s*\)/;
    const m = setDeclRe.exec(ipcSource);
    assert.ok(m, 'BUG: ipcHandlers.ts must declare `VALID_LIGHT_TEMPS = new Set([...])`.');
    const literals = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
    assert.deepEqual(
        literals.slice().sort(),
        EXPECTED_TEMPS.slice().sort(),
        `VALID_LIGHT_TEMPS must contain exactly ${JSON.stringify(EXPECTED_TEMPS)}, found ${JSON.stringify(literals)}`,
    );
});

test("'light-theme-temp:set' handler guards with VALID_LIGHT_TEMPS before broadcasting", () => {
    const guardIdx = handlerBody.search(/!\s*VALID_LIGHT_TEMPS\.has\s*\(\s*temp\s*\)/);
    const broadcastIdx = handlerBody.search(/BrowserWindow\.getAllWindows\s*\(\s*\)\s*\.forEach/);
    assert.ok(guardIdx >= 0, 'allowlist guard missing from handler body');
    assert.ok(broadcastIdx >= 0, 'BrowserWindow.getAllWindows().forEach broadcast missing from handler body');
    assert.ok(guardIdx < broadcastIdx, 'BUG: allowlist guard must appear BEFORE the BrowserWindow broadcast.');
    assert.ok(
        /\breturn\b/.test(handlerBody.slice(guardIdx, broadcastIdx)),
        'BUG: the allowlist guard must `return` early before the broadcast.',
    );
});

test('ipcHandlers.ts allowlist matches src/lib/lightThemeTemperature.ts source of truth', () => {
    const aliasRe = /export\s+type\s+LightThemeTemperature\s*=\s*([^;]+);/;
    const aliasMatch = aliasRe.exec(tempSource);
    assert.ok(aliasMatch, 'could not locate LightThemeTemperature type alias');
    const aliasLiterals = [...aliasMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
    assert.deepEqual(aliasLiterals.slice().sort(), EXPECTED_TEMPS.slice().sort());

    const validRe = /VALID_TEMPS\s*:\s*[^=]+=\s*new\s+Set\s*(?:<[^>]+>)?\s*\(\s*\[([^\]]+)\]\s*\)/;
    const validMatch = validRe.exec(tempSource);
    assert.ok(validMatch, 'could not locate VALID_TEMPS Set in lightThemeTemperature.ts');
    const validLiterals = [...validMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
    assert.deepEqual(validLiterals.slice().sort(), EXPECTED_TEMPS.slice().sort());

    const ipcSetMatch = /VALID_LIGHT_TEMPS\s*=\s*new\s+Set\s*(?:<[^>]+>)?\s*\(\s*\[([^\]]+)\]\s*\)/.exec(ipcSource);
    assert.ok(ipcSetMatch, 'ipcHandlers.ts VALID_LIGHT_TEMPS declaration not found');
    const ipcLiterals = [...ipcSetMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
    assert.deepEqual(
        ipcLiterals.slice().sort(),
        validLiterals.slice().sort(),
        'BUG: ipcHandlers.ts VALID_LIGHT_TEMPS is out of sync with lightThemeTemperature.ts VALID_TEMPS.',
    );
});
