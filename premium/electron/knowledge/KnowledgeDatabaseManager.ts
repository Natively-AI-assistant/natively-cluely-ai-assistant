// electron/knowledge/KnowledgeDatabaseManager.ts
// SQLite CRUD for documents and context_nodes tables

import Database from 'better-sqlite3';
import { ContextNode, KnowledgeDocument, DocType } from './types';

export class KnowledgeDatabaseManager {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        // Enable cascade deletes for the connection lifetime. foreign_keys is a
        // per-connection pragma (OFF by default in SQLite), so setting it once
        // here — not just transiently inside deleteDocumentsByType — guarantees
        // every delete path cascades to dependent rows (aot_results: intro,
        // dossier, negotiation script, gap analysis, mock questions, culture
        // mappings; context_nodes). Without this, re-ingesting a document would
        // orphan its precomputed AOT artifacts and serve stale data.
        try {
            this.db.exec(`PRAGMA foreign_keys = ON;`);
        } catch (e) {
            console.warn('[KnowledgeDB] Failed to enable foreign_keys pragma:', (e as Error)?.message);
        }
    }

    /**
     * Initializes the necessary tables for the Knowledge Engine.
     */
    initializeSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS knowledge_documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                source_uri TEXT NOT NULL,
                structured_data TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS context_nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER,
                source_type TEXT NOT NULL,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                organization TEXT,
                start_date TEXT,
                end_date TEXT,
                duration_months INTEGER DEFAULT 0,
                text_content TEXT NOT NULL,
                tags TEXT NOT NULL,
                embedding BLOB,
                embedding_space TEXT,
                FOREIGN KEY(document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS company_dossiers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_name TEXT UNIQUE NOT NULL,
                last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
                dossier_json TEXT NOT NULL,
                source_trace TEXT,
                ttl_hours INTEGER DEFAULT 24
            );

            -- Resume-derived salary estimate (2026-08-02). Single row: one
            -- active résumé ⇒ one estimate. Previously in-memory only, so a
            -- relaunch emptied the V3 PROFILE_FACT pool until the next
            -- re-upload — "what is my expected salary" regressed to NOT_FOUND
            -- on every cold start. cache_key mirrors the engine's identity
            -- derivation (name|role|company) so a stale row for a replaced
            -- résumé is detected on read, never served.
            CREATE TABLE IF NOT EXISTS salary_estimates (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                cache_key TEXT NOT NULL,
                estimate_json TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS aot_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL,
                result_type TEXT NOT NULL,
                result_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
                UNIQUE(document_id, result_type)
            );

            -- Indexes for fast retrieval
            CREATE INDEX IF NOT EXISTS idx_nodes_source_type ON context_nodes(source_type);
            CREATE INDEX IF NOT EXISTS idx_nodes_doc_id ON context_nodes(document_id);
            CREATE INDEX IF NOT EXISTS idx_dossier_company ON company_dossiers(company_name);
            CREATE INDEX IF NOT EXISTS idx_aot_results_doc ON aot_results(document_id, result_type);
        `);

        // Additive migration for DBs created before embedding_space existed. SQLite has
        // no ADD COLUMN IF NOT EXISTS, so guard with a try/catch (re-run is a no-op).
        // Legacy rows keep embedding_space=NULL → treated as stale and re-embedded on the
        // next ensureEmbeddingSpace() pass (prevents v1-node vs v2-query silent garbage).
        try {
            this.db.exec('ALTER TABLE context_nodes ADD COLUMN embedding_space TEXT');
        } catch (e) {
            // Expected on re-run: "duplicate column name". Re-throw anything else
            // (locked/corrupt DB) so a genuine migration failure is loud, not silent.
            if (!String((e as any)?.message || e).toLowerCase().includes('duplicate column')) throw e;
        }

        // 2026-08-01 (deep-test D1): lossless raw-text column. Same guarded
        // additive-migration pattern as embedding_space above. Legacy rows keep
        // NULL — consumers fall back to re-reading source_uri where possible.
        try {
            this.db.exec('ALTER TABLE knowledge_documents ADD COLUMN raw_text TEXT');
        } catch (e) {
            if (!String((e as any)?.message || e).toLowerCase().includes('duplicate column')) throw e;
        }

        console.log('[KnowledgeDB] Schema initialized successfully');
    }

    // ============================================
    // Documents CRUD
    // ============================================

    saveDocument(doc: Omit<KnowledgeDocument, 'id' | 'created_at'>): number {
        const stmt = this.db.prepare(`
            INSERT INTO knowledge_documents (type, source_uri, structured_data, raw_text)
            VALUES (?, ?, ?, ?)
        `);
        const info = stmt.run(
            doc.type,
            doc.source_uri,
            JSON.stringify(doc.structured_data),
            doc.raw_text ?? null
        );
        console.log(`[KnowledgeDB] Document saved: ${doc.type} (ID: ${info.lastInsertRowid})`);
        return info.lastInsertRowid as number;
    }

    /**
     * Overwrite the structured_data JSON for an existing document in place.
     * Used by the v1→v2 skills migration to persist categorized skills without
     * re-ingesting (which would drop and re-embed all nodes).
     */
    updateDocumentStructuredData(id: number, structuredData: any): void {
        this.db.prepare('UPDATE knowledge_documents SET structured_data = ? WHERE id = ?')
            .run(JSON.stringify(structuredData), id);
    }

    getDocumentByType(type: DocType): KnowledgeDocument | null {
        // For Resume and active JD, we typically assume the most recent one is active
        const row = this.db.prepare('SELECT * FROM knowledge_documents WHERE type = ? ORDER BY created_at DESC LIMIT 1').get(type) as any;
        if (!row) return null;
        // Bug fix 2026-07-28: an unguarded JSON.parse here threw on a single
        // corrupted row (disk corruption, a bad migration, a manual DB edit),
        // and this is called unconditionally from the KnowledgeOrchestrator
        // constructor's refreshCache() — so one bad row permanently disabled
        // Profile Intelligence on every app launch with no recovery path
        // short of manually clearing the DB. Treat a corrupt row as "no
        // active document" instead: the user can just re-upload, and the
        // next successful ingest's deleteDocumentsByType() clears the row.
        try {
            return {
                id: row.id,
                type: row.type as DocType,
                source_uri: row.source_uri,
                structured_data: JSON.parse(row.structured_data),
                raw_text: typeof row.raw_text === 'string' ? row.raw_text : null,
                created_at: row.created_at
            };
        } catch (e) {
            console.error(`[KnowledgeDB] Corrupt structured_data for document id=${row.id} type=${type}:`, (e as Error)?.message);
            return null;
        }
    }

    deleteDocumentsByType(type: DocType): void {
        // foreign_keys is already enabled for the connection's lifetime in
        // the constructor (see its comment) — re-setting it here on every
        // delete was redundant dead duplication.
        const stmt = this.db.prepare('DELETE FROM knowledge_documents WHERE type = ?');
        stmt.run(type);
        console.log(`[KnowledgeDB] All documents of type ${type} deleted`);
    }

    // ============================================
    // Context Nodes CRUD
    // ============================================

    saveNodes(nodes: ContextNode[], documentId?: number): void {
        const insert = this.db.prepare(`
            INSERT INTO context_nodes (
                document_id, source_type, category, title, organization,
                start_date, end_date, duration_months, text_content, tags, embedding, embedding_space
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertAll = this.db.transaction(() => {
            for (const node of nodes) {
                insert.run(
                    documentId || null,
                    node.source_type,
                    node.category,
                    node.title,
                    node.organization || null,
                    node.start_date || null,
                    node.end_date || null,
                    node.duration_months || 0,
                    node.text_content,
                    JSON.stringify(node.tags),
                    node.embedding ? this.embeddingToBlob(node.embedding) : null,
                    node.embedding_space ?? null
                );
            }
        });

        insertAll();
        console.log(`[KnowledgeDB] Saved ${nodes.length} nodes for Document ID: ${documentId}`);
    }

    /**
     * Update a single node's embedding + space in place (used by the re-embed pass
     * when the active embedding space changes, e.g. gemini-embedding-001 → -2).
     */
    updateNodeEmbedding(nodeId: number, embedding: number[], space: string): void {
        this.db.prepare(
            'UPDATE context_nodes SET embedding = ?, embedding_space = ? WHERE id = ?'
        ).run(this.embeddingToBlob(embedding), space, nodeId);
    }

    /**
     * Count nodes whose embedding space differs from the active one OR that have an
     * embedding but no recorded space (legacy). These would otherwise be cosine-compared
     * across incompatible spaces — the v1/v2 silent-garbage hazard.
     */
    getNodesNeedingReembed(activeSpace: string): ContextNode[] {
        const rows = this.db.prepare(`
            SELECT * FROM context_nodes
            WHERE embedding IS NOT NULL
              AND (embedding_space IS NULL OR embedding_space != ?)
            ORDER BY id ASC
        `).all(activeSpace) as any[];
        return rows.map(row => this.mapRowToContextNode(row)).filter((n): n is ContextNode => n !== null);
    }

    getNodesBySourceType(sourceType: DocType): ContextNode[] {
        const rows = this.db.prepare('SELECT * FROM context_nodes WHERE source_type = ? ORDER BY id ASC').all(sourceType) as any[];
        return rows.map(row => this.mapRowToContextNode(row)).filter((n): n is ContextNode => n !== null);
    }

    getAllNodes(): ContextNode[] {
        const rows = this.db.prepare('SELECT * FROM context_nodes ORDER BY id ASC').all() as any[];
        return rows.map(row => this.mapRowToContextNode(row)).filter((n): n is ContextNode => n !== null);
    }

    getNodeCount(sourceType?: DocType): number {
        if (sourceType) {
            const row = this.db.prepare('SELECT COUNT(*) as count FROM context_nodes WHERE source_type = ?').get(sourceType) as any;
            return row.count;
        }
        const row = this.db.prepare('SELECT COUNT(*) as count FROM context_nodes').get() as any;
        return row.count;
    }

    // ============================================
    // Salary Estimate (single row)
    // ============================================

    saveSalaryEstimate(cacheKey: string, estimate: any): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO salary_estimates (id, cache_key, estimate_json, updated_at)
            VALUES (1, ?, ?, datetime('now'))
        `);
        stmt.run(cacheKey, JSON.stringify(estimate));
        console.log('[KnowledgeDB] Salary estimate persisted');
    }

    getSalaryEstimate(): { cacheKey: string; estimate: any } | null {
        const row = this.db.prepare('SELECT cache_key, estimate_json FROM salary_estimates WHERE id = 1').get() as any;
        if (!row) return null;
        // Same corrupt-row hazard as getDossier: degrade to "no persisted
        // estimate" (the caller recomputes on next ingest) instead of throwing.
        try {
            return { cacheKey: row.cache_key, estimate: JSON.parse(row.estimate_json) };
        } catch {
            return null;
        }
    }

    // ============================================
    // Company Dossiers CRUD
    // ============================================

    saveDossier(companyName: string, dossierJson: any, sourceTrace: string[]): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO company_dossiers (company_name, last_checked, dossier_json, source_trace)
            VALUES (?, datetime('now'), ?, ?)
        `);
        stmt.run(companyName.toLowerCase().trim(), JSON.stringify(dossierJson), JSON.stringify(sourceTrace));
        console.log(`[KnowledgeDB] Dossier saved for: ${companyName}`);
    }

    getDossier(companyName: string): any | null {
        const row = this.db.prepare('SELECT * FROM company_dossiers WHERE company_name = ?').get(companyName.toLowerCase().trim()) as any;
        if (!row) return null;
        // Same corrupt-row hazard as getDocumentByType: degrade to "no
        // cached dossier" (the caller re-fetches) instead of throwing.
        try {
            return {
                id: row.id,
                company_name: row.company_name,
                last_checked: row.last_checked,
                dossier: JSON.parse(row.dossier_json),
                sources: JSON.parse(row.source_trace || '[]'),
                ttl_hours: row.ttl_hours
            };
        } catch (e) {
            console.error(`[KnowledgeDB] Corrupt dossier_json for company=${row.company_name}:`, (e as Error)?.message);
            return null;
        }
    }

    isDossierStale(companyName: string): boolean {
        const row = this.db.prepare(
            `SELECT last_checked, ttl_hours FROM company_dossiers WHERE company_name = ?`
        ).get(companyName.toLowerCase().trim()) as any;
        if (!row) return true;

        const lastChecked = new Date(row.last_checked).getTime();
        const ttlMs = (row.ttl_hours || 24) * 60 * 60 * 1000;
        return Date.now() - lastChecked > ttlMs;
    }

    deleteDossier(companyName: string): void {
        this.db.prepare('DELETE FROM company_dossiers WHERE company_name = ?').run(companyName.toLowerCase().trim());
        console.log(`[KnowledgeDB] Dossier deleted for: ${companyName}`);
    }

    // ============================================
    // Helpers
    // ============================================

    /**
     * Bug fix 2026-07-28: this had the same unguarded-JSON.parse hazard as
     * getDocumentByType, but with a LARGER blast radius — it's called from
     * inside rows.map() in getAllNodes/getNodesBySourceType/
     * getNodesNeedingReembed, so one corrupted `tags` value used to abort
     * the ENTIRE node list (getAllNodes() feeds refreshCache()'s cache
     * unconditionally), not just one document. Returns null for a corrupt
     * row instead of throwing; callers filter nulls out so the rest of the
     * corpus still loads.
     */
    private mapRowToContextNode(row: any): ContextNode | null {
        let tags: string[];
        try {
            tags = JSON.parse(row.tags || '[]');
        } catch (e) {
            console.error(`[KnowledgeDB] Corrupt tags JSON for context_node id=${row.id}; skipping this node:`, (e as Error)?.message);
            return null;
        }
        return {
            id: row.id,
            document_id: row.document_id,
            source_type: row.source_type as DocType,
            category: row.category,
            title: row.title,
            organization: row.organization,
            start_date: row.start_date,
            end_date: row.end_date,
            duration_months: row.duration_months,
            text_content: row.text_content,
            tags,
            embedding: row.embedding ? this.blobToEmbedding(row.embedding) : undefined,
            embedding_space: row.embedding_space ?? undefined
        };
    }

    private embeddingToBlob(embedding: number[]): Buffer {
        const buffer = Buffer.alloc(embedding.length * 4);
        for (let i = 0; i < embedding.length; i++) {
            buffer.writeFloatLE(embedding[i], i * 4);
        }
        return buffer;
    }

    private blobToEmbedding(blob: Buffer): number[] {
        const embedding: number[] = [];
        for (let i = 0; i < blob.length; i += 4) {
            embedding.push(blob.readFloatLE(i));
        }
        return embedding;
    }

    // ============================================
    // AOT Results CRUD
    // ============================================

    saveNegotiationScript(documentId: number, script: any): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'negotiation_script', ?)
        `);
        stmt.run(documentId, JSON.stringify(script));
        console.log(`[KnowledgeDB] Negotiation script saved for doc ID: ${documentId}`);
    }

    getNegotiationScript(documentId: number): any | null {
        const row = this.db.prepare(
            `SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'negotiation_script'`
        ).get(documentId) as any;
        if (!row) return null;
        try {
            return JSON.parse(row.result_json);
        } catch (e) {
            console.error(`[KnowledgeDB] Corrupt negotiation_script JSON for document_id=${documentId}:`, (e as Error)?.message);
            return null;
        }
    }

    saveCoverLetter(documentId: number, letter: any): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'cover_letter', ?)
        `);
        stmt.run(documentId, JSON.stringify(letter));
        console.log(`[KnowledgeDB] Cover letter saved for doc ID: ${documentId}`);
    }

    getCoverLetter(documentId: number): any | null {
        const row = this.db.prepare(
            `SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'cover_letter'`
        ).get(documentId) as any;
        if (!row) return null;
        try {
            return JSON.parse(row.result_json);
        } catch (e) {
            console.error(`[KnowledgeDB] Corrupt cover_letter JSON for document_id=${documentId}:`, (e as Error)?.message);
            return null;
        }
    }

    saveGapAnalysis(documentId: number, analysis: any): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'gap_analysis', ?)
        `);
        stmt.run(documentId, JSON.stringify(analysis));
        console.log(`[KnowledgeDB] Gap analysis saved for doc ID: ${documentId}`);
    }

    getGapAnalysis(documentId: number): any | null {
        const row = this.db.prepare(
            `SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'gap_analysis'`
        ).get(documentId) as any;
        if (!row) return null;
        try {
            return JSON.parse(row.result_json);
        } catch (e) {
            console.error(`[KnowledgeDB] Corrupt gap_analysis JSON for document_id=${documentId}:`, (e as Error)?.message);
            return null;
        }
    }

    saveMockQuestions(documentId: number, questions: any): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'mock_questions', ?)
        `);
        stmt.run(documentId, JSON.stringify(questions));
        console.log(`[KnowledgeDB] Mock questions saved for doc ID: ${documentId}`);
    }

    getMockQuestions(documentId: number): any | null {
        const row = this.db.prepare(
            `SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'mock_questions'`
        ).get(documentId) as any;
        if (!row) return null;
        try {
            return JSON.parse(row.result_json);
        } catch (e) {
            console.error(`[KnowledgeDB] Corrupt mock_questions JSON for document_id=${documentId}:`, (e as Error)?.message);
            return null;
        }
    }

    saveCultureMappings(documentId: number, mappings: any): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'culture_mappings', ?)
        `);
        stmt.run(documentId, JSON.stringify(mappings));
        console.log(`[KnowledgeDB] Culture mappings saved for doc ID: ${documentId}`);
    }

    getCultureMappings(documentId: number): any | null {
        const row = this.db.prepare(
            `SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'culture_mappings'`
        ).get(documentId) as any;
        if (!row) return null;
        try {
            return JSON.parse(row.result_json);
        } catch (e) {
            console.error(`[KnowledgeDB] Corrupt culture_mappings JSON for document_id=${documentId}:`, (e as Error)?.message);
            return null;
        }
    }

    saveIntro(documentId: number, intro: string): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'intro', ?)
        `);
        stmt.run(documentId, JSON.stringify({ intro }));
        console.log(`[KnowledgeDB] Intro saved for doc ID: ${documentId}`);
    }

    getIntro(documentId: number): string | null {
        const row = this.db.prepare(
            `SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'intro'`
        ).get(documentId) as any;
        if (!row) return null;
        try {
            const parsed = JSON.parse(row.result_json);
            return typeof parsed?.intro === 'string' ? parsed.intro : null;
        } catch {
            return null;
        }
    }

    deleteAOTResults(documentId: number): void {
        this.db.prepare('DELETE FROM aot_results WHERE document_id = ?').run(documentId);
        console.log(`[KnowledgeDB] AOT results deleted for doc ID: ${documentId}`);
    }
}
