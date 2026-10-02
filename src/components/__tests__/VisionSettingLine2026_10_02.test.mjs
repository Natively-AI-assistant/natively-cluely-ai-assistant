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
import { visionAutoText, visionStatusText, visionAnswerInForce, visionStatesShown } from '../settings/visionLine.ts';
import { ES_GENERATED } from '../../i18n.es.generated.ts';
import { RU_GENERATED } from '../../i18n.ru.generated.ts';
import { RU_GENERATED2 } from '../../i18n.ru.generated2.ts';
import { ZH_GENERATED } from '../../i18n.zh.generated.ts';
import { JA_GENERATED } from '../../i18n.ja.generated.ts';

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

// "Test again" could not finish (no credit, rate limit, provider down). Main
// re-reads every state on any change and knows nothing of that, so the list
// remembers it — until it stops being true.
describe('a test that could not finish', () => {
    const noted = new Set(['m']);
    const said = (s) => visionAutoText(visionStatesShown({ m: s }, noted).m, t);

    test('the line says so, and keeps saying so across main\'s re-reads', () => {
        // main forgot the old result, so Auto is back to what it knew without a test
        assert.equal(said(state(auto('unknown', null))), 'Could not test just now · try again later');
        assert.equal(said(state(auto('yes', 'provider'))), 'Could not test just now · try again later');
        assert.equal(said(state(auto('no', 'names'))), 'Could not test just now · try again later');
    });

    test('a test running again outranks it', () => {
        assert.equal(said(state({ ...auto('unknown', null), checking: true })), 'Checking…');
    });

    test('a test that settles afterwards replaces it', () => {
        // the model was picked, and its background test answered
        assert.equal(said(state(auto('yes', 'test'))), 'Yes · tested');
        assert.equal(said(state(auto('no', 'test'))), 'No · tested');
        assert.equal(visionAnswerInForce(visionStatesShown({ m: state(auto('yes', 'test')) }, noted).m), true);
    });

    test('other rows, rows without a control, and an empty note are left alone', () => {
        const states = { m: state(auto('unknown', null)), other: state(auto('yes', 'names')), custom: null };
        const shown = visionStatesShown(states, noted);
        assert.equal(shown.other, states.other);
        assert.equal(shown.custom, null);
        assert.equal(states.m.inconclusive, undefined);   // main's own answer is not written to
        assert.equal(visionStatesShown(states, new Set()), states);
        assert.equal(visionStatesShown({}, noted).m, undefined);
    });

    test('the list uses it', () => {
        const src = readFileSync(join(here, '..', 'settings', 'AIProvidersSettings.tsx'), 'utf8');
        assert.match(src, /const shown = useMemo\(\(\) => visionStatesShown\(states, inconclusive\), \[states, inconclusive\]\);/);
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
        const effect = detail.slice(detail.indexOf('useLayoutEffect('), detail.indexOf('className="aip-reveal '));
        assert.match(effect, /if \(!open \|\| !seg\) return;/);
        assert.match(effect, /\}, \[open, state\.setting, labelsKey\]\);/);
    });

    // Measured in a 216px list of 17 rows (2026-10-02): the line of the last row
    // in view opened with 27 of its 34px under the fold, and the list did not move.
    test('a line that opens under the fold is followed into view, and only when it was just opened', () => {
        const effect = detail.slice(detail.indexOf('const lineRef'), detail.indexOf('const auto = visionAutoText'));
        assert.match(effect, /const wasOpen = useRef\(open\);/);
        assert.match(effect, /const opening = open && !wasOpen\.current;\s*wasOpen\.current = open;/);
        assert.match(effect, /if \(!opening \|\| !line\) return;/);
        assert.match(effect, /line\.scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\);/);
        assert.match(effect, /return \(\) => cancelAnimationFrame\(frame\);\s*\}, \[open\]\);/);
        assert.match(detail, /<div ref=\{lineRef\} className="aip-reveal aip-reveal--line"/);
    });

    test('closed lines keep their buttons out of the tab order', () => {
        const buttons = detail.match(/<button[\s\S]*?>/g) || [];
        assert.equal(buttons.length, 2);   // the mapped option, and the test button
        assert.match(buttons[0], /tabIndex=\{open \? 0 : -1\}/);
        assert.match(buttons[1], /tabIndex=\{open && onAuto \? 0 : -1\}/);
    });
});

