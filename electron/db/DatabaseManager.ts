
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { app } from 'electron';
import fs from 'fs';
import * as sqliteVec from 'sqlite-vec';
import { buildLegacySpaceCaseSql } from '../rag/embeddingSpace';
import type { ActionItem, DecisionItem, FollowUpDraft, MeetingSummaryGenerationMeta, MeetingSummaryModeMeta, MeetingSummarySectionV3, NoteBlock, PersonMention, QuestionItem, RiskItem, SourceQualityMeta, SpeakerLabelMap, SummaryStatus, TimelineItem } from '../services/meeting/types';

// Interfaces for our data objects
export interface Meeting {
    id: string;
    title: string;
    date: string; // ISO string
    duration: string;
    summary: string;
    detailedSummary?: {
        overview?: string;
        actionItems: string[];
        keyPoints: string[];
        actionItemsTitle?: string;
        keyPointsTitle?: string;
        sections?: Array<{ title: string; bullets: string[] }>;
        schemaVersion?: number;
        tldr?: string[];
        whatChanged?: string[];
        decisions?: DecisionItem[];
        openQuestions?: QuestionItem[];
        risks?: RiskItem[];
        sourceQuality?: SourceQualityMeta;
        timeline?: TimelineItem[];
        people?: PersonMention[];
        topics?: string[];
        recipes?: Record<string, string>;
        noteBlocks?: NoteBlock[];
        sectionsV3?: MeetingSummarySectionV3[];
        mode?: MeetingSummaryModeMeta;
        generation?: MeetingSummaryGenerationMeta;
        actionItemsStructured?: Array<{ id: string; text: string; owner?: string; deadline?: string; sourceTimestamp?: number }>;
        actionItemsV3?: ActionItem[];
        // V3 follow-up is a structured FollowUpDraft object; legacy rows stored a plain string.
        followUpDraft?: FollowUpDraft | string;
        speakerLabels?: SpeakerLabelMap;
        crossMeeting?: { carriedOpenQuestions?: Array<{ text: string; fromMeetingId: string; fromTitle: string }>; recurringRisks?: Array<{ text: string; fromMeetingId: string; fromTitle: string }>; stillOpen?: string[] };
        coachingInsights?: Array<{ id: string; type: string; title: string; detail: string; severity: 'info' | 'opportunity' | 'warning'; evidence?: string }>;
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
    calendarEventId?: string;
    source?: 'manual' | 'calendar';
    isProcessed?: boolean;
    summaryStatus?: SummaryStatus;
}

export class DatabaseManager {
    private static instance: DatabaseManager;
    private db: Database.Database | null = null;
    private dbPath: string;
    private resolvedExtPath: string = '';
    private initError: Error | null = null;

    private constructor() {
        // Resolve the userData directory. Normally this is Electron's real
        // per-user app-data path. But under `ELECTRON_RUN_AS_NODE=1` (the
        // `test:electron` runner) or before `app` is ready, `app` may be
        // undefined or `app.getPath` may throw — in those contexts fall back
        // to an explicit override (NATIVELY_TEST_USERDATA) or an OS-temp dir
        // so importing a module that lazily constructs DatabaseManager (e.g.
        // ModesManager.getInstance() inside a unit test) degrades gracefully
        // instead of crashing with "Cannot read properties of undefined
        // (reading 'getPath')". Production (real Electron main process) is
        // unaffected — app.getPath succeeds and this fallback never runs.
        let userDataPath: string;
        try {
            const fromEnv = process.env.NATIVELY_TEST_USERDATA;
            if (fromEnv) {
                userDataPath = fromEnv;
            } else if (app && typeof app.getPath === 'function') {
                userDataPath = app.getPath('userData');
            } else {
                userDataPath = path.join(os.tmpdir(), 'natively-no-electron-app');
            }
        } catch {
            userDataPath = path.join(os.tmpdir(), 'natively-no-electron-app');
        }
        try { fs.mkdirSync(userDataPath, { recursive: true }); } catch { /* best effort */ }
        this.dbPath = path.join(userDataPath, 'natively.db');
        // IMPORTANT: never throw out of the constructor. If init() throws and
        // escapes, `DatabaseManager.instance` is never assigned — so every
        // subsequent getInstance() call re-enters the constructor and re-emits
        // the identical failure (this is why a single dlopen error used to print
        // as a wall of ~dozens of identical stack traces across seed-demo,
        // get-recent-meetings, modes:get-active, etc.). Instead we capture the
        // error once and degrade to db: null; every public method already guards
        // with `if (!this.db)`, so callers get empty/null results, not throws.
        try {
            this.init();
        } catch (error) {
            this.initError = error as Error;
            this.reportInitFailure(error);
        }
    }

    public static getInstance(): DatabaseManager {
        if (!DatabaseManager.instance) {
            DatabaseManager.instance = new DatabaseManager();
        }
        return DatabaseManager.instance;
    }

    /** True when the underlying SQLite database opened successfully. */
    public isAvailable(): boolean {
        return this.db !== null;
    }

    /**
     * The error that caused initialization to fail, if any. Lets the app surface
     * a single user-facing banner (e.g. "Local database unavailable — meeting
     * history disabled") instead of relying on log scraping.
     */
    public getInitError(): Error | null {
        return this.initError;
    }

    /**
     * Translate an init failure into a single, actionable log line. The most
     * common fatal cause is a native-module architecture mismatch (an x86_64
     * better-sqlite3 binary loaded under the arm64 Electron runtime, typically
     * produced by an `npm install` that ran under a Rosetta shell).
     */
    private reportInitFailure(error: unknown): void {
        const err = error as NodeJS.ErrnoException;
        const msg = err?.message || String(error);
        const isArchMismatch =
            err?.code === 'ERR_DLOPEN_FAILED' ||
            /incompatible architecture|ERR_DLOPEN_FAILED|mach-o/i.test(msg);

        if (isArchMismatch) {
            console.error(
                '[DatabaseManager] FATAL: native module (better-sqlite3) failed to load — the compiled ' +
                'binary architecture does not match the Electron runtime. Local database is DISABLED ' +
                '(meeting history, modes, and notes will not persist this session).\n' +
                '  Fix: run `npm run rebuild:native` from a native (non-Rosetta) terminal, then restart the app.'
            );
        } else {
            console.error(
                '[DatabaseManager] FATAL: database initialization failed. Local database is DISABLED ' +
                '(meeting history, modes, and notes will not persist this session).',
                error
            );
        }
    }

    private init() {
        try {
            console.log(`[DatabaseManager] Initializing database at ${this.dbPath}`);
            // Ensure directory exists (though userData usually does)
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[DatabaseManager] Created directory: ${dir}`);
            } else {
                console.log(`[DatabaseManager] Directory exists: ${dir}`);
                try {
                    const files = fs.readdirSync(dir);
                    console.log(`[DatabaseManager] Directory contents:`, files);
                    const dbExists = fs.existsSync(this.dbPath);
                    if (dbExists) {
                        const stats = fs.statSync(this.dbPath);
                        console.log(`[DatabaseManager] Found existing DB. Size: ${stats.size} bytes`);
                    } else {
                        console.log(`[DatabaseManager] No existing DB found at ${this.dbPath}. Creating new one.`);
                    }
                } catch (e) {
                    console.error('[DatabaseManager] Error checking directory/file:', e);
                }
            }

            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');

            // Load sqlite-vec extension for native vector search
            try {
                // 1. sqlite-vec's getLoadablePath() returns a path inside app.asar
                //    (e.g. .../app.asar/node_modules/sqlite-vec-darwin-arm64/vec0.dylib)
                //    but dlopen() needs real files on disk, not files inside the asar archive.
                //    electron-builder's asarUnpack puts them in app.asar.unpacked instead.
                // 2. better-sqlite3's loadExtension() auto-appends the platform extension
                //    (.dylib/.so/.dll), so we strip it to avoid vec0.dylib.dylib.
                let extPath = sqliteVec.getLoadablePath();
                extPath = extPath.replace('app.asar', 'app.asar.unpacked');
                extPath = extPath.replace(/\.(dylib|so|dll)$/, '');
                this.db.loadExtension(extPath);
                this.resolvedExtPath = extPath; // Store for worker thread access
                console.log('[DatabaseManager] sqlite-vec extension loaded successfully');
            } catch (extErr) {
                console.error('[DatabaseManager] Failed to load sqlite-vec extension:', extErr);
                console.warn('[DatabaseManager] Vector search will fall back to JS cosine similarity');
            }

            this.runMigrations();
        } catch (error) {
            console.error('[DatabaseManager] Failed to initialize database:', error);
            throw error;
        }
    }

    // ============================================
    // PRAGMA user_version Migration System
    // ============================================
    // Each version is applied exactly once, in order.
    // New migrations append a new `if (version < N)` block.
    // ============================================

    private runMigrations() {
        if (!this.db) return;

        const version = (this.db.pragma('user_version', { simple: true }) as number) || 0;
        console.log(`[DatabaseManager] Current schema version: ${version}`);

        // Version 0 → 1: Initial schema (all core tables)
        if (version < 1) {
            console.log('[DatabaseManager] Applying migration v0 → v1: Initial schema');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS meetings (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    start_time INTEGER,
                    duration_ms INTEGER,
                    summary_json TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    calendar_event_id TEXT,
                    source TEXT,
                    is_processed INTEGER DEFAULT 1,
                    summary_status TEXT DEFAULT 'completed'
                );

                CREATE TABLE IF NOT EXISTS transcripts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT,
                    speaker TEXT,
                    content TEXT,
                    timestamp_ms INTEGER,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS ai_interactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT,
                    type TEXT,
                    timestamp INTEGER,
                    user_query TEXT,
                    ai_response TEXT,
                    metadata_json TEXT,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    speaker TEXT,
                    start_timestamp_ms INTEGER,
                    end_timestamp_ms INTEGER,
                    cleaned_text TEXT NOT NULL,
                    token_count INTEGER NOT NULL,
                    embedding BLOB,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS chunk_summaries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT NOT NULL UNIQUE,
                    summary_text TEXT NOT NULL,
                    embedding BLOB,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS embedding_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT NOT NULL,
                    chunk_id INTEGER,
                    status TEXT DEFAULT 'pending',
                    retry_count INTEGER DEFAULT 0,
                    error_message TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    processed_at TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_chunks_meeting ON chunks(meeting_id);

                CREATE TABLE IF NOT EXISTS user_profile (
                    id INTEGER PRIMARY KEY,
                    structured_json TEXT NOT NULL,
                    compact_persona TEXT NOT NULL,
                    intro_short TEXT,
                    intro_interview TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS resume_nodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category TEXT,
                    title TEXT,
                    organization TEXT,
                    start_date TEXT,
                    end_date TEXT,
                    duration_months INTEGER,
                    text_content TEXT,
                    tags TEXT,
                    embedding BLOB
                );
            `);
            this.db.pragma('user_version = 1');
        }

        // Version 1 → 2: Add columns for existing installs (safe for fresh installs too)
        if (version < 2) {
            console.log('[DatabaseManager] Applying migration v1 → v2: Add meetings columns');
            // For fresh installs these columns already exist from v1, so we guard with try/catch.
            // Unlike the old code, these are versioned and run exactly once.
            const columnsToAdd = [
                "ALTER TABLE meetings ADD COLUMN calendar_event_id TEXT",
                "ALTER TABLE meetings ADD COLUMN source TEXT",
                "ALTER TABLE meetings ADD COLUMN is_processed INTEGER DEFAULT 1"
            ];
            for (const sql of columnsToAdd) {
                try { this.db.exec(sql); } catch (e) { /* Column already exists from v1 CREATE */ }
            }
            this.db.pragma('user_version = 2');
        }

        // Version 2 → 3: sqlite-vec virtual tables for native vector search
        if (version < 3) {
            console.log('[DatabaseManager] Applying migration v2 → v3: vec0 virtual tables');
            try {
                // Create vec0 virtual table for chunk embeddings (dynamic dimension)
                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
                        chunk_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                // Create vec0 virtual table for summary embeddings (dynamic dimension)
                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
                        summary_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                // Migrate existing chunk embeddings from BLOB column to vec0 table
                this.migrateExistingEmbeddings();

                console.log('[DatabaseManager] vec0 virtual tables created successfully');
            } catch (e) {
                console.error('[DatabaseManager] vec0 migration failed (sqlite-vec may not be loaded):', e);
                console.warn('[DatabaseManager] VectorStore will fall back to JS cosine similarity');
            }
            this.db.pragma('user_version = 3');
        }

        // Version 3 → 4: Drop strict 768-dim vec0 tables to allow flexible embedding dimensions
        if (version < 4) {
            console.log('[DatabaseManager] Applying migration v3 → v4: Drop strict dimension vec0 tables');
            try {
                this.db.exec('DROP TABLE IF EXISTS vec_chunks;');
                this.db.exec('DROP TABLE IF EXISTS vec_summaries;');

                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
                        chunk_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
                        summary_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                this.migrateExistingEmbeddings();
                console.log('[DatabaseManager] vec0 virtual tables recreated for flexible dimensions');
            } catch (e) {
                console.error('[DatabaseManager] vec0 migration v4 failed:', e);
            }
            this.db.pragma('user_version = 4');
        }

