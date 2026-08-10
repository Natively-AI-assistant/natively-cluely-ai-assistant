// Guards the per-switch scope of useToggleInit().
//
// THE BUG THIS PREVENTS. `.is-init` is what arms the shared toggle bounce:
//   .t-toggle.is-init[data-on="false"] .t-toggle-thumb { animation: t-toggle-off ... }
// SettingsOverlay originally called useToggleInit() ONCE for the whole panel and
// spread the resulting flag across all nine switches. Flipping any one switch
// set `.is-init` on all nine in the same render, so every switch sitting at
// data-on="false" immediately played the off-bounce from a standing start —
// the whole settings panel visibly flickering on a single click. The same rule
// fires when async settings hydration lands after mount and flips several
// data-on values at once, which is why it also showed up "soon after restart".
//
// The invariant: a hook call must be scoped to ONE rendered switch. A component
// that renders N switches must not call useToggleInit() once at its top level.
//
// These are source-level assertions because the renderer test runner cannot
// import .tsx at runtime (see TToggle's earlier suite for the same constraint).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8');

const SETTINGS_OVERLAY = read('../../SettingsOverlay.tsx');
const PHONE_MIRROR = read('../PhoneMirrorSettings.tsx');
const SETTINGS_POPUP = read('../../SettingsPopup.tsx');
const PROFILE_INTELLIGENCE = read('../../ProfileIntelligenceSettings.tsx');
const LAUNCHER = read('../../Launcher.tsx');
const SETTINGS_TOGGLE = read('../SettingsToggle.tsx');
const HOOK = read('../useToggleInit.ts');

/**
 * Strip comments so docstring usage examples don't count as real code — the
 * hook's own doc block shows a sample switch, and SettingsToggle's shows a
 * sample hook call.
 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')   // block + JSDoc
        .replace(/^\s*\/\/.*$/gm, '');      // line comments
}
/**
 * How many switch elements a file actually renders. Counts `role="switch"`
 * rather than the `t-toggle` class, so the `.t-toggle-thumb` child (which also
 * starts with "t-toggle") is not miscounted as a second switch.
 */
function countSwitches(src) {
    return (stripComments(src).match(/role="switch"/g) || []).length;
}
/** How many times the file actually calls the hook. */
function countHookCalls(src) {
    return (stripComments(src).match(/useToggleInit\(\)/g) || []).length;
}

