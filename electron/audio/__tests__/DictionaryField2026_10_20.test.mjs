// The Dictionary token field (2026-10-20), Settings > Audio: words sit in the
// field as chips. The text rules are pure (src/lib/dictionaryField.mjs) and run
// here; the component's key, focus and save handling is checked in its source.
// Platform-neutral: the same field on macOS and Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const { isListPaste, splitEntries, mergeEntries, pasteIntoDraft } = await import(pathToFileURL(path.join(REPO, 'src/lib/dictionaryField.mjs')).href);

test('splitEntries: lines, commas and semicolons; whitespace collapsed; empties dropped', () => {
    assert.deepEqual(splitEntries(' Acme ,\n\nPriya   Raman; Node.js ,, '), ['Acme', 'Priya Raman', 'Node.js']);
    assert.equal(isListPaste('Acme'), false);
    assert.equal(isListPaste('Acme\nBeta'), true);
});

test('mergeEntries: duplicates of the list or of each other are dropped, case-insensitively', () => {
    const { next, leftover } = mergeEntries(['Kubernetes'], 'kubernetes, Soniox, SONIOX', 100);
    assert.deepEqual(next, ['Kubernetes', 'Soniox']);
    assert.deepEqual(leftover, []);
});

test('mergeEntries: new entries past the cap come back as leftover, never dropped', () => {
    const ninety = Array.from({ length: 90 }, (_, i) => `w${i}`);
    const thirty = Array.from({ length: 30 }, (_, i) => `n${i}`).join('\n');
    const { next, leftover } = mergeEntries(ninety, thirty, 100);
    assert.equal(next.length, 100);
    assert.equal(leftover.length, 20);
    assert.deepEqual(leftover, Array.from({ length: 20 }, (_, i) => `n${i + 10}`));
    // A duplicate past the cap is not "leftover": it is already in the list.
    assert.deepEqual(mergeEntries(next, 'w3, extra', 100).leftover, ['extra']);
});

test('pasteIntoDraft: a paste replaces the selection and lands at the caret', () => {
    // "Acme" selected and replaced: Acme is not kept.
    assert.deepEqual(splitEntries(pasteIntoDraft('Acme', 0, 4, 'Foo, Bar')), ['Foo', 'Bar']);
    // Caret in the middle of the draft: the paste goes there, splitting the word.
    assert.deepEqual(splitEntries(pasteIntoDraft('AcmeCorp', 4, 4, 'Foo\nBar')), ['Acme', 'Foo', 'Bar', 'Corp']);
    // No caret information: appended.
    assert.deepEqual(splitEntries(pasteIntoDraft('Acme', null, null, 'Foo, Bar')), ['Acme', 'Foo', 'Bar']);
});

test('component: IME keys, full list, overflow, save order', () => {
    const src = read('src/components/settings/SpeechDictionarySettings.tsx');
    // Return and the comma belong to an IME while it is composing.
    assert.match(src, /if \(e\.nativeEvent\.isComposing \|\| e\.keyCode === 229\) return;[\s\S]{0,200}e\.key === 'Enter'/);
    // A full list does not disable the focused field (focus would drop to the page).
    assert.match(src, /disabled=\{!loaded\}/);
    assert.doesNotMatch(src, /disabled=\{!loaded \|\| full\}/);
    // What did not fit stays in the field, with a note.
    assert.match(src, /setDraft\(leftover\.join\(', '\)\);\s*setOverflow\(leftover\.length\);/);
    assert.match(src, /<Collapse open=\{overflow > 0\}>/);
    // Only the newest save decides the list; a failure falls back to the last confirmed one.
    assert.match(src, /if \(seq !== latestSave\.current\) return;/);
    assert.match(src, /setTerms\(confirmed\.current\);\s*setNotSaved\(true\);/);
    // Escape with something to clear does not reach the window (Settings closes on Escape).
    assert.match(src, /if \(!draft && !armed\) return;\s*e\.stopPropagation\(\);/);
});

test('Settings > Audio: "Use the meeting app\'s microphone" is shown on macOS only', () => {
    const overlay = read('src/components/SettingsOverlay.tsx');
    // Windows reports no device name, so the setting could never take effect there.
    assert.match(overlay, /\{isMac && \(\s*<div className=\{SETTINGS_CARD\}>\s*<FollowMicDeviceSettings \/>/);
    // The room-speakers row stays on both platforms.
    assert.match(overlay, /<div className=\{SETTINGS_CARD\}>\s*<RoomSpeakersSettings sttProvider=\{sttProvider\} \/>/);
});
