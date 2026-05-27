/**
 * Pure stealth focus / tap-engage guards (unit-tested).
 * Mirrors blockInputFocus and click-to-engage onMouseDown in NativelyInterface.
 */

/** CGEventTap is only available on macOS — set synchronously from preload platform. */
export function resolveCgEventTapAvailable(platform) {
  return platform === 'darwin';
}

/** Mirrors blockInputFocus — block DOM focus only when auto-engage is ok and tap exists. */
export function shouldBlockFocus({ stealthAutoEngageOk, isCgEventTapAvailable }) {
  if (!stealthAutoEngageOk) return false;
  if (!isCgEventTapAvailable) return false;
  return true;
}

/**
 * Mirrors click-to-engage onMouseDown (capture phase).
 * Platform availability is gated at effect mount (stealthTapStart IPC absent off macOS).
 */
export function shouldFireStealthTapStart({
  stealthTapActive,
  stealthAutoEngageOk,
  isStealthEngageTarget,
}) {
  if (stealthTapActive) return false;
  if (!stealthAutoEngageOk) return false;
  if (!isStealthEngageTarget) return false;
  return true;
}
