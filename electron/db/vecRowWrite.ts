// vecRowWrite.ts
// The one way to write a vector into a vec0 table.
//
// sqlite-vec 0.1.9 does not implement REPLACE: `INSERT OR REPLACE` on a key
// that already has a row throws "UNIQUE constraint failed on <table> primary
// key". Every writer here used INSERT OR REPLACE and treated a second write as
// harmless; three of them caught the error and moved on, which left the OLD
// vector in the table under the new text (reproduced 2026-10-05: a re-embedded
// summary scored 0.654 natively and 1.000 on the stored vector).
//
// UPDATE does work, in place, and reports changes = 0 for a key with no row.
// So: update, and insert only when there was nothing to update.

import type Database from 'better-sqlite3';

export type VecRowWriter = (id: number | bigint, embedding: Buffer) => void;

/**
 * Prepare a writer for one vec0 table. `idColumn` is its key column
 * (`chunk_id` or `summary_id`). The table must exist. Throws what the
 * statements throw — a wrong-width vector, a missing table.
 */
export function prepareVecRowWriter(db: Database.Database, table: string, idColumn: string): VecRowWriter {
    if (!/^vec_(chunks|summaries)_\d+$/.test(table) || !/^(chunk|summary)_id$/.test(idColumn)) {
        throw new Error(`not a vec0 table/key: ${table}.${idColumn}`);
    }
    const update = db.prepare(`UPDATE ${table} SET embedding = ? WHERE ${idColumn} = ?`);
    const insert = db.prepare(`INSERT INTO ${table}(${idColumn}, embedding) VALUES (?, ?)`);
    return (id, embedding) => {
        const key = typeof id === 'bigint' ? id : BigInt(id);
        if (update.run(embedding, key).changes === 0) insert.run(key, embedding);
    };
}