        // Version 4 → 5: Add embedding provider and dimensions columns
        if (version < 5) {
            console.log('[DatabaseManager] Applying migration v4 → v5: Add embedding provider/dimensions columns');
            const columnsToAdd = [
                "ALTER TABLE meetings ADD COLUMN embedding_provider TEXT",
                "ALTER TABLE meetings ADD COLUMN embedding_dimensions INTEGER"
            ];
            for (const sql of columnsToAdd) {
                try { this.db.exec(sql); } catch (e) { /* Column already exists */ }
            }
            this.db.pragma('user_version = 5');
        }

        // Version 5 → 6: Add app_state table for KV storage (Ollama pull state, etc)
        if (version < 6) {
            console.log('[DatabaseManager] Applying migration v5 → v6: Add app_state table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            `);
            this.db.pragma('user_version = 6');
        }

        // Version 6 → 7: Add indexes on transcripts and ai_interactions meeting_id
        // (Previously missing — causes O(N) full-table scans when fetching meeting details)
        if (version < 7) {
            console.log('[DatabaseManager] Applying migration v6 → v7: Add meeting_id indexes');
            try {
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON transcripts(meeting_id);');
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_ai_interactions_meeting ON ai_interactions(meeting_id, timestamp);');
                console.log('[DatabaseManager] Meeting ID indexes created successfully');
            } catch (e) {
                console.error('[DatabaseManager] Failed to create indexes (non-fatal):', e);
            }
            this.db.pragma('user_version = 7');
        }

        // Version 7 → 8: Provision per-dimension vec0 tables (NOTE: this v8 ran in two broken
        // iterations for some users — first with float[1536] single table, then with correct per-dim
        // tables. The v9 migration below corrects any v8 that used the old broken schema.)
        if (version < 8) {
            console.log('[DatabaseManager] Applying migration v7 → v8: Provision per-dimension vec0 tables');
            // Drop the legacy single-dim tables from v3/v4 if they exist and are unusable
            try { this.db.exec('DROP TABLE IF EXISTS vec_chunks;'); } catch (_) {}
            try { this.db.exec('DROP TABLE IF EXISTS vec_summaries;'); } catch (_) {}

            for (const dim of DatabaseManager.KNOWN_DIMS) {
                this.ensureVecTableForDim(dim);
            }
            console.log('[DatabaseManager] v8 migration: per-dimension vec0 tables provisioned');
            this.db.pragma('user_version = 8');
        }

        // Version 8 → 9: Ensure per-dimension tables exist.
        // Required for DBs already at v8 but with the old broken float[1536] single-table schema,
        // or with the first incorrect v8 migration that didn't provision KNOWN_DIMS tables.
        if (version < 9) {
            console.log('[DatabaseManager] Applying migration v8 → v9: Ensure per-dimension vec0 tables exist');
            // Drop old single-dim orphan tables if they exist (float[1536] schema)
            try { this.db.exec('DROP TABLE IF EXISTS vec_chunks;'); } catch (_) {}
            try { this.db.exec('DROP TABLE IF EXISTS vec_summaries;'); } catch (_) {}

            let allOk = true;
            for (const dim of DatabaseManager.KNOWN_DIMS) {
                this.ensureVecTableForDim(dim);
                // Verify the table actually exists after provisioning
                try {
                    this.db.prepare(`SELECT count(*) FROM vec_chunks_${dim} LIMIT 1`).get();
                } catch (e) {
                    console.error(`[DatabaseManager] v9: vec_chunks_${dim} still missing after provisioning:`, e);
                    allOk = false;
                }
            }
            if (allOk) {
                console.log('[DatabaseManager] v9 migration: all per-dimension vec0 tables verified ✓');
            } else {
                console.warn('[DatabaseManager] v9 migration: some tables missing — sqlite-vec extension may not be loaded');
            }
            this.db.pragma('user_version = 9');
        }

        // Version 9 → 10: Add UNIQUE constraint on embedding_queue(meeting_id, chunk_id).
        // This enables INSERT OR IGNORE in EmbeddingPipeline.queueMeeting() to silently
        // skip duplicate rows when queueMeeting() is called more than once for the same meeting.
        // SQLite doesn't support ADD CONSTRAINT on existing tables, so we recreate the table
        // using the standard rename-create-copy-drop pattern.
        if (version < 10) {
            console.log('[DatabaseManager] Applying migration v9 → v10: Add UNIQUE constraint to embedding_queue');
            try {
                // Wrap all steps in an explicit better-sqlite3 transaction for atomicity.
                // If any step throws, the entire migration is rolled back cleanly —
                // preventing the dangerous half-renamed table state that a bare exec() chain would leave.
                const migrate = this.db.transaction(() => {
                    // Step 1: Rename the existing table to a temp name
                    this.db!.exec('ALTER TABLE embedding_queue RENAME TO embedding_queue_old;');

                    // Step 2: Recreate with the UNIQUE(meeting_id, chunk_id) constraint
                    this.db!.exec(`
                        CREATE TABLE embedding_queue (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            meeting_id TEXT NOT NULL,
                            chunk_id INTEGER,
                            status TEXT DEFAULT 'pending',
                            retry_count INTEGER DEFAULT 0,
                            error_message TEXT,
                            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                            processed_at TEXT,
                            UNIQUE(meeting_id, chunk_id)
                        );
                    `);

                    // Step 3: Copy rows; INSERT OR IGNORE silently drops any pre-existing duplicates
                    this.db!.exec(`
                        INSERT OR IGNORE INTO embedding_queue
                            (id, meeting_id, chunk_id, status, retry_count, error_message, created_at, processed_at)
                        SELECT id, meeting_id, chunk_id, status, retry_count, error_message, created_at, processed_at
                        FROM embedding_queue_old;
                    `);

                    // Step 4: Drop the backup
                    this.db!.exec('DROP TABLE embedding_queue_old;');
                });
                migrate();
                console.log('[DatabaseManager] v10 migration: embedding_queue UNIQUE constraint added ✓');
            } catch (e) {
                console.error('[DatabaseManager] v10 migration failed — table structure unchanged:', e);
                // user_version still advances. We do NOT retry — a failed rename leaves
                // embedding_queue_old behind; retrying would cause "table already exists".
                // In the failure case, INSERT OR IGNORE in queueMeeting() will still work
                // for natural uniqueness (same meeting queued twice picks up existing rows),
                // just without DB-enforced deduplication.
            }
            this.db.pragma('user_version = 10');
        }

        // Version 10 → 11: Add modes, mode_reference_files, and mode_note_sections tables
        if (version < 11) {
            console.log('[DatabaseManager] Applying migration v10 → v11: Add modes tables');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS modes (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    template_type TEXT NOT NULL DEFAULT 'general',
                    custom_context TEXT NOT NULL DEFAULT '',
                    is_active INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS mode_reference_files (
                    id TEXT PRIMARY KEY,
                    mode_id TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS mode_note_sections (
                    id TEXT PRIMARY KEY,
                    mode_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    compiled_prompt TEXT DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
                );
            `);
            // Seed a default "General" mode as active
            const defaultModeId = 'mode_general_default';
            this.db.prepare(`
                INSERT OR IGNORE INTO modes (id, name, template_type, custom_context, is_active)
                VALUES (?, ?, ?, ?, 1)
            `).run(defaultModeId, 'General', 'general', '');
            this.db.pragma('user_version = 11');
        }

        // Version 11 → 12: Seed note sections for the default General mode if missing
        if (version < 12) {
            console.log('[DatabaseManager] Applying migration v11 → v12: Seed default General mode note sections');
            const defaultModeId = 'mode_general_default';
            const modeExists = this.db.prepare('SELECT id FROM modes WHERE id = ?').get(defaultModeId);
            const existing = modeExists
                ? this.db.prepare('SELECT id FROM mode_note_sections WHERE mode_id = ?').get(defaultModeId)
                : null;
            if (modeExists && !existing) {
                const defaultSections = [
                    { title: 'Summary',      description: 'High-level summary of the conversation.' },
                    { title: 'Action items', description: 'Tasks and follow-ups identified.' },
                    { title: 'Key points',   description: 'Important points discussed.' },
                ];
                const insertSection = this.db.prepare(
                    'INSERT OR IGNORE INTO mode_note_sections (id, mode_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)'
                );
                defaultSections.forEach((s, i) => {
                    insertSection.run(`ns_general_${i}`, defaultModeId, s.title, s.description, i);
                });
            }
            this.db.pragma('user_version = 12');
        }

        // Version 12 → 13: Backfill note sections for any mode instance that has none
        if (version < 13) {
            console.log('[DatabaseManager] Applying migration v12 → v13: Backfill missing mode note sections');
            const BACKFILL_SECTIONS: Record<string, Array<{ title: string; description: string }>> = {
                general: [
                    { title: 'Summary',      description: 'High-level summary of the conversation.' },
                    { title: 'Action items', description: 'Tasks and follow-ups identified.' },
                    { title: 'Key points',   description: 'Important points discussed.' },
                ],
                'looking-for-work': [
                    { title: 'Follow-up actions',       description: 'Next interview steps or additional materials I said I would send if applicable.' },
                    { title: 'Overview',                description: 'Overview of the interview, the company, and general structure.' },
                    { title: 'Questions and responses', description: 'All questions asked to me during the interview and answers that gave.' },
                    { title: 'Areas to improve',        description: 'What I could have done better during the interview.' },
                    { title: 'Role details',            description: 'Anything discussed about the position, salary expectations, etc.' },
                ],
                sales: [
                    { title: 'Action Items',        description: 'All action items that were said I would do after the meeting.' },
                    { title: 'Outcome',             description: 'Did I close the sale and what was the outcome of the conversation.' },
                    { title: 'Prospect background', description: 'Background and context on who I was selling to.' },
                    { title: 'Discovery',           description: 'What the prospect said during discovery.' },
                    { title: 'Product',             description: "How I pitched the product and the prospect's reaction." },
                    { title: 'Objections',          description: 'Objections from the prospect if there were any.' },
                ],
                recruiting: [
                    { title: 'Action Items',          description: 'All action items that I have to do after the meeting.' },
                    { title: 'Experience and skills', description: "Candidate's previous work experience and skills discussed." },
                    { title: 'Quality of responses',  description: 'If there were questions asked, how well and how accurately the candidate answered each question.' },
                    { title: 'Interest in company',   description: 'What the candidate said about their interest in the company.' },
                    { title: 'Role expectations',     description: 'Anything discussed about the position, salary expectations, etc.' },
                ],
                'team-meet': [
                    { title: 'Action Items',           description: 'All action items that were said I would do after the meeting.' },
                    { title: 'Announcements',          description: 'Any team-wide announcements from the meeting.' },
                    { title: 'Team updates',           description: "Each team member's progress, accomplishments, and current focus." },
                    { title: 'Challenges or blockers', description: 'Any issues or obstacles raised that may affect progress.' },
                    { title: 'Decisions made',         description: 'Key decisions or agreements reached during the meeting.' },
                ],
                lecture: [
                    { title: 'Follow-up work', description: 'Follow-up reading, assignments, or tasks to complete.' },
                    { title: 'Topic',          description: 'Main subject or theme of the lecture.' },
                    { title: 'Key concepts',   description: 'Core ideas or frameworks covered.' },
                    { title: 'Content',        description: 'All content from the lecture with incredibly detailed bullet notes.' },
                ],
                'technical-interview': [
                    { title: 'Problems covered', description: 'Each problem asked, the approach used, and the outcome.' },
                    { title: 'Concepts tested',  description: 'Key algorithms, data structures, or system design concepts that came up.' },
                    { title: 'What went well',   description: 'Approaches or explanations that landed well.' },
                    { title: 'Areas to study',   description: 'Topics or gaps identified that need more preparation.' },
                    { title: 'Action items',     description: 'Follow-up steps — e.g. send code, study specific topics, await next round.' },
                ],
            };

            const allModes = this.db.prepare('SELECT id, template_type FROM modes').all() as Array<{ id: string; template_type: string }>;
            const insertSection = this.db.prepare(
                'INSERT OR IGNORE INTO mode_note_sections (id, mode_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)'
            );
            for (const mode of allModes) {
                const hasSection = this.db.prepare('SELECT id FROM mode_note_sections WHERE mode_id = ? LIMIT 1').get(mode.id);
                if (!hasSection) {
                    const sections = BACKFILL_SECTIONS[mode.template_type] ?? [];
                    sections.forEach((s, i) => {
                        insertSection.run(`ns_bf_${mode.id}_${i}`, mode.id, s.title, s.description, i);
                    });
                    if (sections.length > 0) {
                        console.log(`[DatabaseManager] Backfilled ${sections.length} sections for mode "${mode.id}" (${mode.template_type})`);
                    }
                }
            }
            this.db.pragma('user_version = 13');
        }

        // Version 13 → 14: Add profile_custom_notes table
        if (version < 14) {
            console.log('[DatabaseManager] Applying migration v13 → v14: Add profile_custom_notes table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS profile_custom_notes (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    content TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT OR IGNORE INTO profile_custom_notes (id, content) VALUES (1, '');
            `);
            this.db.pragma('user_version = 14');
        }

        // Version 14 → 15: Add profile_persona table
        if (version < 15) {
            console.log('[DatabaseManager] Applying migration v14 → v15: Add profile_persona table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS profile_persona (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    content TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT OR IGNORE INTO profile_persona (id, content) VALUES (1, '');
            `);
            this.db.pragma('user_version = 15');
        }

        // Version 15 → 16: Add embedding_space identity column + backfill.
        // The previous re-index compatibility check keyed on `embedding_provider`
        // (name only, e.g. 'gemini'), which CANNOT distinguish two models with the
        // same provider+dimensions but incompatible vector spaces (e.g.
        // gemini-embedding-001 768d vs gemini-embedding-2 768d). embedding_space is
        // the composite `${name}:${model}:${dims}` identity that fixes this.
        //
        // Backfill synthesizes the v1 space for each legacy row from its existing
        // provider+dims so it correctly DIFFERS from any new model's space. The
        // model strings below must match each provider's shipped default at the
        // time legacy rows were written (see electron/rag/embeddingSpace.ts:legacySpaceForProvider).
        if (version < 16) {
            console.log('[DatabaseManager] Applying migration v15 → v16: Add embedding_space column + backfill');
            try { this.db.exec('ALTER TABLE meetings ADD COLUMN embedding_space TEXT'); } catch (e) { /* column already exists */ }
            try {
                // Build the CASE arms from the SAME shared map legacySpaceForProvider uses,
                // so the migration backfill and the runtime space key can never drift apart.
                const caseArms = buildLegacySpaceCaseSql();
                this.db.exec(`
                    UPDATE meetings
                    SET embedding_space =
                        embedding_provider || ':' ||
                        CASE embedding_provider
                          ${caseArms}
                          ELSE 'unknown'
                        END || ':' ||
                        COALESCE(CAST(embedding_dimensions AS TEXT), 'unknown')
                    WHERE embedding_provider IS NOT NULL
                      AND embedding_space IS NULL;
                `);
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_meetings_embedding_space ON meetings(embedding_space);');
                console.log('[DatabaseManager] v16 migration: embedding_space backfilled + indexed ✓');
            } catch (e) {
                console.error('[DatabaseManager] v16 migration backfill failed (non-fatal):', e);
            }
            this.db.pragma('user_version = 16');
        }

        // Version 16 → 17: Track post-meeting note generation state.
        // V3 summarization is multi-stage (queued → chunking → summarizing_chunks →
        // reducing → validating → completed/failed). Store only a safe status string —
        // never transcript or generated note content — so the UI can expose retry/regenerate.
        if (version < 17) {
            console.log('[DatabaseManager] Applying migration v16 → v17: Add summary_status column');
            try { this.db.exec("ALTER TABLE meetings ADD COLUMN summary_status TEXT DEFAULT 'completed'"); } catch (e) { /* column already exists */ }
            try { this.db.exec("UPDATE meetings SET summary_status = 'queued' WHERE is_processed = 0"); } catch (e) { /* non-fatal backfill */ }
            this.db.pragma('user_version = 17');
        }

        // Version 17 → 18: Add compiled_prompt to mode_note_sections. When a user adds or
        // edits a note-section (or creates a custom mode), an AI-compiled extraction
        // instruction is generated from the section's title+description and cached here so
        // summary generation can fill that section faithfully. Empty/null = fall back to
        // title+description. Never stores transcript or note content.
        if (version < 18) {
            console.log('[DatabaseManager] Applying migration v17 → v18: Add compiled_prompt to mode_note_sections');
            try { this.db.exec("ALTER TABLE mode_note_sections ADD COLUMN compiled_prompt TEXT DEFAULT ''"); } catch (e) { /* column already exists */ }
            this.db.pragma('user_version = 18');
        }

        if (version < 19) {
            // PDF ingestion now captures real page counts (electron/ipcHandlers.ts
            // 2026-06-27 fix F1+F2). Persist them on the file row so the
            // retriever can use real numbers instead of falling back to the
            // 3000-char text-length heuristic on every app restart.
            console.log('[DatabaseManager] Applying migration v18 → v19: Add page_count + extracted_page_count to mode_reference_files');
            try { this.db.exec("ALTER TABLE mode_reference_files ADD COLUMN page_count INTEGER"); } catch (e) { /* column already exists */ }
            try { this.db.exec("ALTER TABLE mode_reference_files ADD COLUMN extracted_page_count INTEGER"); } catch (e) { /* column already exists */ }
            this.db.pragma('user_version = 19');
        }

        if (version < 20) {
            // OKF Hybrid Knowledge System (Phase 2, 2026-07-01): structured,
            // source-attributed "Knowledge Packs" (OKF-compatible Knowledge
            // Bundles) generated from uploaded reference files, layered ON TOP
            // of (never replacing) mode_reference_files / mode_reference_chunks.
            // All FKs cascade on mode/source deletion so a deleted reference
            // file's pack/cards/entities/relations are cleaned up automatically.
            console.log('[DatabaseManager] Applying migration v19 → v20: Add OKF knowledge_* tables');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS knowledge_sources (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL DEFAULT 'reference_file',
                    file_id TEXT,
                    mode_id TEXT,
                    file_name TEXT,
                    source_checksum TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    indexed_at TEXT,
                    page_count INTEGER,
                    extracted_page_count INTEGER,
                    index_version TEXT NOT NULL DEFAULT 'knowledge_pack_v1',
                    embedding_space TEXT,
                    FOREIGN KEY(file_id) REFERENCES mode_reference_files(id) ON DELETE CASCADE,
                    FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_sources_file_id ON knowledge_sources(file_id);
                CREATE INDEX IF NOT EXISTS idx_knowledge_sources_mode_id ON knowledge_sources(mode_id);

                CREATE TABLE IF NOT EXISTS knowledge_packs (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    mode_id TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    index_md TEXT NOT NULL DEFAULT '',
                    stats_json TEXT NOT NULL DEFAULT '{}',
                    pack_version INTEGER NOT NULL DEFAULT 1,
                    generated_by TEXT NOT NULL DEFAULT 'okf_extractor_v1',
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE,
                    FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_packs_source_id ON knowledge_packs(source_id);
                CREATE INDEX IF NOT EXISTS idx_knowledge_packs_mode_id ON knowledge_packs(mode_id);

                CREATE TABLE IF NOT EXISTS knowledge_cards (
                    id TEXT PRIMARY KEY,
                    pack_id TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    concept_id TEXT NOT NULL,
                    body TEXT NOT NULL DEFAULT '',
                    body_markdown TEXT,
                    source_pages_json TEXT NOT NULL DEFAULT '[]',
                    source_sections_json TEXT NOT NULL DEFAULT '[]',
                    source_quotes_json TEXT NOT NULL DEFAULT '[]',
                    entities_json TEXT NOT NULL DEFAULT '[]',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    related_card_ids_json TEXT NOT NULL DEFAULT '[]',
                    confidence TEXT NOT NULL DEFAULT 'medium',
                    generated_from TEXT NOT NULL DEFAULT 'pdf_extraction',
                    source_checksum TEXT NOT NULL,
                    user_edited INTEGER NOT NULL DEFAULT 0,
                    approval_status TEXT NOT NULL DEFAULT 'generated',
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    card_version INTEGER NOT NULL DEFAULT 1,
                    FOREIGN KEY(pack_id) REFERENCES knowledge_packs(id) ON DELETE CASCADE,
                    FOREIGN KEY(source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_cards_pack_id ON knowledge_cards(pack_id);
                CREATE INDEX IF NOT EXISTS idx_knowledge_cards_source_id ON knowledge_cards(source_id);
                CREATE INDEX IF NOT EXISTS idx_knowledge_cards_concept_id ON knowledge_cards(concept_id);
                CREATE INDEX IF NOT EXISTS idx_knowledge_cards_type ON knowledge_cards(type);

                CREATE TABLE IF NOT EXISTS knowledge_entities (
                    id TEXT PRIMARY KEY,
                    pack_id TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL DEFAULT 'concept',
                    aliases_json TEXT NOT NULL DEFAULT '[]',
                    description TEXT NOT NULL DEFAULT '',
                    source_card_ids_json TEXT NOT NULL DEFAULT '[]',
                    source_pages_json TEXT NOT NULL DEFAULT '[]',
                    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(pack_id) REFERENCES knowledge_packs(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_entities_pack_id ON knowledge_entities(pack_id);
                CREATE INDEX IF NOT EXISTS idx_knowledge_entities_slug ON knowledge_entities(slug);

                CREATE TABLE IF NOT EXISTS knowledge_relations (
                    id TEXT PRIMARY KEY,
                    pack_id TEXT NOT NULL,
                    subject_id TEXT NOT NULL,
                    subject_type TEXT NOT NULL,
                    predicate TEXT NOT NULL,
                    object_id TEXT NOT NULL,
                    object_type TEXT NOT NULL,
                    source_card_ids_json TEXT NOT NULL DEFAULT '[]',
                    source_pages_json TEXT NOT NULL DEFAULT '[]',
                    confidence TEXT NOT NULL DEFAULT 'medium',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(pack_id) REFERENCES knowledge_packs(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_relations_pack_id ON knowledge_relations(pack_id);
                CREATE INDEX IF NOT EXISTS idx_knowledge_relations_subject_id ON knowledge_relations(subject_id);

                CREATE TABLE IF NOT EXISTS knowledge_index_versions (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    pack_id TEXT,
                    pack_version INTEGER NOT NULL DEFAULT 1,
                    content_hash TEXT NOT NULL,
                    embedding_space TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    error_message TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_index_versions_source_id ON knowledge_index_versions(source_id);
            `);
            this.db.pragma('user_version = 20');
        }

        if (version < 21) {
            // OKF Phase 6 (2026-07-01): user edits and approval workflow.
            // knowledge_card_versions preserves EVERY prior card body (both
            // generated and user-edited) so an edit can always be reverted to
            // the original generated card, never destructively overwriting
            // history. approval_status/user_edited columns already exist on
            // knowledge_cards (added in v19→v20); this migration adds the
            // version-history table those columns' UI depends on.
            console.log('[DatabaseManager] Applying migration v20 → v21: Add knowledge_card_versions table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS knowledge_card_versions (
                    id TEXT PRIMARY KEY,
                    card_id TEXT NOT NULL,
                    card_version INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL,
                    entities_json TEXT NOT NULL DEFAULT '[]',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    confidence TEXT NOT NULL DEFAULT 'medium',
                    edited_by TEXT NOT NULL DEFAULT 'system',
                    edit_reason TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(card_id) REFERENCES knowledge_cards(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_card_versions_card_id ON knowledge_card_versions(card_id);
            `);
            this.db.pragma('user_version = 21');
        }

        if (version < 22) {
            // FIX 2026-07-01: backfill page_count / extracted_page_count on
            // existing reference_file rows where the column is NULL. The cause:
            // the v18→v19 schema migration added the columns and the v19→v21
            // rounds shipped the upstream producer-side forwarding fix (see
            // ModesManager.addReferenceFile). Rows inserted BEFORE that fix
            // shipped still have NULL page_count, which forces
            // ModeContextRetriever.reportReferenceFilePageCounts into its
            // heuristic branch (`referenceFileIngestedByPageHeuristic: true`)
            // until the user re-uploads the file. This migration derives the
            // value from [Page N] markers already embedded in content (round-2
            // injected those into pdf-parse output). Two phases:
            //   1) Derive a count from [Page N] markers for PDFs (fast, exact).
            //   2) Fall back to a character-length estimate for any non-PDF
            //      where markers don't match. Conservative divisor of 3000
            //      mirrors the live in-app heuristic exactly so downstream
            //      behavior is stable.
            // Safe on WAL — single bulk UPDATE per phase, no FK cascade
            // impact (page_count is a leaf integer column, no schema change).
            // Idempotent: WHERE page_count IS NULL ensures re-runs are no-ops.
            console.log('[DatabaseManager] Applying migration v21 → v22: Backfill NULL page_count + extracted_page_count on mode_reference_files');
            try {
                // Phase 1: derive exact count from every [Page N] marker via
                // recursive CTE. The CTE seeds with the first occurrence offset,
                // then iterates `instr(content, '[Page ', prev + 1)` to find
                // each subsequent occurrence until instr returns 0 (no more
                // matches). Each iteration extracts `CAST(... AS INTEGER)` of
                // the trailing number. MAX() then returns the largest page
                // number found, which == total page count for any document
                // with sequentially-numbered markers.
                //
                // CRITICAL: the first draft of Phase 1 used a single
                // `instr(content, '[Page ')` call which returns ONLY the FIRST
                // occurrence offset — so substr() extracted the page number
                // from the first marker only (returned 1 for a 66-page PDF).
                // The recursive CTE walks EVERY occurrence so MAX() finds the
                // actual total. Test-engineer caught this on 2026-07-01.
                const phaseOne = this.db.prepare(`
                    UPDATE mode_reference_files
                    SET page_count = (
                        -- Each row's content is its own subquery scope. CTE walks
                        -- by chopping "rest" to everything-after the [Page N]
                        -- header, finding the next [Page marker in that rest,
                        -- extracting its integer, and recursing. The seeded
                        -- row finds marker #1, the recursive step finds #N+1,
                        -- and so on until no more markers remain.
                        -- SQLite's built-in instr() takes (haystack, needle)
                        -- only — no 3-arg form — so we walk by carving the
                        -- string instead of using absolute offsets.
                        -- If no markers exist this SELECT returns NULL (no
                        -- rows); the WHERE phase_count IS NULL guard in Phase 2
                        -- picks those rows back up for the heuristic fallback.
                        WITH RECURSIVE cte_pages(rest, page_num) AS (
                            SELECT
                                substr(content, instr(content, '[Page ') + 6),
                                CASE
                                    WHEN instr(content, '[Page ') > 0
                                    THEN CAST(
                                        substr(
                                            content,
                                            instr(content, '[Page ') + 6,
                                            instr(substr(content, instr(content, '[Page ') + 6), ']') - 1
                                        ) AS INTEGER
                                    )
                                    ELSE NULL
                                END
                            FROM mode_reference_files
                            WHERE mode_reference_files.id = mode_reference_files.id
                              AND page_count IS NULL
                              AND content LIKE '%[Page %]%'
                        UNION ALL
                            SELECT
                                substr(rest, instr(rest, '[Page ') + 6),
                                CASE
                                    WHEN instr(rest, '[Page ') > 0
                                    THEN CAST(
                                        substr(
                                            rest,
                                            instr(rest, '[Page ') + 6,
                                            instr(substr(rest, instr(rest, '[Page ') + 6), ']') - 1
                                        ) AS INTEGER
                                    )
                                    ELSE NULL
                                END
                            FROM cte_pages
                            WHERE instr(rest, '[Page ') > 0
                            LIMIT 5000
                        )
                        SELECT MAX(page_num) FROM cte_pages WHERE page_num IS NOT NULL
                    )
                    WHERE page_count IS NULL
                      AND content LIKE '%[Page %]%'
                `).run();
                // Phase 2: heuristic for non-marked content (rare — only old
                // pre-round-2 content or non-PDF text). Use 3000 chars/page to
                // match the live ModeContextRetriever heuristic exactly.
                const phaseTwo = this.db.prepare(`
                    UPDATE mode_reference_files
                    SET page_count = MAX(1, CAST(LENGTH(content) / 3000 AS INTEGER)),
                        extracted_page_count = MAX(1, CAST(LENGTH(content) / 3000 AS INTEGER))
                    WHERE page_count IS NULL
                `).run();
                console.log(`[DatabaseManager] v22 backfill: derived ${phaseOne.changes} rows from [Page N] markers, heuristically estimated ${phaseTwo.changes} remaining rows`);
                // Senior-review fix 2026-07-01: only advance the schema version
                // when BOTH phases complete without throwing. The catch block
                // below now re-throws so we don't get stuck re-running a
                // partial migration on every app start (which would retry
                // any deterministic SQLite failure — e.g. recursion limit on
                // a 5000+ marker pathological doc — forever).
                this.db.pragma('user_version = 22');
            } catch (e) {
                console.error('[DatabaseManager] v22 backfill migration failed (re-throwing to halt startup so user sees the error):', e);
                throw e;
            }
        }

        if (version < 23) {
            // OKF Profile Intelligence upgrade (2026-07-02): the shared knowledge_*
            // tables (v19→v20) were built for MODE reference files — knowledge_sources
            // and knowledge_packs declare `mode_id TEXT NOT NULL` with an FK to
            // modes(id). Profile packs (candidate resume/JD → OKF cards) have no user
            // mode. Rather than fork a parallel table family (explicitly forbidden by
            // the migration brief — "no second OKF stack"), we reserve ONE sentinel
            // mode row, '__profile_okf__', that profile packs hang off. It satisfies
            // the NOT NULL + FK constraint AND is filterable so it never surfaces as a
            // real mode: ModesManager.getModes and every getPacksByModeId caller for
            // document-grounded retrieval query by a USER mode id, never this reserved
            // id, so profile cards can never leak into a document-grounded answer via
            // the mode path. The premium KnowledgeDatabaseManager enables
            // `PRAGMA foreign_keys = ON` on this same shared connection at boot, so the
            // FK is genuinely enforced at runtime — the sentinel is required, not
            // cosmetic. template_type '__reserved__' keeps it out of the general/custom
            // template universe.
            //
            // Also add the `pii` marker column to knowledge_cards: profile cards carry
            // pii=1 so downstream tooling (export, UI, any future consumer) can filter
            // PII cards. Reference-file cards keep the default pii=0 — no behavior
            // change for the existing document OKF path.
            console.log('[DatabaseManager] Applying migration v22 → v23: profile OKF (reserved mode + knowledge_cards.pii)');
            const addPiiColumn = () => {
                try {
                    this.db!.exec(`ALTER TABLE knowledge_cards ADD COLUMN pii INTEGER NOT NULL DEFAULT 0`);
                } catch (e) {
                    // Column already exists (idempotent re-run / older partial migration) — additive ALTER only.
                    const msg = (e as Error)?.message || '';
                    if (!/duplicate column name/i.test(msg)) throw e;
                }
            };
            addPiiColumn();
            this.db.prepare(`
                INSERT OR IGNORE INTO modes (id, name, template_type, custom_context, is_active, created_at)
                VALUES ('__profile_okf__', 'Profile Intelligence (reserved)', '__reserved__', '', 0, CURRENT_TIMESTAMP)
            `).run();
            this.db.pragma('user_version = 23');
        }

        console.log('[DatabaseManager] Migrations completed.');
    }

    // ============================================
    // Profile Custom Notes
    // ============================================

    public getCustomNotes(): string {
        if (!this.db) return '';
        try {
            const row = this.db.prepare('SELECT content FROM profile_custom_notes WHERE id = 1').get() as { content: string } | undefined;
            return row?.content ?? '';
        } catch (e) {
            console.error('[DatabaseManager] getCustomNotes failed:', e);
            return '';
        }
    }

    public saveCustomNotes(content: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                'INSERT INTO profile_custom_notes (id, content, updated_at) VALUES (1, ?, datetime(\'now\')) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
            ).run(content);
        } catch (e) {
            console.error('[DatabaseManager] saveCustomNotes failed:', e);
        }
    }

    public getPersona(): string {
        if (!this.db) return '';
        try {
            const row = this.db.prepare('SELECT content FROM profile_persona WHERE id = 1').get() as { content: string } | undefined;
            return row?.content ?? '';
        } catch (e) {
            console.error('[DatabaseManager] getPersona failed:', e);
            return '';
        }
    }

    public savePersona(content: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                'INSERT INTO profile_persona (id, content, updated_at) VALUES (1, ?, datetime(\'now\')) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
            ).run(content);
        } catch (e) {
            console.error('[DatabaseManager] savePersona failed:', e);
        }
    }

    public clearProfilePersona(): void {
        if (!this.db) return;
        try {
            this.db.prepare('UPDATE profile_persona SET content = \'\', updated_at = datetime(\'now\') WHERE id = 1').run();
        } catch (e) {
            console.error('[DatabaseManager] clearProfilePersona failed:', e);
        }
    }

    // ============================================
    // Modes CRUD
    // ============================================

    public getModes(): any[] {
        if (!this.db) return [];
        try {
            return this.db.prepare('SELECT * FROM modes ORDER BY created_at ASC').all();
        } catch (e) {
            console.error('[DatabaseManager] getModes failed:', e);
            return [];
        }
    }

    public getActiveMode(): any | null {
        if (!this.db) return null;
        try {
            return this.db.prepare('SELECT * FROM modes WHERE is_active = 1 LIMIT 1').get() ?? null;
        } catch (e) {
            console.error('[DatabaseManager] getActiveMode failed:', e);
            return null;
        }
    }

    public createMode(mode: { id: string; name: string; templateType: string; customContext: string }): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                INSERT INTO modes (id, name, template_type, custom_context, is_active)
                VALUES (?, ?, ?, ?, 0)
            `).run(mode.id, mode.name, mode.templateType, mode.customContext);
        } catch (e) {
            console.error('[DatabaseManager] createMode failed:', e);
        }
    }

    public updateMode(id: string, updates: { name?: string; templateType?: string; customContext?: string }): void {
        if (!this.db) return;
        try {
            if (updates.name !== undefined) {
                this.db.prepare('UPDATE modes SET name = ? WHERE id = ?').run(updates.name, id);
            }
            if (updates.templateType !== undefined) {
                this.db.prepare('UPDATE modes SET template_type = ? WHERE id = ?').run(updates.templateType, id);
            }
            if (updates.customContext !== undefined) {
                this.db.prepare('UPDATE modes SET custom_context = ? WHERE id = ?').run(updates.customContext, id);
            }
        } catch (e) {
            console.error('[DatabaseManager] updateMode failed:', e);
        }
    }

    public deleteMode(id: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM modes WHERE id = ?').run(id);
        } catch (e) {
            console.error('[DatabaseManager] deleteMode failed:', e);
        }
    }

    public setActiveMode(id: string | null): void {
        if (!this.db) return;
        try {
            const txn = this.db.transaction(() => {
                this.db!.prepare('UPDATE modes SET is_active = 0').run();
                if (id) {
                    const result = this.db!.prepare('UPDATE modes SET is_active = 1 WHERE id = ?').run(id);
                    if (result.changes === 0) {
                        console.warn(`[DatabaseManager] setActiveMode: no mode found with id "${id}" — active mode cleared`);
                    }
                }
            });
            txn();
        } catch (e) {
            console.error('[DatabaseManager] setActiveMode failed:', e);
        }
    }

    public getReferenceFiles(modeId: string): any[] {
        if (!this.db) return [];
        try {
            return this.db.prepare('SELECT * FROM mode_reference_files WHERE mode_id = ? ORDER BY created_at ASC').all(modeId);
        } catch (e) {
            console.error('[DatabaseManager] getReferenceFiles failed:', e);
            return [];
        }
    }

    public addReferenceFile(file: {
        id: string;
        modeId: string;
        fileName: string;
        content: string;
        pageCount?: number;
        extractedPageCount?: number;
    }): void {
        if (!this.db) throw new Error('Database not initialized');
        try {
            this.db.prepare(`
                INSERT INTO mode_reference_files (id, mode_id, file_name, content, page_count, extracted_page_count)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                file.id,
                file.modeId,
                file.fileName,
                file.content,
                file.pageCount ?? null,
                file.extractedPageCount ?? null,
            );
        } catch (e) {
            console.error('[DatabaseManager] addReferenceFile failed:', e);
            throw e;
        }
    }

    public deleteReferenceFile(id: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM mode_reference_files WHERE id = ?').run(id);
        } catch (e) {
            console.error('[DatabaseManager] deleteReferenceFile failed:', e);
        }
    }

    // ── OKF Knowledge Packs (Phase 2) ───────────────────────────────
    // CRUD for knowledge_sources/knowledge_packs/knowledge_cards/knowledge_entities/
    // knowledge_relations/knowledge_index_versions. All rows cascade-delete via FK
    // when the owning mode_reference_files / modes row is deleted — see migration
    // v19→v20. Row shapes are intentionally untyped (`any`) at this layer; typed
    // mapping happens in electron/services/knowledge/KnowledgePackStore.ts.

    public upsertKnowledgeSource(source: {
        id: string; type: string; fileId?: string; modeId?: string; fileName?: string;
        sourceChecksum: string; contentHash: string; indexedAt?: string;
        pageCount?: number; extractedPageCount?: number; indexVersion?: string; embeddingSpace?: string;
    }): void {
        if (!this.db) throw new Error('Database not initialized');
        this.db.prepare(`
            INSERT INTO knowledge_sources (id, type, file_id, mode_id, file_name, source_checksum, content_hash, indexed_at, page_count, extracted_page_count, index_version, embedding_space)
            VALUES (@id, @type, @fileId, @modeId, @fileName, @sourceChecksum, @contentHash, @indexedAt, @pageCount, @extractedPageCount, @indexVersion, @embeddingSpace)
            ON CONFLICT(id) DO UPDATE SET
                source_checksum = excluded.source_checksum,
                content_hash = excluded.content_hash,
                indexed_at = excluded.indexed_at,
                page_count = excluded.page_count,
                extracted_page_count = excluded.extracted_page_count,
                index_version = excluded.index_version,
                embedding_space = excluded.embedding_space
        `).run({
            id: source.id, type: source.type, fileId: source.fileId ?? null, modeId: source.modeId ?? null,
            fileName: source.fileName ?? null, sourceChecksum: source.sourceChecksum, contentHash: source.contentHash,
            indexedAt: source.indexedAt ?? null, pageCount: source.pageCount ?? null, extractedPageCount: source.extractedPageCount ?? null,
            indexVersion: source.indexVersion ?? 'knowledge_pack_v1', embeddingSpace: source.embeddingSpace ?? null,
        });
    }

    public getKnowledgeSourceByFileId(fileId: string): any | null {
        if (!this.db) return null;
        return this.db.prepare('SELECT * FROM knowledge_sources WHERE file_id = ? ORDER BY created_at DESC LIMIT 1').get(fileId) || null;
    }

    public getKnowledgeSourceById(id: string): any | null {
        if (!this.db) return null;
        return this.db.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(id) || null;
    }

    public getKnowledgeSourcesByModeId(modeId: string): any[] {
        if (!this.db) return [];
        return this.db.prepare('SELECT * FROM knowledge_sources WHERE mode_id = ?').all(modeId);
    }

    /**
     * Explicit cascade delete for a knowledge_sources row and everything
     * hanging off it (packs, cards, entities, relations, index versions).
     * This codebase never enables `PRAGMA foreign_keys = ON` (confirmed:
     * zero references anywhere in electron/), so the `ON DELETE CASCADE`
     * clauses declared on these tables in the v19→v20/v20→v21 migrations are
     * inert — SQLite silently ignores FK actions when enforcement is off. A
     * bare `DELETE FROM knowledge_sources` would leave every dependent row
     * permanently orphaned (unreclaimable disk growth, since a re-upload
     * mints a fresh random file id that never matches the orphaned rows).
     * Deletes in dependency order (children before the pack, pack before
     * the source) inside one transaction so a mid-delete failure can't
     * leave a partially-cleaned pack.
     */
    public deleteKnowledgeSource(id: string): void {
        if (!this.db) return;
        const txn = this.db.transaction(() => {
            const packs = this.db!.prepare('SELECT id FROM knowledge_packs WHERE source_id = ?').all(id) as Array<{ id: string }>;
            for (const { id: packId } of packs) {
                this.db!.prepare('DELETE FROM knowledge_relations WHERE pack_id = ?').run(packId);
                this.db!.prepare('DELETE FROM knowledge_entities WHERE pack_id = ?').run(packId);
                // knowledge_card_versions cascades off knowledge_cards.id, not pack_id directly.
                this.db!.prepare(`
                    DELETE FROM knowledge_card_versions
                    WHERE card_id IN (SELECT id FROM knowledge_cards WHERE pack_id = ?)
                `).run(packId);
                this.db!.prepare('DELETE FROM knowledge_cards WHERE pack_id = ?').run(packId);
            }
            this.db!.prepare('DELETE FROM knowledge_packs WHERE source_id = ?').run(id);
            this.db!.prepare('DELETE FROM knowledge_index_versions WHERE source_id = ?').run(id);
            this.db!.prepare('DELETE FROM knowledge_sources WHERE id = ?').run(id);
        });
        txn();
    }

    public upsertKnowledgePack(pack: {
        id: string; sourceId: string; modeId: string; fileName: string;
        indexMd: string; statsJson: string; packVersion: number; generatedBy: string;
    }): void {
        if (!this.db) throw new Error('Database not initialized');
        this.db.prepare(`
            INSERT INTO knowledge_packs (id, source_id, mode_id, file_name, index_md, stats_json, pack_version, generated_by, updated_at)
            VALUES (@id, @sourceId, @modeId, @fileName, @indexMd, @statsJson, @packVersion, @generatedBy, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                index_md = excluded.index_md,
                stats_json = excluded.stats_json,
                pack_version = excluded.pack_version,
                updated_at = CURRENT_TIMESTAMP
        `).run(pack);
    }

    public getKnowledgePackBySourceId(sourceId: string): any | null {
        if (!this.db) return null;
        return this.db.prepare('SELECT * FROM knowledge_packs WHERE source_id = ? ORDER BY updated_at DESC LIMIT 1').get(sourceId) || null;
    }

    public getKnowledgePacksByModeId(modeId: string): any[] {
        if (!this.db) return [];
        return this.db.prepare('SELECT * FROM knowledge_packs WHERE mode_id = ? ORDER BY updated_at DESC').all(modeId);
    }

    public deleteKnowledgePack(id: string): void {
        if (!this.db) return;
        this.db.prepare('DELETE FROM knowledge_packs WHERE id = ?').run(id);
    }

    public replaceKnowledgeCards(packId: string, sourceId: string, cards: Array<{
        id: string; type: string; title: string; slug: string; conceptId: string;
        body: string; bodyMarkdown?: string; sourcePagesJson: string; sourceSectionsJson: string;
        sourceQuotesJson: string; entitiesJson: string; tagsJson: string; relatedCardIdsJson: string;
        confidence: string; generatedFrom: string; sourceChecksum: string; cardVersion: number;
        pii?: boolean;
    }>, newSourceChecksum?: string): void {
        if (!this.db) throw new Error('Database not initialized');
        const txn = this.db.transaction(() => {
            // OKF Phase 6: a user-edited card whose source_checksum no longer
            // matches the freshly-extracted content (the underlying document
            // changed since the edit) is flagged needs_review instead of being
            // silently kept stale or silently overwritten. The card body
            // itself is left untouched — only the review flag changes.
            //
            // BUG FIX (2026-07-01, senior review): this used to derive the new
            // checksum from `cards[0]?.sourceChecksum` — if a regeneration
            // produces ZERO cards (content too short/unparseable to extract
            // any section, or every candidate rejected by OkfVerifier),
            // `cards[0]` is undefined, the checksum falls through to
            // `undefined`, the `if (newChecksum)` guard is falsy, and this
            // UPDATE never runs — a user-edited card whose source became
            // degenerate silently keeps its stale approval_status forever,
            // exactly the "silently kept stale" outcome this mechanism exists
            // to prevent. Callers now pass the checksum explicitly (always
            // known — it's the content hash of what was JUST extracted,
            // regardless of how many cards came out of it).
            if (newSourceChecksum) {
                this.db!.prepare(`
                    UPDATE knowledge_cards SET approval_status = 'needs_review'
                    WHERE pack_id = ? AND user_edited = 1 AND source_checksum != ? AND approval_status != 'needs_review'
                `).run(packId, newSourceChecksum);
            }
            this.db!.prepare('DELETE FROM knowledge_cards WHERE pack_id = ? AND user_edited = 0').run(packId);
            const ins = this.db!.prepare(`
                INSERT INTO knowledge_cards (id, pack_id, source_id, type, title, slug, concept_id, body, body_markdown,
                    source_pages_json, source_sections_json, source_quotes_json, entities_json, tags_json, related_card_ids_json,
                    confidence, generated_from, source_checksum, updated_at, card_version, pii)
                VALUES (@id, @packId, @sourceId, @type, @title, @slug, @conceptId, @body, @bodyMarkdown,
                    @sourcePagesJson, @sourceSectionsJson, @sourceQuotesJson, @entitiesJson, @tagsJson, @relatedCardIdsJson,
                    @confidence, @generatedFrom, @sourceChecksum, CURRENT_TIMESTAMP, @cardVersion, @pii)
                ON CONFLICT(id) DO UPDATE SET
                    body = excluded.body, body_markdown = excluded.body_markdown,
                    source_pages_json = excluded.source_pages_json, source_sections_json = excluded.source_sections_json,
                    source_quotes_json = excluded.source_quotes_json, entities_json = excluded.entities_json,
                    tags_json = excluded.tags_json, related_card_ids_json = excluded.related_card_ids_json,
                    confidence = excluded.confidence, source_checksum = excluded.source_checksum,
                    updated_at = CURRENT_TIMESTAMP, card_version = excluded.card_version, pii = excluded.pii
                WHERE knowledge_cards.user_edited = 0
            `);
            for (const c of cards) {
                ins.run({ ...c, packId, sourceId, bodyMarkdown: c.bodyMarkdown ?? null, pii: c.pii ? 1 : 0 });
            }
        });
        txn();
    }

    public getKnowledgeCardsByPackId(packId: string): any[] {
        if (!this.db) return [];
        return this.db.prepare('SELECT * FROM knowledge_cards WHERE pack_id = ? ORDER BY rowid ASC').all(packId);
    }

    public replaceKnowledgeEntities(packId: string, entities: Array<{
        id: string; slug: string; name: string; type: string; aliasesJson: string;
        description: string; sourceCardIdsJson: string; sourcePagesJson: string;
    }>): void {
        if (!this.db) throw new Error('Database not initialized');
        const txn = this.db.transaction(() => {
            this.db!.prepare('DELETE FROM knowledge_entities WHERE pack_id = ?').run(packId);
            // Defense-in-depth: OkfExtractor.extractEntityCards is the
            // primary dedup boundary (keys by slugify(name), matching this
            // row's id derivation), but a bare INSERT here would abort the
            // WHOLE transaction — including the entities inserted before
            // the colliding row — on any future extraction-side regression
            // that reintroduces a duplicate slug. ON CONFLICT DO UPDATE
            // makes a same-id collision within one pack a harmless
            // last-write-wins merge instead of a thrown exception that
            // silently drops every entity (see the 2026-07-01 "Mercury
            // X1"/"The Mercury X1" incident this fixed at the source).
            const ins = this.db!.prepare(`
                INSERT INTO knowledge_entities (id, pack_id, slug, name, type, aliases_json, description, source_card_ids_json, source_pages_json)
                VALUES (@id, @packId, @slug, @name, @type, @aliasesJson, @description, @sourceCardIdsJson, @sourcePagesJson)
                ON CONFLICT(id) DO UPDATE SET
                    slug = excluded.slug, name = excluded.name, type = excluded.type,
                    aliases_json = excluded.aliases_json, description = excluded.description,
                    source_card_ids_json = excluded.source_card_ids_json, source_pages_json = excluded.source_pages_json
            `);
            for (const e of entities) ins.run({ ...e, packId });
        });
        txn();
    }

    public getKnowledgeEntitiesByPackId(packId: string): any[] {
        if (!this.db) return [];
        return this.db.prepare('SELECT * FROM knowledge_entities WHERE pack_id = ? ORDER BY rowid ASC').all(packId);
    }

    public replaceKnowledgeRelations(packId: string, relations: Array<{
        id: string; subjectId: string; subjectType: string; predicate: string; objectId: string; objectType: string;
        sourceCardIdsJson: string; sourcePagesJson: string; confidence: string;
    }>): void {
        if (!this.db) throw new Error('Database not initialized');
        const txn = this.db.transaction(() => {
            this.db!.prepare('DELETE FROM knowledge_relations WHERE pack_id = ?').run(packId);
            // Defense-in-depth: same reasoning as replaceKnowledgeEntities
            // above — GraphExtractor already dedupes relations by
            // `${subjectId}|${predicate}|${objectId}` before emitting, but a
            // bare INSERT here would still abort the whole transaction (and
            // drop every relation already inserted) on any future
            // extraction-side regression. ON CONFLICT DO UPDATE degrades a
            // same-id collision to a harmless merge instead.
            const ins = this.db!.prepare(`
                INSERT INTO knowledge_relations (id, pack_id, subject_id, subject_type, predicate, object_id, object_type, source_card_ids_json, source_pages_json, confidence)
                VALUES (@id, @packId, @subjectId, @subjectType, @predicate, @objectId, @objectType, @sourceCardIdsJson, @sourcePagesJson, @confidence)
                ON CONFLICT(id) DO UPDATE SET
                    subject_id = excluded.subject_id, subject_type = excluded.subject_type,
                    predicate = excluded.predicate, object_id = excluded.object_id, object_type = excluded.object_type,
                    source_card_ids_json = excluded.source_card_ids_json, source_pages_json = excluded.source_pages_json,
                    confidence = excluded.confidence
            `);
            for (const r of relations) ins.run({ ...r, packId });
        });
        txn();
    }

    public getKnowledgeRelationsByPackId(packId: string): any[] {
        if (!this.db) return [];
        return this.db.prepare('SELECT * FROM knowledge_relations WHERE pack_id = ? ORDER BY rowid ASC').all(packId);
    }

    public upsertKnowledgeIndexVersion(v: {
        id: string; sourceId: string; packId?: string; packVersion: number; contentHash: string;
        embeddingSpace?: string; status: string; errorMessage?: string;
    }): void {
        if (!this.db) throw new Error('Database not initialized');
        this.db.prepare(`
            INSERT INTO knowledge_index_versions (id, source_id, pack_id, pack_version, content_hash, embedding_space, status, error_message, updated_at)
            VALUES (@id, @sourceId, @packId, @packVersion, @contentHash, @embeddingSpace, @status, @errorMessage, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                pack_id = excluded.pack_id, pack_version = excluded.pack_version, content_hash = excluded.content_hash,
                embedding_space = excluded.embedding_space, status = excluded.status, error_message = excluded.error_message,
                updated_at = CURRENT_TIMESTAMP
        `).run({
            id: v.id, sourceId: v.sourceId, packId: v.packId ?? null, packVersion: v.packVersion,
            contentHash: v.contentHash, embeddingSpace: v.embeddingSpace ?? null, status: v.status,
            errorMessage: v.errorMessage ?? null,
        });
    }

    public getKnowledgeIndexVersionBySourceId(sourceId: string): any | null {
        if (!this.db) return null;
        return this.db.prepare('SELECT * FROM knowledge_index_versions WHERE source_id = ? ORDER BY updated_at DESC LIMIT 1').get(sourceId) || null;
    }

    // ── OKF Knowledge Card edit/approval (Phase 6) ──────────────────

    public getKnowledgeCardById(id: string): any | null {
        if (!this.db) return null;
        return this.db.prepare('SELECT * FROM knowledge_cards WHERE id = ?').get(id) || null;
    }

    /**
     * Snapshots the card's CURRENT row into knowledge_card_versions, then
     * applies the edit and marks the card user_edited=1 (so it survives the
     * next regenerate() call's `WHERE user_edited = 0` guard). Called before
     * every edit/approve/reject so the prior state is never lost.
     */
    public snapshotKnowledgeCardVersion(cardId: string, editedBy: string, editReason?: string): void {
        if (!this.db) return;
        const card = this.getKnowledgeCardById(cardId);
        if (!card) return;
        this.db.prepare(`
            INSERT INTO knowledge_card_versions (id, card_id, card_version, title, body, entities_json, tags_json, confidence, edited_by, edit_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            `kcv_${cardId}_v${card.card_version}_${Date.now()}`,
            cardId, card.card_version, card.title, card.body, card.entities_json, card.tags_json, card.confidence,
            editedBy, editReason ?? null,
        );
    }

    public getKnowledgeCardVersions(cardId: string): any[] {
        if (!this.db) return [];
        return this.db.prepare('SELECT * FROM knowledge_card_versions WHERE card_id = ? ORDER BY created_at DESC').all(cardId);
    }

    public updateKnowledgeCard(id: string, updates: {
        title?: string; body?: string; entitiesJson?: string; tagsJson?: string; confidence?: string;
        userEdited?: boolean; approvalStatus?: string;
    }): void {
        if (!this.db) return;
        const sets: string[] = [];
        const values: any[] = [];
        if (updates.title !== undefined) { sets.push('title = ?'); values.push(updates.title); }
        if (updates.body !== undefined) { sets.push('body = ?'); values.push(updates.body); }
        if (updates.entitiesJson !== undefined) { sets.push('entities_json = ?'); values.push(updates.entitiesJson); }
        if (updates.tagsJson !== undefined) { sets.push('tags_json = ?'); values.push(updates.tagsJson); }
        if (updates.confidence !== undefined) { sets.push('confidence = ?'); values.push(updates.confidence); }
        if (updates.userEdited !== undefined) { sets.push('user_edited = ?'); values.push(updates.userEdited ? 1 : 0); }
        if (updates.approvalStatus !== undefined) { sets.push('approval_status = ?'); values.push(updates.approvalStatus); }
        if (sets.length === 0) return;
        sets.push('card_version = card_version + 1', 'updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        this.db.prepare(`UPDATE knowledge_cards SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    // ── Note Sections ─────────────────────────────────────────────

    public getNoteSections(modeId: string): any[] {
        if (!this.db) return [];
        try {
            return this.db.prepare(
                'SELECT * FROM mode_note_sections WHERE mode_id = ? ORDER BY sort_order ASC, created_at ASC'
            ).all(modeId);
        } catch (e) {
            console.error('[DatabaseManager] getNoteSections failed:', e);
            return [];
        }
    }

    public addNoteSection(section: { id: string; modeId: string; title: string; description: string; sortOrder: number }): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                INSERT INTO mode_note_sections (id, mode_id, title, description, sort_order)
                VALUES (?, ?, ?, ?, ?)
            `).run(section.id, section.modeId, section.title, section.description, section.sortOrder);
        } catch (e) {
            console.error('[DatabaseManager] addNoteSection failed:', e);
        }
    }

    public updateNoteSection(id: string, updates: { title?: string; description?: string; sortOrder?: number; compiledPrompt?: string }): void {
        if (!this.db) return;
        try {
            if (updates.title !== undefined) {
                this.db.prepare('UPDATE mode_note_sections SET title = ? WHERE id = ?').run(updates.title, id);
            }
            if (updates.description !== undefined) {
                this.db.prepare('UPDATE mode_note_sections SET description = ? WHERE id = ?').run(updates.description, id);
            }
            if (updates.sortOrder !== undefined) {
                this.db.prepare('UPDATE mode_note_sections SET sort_order = ? WHERE id = ?').run(updates.sortOrder, id);
            }
            if (updates.compiledPrompt !== undefined) {
                try { this.db.prepare('UPDATE mode_note_sections SET compiled_prompt = ? WHERE id = ?').run(updates.compiledPrompt, id); } catch { /* column may not exist on very old DB */ }
            }
        } catch (e) {
            console.error('[DatabaseManager] updateNoteSection failed:', e);
        }
    }

    /** Look up the mode that owns a given note-section id (used by the prompt compiler). */
    public getNoteSectionOwnerMode(sectionId: string): { sectionId: string; modeId: string; title: string; description: string; templateType?: string } | null {
        if (!this.db) return null;
        try {
            const row = this.db.prepare(`
                SELECT s.id as section_id, s.mode_id, s.title, s.description, m.template_type
                FROM mode_note_sections s JOIN modes m ON m.id = s.mode_id
                WHERE s.id = ?
            `).get(sectionId) as any;
            if (!row) return null;
            return { sectionId: row.section_id, modeId: row.mode_id, title: row.title, description: row.description, templateType: row.template_type };
        } catch (e) {
            console.error('[DatabaseManager] getNoteSectionOwnerMode failed:', e);
            return null;
        }
    }

    public deleteNoteSection(id: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM mode_note_sections WHERE id = ?').run(id);
        } catch (e) {
            console.error('[DatabaseManager] deleteNoteSection failed:', e);
        }
    }

    public deleteAllNoteSections(modeId: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM mode_note_sections WHERE mode_id = ?').run(modeId);
        } catch (e) {
            console.error('[DatabaseManager] deleteAllNoteSections failed:', e);
        }
    }

    // ============================================
    // System KV Store (app_state)
    // ============================================

    public getAppState(key: string): string | null {
        if (!this.db) return null;
        try {
            const stmt = this.db.prepare('SELECT value FROM app_state WHERE key = ?');
            const row = stmt.get(key) as { value: string } | undefined;
            return row ? row.value : null;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to get app_state for key: ${key}`, error);
            return null;
        }
    }

    public setAppState(key: string, value: string): void {
        if (!this.db) return;
        try {
            const stmt = this.db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)');
            stmt.run(key, value);
        } catch (error) {
            console.error(`[DatabaseManager] Failed to set app_state for key: ${key}`, error);
        }
    }

    public deleteAppState(key: string): void {
        if (!this.db) return;
        try {
            const stmt = this.db.prepare('DELETE FROM app_state WHERE key = ?');
            stmt.run(key);
        } catch (error) {
            console.error(`[DatabaseManager] Failed to delete app_state for key: ${key}`, error);
        }
    }

    /**
     * One-time migration: Copy existing BLOB embeddings into vec0 virtual tables.
     */
    private migrateExistingEmbeddings(): void {
        if (!this.db) return;

        // Migrate chunk embeddings
        try {
            const chunkRows = this.db.prepare(
                'SELECT id, embedding FROM chunks WHERE embedding IS NOT NULL'
            ).all() as any[];

            if (chunkRows.length > 0) {
                const insert = this.db.prepare(
                    'INSERT OR IGNORE INTO vec_chunks(chunk_id, embedding) VALUES (?, ?)'
                );
                const migrateAll = this.db.transaction(() => {
                    for (const row of chunkRows) {
                        try {
                            insert.run(row.id, row.embedding);
                        } catch (err) {
                            // On mismatch (e.g. mixed 768 and 3072 dims), nullify to re-embed later
                            this.db.prepare('UPDATE chunks SET embedding = NULL WHERE id = ?').run(row.id);
                        }
                    }
                });
                migrateAll();
                console.log(`[DatabaseManager] Migrated ${chunkRows.length} chunk embeddings to vec_chunks`);
            }
        } catch (e) {
            console.error('[DatabaseManager] Failed to migrate chunk embeddings:', e);
        }

        // Migrate summary embeddings
        try {
            const summaryRows = this.db.prepare(
                'SELECT id, embedding FROM chunk_summaries WHERE embedding IS NOT NULL'
            ).all() as any[];

            if (summaryRows.length > 0) {
                const insert = this.db.prepare(
                    'INSERT OR IGNORE INTO vec_summaries(summary_id, embedding) VALUES (?, ?)'
                );
                const migrateAll = this.db.transaction(() => {
                    for (const row of summaryRows) {
                        try {
                            insert.run(row.id, row.embedding);
                        } catch (err) {
                            this.db.prepare('UPDATE chunk_summaries SET embedding = NULL WHERE id = ?').run(row.id);
                        }
                    }
                });
                migrateAll();
                console.log(`[DatabaseManager] Migrated ${summaryRows.length} summary embeddings to vec_summaries`);
            }
        } catch (e) {
            console.error('[DatabaseManager] Failed to migrate summary embeddings:', e);
        }
    }

    /**
     * Known embedding dimension tiers.
     * Used by the v8 migration, delete operations, and table provisioning.
     * When a new provider dimension is encountered at runtime, ensureVecTableForDim() handles it.
     */
    public static readonly KNOWN_DIMS: readonly number[] = [768, 1536, 3072];

    /** Cache: dimensions for which vec0 tables have already been verified/created this session. */
    private ensuredDims = new Set<number>();

    /**
     * Lazily create a per-dimension vec0 table pair if not already present.
     * Called by v8 migration and at runtime when a new embedding dimension is first seen.
     * Uses an in-memory cache to avoid redundant CREATE TABLE IF NOT EXISTS on every insert.
     */
    public ensureVecTableForDim(dim: number): void {
        if (this.ensuredDims.has(dim)) return; // Already verified this session
        if (!this.db) return;
        // Guard against SQL injection: dim must be a positive integer
        if (!Number.isInteger(dim) || dim <= 0 || dim > 100_000) {
            console.error(`[DatabaseManager] Invalid dimension for vec0 table: ${dim}`);
            return;
        }
        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks_${dim} USING vec0(
                    chunk_id INTEGER PRIMARY KEY,
                    embedding float[${dim}]
                );
            `);
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries_${dim} USING vec0(
                    summary_id INTEGER PRIMARY KEY,
                    embedding float[${dim}]
                );
            `);
            this.ensuredDims.add(dim);
            console.log(`[DatabaseManager] Ensured vec0 tables for dim=${dim}`);
        } catch (e) {
            console.error(`[DatabaseManager] Failed to create vec0 tables for dim=${dim}:`, e);
        }
    }

    /**
     * Enumerate every embedding dimension that actually has a vec0 table, unioned
     * with KNOWN_DIMS. Used by delete/clear paths so they cover dims provisioned
     * at runtime via ensureVecTableForDim() — not just the static KNOWN_DIMS list.
     *
     * Without this, a provider that introduced a dimension outside KNOWN_DIMS (e.g.
     * a future model at 1024d) would have its rows created on insert but NEVER
     * deleted, orphaning vec0 rows on re-index/fallback.
     */
    public getExistingVecDims(): number[] {
        const dims = new Set<number>(DatabaseManager.KNOWN_DIMS);
        if (!this.db) return [...dims];
        try {
            const rows = this.db.prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vec_chunks_%'`
            ).all() as { name: string }[];
            for (const r of rows) {
                const m = r.name.match(/^vec_chunks_(\d+)$/);
                if (m) dims.add(Number(m[1]));
            }
        } catch (e) {
            console.warn('[DatabaseManager] getExistingVecDims failed; falling back to KNOWN_DIMS:', e);
        }
        return [...dims];
    }

    /**
     * Check if sqlite-vec is available (any per-dimension vec0 table must exist)
     */
    public hasVecExtension(): boolean {
        if (!this.db) return false;
        try {
            // Check the most common dimension (Ollama 768); any may suffice
            this.db.prepare("SELECT count(*) FROM vec_chunks_768 LIMIT 1").get();
            return true;
        } catch (e) {
            return false;
        }
    }

    // ============================================
    // Public API
    // ============================================

    /**
     * Expose the raw database instance for external managers (e.g. ProfileDatabaseManager).
     */
    public getDb(): Database.Database | null {
        return this.db;
    }

    /**
     * Run `fn` inside a single better-sqlite3 transaction (BEGIN/COMMIT, with
     * automatic ROLLBACK if `fn` throws). Use this to make a multi-statement
     * write sequence atomic ACROSS several DatabaseManager methods that each
     * do their own internal `this.db.transaction(...)` — nested better-sqlite3
     * transactions are savepoint-based, so an inner method's transaction
     * commits to the OUTER one, and a throw anywhere rolls the whole thing
     * back. Without this, e.g. KnowledgePackStore.savePack's four separate
     * writes (pack/cards/entities/relations) + the source-row write can leave
     * a half-written, permanently-stuck pack if one fails mid-sequence (the
     * source's contentHash gate would then skip regeneration forever).
     */
    public runInTransaction<T>(fn: () => T): T {
        if (!this.db) throw new Error('DatabaseManager.runInTransaction: database not initialized');
        return this.db.transaction(fn)();
    }

    /** Path to the SQLite database file on disk. Used by worker threads. */
    public getDbPath(): string {
        return this.dbPath;
    }

    /**
     * Resolved sqlite-vec extension path (without platform file suffix).
     * Used by worker threads that open their own DB connection.
     */
    public getExtPath(): string {
        return this.resolvedExtPath;
    }

    public saveMeeting(meeting: Meeting, startTimeMs: number, durationMs: number) {
        if (!this.db) {
            console.error('[DatabaseManager] DB not initialized');
            return;
        }

        const insertMeeting = this.db.prepare(`
            INSERT OR REPLACE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, calendar_event_id, source, is_processed, summary_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertTranscript = this.db.prepare(`
            INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms)
            VALUES (?, ?, ?, ?)
        `);

        const insertInteraction = this.db.prepare(`
            INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        // Idempotency: the meetings row uses INSERT OR REPLACE, but transcripts
        // and ai_interactions are append-only with autoincrement ids, so a second
        // saveMeeting() for the same id (the normal flow: stopMeeting writes a
        // placeholder snapshot, then processAndSaveMeeting writes the final one —
        // see MeetingPersistence) would APPEND a duplicate copy of every child
        // row. Recovery re-saves and RAG reprocessing would then read doubled
        // transcripts. Clearing the existing children inside the same transaction
        // before re-inserting makes saveMeeting idempotent for a given meeting id.
        const deleteTranscripts = this.db.prepare(`DELETE FROM transcripts WHERE meeting_id = ?`);
        const deleteInteractions = this.db.prepare(`DELETE FROM ai_interactions WHERE meeting_id = ?`);

        const summaryJson = JSON.stringify({
            legacySummary: meeting.summary,
            detailedSummary: meeting.detailedSummary
        });

        const runTransaction = this.db.transaction(() => {
            // 1. Insert Meeting
            insertMeeting.run(
                meeting.id,
                meeting.title,
                startTimeMs,
                durationMs,
                summaryJson,
                meeting.date, // Using the ISO string as created_at for sorting simply
                meeting.calendarEventId || null,
                meeting.source || 'manual',
                meeting.isProcessed ? 1 : 0,
                meeting.summaryStatus || (meeting.isProcessed ? 'completed' : 'queued')
            );

            // 2. Insert Transcript
            // Clear any prior child rows for this meeting first so re-saving the
            // same meeting id (placeholder → final) does not duplicate them.
            deleteTranscripts.run(meeting.id);
            if (meeting.transcript) {
                for (const segment of meeting.transcript) {
                    insertTranscript.run(
                        meeting.id,
                        segment.speaker,
                        segment.text,
                        segment.timestamp
                    );
                }
            }

            // 3. Insert Interactions
            deleteInteractions.run(meeting.id);
            if (meeting.usage) {
                for (const usage of meeting.usage) {
                    let metadata = null;
                    if (usage.items) {
                        metadata = JSON.stringify(usage.items);
                    } else if (usage.type === 'followup_questions' && usage.answer) {
                        // Sometimes answer is the array for questions, or we store it in metadata
                        // In intelligence manager we pushed: { type: 'followup_questions', answer: fullQuestions }
                        // Let's store that 'answer' (array) in metadata for this type
                        if (Array.isArray(usage.answer)) {
                            metadata = JSON.stringify(usage.answer);
                        }
                    }

                    // Normalization
                    const answerText = Array.isArray(usage.answer) ? null : usage.answer || null;
                    const queryText = usage.question || null;

                    insertInteraction.run(
                        meeting.id,
                        usage.type,
                        usage.timestamp,
                        queryText,
                        answerText,
                        metadata
                    );
                }
            }
        });

        try {
            runTransaction();
            console.log(`[DatabaseManager] Successfully saved meeting ${meeting.id}`);
        } catch (err) {
            console.error(`[DatabaseManager] Failed to save meeting ${meeting.id}`, err);
            throw err;
        }
    }

    public updateMeetingTitle(id: string, title: string): boolean {
        if (!this.db) return false;
        try {
            const stmt = this.db.prepare('UPDATE meetings SET title = ? WHERE id = ?');
            const info = stmt.run(title, id);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to update title for meeting ${id}:`, error);
            return false;
        }
    }

    public updateSummaryStatus(id: string, status: SummaryStatus): boolean {
        if (!this.db) return false;
        try {
            const allowed = new Set(['queued', 'chunking', 'summarizing_chunks', 'reducing', 'validating', 'completed', 'failed']);
            if (!allowed.has(status)) return false;
            const info = this.db.prepare('UPDATE meetings SET summary_status = ? WHERE id = ?').run(status, id);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to update summary status for meeting ${id}:`, error);
            return false;
        }
    }

