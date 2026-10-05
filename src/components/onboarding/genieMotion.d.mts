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
/** How far in, px, the silhouette pinches before the card's shadow has gone. */
export declare const SHADOW_PINCH_PX: number;
/** The shadow stand-in's opacity: whole while the card is a rectangle, gone once it pinches in. */
export declare function genieShadowOpacity(p: number, geom: GenieGeometry): number;
export declare function genieFrame(p: number, geom: GenieGeometry | null): GenieFrame;

export declare function quadMatrix3d(w: number, h: number, quad: [number, number][]): string;

export declare const BAND_OVERLAP: number;
/** Row ranges [y0, y1] in px, whole pixels, about `count` of them. */
export declare function genieBandRows(height: number, count: number): [number, number][];
/** One matrix3d per band, for a container at top = y0, transform-origin 0 0. */
export declare function genieBands(p: number, geom: GenieGeometry, rows: [number, number][]): string[];

export interface GenieTrack {
  /** Keyframe offsets, 0..1. */
  offsets: number[];
  /** Per band, one matrix3d per offset. */
  bands: string[][];
  layerOpacity: number[];
  shadowTransform: string[];
  shadowOpacity: number[];
}
/** The genie from `from` to `to`, sampled `hz` times a second, for the compositor to hold frame by frame. */
export declare function genieTrack(
  from: number, to: number, ease: (t: number) => number, durationMs: number,
  geom: GenieGeometry, rows: [number, number][], hz?: number,
): GenieTrack;

/** Handle length of each funnel side's cubic Bezier, as a share of its height (1/3 would be smoothstep). */
export declare const SIDE_HANDLE: number;
/** The side curve: at `u` of the way down the funnel, how far in from the card's edge to the slot's (0..1). */
export declare function genieSide(u: number): number;

/** The lift a card opens and closes with when the genie is turned off in Settings. */
export declare const LIFT_EASE: string;
export declare const LIFT: {
  hidden: Record<'transform' | 'opacity' | 'filter', string>;
  shown: Record<'transform' | 'opacity' | 'filter', string>;
  closed: Record<'transform' | 'opacity' | 'filter', string>;
  open: { transform: number; opacity: number; filter: number; dim: number };
  close: { transform: number; opacity: number; filter: number; dim: number };
};
export declare function liftMs(phase: 'open' | 'close'): number;
export declare function playLift(card: HTMLElement, phase: 'open' | 'close'): () => void;

type SlideState = { transform: string; opacity: string; filter: string };
type SlideClock = { transform: number; opacity: number; filter: number };
export declare const SLIDE_EASE: string;
export declare const SLIDE_OUT_EASE: string;
export declare const SLIDE_FADE_OUT_EASE: string;
export declare const SLIDE_EASES: Record<'open' | 'close', Record<'transform' | 'opacity' | 'filter', string>>;
export declare const SLIDE: {
  away: Omit<SlideState, 'transform'>;
  shown: SlideState;
  open: SlideClock;
  close: SlideClock;
};
export declare function slideMs(phase: 'open' | 'close'): number;
export declare function slideAway(travelPx: number): SlideState;
export declare function playSlide(card: HTMLElement, phase: 'open' | 'close', travelPx: number): () => void;
