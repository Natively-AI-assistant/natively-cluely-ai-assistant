export function clamp(n: number, lo: number, hi: number): number;

export interface WidthDerivedScrollMaxOpts {
  collapsedWidth?: number;
  expandedWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

export function widthDerivedScrollMax(
  width: number,
  opts?: WidthDerivedScrollMaxOpts,
): number;

export interface VerticalScrollCapParams {
  availHeight: number;
  chromeHeight: number;
  budgetRatio?: number;
  safetyMargin?: number;
  minScroll?: number;
}

export function verticalScrollCap(params: VerticalScrollCapParams): number;

export interface ComputeScrollMaxHeightParams
  extends WidthDerivedScrollMaxOpts,
    Omit<VerticalScrollCapParams, 'availHeight' | 'chromeHeight'> {
  width: number;
  availHeight: number;
  chromeHeight: number;
}

export function computeScrollMaxHeight(
  params: ComputeScrollMaxHeightParams,
): number;
