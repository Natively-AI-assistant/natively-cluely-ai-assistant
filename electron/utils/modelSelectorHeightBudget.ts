/**
 * How tall the meeting overlay's model dropdown may be.
 *
 * The dropdown opens under the overlay. When it is taller than the room left
 * above the bottom of the screen, ensureVisibleOnScreen pushes it UP, over the
 * answer the user is reading. Capping it to that room makes the list scroll
 * instead. Below MIN_PANEL_HEIGHT (about three rows) a shorter list stops being
 * usable, so the push-up is allowed for the remainder.
 *
 * Coordinates are DIPs from Electron's screen API on both macOS and Windows.
 */

/** Gap kept between the dropdown and the bottom of the work area. */
export const MODEL_SELECTOR_SCREEN_MARGIN = 8;

/** Smallest budget handed out: three 30px rows plus padding. */
export const MODEL_SELECTOR_MIN_PANEL_HEIGHT = 120;

export function modelSelectorHeightBudget(
    workArea: { y: number; height: number },
    windowTop: number,
): number {
    const room = workArea.y + workArea.height - windowTop - MODEL_SELECTOR_SCREEN_MARGIN;
    return Math.max(MODEL_SELECTOR_MIN_PANEL_HEIGHT, Math.floor(room));
}
