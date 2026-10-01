// Routes a user action from the overlay aux windows (top pill, resize toggle).
//
// Layout actions (toggle-width, toggle-expand) change state the overlay
// renderer owns, so they are relayed to it. Stop is different: the meeting is
// owned by main, and relaying the click through the overlay renderer made Stop
// only as reliable as that renderer. Measured: a busy overlay renderer delayed
// the stop by as long as it was busy, and a click while it was crashed or
// reloading was dropped without a trace. So main ends the meeting here and the
// overlay is told only that it ended, for its bookkeeping (analytics, the
// profile-toaster flag). It is never asked to stop again: a stop it processed
// late would end whatever meeting the user had started in the meantime.

export interface OverlayUiAction {
  type?: string;
}

export interface OverlayUiActionDeps {
  endMeeting: () => Promise<void>;
  forwardToOverlay: (action: { type: string }) => void;
  log?: (message: string, error?: unknown) => void;
}

export async function routeOverlayUiAction(
  action: OverlayUiAction | null | undefined,
  deps: OverlayUiActionDeps,
): Promise<void> {
  const type = action?.type;
  if (!type) return;
  const log = deps.log ?? ((message: string, error?: unknown) => console.log(message, error ?? ''));

  if (type !== 'end-meeting') {
    deps.forwardToOverlay({ type });
    return;
  }

  log('[OverlayUi] end-meeting from the pill — ending in main');
  try {
    deps.forwardToOverlay({ type: 'meeting-ended' });
  } catch (error) {
    // Bookkeeping only; the stop below must not depend on the overlay.
    log('[OverlayUi] could not notify the overlay of end-meeting', error);
  }
  try {
    await deps.endMeeting();
  } catch (error) {
    log('[OverlayUi] end-meeting failed', error);
  }
}
