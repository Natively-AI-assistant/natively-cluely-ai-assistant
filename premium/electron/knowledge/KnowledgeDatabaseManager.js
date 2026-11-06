// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var KnowledgeDatabaseManager = class {
    db;
    constructor(db) {
        this.db = db;
        try {
            this.db.exec(`PRAGMA foreign_keys = ON;`);
        }
        catch (e) {
            console.warn("[KnowledgeDB] Failed to enable foreign_keys pragma:", e?.message);
        }
    }
    /**
     * Initializes the necessary tables for the Knowledge Engine.
     */
    initializeSchema() {
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
            -- active r\xE9sum\xE9 \u21D2 one estimate. Previously in-memory only, so a
            -- relaunch emptied the V3 PROFILE_FACT pool until the next
            -- re-upload \u2014 "what is my expected salary" regressed to NOT_FOUND
            -- on every cold start. cache_key mirrors the engine's identity
            -- derivation (name|role|company) so a stale row for a replaced
            -- r\xE9sum\xE9 is detected on read, never served.
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
        try {
            this.db.exec("ALTER TABLE context_nodes ADD COLUMN embedding_space TEXT");
        }
        catch (e) {
            if (!String(e?.message || e).toLowerCase().includes("duplicate column"))
                throw e;
        }
        try {
            this.db.exec("ALTER TABLE knowledge_documents ADD COLUMN raw_text TEXT");
        }
        catch (e) {
            if (!String(e?.message || e).toLowerCase().includes("duplicate column"))
                throw e;
        }
        console.log("[KnowledgeDB] Schema initialized successfully");
    }
    // ============================================
    // Documents CRUD
    // ============================================
    saveDocument(doc) {
        const stmt = this.db.prepare(`
            INSERT INTO knowledge_documents (type, source_uri, structured_data, raw_text)
            VALUES (?, ?, ?, ?)
        `);
        const info = stmt.run(doc.type, doc.source_uri, JSON.stringify(doc.structured_data), doc.raw_text ?? null);
        console.log(`[KnowledgeDB] Document saved: ${doc.type} (ID: ${info.lastInsertRowid})`);
        return info.lastInsertRowid;
    }
    /**
     * Overwrite the structured_data JSON for an existing document in place.
     * Used by the v1→v2 skills migration to persist categorized skills without
     * re-ingesting (which would drop and re-embed all nodes).
     */
    updateDocumentStructuredData(id, structuredData) {
        this.db.prepare("UPDATE knowledge_documents SET structured_data = ? WHERE id = ?").run(JSON.stringify(structuredData), id);
    }
    getDocumentByType(type) {
        const row = this.db.prepare("SELECT * FROM knowledge_documents WHERE type = ? ORDER BY created_at DESC LIMIT 1").get(type);
        if (!row)
            return null;
        try {
            return {
                id: row.id,
                type: row.type,
                source_uri: row.source_uri,
                structured_data: JSON.parse(row.structured_data),
                raw_text: typeof row.raw_text === "string" ? row.raw_text : null,
                created_at: row.created_at
            };
        }
        catch (e) {
            console.error(`[KnowledgeDB] Corrupt structured_data for document id=${row.id} type=${type}:`, e?.message);
            return null;
        }
    }
    deleteDocumentsByType(type) {
        const stmt = this.db.prepare("DELETE FROM knowledge_documents WHERE type = ?");
        stmt.run(type);
        console.log(`[KnowledgeDB] All documents of type ${type} deleted`);
    }
    // ============================================
    // Context Nodes CRUD
    // ============================================
    saveNodes(nodes, documentId) {
        const insert = this.db.prepare(`
            INSERT INTO context_nodes (
                document_id, source_type, category, title, organization,
                start_date, end_date, duration_months, text_content, tags, embedding, embedding_space
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertAll = this.db.transaction(() => {
            for (const node of nodes) {
                insert.run(documentId || null, node.source_type, node.category, node.title, node.organization || null, node.start_date || null, node.end_date || null, node.duration_months || 0, node.text_content, JSON.stringify(node.tags), node.embedding ? this.embeddingToBlob(node.embedding) : null, node.embedding_space ?? null);
            }
        });
        insertAll();
        console.log(`[KnowledgeDB] Saved ${nodes.length} nodes for Document ID: ${documentId}`);
    }
    /**
     * Update a single node's embedding + space in place (used by the re-embed pass
     * when the active embedding space changes, e.g. gemini-embedding-001 → -2).
     */
    updateNodeEmbedding(nodeId, embedding, space) {
        this.db.prepare("UPDATE context_nodes SET embedding = ?, embedding_space = ? WHERE id = ?").run(this.embeddingToBlob(embedding), space, nodeId);
    }
    /**
     * Count nodes whose embedding space differs from the active one OR that have an
     * embedding but no recorded space (legacy). These would otherwise be cosine-compared
     * across incompatible spaces — the v1/v2 silent-garbage hazard.
     */
    getNodesNeedingReembed(activeSpace) {
        const rows = this.db.prepare(`
            SELECT * FROM context_nodes
            WHERE embedding IS NOT NULL
              AND (embedding_space IS NULL OR embedding_space != ?)
            ORDER BY id ASC
        `).all(activeSpace);
        return rows.map((row) => this.mapRowToContextNode(row)).filter((n) => n !== null);
    }
    getNodesBySourceType(sourceType) {
        const rows = this.db.prepare("SELECT * FROM context_nodes WHERE source_type = ? ORDER BY id ASC").all(sourceType);
        return rows.map((row) => this.mapRowToContextNode(row)).filter((n) => n !== null);
    }
    getAllNodes() {
        const rows = this.db.prepare("SELECT * FROM context_nodes ORDER BY id ASC").all();
        return rows.map((row) => this.mapRowToContextNode(row)).filter((n) => n !== null);
    }
    getNodeCount(sourceType) {
        if (sourceType) {
            const row2 = this.db.prepare("SELECT COUNT(*) as count FROM context_nodes WHERE source_type = ?").get(sourceType);
            return row2.count;
        }
        const row = this.db.prepare("SELECT COUNT(*) as count FROM context_nodes").get();
        return row.count;
    }
    // ============================================
    // Salary Estimate (single row)
    // ============================================
    saveSalaryEstimate(cacheKey, estimate) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO salary_estimates (id, cache_key, estimate_json, updated_at)
            VALUES (1, ?, ?, datetime('now'))
        `);
        stmt.run(cacheKey, JSON.stringify(estimate));
        console.log("[KnowledgeDB] Salary estimate persisted");
    }
    getSalaryEstimate() {
        const row = this.db.prepare("SELECT cache_key, estimate_json FROM salary_estimates WHERE id = 1").get();
        if (!row)
            return null;
        try {
            return { cacheKey: row.cache_key, estimate: JSON.parse(row.estimate_json) };
        }
        catch {
            return null;
        }
    }
    // ============================================
    // Company Dossiers CRUD
    // ============================================
    saveDossier(companyName, dossierJson, sourceTrace) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO company_dossiers (company_name, last_checked, dossier_json, source_trace)
            VALUES (?, datetime('now'), ?, ?)
        `);
        stmt.run(companyName.toLowerCase().trim(), JSON.stringify(dossierJson), JSON.stringify(sourceTrace));
        console.log(`[KnowledgeDB] Dossier saved for: ${companyName}`);
    }
    getDossier(companyName) {
        const row = this.db.prepare("SELECT * FROM company_dossiers WHERE company_name = ?").get(companyName.toLowerCase().trim());
        if (!row)
            return null;
        try {
            return {
                id: row.id,
                company_name: row.company_name,
                last_checked: row.last_checked,
                dossier: JSON.parse(row.dossier_json),
                sources: JSON.parse(row.source_trace || "[]"),
                ttl_hours: row.ttl_hours
            };
        }
        catch (e) {
            console.error(`[KnowledgeDB] Corrupt dossier_json for company=${row.company_name}:`, e?.message);
            return null;
        }
    }
    isDossierStale(companyName) {
        const row = this.db.prepare(`SELECT last_checked, ttl_hours FROM company_dossiers WHERE company_name = ?`).get(companyName.toLowerCase().trim());
        if (!row)
            return true;
        const lastChecked = new Date(row.last_checked).getTime();
        const ttlMs = (row.ttl_hours || 24) * 60 * 60 * 1e3;
        return Date.now() - lastChecked > ttlMs;
    }
    deleteDossier(companyName) {
        this.db.prepare("DELETE FROM company_dossiers WHERE company_name = ?").run(companyName.toLowerCase().trim());
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
    mapRowToContextNode(row) {
        let tags;
        try {
            tags = JSON.parse(row.tags || "[]");
        }
        catch (e) {
            console.error(`[KnowledgeDB] Corrupt tags JSON for context_node id=${row.id}; skipping this node:`, e?.message);
            return null;
        }
        return {
            id: row.id,
            document_id: row.document_id,
            source_type: row.source_type,
            category: row.category,
            title: row.title,
            organization: row.organization,
            start_date: row.start_date,
            end_date: row.end_date,
            duration_months: row.duration_months,
            text_content: row.text_content,
            tags,
            embedding: row.embedding ? this.blobToEmbedding(row.embedding) : void 0,
            embedding_space: row.embedding_space ?? void 0
        };
    }
    embeddingToBlob(embedding) {
        const buffer = Buffer.alloc(embedding.length * 4);
        for (let i = 0; i < embedding.length; i++) {
            buffer.writeFloatLE(embedding[i], i * 4);
        }
        return buffer;
    }
    blobToEmbedding(blob) {
        const embedding = [];
        for (let i = 0; i < blob.length; i += 4) {
            embedding.push(blob.readFloatLE(i));
        }
        return embedding;
    }
    // ============================================
    // AOT Results CRUD
    // ============================================
    saveNegotiationScript(documentId, script) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'negotiation_script', ?)
        `);
        stmt.run(documentId, JSON.stringify(script));
        console.log(`[KnowledgeDB] Negotiation script saved for doc ID: ${documentId}`);
    }
    getNegotiationScript(documentId) {
        const row = this.db.prepare(`SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'negotiation_script'`).get(documentId);
        if (!row)
            return null;
        try {
            return JSON.parse(row.result_json);
        }
        catch (e) {
            console.error(`[KnowledgeDB] Corrupt negotiation_script JSON for document_id=${documentId}:`, e?.message);
            return null;
        }
    }
    saveCoverLetter(documentId, letter) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'cover_letter', ?)
        `);
        stmt.run(documentId, JSON.stringify(letter));
        console.log(`[KnowledgeDB] Cover letter saved for doc ID: ${documentId}`);
    }
    getCoverLetter(documentId) {
        const row = this.db.prepare(`SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'cover_letter'`).get(documentId);
        if (!row)
            return null;
        try {
            return JSON.parse(row.result_json);
        }
        catch (e) {
            console.error(`[KnowledgeDB] Corrupt cover_letter JSON for document_id=${documentId}:`, e?.message);
            return null;
        }
    }
    saveGapAnalysis(documentId, analysis) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'gap_analysis', ?)
        `);
        stmt.run(documentId, JSON.stringify(analysis));
        console.log(`[KnowledgeDB] Gap analysis saved for doc ID: ${documentId}`);
    }
    getGapAnalysis(documentId) {
        const row = this.db.prepare(`SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'gap_analysis'`).get(documentId);
        if (!row)
            return null;
        try {
            return JSON.parse(row.result_json);
        }
        catch (e) {
            console.error(`[KnowledgeDB] Corrupt gap_analysis JSON for document_id=${documentId}:`, e?.message);
            return null;
        }
    }
    saveMockQuestions(documentId, questions) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'mock_questions', ?)
        `);
        stmt.run(documentId, JSON.stringify(questions));
        console.log(`[KnowledgeDB] Mock questions saved for doc ID: ${documentId}`);
    }
    getMockQuestions(documentId) {
        const row = this.db.prepare(`SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'mock_questions'`).get(documentId);
        if (!row)
            return null;
        try {
            return JSON.parse(row.result_json);
        }
        catch (e) {
            console.error(`[KnowledgeDB] Corrupt mock_questions JSON for document_id=${documentId}:`, e?.message);
            return null;
        }
    }
    saveCultureMappings(documentId, mappings) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'culture_mappings', ?)
        `);
        stmt.run(documentId, JSON.stringify(mappings));
        console.log(`[KnowledgeDB] Culture mappings saved for doc ID: ${documentId}`);
    }
    getCultureMappings(documentId) {
        const row = this.db.prepare(`SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'culture_mappings'`).get(documentId);
        if (!row)
            return null;
        try {
            return JSON.parse(row.result_json);
        }
        catch (e) {
            console.error(`[KnowledgeDB] Corrupt culture_mappings JSON for document_id=${documentId}:`, e?.message);
            return null;
        }
    }
    saveIntro(documentId, intro) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO aot_results (document_id, result_type, result_json)
            VALUES (?, 'intro', ?)
        `);
        stmt.run(documentId, JSON.stringify({ intro }));
        console.log(`[KnowledgeDB] Intro saved for doc ID: ${documentId}`);
    }
    getIntro(documentId) {
        const row = this.db.prepare(`SELECT result_json FROM aot_results WHERE document_id = ? AND result_type = 'intro'`).get(documentId);
        if (!row)
            return null;
        try {
            const parsed = JSON.parse(row.result_json);
            return typeof parsed?.intro === "string" ? parsed.intro : null;
        }
        catch {
            return null;
        }
    }
    deleteAOTResults(documentId) {
        this.db.prepare("DELETE FROM aot_results WHERE document_id = ?").run(documentId);
        console.log(`[KnowledgeDB] AOT results deleted for doc ID: ${documentId}`);
    }
};
export { KnowledgeDatabaseManager };