    public getMeetingsWithSummaryStatus(status: SummaryStatus): Array<{ id: string; title: string; summaryStatus: SummaryStatus; date: string }> {
        if (!this.db) return [];
        try {
            const rows = this.db.prepare('SELECT id, title, created_at, summary_status FROM meetings WHERE summary_status = ? ORDER BY created_at DESC').all(status) as Array<{ id: string; title: string; created_at: string; summary_status: SummaryStatus }>;
            return rows.map(row => ({ id: row.id, title: row.title, date: row.created_at, summaryStatus: row.summary_status }));
        } catch (error) {
            console.error(`[DatabaseManager] Failed to get meetings with summary status ${status}:`, error);
            return [];
        }
    }

    public updateMeetingSummary(id: string, updates: { overview?: string, actionItems?: string[], keyPoints?: string[], actionItemsTitle?: string, keyPointsTitle?: string }): boolean {
        if (!this.db) return false;

        try {
            // 1. Get current summary_json
            const row = this.db.prepare('SELECT summary_json FROM meetings WHERE id = ?').get(id) as any;
            if (!row) return false;

            const existingData = JSON.parse(row.summary_json || '{}');
            const currentDetailed = existingData.detailedSummary || {};

            // 2. Merge updates
            const newDetailed = {
                ...currentDetailed,
                ...updates
            };

            // Should likely filter out undefined updates if spread doesn't handle them how we want,
            // but spread over undefined is fine. We want to overwrite if provided.
            // If updates.overview is empty string, it overwrites.
            // If updates.overview is undefined, we use ...updates trick:
            // Actually spread only includes own enumerable properties. If I pass { overview: "new" }, it works.

            // However, we need to be careful not to wipe legacySummary if it exists
            const newData = {
                ...existingData,
                detailedSummary: newDetailed
            };

            const jsonStr = JSON.stringify(newData);

            // 3. Write back
            const stmt = this.db.prepare('UPDATE meetings SET summary_json = ? WHERE id = ?');
            const info = stmt.run(jsonStr, id);
            return info.changes > 0;

        } catch (error) {
            console.error(`[DatabaseManager] Failed to update summary for meeting ${id}:`, error);
            return false;
        }
    }

