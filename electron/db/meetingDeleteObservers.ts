// Tells other parts of the app that meetings are about to be deleted, and then
// whether the delete happened. Every place that removes rows from `meetings`
// runs through runObservedMeetingDelete (DatabaseManager.deleteMeeting and
// clearAllData, RAGManager's live-session row), so a feature that must follow
// a meeting out (share links: a deleted meeting must not stay readable on the
// web) hooks in once here instead of at each caller.
//
// Two steps on purpose. "Before" lets an observer write down what it will owe
// (on disk, so a crash between the two steps cannot lose it); commit runs only
// when rows were actually deleted, and abort when the delete failed or found
// nothing, so a meeting that is still there keeps its link. The deletes are
// better-sqlite3 calls, synchronous, so nothing else runs between the steps.
//
// No database access here, so importing it never opens one.

export type MeetingDeleteTarget = { ids: string[] } | 'all';

export interface MeetingDeleteHandle {
    commit(): void;
    abort(): void;
}

export type MeetingDeleteObserver = (target: MeetingDeleteTarget) => MeetingDeleteHandle | void;

const observers = new Set<MeetingDeleteObserver>();

/** Adds an observer; the function it answers removes it again. */
export function observeMeetingDeletes(observer: MeetingDeleteObserver): () => void {
    observers.add(observer);
    return () => { observers.delete(observer); };
}

function settle(handles: MeetingDeleteHandle[], deleted: boolean): void {
    for (const h of handles) {
        try {
            if (deleted) h.commit(); else h.abort();
        } catch (err: any) {
            console.warn('[MeetingDelete] observer failed to settle:', err?.message || 'unknown');
        }
    }
}

/**
 * Runs `del` with every observer told first and settled after: commit when
 * `deleted(result)` says rows went, abort when it says none did or `del`
 * throws (the error is re-thrown). An observer that throws is logged and
 * skipped; it never stops the delete.
 */
export function runObservedMeetingDelete<T>(target: MeetingDeleteTarget, del: () => T, deleted: (result: T) => boolean): T {
    const handles: MeetingDeleteHandle[] = [];
    for (const observer of observers) {
        try {
            const h = observer(target);
            if (h) handles.push(h);
        } catch (err: any) {
            console.warn('[MeetingDelete] observer failed before the delete:', err?.message || 'unknown');
        }
    }
    let result: T;
    try {
        result = del();
    } catch (err) {
        settle(handles, false);
        throw err;
    }
    settle(handles, deleted(result));
    return result;
}
