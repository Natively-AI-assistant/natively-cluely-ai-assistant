/**
 * Decides whether a pointer release should activate a control whose press never arrived.
 *
 * Live-reproduced 2026-09-26 on Windows in the overlay settings popover (a non-activating,
 * overlay-owned window): a real click delivered pointerup/mouseup to the toggle but no
 * pointerdown/mousedown, so the browser never synthesised a click and the switch stayed put.
 * The press is lost below the page, so the page can only recover from the release.
 *
 * A release that follows a press on the same control is left to the normal click. Only an
 * orphaned primary-button release activates, so one physical click can never toggle twice.
 */
export function createOrphanReleaseGuard() {
  let pressed = false;
  return {
    press() { pressed = true; },
    cancel() { pressed = false; },
    /** @returns {boolean} true when this release must be treated as the click */
    release(button) {
      const hadPress = pressed;
      pressed = false;
      return button === 0 && !hadPress;
    },
  };
}
