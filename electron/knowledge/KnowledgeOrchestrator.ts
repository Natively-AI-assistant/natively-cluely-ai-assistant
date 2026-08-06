// electron/knowledge/KnowledgeOrchestrator.ts
//
// OSS reimplementation of the premium KnowledgeOrchestrator: the coordinator for
// resume / JD / reference document ingestion, structured extraction, chunked
// embedding, and semantic retrieval. Storage/retrieval delegate entirely to the
// KnowledgeDatabaseManager (knowledge_documents / knowledge_chunks, migration v26).
//
// Injected function surface (wired by main.ts): the orchestrator itself does no
// LLM/embedding I/O — main.ts hands it embedFn / embedQueryFn / generateContentFn
// / activeSpaceFn so this module has no dependency on the provider stack or the
// RAG pipeline. Every setter is optional-tolerant: main.ts guards most with
// `typeof === 'function'`, but they all exist so the wiring block runs clean.
//
// Document parsing reuses electron/services/SafeDocumentTextExtractor (the same
// PDF/DOCX/TXT/MD path the Modes upload trusts) — no second parser to drift.
//
// Premium-only surfaces (negotiation script, cover letter, company research) are
// STUBBED to null: the OSS build exposes the methods so ipcHandlers' calls don't
// throw, but the features are inert.

import { extractSafeDocumentText } from '../services/SafeDocumentTextExtractor';
import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';
import { DocType } from './types';

interface StructuredDocument {
    id?: number;
    source_uri?: string;
    created_at?: string;
    updated_at?: string;
    structured_data: any | null;
}

export interface KnowledgeStatus {
    hasResume: boolean;
    hasJD: boolean;
    activeMode: boolean;
    resumeSummary?: { name?: string; role?: string; totalExperienceYears?: number };
}

export interface ChunkResult {
    text: string;
    similarity: number;
    docType: DocType;
}

type EmbedFn = (text: string) => Promise<number[]>;
type GenerateContentFn = (contents: any[]) => Promise<string>;

// ~500-token chunks with ~200-token overlap, approximated by whitespace words
// (token ≈ word is close enough for retrieval chunk boundaries; the embedder,
// not this splitter, owns exact tokenization).
const CHUNK_WORDS = 500;
const CHUNK_OVERLAP_WORDS = 200;

export class KnowledgeOrchestrator {
    private db: KnowledgeDatabaseManager;

    public activeResume: StructuredDocument = { structured_data: null };
    public activeJD: StructuredDocument = { structured_data: null };
    public customContext: string | null = null;
    public persona: string | null = null;

    private knowledgeMode = false;

    private embedFn: EmbedFn | null = null;
    private embedQueryFn: EmbedFn | null = null;
    private embedWithMetadataFn: ((text: string) => Promise<{ embedding: number[]; space?: string; provider?: string; dimensions?: number }>) | null = null;
    private fastQueryEmbedFn: (() => { dimensions: number | null; space: string | null; embed: (text: string) => Promise<number[] | null> }) | null = null;
    private generateContentFn: GenerateContentFn | null = null;
    private liveCoachingContentFn: GenerateContentFn | null = null;
    private conversationContextProvider: (() => any) | null = null;
    private activeSpaceFn: (() => string | undefined) | null = null;

    constructor(db: KnowledgeDatabaseManager) {
        this.db = db;
        this.loadActiveDocuments();
    }

    // ============================================
    // Injected-function setters (wired in main.ts)
    // ============================================

    setEmbedFn(fn: EmbedFn): void { this.embedFn = fn; }
    setEmbedQueryFn(fn: EmbedFn): void { this.embedQueryFn = fn; }
    setEmbedWithMetadataFn(fn: any): void { this.embedWithMetadataFn = fn; }
    setFastQueryEmbedFn(fn: any): void { this.fastQueryEmbedFn = fn; }
    setGenerateContentFn(fn: GenerateContentFn): void { this.generateContentFn = fn; }
    setLiveCoachingContentFn(fn: any): void { this.liveCoachingContentFn = fn; }
    setConversationContextProvider(fn: () => any): void { this.conversationContextProvider = fn; }
    setActiveSpaceFn(fn: () => any): void { this.activeSpaceFn = fn; }

