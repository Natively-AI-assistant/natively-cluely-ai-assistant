// What a meeting opens (2026-10-20): Natively is both an assistant (the
// overlay, for interviews and sales calls) and a notetaker (the notepad, laid
// out like Granola's). People use one or the other, so Settings › Overlay's
// switcher picks it for every meeting:
//
//   overlay   the meeting overlay, as always. The notepad opens only if the
//             user left it open (or opens it from the overlay's Notes button).
//   notepad   the notepad opens at the start, and the overlay stays hidden the
//             whole meeting: the window mode is still 'overlay' (shortcuts,
//             stop, the launcher hidden) but nothing is shown, the state
//             Cmd/Ctrl+B leaves it in, so the same shortcut brings it back.
//
// The default is the overlay, so nobody's meetings change until they switch.
// Pure: no electron import, the same on macOS and Windows
// (MeetingNotesWindow2026_10_15.test.mjs).

export type MeetingSurface = 'overlay' | 'notepad';

export const DEFAULT_MEETING_SURFACE: MeetingSurface = 'overlay';

export function normalizeMeetingSurface(value: unknown): MeetingSurface {
    return value === 'notepad' ? 'notepad' : DEFAULT_MEETING_SURFACE;
}

export interface MeetingStartPlan {
    /** Switch to overlay mode without showing the overlay. */
    overlayHidden: boolean;
    /** Open the notes window (without focus). */
    openNotes: boolean;
}

/** What a meeting start shows, from the chosen surface and whether the notepad was left open. */
export function planMeetingStart(surface: unknown, notesLeftOpen: boolean): MeetingStartPlan {
    const notepad = normalizeMeetingSurface(surface) === 'notepad';
    return { overlayHidden: notepad, openNotes: notepad || notesLeftOpen };
}

/**
 * The user closed the notepad (its X, Cmd+W, Alt+F4; 2026-10-31): what comes
 * up so Natively never leaves the screen empty.
 *
 *   no meeting         'owed-launcher': the launcher a notepad Stop held back
 *                      (WindowHelper.showOwedLauncher; nothing when none is owed).
 *   notepad meeting    'launcher': home, as the overlay's logo does mid-meeting.
 *                      Its "Meeting ongoing" goes back to the notepad
 *                      (planMeetingResume). Before this the meeting ran with
 *                      no window at all.
 *   overlay meeting    'none': the overlay is up, or the user hid it with
 *                      Cmd/Ctrl+B, and it stays as it is.
 */
export type NotesClosedAction = 'owed-launcher' | 'launcher' | 'none';

export function planNotesClosed(meetingActive: boolean, overlayHeldHidden: boolean): NotesClosedAction {
    if (!meetingActive) return 'owed-launcher';
    return overlayHeldHidden ? 'launcher' : 'none';
}

/**
 * The launcher's "Meeting ongoing" (2026-10-31): back to the surface the
 * meeting started on. A notepad meeting reopens the notepad with the overlay
 * still hidden; an overlay meeting shows the overlay and leaves the notepad as it is.
 */
export function planMeetingResume(meetingSurface: unknown): MeetingStartPlan {
    return planMeetingStart(meetingSurface, false);
}
