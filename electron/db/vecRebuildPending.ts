// vecRebuildPending.ts
// Which vec0 tables are waiting to be rebuilt from the BLOB columns, kept as
// one row in app_state.
//
// A table named here must NOT be searched natively: it is either still the old
// one (wrong distance metric, or missing vectors) or a new one that is only
// part filled, and a vec0 query over either returns a confident, wrong top-k
// with no error. VectorStore reads this before every native search and takes
// the JS cosine path, which reads the BLOBs and is always right.
//
// State lives in the database on purpose. Each compiled file is its own bundle
// with its own module state, so a flag held in memory by DatabaseManager would
// be invisible to VectorStore under test, and a flag in memory would also be
// lost by a crash halfway through a fill.

import type Database from 'better-sqlite3';

export const VEC_REBUILD_PENDING_KEY = 'vec_rebuild_pending_v1';

export interface PendingVecRebuild {
    /** The old table has been dropped and the new, empty one created. */
    recreated: boolean;
    /** Highest source row id already copied into the new table. */
    cursor: number;
}

export type PendingVecRebuilds = Record<string, PendingVecRebuild>;

const TABLE_NAME_RE = /^vec_(chunks|summaries)_(\d+)$/;

export function parseVecTableName(name: string): { kind: 'chunks' | 'summaries'; dim: number } | null {
    const m = TABLE_NAME_RE.exec(name);
    if (!m) return null;
    const dim = Number(m[2]);
    return Number.isInteger(dim) && dim > 0 ? { kind: m[1] as 'chunks' | 'summaries', dim } : null;
}

export function readPendingVecRebuilds(db: Database.Database): PendingVecRebuilds {
    try {
        const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(VEC_REBUILD_PENDING_KEY) as { value?: string } | undefined;
        if (!row?.value) return {};
        const parsed = JSON.parse(row.value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: PendingVecRebuilds = {};
        for (const [name, entry] of Object.entries(parsed as Record<string, any>)) {
            if (!parseVecTableName(name)) continue;
            const cursor = Number(entry?.cursor);
            out[name] = { recreated: entry?.recreated === true, cursor: Number.isFinite(cursor) && cursor > 0 ? cursor : 0 };
        }
        return out;
    } catch {
        // No app_state table (a bare test schema) or an unreadable row: nothing
        // is known to be pending.
        return {};
    }
}

/** Throws when the row cannot be written — the caller decides what that means. */
export function writePendingVecRebuilds(db: Database.Database, pending: PendingVecRebuilds): void {
    if (Object.keys(pending).length === 0) {
        db.prepare('DELETE FROM app_state WHERE key = ?').run(VEC_REBUILD_PENDING_KEY);
        return;
    }
    db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(VEC_REBUILD_PENDING_KEY, JSON.stringify(pending));
}

export function isVecTableRebuildPending(db: Database.Database, tableName: string): boolean {
    return Object.prototype.hasOwnProperty.call(readPendingVecRebuilds(db), tableName);
}
