/*
  A request to look again at the newest meetings, for the two walks that
  examine each meeting once and then stop (RAGManager.backfillMeetingChunks and
  backfillMeetingSummaries).

  Meetings that arrive outside the save path (db/legacyMeetingImport copies
  them from an old profile folder) have a transcript and notes and no search
  data, and a walk that ended at 'done' never reaches them.

    - The writer leaves the request in the SAME transaction as the meetings,
      so it cannot be lost to a quit.
    - A walk takes the request when it starts, so a walk already under way
      does not swallow one made behind its cursor.
    - The request names the lowest row it is about. A walk that had finished
      goes back to the top and stops there (the "floor") instead of visiting
      every meeting again: a meeting whose embedding failed for good would
      otherwise be re-embedded on the user's provider each time.

  Its own file because the writer must not load RAGManager to name a key.
*/
import type Database from 'better-sqlite3';

export interface BackfillWalkKeys {
    /** The walk's position: a rowid, or 'done'. */
    cursorKey: string;
    /** Set by a writer: the lowest rowid it added. */
    rearmKey: string;
    /** Where a walk restarted by a request stops. */
    floorKey: string;
}

export const CHUNK_BACKFILL_KEYS: BackfillWalkKeys = {
    cursorKey: 'chunk_backfill_cursor_v1',
    rearmKey: 'chunk_backfill_rearm_v1',
    floorKey: 'chunk_backfill_floor_v1',
};

export const SUMMARY_BACKFILL_KEYS: BackfillWalkKeys = {
    cursorKey: 'summary_backfill_cursor_v1',
    rearmKey: 'summary_backfill_rearm_v1',
    floorKey: 'summary_backfill_floor_v1',
};

const ALL_WALKS = [CHUNK_BACKFILL_KEYS, SUMMARY_BACKFILL_KEYS];

function read(db: Database.Database, key: string): string | undefined {
    return (db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value?: string } | undefined)?.value;
}

function asRowid(value: string | undefined): number | null {
    if (value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** Writer: meetings were added from `lowestRowid` up. Call inside the writer's transaction. */
export function requestBackfillRearm(db: Database.Database, lowestRowid: number): void {
    const write = db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)');
    for (const walk of ALL_WALKS) {
        const pending = asRowid(read(db, walk.rearmKey));
        write.run(walk.rearmKey, String(pending === null ? lowestRowid : Math.min(pending, lowestRowid)));
    }
}

/**
 * Walk: call once at the start. Applies a pending request (the cursor goes
 * back to the top) and returns the rowid the walk may stop below; 0 means it
 * goes all the way down.
 */
export function takeBackfillRearm(db: Database.Database, keys: BackfillWalkKeys): number {
    return db.transaction((): number => {
        let floor = asRowid(read(db, keys.floorKey));
        const request = read(db, keys.rearmKey);
        if (request === undefined) return floor ?? 0;

        const requested = asRowid(request);
        const cursor = read(db, keys.cursorKey);
        if (cursor === 'done') {
            // Everything below the new rows has been examined.
            floor = requested;
        } else if (floor !== null) {
            // A restarted walk was still on its way down: widen, never narrow.
            floor = requested === null ? null : Math.min(floor, requested);
        } else {
            // The first full walk has not finished (or never ran): it has to
            // go all the way down anyway.
            floor = null;
        }
        const remove = db.prepare('DELETE FROM app_state WHERE key = ?');
        remove.run(keys.cursorKey);
        remove.run(keys.rearmKey);
        if (floor === null) remove.run(keys.floorKey);
        else db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(keys.floorKey, String(floor));
        return floor ?? 0;
    })();
}

/** Walk: it reached the end; the next request starts from a finished walk. */
export function finishBackfillWalk(db: Database.Database, keys: BackfillWalkKeys): void {
    db.transaction(() => {
        db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(keys.cursorKey, 'done');
        db.prepare('DELETE FROM app_state WHERE key = ?').run(keys.floorKey);
    })();
}

/** A request is waiting (made while the walk that just ended was running). */
export function hasBackfillRearm(db: Database.Database, keys: BackfillWalkKeys): boolean {
    return read(db, keys.rearmKey) !== undefined;
}
