// organiseSchema.ts
//
// Tables for organising meetings and the people in them (2026-10-15):
// folders (with rules that file new meetings), tags, people met, the companies
// they work for, and titles/companies proposed from what was said.
//
// Created idempotently and NOT behind PRAGMA user_version, like
// ensureLiveMeetingSchema / ensureMeetingNotesSchema: every statement is
// additive (CREATE ... IF NOT EXISTS), and parallel branches race the version
// counter (the user_titled incident in runMigrations: a gated ALTER that never
// ran because another branch stamped the same number first). The schema's own
// version is kept in app_state under ORGANISE_SCHEMA_VERSION_KEY, so a later
// change to these tables can be written as "if below N" without touching the
// shared counter.
//
// Every table that names a meeting cascades from `meetings` (foreign_keys is
// ON for the app's connection), so deleting a meeting takes its folder
// membership, tags, people links and proposed facts with it. People, folders,
// tags and companies outlive a meeting on purpose: they carry the user's own
// notes. clearAllData empties them explicitly.
//
// Pure SQL on a handle passed in: no Electron, no paths, nothing that differs
// between macOS and Windows.

import type Database from 'better-sqlite3';

export const ORGANISE_SCHEMA_VERSION = 1;
export const ORGANISE_SCHEMA_VERSION_KEY = 'organise_schema_version';

/** Every table this module owns, children first (the order clearAllData deletes in). */
export const ORGANISE_TABLES = [
    'person_facts',
    'person_meetings',
    'organise_indexed',
    'meeting_tags',
    'meeting_folders',
    'folder_rules',
    'tags',
    'folders',
    'people',
    'companies',
] as const;

const SCHEMA_V1 = `
    CREATE TABLE IF NOT EXISTS folders (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        position    INTEGER NOT NULL DEFAULT 0,
        -- When the user was offered (or ran) "Apply to past meetings" for the
        -- current rules; NULL means the offer is still open.
        past_offered_at INTEGER,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meeting_folders (
        meeting_id  TEXT NOT NULL,
        folder_id   TEXT NOT NULL,
        -- 'user' (Move to folder) or 'rule' (filed by a folder rule).
        added_by    TEXT NOT NULL DEFAULT 'user',
        -- 1 when the user took a meeting out of a folder: a rule never puts it back.
        removed     INTEGER NOT NULL DEFAULT 0,
        added_at    INTEGER NOT NULL,
        PRIMARY KEY (meeting_id, folder_id),
        FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_folders_folder ON meeting_folders(folder_id);

    CREATE TABLE IF NOT EXISTS folder_rules (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id   TEXT NOT NULL,
        -- 'title' (calendar or meeting title contains), 'attendee' (an email
        -- address or a domain), 'mode' (the detected or chosen mode's template).
        kind        TEXT NOT NULL CHECK (kind IN ('title', 'attendee', 'mode')),
        value       TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        UNIQUE(folder_id, kind, value),
        FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meeting_tags (
        meeting_id  TEXT NOT NULL,
        tag_id      INTEGER NOT NULL,
        added_at    INTEGER NOT NULL,
        PRIMARY KEY (meeting_id, tag_id),
        FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_tags_tag ON meeting_tags(tag_id);

    CREATE TABLE IF NOT EXISTS people (
        id             TEXT PRIMARY KEY,
        -- Lower-cased address; NULL for someone known only by name (a call
        -- participant or a renamed speaker). Unique when present.
        email          TEXT UNIQUE,
        name           TEXT NOT NULL DEFAULT '',
        -- Lower-cased, accents folded, single-spaced: how name-only people merge.
        name_key       TEXT NOT NULL DEFAULT '',
        title          TEXT,
        -- 'user' (typed) or 'evidence' (a suggestion the user accepted).
        title_source   TEXT,
        company        TEXT,
        company_source TEXT,
        notes          TEXT,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_people_name_key ON people(name_key);

    CREATE TABLE IF NOT EXISTS person_meetings (
        person_id   TEXT NOT NULL,
        meeting_id  TEXT NOT NULL,
        -- How we know they were there: 'attendee' (calendar), 'participant'
        -- (the meeting app's list), 'speaker' (a named voice).
        via         TEXT NOT NULL DEFAULT 'attendee',
        PRIMARY KEY (person_id, meeting_id),
        FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE,
        FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_person_meetings_meeting ON person_meetings(meeting_id);

    -- Which meetings have had their people read, so the People view indexes
    -- only what is new (meetings saved before this existed, imported ones).
    CREATE TABLE IF NOT EXISTS organise_indexed (
        meeting_id  TEXT PRIMARY KEY,
        indexed_at  INTEGER NOT NULL,
        FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS companies (
        -- The registrable email domain (acme.com, acme.co.uk), lower-cased.
        domain             TEXT PRIMARY KEY,
        name               TEXT,
        description        TEXT,
        -- 'user' (typed) or 'drafted' (written by the model from the meetings, on request).
        description_source TEXT,
        notes              TEXT,
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL
    );

    -- A title or company proposed from what was said, with the words it rests on.
    CREATE TABLE IF NOT EXISTS person_facts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id   TEXT NOT NULL,
        meeting_id  TEXT NOT NULL,
        kind        TEXT NOT NULL CHECK (kind IN ('title', 'company')),
        value       TEXT NOT NULL,
        quote       TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'accepted', 'dismissed')),
        created_at  INTEGER NOT NULL,
        UNIQUE(person_id, kind, value COLLATE NOCASE),
        FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE,
        FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_person_facts_person ON person_facts(person_id);
`;

/**
 * Create the tables (idempotent). Returns false when they could not be made;
 * the caller logs and carries on, since nothing else in the app needs them.
 */
export function ensureOrganiseSchema(db: Database.Database): boolean {
    try {
        db.exec(SCHEMA_V1);
        try {
            db.exec(`CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT)`);
            const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(ORGANISE_SCHEMA_VERSION_KEY) as { value?: string } | undefined;
            const current = Number(row?.value || 0);
            if (!(current >= ORGANISE_SCHEMA_VERSION)) {
                db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
                    .run(ORGANISE_SCHEMA_VERSION_KEY, String(ORGANISE_SCHEMA_VERSION));
            }
        } catch {
            /* the version marker is informational; the tables are what matter */
        }
        return true;
    } catch (e) {
        console.error('[organiseSchema] folders / people tables could not be created:', (e as Error)?.message || e);
        return false;
    }
}