// What moves when the line changes state. Nothing here is a hover: every motion
// answers a click or its result.
describe('the line\'s motion (source)', () => {
    const src = readFileSync(join(here, '..', 'settings', 'AIProvidersSettings.tsx'), 'utf8');
    const css = src.slice(src.indexOf('const AIP_CSS'), src.indexOf('export const AipBadge'));
    const button = src.slice(src.indexOf('export const AipVisionButton'), src.indexOf('export const AipVisionDetail'));
    const detail = src.slice(src.indexOf('export const AipVisionDetail'), src.indexOf('export interface AipModelEntry'));
    const list = src.slice(src.indexOf('export const AipModelList'));
    const rule = (selector) => {
        const at = css.indexOf(`\n${selector} {`);
        assert.ok(at >= 0, `no rule for ${selector}`);
        return css.slice(at, css.indexOf('}', at));
    };

    test('the line settles in like the list it sits in, and reduced motion drops the travel', () => {
        assert.match(detail, /<div ref=\{lineRef\} className="aip-reveal aip-reveal--line" data-open=/);
        assert.match(css, /\.aip-reveal--row > div > \*,\n\.aip-reveal--line > div > \* \{\n    opacity:0; transform: translateY\(-4px\);/);
        assert.match(css, /\.aip-reveal--line\[data-open='true'\] > div > \* \{\n    opacity:1; transform:none;/);
        const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
        assert.match(reduced, /\.aip-root \.aip-reveal--line > div > \* \{ transform: none !important; \}/);
    });

    test('the answer and the test label swap, keyed by what they say', () => {
        assert.match(detail, /const auto = visionAutoText\(state, t\);/);
        assert.match(detail, /<span aria-hidden="true"><Presence kind="text" id=\{auto\} ready=\{motionReady\}>\{auto\}<\/Presence><\/span>/);
        assert.match(detail, /<Presence kind="text" id=\{tested \? 'again' : 'now'\} ready=\{motionReady\}>/);
    });

    test('a screen reader is given the whole sentence, apart from the pieces that move', () => {
        assert.match(detail, /const status = visionStatusText\(state, t\);/);
        assert.match(detail, /<span className="sr-only" aria-live="polite">\{status\}<\/span>/);
        assert.equal((detail.match(/aria-live=/g) || []).length, 1);
        assert.match(detail, /<span className="aip-vision-would" data-open=\{onAuto \? 'false' : 'true'\} aria-hidden="true">\s*<span>\{`\$\{t\('Auto would say'\)\}: `\}<\/span>/);
    });

    // .sr-only is absolutely positioned. Measured 2026-10-02 with a line open deep
    // in a 300-model list: the Settings pane's scroll height went 2,642 -> 12,013px.
    test('the sentence for screen readers stays inside its line', () => {
        const at = css.indexOf('\n.aip-vision-status {');
        assert.ok(at >= 0);
        assert.match(css.slice(at, css.indexOf('}', at)), /position:relative/);
        // it must be a child of that box, not of the line or the row
        assert.match(detail, /<span className="aip-vision-status" data-answer=\{[^}]+\}>\s*\{\/\*[\s\S]*?\*\/\}\s*<span className="sr-only" aria-live="polite">/);
    });

    // In Russian the line holds "Auto would say: No · tested" OR "No · tested" and
    // the test button, not both. Timed apart, the two overlapped for a moment, the
    // line wrapped to two rows and every row below it jumped down and back.
    test('"Auto would say" and the test button trade places on one clock', () => {
        const timing = (ruleText, property) => {
            const m = ruleText.match(new RegExp(`${property} ([^,;]+)[,;]`));
            assert.ok(m, `no ${property} timing in: ${ruleText}`);
            return m[1].trim();
        };
        const wouldClosed = rule('.aip-vision-would'), wouldOpen = rule(".aip-vision-would[data-open='true']");
        const placeClosed = rule('.aip-vision-test'), placeOpen = rule(".aip-vision-test[data-open='true']");
        // back to Auto: the words close exactly as the button's place opens
        assert.equal(timing(wouldClosed, 'grid-template-columns'), timing(placeOpen, 'width'));
        // On or Off: the words open exactly as the button's place closes
        assert.equal(timing(wouldOpen, 'grid-template-columns'), timing(placeClosed, 'width'));
        assert.match(wouldClosed, /grid-template-columns:0fr/);
        assert.match(wouldClosed, /justify-content:end/);   // mid-way, the words stay against the answer
        assert.match(wouldOpen, /grid-template-columns:1fr/);
        assert.match(wouldOpen, /visibility:inherit/);
        assert.match(rule('.aip-vision-would > span'), /min-width:0; overflow:hidden; white-space:pre/);
    });

    test('the glyph cross-fades between yes, no and a running test', () => {
        assert.match(button, /<Presence kind="icon" id=\{state\.checking \? 'checking' : state\.reads === 'no' \? 'no' : 'yes'\} slotClassName="aip-vision-glyph" ready=\{motionReady\}>/);
        assert.match(rule('.aip-vision-glyph'), /width:12px; height:12px/);
        // the wrapper sits between the button and its svg now
        assert.match(css, /\.aip-vision-btn\[data-reads='unknown'\] svg \{ opacity:0\.5; \}/);
    });

    test('the "set by you" dot is always drawn, and fades', () => {
        const dot = rule('.aip-vision-btn::after');
        assert.match(dot, /opacity:0; transform: scale\(0\.4\)/);
        assert.match(dot, /transition: opacity var\(--aip-dur-state\)/);
        assert.match(css, /\.aip-vision-btn\[data-set='true'\]::after \{ opacity:1; transform:none; \}/);
    });

    test('off Auto the test button is hidden, untabbable and inert, not unmounted', () => {
        assert.match(detail, /\{state\.testable && \(\s*<div className="aip-vision-test" data-open=\{onAuto \? 'true' : 'false'\} aria-hidden=\{onAuto \? undefined : true\}>/);
        assert.match(detail, /onClick=\{\(\) => \{ if \(onAuto\) onRetest\(\); \}\}/);
        assert.doesNotMatch(detail, /onClick=\{onRetest\}/);
        const closed = rule('.aip-vision-test');
        for (const decl of ['width:0', 'opacity:0', 'visibility:hidden', 'pointer-events:none', 'overflow:hidden']) assert.ok(closed.includes(decl), `closed place lacks ${decl}`);
        // the button is gone before the place narrows, and stays hidden until it has closed
        assert.match(closed, /width var\(--aip-dur-state\) var\(--aip-ease-out\) 50ms/);
        assert.match(closed, /opacity var\(--aip-dur-press\)/);
        assert.match(closed, /visibility 0s linear calc\(var\(--aip-dur-state\) \+ 50ms\)/);
    });

    test('the open place is exactly one column pill plus its gap, and never forces visibility', () => {
        const open = rule(".aip-vision-test[data-open='true']");
        assert.match(open, /width: calc\(var\(--aip-col-w, 82px\) \+ 6px\)/);
        assert.match(open, /visibility:inherit/);
        assert.doesNotMatch(open, /visibility:visible/);
        assert.match(open, /width var\(--aip-dur-travel\)/);                    // opens slower than it closes
        assert.match(rule('.aip-vision-test'), /width var\(--aip-dur-state\)/);
        assert.doesNotMatch(rule('.aip-vision-result'), /gap/);                // the gap lives inside the place
    });

    // Measured on a 300-model list (2026-10-02): with a motion piece mounted for
    // every row, opening the list went from about 200ms to about 300ms.
    test('only a row whose line has been opened pays for motion', () => {
        const hook = src.slice(src.indexOf('function useVisionRowMotion'), src.indexOf('export const AipVisionButton'));
        assert.match(hook, /const paneReady = React\.useContext\(SettingsMotionReady\);/);
        assert.match(hook, /const \[opened, setOpened\] = useState\(open\);\s*if \(open && !opened\) setOpened\(true\);\s*return paneReady && opened;/);
        assert.match(button, /const motionReady = useVisionRowMotion\(open\);/);
        assert.match(detail, /const motionReady = useVisionRowMotion\(open\);/);
        const presences = [...button.matchAll(/<Presence [^>]*>/g), ...detail.matchAll(/<Presence [^>]*>/g)].map((m) => m[0]);
        assert.equal(presences.length, 3);   // the glyph, the answer, the test label
        for (const tag of presences) assert.match(tag, / ready=\{motionReady\}>$/, `always-on motion in a row: ${tag}`);
    });

    test('the summary\'s default name swaps when the default moves, and still truncates', () => {
        assert.match(list, /<Presence kind="text" id=\{defaultId \|\| null\} block className="truncate">/);
    });
});

// The right-hand column of a model list: the default mark, "Set default", and the
// test button on the line under a row. They stack, so they are one box.
describe('the pill column (source)', () => {
    const src = readFileSync(join(here, '..', 'settings', 'AIProvidersSettings.tsx'), 'utf8');
    const css = src.slice(src.indexOf('const AIP_CSS'), src.indexOf('export const AipBadge'));
    const list = src.slice(src.indexOf('export const AipModelList'));
    const detail = src.slice(src.indexOf('export const AipVisionDetail'), src.indexOf('export interface AipModelEntry'));
    const rule = (selector) => {
        const at = css.indexOf(`\n${selector} {`);
        assert.ok(at >= 0, `no rule for ${selector}`);
        return css.slice(at, css.indexOf('}', at));
    };

    test('all three are in the column', () => {
        assert.match(list, /<span className="aip-default-mark aip-col-pill">\{t\('Default'\)\}<\/span>/);
        assert.match(list, /className="aip-btn aip-btn-sm aip-col-pill"[\s\S]{0,400}\{t\('Set default'\)\}/);
        assert.match(detail, /className="aip-btn aip-btn-sm aip-col-pill"[\s\S]{0,600}t\('Test again'\)/);
    });

    test('the default mark has no dot and is not the status badge', () => {
        assert.doesNotMatch(list, /<AipBadge[^>]*label=\{t\('Default'\)\}/);
        assert.doesNotMatch(rule('.aip-default-mark'), /text-transform/);
    });

    test('the mark is the small button\'s box', () => {
        const mark = rule('.aip-default-mark'), small = rule('.aip-btn-sm'), button = rule('.aip-btn');
        for (const decl of ['height:22px', 'padding:0 8px', 'font-size:10.5px']) {
            assert.ok(small.includes(decl), `.aip-btn-sm lost ${decl}`);
            assert.ok(mark.includes(decl), `.aip-default-mark lacks ${decl}`);
        }
        for (const decl of ['border-radius: var(--aip-r-md)', 'font-weight:500', 'line-height:1']) {
            assert.ok(button.includes(decl), `.aip-btn lost ${decl}`);
            assert.ok(mark.includes(decl), `.aip-default-mark lacks ${decl}`);
        }
        assert.match(mark, /border:1px solid/);
    });

    test('the slot and the pills take one measured width', () => {
        assert.match(rule('.aip-default-slot'), /min-width: var\(--aip-col-w, 82px\)/);
        assert.match(rule('.aip-col-pill'), /min-width: var\(--aip-col-w, 82px\)/);
        assert.match(list, /\['--aip-col-w' as string\]: `\$\{colWidth\}px`/);
    });

    test('the measurement covers every label the list can show, and runs only while open', () => {
        const labels = list.slice(list.indexOf('const colLabels = ['), list.indexOf('const colKey'));
        for (const l of ['Default', 'Set default', 'Test again', 'Test now']) assert.ok(labels.includes(`t('${l}')`), `${l} is not measured`);
        const effect = list.slice(list.indexOf('const colSizerRef'), list.indexOf('// Opt-in inverts'));
        assert.match(effect, /if \(!open \|\| !sizer\) return;/);
        assert.match(effect, /\}, \[open, colKey\]\);/);
        assert.match(list, /className="aip-col-sizer" aria-hidden="true"/);
    });

    test('the line under a row is one row tall, so the column keeps its pitch', () => {
        assert.match(rule('.aip-model-row'), /min-height:34px/);
        const line = rule('.aip-vision-detail');
        assert.match(line, /padding:6px 6px 6px 27px/);   // 6 + 22 + 6 = 34
        assert.match(line, /gap:12px 6px/);               // a wrapped line keeps the 34px pitch
        assert.match(rule('.aip-default-slot > .aip-row-actions'), /display:flex/);
    });
});

// A string with no entry falls back to English without a sound. "Checking…" was
// English in Spanish and Chinese; "Set default" and the summary's "default" were
// English in every language, in a column whose other two labels were translated.
describe('every string of the line and the pill column is translated', () => {
    const src = readFileSync(join(here, '..', 'settings', 'AIProvidersSettings.tsx'), 'utf8');
    const line = readFileSync(join(here, '..', 'settings', 'visionLine.ts'), 'utf8');
    const said = (text) => [...text.matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)].map((m) => m[1]);
    const keys = [...new Set([
        ...said(line),
        ...said(src.slice(src.indexOf('export const AipVisionButton'), src.indexOf('export interface AipModelEntry'))),
        'Default', 'Set default', 'default', 'Use this model by default for this provider',
    ])];
    const languages = {
        es: ES_GENERATED, ru: { ...RU_GENERATED, ...RU_GENERATED2 }, zh: ZH_GENERATED, ja: JA_GENERATED,
    };
    // The same word in that language.
    const same = { es: new Set(['Auto', 'No']) };

    test('the strings were found', () => {
        assert.ok(keys.length >= 25, `only ${keys.length} strings found`);
        for (const k of ['Checking…', 'Auto would say', 'Test again', 'Test now', 'Reads images', 'set by you']) assert.ok(keys.includes(k), `${k} was not found in the source`);
        for (const k of ['Set default', 'default']) assert.ok(src.includes(`t('${k}')`), `${k} is no longer said`);
    });

    for (const [lang, dict] of Object.entries(languages)) {
        test(`in ${lang}`, () => {
            const missing = keys.filter((k) => typeof dict[k] !== 'string' || !dict[k].trim());
            assert.deepEqual(missing, [], `no ${lang} entry`);
            const english = keys.filter((k) => dict[k] === k && !same[lang]?.has(k));
            assert.deepEqual(english, [], `left in English in ${lang}`);
        });
    }
});
