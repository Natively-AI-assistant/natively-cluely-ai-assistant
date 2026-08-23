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
        assert.ok(RULES.length >= 16, `expected >=16 shadow rules, found ${RULES.length}`);
        assert.ok(RULES.some((r) => r.selector.includes(':hover')), 'no hover rule found');
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

    test('no :hover rule changes border-color', () => {
        for (const { selector } of RULES) {
            if (!selector.includes(':hover')) continue;
            const body = LIVE.slice(LIVE.indexOf(selector));
            const block = body.slice(0, body.indexOf('}'));
            // Anchored to a DECLARATION, not the bare substring: `transition:
            // box-shadow 260ms ..., border-color 260ms ...` legitimately
            // contains "border-color" while changing nothing about the outline.
            assert.ok(
                !/^\s*border-color\s*:/m.test(block),
                `${selector} sets border-color; only [data-active] may change the outline`,
            );
        }
    });

    test('hover never changes the rim (slot 1) of the state it overrides', () => {
        // Pairs each :hover rule with the resting rule for the same tier and
        // theme, and asserts slot 1 is byte-identical.
        const rimOf = (r) => splitShadows(r.shadow)[0].replace(/\s+/g, ' ').trim();
        const key = (sel) => {
            const tier = sel.match(/detail-card-(standard|pro|max|ultra)/)?.[1];
            const light = sel.includes("data-theme='light'");
            const active = sel.includes('data-active');
            return tier ? `${tier}|${light}|${active}` : null;
        };

        const rest = new Map();
        for (const r of RULES) {
            if (r.selector.includes(':hover')) continue;
            const k = key(r.selector);
            // Theme-scoped duplicates exist (liquid-glass vs modern); the last
            // one in source order is what paints, so let it overwrite.
            if (k) rest.set(k, rimOf(r));
        }

        let checked = 0;
        for (const r of RULES) {
            if (!r.selector.includes(':hover')) continue;
            const k = key(r.selector);
            if (!k || !rest.has(k)) continue;
            assert.equal(
                rimOf(r), rest.get(k),
                `${r.selector} changes the rim on hover — that is the border highlight`,
            );
            checked++;
        }
        assert.ok(checked >= 8, `expected >=8 hover/rest pairs, compared ${checked}`);
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

    test('transform is not CSS-transitioned on the card Framer drives', () => {
        // InteractiveCard writes transform: scale(...) inline from a spring on
        // every frame; a CSS transition on the same property re-smooths each
        // write and makes the press lag.
        for (const theme of ['liquid-glass', 'modern']) {
            const sel = `[data-interface-theme="${theme}"] .natively-api-detail-card {`;
            const i = LIVE.indexOf(sel);
            assert.notEqual(i, -1, `${sel} not found`);
            const block = LIVE.slice(i, LIVE.indexOf('}', i));
            const transition = block.match(/transition:([^;]*);/)?.[1] ?? '';
            assert.ok(
                !/\btransform\b/.test(transition),
                `${theme} still transitions transform: ${transition.trim()}`,
            );
        }
    });
});
