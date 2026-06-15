export interface OverlayHitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function isPointerOverContent(
  rect: OverlayHitRect | null | undefined,
  x: number,
  y: number,
): boolean;