describe('useToggleInit is scoped per switch', () => {
    test('SettingsOverlay renders switches via a component, not a panel-level flag', () => {
        // The regression shape: one hook call at panel level, many switches.
        assert.equal(
            countHookCalls(SETTINGS_OVERLAY), 0,
            'SettingsOverlay must not call useToggleInit() itself — its switches go through <SettingsToggle>, which owns one hook per instance',
        );
        assert.ok(
            SETTINGS_OVERLAY.includes('<SettingsToggle'),
            'SettingsOverlay should render <SettingsToggle>',
        );
    });

    test('no file spreads one init flag across multiple switches', () => {
        for (const [name, src] of [
            ['SettingsOverlay.tsx', SETTINGS_OVERLAY],
            ['PhoneMirrorSettings.tsx', PHONE_MIRROR],
            ['SettingsPopup.tsx', SETTINGS_POPUP],
            // PI holds a top-level hook because it renders exactly ONE switch.
            // Listed so that adding a second switch there trips this check
            // rather than silently reintroducing the panel-wide flicker.
            ['ProfileIntelligenceSettings.tsx', PROFILE_INTELLIGENCE],
            ['Launcher.tsx', LAUNCHER],
        ]) {
            const switches = countSwitches(src);
            const calls = countHookCalls(src);
            if (switches > 1) {
                assert.ok(
                    calls === 0 || calls >= switches,
                    `${name} renders ${switches} switches but calls useToggleInit() ${calls} time(s) — a single flag shared across switches makes every OFF switch bounce when any one is touched`,
                );
            }
        }
    });

    test('SettingsToggle owns exactly one hook call for its single switch', () => {
        assert.equal(countHookCalls(SETTINGS_TOGGLE), 1);
        assert.equal(countSwitches(SETTINGS_TOGGLE), 1);
    });

    test('no hand-rolled toggle survives anywhere in src/', () => {
        // The pre-migration idiom was a translate-x knob with its own
        // transition, which slides linearly with no double bounce. Five of
        // these sat unmigrated in SettingsPopup for a while precisely because
        // nothing failed when they were missed.
        const files = readdirSync(join(HERE, '../../..'), { recursive: true })
            .filter((f) => typeof f === 'string' && f.endsWith('.tsx') && !f.includes('__tests__'));
        const offenders = [];
        for (const rel of files) {
            const src = stripComments(readFileSync(join(HERE, '../../..', rel), 'utf8'));
            // Match the KNOB itself: one element that is round, filled, and
            // moved by translate-x. Matching translate-x anywhere in the file
            // is too blunt — hover nudges like `group-hover:translate-x-0.5` on
            // a chevron are not toggles.
            //
            // Deliberately not an enumerated list of offsets: an earlier
            // version matched only 10px/12px/`-5`, so Launcher.tsx's
            // `translate-x-4` sailed through and stayed unmigrated after the
            // rollout was declared complete.
            // Scan each className="..." / className={...} region as a whole and
            // ask whether the SAME element is both round and translate-x-moved.
            //
            // Not a `[^`'"]*` run between the two: a template literal's
            // `${cond ? 'translate-x-4' : ...}` contains nested quotes, so such
            // a run stops dead at the first one and the knob escapes. That is
            // exactly how Launcher.tsx stayed unmigrated.
            //
            // `(?<![:\w-])` rejects variant-prefixed utilities like
            // `group-hover/btn:translate-x-[1px]` — hover nudges on icons, not
            // a knob's resting position.
            const TX = /(?<![:\w-])translate-x-(?:\[[^\]]+\]|\d)/;
            const regions = src.match(/className=(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})/g) || [];
            if (regions.some((r) => /\brounded-full\b/.test(r) && TX.test(r))) {
                offenders.push(rel);
            }
        }
        assert.deepEqual(
            offenders, [],
            'these files still hand-roll a toggle instead of using .t-toggle / .t-toggle-thumb',
        );
    });

    test('hook exposes a class fragment, not a bare boolean', () => {
        // Returning `className` rather than `isInit` is deliberate: a ready-made
        // string is awkward to spread across several buttons, so the wrong shape
        // is harder to write by accident.
        assert.match(HOOK, /className:\s*isInit \? 'is-init' : ''/);
    });

    test('the hook does not arm from a pointer/key handler of its own', () => {
        // THE GLITCH THIS PREVENTS. `is-init` and the new `data-on` must land in
        // the SAME render. Arming on pointerdown is a render EARLIER than the
        // click that flips data-on, so the intermediate render matches
        // `.t-toggle.is-init[data-on="false"]` and plays `t-toggle-off` while
        // the thumb is already at rest — its 55% keyframe kicks the thumb to
        // -1px. On the first click of an OFF switch the thumb appeared to go
        // on, snap back off, then travel on again.
        //
        // So the hook must expose only `arm()`, called from the same handler
        // that changes state. It must not ship its own onPointerDown/onKeyDown.
        assert.doesNotMatch(
            HOOK, /onPointerDown/,
            'the hook must not arm on pointerdown — that is a render before data-on flips',
        );
        assert.doesNotMatch(
            HOOK, /handlers:\s*\{/,
            'the hook must not expose a handlers bundle; callers call arm() from their own onClick',
        );
        assert.match(HOOK, /arm:\s*\(\)\s*=>\s*void|arm\b/);
    });

    test('every switch arms from the handler that changes its state', () => {
        // If a call site renders a switch but never calls arm(), that switch
        // silently never animates.
        for (const [name, src] of [
            ['SettingsToggle.tsx', SETTINGS_TOGGLE],
            ['PhoneMirrorSettings.tsx', PHONE_MIRROR],
            ['SettingsPopup.tsx', SETTINGS_POPUP],
        ]) {
            const clean = stripComments(src);
            if (countSwitches(clean) === 0) continue;
            assert.match(
                clean, /\.arm\(\)/,
                `${name} renders a switch but never calls arm() — that switch will never animate`,
            );
            assert.doesNotMatch(
                clean, /\.\.\.\w*[Tt]oggleInit\.handlers/,
                `${name} still spreads a handlers bundle, which arms a render too early`,
            );
        }
    });
});
