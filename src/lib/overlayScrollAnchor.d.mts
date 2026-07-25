export interface ScrollAnchorSnapshot {
  wasAtBottom: boolean;
  entries: Array<{ id: string; offset: number }>;
}

export function captureScrollAnchor(
  container: HTMLElement | null,
): ScrollAnchorSnapshot | null;

export function restoreScrollAnchor(
  container: HTMLElement | null,
  snapshot: ScrollAnchorSnapshot | null,
): void;
