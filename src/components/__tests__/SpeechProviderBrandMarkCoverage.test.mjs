/**
 * SpeechProviderBrandMarkCoverage.test.mjs
 *
 * THE RISK THIS PINS: the speech provider dropdown in Settings → Audio lists ten
 * providers. Every one of them used to render the same generic lucide <Mic>
 * glyph — not by decision, but by accretion: each provider added over time
 * copied the previous row, microphone icon included, and nothing ever failed.
 * The list became ten visually identical rows distinguishable only by reading.
 *
 * That failure mode is silent by construction, so this guard makes it loud. It
 * is a pure source-text scan — no build, no DOM, no bundler — because the thing
 * being protected is the *wiring* between three artifacts that have no runtime
 * link: the option list in SettingsOverlay.tsx, the registry in BrandMark.tsx,
 * and the vendored SVG files themselves.
 *
 * It asserts four things:
 *
 *   1. Every option id in the selector resolves to a real mark, an explicitly
 *      exempt monogram, or our own logo component. Adding an eleventh provider
 *      without an icon fails here.
 *   2. No option has regressed to the generic <Mic> glyph.
 *   3. Every id in BRAND_MARKS points at an SVG that exists on disk, and every
 *      marked row asks for the neutral tile.
 *   4. Every vendored mark is `1em`-sized, and every mark tinted via BRAND_COLORS
 *      actually paints with `fill="currentColor"`.
 *
 * (4) is the subtle one and the reason this file earns its keep. <BrandMark>
 * sizes marks by setting font-size, which a dimensionless SVG ignores entirely,
 * and it applies a published brand hex via `color`, which only reaches a mark
 * that paints with currentColor. Upstream simple-icons ships deepgram.svg with
 * BOTH faults — no dimensions and no fill — and both are corrected by hand at
 * vendor time (documented in src/assets/provider-logos/README.md). Any future
 * re-vendor that forgets silently ships a black, mis-sized icon.
 *
 * Run: `node --test src/components/__tests__/SpeechProviderBrandMarkCoverage.test.mjs`
 * (no build step required — pure source-text scan)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

const SETTINGS_OVERLAY = join(REPO_ROOT, 'src/components/SettingsOverlay.tsx');
const BRAND_MARK = join(REPO_ROOT, 'src/components/ui/BrandMark.tsx');
const LOGO_DIR = join(REPO_ROOT, 'src/assets/provider-logos');

const overlaySrc = readFileSync(SETTINGS_OVERLAY, 'utf8');
const brandMarkSrc = readFileSync(BRAND_MARK, 'utf8');

/**
 * Slice out the single <ProviderSelect> options array. There is exactly one call
 * site; if that ever stops being true this throws rather than silently scanning
 * the wrong list.
 */
function extractSpeechOptions() {
    // The delimiter matters: a bare '<ProviderSelect' also matches the type
    // position in `React.FC<ProviderSelectProps>`. Requiring whitespace or '>'
    // after the name keeps this to real JSX usage.
    const JSX_USAGE = /<ProviderSelect[\s>]/g;
    const callSites = [...overlaySrc.matchAll(JSX_USAGE)];
    assert.equal(
        callSites.length,
        1,
        `Expected exactly 1 <ProviderSelect> call site in SettingsOverlay.tsx, found ${callSites.length}. ` +
        `If a second selector was added, this guard must be taught which one is the speech provider list.`,
    );

    const start = callSites[0].index;
    const optionsStart = overlaySrc.indexOf('options={[', start);
    assert.ok(optionsStart > -1, 'Could not locate the options={[ array of <ProviderSelect>');

    const end = overlaySrc.indexOf(']}', optionsStart);
    assert.ok(end > -1, 'Could not locate the end of the <ProviderSelect> options array');

    return overlaySrc.slice(optionsStart, end);
}

const optionsBlock = extractSpeechOptions();

/** [{ id, icon }] for every row in the selector. */
function parseOptionRows() {
    const rows = [];
    for (const line of optionsBlock.split('\n')) {
        const idMatch = line.match(/\{\s*id:\s*'([^']+)'/);
        if (!idMatch) continue;
        const iconMatch = line.match(/icon:\s*(<[^>]+>)/);
        rows.push({ id: idMatch[1], icon: iconMatch ? iconMatch[1] : null, line });
    }
    return rows;
}

/**
 * Every provider id a row's <BrandMark> could resolve to, or null when the row
 * does not render a BrandMark at all.
 *
 * Returns a LIST because the provider may be a platform expression rather than a
 * literal — Local Models renders `provider={isMac ? 'apple' : 'microsoft'}`, and
 * both branches ship, so both must resolve. Checking only the macOS branch would
 * let a broken Windows icon through on the machine where nobody looks at it.
 */
