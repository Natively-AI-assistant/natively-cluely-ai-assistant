// electron/llm/__tests__/GistNewlineRecovery2026_08_12.test.mjs
//
// The main-process half of the [[GIST]] split contract. The renderer keeps a
// hand-duplicated twin (src/lib/displayMarkup.ts, pinned by
// src/lib/__tests__/displayMarkup.test.mjs) because it cannot import
// main-process modules — the CASES table below is deliberately identical in
// both suites, so a change to one copy that skips the other turns red here.
//
// Bug (2026-08-12): a model that put the essence on the line BELOW the marker
// made the old split reject the whole shape, and a literal "[[GIST]]" painted
// on screen above the essence. The split now recovers that shape for display
// while spokenFormatViolations still reports it, so the drift stays visible.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const v2 = await import(
    pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/promptSystemV2.js')).href
);

const { GIST_MARKER, splitGistLine, stripDisplayMarkup, spokenFormatViolations } = v2;

// Keep in lockstep with src/lib/__tests__/displayMarkup.test.mjs.
const CASES = [
    ['clean trailing gist', 'Body one.\nBody two.\n[[GIST]] five word essence here',
        { body: 'Body one.\nBody two.', gist: 'five word essence here' }],
    ['no marker', 'No gist here.', { body: 'No gist here.', gist: null }],
    ['marker mid-line is prose', 'text [[GIST]] inline', { body: 'text [[GIST]] inline', gist: null }],
    ['marker at the top with a body under it', '[[GIST]] top\nreal body',
        { body: '[[GIST]] top\nreal body', gist: null }],
    ['marker as the entire single line', '[[GIST]] only line', { body: '', gist: 'only line' }],
    // A marker that starts its line is chrome even with no essence: it must
    // never survive into the body, which is what TTS speaks.
    ['empty essence still strips the marker', 'Body.\n[[GIST]]   ', { body: 'Body.', gist: null }],
    ['newline before the essence is recovered', 'You sort them first, then subtract.\n[[GIST]]\nSort the numbers and calculate c minus a',
        { body: 'You sort them first, then subtract.', gist: 'Sort the numbers and calculate c minus a', recovered: true }],
    ['newline before the essence, no body', '[[GIST]]\nSort the numbers and calculate c minus a',
        { body: '', gist: 'Sort the numbers and calculate c minus a', recovered: true }],
    ['blank lines between marker and essence', 'Body.\n[[GIST]]\n\n  five word essence here  \n',
        { body: 'Body.', gist: 'five word essence here', recovered: true }],
    ['TWO lines after the marker stay malformed', 'Body.\n[[GIST]]\nline one\nline two',
        { body: 'Body.\n[[GIST]]\nline one\nline two', gist: null }],
    // Length breaks the tie between a line-broken gist and a real closing
    // sentence written under a misplaced marker: a gist is five to eight
    // words by contract, so a longer line stays in the SPOKEN body.
    ['a following line too long to be a gist stays malformed',
        'Sort the array first, then walk it once.\n[[GIST]]\nThe answer is the difference between the last and the first elements.',
        { body: 'Sort the array first, then walk it once.\n[[GIST]]\nThe answer is the difference between the last and the first elements.', gist: null }],
    ['ten words is still recovered', 'Body.\n[[GIST]]\none two three four five six seven eight nine ten',
        { body: 'Body.', gist: 'one two three four five six seven eight nine ten', recovered: true }],
    ['eleven words is not', 'Body.\n[[GIST]]\none two three four five six seven eight nine ten eleven',
        { body: 'Body.\n[[GIST]]\none two three four five six seven eight nine ten eleven', gist: null }],
];

describe('splitGistLine — main-process copy', () => {
    assert.equal(GIST_MARKER, '[[GIST]]');

    for (const [name, input, expected] of CASES) {
        test(name, () => {
            assert.deepEqual(splitGistLine(input), expected);
        });
    }

    test('a recovered gist is never spoken', () => {
        assert.equal(
            stripDisplayMarkup('The **key term** here.\n[[GIST]]\nessence'),
            'The key term here.',
        );
    });
});

describe('spokenFormatViolations — recovery is containment, not absolution', () => {
    test('a clean gist line is not a violation', () => {
        const rules = spokenFormatViolations('You sort them first, then subtract.\n[[GIST]] sort then subtract')
            .map((v) => v.rule);
        assert.ok(!rules.includes('gist_misplaced'), rules.join(','));
    });

    test('a recovered newline split is STILL reported as gist_misplaced', () => {
        const rules = spokenFormatViolations('You sort them first, then subtract.\n[[GIST]]\nsort then subtract')
            .map((v) => v.rule);
        assert.ok(rules.includes('gist_misplaced'), rules.join(','));
    });

    test('a mid-line marker is still reported', () => {
        const rules = spokenFormatViolations('You sort them [[GIST]] first, then subtract.')
            .map((v) => v.rule);
        assert.ok(rules.includes('gist_misplaced'), rules.join(','));
    });

    test('the recovered essence is not linted as prose', () => {
        // An essence carrying banned prose punctuation must not add em_dash /
        // semicolon violations: it is display chrome, split off before linting.
        const rules = spokenFormatViolations('You sort them first, then subtract.\n[[GIST]]\nsort; then subtract — fast')
            .map((v) => v.rule);
        assert.deepEqual(rules, ['gist_misplaced']);
    });
});

describe('bullet-prefixed marker (live session E, 2026-08-23)', () => {
    test('"- [[GIST]] …" is honored as the gist and flagged recovered', () => {
        const r = v2.splitGistLine('The answer body.\n-[[GIST]] Use backtracking to build valid parentheses.');
        assert.equal(r.gist, 'Use backtracking to build valid parentheses.');
        assert.equal(r.body, 'The answer body.');
        assert.equal(r.recovered, true);
    });

    test('a marker after real prose on the same line still stays visible', () => {
        const r = v2.splitGistLine('You sort them [[GIST]] first, then subtract.');
        assert.equal(r.gist, null);
    });
});

describe('glued marker after a completed sentence (live session E press 26, 2026-08-23)', () => {
    test('"…of 2n. [[GIST]] essence" recovers the gist and keeps the prose', () => {
        const r = v2.splitGistLine('The stack never exceeds the required length of 2n. [[GIST]] Use backtracking to build valid parentheses.');
        assert.equal(r.gist, 'Use backtracking to build valid parentheses.');
        assert.equal(r.body, 'The stack never exceeds the required length of 2n.');
        assert.equal(r.recovered, true);
    });

    test('a mid-sentence marker still stays visible', () => {
        assert.equal(v2.splitGistLine('You sort them [[GIST]] first, then subtract.').gist, null);
    });
});

describe('prompt contract states the same-line rule', () => {
    test('the glance-layer instruction forbids a break after the marker', () => {
        const prompt = v2.buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud' });
        assert.match(prompt, /\[\[GIST\]\] followed on that SAME line/);
    });
});
