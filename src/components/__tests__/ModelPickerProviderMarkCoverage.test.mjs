/**
 * ModelPickerProviderMarkCoverage.test.mjs
 *
 * The overlay's model picker used to render
 *   `provider === 'gemini' ? <Monitor/> : <Cloud/>`
 * so every Nvidia Nim, OpenAI, Claude, DeepSeek and Groq row shipped with a
 * generic cloud glyph — the same "everything shares one placeholder" failure the
 * speech selector had, on a surface nobody was checking.
 *
 * This pins the link: every provider STANDARD_CLOUD_MODELS can emit, plus the
 * Natively row the picker adds itself, must resolve to a real mark in
 * ui/aiProviderMarks. A new provider added to modelUtils without a mark fails
 * here instead of shipping as a cloud glyph.
 *
 * Source-read rather than import: these are .tsx/.ts with `?raw` asset imports
 * that only Vite can resolve, so the test parses the registries out of the files.
 *
 * Run: `node --test src/components/__tests__/ModelPickerProviderMarkCoverage.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MARKS = join(REPO_ROOT, 'src/components/ui/aiProviderMarks.ts');
const PICKER = join(REPO_ROOT, 'src/components/ui/ModelSelector.tsx');
const MODEL_UTILS = join(REPO_ROOT, 'src/utils/modelUtils.ts');

const marksSrc = readFileSync(MARKS, 'utf8');
const pickerSrc = readFileSync(PICKER, 'utf8');
const modelUtilsSrc = readFileSync(MODEL_UTILS, 'utf8');

/**
 * TOP-LEVEL keys of an `export const NAME ... = { ... }` object literal.
 * Depth-tracked: STANDARD_CLOUD_MODELS nests a config object under each
 * provider, and a flat line scan would return `ids`/`names`/`pmKey` instead of
 * the provider ids — which passes the wrong list to the assertion and reds a
 * healthy tree.
 */
function registryKeys(src, name) {
    const decl = src.indexOf(`export const ${name}`);
    assert.notEqual(decl, -1, `${name} not found — was it renamed?`);
    // Skip the type annotation: `Record<string, { ... }> = {` also contains
    // braces, so anchor on the LAST `= {` that opens the value literal.
    const open = src.indexOf('= {', decl);
    assert.notEqual(open, -1, `${name} literal not parseable`);

    const keys = [];
    let depth = 0;
    let buf = '';
    const take = () => {
        const m = buf.trim().replace(/^\/\/.*$/, '').match(/([A-Za-z0-9_]+)\s*:\s*$/)
            || buf.trim().match(/^([A-Za-z0-9_]+)\s*:/);
        if (m && !buf.trim().startsWith('//')) keys.push(m[1]);
        buf = '';
    };
    for (let i = src.indexOf('{', open); i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') {
            if (depth === 1) take();      // `gemini: {` — key precedes the brace
            else buf = '';
            depth++;
            continue;
        }
        if (ch === '}') { depth--; buf = ''; if (depth === 0) break; continue; }
        if (ch === '\n') { if (depth === 1) take(); else buf = ''; continue; }
        buf += ch;
    }
    assert.equal(depth, 0, `${name} braces did not balance`);
    return keys;
}

const markKeys = new Set([
    ...registryKeys(marksSrc, 'AI_PROVIDER_MARKS'),
    ...registryKeys(marksSrc, 'AI_PROVIDER_MARK_IMAGES'),
]);

test('the registry is non-empty — otherwise every assertion below is vacuous', () => {
    assert.ok(markKeys.size >= 8, `expected a populated registry, got ${markKeys.size}`);
    assert.ok(markKeys.has('nvidia_nim'), 'nvidia_nim must resolve to a mark');
});

test('every cloud provider the picker can list resolves to a real brand mark', () => {
    const providers = registryKeys(modelUtilsSrc, 'STANDARD_CLOUD_MODELS');
    assert.ok(providers.length >= 5, `expected the provider table, got ${providers.length}`);

    const missing = providers.filter(p => !markKeys.has(p));
    assert.deepEqual(
        missing, [],
        `these providers would render the generic <Cloud> fallback: ${missing.join(', ')}. `
        + 'Add the mark to src/components/ui/aiProviderMarks.ts — see src/assets/provider-logos/README.md.',
    );
});

test('the Natively row the picker adds itself also has a mark', () => {
    assert.match(pickerSrc, /provider: 'natively'/, 'picker no longer adds a natively row — update this test');
    assert.ok(markKeys.has('natively'), 'natively must resolve to a mark');
});

test('every registered mark points at an asset that exists on disk', () => {
    const imports = [...marksSrc.matchAll(/from '(\.\.[^']*provider-logos\/[^']+?)(\?raw)?'/g)].map(m => m[1]);
    const appIcon = [...marksSrc.matchAll(/from '(\.\.\/\.\.\/\.\.\/assets\/[^']+)'/g)].map(m => m[1]);
    const all = [...imports, ...appIcon];
    assert.ok(all.length >= 8, `expected the asset imports, got ${all.length}`);
    for (const rel of all) {
        const abs = join(REPO_ROOT, 'src/components/ui', rel);
        assert.ok(existsSync(abs), `missing asset: ${rel}`);
    }
});

test('the picker renders ProviderMark, not a bare glyph ternary', () => {
    assert.match(
        pickerSrc,
        /<ProviderMark\s+provider=\{m\.provider\}/,
        'the cloud rows must resolve their icon through ProviderMark',
    );
    assert.doesNotMatch(
        pickerSrc,
        /const icon = m\.provider === 'gemini' \?/,
        'the generic-glyph ternary is back',
    );
});

test('AIProvidersSettings sources the same registry — no second copy to drift', () => {
    const aip = readFileSync(join(REPO_ROOT, 'src/components/settings/AIProvidersSettings.tsx'), 'utf8');
    assert.match(aip, /from '\.\.\/ui\/aiProviderMarks'/, 'AI Providers must import the shared registry');
    assert.doesNotMatch(
        aip,
        /export const AIP_PROVIDER_LOGOS: Record<string, string> = \{/,
        'AIP_PROVIDER_LOGOS was re-declared as its own literal — that is the drift this split removed',
    );
});
