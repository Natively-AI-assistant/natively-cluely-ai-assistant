export function clampOverlayPanelSize(
  size: { width?: number; height?: number },
  limits?: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
  },
): { width: number | null; height: number | null };
