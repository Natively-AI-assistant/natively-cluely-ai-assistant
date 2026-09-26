// Guards that Plans & Billing animates on the compositor, not on layout.
//
// WHY THIS EXISTS. This tab was first built animating `height` and `marginTop`
// between 0 and auto on every region that appeared or disappeared — eighteen of
// them. Both are LAYOUT properties: each frame ran layout and then paint for the
// animating element and everything below it in the flow. The repainted subtree
// here carries stacked radial-gradient tier fills, 12-32px blur shadows and two
// pseudo-element layers, and each wrapper had `overflow: hidden` with changing
// bounds — which defeats layer caching by definition, since a layer whose size
// changes must be re-rasterised rather than re-composited. It visibly stuttered.
//
// The rewrite computes the final layout ONCE and animates transforms between the
// old and new positions: the leaving region is popped out of flow
// (AnimatePresence mode="popLayout"), the entering region takes its space
// immediately at opacity 0, and everything that merely shifts carries
// `layout="position"` — which emits `transform: translate()` only, never
// `scale`, so borders and radii are not distorted.
//
// The distinction is invisible in a screenshot and easy to undo by accident: a
// future `height: 'auto'` added to a region wrapper would look correct and
// silently restore per-frame layout. Hence this test.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(HERE, rel), 'utf8');

const FILES = {
    api: read('../settings/NativelyApiSettings.tsx'),
    plans: read('../settings/PlansSettings.tsx'),
    pro: read('../settings/NativelyProSettings.tsx'),
};

/** Strip both comment styles so prose about the old approach never trips this. */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * The page-level region wrappers, by their `key`. These are the elements whose
 * animation used to cost a layout pass per frame; the rule is about them
 * specifically, not about every motion element in the tree.
 */
const REGION_KEYS = ['api-plans', 'api-usage', 'api-change-plan', 'pro-section'];

/** The block of props for a motion element carrying `key="<name>"`. */
function regionProps(name) {
    for (const src of Object.values(FILES)) {
        const clean = stripComments(src);
        const i = clean.indexOf(`key="${name}"`);
        if (i === -1) continue;
        // Props run from the key to the end of the opening tag.
        const end = clean.indexOf('\n          >', i) + 1 || clean.indexOf('>', i);
        return clean.slice(i, clean.indexOf('>', Math.max(end - 1, i)) + 1);
    }
    return null;
}

describe('Plans & Billing — composited motion', () => {
    test('every region wrapper this rule governs still exists', () => {
        // Without this, renaming a key would make every assertion below pass
        // vacuously while the regression it guards ships.
        for (const key of REGION_KEYS) {
            assert.ok(regionProps(key), `region "${key}" not found — was it renamed?`);
        }
    });

    test('no region wrapper animates a layout property', () => {
        // `height`, `marginTop`, `width`, `padding`, `top`/`left` all force
        // layout. `transform`, `opacity`, `scale` do not.
        const LAYOUT_PROPS = /\b(height|marginTop|marginBottom|width|paddingTop|paddingBottom|top|left)\s*:/;
        for (const key of REGION_KEYS) {
            const props = regionProps(key);
            // Only the animation targets matter — `style={{ width: '100%' }}` is
            // a static declaration, not an animated one, and is REQUIRED by
            // popLayout (an absolutely-positioned child would otherwise collapse
            // to content width).
            for (const attr of ['initial', 'animate', 'exit']) {
                const m = props.match(new RegExp(`${attr}=\\{([\\s\\S]*?)\\}\\s*\\n`));
                if (!m) continue;
                assert.ok(
                    !LAYOUT_PROPS.test(m[1]),
                    `${key} animates a layout property in \`${attr}\`: ${m[1].trim().slice(0, 120)}`,
                );
            }
        }
    });

    test('regions that leave are popped out of flow', () => {
        // Without mode="popLayout" the exiting child stays in the flow for the
        // duration of its exit, so the space below it cannot close until the
        // animation ends — which is what forces a height animation back in.
        //
        // Scoped to the AnimatePresence that actually wraps a page REGION. The
        // tier-card swap inside the pricing card is a different mechanism: its
        // children are `absolute inset-0` crossfades that never participate in
        // the flow, so popLayout would be meaningless there.
        for (const key of REGION_KEYS) {
            const src = Object.values(FILES).find((f) => stripComments(f).includes(`key="${key}"`));
            const clean = stripComments(src);
            const at = clean.indexOf(`key="${key}"`);
            const wrapper = clean.lastIndexOf('<AnimatePresence', at);
            assert.notEqual(wrapper, -1, `${key} is not inside an AnimatePresence`);
            const tag = clean.slice(wrapper, clean.indexOf('>', wrapper));
            assert.match(tag, /mode="popLayout"/, `the AnimatePresence wrapping ${key} is missing mode="popLayout"`);
        }
    });

    test('popLayout children declare an explicit width', () => {
        // popLayout sets position:absolute on the exiting child; without a width
        // it collapses to content width the instant it pops, giving a visible
        // horizontal snap before the fade.
        for (const key of REGION_KEYS) {
            const props = regionProps(key);
            assert.match(props, /width:\s*'100%'/, `${key} has no explicit width for popLayout`);
        }
    });

    test('layout FLIP never falls back to its default spring', () => {
        // `layout` transitions default to a spring, silently discarding the
        // house curves. Every file using the prop must name a layout transition.
        for (const [name, src] of Object.entries(FILES)) {
            const clean = stripComments(src);
            if (!clean.includes('layout="position"')) continue;
            assert.match(clean, /layout:\s*\{\s*duration:/, `${name}: layout="position" with no explicit layout transition`);
        }
    });

    test('no region composites a y-translate on top of the FLIP', () => {
        // FLIP already owns all vertical motion. A `y` on the same element adds
        // a second translation, which reads as busy rather than considered.
        for (const key of REGION_KEYS) {
            const props = regionProps(key);
            assert.ok(!/\by:\s*-?\d/.test(props), `${key} sets a y offset on top of layout FLIP`);
        }
    });

    test('the scroll container disables scroll anchoring', () => {
        // Chromium adjusts scrollTop when content above the viewport changes
        // size. Mid-transition it does so repeatedly, producing micro-jumps that
        // read as choppiness and are independent of frame rate.
        const overlay = read('../SettingsOverlay.tsx');
        assert.match(overlay, /overflowAnchor:\s*'none'/, 'settings scroll container re-enabled scroll anchoring');
    });

    test('no non-compositable property is hinted to will-change', () => {
        // `will-change: box-shadow` buys a permanent extra layer and no
        // acceleration, since box-shadow is not compositable.
        const css = read('../../index.css').replace(/\/\*[\s\S]*?\*\//g, '');
        const bad = css.match(/will-change:[^;]*\b(box-shadow|height|width|margin[a-z-]*)\b[^;]*;/g);
        assert.equal(bad, null, `non-compositable will-change hints: ${bad?.join(' | ')}`);
    });
});
