/**
 * The notes window's text across a meeting (2026-10-15).
 *
 * The user opens a small notes window from the overlay and types while the
 * call runs. The text goes to main on every change; main keeps it with the
 * running meeting (MeetingPersistence.setLiveUserNotes, which writes it to the
 * live journal within ~2 s, so a crash or quit keeps it) and Stop hands it to
 * the notes as `userNotes`.
 *
 *   idle   no meeting yet. What is typed is kept for the next meeting.
 *   live   a meeting is running; the text is the meeting's.
 *   ended  the meeting stopped. The window says the notes are going into the
 *          meeting notes and offers to open the meeting. Typing still works:
 *          it is saved to that meeting's own copy of the notes (debounced),
 *          so "Your notes" on the meeting page shows it. The next meeting
 *          starts with an empty page.
 *
 * Main never pushes the text back while the user types (the window owns the
 * text); a state broadcast carries `text` only when it changed under the
 * window (a new meeting cleared it).
 *
 * Pure: persistence, broadcast and timers injected
 * (MeetingNotesWindow2026_10_15.test.mjs).
 */

export type LiveNotesPhase = 'idle' | 'live' | 'ended';

export interface LiveNotesState {
    phase: LiveNotesPhase;
    /** The meeting the text belongs to once saved (phase 'ended'); null otherwise or when it was not kept. */
    meetingId: string | null;
    text: string;
}

export interface LiveNotesBroadcast {
    phase: LiveNotesPhase;
    meetingId: string | null;
    /** Present only when the window must replace its text. */
    text?: string;
}

export interface LiveNotesSessionDeps {
    /** The running (or next) meeting's notes: MeetingPersistence.setLiveUserNotes. */
    setLive(text: string): void;
    /** A saved meeting's copy of the notes: DatabaseManager.setMeetingUserNotes. */
    saveEnded(meetingId: string, text: string): void;
    broadcast(state: LiveNotesBroadcast): void;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
    /** Delay before an edit after the meeting reaches its saved copy. */
    endedSaveDelayMs?: number;
}

export const LIVE_NOTES_MAX_CHARS = 50_000;

export class LiveNotesSession {
    private state: LiveNotesState = { phase: 'idle', meetingId: null, text: '' };
    private pending: unknown = null;

    constructor(private readonly deps: LiveNotesSessionDeps) {}

    getState(): LiveNotesState {
        return { ...this.state };
    }

    /** The window's text changed. */
    setText(raw: unknown): void {
        const text = typeof raw === 'string' ? raw.slice(0, LIVE_NOTES_MAX_CHARS) : '';
        if (text === this.state.text) return;
        this.state.text = text;
        if (this.state.phase === 'ended') {
            if (this.state.meetingId) this.scheduleEndedSave();
            return;
        }
        this.deps.setLive(text);
    }

    /** A meeting started: a page left from the last meeting is cleared; a draft typed before Start is kept. */
    meetingStarted(): void {
        this.flushEndedSave();
        const cleared = this.state.phase === 'ended' && this.state.text !== '';
        if (this.state.phase === 'ended') this.state.text = '';
        this.state.phase = 'live';
        this.state.meetingId = null;
        this.deps.setLive(this.state.text);
        this.deps.broadcast({ phase: 'live', meetingId: null, ...(cleared ? { text: '' } : {}) });
    }

    /**
     * Stop (or the automatic stop) saved the meeting as `meetingId`, or did not
     * keep it (null: too short, retention "never", do-not-persist). Anything
     * typed after Stop took the notes is written to the saved copy now.
     */
    meetingEnded(meetingId: string | null, takenText?: string): void {
        if (this.state.phase !== 'live') return;
        this.state.phase = 'ended';
        this.state.meetingId = meetingId;
        // Stop already took the text; the live buffer must not carry it into the next meeting.
        this.deps.setLive('');
        if (meetingId && this.state.text.trim() && this.state.text !== takenText) {
            try { this.deps.saveEnded(meetingId, this.state.text); } catch { /* the window still holds it */ }
        }
        this.deps.broadcast({ phase: 'ended', meetingId });
    }

    /** Write a pending after-the-meeting edit now (quit). */
    flushEndedSave(): void {
        if (this.pending === null) return;
        (this.deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.pending);
        this.pending = null;
        if (this.state.phase === 'ended' && this.state.meetingId) {
            try { this.deps.saveEnded(this.state.meetingId, this.state.text); } catch { /* best effort */ }
        }
    }

    private scheduleEndedSave(): void {
        if (this.pending !== null) return;
        const set = this.deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
        this.pending = set(() => {
            this.pending = null;
            if (this.state.phase === 'ended' && this.state.meetingId) {
                try { this.deps.saveEnded(this.state.meetingId, this.state.text); } catch { /* next edit retries */ }
            }
        }, this.deps.endedSaveDelayMs ?? 1_000);
        (this.pending as { unref?: () => void })?.unref?.();
    }
}