    /**
     * Replace the entire detailedSummary blob (used by regenerate-notes). Preserves any
     * sibling keys in summary_json (e.g. legacy fields). Also updates the title column when
     * the new summary carries one. summary_status is set to the provided value.
     */
    public replaceDetailedSummary(id: string, detailedSummary: Meeting['detailedSummary'], opts?: { title?: string; summaryStatus?: SummaryStatus }): boolean {
        if (!this.db) return false;
        try {
            const row = this.db.prepare('SELECT summary_json FROM meetings WHERE id = ?').get(id) as any;
            if (!row) return false;
            const existingData = JSON.parse(row.summary_json || '{}');
            const newData = { ...existingData, detailedSummary };
            const jsonStr = JSON.stringify(newData);
            if (opts?.title && opts?.summaryStatus) {
                const info = this.db.prepare('UPDATE meetings SET summary_json = ?, title = ?, summary_status = ? WHERE id = ?').run(jsonStr, opts.title, opts.summaryStatus, id);
                return info.changes > 0;
            }
            if (opts?.summaryStatus) {
                const info = this.db.prepare('UPDATE meetings SET summary_json = ?, summary_status = ? WHERE id = ?').run(jsonStr, opts.summaryStatus, id);
                return info.changes > 0;
            }
            const info = this.db.prepare('UPDATE meetings SET summary_json = ? WHERE id = ?').run(jsonStr, id);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to replace detailed summary for meeting ${id}:`, error);
            return false;
        }
    }

    /**
     * Persist the per-meeting speaker rename map into detailedSummary.speakerLabels.
     * Additive: never touches transcript rows or other summary fields.
     */
    public updateSpeakerLabels(id: string, speakerLabels: Record<string, string>): boolean {
        if (!this.db) return false;
        try {
            const row = this.db.prepare('SELECT summary_json FROM meetings WHERE id = ?').get(id) as any;
            if (!row) return false;
            const existingData = JSON.parse(row.summary_json || '{}');
            // Preserve whatever detailedSummary shape exists (V3, legacy, or none). When it is
            // absent we attach labels to a minimal object WITHOUT inventing empty
            // actionItems/keyPoints arrays that the renderer would treat as "processed but
            // empty" — labels alone is a safe additive blob a later summarize will merge into.
            const currentDetailed = existingData.detailedSummary;
            const newDetailed = currentDetailed && typeof currentDetailed === 'object'
                ? { ...currentDetailed, speakerLabels }
                : { speakerLabels };
            const newData = { ...existingData, detailedSummary: newDetailed };
            const info = this.db.prepare('UPDATE meetings SET summary_json = ? WHERE id = ?').run(JSON.stringify(newData), id);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to update speaker labels for meeting ${id}:`, error);
            return false;
        }
    }

