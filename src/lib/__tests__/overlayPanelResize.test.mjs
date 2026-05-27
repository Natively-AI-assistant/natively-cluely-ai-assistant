import test from 'node:test';
import assert from 'node:assert/strict';
import { clampOverlayPanelSize } from '../overlayPanelResize.mjs';

test('clampOverlayPanelSize clamps width and height', () => {
  const result = clampOverlayPanelSize({ width: 2000, height: 50 });
  assert.equal(result.width, 1200);
  assert.equal(result.height, 200);
});

test('clampOverlayPanelSize returns null for invalid input', () => {
  const result = clampOverlayPanelSize({});
  assert.equal(result.width, null);
  assert.equal(result.height, null);
});
