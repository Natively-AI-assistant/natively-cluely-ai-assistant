/*
  Meetings left behind in the old profile folder come across to this one.

  2.9.2 moved the packaged profile off the brand name (utils/migrateUserData:
  `Natively` → `corespeechd` on macOS, `audiodg` on Windows) and, in the same
  release, changed the app id and product name. The update therefore installs
  NEXT TO the old app instead of replacing it, and the old app still opens the
  old folder name. Two ways meetings end up where this app does not look:

    - the old app is opened after the move: it finds no folder, starts an
      empty one, and every meeting recorded there stays there;
    - this app starts in the new folder while the old one still holds the
      profile (the move adopted an already populated folder, or the old
      folder is spelled `natively` on a case-sensitive disk).

  Either way the old folder has a `natively.db` with meetings this database
  lacks. Each launch looks at it and copies what is missing: the meeting row,
  its transcript and its answers.

  What it guarantees:
    - The old database is opened READ-ONLY and its rows are never changed; the
      old app may be running and writing to it. (SQLite may leave an empty
      `-wal`/`-shm` beside a WAL database it reads. That is all.)
    - A meeting is copied whole or not at all, from one moment of the old
      database (a save in progress there cannot be half read), and a meeting
      this database already has is never overwritten.
    - One meeting that cannot be copied does not hold up the others; it is
      tried again on the next launch. A full disk or a locked file stops the
      run instead: every meeting would fail the same way.
    - A meeting the old app has not finished writing notes for is left until
      it has, or until a day has passed (see UNFINISHED_WAIT_MS).
    - Every old meeting this database has held is remembered, so deleting it
      here, or clearing all data, does not bring it back.
    - Columns are matched by name, so an older schema imports into a newer one.
    - Search data (chunks, vectors) is NOT copied: it belongs to an embedding
      space this profile may not use. The two search walks are asked to look
      at the copied meetings instead, in the same transaction
      (rag/backfillRearm).
    - It never throws.

  Packaged builds only (the caller decides): a dev or agent instance runs in
  its own folder on purpose and must not pull a developer's meetings into it.
*/
import type Database from 'better-sqlite3';
import { requestBackfillRearm } from '../rag/backfillRearm';

/** Folder names the profile has had under appData before the disguise names. */
export const LEGACY_PROFILE_DIR_NAMES = ['Natively', 'natively'] as const;
export const LEGACY_DB_FILE = 'natively.db';
/** app_state: one row per old meeting this database has held, `<prefix><meeting id>`. */
export const LEGACY_IMPORT_SEEN_PREFIX = 'legacy_meeting_seen_v1:';
/** app_state: JSON map of source database path → size/mtime when last read to the end. */
export const LEGACY_IMPORT_SOURCES_KEY = 'legacy_meeting_import_sources_v1';
/**
 * How long a meeting the old app still marks unfinished (is_processed = 0) is
 * left where it is. The old app saves a placeholder when a meeting stops and
 * the title and notes a little later; copying the placeholder would freeze it
 * here, because a meeting this database has is never copied again. After a
 * day the old app is not going to finish it, and it comes across as it is for
 * this app's own recovery (MeetingPersistence.recoverUnprocessedMeetings).
 */
export const UNFINISHED_WAIT_MS = 24 * 60 * 60 * 1000;

/** Rows the app writes itself; never a user's meeting. */
const RESERVED_MEETING_IDS = new Set(['demo-meeting', 'live-meeting-current']);
/** Stamped when a meeting's chunks are embedded; the chunks are not copied. */
const MEETING_COLUMNS_NOT_COPIED = new Set(['embedding_provider', 'embedding_dimensions', 'embedding_space']);
const CHILD_TABLES = ['transcripts', 'ai_interactions'] as const;
/** Failures that are about the disk or the file, not about one meeting. */
const NOT_ABOUT_ONE_MEETING = /^SQLITE_(BUSY|LOCKED|FULL|READONLY|NOMEM)/;

export type LegacyImportStatus =
    | 'no-source'
    | 'unchanged'
    | 'unreadable'
    | 'nothing-new'
    | 'imported'
    | 'interrupted'
    | 'failed';

export interface LegacyImportResult {
    source: string;
    status: LegacyImportStatus;
    /** Meetings in the old database (reserved rows excluded). */
    found: number;
    imported: number;
    /** Meetings that could not be copied this time; tried again next launch. */
    failed: number;
    /** Meetings the old app has not finished; looked at again next launch. */
    waiting: number;
    reason?: string;
}

export interface LegacyProfileLookup {
    platform: NodeJS.Platform;
    appDataDir: string;
    userDataDir: string;
    join: (...parts: string[]) => string;
    exists: (p: string) => boolean;
    /** The path as the disk spells it (symlinks and letter case resolved). */
    realpath: (p: string) => string;
}

