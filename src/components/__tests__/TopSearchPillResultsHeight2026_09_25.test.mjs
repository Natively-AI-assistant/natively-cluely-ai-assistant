// Guards the two causes of the Launcher search pill's bottom edge glitching.
//
// 1. The results panel slid to framer's `height: 'auto'`, which framer resolves
//    ONCE, at mount. The first keystroke's results (one letter matches almost
//    every meeting) became the target; as typing narrowed them the panel kept
//    sliding into empty space, then dropped ~190px in one frame when the spring
//    settled. The panel now slides to its measured height instead.
// 2. Result rows left with popLayout (fading where they had been) while the rows
//    staying slid up under them (layout="position"); the two overlapped for
//    ~200ms at the bottom of the pill on every narrowing keystroke.
//
// Both were measured frame by frame on the real Launcher. The slide itself (the
// spring) is the original and deliberately not pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.TOP_SEARCH_PILL_FILE || join(HERE, '../TopSearchPill.tsx');
const src = readFileSync(FILE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the results panel slides to its measured height, not to auto', () => {
    const start = src.indexOf('{showResults && (');
    assert.ok(start >= 0, 'results block found');
    const wrapper = src.slice(start, src.indexOf('<div', start));
    assert.doesNotMatch(wrapper, /height:\s*['"]auto['"]/, 'no auto-height wrapper around the results');

    const panel = src.slice(src.indexOf('const ResultsPanel'), src.indexOf('const TopSearchPill'));
    assert.match(panel, /new ResizeObserver\(/, 'the height is re-measured on every change');
    assert.match(panel, /animate=\{\{\s*height,/, 'the panel animates to the measured number');
});

test('result rows collapse in place instead of overlapping', () => {
    assert.doesNotMatch(src, /mode=["']popLayout["']/);
    assert.doesNotMatch(src, /layout=["']position["']|layout:\s*['"]position['"]/);
});
