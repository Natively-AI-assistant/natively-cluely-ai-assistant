export const OVERLAY_DEFAULT_WINDOW_WIDTH: number;
export const OVERLAY_DEFAULT_COLLAPSED_WIDTH: number;
export const OVERLAY_MIN_WINDOW_WIDTH: number;
export const OVERLAY_MIN_WINDOW_HEIGHT: number;
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
}

export function pinsHeightFor(
  direction: OverlayResizeDirection,
  heightAlreadyPinned: boolean,
): boolean;

export function computeResizeFrame(
  params: ComputeResizeFrameParams,
): { width: number; height: number };
