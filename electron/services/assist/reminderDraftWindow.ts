// reminderDraftWindow.ts
//
// The calendar reminder's "Running late" opens its draft in the LAUNCHER
// (assist/AssistToday.tsx renders it; the launcher's App owns the request so it
// lands even when a meeting's page is open).
//
// Outside a meeting the launcher is brought up the usual way (centerAndShow).
// During a meeting that would bring up the overlay instead (WindowHelper
// centerAndShowWindow keeps the overlay in front), so the launcher window is
// shown directly, the way the notes window's "Open meeting" does it: inactive
// and with stealth re-applied when Undetectable is on, shown and focused
// otherwise. (The reminder itself never shows in Undetectable; this keeps the
// rule in case that changes.)
//
// No platform branches: show/showInactive/focus behave alike for this window
// on macOS and Windows, and the stealth re-assert is the app's own.

export interface ReminderDraftWindowDeps {
  launcher: {
    isDestroyed(): boolean;
    show(): void;
    showInactive(): void;
    focus(): void;
    webContents: { send(channel: string, payload: unknown): void };
  } | null | undefined;
  meetingActive: boolean;
  undetectable: boolean;
  centerAndShow(): void;
  reassertStealth(): void;
}

/** Sends the draft request to the launcher and brings that window forward. False when there is no launcher. */
export function showLauncherForReminderDraft(deps: ReminderDraftWindowDeps, event: unknown): boolean {
  const launcher = deps.launcher;
  if (!launcher || launcher.isDestroyed()) return false;
  launcher.webContents.send('assist:reminder-draft', { kind: 'running_late', event });
  if (!deps.meetingActive) {
    deps.centerAndShow();
  } else if (deps.undetectable) {
    launcher.showInactive();
    deps.reassertStealth();
  } else {
    launcher.show();
    launcher.focus();
  }
  return true;
}
