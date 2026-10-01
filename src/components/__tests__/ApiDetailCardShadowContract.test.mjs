// Guards the four-slot box-shadow contract on the API tier detail card.
//
// WHY THIS EXISTS. `box-shadow` interpolates as a LIST: the shorter side is
// padded with transparent shadows and each index animates pairwise — but if any
// index pair disagrees on `inset`, the whole list becomes non-interpolable and
// the browser falls back to DISCRETE interpolation, hard-flipping at 50% of the
// duration. The card shipped with rest = [inset, outer] and hover =
// [inset, inset, inset, outer, outer]; index 1 was outer-vs-inset, so three of
// the four theme/active combinations SNAPPED instead of animating. It looked
// like the transition had simply not been written.
//
// So every box-shadow on this card must be exactly four shadows in the order
// [inset rim, inset floor, outer ambient, outer contact]. That is not a style
// preference — it is what makes the property animatable at all.
//
// The second invariant: slot 1 (the rim) is a 1px line sitting directly inside
// the 1.5px tier border, so changing it on hover reads as the BORDER
// highlighting. Hover rules may therefore move slots 2-4 only. The active
// border is the one thing allowed to change this card's outline.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CSS = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../index.css'),
    'utf8',
);

/** Strip comments so commented-out examples never count as live rules. */
const LIVE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every `selector { ... }` block whose selector mentions the detail card.
 * Deliberately not a real CSS parser: the file is hand-written and flat, and a
 * regex that over-matches would fail loudly rather than silently pass.
 */
function detailCardRules() {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(LIVE))) {
        const selector = m[1].trim().split('\n').map((s) => s.trim()).join(' ');
        const body = m[2];
        if (!/\.natively-api-detail-card(-standard|-pro|-max|-ultra)?\b/.test(selector)) continue;
        // Descendant rules (the CTA, the fill pill, the "current plan" tag) are
        // separate elements with their own shadow vocabulary and their own
        // transitions — the contract is about the card surface itself, which is
        // the only thing whose rest and hover shadows have to interpolate
        // against each other.
        if (/\.natively-api-(pricing-cta|fill-pill|features-panel|active-tag)/.test(selector)) continue;
        if (/::(before|after)/.test(selector)) continue;
        const shadow = body.match(/box-shadow:([^;]*);/);
        if (!shadow) continue;
        out.push({ selector, shadow: shadow[1] });
    }
    return out;
}

/** Split a box-shadow value on top-level commas (rgba(...) contains commas). */
function splitShadows(value) {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of value.replace(/!important/g, '')) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts.filter(Boolean);
}

const RULES = detailCardRules();

describe('API detail card — four-slot box-shadow contract', () => {
    test('the rules this contract governs actually exist', () => {
        // Guards against the selectors being renamed out from under the test,
        // which would otherwise make every assertion below vacuously pass.
        assert.ok(RULES.length >= 8, `expected >=8 shadow rules, found ${RULES.length}`);
        assert.ok(RULES.some((r) => r.selector.includes('data-active')), 'no active rule found');
    });

    test('every box-shadow is exactly four shadows', () => {
        for (const { selector, shadow } of RULES) {
            const n = splitShadows(shadow).length;
            assert.equal(n, 4, `${selector} has ${n} shadows, expected 4`);
        }
    });

    test('every box-shadow is [inset, inset, outer, outer]', () => {
        // THE interpolation invariant. A single mismatched slot anywhere makes
        // the transition discrete for whichever state pair it participates in.
        for (const { selector, shadow } of RULES) {
            const pattern = splitShadows(shadow).map((s) => (/\binset\b/.test(s) ? 'I' : 'O')).join('');
            assert.equal(pattern, 'IIOO', `${selector} has shape ${pattern}, expected IIOO`);
        }
    });

    test('the card surface has no hover state', () => {
        // Removed on purpose: no bloom, no rim change, no grid brightening.
        // Anything that reintroduces one should be a deliberate decision.
        const re = /([^{}]+)\{[^{}]*\}/g;
        let m;
        while ((m = re.exec(LIVE))) {
            const selector = m[1].trim();
            if (/\.natively-api-detail-card(-standard|-pro|-max|-ultra)?(\[[^\]]*\])*:hover/.test(selector)) {
                assert.fail(`${selector} gives the API detail card a hover state`);
            }
        }
    });

    test('the blueprint grid is visible at rest in both themes', () => {
        // The light veil suppressor sets ::before to opacity 0 at (0,3,1); the
        // grid's light rule must restate opacity or the grid disappears there.
        for (const sel of [
            '[data-interface-theme] .natively-api-detail-card::before {',
            "[data-theme='light'] [data-interface-theme] .natively-api-detail-card::before {",
        ]) {
            const i = LIVE.lastIndexOf(sel);
            assert.notEqual(i, -1, `${sel} not found`);
            const block = LIVE.slice(i, LIVE.indexOf('}', i));
            const op = Number(block.match(/opacity:\s*([0-9.]+)/)?.[1] ?? NaN);
            assert.ok(op > 0, `${sel} leaves the grid at opacity ${op}`);
        }
    });

    test('no spread-only ring changes between a rest rule and its :hover', () => {
        // THE GENERALISATION. The contract above froze the CARD's rim, and the
        // border highlighting survived anyway — because the CTA inside the card
        // carried `0 0 0 3px` at rest and `0 0 0 4px` on hover. A shadow with no
        // offset and no blur is a RING: hard-edged, and visually identical to a
        // border. Animating its spread is an animated border-width; animating
        // its colour is an animated border-colour. Neither is caught by anything
        // that only inspects `border-*` properties or only inspects the card.
        //
        // So this walks the whole API pricing subtree — card AND descendants —
        // and requires every spread-only shadow to be byte-identical between a
        // rule and its :hover counterpart.
        const ringsIn = (body) => {
            const m = body.match(/box-shadow:([^;]*);/);
            if (!m) return null;
            return splitShadows(m[1])
                // `0 0 0 Npx <colour>`: first two lengths zero, third (spread)
                // non-zero. `inset` variants included — an inset ring is still a
                // ring, it just draws inside the edge.
                .filter((s) => /(^|\s)0(px)?\s+0(px)?\s+0(px)?\s+[0-9.]+px/.test(s))
                .map((s) => s.replace(/\s+/g, ' ').trim())
                .join(' | ');
        };

        const blocks = new Map();
        const re = /([^{}]+)\{([^{}]*)\}/g;
        let m;
        while ((m = re.exec(LIVE))) {
            const selector = m[1].trim().split('\n').map((s) => s.trim()).join(' ');
            if (!/\.natively-api-(detail-card|pricing-cta)/.test(selector)) continue;
            const rings = ringsIn(m[2]);
            if (rings === null) continue;
            blocks.set(selector, rings);
        }

        let compared = 0;
        for (const [selector, rings] of blocks) {
            if (!selector.includes(':hover')) continue;
            const restSelector = selector.replace(':hover', '');
            if (!blocks.has(restSelector)) continue;
            assert.equal(
                rings, blocks.get(restSelector),
                `${selector} animates a spread-only ring — that is a border highlight`,
            );
            compared++;
        }
        assert.ok(compared >= 2, `expected >=2 rest/hover ring pairs, compared ${compared}`);
    });

});
