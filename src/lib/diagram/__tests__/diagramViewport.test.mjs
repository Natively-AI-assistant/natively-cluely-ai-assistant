import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fitDiagram, clampPan, clampZoom, zoomAbout, wheelZoomsDiagram, exportPixelSize, DIAGRAM_VIEW_LIMITS } from '../diagramViewport.mjs';

describe('fitDiagram', () => {
  test('a small diagram keeps its natural size (never enlarged)', () => {
    const f = fitDiagram({ naturalWidth: 300, naturalHeight: 120, containerWidth: 600 });
    assert.equal(f.scale, 1);
    assert.equal(f.width, 300);
    assert.equal(f.viewportHeight, 120);
  });

  test('a wide diagram is scaled to the card, never wider than it', () => {
    const f = fitDiagram({ naturalWidth: 1800, naturalHeight: 300, containerWidth: 600 });
    assert.ok(Math.abs(f.width - 600) < 1e-6);
    assert.ok(Math.abs(f.height - 100) < 1e-6);
    assert.equal(f.viewportHeight, 100);
  });

  test('a tall diagram is bounded by the height limit', () => {
    const f = fitDiagram({ naturalWidth: 400, naturalHeight: 2000, containerWidth: 600 });
    assert.equal(f.viewportHeight, DIAGRAM_VIEW_LIMITS.maxHeight);
    assert.ok(Math.abs(f.height - DIAGRAM_VIEW_LIMITS.maxHeight) < 1e-6);
    assert.ok(f.width < 400);
  });

  test('a very flat diagram still gets a usable viewport', () => {
    const f = fitDiagram({ naturalWidth: 900, naturalHeight: 20, containerWidth: 600 });
    assert.equal(f.viewportHeight, DIAGRAM_VIEW_LIMITS.minHeight);
  });

  test('smaller displays: the same diagram just fits a narrower card', () => {
    const f = fitDiagram({ naturalWidth: 900, naturalHeight: 500, containerWidth: 320, maxHeight: 260 });
    assert.ok(f.width <= 320 + 1e-6);
    assert.ok(f.height <= 260 + 1e-6);
  });

  test('zero or missing measurements never divide by zero', () => {
    const f = fitDiagram({ naturalWidth: 0, naturalHeight: NaN, containerWidth: 0 });
    assert.ok(Number.isFinite(f.scale) && f.scale > 0);
  });
});

describe('clampPan / zoomAbout', () => {
  const box = { fitWidth: 600, fitHeight: 300, viewportWidth: 600, viewportHeight: 300 };

  test('at fit the image is centred and cannot be dragged', () => {
    assert.deepEqual(clampPan({ x: -50, y: 40 }, { imageWidth: 600, imageHeight: 300, viewportWidth: 600, viewportHeight: 300 }), { x: 0, y: 0 });
    assert.deepEqual(clampPan({ x: 99, y: 99 }, { imageWidth: 300, imageHeight: 100, viewportWidth: 600, viewportHeight: 300 }), { x: 150, y: 100 });
  });

  test('zoomed in, the image can be dragged but never leaves a gap', () => {
    const image = { imageWidth: 1200, imageHeight: 600, viewportWidth: 600, viewportHeight: 300 };
    assert.deepEqual(clampPan({ x: 50, y: 50 }, image), { x: 0, y: 0 });
    assert.deepEqual(clampPan({ x: -9999, y: -9999 }, image), { x: -600, y: -300 });
    assert.deepEqual(clampPan({ x: -200, y: -100 }, image), { x: -200, y: -100 });
  });

  test('zooming about a point keeps that point of the image under it', () => {
    const before = { zoom: 1, x: 0, y: 0 };
    const anchor = { x: 450, y: 150 };
    const after = zoomAbout(before, 2, anchor, box);
    // image point under the anchor, in fit units, before and after
    const pointBefore = (anchor.x - before.x) / before.zoom;
    const pointAfter = (anchor.x - after.x) / after.zoom;
    assert.ok(Math.abs(pointBefore - pointAfter) < 1e-6);
    assert.equal(after.zoom, 2);
  });

  test('zoom is clamped, and zooming back out to fit recentres', () => {
    assert.equal(clampZoom(0.2), 1);
    assert.equal(clampZoom(99), DIAGRAM_VIEW_LIMITS.maxZoom);
    assert.equal(clampZoom(NaN), 1);
    const zoomed = zoomAbout({ zoom: 1, x: 0, y: 0 }, 3, { x: 600, y: 300 }, box);
    const reset = zoomAbout(zoomed, 1, { x: 300, y: 150 }, box);
    assert.deepEqual(reset, { zoom: 1, x: 0, y: 0 });
  });
});

describe('wheel and export', () => {
  test('a plain wheel never zooms: it belongs to the chat scroll', () => {
    assert.equal(wheelZoomsDiagram({ deltaY: 40 }), false);
    assert.equal(wheelZoomsDiagram({ ctrlKey: true }), true, 'pinch arrives as ctrl+wheel');
    assert.equal(wheelZoomsDiagram({ metaKey: true }), true);
    assert.equal(wheelZoomsDiagram(null), false);
  });

  test('PNG export is 2x, bounded for huge diagrams', () => {
    assert.deepEqual(exportPixelSize(600, 300), { width: 1200, height: 600, scale: 2 });
    const big = exportPixelSize(6000, 1500);
    assert.ok(big.width <= 4096 && big.height <= 4096);
    assert.ok(big.scale < 1);
  });
});
