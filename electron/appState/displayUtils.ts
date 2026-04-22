/**
 * Display selection logic for screenshots extracted from AppState.
 * Pure functions — takes display array as input, does not call screen APIs directly.
 */

export interface Display {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
  rotation: number;
  internal: boolean;
}

/**
 * Finds a display by its ID from an array of displays.
 * Returns undefined if not found or if displayId is null.
 */
export function getDisplayById(displays: Display[], displayId: number | null): Display | undefined {
  if (displayId === null) return undefined;
  return displays.find(display => display.id === displayId);
}

/**
 * Selects the target display for a full screenshot.
 * If displayId is provided and found, returns that display.
 * Otherwise returns the first display (primary) as fallback.
 */
export function getTargetDisplay(displays: Display[], displayId: number | null): Display {
  if (displayId !== null) {
    const found = getDisplayById(displays, displayId);
    if (found) return found;
  }

  // Fallback to primary display (first in array)
  if (displays.length > 0) {
    return displays[0];
  }

  throw new Error('No displays available');
}
