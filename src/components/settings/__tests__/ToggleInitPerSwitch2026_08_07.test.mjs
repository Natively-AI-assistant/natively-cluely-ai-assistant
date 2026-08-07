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
            // A knob that moves via translate-x AND sits in a rounded track.
            if (/translate-x-\[?1[02]px\]?|translate-x-5/.test(src) && /rounded-full/.test(src)) {
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
        assert.match(HOOK, /handlers:\s*\{/);
    });

    test('arming ignores navigation keys so tabbing through cannot arm a switch', () => {
        // A bare onKeyDown={arm} fires for Tab too. The keydown for Tab lands on
        // the switch focus MOVES TO, arming a control the user never operated —
        // a later unrelated re-render would then bounce it.
        assert.match(HOOK, /e\?\.key === ' '/);
        assert.match(HOOK, /e\?\.key === 'Enter'/);
        assert.doesNotMatch(
            HOOK, /onKeyDown:\s*arm\b/,
            'onKeyDown must filter to activation keys, not arm on every keydown',
        );
    });
});
