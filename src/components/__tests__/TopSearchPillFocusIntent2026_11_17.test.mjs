// The Launcher's search opened by itself when ⌘B brought the window back
// (user report, 2026-11-17): Chromium focuses the first focusable element of a
// page shown again, the search box, and the box opened on ANY focus. The first
// click on the page then went to closing the search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isRestoredSearchFocus, FOCUS_INTENT_MS, RESTORE_WINDOW_MS } from '../../lib/searchFocusIntent.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '../TopSearchPill.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the focus handed back as the window becomes active does not open the search', () => {
    const now = 1_000_000;
    assert.equal(isRestoredSearchFocus({ lastIntentAt: 0, lastWindowFocusAt: now - 5, now }), true, 'Tong\'s case: no press, window just became active');
    assert.equal(isRestoredSearchFocus({ lastIntentAt: now - 30, lastWindowFocusAt: now - 5, now }), false, 'a click ON the search box that also activated the window');
    assert.equal(isRestoredSearchFocus({ lastIntentAt: now - FOCUS_INTENT_MS - 1, lastWindowFocusAt: now - 5, now }), true, 'a press long ago does not count');
});

test('every other focus still opens it (a screen reader moving to the box, a press, ⌘K)', () => {
    const now = 1_000_000;
    assert.equal(isRestoredSearchFocus({ lastIntentAt: 0, lastWindowFocusAt: now - RESTORE_WINDOW_MS - 1, now }), false, 'window active for a while');
    assert.equal(isRestoredSearchFocus({ lastIntentAt: 0, lastWindowFocusAt: 0, now }), false, 'window focus never seen');
    assert.equal(isRestoredSearchFocus({ lastIntentAt: now - 10, lastWindowFocusAt: 0, now }), false);
    assert.equal(isRestoredSearchFocus({ lastIntentAt: 0, lastWindowFocusAt: now + 5, now }), false, 'a clock that went back');
});

test('wiring: a press on the pill, ⌘K/open and Tab count as asking', () => {
    assert.match(src, /ref=\{containerRef\}\s*className="[^"]*"\s*onPointerDownCapture=\{noteFocusIntent\}/);
    assert.match(src, /const open = useCallback\(\(\) => \{\s*focusIntentAtRef\.current = Date\.now\(\);/);
    assert.match(src, /const handleKeyDown = \(e: KeyboardEvent\) => \{\s*if \(e\.key === 'Tab'\) noteFocusIntent\(\);/);
});

test('wiring: focus without asking is given back instead of opening the search', () => {
    const at = src.indexOf('onFocus={() => {');
    assert.ok(at > 0);
    const body = src.slice(at, at + 1200);
    assert.match(body, /if \(isRestoredSearchFocus\(\{\s*lastIntentAt: focusIntentAtRef\.current,\s*lastWindowFocusAt: windowFocusAtRef\.current,\s*now: Date\.now\(\),\s*\}\)\) \{\s*inputRef\.current\?\.blur\(\);\s*return;\s*\}\s*setState\('focused'\);/);
    assert.match(src, /window\.addEventListener\('focus', onWindowFocus\);/, 'the window\'s activation is recorded');
    assert.doesNotMatch(src, /onFocus=\{\(\) => state === 'idle' && setState\('focused'\)\}/);
});