    public getRecentMeetings(limit: number = 50): Meeting[] {
        if (!this.db) return [];

        const stmt = this.db.prepare(`
            SELECT * FROM meetings
            ORDER BY created_at DESC
            LIMIT ?
        `);

        const rows = stmt.all(limit) as any[];

        return rows.map(row => {
            const summaryData = JSON.parse(row.summary_json || '{}');

            // Format duration string if needed, but we typically store ms
            // Let's recreate the 'duration' string "MM:SS" from duration_ms
            const minutes = Math.floor(row.duration_ms / 60000);
            const seconds = Math.floor((row.duration_ms % 60000) / 1000);
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            return {
                id: row.id,
                title: row.title,
                date: row.created_at, // Use the stored ISO string
                duration: durationStr,
                summary: summaryData.legacySummary || '',
                detailedSummary: summaryData.detailedSummary,
                calendarEventId: row.calendar_event_id,
                source: row.source as any,
                summaryStatus: row.summary_status as SummaryStatus | undefined,
                // We don't load full transcript/usage for list view to keep it light
                transcript: [] as any[],
                usage: [] as any[]
            };
        });
    }

    public getMeetingDetails(id: string): Meeting | null {
        if (!this.db) return null;

        const meetingStmt = this.db.prepare('SELECT * FROM meetings WHERE id = ?');
        const meetingRow = meetingStmt.get(id) as any;

        if (!meetingRow) return null;

        // Get Transcript
        const transcriptStmt = this.db.prepare('SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY timestamp_ms ASC');
        const transcriptRows = transcriptStmt.all(id) as any[];

        // Get Usage
        const usageStmt = this.db.prepare('SELECT * FROM ai_interactions WHERE meeting_id = ? ORDER BY timestamp ASC');
        const usageRows = usageStmt.all(id) as any[];

        // Reconstruct
        const summaryData = JSON.parse(meetingRow.summary_json || '{}');
        const minutes = Math.floor(meetingRow.duration_ms / 60000);
        const seconds = Math.floor((meetingRow.duration_ms % 60000) / 1000);
        const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const transcript = transcriptRows.map(row => ({
            speaker: row.speaker,
            text: row.content,
            timestamp: row.timestamp_ms
        }));

        const usage = usageRows.map(row => {
            let items: string[] | undefined;
            let answer = row.ai_response;

            if (row.metadata_json) {
                try {
                    const parsed = JSON.parse(row.metadata_json);
                    if (Array.isArray(parsed)) {
                        items = parsed;
                        // Special case: for 'followup_questions', earlier we treated 'answer' as the array in memory
                        // UI expects appropriate field. If type is 'followup_questions', usually answer is null and items has the questions.
                    }
                } catch (e) { console.warn('[DatabaseManager] Failed to parse metadata_json for interaction:', row?.id, e); }
            }

            return {
                type: row.type,
                timestamp: row.timestamp,
                question: row.user_query,
                answer: answer,
                items: items
            };
        });

        return {
            id: meetingRow.id,
            title: meetingRow.title,
            date: meetingRow.created_at,
            duration: durationStr,
            summary: summaryData.legacySummary || '',
            detailedSummary: summaryData.detailedSummary,
            calendarEventId: meetingRow.calendar_event_id,
            source: meetingRow.source,
            summaryStatus: meetingRow.summary_status as SummaryStatus | undefined,
            transcript: transcript,
            usage: usage
        };
    }

