// Guards the two causes of the Launcher search pill's bottom edge glitching.
//
// 1. The results panel slid to framer's `height: 'auto'`, which framer resolves
//    ONCE, at mount. The first keystroke's results (one letter matches almost
//    every meeting) became the target; as typing narrowed them the panel kept
//    sliding into empty space, then dropped ~190px in one frame when the spring
//    settled. The panel now slides to its measured height instead.
//    While open the panel only grows: following the results back up as they
//    narrowed read as the bottom edge bouncing.
// 2. Result rows animated their own exit. With popLayout they faded where they
//    had been while the rows staying slid up under them (layout="position");
//    collapsing in place instead, a row's unclipped text ran over the rows
//    below. Rows now swap in place and only fade in.
//
// All measured frame by frame on the real Launcher. The slide itself (the
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
    assert.match(panel, /Math\.max\(/, 'while open the panel only grows');
    // Deleting the query and retyping before the close finishes re-enters the SAME
    // panel; without a reset it kept the last query's tallest height (~270px empty).
    assert.match(panel, /useIsPresent\(\)/, 'the panel knows when it re-enters');
    assert.match(panel, /\}, \[isPresent\]\);/, 'the height starts over on every (re)entry');
});

test('result rows swap in place: no exit, no height animation, no slide', () => {
    const start = src.indexOf('<ResultsPanel>');
    assert.ok(start >= 0, 'results rendered inside ResultsPanel');
    const rows = src.slice(start, src.indexOf('</ResultsPanel>', start));
    assert.doesNotMatch(rows, /exit[=:]/, 'no row animates out');
    assert.doesNotMatch(rows, /height:/, 'no row animates its height');
    assert.doesNotMatch(src, /mode=["']popLayout["']/);
    assert.doesNotMatch(src, /layout=["']position["']|layout:\s*['"]position['"]/);
});

// 3. The open dropdown hangs below the header. Painted into the header's layer it
//    stretched that layer, and on the first open and close after a load the new
//    area showed the header's colour for a few frames: a full-width band under
//    the top bar. The pill gets its own compositor layer instead.
test('the search pill has its own compositor layer', () => {
    assert.match(src, /ref=\{containerRef\}\s*className="[^"]*\bwill-change-transform\b/);
});
