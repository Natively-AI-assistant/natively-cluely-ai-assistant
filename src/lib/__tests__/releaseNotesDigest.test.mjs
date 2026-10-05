import test from 'node:test';
import assert from 'node:assert/strict';
import { plainText, headlineOf, digestReleaseNotes, bareVersion } from '../releaseNotesDigest.mjs';

// Bullets as ReleaseNotesManager hands them over for the published V2.8.8
// release: markdown intact, one paragraph each.
const V288 = {
    version: 'V2.8.8',
    summary: 'Three months of work since v2.7.0 — a smarter answer engine, Auto Answer for meetings, rebuilt meeting notes, a Chrome companion extension, NVIDIA speech, and Windows stealth typing.',
    sections: [
        { title: "What's New", items: [
            "**Auto Answer (Beta)** — answers appear on their own the moment the other person finishes a question. Off by default; turn it on in **Settings → General**.",
            '**A new answer engine.** Answers now pick their source properly — your résumé, an uploaded document, the live conversation, or general knowledge — instead of blending them.',
            "**Meeting notes, rebuilt.** Summaries adapt to the kind of meeting you're in.",
            "**Natively browser extension for Chrome.** Press **⌘/Ctrl+Y** to pull the page you're looking at into your next answer.",
            '**Built-in Modes**, including a new **Call Center** mode.',
            '**Skills: upload and delete.** Add your own skill as a file or folder.',
            '**NVIDIA NIM** joins the provider list, with **NVIDIA speech-to-text** and nine streaming models to choose from.',
            '**Parakeet CTC 0.6B** added to the local speech models.',
        ] },
        { title: 'Improvements', items: [
            'New default models: **Gemini 3.1 Flash Lite** and **Gemini 3.7 Flash**. The full Claude catalogue is now listed.',
            'Auto Answer and speech recognition are noticeably faster — answers are prepared ahead of time.',
        ] },
        { title: 'Fixes', items: [
            '**Startup.** Fixed the app getting stuck on the logo.',
            '**Updates.** A beta build can now update to the matching stable release.',
            '**macOS.** The Dock icon no longer reappears.',
        ] },
        { title: 'Technical', items: ['Electron 33 → 43, and TypeScript 7.', 'Intel Macs now get a correctly built `x64` DMG.'] },
    ],
};

test('plainText drops bold, code and links but keeps the words', () => {
    assert.equal(plainText('turn it on in **Settings → General**.'), 'turn it on in Settings → General.');
    assert.equal(plainText('a correctly built `x64` DMG'), 'a correctly built x64 DMG');
    assert.equal(plainText('see [the docs](https://example.test/x) and __this__'), 'see the docs and this');
    assert.equal(plainText('an *emphasised* word'), 'an emphasised word');
    // Identifiers keep their underscores and asterisks that are not emphasis.
    assert.equal(plainText('set MAX_TOKENS to 2 * 3'), 'set MAX_TOKENS to 2 * 3');
    assert.equal(plainText(undefined), '');
});

test('headlineOf takes a standalone bold lead as the headline', () => {
    assert.equal(headlineOf(V288.sections[0].items[0]), 'Auto Answer (Beta)');
    assert.equal(headlineOf(V288.sections[0].items[1]), 'A new answer engine');
    assert.equal(headlineOf(V288.sections[0].items[2]), 'Meeting notes, rebuilt');
    assert.equal(headlineOf(V288.sections[0].items[5]), 'Skills: upload and delete');
    assert.equal(headlineOf(V288.sections[2].items[0]), 'Startup');
});

test('headlineOf reads the sentence when the bold is only its start', () => {
    assert.equal(headlineOf(V288.sections[0].items[4]), 'Built-in Modes, including a new Call Center mode');
    assert.equal(headlineOf(V288.sections[0].items[6]), 'NVIDIA NIM joins the provider list, with NVIDIA speech-to-text and nine streaming models to choose from');
    // "0.6B" is not a sentence end.
    assert.equal(headlineOf(V288.sections[0].items[7]), 'Parakeet CTC 0.6B added to the local speech models');
});

test('headlineOf falls back to the first clause of a plain bullet', () => {
    assert.equal(headlineOf(V288.sections[1].items[0]), 'New default models: Gemini 3.1 Flash Lite and Gemini 3.7 Flash');
    assert.equal(headlineOf(V288.sections[1].items[1]), 'Auto Answer and speech recognition are noticeably faster');
    assert.equal(headlineOf('Fixed updater release metadata lookup'), 'Fixed updater release metadata lookup');
});

test('the V2.8.8 release digests to its summary and counts, no repeated headlines', () => {
    const digest = digestReleaseNotes(V288);
    assert.match(digest.summary, /^Three months of work since v2\.7\.0/);
    assert.deepEqual(digest.highlights, []);
    // Technical notes are for builders; the card does not count them.
    assert.deepEqual(digest.counts, [
        { key: 'new', count: 8 },
        { key: 'improvements', count: 2 },
        { key: 'fixes', count: 3 },
    ]);
});

test('without a summary the digest shows four headlines and counts the rest', () => {
    const digest = digestReleaseNotes({ ...V288, summary: '' });
    assert.equal(digest.summary, '');
    assert.deepEqual(digest.highlights, ['Auto Answer (Beta)', 'A new answer engine', 'Meeting notes, rebuilt', 'Natively browser extension for Chrome']);
    assert.deepEqual(digest.counts, [
        { key: 'more', count: 4 },
        { key: 'improvements', count: 2 },
        { key: 'fixes', count: 3 },
    ]);
    for (const line of digest.highlights) assert.doesNotMatch(line, /\*\*|`/);
});

test('the summary is plain text', () => {
    const digest = digestReleaseNotes({ summary: 'A **big** one with `code`.', sections: [] });
    assert.equal(digest.summary, 'A big one with code.');
});

test('a release with only fixes takes its headlines from the fixes', () => {
    const digest = digestReleaseNotes({ summary: '', sections: [{ title: 'Fixes', items: ['**Startup.** Fixed it.', 'Crash on quit'] }] });
    assert.deepEqual(digest.highlights, ['Startup', 'Crash on quit']);
    assert.deepEqual(digest.counts, []);
});

test('a release with nothing to show digests to null', () => {
    assert.equal(digestReleaseNotes(null), null);
    assert.equal(digestReleaseNotes({ summary: '', sections: [] }), null);
    assert.equal(digestReleaseNotes({ summary: '  ', sections: [{ title: 'Technical', items: ['Bumped deps'] }] }), null);
});

test('bareVersion accepts either tag case', () => {
    assert.equal(bareVersion('V2.8.8'), '2.8.8');
    assert.equal(bareVersion('v2.8.8'), '2.8.8');
    assert.equal(bareVersion('2.8.8'), '2.8.8');
    assert.equal(bareVersion(undefined), '');
});

test('plainText drops HTML comments', () => {
    assert.equal(plainText('<!-- note to authors --> A summary.'), 'A summary.');
});

test('a "Name — description" bullet heads with its name', () => {
    assert.equal(headlineOf('Auto Answer (Beta) — answers appear on their own. Off by default.'), 'Auto Answer (Beta)');
});
