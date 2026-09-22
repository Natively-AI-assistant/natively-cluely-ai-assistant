export interface GenieGeometry {
  /** Card top edge on screen, px, measured at rest. */
  top: number;
  /** Card bottom edge on screen, px, measured at rest. */
  bottom: number;
  /** Card width, px. */
  width: number;
  /** Screen y of the slot the card drains into, px. */
  slotY: number;
}

export interface GenieFrame {
  transform: string;
  clipPath: string;
  opacity: number;
}

export declare const SLOT_WIDTH: number;
export declare const SLOT_INSET: number;
export declare function genieStretch(p: number): number;
export declare function genieDrain(p: number): number;
export declare function genieEdges(p: number, geom: GenieGeometry): { top: number; bottom: number };
export declare function genieHalfWidthAt(p: number, geom: GenieGeometry, y: number): number;
export declare function genieOpacity(p: number): number;
export declare function genieFrame(p: number, geom: GenieGeometry | null): GenieFrame;

export declare function quadMatrix3d(w: number, h: number, quad: [number, number][]): string;

export declare const BAND_OVERLAP: number;
/** Row ranges [y0, y1] in px, whole pixels, about `count` of them. */
export declare function genieBandRows(height: number, count: number): [number, number][];
/** One matrix3d per band, for a container at top = y0, transform-origin 0 0. */
export declare function genieBands(p: number, geom: GenieGeometry, rows: [number, number][]): string[];
