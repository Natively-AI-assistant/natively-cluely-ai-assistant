import type { BrowserWindow, Display, Rectangle, screen } from 'electron';
import { clampSizeToAspectRatio } from './launcherAspect';

type RestoreScreen = Pick<typeof screen,
  'getCursorScreenPoint' | 'getDisplayNearestPoint' | 'getDisplayMatching' | 'getPrimaryDisplay'>;

/** Cursor first; a focused Natively window is the fallback when cursor lookup fails. */
export function shortcutRestoreDisplay(
  displays: RestoreScreen,
  focusedWindow: BrowserWindow | null,
  currentBounds: Rectangle,
): Display {
  try {
    const point = displays.getCursorScreenPoint();
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      return displays.getDisplayNearestPoint(point);
    }
  } catch { /* Cursor lookup is unavailable on some window systems. */ }
  if (focusedWindow && !focusedWindow.isDestroyed()) {
    return displays.getDisplayMatching(focusedWindow.getBounds());
  }
  try {
    return displays.getDisplayMatching(currentBounds);
  } catch {
    return displays.getPrimaryDisplay();
  }
}

/** Coordinates are Electron DIP units, including displays left of/above the primary. */
export function shortcutRestoreBounds(
  bounds: Rectangle,
  workArea: Rectangle,
  changingDisplay: boolean,
  options: { launcher?: boolean; topInset?: number } = {},
): Rectangle {
  const topInset = Math.min(options.topInset ?? 0, Math.max(0, workArea.height - 1));
  const available = { ...workArea, y: workArea.y + topInset, height: workArea.height - topInset };
  let width = Math.max(1, Math.min(bounds.width, available.width));
  let height = Math.max(1, Math.min(bounds.height, available.height));
  if (options.launcher) ({ width, height } = clampSizeToAspectRatio(width, height));
  return {
    x: changingDisplay
      ? Math.round(available.x + (available.width - width) / 2)
      : Math.min(Math.max(bounds.x, available.x), available.x + available.width - width),
    y: changingDisplay
      ? Math.round(available.y + (available.height - height) / 2)
      : Math.min(Math.max(bounds.y, available.y), available.y + available.height - height),
    width,
    height,
  };
}
