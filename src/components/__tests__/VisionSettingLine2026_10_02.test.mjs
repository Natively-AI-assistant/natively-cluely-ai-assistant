// The "Reads images" line under a model row (Settings › AI Providers, 2026-10-02).
//
// The Auto / On / Off choice was three separate chips; it is now one control in
// the pane's own "pick one" idiom (a track with a raised pill). Two things are
// guarded here.
//
//   1. What the line SAYS, by running it (visionLine.ts is pure): every status a
//      row can show, and which of them count as "the answer in force" — the one
//      state drawn in the primary text colour. A wrong flag there would present
//      "Auto would say: Yes" as loudly as a real answer, under a model the user
//      switched Off.
//   2. Two properties of the control that no screenshot of one open row shows,
//      checked on the source: the pill is measured only while the line is open
//      (a gateway lists hundreds of models, each with a closed line), and the
//      options stay out of the tab order while closed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { visionAutoText, visionStatusText, visionAnswerInForce } from '../settings/visionLine.ts';

const here = dirname(fileURLToPath(import.meta.url));
const t = (s) => s;
const state = (over = {}) => ({
    setting: 'auto', reads: 'yes', source: 'names', auto: { reads: 'yes', source: 'names' },
    provider: 'deepseek', checking: false, testable: true, ...over,
});
const auto = (reads, source) => ({ reads, source, auto: { reads, source } });

describe('what the line says', () => {
    const cases = [
        ['known from the model name, yes', state(auto('yes', 'names')), 'Yes'],
        ['known from the model name, no', state(auto('no', 'names')), 'No'],
        ['from the provider list, yes', state(auto('yes', 'provider')), 'Yes · reported by the provider'],
        ['from the provider list, no', state(auto('no', 'provider')), 'No · reported by the provider'],
        ['tested, yes', state(auto('yes', 'test')), 'Yes · tested'],
        ['tested, no', state(auto('no', 'test')), 'No · tested'],
        ['not known, a test can run', state(auto('unknown', null)), 'Not known yet · tested when you select it'],
        ['not known, no test can run', state({ ...auto('unknown', null), testable: false }), 'Not known'],
        ['a test is running', state({ ...auto('no', 'test'), checking: true }), 'Checking…'],
        ['the test could not finish', state({ ...auto('unknown', null), inconclusive: true }), 'Could not test just now · try again later'],
    ];
    for (const [name, s, expected] of cases) {
        test(name, () => { assert.equal(visionAutoText(s, t), expected); assert.equal(visionStatusText(s, t), expected); });
    }

    test('a running test outranks a result that could not finish', () => {
        assert.equal(visionAutoText(state({ checking: true, inconclusive: true }), t), 'Checking…');
    });

    test('under On or Off the line says what Auto WOULD say', () => {
        const off = state({ setting: 'off', reads: 'no', source: 'override', auto: { reads: 'yes', source: 'test' } });
        const on = state({ setting: 'on', reads: 'yes', source: 'override', auto: { reads: 'no', source: 'provider' } });
        assert.equal(visionStatusText(off, t), 'Auto would say: Yes · tested');
        assert.equal(visionStatusText(on, t), 'Auto would say: No · reported by the provider');
    });

    test('every piece goes through the translator', () => {
        const seen = [];
        const tr = (s) => { seen.push(s); return `<${s}>`; };
        const off = state({ setting: 'off', reads: 'no', source: 'override', auto: { reads: 'yes', source: 'test' } });
        assert.equal(visionStatusText(off, tr), '<Auto would say>: <Yes · tested>');
        assert.deepEqual(seen.sort(), ['Auto would say', 'Yes · tested']);
    });
});

describe('which status is the answer in force', () => {
    test('a settled yes or no on Auto is', () => {
        for (const s of [state(auto('yes', 'names')), state(auto('no', 'test')), state(auto('no', 'provider'))]) assert.equal(visionAnswerInForce(s), true);
    });
    test('not known, a running test and an unfinished test are not', () => {
        assert.equal(visionAnswerInForce(state(auto('unknown', null))), false);
        assert.equal(visionAnswerInForce(state({ ...auto('no', 'test'), checking: true })), false);
        assert.equal(visionAnswerInForce(state({ ...auto('yes', 'test'), inconclusive: true })), false);
    });
    test('"Auto would say" under the user\'s own On or Off is not', () => {
        assert.equal(visionAnswerInForce(state({ setting: 'off', reads: 'no', source: 'override', auto: { reads: 'yes', source: 'test' } })), false);
        assert.equal(visionAnswerInForce(state({ setting: 'on', reads: 'yes', source: 'override', auto: { reads: 'no', source: 'test' } })), false);
    });
});

describe('the control (source)', () => {
    const src = readFileSync(join(here, '..', 'settings', 'AIProvidersSettings.tsx'), 'utf8');
    const detail = src.slice(src.indexOf('export const AipVisionDetail'), src.indexOf('export interface AipModelEntry'));

    test('one control with three options, not three chips', () => {
        assert.ok(detail.length > 500, 'AipVisionDetail was not found');
        assert.equal((detail.match(/className="aip-vision-seg"/g) || []).length, 1);
        assert.doesNotMatch(detail, /aip-chip/);
        assert.match(detail, /className="aip-vision-seg-opt"[\s\S]{0,120}aria-pressed=\{state\.setting === c\.value\}/);
    });

    test('the pill is measured only while the line is open', () => {
        const effect = detail.slice(detail.indexOf('useLayoutEffect('), detail.indexOf('<div className="aip-reveal"'));
        assert.match(effect, /if \(!open \|\| !seg\) return;/);
        assert.match(effect, /\}, \[open, state\.setting, labelsKey\]\);/);
    });

    test('closed lines keep their buttons out of the tab order', () => {
        const buttons = detail.match(/<button[\s\S]*?>/g) || [];
        assert.equal(buttons.length, 2);   // the mapped option, and the test button
        for (const b of buttons) assert.match(b, /tabIndex=\{open \? 0 : -1\}/);
    });
});
