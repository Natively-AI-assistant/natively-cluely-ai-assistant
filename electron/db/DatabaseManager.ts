
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import * as sqliteVec from 'sqlite-vec';

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
}

export class DatabaseManager {
    private static instance: DatabaseManager;
    private db: Database.Database | null = null;
    private dbPath: string;

    private constructor() {
        const userDataPath = app.getPath('userData');
        this.dbPath = path.join(userDataPath, 'natively.db');
        this.init();
    }

    public static getInstance(): DatabaseManager {
        if (!DatabaseManager.instance) {
            DatabaseManager.instance = new DatabaseManager();
        }
        return DatabaseManager.instance;
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

            // Load sqlite-vec extension for native vector search
            try {
                sqliteVec.load(this.db);
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
                    is_processed INTEGER DEFAULT 1
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
                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
                        chunk_id INTEGER PRIMARY KEY,
                        embedding float[768]
                    );
                `);

                // Create vec0 virtual table for summary embeddings
                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
                        summary_id INTEGER PRIMARY KEY,
                        embedding float[768]
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
                        embedding float[768]
                    );
                `);

                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
                        summary_id INTEGER PRIMARY KEY,
                        embedding float[768]
                    );
                `);

                this.migrateExistingEmbeddings();
                console.log('[DatabaseManager] vec0 virtual tables recreated for flexible dimensions');
                this.db.pragma('user_version = 4');
            } catch (e) {
                console.error('[DatabaseManager] vec0 migration v4 failed:', e);
            }
        }

        // Schema Repair: Ensure vec0 tables exist even if migration was skipped or partially failed
        this.ensureVecTablesExist();

        console.log('[DatabaseManager] Migrations completed.');
    }

    /**
     * Ensure sqlite-vec virtual tables exist.
     * This repairs the schema if migrations were interrupted or failed.
     */
    private ensureVecTablesExist(): void {
        if (!this.db) return;
        try {
            // Check if vec_chunks exists
            const tableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_chunks'").get();
            
            if (!tableExists) {
                console.log('[DatabaseManager] vec_chunks table missing, repairing schema...');
                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
                        chunk_id INTEGER PRIMARY KEY,
                        embedding float[768]
                    );
                `);
                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
                        summary_id INTEGER PRIMARY KEY,
                        embedding float[768]
                    );
                `);
                this.migrateExistingEmbeddings();
                console.log('[DatabaseManager] Schema repaired: vec0 tables created.');
            }
        } catch (e) {
            console.error('[DatabaseManager] Failed to ensure/repair vec0 tables:', e);
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
     * Check if sqlite-vec is available (vec0 tables exist)
     */
    public hasVecExtension(): boolean {
        if (!this.db) return false;
        try {
            this.db.prepare("SELECT count(*) FROM vec_chunks LIMIT 1").get();
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

    public saveMeeting(meeting: Meeting, startTimeMs: number, durationMs: number) {
        if (!this.db) {
            console.error('[DatabaseManager] DB not initialized');
            return;
        }

        const insertMeeting = this.db.prepare(`
            INSERT OR REPLACE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, calendar_event_id, source, is_processed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertTranscript = this.db.prepare(`
            INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms)
            VALUES (?, ?, ?, ?)
        `);

        const insertInteraction = this.db.prepare(`
            INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

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
                meeting.isProcessed ? 1 : 0
            );

            // 2. Insert Transcript
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
                } catch (e) { }
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
                transcript: [] as any[], // Fetched separately via getMeetingDetails or manually if needed
                usage: [] as any[]
            };
        });
    }

    public clearAllData(): boolean {
        if (!this.db) return false;

        try {
            // Clear all tables (order matters due to foreign keys, but SQLite handles with ON DELETE CASCADE)
            this.db.exec('DELETE FROM embedding_queue');
            this.db.exec('DELETE FROM chunk_summaries');
            this.db.exec('DELETE FROM chunks');
            this.db.exec('DELETE FROM ai_interactions');
            this.db.exec('DELETE FROM transcripts');
            this.db.exec('DELETE FROM meetings');

            console.log('[DatabaseManager] All data cleared from database.');
            return true;
        } catch (error) {
            console.error('[DatabaseManager] Failed to clear all data:', error);
            return false;
        }
    }

    public seedDemoMeeting() {
        if (!this.db) return;

        // Check if demo meeting already exists
        const existing = this.db.prepare('SELECT id FROM meetings WHERE id = ?').get('demo-meeting');
        if (existing) {
            console.log('[DatabaseManager] Demo meeting already exists, skipping seed.');
            return;
        }

        // Do NOT flush all meetings. Preserving user data is critical.
        // If we really need to clean up old demo data, we should delete only that ID.
        // this.deleteMeeting('demo-meeting'); // Optional safety if we wanted to force update

        const demoId = 'demo-meeting';

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
- **Shorten**: Refines the last suggested answer to be more concise and natural.
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
                overview: summaryMarkdown,
                actionItems: [],
                keyPoints: []
            },
            transcript: [
                { speaker: 'interviewer', text: "Welcome to Natively! Let me show you how it works.", timestamp: 0 },
                { speaker: 'user', text: "Thanks! I'm excited to try it out.", timestamp: 5000 },
                { speaker: 'interviewer', text: "You have 5 quick action buttons. 'What to answer' listens to the conversation and suggests what you should say.", timestamp: 10000 },
                { speaker: 'user', text: "That sounds helpful for interviews.", timestamp: 18000 },
                { speaker: 'interviewer', text: "Check out the 'How to Use' section in the notes for API setup instructions.", timestamp: 20000 },
                { speaker: 'interviewer', text: "'Shorten' condenses the last response. 'Recap' summarizes the entire conversation so far.", timestamp: 22000 },
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
                { type: 'followup', timestamp: 40000, question: 'How do the action buttons work?', answer: 'Each button serves a specific purpose: suggest answers, shorten responses, recap conversations, generate follow-up questions, or get instant voice-to-answer responses.' }
            ],
            isProcessed: true
        };

        this.saveMeeting(demoMeeting, today.getTime(), durationMs);
        console.log('[DatabaseManager] Seeded demo meeting.');
    }
}
