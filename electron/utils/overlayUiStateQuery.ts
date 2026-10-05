// Answers an overlay aux window (top pill, resize toggle) asking for the UI
// state the overlay renderer last broadcast.
//
// The aux windows render from that broadcast. One that loads or reloads after
// it was sent has to catch up, and a push from main on did-finish-load cannot
// do that: the page subscribes later than that event, so the push was dropped
// and a reloaded toggle came back in its default state (see
// __tests__/OverlayAuxStateAfterReload2026_10_05.test.mjs). So the aux window
// asks, once it is listening.
//
// Pure: main passes the ids in, so there is nothing platform-specific here.

/**
 * The last broadcast state for a sender that is one of the aux windows, else
 * null (unknown sender, or nothing has been broadcast yet).
 */
export function overlayUiStateFor(
  senderId: number,
  auxWebContentsIds: Array<number | null | undefined>,
  state: unknown,
): unknown | null {
  if (!auxWebContentsIds.includes(senderId)) return null;
  return state ?? null;
}