    // ============================================
    // Mode + status
    // ============================================

    setKnowledgeMode(enabled: boolean): void { this.knowledgeMode = enabled; }
    isKnowledgeMode(): boolean { return this.knowledgeMode; }

    getStatus(): KnowledgeStatus {
        const resume = this.activeResume.structured_data;
        return {
            hasResume: Boolean(resume),
            hasJD: Boolean(this.activeJD.structured_data),
            activeMode: this.knowledgeMode,
            resumeSummary: resume
                ? {
                    name: resume?.identity?.name,
                    role: resume?.experience?.[0]?.role ?? resume?.experience?.[0]?.title,
                    totalExperienceYears: resume?.identity?.totalExperienceYears,
                }
                : undefined,
        };
    }

    getProfileData(): any {
        return {
            resume: this.activeResume.structured_data,
            jd: this.activeJD.structured_data,
            activeResume: this.activeResume.structured_data,
            activeJD: this.activeJD.structured_data,
            hasActiveResume: Boolean(this.activeResume.structured_data),
            hasActiveJD: Boolean(this.activeJD.structured_data),
        };
    }

    // ============================================
    // Ingestion
    // ============================================

    async ingestDocument(filePath: string, docType: DocType): Promise<{ success: boolean; error?: string }> {
        try {
            const parsed = await extractSafeDocumentText(filePath);
            const rawText = parsed.content;

            let structured: any = null;
            if (docType === DocType.RESUME) {
                structured = await this.extractResumeStructured(rawText);
            } else if (docType === DocType.JD) {
                structured = await this.extractJDStructured(rawText);
            }
            // LESSON needs chunks + embeddings only — no structured extraction.

            const docRow = {
                docType,
                filePath: parsed.filePath,
                fileName: parsed.fileName,
                rawText,
                structuredData: structured ? JSON.stringify(structured) : null,
            };
            // LESSON is a many-file corpus (append, keyed by file_path); RESUME/JD
            // are singletons (upsert replaces the one document of that type).
            const documentId = docType === DocType.LESSON
                ? this.db.appendDocument(docRow)
                : this.db.upsertDocument(docRow);

            await this.embedAndSaveChunks(documentId, rawText);

            if (docType === DocType.RESUME) this.activeResume = this.rowToStructured(docType);
            else if (docType === DocType.JD) this.activeJD = this.rowToStructured(docType);

            return { success: true };
        } catch (error: any) {
            console.error(`[KnowledgeOrchestrator] ingestDocument(${docType}) failed:`, error);
            return { success: false, error: error?.message || String(error) };
        }
    }

    deleteDocumentsByType(docType: DocType): void {
        this.db.deleteByDocType(docType);
        if (docType === DocType.RESUME) this.activeResume = { structured_data: null };
        else if (docType === DocType.JD) this.activeJD = { structured_data: null };
    }

    // ============================================
    // Retrieval
    // ============================================

