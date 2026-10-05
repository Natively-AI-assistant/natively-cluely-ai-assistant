// src/lib/__tests__/overlayCollapsedFitsBrainstorm2026_09_27.test.mjs
//
// With Interview Mode on, the overlay's Recap chip becomes Brainstorm. At the
// old 590px collapsed panel the quick-action row no longer fit on one line and
// the Answer chip wrapped under the others.
//
// The fix has two parts:
//   1. the default collapsed panel went from 590 to 604 — English with Inter,
//      the common case, fits at the default;
//   2. the collapsed width follows the MEASURED row (collapsedWidthForRow), so
//      longer translations and the system fallback font get exactly the width
//      their labels need, never less than the default, never more than the
//      expanded panel.
//
// Row widths measured on the real overlay (headless Chromium, 2026-09-27),
// single line, card borders included — Inter / system fallback font:
//   English   Recap 574 / 577    Brainstorm 598 / 603
//   Russian   Recap 597 / 603    Brainstorm 658 / 664
//   Spanish   Recap 624 / 628    Brainstorm 654 / 659
//   Japanese  Recap 583 / 576    Brainstorm 648 / 642
//   Chinese   Recap 473 / 464    Brainstorm 496 / 485

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OVERLAY_DEFAULT_WINDOW_WIDTH,
  QUICK_ROW_SLACK,
  collapsedPanelForWindow,
  collapsedWidthForRow,
  defaultCollapsedPanelWidth,
  panelWidthForWindow,
} from '../overlayCustomSize.mjs';

const COLLAPSED = defaultCollapsedPanelWidth();
const EXPANDED = panelWidthForWindow(OVERLAY_DEFAULT_WINDOW_WIDTH);

describe('default collapsed width', () => {
  test('the default collapsed panel is 604px', () => {
    assert.equal(COLLAPSED, 604);
  });

  test('English Brainstorm with Inter fits the default as-is', () => {
    assert.equal(collapsedWidthForRow(COLLAPSED, EXPANDED, 598.08), 604);
  });

  test('the window and the expanded panel are unchanged, so the toggle still grows', () => {
    assert.equal(OVERLAY_DEFAULT_WINDOW_WIDTH, 732);
    assert.equal(EXPANDED, 720);
    assert.ok(collapsedPanelForWindow(OVERLAY_DEFAULT_WINDOW_WIDTH) < EXPANDED);
  });
});

describe('collapsedWidthForRow', () => {
  test('unmeasured (0) keeps the default', () => {
    assert.equal(collapsedWidthForRow(COLLAPSED, EXPANDED, 0), COLLAPSED);
    assert.equal(collapsedWidthForRow(COLLAPSED, EXPANDED, NaN), COLLAPSED);
  });

  test('a row that fits never narrows the panel below the default', () => {
    assert.equal(collapsedWidthForRow(COLLAPSED, EXPANDED, 473.4), COLLAPSED);
  });

  test('a longer row gets its width plus the slack, rounded up', () => {
    // Russian Brainstorm with Inter.
    assert.equal(collapsedWidthForRow(COLLAPSED, EXPANDED, 657.82), Math.ceil(657.82 + QUICK_ROW_SLACK));
    // English on the fallback font: one px past the default.
    assert.equal(collapsedWidthForRow(COLLAPSED, EXPANDED, 603.02), 605);
  });

  test('never wider than the expanded panel', () => {
    assert.equal(collapsedWidthForRow(COLLAPSED, EXPANDED, 900), EXPANDED);
  });
});
