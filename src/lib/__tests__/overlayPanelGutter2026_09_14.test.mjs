// The overlay panel's transparent gutter, and the panel<->window conversions
// that exist because of it.
//
// Background: the overlay window used to BE the panel. "An expanded panel IS
// the window width" was a documented invariant, and the card was flush to the
// window on the vertical axis too (measured live: card y=0, h=153.625 in a
// 154px window). Undetectable mode's ring needs to paint OUTSIDE the card, so
// the panel is now inset from the window by OVERLAY_PANEL_INSET on every side.
//
// That turned a former identity into a real conversion, and the conversion was
// previously written inline at seven call sites. Every one of them is an
// off-by-2x-inset waiting to happen; two of them (the boot seed and the reset
// paths) actually WERE wrong in the first pass and were caught by measuring the
// live card, not by any test. These pin the conversions so the next edit cannot
// quietly reintroduce the identity.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  OVERLAY_PANEL_INSET,
  OVERLAY_HOVER_GATE_PAD,
  OVERLAY_DEFAULT_WINDOW_WIDTH,
  OVERLAY_DEFAULT_COLLAPSED_WIDTH,
  panelWidthForWindow,
  collapsedPanelForWindow,
  defaultCollapsedPanelWidth,
  collapsedWidthFor,
} from '../overlayCustomSize.mjs';

describe('overlay panel gutter', () => {
  test('the gutter is a positive whole number of CSS pixels', () => {
    // Fractional would land the ring on half-pixels at DPR 1, where a
    // fractional outline-width is already floored to 1px and vanishes.
    assert.ok(Number.isInteger(OVERLAY_PANEL_INSET) && OVERLAY_PANEL_INSET > 0);
  });

  test('the hover gate pad stays inside the gutter, so the gutter is click-through', () => {
    // The gate inflates the panel rect by the pad before deciding whether the
    // window stays interactive. If the pad reached the window edge the whole
    // transparent gutter would swallow clicks meant for the app underneath —
    // an invisible border that eats clicks is a behavioural tell on an overlay
    // whose entire value is not being noticed.
    assert.ok(
      OVERLAY_HOVER_GATE_PAD < OVERLAY_PANEL_INSET,
      `hover-gate pad ${OVERLAY_HOVER_GATE_PAD} reaches or exceeds the ${OVERLAY_PANEL_INSET}px ` +
        `gutter — the gutter becomes interactive and swallows clicks`,
    );
    // Not zero either: the gate flips the window over IPC and needs hysteresis.
    assert.ok(OVERLAY_HOVER_GATE_PAD > 0);
  });

  test('panelWidthForWindow takes the gutter off both sides', () => {
    assert.equal(
      panelWidthForWindow(OVERLAY_DEFAULT_WINDOW_WIDTH),
      OVERLAY_DEFAULT_WINDOW_WIDTH - OVERLAY_PANEL_INSET * 2,
    );
    assert.equal(panelWidthForWindow(1200), 1200 - OVERLAY_PANEL_INSET * 2);
  });

  test('panelWidthForWindow never returns a negative width', () => {
    // A window narrower than its own gutter is nonsense, but a clamp upstream
    // could still hand one over; a negative panel width would invert every
    // rect built from it.
    assert.equal(panelWidthForWindow(0), 0);
    assert.equal(panelWidthForWindow(OVERLAY_PANEL_INSET), 0);
  });

  test('the panel is STRICTLY narrower than its window — the whole point', () => {
    for (const w of [366, 732, 1044, 1200, 1470]) {
      assert.ok(
        panelWidthForWindow(w) < w,
        `panel ${panelWidthForWindow(w)} is not inside window ${w} — the ring has no room to paint`,
      );
    }
  });

  test('collapsedPanelForWindow derives from the PANEL width, not the window', () => {
    // Feeding the window width straight to collapsedWidthFor is the exact bug
    // that shipped in the first pass: it produced 600 where the render's
    // SHELL_WIDTH_COLLAPSED derivation produced 590, so the boot seed and the
    // reset paths sat 10px wider than every other path believed.
    assert.equal(
      collapsedPanelForWindow(OVERLAY_DEFAULT_WINDOW_WIDTH),
      collapsedWidthFor(OVERLAY_DEFAULT_WINDOW_WIDTH - OVERLAY_PANEL_INSET * 2),
    );
    assert.notEqual(
      collapsedPanelForWindow(OVERLAY_DEFAULT_WINDOW_WIDTH),
      collapsedWidthFor(OVERLAY_DEFAULT_WINDOW_WIDTH),
    );
  });

  test('defaultCollapsedPanelWidth is that same derivation at the default window', () => {
    assert.equal(defaultCollapsedPanelWidth(), collapsedPanelForWindow(OVERLAY_DEFAULT_WINDOW_WIDTH));
  });

  test('the collapsed panel still fits inside the window with both gutters', () => {
    for (const w of [366, 732, 1044, 1470]) {
      assert.ok(
        collapsedPanelForWindow(w) + OVERLAY_PANEL_INSET * 2 <= w,
        `collapsed panel ${collapsedPanelForWindow(w)} + gutters overflows window ${w}`,
      );
    }
  });

  test('the collapsed panel is a whole number at the default window', () => {
    // A fractional panel width puts the card on a half pixel, which blurs the
    // 1px border and makes the ring's gap uneven on left vs right.
    assert.ok(Number.isInteger(defaultCollapsedPanelWidth()));
  });

  test('OVERLAY_DEFAULT_COLLAPSED_WIDTH is the WINDOW-era constant, not the panel', () => {
    // Documents why the two differ, so a future reader does not "fix" the gap
    // by pointing the reset paths back at the raw constant.
    assert.ok(defaultCollapsedPanelWidth() < OVERLAY_DEFAULT_COLLAPSED_WIDTH);
  });
});

// ── The main process has to know about the gutter too ────────────────────
//
// positionToggleWindow and positionPillWindow place aux BrowserWindows against
// the PANEL's top edge, but only have the WINDOW's bounds to work from. Both
// read o.y, which is now one gutter ABOVE the panel. Unfixed, the toggle rode a
// corner the panel does not have (6px too high) and the pill's visible gap grew
// by the same 6px. Nothing else in the repo covers aux window placement, which
// is why both regressions were invisible until they were measured live.
describe('main-process aux anchors account for the gutter', () => {
  const src = readFileSync(resolve(process.cwd(), 'electron/WindowHelper.ts'), 'utf8');
  const bodyOf = (name) => {
    const i = src.indexOf(`private ${name}(): void {`);
    assert.ok(i !== -1, `${name} not found in WindowHelper.ts — renamed? update this test`);
    return src.slice(i, src.indexOf('\n  }', i));
  };

  test('WindowHelper imports the gutter constant', () => {
    assert.match(src, /import\s*\{[^}]*OVERLAY_PANEL_INSET[^}]*\}\s*from\s*'\.\.\/src\/lib\/overlayCustomSize\.mjs'/);
  });

  for (const name of ['positionToggleWindow', 'positionPillWindow']) {
    test(`${name} offsets the window's top by the gutter to reach the panel's`, () => {
      const body = bodyOf(name);
      assert.match(
        body,
        /o\.y\s*\+\s*OVERLAY_PANEL_INSET/,
        `BUG: ${name} anchors to o.y — the WINDOW's top — but places chrome against the ` +
          `PANEL's top, which sits OVERLAY_PANEL_INSET lower. The aux window will be off ` +
          `by exactly the gutter.`,
      );
    });
  }
});
