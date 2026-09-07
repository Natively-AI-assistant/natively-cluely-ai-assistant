export const OVERLAY_DEFAULT_WINDOW_WIDTH: number;
export const OVERLAY_DEFAULT_COLLAPSED_WIDTH: number;
export const OVERLAY_MIN_WINDOW_WIDTH: number;
export const OVERLAY_MIN_WINDOW_HEIGHT: number;
export const OVERLAY_CONTENT_MIN_WINDOW_HEIGHT: number;
export const OVERLAY_MAX_WINDOW_WIDTH: number;
export const OVERLAY_MAX_WINDOW_HEIGHT: number;
export const OVERLAY_WORK_AREA_BUDGET: number;
export const CUSTOM_WIDTH_STORAGE_KEY: string;
export const CUSTOM_HEIGHT_STORAGE_KEY: string;

export function clamp(n: number, lo: number, hi: number): number;

export function parseStoredDimension(
  raw: string | null | undefined,
  lo: number,
  hi: number,
): number | null;

export interface CustomOverlaySize {
  width: number | null;
  height: number | null;
}

export interface OverlaySizeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readCustomOverlaySize(
  storage: OverlaySizeStorage | null | undefined,
): CustomOverlaySize;

export function writeCustomOverlaySize(
  storage: OverlaySizeStorage | null | undefined,
  size: { width: number | null; height: number | null },
): boolean;

export function clearCustomOverlaySize(
  storage: OverlaySizeStorage | null | undefined,
): boolean;

export function minWindowHeightFor(chromeHeight: number, minScroll?: number): number;
export function minWindowWidthFor(availWidth: number | undefined): number;

export interface NaturalWindowHeightParams {
  chromeHeight: number;
  scrollHeight?: number;
  maxHeight?: number;
}
export function naturalWindowHeightFor(params: NaturalWindowHeightParams): number;

export interface OverlaySizeBounds {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}
export interface ResizeEnvelopeParams {
  x: number;
  y: number;
  width: number;
  height: number;
  workArea: { x: number; y: number; width: number; height: number };
  budgetRatio?: number;
}
export function resizeEnvelopeFor(params: ResizeEnvelopeParams): { width: number; height: number };
export function panelWidthFloorFor(params: { hasContent: boolean; startWidth: number }): number;
export function releaseWindowWidthFor(panelWidth: number, availWidth: number): number;
export function manualHeightFloorFor(params: {
  hasContent: boolean;
  chromeHeight: number;
  maxHeight?: number;
}): number;

export function clampCustomOverlaySize(
  size: CustomOverlaySize | null | undefined,
  bounds: OverlaySizeBounds | null | undefined,
): CustomOverlaySize;
export function maxWindowWidthFor(availWidth: number): number;
export function maxWindowHeightFor(availHeight: number): number;
export function collapsedWidthFor(windowWidth: number): number;

export type OverlayResizeDirection = 'e' | 's' | 'se';

export interface ComputeResizeFrameParams {
  direction: OverlayResizeDirection;
  dx: number;
  dy: number;
  startWidth: number;
  startHeight: number;
  maxWidth?: number;
  maxHeight?: number;
  minHeight?: number;
  minWidth?: number;
}

export function pinsHeightFor(
  direction: OverlayResizeDirection,
  heightAlreadyPinned: boolean,
): boolean;

export function computeResizeFrame(
  params: ComputeResizeFrameParams,
): { width: number; height: number };

export interface PanelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function pointerOverPanel(
  point: { x: number; y: number },
  rect: PanelRect | null | undefined,
  pad?: number,
): boolean;

export interface PinnedViewportBudgetParams {
  pinnedHeight: number | null;
  pinIsCeiling: boolean;
  chromeHeight: number;
  availHeight: number;
}

export function pinnedViewportBudget(
  params: PinnedViewportBudgetParams,
): { cap: number; room: number; ceiling: boolean };