    /**
     * Semantic top-k over the ingested corpus, scoped to the active embedding
     * space (never cross-space — KnowledgeDatabaseManager fail-closes without a
     * spaceKey). Similarity is NOT proof: results carry docType so the caller can
     * treat them as typed evidence.
     */
    async queryRelevantChunks(query: string, docTypeOrLimit?: DocType | number, maybeLimit?: number): Promise<ChunkResult[]> {
        // Overloaded call shape: (query, limit) from generic callers, or
        // (query, docType, limit) from the profile answer flow.
        let docType: DocType | undefined;
        let limit = 8;
        if (typeof docTypeOrLimit === 'number') {
            limit = docTypeOrLimit;
        } else if (docTypeOrLimit) {
            docType = docTypeOrLimit;
            if (typeof maybeLimit === 'number') limit = maybeLimit;
        }

        const embed = this.embedQueryFn ?? this.embedFn;
        if (!embed) return [];
        const spaceKey = this.activeSpaceFn?.() ?? undefined;
        if (!spaceKey) return [];

        let queryEmbedding: number[];
        try {
            queryEmbedding = await embed(query);
        } catch (e) {
            console.warn('[KnowledgeOrchestrator] query embed failed:', e);
            return [];
        }

        const scored = await this.db.queryChunksByEmbedding(queryEmbedding, { docType, limit, spaceKey });
        return scored.map(s => ({ text: s.text, similarity: s.similarity, docType: s.docType }));
    }

    /**
     * Ingested doc-type inventory for the phone knowledge gateway. Cheap
     * document-row counts only — no embedding work.
     */
    listDocTypeCounts(): Array<{ docType: DocType; count: number }> {
        return this.db.countDocumentsByType();
    }

    /**
     * Re-embed any chunk stranded in an OLD embedding space (e.g. after a
     * gemini-embedding-001 → -2 upgrade — same 768 dims, incompatible space) or
     * left NULL-space with an embedding. Mirrors the meeting-RAG auto-reindex
     * self-heal so knowledge stays retrievable without a manual re-upload.
     */
    async ensureEmbeddingSpace(): Promise<void> {
        const spaceKey = this.activeSpaceFn?.() ?? undefined;
        if (!spaceKey || !this.embedFn) return;
        // Re-embed by re-ingesting from stored raw_text is overkill; instead re-embed
        // per document that has any chunk outside the active space. Cheapest correct
        // path: reprocess each active doc's raw_text through embedAndSaveChunks, which
        // upsertDocument already cleared-and-rewrote on ingest. Here we only need to
        // cover the standing corpus, so walk both singleton docs.
        for (const docType of [DocType.RESUME, DocType.JD, DocType.REFERENCE, DocType.LESSON]) {
            const doc = this.db.getDocumentByType(docType);
            if (!doc || !doc.rawText.trim()) continue;
            if (!this.db.hasChunksOutsideSpace(docType, spaceKey)) continue;
            const documentId = this.db.upsertDocument({
                docType,
                filePath: doc.filePath,
                fileName: doc.fileName,
                rawText: doc.rawText,
                structuredData: doc.structuredData,
            });
            await this.embedAndSaveChunks(documentId, doc.rawText);
        }
        this.loadActiveDocuments();
    }

    // ============================================
    // Premium stubs (inert in OSS build)
    // ============================================

    generateNegotiationScriptOnDemand(): Promise<null> { return Promise.resolve(null); }
    getNegotiationScript(): null { return null; }
    getCoverLetter(): null { return null; }
    getCompanyResearchEngine(): null { return null; }

    // ============================================
    // Private helpers
    // ============================================

    private loadActiveDocuments(): void {
        this.activeResume = this.rowToStructured(DocType.RESUME);
        this.activeJD = this.rowToStructured(DocType.JD);
    }

    private rowToStructured(docType: DocType): StructuredDocument {
        const doc = this.db.getDocumentByType(docType);
        if (!doc) return { structured_data: null };
        let structured: any = null;
        if (doc.structuredData) {
            try { structured = JSON.parse(doc.structuredData); } catch { structured = null; }
        }
        return {
            id: doc.id,
            source_uri: doc.filePath ?? undefined,
            created_at: doc.createdAt,
            updated_at: doc.updatedAt,
            structured_data: structured,
        };
    }