    public deleteMeeting(id: string): boolean {
        if (!this.db) return false;

        try {
            const stmt = this.db.prepare('DELETE FROM meetings WHERE id = ?');
            const info = stmt.run(id);
            console.log(`[DatabaseManager] Deleted meeting ${id}. Changes: ${info.changes}`);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to delete meeting ${id}:`, error);
            return false;
        }
    }

    public getUnprocessedMeetings(): Meeting[] {
        if (!this.db) return [];

        // is_processed = 0 means false
        const stmt = this.db.prepare(`
            SELECT * FROM meetings
            WHERE is_processed = 0
            ORDER BY created_at DESC
        `);

        const rows = stmt.all() as any[];

        return rows.map(row => {
            // Reconstruct minimal meeting object for processing
            // We mainly need ID to fetch transcripts later
            const summaryData = JSON.parse(row.summary_json || '{}');
            const minutes = Math.floor(row.duration_ms / 60000);
            const seconds = Math.floor((row.duration_ms % 60000) / 1000);
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            return {
                id: row.id,
                title: row.title,
                date: row.created_at,
                duration: durationStr,
                summary: summaryData.legacySummary || '',
                detailedSummary: summaryData.detailedSummary,
                calendarEventId: row.calendar_event_id,
                source: row.source,
                isProcessed: false,
                summaryStatus: row.summary_status as SummaryStatus | undefined,
                transcript: [] as any[], // Fetched separately via getMeetingDetails or manually if needed
                usage: [] as any[]
            };
        });
    }

    public clearAllData(): boolean {
        if (!this.db) return false;

        try {
            // Clear all tables atomically (order matters due to foreign keys,
            // but SQLite handles cascades). Using a transaction ensures we never
            // end up in a half-cleared state if one statement fails.
            this.db.transaction(() => {
                this.db!.exec('DELETE FROM embedding_queue');
                this.db!.exec('DELETE FROM chunk_summaries');
                this.db!.exec('DELETE FROM chunks');
                this.db!.exec('DELETE FROM ai_interactions');
                this.db!.exec('DELETE FROM transcripts');
                this.db!.exec('DELETE FROM meetings');
            })();

            console.log('[DatabaseManager] All data cleared from database.');
            return true;
        } catch (error) {
            console.error('[DatabaseManager] Failed to clear all data:', error);
            return false;
        }
    }

    public seedDemoMeeting() {
        if (!this.db) return;

        const demoId = 'demo-meeting';

        // If a demo meeting already exists, only re-seed when it's the older
        // legacy shape. A demo already carrying the V3 detailedSummary
        // (schemaVersion === 3) is left untouched so we don't clobber it on
        // every launch. Older legacy demos are deleted + re-seeded so users
        // pick up the richer V3 cards without a manual reset.
        const existing = this.db.prepare('SELECT summary_json FROM meetings WHERE id = ?').get(demoId) as { summary_json?: string } | undefined;
        if (existing) {
            let isV3Demo = false;
            try {
                const parsed = existing.summary_json ? JSON.parse(existing.summary_json) : null;
                isV3Demo = parsed?.detailedSummary?.schemaVersion === 3;
            } catch { /* corrupt row → treat as legacy, re-seed */ }
            if (isV3Demo) {
                console.log('[DatabaseManager] V3 demo meeting already exists, skipping seed.');
                return;
            }
            console.log('[DatabaseManager] Upgrading legacy demo meeting to V3.');
            this.deleteMeeting(demoId);
        }

        // Set date to today 9:30 AM
        const today = new Date();
        today.setHours(9, 30, 0, 0);

        const durationMs = 300000; // 5 min

        const summaryMarkdown = `# Overview

Natively is a real-time AI meeting assistant designed to help you stay focused, informed, and fast-moving during calls. Get live insights while you speak, instant answers to questions, and structured notes after every meeting.

# Getting Started

### Start a Session
Click **Start Session** from the dashboard.
Join a scheduled meeting and start directly from the meeting notification.

### During a Meeting
- Use the **five quick action buttons** for real-time assistance
- Show or hide Natively at any time:
  - **Mac**: Cmd + B
  - **Windows**: Ctrl + B
- Move the widget anywhere on your screen by hovering over the top pill and dragging

# Main Features

## Five Quick Action Buttons
- **What to answer**: Instantly generates a context-aware response to the current topic.
- **Clarify**: Asks a targeted, senior-level clarifying question to establish constraints.
- **Recap**: Generates a comprehensive summary of the conversation so far.
- **Follow Up Question**: Suggests strategic questions you can ask to drive the conversation.
- **Answer**: Manually trigger a response or use voice input to ask specific questions.

## Meeting Insights (Launcher)
- **Smart Note Taking**: Automatically captures key points, action items, and structured summaries.
- **Summary**: A concise high-level brief of the entire meeting.
- **Transcript**: Full real-time speech-to-text transcript, available during and after the call.
- **Usage**: Track your interaction history and see how Natively assisted you.

## Live Insights
Click **Live Insights** during a call to view:
- Real-time questions and prompts
- Detected keywords and topics
- Context-aware suggestions based on the conversation
- Click any insight to get an instant response.

## AI Chat
- Type your question and press **Enter** or click **Submit**
- Enable **Smart Mode** for advanced reasoning and coding assistance

## Screenshots
- **Full Screen Screenshot**: Cmd + H
- **Selective Screenshot**: Cmd + Shift + H

# Making the Most of Natively

### Custom Context
Upload resumes, project briefs, sales scripts, or other documents to tailor responses to your workflow. (coming soon).

### Language Preferences
Go to **Settings → Language Preferences** to:
- Change input and output language
- Enable real-time translation during calls

### Undetectability
Unlock the **Undetectability** add-on to keep Natively invisible during screen sharing.

# Interface Basics

- **Dashboard**: Start meetings and view recent activity
- **Start Session**: Begin a new meeting instantly
- **Settings**: Configure API keys, language, and visibility
- **History**: Review past meetings, notes, and transcripts

# API Setup

1. Open **Settings**
2. Scroll to **Credentials**
3. Add your API keys:
   - **Gemini**
   - **Groq**
4. To enable real-time transcription, select the location of your **Google Cloud service account JSON file**.

If you don’t already have one, follow the steps below to create it.

# Creating a Google Speech-to-Text Service Account

## 1. Create or Select a Project
- Open **Google Cloud Console**
- Create a new project or select an existing one
- Ensure billing is enabled

## 2. Enable Speech-to-Text API
- Go to **APIs & Services → Library**
- Enable **Speech-to-Text API**

## 3. Create a Service Account
- Navigate to **IAM & Admin → Service Accounts**
- Click **Create Service Account**
- **Name**: natively-stt
- **Description**: optional

## 4. Assign Permissions
- Grant the following role: **Speech-to-Text User** (\`roles/speech.client\`)

## 5. Create a JSON Key
- Open the service account
- Go to **Keys → Add Key → Create new key**
- Select **JSON**
- Download the file

**Once downloaded, return to Settings → Credentials in Natively and select this file to complete setup.**

# Free Google Cloud Credit (New Users)

New Google Cloud accounts receive **$300 in free credits**, valid for 90 days.

To activate:
1. Visit [cloud.google.com](https://cloud.google.com)
2. Click **Get started for free**
3. Sign in with a Google account
4. Add billing details (card required)
5. Activate the free trial

The credit can be used for Speech-to-Text and is sufficient for extended testing and regular usage.

# Support

If you need help with setup or usage, contact us anytime at:
natively.contact@gmail.com`;

        const demoMeeting: Meeting = {
            id: demoId,
            title: "Natively Demo & Guide",
            date: today.toISOString(),
            duration: "5:00",
            summary: "Complete guide to using Natively - your real-time AI meeting assistant.",
            detailedSummary: {
                // schemaVersion: 3 unlocks the full V3 notes layout + all four cards.
                schemaVersion: 3,
                overview: summaryMarkdown,
                actionItems: [],
                keyPoints: [],

                // Summary bullets (blue-dot list at the top of the notes).
                tldr: [
                    "Natively runs live during calls — real-time answers plus structured notes after.",
                    "Five quick actions: What to answer, Clarify, Recap, Follow-up, and Answer.",
                    "Cmd/Ctrl + B hides the widget instantly; screenshots via Cmd + H.",
                ],

                // The mode's note-section template — primary notes layout.
                sectionsV3: [
                    {
                        id: 'sec_getting_started',
                        title: 'Getting started',
                        order: 0,
                        bullets: [
                            { id: 'b1', text: "Click Start Session from the dashboard to begin a call.", confidence: 'high' },
                            { id: 'b2', text: "Show or hide Natively anytime with Cmd + B (Mac) or Ctrl + B (Windows).", confidence: 'high' },
                        ],
                    },
                    {
                        id: 'sec_features',
                        title: 'Key features',
                        order: 1,
                        bullets: [
                            { id: 'b3', text: "Five quick-action buttons give real-time, context-aware assistance.", confidence: 'high' },
                            { id: 'b4', text: "Smart note-taking captures key points, action items, and a structured summary.", confidence: 'medium' },
                        ],
                    },
                    {
                        id: 'sec_setup',
                        title: 'Setup',
                        order: 2,
                        bullets: [
                            { id: 'b5', text: "Add Gemini and Groq API keys under Settings → Credentials.", confidence: 'high' },
                            { id: 'b6', text: "Select a Google Cloud service-account JSON to enable live transcription.", confidence: 'medium' },
                        ],
                    },
                ],

                // CARD 1 — source quality warning (non-benign warnings render).
                sourceQuality: {
                    transcriptCoverage: 0.82,
                    speakerQuality: 'mixed' as const,
                    actionItemConfidence: 'medium' as const,
                    warnings: [
                        "Speaker labels are low quality; verify owners and quotes before sharing.",
                    ],
                },

                // CARD 2 — mode auto-detect suggestion (detected differs from selected, conf ≥ 0.5).
                mode: {
                    selectedModeId: 'mode_general_default',
                    selectedModeName: 'General',
                    selectedTemplateType: 'general',
                    detectedModeId: 'mode_product_demo',
                    detectedModeName: 'Product Demo',
                    detectedConfidence: 0.78,
                    summaryModeUsed: 'general',
                },

                // CARD 3 — cross-meeting recall (stillOpen non-empty).
                crossMeeting: {
                    stillOpen: [
                        "Finish uploading your resume / project brief for tailored answers (from Onboarding).",
                        "Enable Undetectability before your next screen-shared call (from Setup walkthrough).",
                    ],
                },

                // Follow-up draft — exercises the copy / regenerate / tone dropdown row.
                followUpDraft: {
                    type: 'email',
                    subject: "Getting started with Natively",
                    body: "Hi there,\n\nThanks for trying Natively! A quick recap: start a session from the dashboard, use the five quick actions during your call, and press Cmd + B to hide the widget anytime. Notes, transcript, and follow-ups are waiting for you after every meeting.\n\nBest,\nThe Natively team",
                    tone: 'professional',
                },
            },
            transcript: [
                { speaker: 'interviewer', text: "Welcome to Natively! Let me show you how it works.", timestamp: 0 },
                { speaker: 'user', text: "Thanks! I'm excited to try it out.", timestamp: 5000 },
                { speaker: 'interviewer', text: "You have 5 quick action buttons. 'What to answer' listens to the conversation and suggests what you should say.", timestamp: 10000 },
                { speaker: 'user', text: "That sounds helpful for interviews.", timestamp: 18000 },
                { speaker: 'interviewer', text: "Check out the 'How to Use' section in the notes for API setup instructions.", timestamp: 20000 },
                { speaker: 'interviewer', text: "'Clarify' asks a targeted question to get missing constraints. 'Recap' summarizes the entire conversation so far.", timestamp: 22000 },
                { speaker: 'user', text: "What about the other buttons?", timestamp: 30000 },
                { speaker: 'interviewer', text: "'Follow Up Questions' suggests questions you can ask. 'Answer' lets you speak a question and get an instant response.", timestamp: 35000 },
                { speaker: 'user', text: "Can I take screenshots during calls?", timestamp: 45000 },
                { speaker: 'interviewer', text: "Yes! Press Cmd+H for full screen or Cmd+Shift+H to select an area. The AI will analyze it and help you.", timestamp: 50000 },
                { speaker: 'user', text: "How do I hide Natively during screen share?", timestamp: 60000 },
                { speaker: 'interviewer', text: "Press Cmd+B to toggle visibility anytime. You can also enable undetectable mode in settings.", timestamp: 65000 },
                { speaker: 'user', text: "This is amazing. What happens after the call?", timestamp: 75000 },
                { speaker: 'interviewer', text: "You get detailed meeting notes with action items, key points, full transcript, and a log of all AI interactions.", timestamp: 80000 }
            ],
            usage: [
                { type: 'assist', timestamp: 15000, question: 'What features does Natively have?', answer: 'Natively offers 5 quick action buttons, screenshot analysis, real-time transcription, and comprehensive meeting notes.' },
                { type: 'followup', timestamp: 40000, question: 'How do the action buttons work?', answer: 'Each button serves a specific purpose: suggest answers, clarify questions, recap conversations, generate follow-up questions, or get instant voice-to-answer responses.' }
            ],
            isProcessed: true
        };

        this.saveMeeting(demoMeeting, today.getTime(), durationMs);
        console.log('[DatabaseManager] Seeded demo meeting.');
    }
}
