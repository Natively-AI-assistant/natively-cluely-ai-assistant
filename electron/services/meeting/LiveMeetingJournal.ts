/**
 * The running meeting's transcript, kept on disk while the meeting runs.
 *
 * Until 2026-10-15 a meeting existed only in memory until Stop: quitting the
 * app (or a crash, or Windows shutting down) mid-meeting lost every word. Now
 * the transcript is written to the database as it grows: at most every 15 s,
 * and within ~2 s of a finished line (never more often than every 5 s), plus
 * once more, synchronously, when the app quits. The row lives in its own table
 * (live_meeting_journal), never in `meetings`, so a meeting in progress is not
 * listed, searched, exported or indexed. At the next launch
 * MeetingPersistence.recoverUnprocessedMeetings turns a left-over row into an
 * ordinary unprocessed meeting and writes its notes.
 *
 * Stop removes the row in the same step that saves the meeting's placeholder,
 * under the same id, so a crash between the two can never make two meetings.
 *
 * Privacy: `snapshot` returns null when the meeting must not be kept (retention
 * "never", the meeting's own do-not-persist): nothing is written, and a row
 * already written is removed.
 *
 * Platform-independent; clock, timers and store injected
 * (LiveMeetingDurability2026_10_15.test.mjs).
 */
import type { TranscriptSegment } from '../../SessionTracker';

/** What recovery needs besides the transcript: the meeting's metadata as Stop would have had it. */
export interface MeetingRecoveryMeta {
    /** The calendar title, when the session was linked to an event. */
    title?: string;
    calendarEventId?: string;
    calendarEvent?: import('../calendar/calendarSessionMatch').CalendarEventSnapshot;
    callKey?: string;
    source?: 'manual' | 'calendar';
    /** The call's own record of who spoke (callRoster), for names on the lines. */
    callRoster?: { participants: string[]; spans: Array<{ name: string; start: number; end: number }>; count?: number };
    /** The user's name as the Zoom / Teams window showed it (for "Me" without a calendar). */
    callSelfName?: string;
    /** What others shared on screen, described (meeting/ScreenShareContext.ts). */
    sharedScreens?: import('./ScreenShareContext').SharedScreenEntry[];
    /** The mode that was active, so the notes use its sections. */
    mode?: { id: string; name: string; templateType: string } | null;
    /** True start of the meeting and how long it ran (ms). */
    startTime: number;
    durationMs: number;
    /** Why it ended without a Stop: 'quit', 'crash' (no quit flush ran), 'os_session_end'. */
    endedBy?: 'quit' | 'crash' | 'os_session_end';
    /**
     * What the user typed in the notes window during the meeting (2026-10-15),
     * so a quit or crash keeps it; recovery hands it to the notes as Stop would.
     */
    userNotes?: string;
    /** The note template picked in the notepad (noteTemplates.ts), so recovery writes the notes in it. */
    noteTemplateId?: string;
    /** What the meeting was taken on (2026-11-02), so a recovered meeting keeps where its Resume lives. */
    surface?: 'overlay' | 'notepad';
    /**
     * A resumed meeting (meetingResume.ts): the live copy holds the whole
     * meeting, saved lines included, so recovery replaces the saved row and
     * keeps the original start and the earlier running time.
     */
    resumed?: { startTime: number; priorDurationMs: number };
    /** A resumed meeting: what its saved notes carry into the new ones (speaker names, people, screens, a follow-up draft). */
    resumeCarry?: import('./meetingResume').ResumeCarry;
    /** A resumed meeting: the resumed part's own start and running time. */
    resumePart?: import('./meetingResume').ResumePart;
}

export interface LiveJournalRow {
    id: string;
    startedAt: number;
    updatedAt: number;
    transcript: TranscriptSegment[];
    usage: any[];
    meta: MeetingRecoveryMeta;
}

export interface LiveJournalStore {
    /** Synchronous upsert (better-sqlite3); throws on failure. */
    write(row: LiveJournalRow): void;
    remove(id: string): void;
}

export interface LiveJournalSnapshot {
    transcript: TranscriptSegment[];
    usage: any[];
    meta: Omit<MeetingRecoveryMeta, 'startTime' | 'durationMs'>;
}

export interface LiveMeetingJournalDeps {
    store: () => LiveJournalStore | null;
    /** The session right now, or null when this meeting must not be kept. */
    snapshot: () => LiveJournalSnapshot | null;
    now?: () => number;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
    log?: (line: string) => void;
}

export interface LiveMeetingJournalOptions {
    /** Longest a new line waits to reach the disk. */
    periodMs?: number;
    /** A finished line is written this soon… */
    finalDebounceMs?: number;
    /** …but never sooner than this after the previous write. */
    minGapMs?: number;
}

