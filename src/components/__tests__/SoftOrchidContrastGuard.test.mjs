/**
 * SoftOrchidContrastGuard.test.mjs
 *
 * Regression guard for the Soft Orchid Settings rebrand (2026-07).
 *
 * THE GAP THIS CLOSES: the light-mode orchid accent (#984DB2, orchid-600) was
 * chosen over the raw brand palette's orchid-300 (#D9A7E8, used in dark mode)
 * because the raw palette is calibrated for a dark background — orchid-300 on
 * white measures well under WCAG AA. The darker substitution was picked by
 * eye, not verified against a computed ratio. This test computes the real
 * WCAG 2.x contrast ratio for every accent/foreground pairing actually used
 * across the three token systems introduced by the rebrand (main app
 * `index.css`, Profile Intelligence's `--pi-*`, Modes Manager's `--mm-*`) and
 * fails if any pairing drops below its required threshold — so a future hue
 * nudge can't silently reintroduce a legibility regression.
 *
 * Thresholds: WCAG 2.x AA — 4.5:1 for normal text, 3:1 for large text/icons
 * and other non-text UI components (SC 1.4.3, 1.4.11).
 *
 * Run: `node --test src/components/__tests__/SoftOrchidContrastGuard.test.mjs`
 * (pure color math — no build step, no DOM)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function relLuminance([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [r, g, b].map(lin);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hexA, hexB) {
  const La = relLuminance(hexToRgb(hexA));
  const Lb = relLuminance(hexToRgb(hexB));
  const [light, dark] = La > Lb ? [La, Lb] : [Lb, La];
  return (light + 0.05) / (dark + 0.05);
}

const AA_TEXT = 4.5;
const AA_ICON = 3.0;

// Every accent/foreground pairing actually rendered by the rebrand, across
// all three token systems. Keep this list in sync with the hex values in
// src/index.css ([data-settings-theme="orchid"] blocks), the `.pi-root`
// block in src/components/ProfileIntelligenceSettings.tsx, and the
// `.modes-manager-root` block in premium/src/ModesSettings.tsx.
const PAIRINGS = [
  // Main Settings modal (src/index.css)
  { label: 'Settings dark: --on-accent text on --accent-primary fill',      fg: '#1A1020', bg: '#D9A7E8', min: AA_TEXT },
  { label: 'Settings light: --on-accent text on --accent-primary fill',     fg: '#FFFFFF', bg: '#984DB2', min: AA_TEXT },
  { label: 'Settings light: --accent-primary as text/icon on white card',   fg: '#984DB2', bg: '#FFFFFF', min: AA_TEXT },
  { label: 'Settings light: --accent-primary as text/icon on canvas',      fg: '#984DB2', bg: '#FAFAFA', min: AA_TEXT },
  { label: 'Settings dark: --accent-primary as text/icon on main bg',      fg: '#D9A7E8', bg: '#1E1E21', min: AA_TEXT },
  { label: 'Settings dark: --accent-primary as text/icon on card bg',      fg: '#D9A7E8', bg: '#242429', min: AA_TEXT },

  // Profile Intelligence (--pi-* — ProfileIntelligenceSettings.tsx)
  { label: 'PI dark: --pi-on-accent on --pi-accent fill',                   fg: '#1A1020', bg: '#D9A7E8', min: AA_TEXT },
  { label: 'PI light: --pi-on-accent on --pi-accent fill',                  fg: '#FFFFFF', bg: '#984DB2', min: AA_TEXT },

  // Modes Manager (--mm-* — premium/src/ModesSettings.tsx). The checkmark
  // dot is a non-text icon, so the 3:1 (not 4.5:1) threshold applies.
  { label: 'MM dark: checkmark (--mm-bg) on --mm-active-blue fill',         fg: '#111111', bg: '#D9A7E8', min: AA_ICON },
  { label: 'MM light: checkmark (--mm-bg) on --mm-active-blue fill',        fg: '#FFFFFF', bg: '#984DB2', min: AA_ICON },
];

describe('Soft Orchid — WCAG AA contrast guard', () => {
  for (const { label, fg, bg, min } of PAIRINGS) {
    test(`${label} (>= ${min}:1)`, () => {
      const ratio = contrastRatio(fg, bg);
      assert.ok(
        ratio >= min,
        `${label}: computed ratio ${ratio.toFixed(2)}:1 is below the required ${min}:1 — ` +
        `this pairing needs a darker/lighter accent step, not a hue tweak alone.`
      );
    });
  }
});
