/**
 * Recovers clicks whose press never reached the page.
 *
 * Live-reproduced 2026-09-26 on Windows in the overlay's popover windows (settings, model
 * selector — non-activating, overlay-owned): a real click delivered pointerup/mouseup but no
 * pointerdown/mousedown, so the browser never synthesised a click. Settings switches stayed
 * put and model rows could not be picked. The press is lost below the page, so the page can
 * only recover from the release.
 *
 * A release that follows a press is left to the browser's own click. Only an orphaned
 * primary-button release activates, so one physical click can never fire twice.
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

const ACTIVATABLE = 'button, [role="button"], [role="switch"], [role="option"], [role="menuitem"], a[href]';

/**
 * Window-level install: an orphaned primary release clicks the control under it.
 * Capture phase, so it sees every press before any handler can stop it.
 * @returns {() => void} uninstall
 */
export function installOrphanReleaseClick(win) {
  const guard = createOrphanReleaseGuard();
  const onDown = () => guard.press();
  const onCancel = () => guard.cancel();
  const onUp = (e) => {
    if (!guard.release(e.button)) return;
    const el = typeof e.target?.closest === 'function' ? e.target.closest(ACTIVATABLE) : null;
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    el.click();
  };
  win.addEventListener('pointerdown', onDown, true);
  win.addEventListener('pointercancel', onCancel, true);
  win.addEventListener('pointerup', onUp, true);
  return () => {
    win.removeEventListener('pointerdown', onDown, true);
    win.removeEventListener('pointercancel', onCancel, true);
    win.removeEventListener('pointerup', onUp, true);
  };
}