export class LiveMeetingJournal {
    private readonly o: Required<LiveMeetingJournalOptions>;
    private readonly now: () => number;
    private id: string | null = null;
    private startedAt = 0;
    private dirty = false;
    private written = false;
    private lastWriteAt = -Infinity;
    private timer: unknown = null;
    private timerAt = Infinity;

    constructor(private readonly deps: LiveMeetingJournalDeps, options: LiveMeetingJournalOptions = {}) {
        this.o = {
            periodMs: options.periodMs ?? 15_000,
            finalDebounceMs: options.finalDebounceMs ?? 2_000,
            minGapMs: options.minGapMs ?? 5_000,
        };
        this.now = deps.now ?? Date.now;
    }

    /** The meeting id the journal writes under (Stop saves the meeting under it too). */
    get meetingId(): string | null {
        return this.id;
    }

    begin(id: string, startedAt: number = this.now()): void {
        this.cancelTimer();
        this.id = id;
        this.startedAt = startedAt;
        this.dirty = false;
        this.written = false;
        this.lastWriteAt = -Infinity;
    }

    /** A line was added to the session (final: a finished line). */
    noteChange(final: boolean): void {
        if (!this.id) return;
        this.dirty = true;
        const now = this.now();
        // A pending write that is already sooner stands (the first change sets
        // the clock), so a steady stream of lines still reaches the disk every
        // period; never sooner than the gap after the last write.
        this.schedule(Math.max(now + (final ? this.o.finalDebounceMs : this.o.periodMs), this.lastWriteAt + this.o.minGapMs));
    }

    /**
     * Write the session now, synchronously. `endedBy` marks a row the app is
     * leaving behind (quit, the OS ending the session). Returns whether a row
     * was written.
     */
    flush(endedBy?: MeetingRecoveryMeta['endedBy']): boolean {
        this.cancelTimer();
        if (!this.id) return false;
        if (!this.dirty && !endedBy) return false;
        const store = this.deps.store();
        if (!store) return false;
        let snap: LiveJournalSnapshot | null = null;
        try {
            snap = this.deps.snapshot();
        } catch (err) {
            this.log(`reading the session failed: ${(err as Error)?.message}`);
            return false;
        }
        if (!snap) {
            // This meeting must not be kept: nothing on disk.
            if (this.written) {
                try { store.remove(this.id); } catch { /* best-effort */ }
                this.written = false;
                this.log('the meeting is not to be kept; its live copy was removed');
            }
            this.dirty = false;
            return false;
        }
        // Notes typed before anyone spoke are worth keeping on their own.
        if (snap.transcript.length === 0 && snap.usage.length === 0 && !snap.meta.userNotes?.trim()) {
            this.dirty = false;
            return false;
        }
        const now = this.now();
        try {
            store.write({
                id: this.id,
                startedAt: this.startedAt,
                updatedAt: now,
                transcript: snap.transcript,
                usage: snap.usage,
                meta: { ...snap.meta, startTime: this.startedAt, durationMs: Math.max(0, now - this.startedAt), ...(endedBy ? { endedBy } : {}) },
            });
            this.written = true;
            this.dirty = false;
            this.lastWriteAt = now;
            return true;
        } catch (err) {
            this.log(`writing the live transcript failed: ${(err as Error)?.message}`);
            // Try again on the next period rather than on every line.
            this.schedule(now + this.o.periodMs);
            return false;
        }
    }

    /** Stop saved the meeting (or dropped it): the live copy goes. */
    end(): void {
        this.cancelTimer();
        const id = this.id;
        this.id = null;
        this.dirty = false;
        if (!id || !this.written) return;
        this.written = false;
        try { this.deps.store()?.remove(id); } catch (err) { this.log(`removing the live copy failed: ${(err as Error)?.message}`); }
    }

    private schedule(at: number): void {
        if (this.timer !== null && this.timerAt <= at) return;
        this.cancelTimer();
        const set = this.deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
        this.timerAt = at;
        this.timer = set(() => {
            this.timer = null;
            this.timerAt = Infinity;
            this.flush();
        }, Math.max(0, at - this.now()));
        (this.timer as { unref?: () => void })?.unref?.();
    }

    private cancelTimer(): void {
        if (this.timer === null) return;
        (this.deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
        this.timer = null;
        this.timerAt = Infinity;
    }

    private log(line: string): void {
        (this.deps.log ?? ((l: string) => console.log(l)))(`[LiveMeetingJournal] ${line}`);
    }
}
