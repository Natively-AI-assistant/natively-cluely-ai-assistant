// Fit / zoom / pan maths for a diagram shown inside a fixed viewport.
//
// The diagram is an image with a natural size. The viewport is as wide as the
// answer card and never taller than `maxHeight`, so a wide architecture
// diagram cannot make the overlay wider than the display and a tall sequence
// diagram cannot push the rest of the answer off screen.
//
// "Fit" means: the whole diagram visible, never enlarged past its natural size.
// Zoom is relative to that fit (1 = fit). Pure — no DOM, no state.

export const DIAGRAM_VIEW_LIMITS = Object.freeze({
  maxHeight: 420,
  minHeight: 96,
  minZoom: 1,
  maxZoom: 6,
  zoomStep: 1.35,
});

function finite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The scale that shows the whole diagram, and the viewport size at that scale.
 *
 * @param {{ naturalWidth: number, naturalHeight: number, containerWidth: number, maxHeight?: number }} input
 * @returns {{ scale: number, width: number, height: number, viewportHeight: number }}
 */
export function fitDiagram(input) {
  const naturalWidth = finite(input.naturalWidth, 1);
  const naturalHeight = finite(input.naturalHeight, 1);
  const containerWidth = finite(input.containerWidth, naturalWidth);
  const maxHeight = finite(input.maxHeight, DIAGRAM_VIEW_LIMITS.maxHeight);
  const scale = Math.min(1, containerWidth / naturalWidth, maxHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    scale,
    width,
    height,
    viewportHeight: Math.max(Math.min(DIAGRAM_VIEW_LIMITS.minHeight, maxHeight), Math.min(maxHeight, Math.ceil(height))),
  };
}

export function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return DIAGRAM_VIEW_LIMITS.minZoom;
  return Math.min(DIAGRAM_VIEW_LIMITS.maxZoom, Math.max(DIAGRAM_VIEW_LIMITS.minZoom, zoom));
}

/**
 * Keep the image covering the viewport where it is larger than it, and centred
 * where it is smaller. Offsets are of the image's top-left from the viewport's.
 *
 * @param {{ x: number, y: number }} pan
 * @param {{ imageWidth: number, imageHeight: number, viewportWidth: number, viewportHeight: number }} box
 */
export function clampPan(pan, box) {
  const axis = (offset, image, viewport) => {
    if (image <= viewport) return (viewport - image) / 2;
    return Math.min(0, Math.max(viewport - image, offset));
  };
  return {
    x: axis(Number.isFinite(pan.x) ? pan.x : 0, box.imageWidth, box.viewportWidth),
    y: axis(Number.isFinite(pan.y) ? pan.y : 0, box.imageHeight, box.viewportHeight),
  };
}

/**
 * Zoom about a point in the viewport (the pointer, or the centre for the
 * buttons), keeping that point of the image under it.
 *
 * @param {{ zoom: number, x: number, y: number }} view   current zoom + pan
 * @param {number} nextZoom
 * @param {{ x: number, y: number }} anchor              point in viewport coordinates
 * @param {{ fitWidth: number, fitHeight: number, viewportWidth: number, viewportHeight: number }} box
 */
export function zoomAbout(view, nextZoom, anchor, box) {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / (view.zoom || 1);
  const pan = clampPan(
    { x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio },
    { imageWidth: box.fitWidth * zoom, imageHeight: box.fitHeight * zoom, viewportWidth: box.viewportWidth, viewportHeight: box.viewportHeight },
  );
  return { zoom, x: pan.x, y: pan.y };
}

/**
 * Should a wheel event zoom the diagram? Only a pinch (which the browser
 * reports as ctrl+wheel) or an explicit ctrl/cmd+wheel. A plain wheel always
 * belongs to the chat scroll — the diagram never traps it.
 */
export function wheelZoomsDiagram(event) {
  return Boolean(event && (event.ctrlKey || event.metaKey));
}

/**
 * Pixel size for a PNG export: 2x for sharpness, bounded so a large diagram
 * cannot ask for an enormous canvas.
 */
export function exportPixelSize(naturalWidth, naturalHeight, maxSide = 4096) {
  const w = finite(naturalWidth, 1);
  const h = finite(naturalHeight, 1);
  const scale = Math.min(2, maxSide / w, maxSide / h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}
