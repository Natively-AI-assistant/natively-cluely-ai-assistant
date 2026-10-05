// Launcher window aspect-ratio contract.
//
// The launcher is FREELY RESIZABLE but its shape is LOCKED to 3:2. The lock
// itself is enforced natively by BrowserWindow.setAspectRatio() (see
// WindowHelper.createWindow), which is documented for BOTH darwin and win32 —
// electron.d.ts tags platform-limited APIs with `@platform`, and
// setAspectRatio carries no such tag.
//
// setAspectRatio only constrains USER drags; Electron explicitly does not apply
// it to programmatic setBounds/setSize. Every size this process chooses for the
// launcher must therefore come from this module so it lands on-ratio, which is
// why the default size, the minimum size and the "maximize" (zoom) size are all
// derived here instead of being hand-written numbers.
//
// Pure math only — no electron import — so both platform branches are testable
// on either OS (electron/utils/__tests__/launcherAspect.test.mjs).

export const LAUNCHER_ASPECT_RATIO = 3 / 2;

/** Default launcher size: 1200x800, i.e. exactly 3:2. */
export const LAUNCHER_DEFAULT_WIDTH = 1200;
export const LAUNCHER_DEFAULT_HEIGHT = LAUNCHER_DEFAULT_WIDTH / LAUNCHER_ASPECT_RATIO;

// 1200x800 is also the FLOOR: the launcher only scales UP from its default.
// Deriving the height from the ratio keeps the minimum on-ratio — a min-size
// that is not 3:2 fights the aspect lock at the corner, because the OS clamps
// to the min box and that clamp then violates the ratio.
export const LAUNCHER_MIN_WIDTH = LAUNCHER_DEFAULT_WIDTH;
export const LAUNCHER_MIN_HEIGHT = LAUNCHER_MIN_WIDTH / LAUNCHER_ASPECT_RATIO;

export interface AspectSize {
  width: number;
  height: number;
}

export interface AspectRect extends AspectSize {
  x: number;
  y: number;
}

/**
 * Largest `ratio`-shaped box that fits inside availableWidth x availableHeight.
 * Height-limited when the available box is wider than the ratio, width-limited
 * otherwise.
 */
export function fitToAspectRatio(
  availableWidth: number,
  availableHeight: number,
  ratio: number = LAUNCHER_ASPECT_RATIO,
): AspectSize {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : LAUNCHER_ASPECT_RATIO;
  const maxWidth = Math.max(1, Math.floor(availableWidth));
  const maxHeight = Math.max(1, Math.floor(availableHeight));

  const widthIfHeightLimited = maxHeight * safeRatio;
  if (widthIfHeightLimited <= maxWidth) {
    return { width: Math.max(1, Math.round(widthIfHeightLimited)), height: maxHeight };
  }
  return { width: maxWidth, height: Math.max(1, Math.round(maxWidth / safeRatio)) };
}

/**
 * Clamp an arbitrary width/height request onto the ratio. The requested box is
 * treated as an upper bound, so the result never grows past what was asked for.
 */
export function clampSizeToAspectRatio(
  width: number,
  height: number,
  ratio: number = LAUNCHER_ASPECT_RATIO,
): AspectSize {
  return fitToAspectRatio(width, height, ratio);
}

/**
 * The launcher's "maximize" target: the largest 3:2 box that fits the work area,
 * centered in it. Native maximize is deliberately NOT used — it fills the work
 * area exactly and would break the ratio lock on both platforms.
 */
export function zoomedLauncherBounds(
  workArea: AspectRect,
  options: { ratio?: number; minWidth?: number; minHeight?: number } = {},
): AspectRect {
  const ratio = options.ratio ?? LAUNCHER_ASPECT_RATIO;
  const minWidth = options.minWidth ?? LAUNCHER_MIN_WIDTH;
  const minHeight = options.minHeight ?? LAUNCHER_MIN_HEIGHT;

  const fitted = fitToAspectRatio(workArea.width, workArea.height, ratio);
  const width = Math.round(Math.max(fitted.width, minWidth));
  const height = Math.round(Math.max(fitted.height, minHeight));

  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}
