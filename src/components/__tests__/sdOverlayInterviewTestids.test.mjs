/**
 * sdOverlayInterviewTestids.test.mjs
 *
 * Source-level contract for Playwright `e2e:sd-overlay-interview` selectors.
 * No JSX/vitest harness in this package — assert documented data-testid
 * strings are present on the gate strip + overlay answer chrome.
 *
 * Run: `node --test src/components/__tests__/sdOverlayInterviewTestids.test.mjs`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STRIP_SRC = resolve(__dirname, '../SdRequirementsGateStrip.tsx');
const OVERLAY_SRC = resolve(__dirname, '../NativelyInterface.tsx');

const strip = readFileSync(STRIP_SRC, 'utf8');
const overlay = readFileSync(OVERLAY_SRC, 'utf8');

test('gate strip root has data-testid=sd-requirements-gate-strip', () => {
  assert.ok(
    strip.includes('data-testid="sd-requirements-gate-strip"'),
    'SdRequirementsGateStrip root must expose sd-requirements-gate-strip',
  );
});

test('Advance control has data-testid=sd-requirements-gate-advance', () => {
  assert.ok(
    strip.includes('data-testid="sd-requirements-gate-advance"'),
    'Advance button must expose sd-requirements-gate-advance',
  );
});

test('primary answer chrome has data-testid=sd-overlay-answer-panel', () => {
  assert.ok(
    overlay.includes('data-testid="sd-overlay-answer-panel"'),
    'NativelyInterface answer/message panel must expose sd-overlay-answer-panel',
  );
});
