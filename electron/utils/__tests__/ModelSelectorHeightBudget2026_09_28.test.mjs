// The overlay's model dropdown is capped to the room under it, so a low overlay
// gets a shorter, scrolling list instead of a dropdown shoved up over the answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const {
    modelSelectorHeightBudget,
    MODEL_SELECTOR_SCREEN_MARGIN,
    MODEL_SELECTOR_MIN_PANEL_HEIGHT,
} = require(path.join(repoRoot, 'dist-electron/electron/utils/modelSelectorHeightBudget.js'));

// A 1440x900 Mac work area under a 25px menu bar, and a 1080p Windows work
// area over a 48px taskbar.
const MAC = { y: 25, height: 875 };
const WIN = { y: 0, height: 1032 };

test('plenty of room: the budget is everything down to the margin', () => {
    assert.equal(modelSelectorHeightBudget(MAC, 300), 25 + 875 - 300 - MODEL_SELECTOR_SCREEN_MARGIN);
    assert.equal(modelSelectorHeightBudget(WIN, 500), 1032 - 500 - MODEL_SELECTOR_SCREEN_MARGIN);
});

test('an overlay low on the screen gets a shorter list, not a push-up', () => {
    // 200px left under the dropdown: the 354px panel would have been pushed up 162px.
    assert.equal(modelSelectorHeightBudget(MAC, 700), 192);
});

test('never below three rows, even when the overlay touches the bottom', () => {
    assert.equal(modelSelectorHeightBudget(MAC, 880), MODEL_SELECTOR_MIN_PANEL_HEIGHT);
    assert.equal(modelSelectorHeightBudget(WIN, 2000), MODEL_SELECTOR_MIN_PANEL_HEIGHT);
});

test('a secondary display with a negative origin is measured from its own bottom', () => {
    assert.equal(modelSelectorHeightBudget({ y: -1080, height: 1040 }, -400), -1080 + 1040 + 400 - MODEL_SELECTOR_SCREEN_MARGIN);
});

test('fractional DIPs (Windows 125% scaling) round down, never overshoot', () => {
    assert.equal(modelSelectorHeightBudget({ y: 0, height: 823.2 }, 400.6), 414);
});