/**
 * Old profile databases that are not the one in use. `Natively` and `natively`
 * are one folder on the usual case-insensitive disk and two on a case-sensitive
 * one, so both are looked at and compared by their real path.
 */
export function legacyProfileDatabases(deps: LegacyProfileLookup): string[] {
    // NTFS compares names without case unless a folder was switched over by
    // hand; realpath on macOS already returns the spelling on disk.
    const same = (a: string, b: string) => (deps.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    const real = (p: string): string | null => {
        try { return deps.realpath(p); } catch { return null; }
    };
    const current = real(deps.userDataDir) ?? deps.userDataDir;
    const dirs: string[] = [];
    for (const name of LEGACY_PROFILE_DIR_NAMES) {
        const dir = real(deps.join(deps.appDataDir, name));
        if (!dir || same(dir, current) || dirs.some((d) => same(d, dir))) continue;
        dirs.push(dir);
    }
    const out: string[] = [];
    for (const dir of dirs) {
        const file = deps.join(dir, LEGACY_DB_FILE);
        let present = false;
        try { present = deps.exists(file); } catch { present = false; }
        if (present) out.push(file);
    }
    return out;
}

export interface LegacyImportDeps {
    /** This profile's database (read-write). */
    dest: Database.Database;
    sourcePath: string;
    /** Opens the old database read-only; throws when it cannot. */
    openSource: (p: string) => Database.Database;
    /** Size and modified time of the old database and its WAL; null when the file is gone. */
    signature: (p: string) => string | null;
    /** Lets the event loop run between batches. */
    pause?: () => Promise<void>;
    batchSize?: number;
    /** Called after each committed batch with the number of meetings in it. */
    onBatch?: (count: number) => void;
    now?: () => number;
    log?: (message: string) => void;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function tableColumns(db: Database.Database, table: string): string[] {
    return (db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[]).map((r) => r.name);
}

/** The stored map of sources read to the end; anything unreadable counts as none. */
function readSources(dest: Database.Database): Record<string, string> {
    try {
        const row = dest.prepare('SELECT value FROM app_state WHERE key = ?').get(LEGACY_IMPORT_SOURCES_KEY) as { value?: string } | undefined;
        const parsed = row?.value ? JSON.parse(row.value) : null;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/** When the meeting was held, in ms; null when the row does not say. */
function meetingTime(row: { created_at?: unknown; start_time?: unknown }): number | null {
    if (typeof row.created_at === 'string') {
        const parsed = Date.parse(row.created_at);
        if (Number.isFinite(parsed)) return parsed;
    }
    return typeof row.start_time === 'number' && row.start_time > 0 ? row.start_time : null;
}

/** Copy the meetings `dest` lacks from one old database. Never throws. */
export async function importLegacyMeetings(deps: LegacyImportDeps): Promise<LegacyImportResult> {
    const log = deps.log ?? (() => {});
    const result: LegacyImportResult = { source: deps.sourcePath, status: 'no-source', found: 0, imported: 0, failed: 0, waiting: 0 };
    const fail = (status: LegacyImportStatus, e: unknown): LegacyImportResult => {
        result.status = status;
        result.reason = (e as Error)?.message ?? String(e);
        log(`[LegacyMeetingImport] ${status} for ${deps.sourcePath}: ${result.reason}`);
        return result;
    };

    let signature: string | null = null;
    try { signature = deps.signature(deps.sourcePath); } catch { signature = null; }
    if (!signature) return result;

    const sources = readSources(deps.dest);
    if (sources[deps.sourcePath] === signature) {
        result.status = 'unchanged';
        return result;
    }

    let src: Database.Database;
    try {
        src = deps.openSource(deps.sourcePath);
    } catch (e) {
        return fail('unreadable', e);
    }

    try {
        const markRead = () => {
            sources[deps.sourcePath] = signature as string;
            deps.dest.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)')
                .run(LEGACY_IMPORT_SOURCES_KEY, JSON.stringify(sources));
        };

        let srcMeetingCols: string[];
        let sourceRows: Array<{ id: string; is_processed?: unknown; created_at?: unknown; start_time?: unknown }>;
        try {
            srcMeetingCols = tableColumns(src, 'meetings');
            if (!srcMeetingCols.includes('id')) {
                // Not a profile database (or one from before meetings existed).
                // Nothing to copy, and nothing will appear until the file changes.
                markRead();
                result.status = 'nothing-new';
                return result;
            }
            const stateCols = ['is_processed', 'created_at', 'start_time'].filter((c) => srcMeetingCols.includes(c));
            sourceRows = (src.prepare(`SELECT ${['id', ...stateCols].map(quote).join(', ')} FROM meetings ORDER BY rowid`).all() as any[])
                .filter((r) => typeof r.id === 'string' && r.id.length > 0 && !RESERVED_MEETING_IDS.has(r.id));
        } catch (e) {
            return fail('unreadable', e);
        }
        result.found = sourceRows.length;

        const seenKey = (id: string) => `${LEGACY_IMPORT_SEEN_PREFIX}${id}`;
        // ';' is the character after ':', so this is every key with the prefix.
        const seen = new Set(
            (deps.dest.prepare('SELECT key FROM app_state WHERE key > ? AND key < ?')
                .all(LEGACY_IMPORT_SEEN_PREFIX, `${LEGACY_IMPORT_SEEN_PREFIX.slice(0, -1)};`) as { key: string }[])
                .map((r) => r.key.slice(LEGACY_IMPORT_SEEN_PREFIX.length)),
        );
        const present = new Set((deps.dest.prepare('SELECT id FROM meetings').all() as { id: string }[]).map((r) => r.id));
        const remember = deps.dest.prepare('INSERT OR IGNORE INTO app_state (key, value) VALUES (?, ?)');

        // A meeting both databases hold (the new folder was adopted or copied
        // by hand) is not copied, but it IS remembered: deleted here later, it
        // would otherwise look like a meeting this database never had.
        const heldHere = sourceRows.filter((r) => present.has(r.id) && !seen.has(r.id)).map((r) => r.id);
        if (heldHere.length > 0) {
            deps.dest.transaction(() => { for (const id of heldHere) remember.run(seenKey(id), 'held'); })();
        }

        const now = (deps.now ?? Date.now)();
        const todo: string[] = [];
        for (const row of sourceRows) {
            if (present.has(row.id) || seen.has(row.id)) continue;
            const time = meetingTime(row);
            // A date in the future is a wrong clock, not a meeting in progress.
            if (row.is_processed === 0 && time !== null && now >= time && now - time < UNFINISHED_WAIT_MS) {
                result.waiting++;
                continue;
            }
            todo.push(row.id);
        }

        if (todo.length > 0) {
            const destMeetingCols = new Set(tableColumns(deps.dest, 'meetings'));
            const meetingCols = srcMeetingCols.filter((c) => destMeetingCols.has(c) && !MEETING_COLUMNS_NOT_COPIED.has(c));
            const readMeeting = src.prepare(`SELECT ${meetingCols.map(quote).join(', ')} FROM meetings WHERE id = ?`).raw();
            // Only "this id is already here" is passed over. Any other refusal
            // is an error, so the meeting is counted and tried again rather
            // than dropped without a word.
            const insertMeeting = deps.dest.prepare(
                `INSERT INTO meetings (${meetingCols.map(quote).join(', ')}) VALUES (${meetingCols.map(() => '?').join(', ')}) ON CONFLICT(id) DO NOTHING`,
            );
            const children = CHILD_TABLES.map((table) => {
                const srcCols = tableColumns(src, table);
                const destCols = new Set(tableColumns(deps.dest, table));
                // The row id is this database's own: copying it would collide.
                const cols = srcCols.filter((c) => c !== 'id' && destCols.has(c));
                if (!cols.includes('meeting_id')) return null;
                return {
                    read: src.prepare(`SELECT ${cols.map(quote).join(', ')} FROM ${quote(table)} WHERE meeting_id = ? ORDER BY rowid`).raw(),
                    insert: deps.dest.prepare(
                        `INSERT INTO ${quote(table)} (${cols.map(quote).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
                    ),
                };
            }).filter((c): c is NonNullable<typeof c> => c !== null);

            const writeBatch = deps.dest.transaction((ids: string[]): number => {
                let copied = 0;
                let lowestRowid = Number.MAX_SAFE_INTEGER;
                for (const id of ids) {
                    const row = readMeeting.get(id) as unknown[] | undefined;
                    // Deleted in the old app since the id list was read.
                    if (!row) continue;
                    const inserted = insertMeeting.run(...row);
                    if (inserted.changes !== 1) continue;
                    lowestRowid = Math.min(lowestRowid, Number(inserted.lastInsertRowid));
                    for (const child of children) {
                        for (const childRow of child.read.iterate(id) as IterableIterator<unknown[]>) {
                            child.insert.run(...childRow);
                        }
                    }
                    remember.run(seenKey(id), 'copied');
                    copied++;
                }
                // With the meetings, not after them: a quit between the two
                // would leave them copied and never searchable.
                if (copied > 0) requestBackfillRearm(deps.dest, lowestRowid);
                return copied;
            });
            // The old app may save a meeting while this runs: it rewrites the
            // row and then the lines. One read transaction per batch shows a
            // meeting either before that save or after it, never across it.
            const copyBatch = (ids: string[]): number => {
                src.exec('BEGIN');
                try {
                    return writeBatch(ids);
                } finally {
                    try { src.exec('COMMIT'); } catch { /* nothing was open */ }
                }
            };

            const committed = (copied: number) => {
                result.imported += copied;
                if (copied > 0) {
                    try { deps.onBatch?.(copied); } catch { /* a listener must not stop the import */ }
                }
            };
            const size = Math.max(1, deps.batchSize ?? 20);
            for (let i = 0; i < todo.length; i += size) {
                // A quit closes the database under us; what is committed stays.
                if (!deps.dest.open) {
                    result.status = 'interrupted';
                    return result;
                }
                const batch = todo.slice(i, i + size);
                try {
                    committed(copyBatch(batch));
                } catch (batchError) {
                    if (NOT_ABOUT_ONE_MEETING.test(String((batchError as { code?: unknown })?.code ?? ''))) return fail('failed', batchError);
                    // The batch rolled back. One meeting in it is the cause (a
                    // damaged row in the old file, a row this database refuses):
                    // copy the others, each on its own.
                    for (const id of batch) {
                        if (!deps.dest.open) {
                            result.status = 'interrupted';
                            return result;
                        }
                        try {
                            committed(copyBatch([id]));
                        } catch (e) {
                            if (NOT_ABOUT_ONE_MEETING.test(String((e as { code?: unknown })?.code ?? ''))) return fail('failed', e);
                            result.failed++;
                            if (result.failed === 1) result.reason = (e as Error)?.message ?? String(e);
                        }
                    }
                }
                if (deps.pause) await deps.pause();
            }
        }

        if (!deps.dest.open) {
            result.status = 'interrupted';
            return result;
        }
        // Read to the end only when nothing is left to come back for.
        if (result.failed === 0 && result.waiting === 0) markRead();
        result.status = result.imported > 0 ? 'imported' : result.failed > 0 ? 'failed' : 'nothing-new';
        if (result.imported > 0 || result.failed > 0) {
            log(
                `[LegacyMeetingImport] copied ${result.imported} of ${result.found} meeting(s) from ${deps.sourcePath}` +
                (result.failed > 0 ? `; ${result.failed} could not be copied and will be tried again (${result.reason})` : ''),
            );
        }
        return result;
    } catch (e) {
        return fail('failed', e);
    } finally {
        try { src.close(); } catch { /* already closed */ }
    }
}

export interface LegacyProfileImportOptions {
    platform: NodeJS.Platform;
    appDataDir: string;
    userDataDir: string;
    dest: Database.Database | null;
    onBatch?: (count: number) => void;
    log?: (message: string) => void;
}

/**
 * Look for old profile folders next to this one and copy their meetings in.
 * The real filesystem and a read-only SQLite handle are wired here; everything
 * above takes them as arguments. Never throws.
 */
export async function importLegacyProfiles(opts: LegacyProfileImportOptions): Promise<LegacyImportResult[]> {
    const results: LegacyImportResult[] = [];
    if (!opts.dest || !opts.dest.open) return results;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('node:fs') as typeof import('node:fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require('node:path') as typeof import('node:path');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const BetterSqlite = require('better-sqlite3') as typeof import('better-sqlite3');

        const stat = (p: string) => { try { return fs.statSync(p); } catch { return null; } };
        const signature = (p: string): string | null => {
            const db = stat(p);
            if (!db) return null;
            // An empty WAL holds nothing, and reading a WAL database creates
            // one: it must read the same as no WAL at all, or the read itself
            // would make the file look changed.
            const wal = stat(`${p}-wal`);
            return `${db.size}:${Math.floor(db.mtimeMs)}|${wal && wal.size > 0 ? `${wal.size}:${Math.floor(wal.mtimeMs)}` : '-'}`;
        };
        const files = legacyProfileDatabases({
            platform: opts.platform,
            appDataDir: opts.appDataDir,
            userDataDir: opts.userDataDir,
            join: path.join,
            exists: (p) => fs.existsSync(p),
            realpath: (p) => fs.realpathSync.native(p),
        });
        for (const sourcePath of files) {
            results.push(await importLegacyMeetings({
                dest: opts.dest,
                sourcePath,
                openSource: (p) => {
                    const db = new BetterSqlite(p, { readonly: true, fileMustExist: true });
                    // The old app may be mid-write. Readers of a WAL database
                    // are never blocked; this covers one in rollback mode, and
                    // stays short because it holds the main process.
                    db.pragma('busy_timeout = 1000');
                    return db;
                },
                signature,
                pause: () => new Promise<void>((resolve) => setImmediate(resolve)),
                onBatch: opts.onBatch,
                log: opts.log,
            }));
        }
    } catch (e) {
        try { opts.log?.(`[LegacyMeetingImport] skipped: ${(e as Error)?.message ?? e}`); } catch { /* noop */ }
    }
    return results;
}
