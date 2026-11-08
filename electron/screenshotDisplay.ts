/**
 * Which screen a full screenshot captures (Settings › Overlay › Screenshot
 * screen), and the list of screens the setting offers.
 *
 * Pure: displays, the cursor and the overlay's screen are passed in, so both
 * platforms and any monitor layout can be tested without Electron's `screen`.
 *
 * Stored as a string: 'overlay' (the default: the screen the overlay is on),
 * 'cursor' (the screen under the mouse) or 'display:<id>' (one fixed screen).
 * A fixed screen that is no longer connected falls back to the default, so an
 * unplugged monitor never breaks the shortcut.
 */

export type ScreenshotDisplayPreference = 'overlay' | 'cursor' | `display:${number}`;

export const DEFAULT_SCREENSHOT_DISPLAY: ScreenshotDisplayPreference = 'overlay';

/** The parts of Electron.Display this module reads. */
export interface DisplayLike {
  id: number;
  label?: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  internal?: boolean;
}

export interface ScreenshotDisplayOption {
  id: number;
  /** 1-based, left to right then top to bottom: what "Screen 2" means. */
  number: number;
  /** The monitor's own name where the OS gives one ("DELL U2720Q"), else "". */
  name: string;
  /** Resolution in physical pixels, as the monitor's settings show it. */
  width: number;
  height: number;
  primary: boolean;
}

export function parseScreenshotDisplayPreference(value: unknown): ScreenshotDisplayPreference {
  if (value === 'overlay' || value === 'cursor') return value;
  if (typeof value === 'string') {
    const m = /^display:(-?\d+)$/.exec(value);
    if (m && Number.isSafeInteger(Number(m[1]))) return `display:${Number(m[1])}`;
  }
  return DEFAULT_SCREENSHOT_DISPLAY;
}

/** Screens in reading order, so "Screen 1" is the leftmost. */
export function orderDisplays<T extends DisplayLike>(displays: readonly T[]): T[] {
  return [...displays].sort((a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y) || (a.id - b.id));
}

export function listScreenshotDisplays(displays: readonly DisplayLike[], primaryId: number | null): ScreenshotDisplayOption[] {
  return orderDisplays(displays).map((d, i) => ({
    id: d.id,
    number: i + 1,
    name: (d.label ?? '').trim(),
    width: Math.round(d.bounds.width * d.scaleFactor),
    height: Math.round(d.bounds.height * d.scaleFactor),
    primary: d.id === primaryId,
  }));
}

/**
 * The screen a full screenshot captures. `defaultDisplay` is what the app
 * picked before this setting existed (the overlay's screen, else the one under
 * the cursor); `cursorDisplay` is the screen under the mouse right now.
 */
export function resolveScreenshotDisplay<T extends DisplayLike>(
  preference: ScreenshotDisplayPreference,
  displays: readonly T[],
  defaultDisplay: T,
  cursorDisplay: T,
): T {
  if (preference === 'cursor') return cursorDisplay;
  if (preference.startsWith('display:')) {
    const id = Number(preference.slice('display:'.length));
    return displays.find((d) => d.id === id) ?? defaultDisplay;
  }
  return defaultDisplay;
}