    private async embedAndSaveChunks(documentId: number, rawText: string): Promise<void> {
        if (!this.embedFn) return;
        const chunks = this.splitIntoChunks(rawText);
        const spaceHint = this.activeSpaceFn?.() ?? undefined;

        const toSave: Array<{ chunkIndex: number; text: string; embedding?: number[]; embeddingProvider?: string; embeddingDimensions?: number; embeddingSpace?: string }> = [];
        for (let i = 0; i < chunks.length; i++) {
            const text = chunks[i];
            try {
                if (this.embedWithMetadataFn) {
                    const r = await this.embedWithMetadataFn(text);
                    toSave.push({
                        chunkIndex: i,
                        text,
                        embedding: r.embedding,
                        embeddingProvider: r.provider,
                        embeddingDimensions: r.dimensions ?? r.embedding.length,
                        embeddingSpace: r.space ?? spaceHint,
                    });
                } else {
                    const embedding = await this.embedFn(text);
                    toSave.push({ chunkIndex: i, text, embedding, embeddingDimensions: embedding.length, embeddingSpace: spaceHint });
                }
            } catch (e) {
                console.warn(`[KnowledgeOrchestrator] embed chunk ${i} failed (stored without embedding):`, e);
                toSave.push({ chunkIndex: i, text });
            }
        }
        this.db.saveChunks(documentId, toSave);
    }

    private splitIntoChunks(text: string): string[] {
        const words = text.split(/\s+/).filter(Boolean);
        if (words.length === 0) return [];
        if (words.length <= CHUNK_WORDS) return [words.join(' ')];
        const step = CHUNK_WORDS - CHUNK_OVERLAP_WORDS;
        const chunks: string[] = [];
        for (let start = 0; start < words.length; start += step) {
            chunks.push(words.slice(start, start + CHUNK_WORDS).join(' '));
            if (start + CHUNK_WORDS >= words.length) break;
        }
        return chunks;
    }

    private async extractResumeStructured(rawText: string): Promise<any | null> {
        if (!this.generateContentFn) return null;
        const prompt = [
            'Extract the following structured data from this resume as strict JSON. Use null/[] where unknown; never invent facts.',
            '{',
            '  "identity": { "name": string|null, "email": string|null, "phone": string|null, "location": string|null },',
            '  "experience": [ { "role": string, "company": string, "start_date": string|null, "end_date": string|null, "bullets": string[] } ],',
            '  "projects": [ { "name": string, "description": string, "technologies": string[] } ],',
            '  "skills": { "languages": string[], "frameworks": string[], "cloud": string[], "databases": string[], "tools": string[] }',
            '}',
            'Return ONLY the JSON object.',
            '',
            'RESUME:',
            rawText,
        ].join('\n');
        return this.callAndParse(prompt);
    }

    private async extractJDStructured(rawText: string): Promise<any | null> {
        if (!this.generateContentFn) return null;
        const prompt = [
            'Extract structured data from this job description as strict JSON. Use null/[] where unknown; never invent facts.',
            '{ "role": string|null, "company": string|null, "requirements": string[], "responsibilities": string[] }',
            'Return ONLY the JSON object.',
            '',
            'JOB DESCRIPTION:',
            rawText,
        ].join('\n');
        return this.callAndParse(prompt);
    }

    private async callAndParse(prompt: string): Promise<any | null> {
        try {
            const raw = await this.generateContentFn!([{ text: prompt }]);
            return this.parseJsonLoose(raw);
        } catch (e) {
            console.warn('[KnowledgeOrchestrator] structured extraction failed:', e);
            return null;
        }
    }

    private parseJsonLoose(raw: string): any | null {
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch { /* fall through to fenced/embedded extraction */ }
        // Strip ```json fences and grab the first {...} block.
        const fenced = raw.replace(/```(?:json)?/gi, '').trim();
        try {
            return JSON.parse(fenced);
        } catch { /* fall through */ }
        const start = fenced.indexOf('{');
        const end = fenced.lastIndexOf('}');
        if (start !== -1 && end > start) {
            try { return JSON.parse(fenced.slice(start, end + 1)); } catch { /* give up */ }
        }
        return null;
    }
}
