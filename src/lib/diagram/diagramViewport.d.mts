export const DIAGRAM_VIEW_LIMITS: Readonly<{ maxHeight: number; minHeight: number; minZoom: number; maxZoom: number; zoomStep: number }>;
export function fitDiagram(input: { naturalWidth: number; naturalHeight: number; containerWidth: number; maxHeight?: number }): {
  scale: number;
  width: number;
  height: number;
  viewportHeight: number;
};
export function clampZoom(zoom: number): number;
export function clampPan(
  pan: { x: number; y: number },
  box: { imageWidth: number; imageHeight: number; viewportWidth: number; viewportHeight: number },
): { x: number; y: number };
export function zoomAbout(
  view: { zoom: number; x: number; y: number },
  nextZoom: number,
  anchor: { x: number; y: number },
  box: { fitWidth: number; fitHeight: number; viewportWidth: number; viewportHeight: number },
): { zoom: number; x: number; y: number };
export function wheelZoomsDiagram(event: { ctrlKey?: boolean; metaKey?: boolean } | null | undefined): boolean;
export function exportPixelSize(naturalWidth: number, naturalHeight: number, maxSide?: number): { width: number; height: number; scale: number };