function providersInIcon(icon) {
    if (!icon || !/<BrandMark\b/.test(icon)) return null;
    return [...icon.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
}

/** `key → value` pairs of an exported object literal in BrandMark.tsx. */
function parseRegistry(exportName) {
    const start = brandMarkSrc.indexOf(`export const ${exportName}`);
    assert.ok(start > -1, `${exportName} not found in BrandMark.tsx`);
    const open = brandMarkSrc.indexOf('{', start);
    const close = brandMarkSrc.indexOf('};', open);
    const body = brandMarkSrc.slice(open, close);

    const entries = new Map();
    for (const line of body.split('\n')) {
        // Skip comment lines so a provider named in prose is never mistaken for
        // a registry entry.
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        const m = line.match(/^\s*'?([a-zA-Z][\w-]*)'?\s*:\s*(.+?),?\s*$/);
        if (m) entries.set(m[1], m[2].replace(/,$/, '').replace(/^'|'$/g, ''));
    }
    return entries;
}

const parseRegistryKeys = (exportName) => new Set(parseRegistry(exportName).keys());

/**
 * Imported identifier → asset filename, e.g. `googlecloudMark` → `googlecloud.svg`.
 *
 * Resolution goes through the IDENTIFIER rather than guessing a filename from the
 * provider id. Those two deliberately diverge — `google` is backed by
 * `googlecloud.svg`, `ibmwatson` by `ibm.svg`, and `local-whisper` reuses
 * `openai.svg` — so any convention-based mapping would be wrong for three of
 * eight entries.
 */
function parseMarkImports() {
    const imports = new Map();
    // Inlined SVGs, from src/assets/provider-logos/.
    for (const m of brandMarkSrc.matchAll(
        /import\s+(\w+)\s+from\s+'\.\.\/\.\.\/assets\/provider-logos\/([\w-]+\.svg)\?raw'/g,
    )) {
        imports.set(m[1], resolve(LOGO_DIR, m[2]));
    }
    // Raster marks, imported as URLs. The Natively app icon lives at the repo
    // root rather than under src/, so this resolves the path rather than
    // assuming a directory.
    for (const m of brandMarkSrc.matchAll(
        /import\s+(\w+)\s+from\s+'([^']+\.(?:png|jpg|webp))'/g,
    )) {
        imports.set(m[1], resolve(dirname(BRAND_MARK), m[2]));
    }
    return imports;
}

const optionRows = parseOptionRows();
/** Every id backed by a real mark, vector or raster. */
const markKeys = new Set([
    ...parseRegistryKeys('BRAND_MARKS'),
    ...parseRegistryKeys('BRAND_MARK_IMAGES'),
]);
const exemptKeys = parseRegistryKeys('BRAND_MARK_EXEMPT');

