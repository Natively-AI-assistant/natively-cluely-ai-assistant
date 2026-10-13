/** @typedef {{ width?: number; height?: number }} OverlayPanelSize */

/**
 * Clamp overlay chat panel dimensions to sensible bounds.
 * @param {OverlayPanelSize} size
 * @param {{ minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number }} [limits]
 * @returns {{ width: number | null; height: number | null }}
 */
export function clampOverlayPanelSize(size, limits = {}) {
  const {
    minWidth = 480,
    maxWidth = 1200,
    minHeight = 200,
    maxHeight = 900,
  } = limits;

  const width =
    typeof size.width === 'number' && Number.isFinite(size.width)
      ? Math.min(maxWidth, Math.max(minWidth, Math.round(size.width)))
      : null;
  const height =
    typeof size.height === 'number' && Number.isFinite(size.height)
      ? Math.min(maxHeight, Math.max(minHeight, Math.round(size.height)))
      : null;

  return { width, height };
}