describe('speech provider brand mark coverage', () => {
    test('the selector still lists the expected provider set', () => {
        // Sanity check on the parser itself: if the extraction silently matched
        // nothing, every assertion below would vacuously pass.
        assert.ok(
            optionRows.length >= 9,
            `Parsed only ${optionRows.length} options from the speech selector — the parser is probably broken, ` +
            `not the source. Expected at least 9.`,
        );
        assert.ok(optionRows.some((r) => r.id === 'soniox'), 'Expected a soniox option');
        assert.ok(optionRows.some((r) => r.id === 'deepgram'), 'Expected a deepgram option');
    });

    test('every option resolves to a brand mark, an exempt monogram, or our own logo', () => {
        for (const { id, icon } of optionRows) {
            assert.ok(icon, `Option '${id}' has no icon: prop at all`);

            const providers = providersInIcon(icon);

            if (providers) {
                // Rows are classified by WHAT THEY RENDER, not by whether their own
                // id is a registry key. Local Models is the case that forces this:
                // it is not a brand, but it renders the host OS mark, so its
                // provider is `apple`/`microsoft` rather than its own id.
                assert.ok(
                    providers.length > 0,
                    `Option '${id}' renders <BrandMark> but no provider string could be parsed from it`,
                );
                for (const p of providers) {
                    assert.ok(
                        markKeys.has(p),
                        `Option '${id}' renders <BrandMark provider="${p}" />, but '${p}' is not a key of ` +
                        `BRAND_MARKS or BRAND_MARK_IMAGES — it would resolve to nothing and paint an empty tile.`,
                    );
                }
                continue;
            }

            if (/<BrandMonogram\b/.test(icon)) {
                assert.ok(
                    exemptKeys.has(id),
                    `Option '${id}' falls back to a <BrandMonogram> but is not listed in BRAND_MARK_EXEMPT. ` +
                    `Record why no mark exists, so a genuine oversight cannot hide as a deliberate monogram.`,
                );
                continue;
            }

            assert.fail(
                `Speech provider '${id}' renders neither a <BrandMark> nor a <BrandMonogram>: ${icon}\n` +
                `Either vendor its official mark into src/assets/provider-logos/ and register it, or — if no\n` +
                `licence-compatible mark exists — add it to BRAND_MARK_EXEMPT with the reason and render a\n` +
                `<BrandMonogram>. See src/assets/provider-logos/README.md.`,
            );
        }
    });

    test('rows carrying a brand mark ask for the neutral tile', () => {
        // The tint and a brand-coloured mark are mutually exclusive treatments;
        // a row that has a mark but keeps its tint puts a multicolour logo on a
        // coloured wash, which is the exact thing the neutral tile exists to avoid.
        for (const { id, line, icon } of optionRows) {
            if (!providersInIcon(icon)) continue;
            assert.match(
                line,
                /neutralTile:\s*true|tileClassName:/,
                `Option '${id}' renders an official brand mark but sets neither neutralTile: true nor an ` +
                `explicit tileClassName, so its mark will paint over the per-provider tint.`,
            );
        }

        // ...and the converse: a row with no mark of its own must not go neutral,
        // or it would be left with no colour at all. It may still opt into an
        // explicit brand treatment (Soniox's white-on-black monogram).
        for (const { id, line, icon } of optionRows) {
            if (providersInIcon(icon)) continue;
            assert.doesNotMatch(
                line,
                /neutralTile:\s*true/,
                `Option '${id}' has no brand mark, so it must keep its per-provider tint or set an explicit ` +
                `tileClassName — a neutral tile would leave it with no colour at all.`,
            );
        }
    });

    test('no option has regressed to the generic microphone glyph', () => {
        // <Mic> specifically: every row in this list once shared that one icon, and
        // that is the regression this guard exists to prevent. A row that is
        // legitimately not a brand may still carry a purposeful glyph — Local
        // Models uses <Cpu> to say "runs on your machine" — but it must be
        // declared in BRAND_MARK_EXEMPT with the reason, not left to drift.
        const generic = optionRows.filter(
            (r) => r.icon && /<Mic\b/.test(r.icon) && !exemptKeys.has(r.id),
        );
        assert.deepEqual(
            generic.map((r) => r.id),
            [],
            `These speech providers render the generic microphone glyph instead of a brand mark.`,
        );
    });

    test('every registered mark points at an asset that exists on disk', () => {
        const imports = parseMarkImports();
        assert.ok(imports.size > 0, 'Parsed no asset imports from BrandMark.tsx — the parser is broken');

        for (const registry of ['BRAND_MARKS', 'BRAND_MARK_IMAGES']) {
            for (const [id, identifier] of parseRegistry(registry)) {
                assert.ok(
                    imports.has(identifier),
                    `${registry}['${id}'] is ${identifier}, which BrandMark.tsx never imports as an asset`,
                );
                const file = imports.get(identifier);
                assert.ok(
                    existsSync(file),
                    `${registry}['${id}'] resolves to ${file}, which does not exist on disk`,
                );
            }
        }
    });

    test('the vector and raster registries do not overlap', () => {
        // BrandMark checks BRAND_MARKS first, so an id in both would render the
        // inlined SVG and silently ignore its raster entry.
        const vector = parseRegistryKeys('BRAND_MARKS');
        const raster = parseRegistryKeys('BRAND_MARK_IMAGES');
        const both = [...raster].filter((id) => vector.has(id));
        assert.deepEqual(
            both,
            [],
            `These ids appear in BOTH BRAND_MARKS and BRAND_MARK_IMAGES. BrandMark resolves the inlined SVG ` +
            `first, so the raster entry would never render.`,
        );
    });

    test('every vendored mark is 1em-sized', () => {
        const imported = [...brandMarkSrc.matchAll(/from '\.\.\/\.\.\/assets\/provider-logos\/([\w-]+\.svg)\?raw'/g)]
            .map((m) => m[1]);

        assert.ok(imported.length > 0, 'Parsed no SVG imports from BrandMark.tsx — the parser is broken');

        for (const name of imported) {
            const svg = readFileSync(join(LOGO_DIR, name), 'utf8');
            const root = svg.match(/<svg[^>]*>/);
            assert.ok(root, `${name} has no root <svg> element`);

            assert.match(
                root[0],
                /width="1em"/,
                `${name} is not width="1em". <BrandMark> sizes marks by setting font-size, which a mark with ` +
                `fixed or absent dimensions ignores. simple-icons ships deepgram.svg dimensionless — normalise ` +
                `it by hand (see the README).`,
            );
        }
    });

    test('every mark tinted by BRAND_COLORS paints with currentColor', () => {
        // A published brand hex is delivered as `color` on the wrapper, which only
        // reaches a mark whose fill is currentColor. A full-colour mark would
        // silently ignore it — so the two registries have to agree.
        const colorKeys = parseRegistryKeys('BRAND_COLORS');
        assert.ok(colorKeys.size > 0, 'Parsed no BRAND_COLORS entries — the parser is broken');

        for (const id of colorKeys) {
            assert.ok(
                markKeys.has(id),
                `BRAND_COLORS has '${id}' but BRAND_MARKS does not — the tint applies to nothing.`,
            );

            const file = parseMarkImports().get(parseRegistry('BRAND_MARKS').get(id));
            assert.ok(file, `Could not resolve the asset backing BRAND_COLORS['${id}']`);

            const root = readFileSync(file, 'utf8').match(/<svg[^>]*>/)[0];

            assert.match(
                root,
                /fill="currentColor"/,
                `${file} backs BRAND_COLORS['${id}'] but does not paint with fill="currentColor", so the ` +
                `published brand hex never reaches it — and with no fill at all it renders black and vanishes ` +
                `in the dark theme. simple-icons ships deepgram.svg without it; re-add it by hand (see the README).`,
            );
        }
    });
});
