import { DatabaseManager } from '../db/DatabaseManager';
import {
    MODE_GENERAL_PROMPT,
    MODE_LOOKING_FOR_WORK_PROMPT,
    MODE_SALES_PROMPT,
    MODE_RECRUITING_PROMPT,
    MODE_TEAM_MEET_PROMPT,
    MODE_LECTURE_PROMPT,
    MODE_TECHNICAL_INTERVIEW_PROMPT,
} from '../llm/prompts';

type EmbedFn = (text: string) => Promise<number[]>;

// Vector helpers (kept local to avoid coupling to KnowledgeDatabaseManager)
function vectorToBuffer(vec: number[]): Buffer {
    const f32 = new Float32Array(vec);
    return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}
function bufferToVector(buf: Buffer | null): number[] | null {
    if (!buf) return null;
    const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    return Array.from(f32);
}
function cosine(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Chunking — paragraph-aware sliding window. Targets ~500-char chunks with
// soft paragraph boundaries; falls back to hard char-based splits for long
// blocks. Tuned for embedding small-to-medium models.
const CHUNK_TARGET = 600;
const CHUNK_MAX = 900;

function chunkText(raw: string): string[] {
    const text = raw.trim();
    if (!text) return [];
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    const chunks: string[] = [];
    let buffer = '';

    const flush = () => {
        if (buffer.trim()) chunks.push(buffer.trim());
        buffer = '';
    };

    for (const para of paragraphs) {
        // If a single paragraph blows past CHUNK_MAX, hard-split it
        if (para.length > CHUNK_MAX) {
            flush();
            for (let i = 0; i < para.length; i += CHUNK_TARGET) {
                chunks.push(para.slice(i, i + CHUNK_TARGET).trim());
            }
            continue;
        }
        if (buffer.length + para.length + 2 > CHUNK_TARGET && buffer.length > 0) {
            flush();
        }
        buffer = buffer ? `${buffer}\n\n${para}` : para;
        if (buffer.length >= CHUNK_TARGET) flush();
    }
    flush();
    return chunks;
}

export type ModeTemplateType =
    | 'general'
    | 'looking-for-work'
    | 'sales'
    | 'recruiting'
    | 'team-meet'
    | 'lecture'
    | 'technical-interview';

export interface Mode {
    id: string;
    name: string;
    templateType: ModeTemplateType;
    customContext: string;
    isActive: boolean;
    createdAt: string;
}

export interface ModeReferenceFile {
    id: string;
    modeId: string;
    fileName: string;
    content: string;
    createdAt: string;
}

export interface ModeNoteSection {
    id: string;
    modeId: string;
    title: string;
    description: string;
    sortOrder: number;
    createdAt: string;
}

export const MODE_TEMPLATES: Array<{
    type: ModeTemplateType;
    label: string;
    description: string;
}> = [
    { type: 'sales',            label: 'Sales',            description: 'Close deals with strategic discovery and objection handling.' },
    { type: 'recruiting',       label: 'Recruiting',       description: 'Evaluate candidates with structured interview insights.' },
    { type: 'team-meet',        label: 'Team Meet',        description: 'Track action items and key decisions from meetings.' },
    { type: 'looking-for-work', label: 'Looking for work', description: 'Answer interview questions with confidence and clarity.' },
    { type: 'lecture',          label: 'Lecture',          description: 'Capture key concepts and content from lectures.' },
];

// Default note sections seeded when a mode is created from a template
export const TEMPLATE_NOTE_SECTIONS: Record<ModeTemplateType, Array<{ title: string; description: string }>> = {
    general: [
        { title: 'Summary',      description: 'High-level summary of the conversation.' },
        { title: 'Action items', description: 'Tasks and follow-ups identified.' },
        { title: 'Key points',   description: 'Important points discussed.' },
    ],
    'looking-for-work': [
        { title: 'Follow-up actions',      description: 'Next interview steps or additional materials I said I would send if applicable.' },
        { title: 'Overview',               description: 'Overview of the interview, the company, and general structure.' },
        { title: 'Questions and responses', description: 'All questions asked to me during the interview and answers that gave.' },
        { title: 'Areas to improve',       description: 'What I could have done better during the interview.' },
        { title: 'Role details',           description: 'Anything discussed about the position, salary expectations, etc.' },
    ],
    sales: [
        { title: 'Action Items',         description: 'All action items that were said I would do after the meeting.' },
        { title: 'Outcome',              description: 'Did I close the sale and what was the outcome of the conversation.' },
        { title: 'Prospect background',  description: 'Background and context on who I was selling to.' },
        { title: 'Discovery',            description: 'What the prospect said during discovery.' },
        { title: 'Product',              description: "How I pitched the product and the prospect's reaction." },
        { title: 'Objections',           description: 'Objections from the prospect if there were any.' },
    ],
    recruiting: [
        { title: 'Action Items',          description: 'All action items that I have to do after the meeting.' },
        { title: 'Experience and skills', description: "Candidate's previous work experience and skills discussed." },
        { title: 'Quality of responses',  description: 'If there were questions asked, how well and how accurately the candidate answered each question.' },
        { title: 'Interest in company',   description: 'What the candidate said about their interest in the company.' },
        { title: 'Role expectations',     description: 'Anything discussed about the position, salary expectations, etc.' },
    ],
    'team-meet': [
        { title: 'Action Items',          description: 'All action items that were said I would do after the meeting.' },
        { title: 'Announcements',         description: 'Any team-wide announcements from the meeting.' },
        { title: 'Team updates',          description: "Each team member's progress, accomplishments, and current focus." },
        { title: 'Challenges or blockers', description: 'Any issues or obstacles raised that may affect progress.' },
        { title: 'Decisions made',        description: 'Key decisions or agreements reached during the meeting.' },
    ],
    lecture: [
        { title: 'Follow-up work',  description: 'Follow-up reading, assignments, or tasks to complete.' },
        { title: 'Topic',           description: 'Main subject or theme of the lecture.' },
        { title: 'Key concepts',    description: 'Core ideas or frameworks covered.' },
        { title: 'Content',         description: 'All content from the lecture with incredibly detailed bullet notes.' },
    ],
    'technical-interview': [
        { title: 'Problems covered',  description: 'Each problem asked, the approach used, and the outcome.' },
        { title: 'Concepts tested',   description: 'Key algorithms, data structures, or system design concepts that came up.' },
        { title: 'What went well',    description: 'Approaches or explanations that landed well.' },
        { title: 'Areas to study',    description: 'Topics or gaps identified that need more preparation.' },
        { title: 'Action items',      description: 'Follow-up steps — e.g. send code, study specific topics, await next round.' },
    ],
};

const TEMPLATE_SYSTEM_PROMPTS: Record<ModeTemplateType, string> = {
    // General = universal adaptive copilot (own prompt, not technical interview)
    general: MODE_GENERAL_PROMPT,
    'technical-interview': MODE_TECHNICAL_INTERVIEW_PROMPT,

    'looking-for-work': MODE_LOOKING_FOR_WORK_PROMPT,
    sales: MODE_SALES_PROMPT,
    recruiting: MODE_RECRUITING_PROMPT,
    'team-meet': MODE_TEAM_MEET_PROMPT,
    lecture: MODE_LECTURE_PROMPT,
};

function rowToMode(row: any): Mode {
    return {
        id: row.id,
        name: row.name,
        templateType: row.template_type as ModeTemplateType,
        customContext: row.custom_context ?? '',
        isActive: row.is_active === 1,
        createdAt: row.created_at,
    };
}

function rowToFile(row: any): ModeReferenceFile {
    return {
        id: row.id,
        modeId: row.mode_id,
        fileName: row.file_name,
        content: row.content ?? '',
        createdAt: row.created_at,
    };
}

function rowToSection(row: any): ModeNoteSection {
    return {
        id: row.id,
        modeId: row.mode_id,
        title: row.title,
        description: row.description ?? '',
        sortOrder: row.sort_order ?? 0,
        createdAt: row.created_at,
    };
}

export class ModesManager {
    private static instance: ModesManager;

    private embedFn: EmbedFn | null = null;
    private embedQueryFn: EmbedFn | null = null;

    private constructor() {}

    public static getInstance(): ModesManager {
        if (!ModesManager.instance) {
            ModesManager.instance = new ModesManager();
        }
        return ModesManager.instance;
    }

    public setEmbedFn(fn: EmbedFn): void { this.embedFn = fn; }
    public setEmbedQueryFn(fn: EmbedFn): void { this.embedQueryFn = fn; }

    // ── Modes ─────────────────────────────────────────────────────

    public getModes(): Mode[] {
        const modes = DatabaseManager.getInstance().getModes().map(rowToMode);
        
        // Auto-seed the un-deletable General mode if it doesn't exist
        if (!modes.some(m => m.templateType === 'general')) {
            const generalMode = this.createMode({ name: 'General', templateType: 'general' });
            modes.push(generalMode);
        }
        
        // Always enforce 'general' at the very top of the list
        modes.sort((a, b) => {
            if (a.templateType === 'general') return -1;
            if (b.templateType === 'general') return 1;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); // oldest first or whatever default
        });
        
        return modes;
    }

    public getActiveMode(): Mode | null {
        const row = DatabaseManager.getInstance().getActiveMode();
        return row ? rowToMode(row) : null;
    }

    public createMode(params: { name: string; templateType: ModeTemplateType }): Mode {
        const id = `mode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        DatabaseManager.getInstance().createMode({
            id,
            name: params.name,
            templateType: params.templateType,
            customContext: '',
        });
        // Seed default note sections for this template type
        const defaultSections = TEMPLATE_NOTE_SECTIONS[params.templateType] ?? [];
        defaultSections.forEach((s, i) => {
            const sectionId = `ns_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
            DatabaseManager.getInstance().addNoteSection({
                id: sectionId,
                modeId: id,
                title: s.title,
                description: s.description,
                sortOrder: i,
            });
        });
        return {
            id,
            name: params.name,
            templateType: params.templateType,
            customContext: '',
            isActive: false,
            createdAt: new Date().toISOString(),
        };
    }

    public updateMode(id: string, updates: { name?: string; templateType?: ModeTemplateType; customContext?: string }): void {
        DatabaseManager.getInstance().updateMode(id, updates);
    }

    public deleteMode(id: string): void {
        DatabaseManager.getInstance().deleteMode(id);
    }

    public setActiveMode(id: string | null): void {
        DatabaseManager.getInstance().setActiveMode(id);
    }

    // ── Reference Files ───────────────────────────────────────────

    public getReferenceFiles(modeId: string): ModeReferenceFile[] {
        return DatabaseManager.getInstance().getReferenceFiles(modeId).map(rowToFile);
    }

    public addReferenceFile(params: { modeId: string; fileName: string; content: string }): ModeReferenceFile {
        const id = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        DatabaseManager.getInstance().addReferenceFile({
            id,
            modeId: params.modeId,
            fileName: params.fileName,
            content: params.content,
        });
        // Chunk & embed in the background — does not block file creation
        void this.indexReferenceFile(id, params.modeId, params.content);
        return {
            id,
            modeId: params.modeId,
            fileName: params.fileName,
            content: params.content,
            createdAt: new Date().toISOString(),
        };
    }

    public deleteReferenceFile(id: string): void {
        // Chunks are CASCADE-deleted via FK, but call explicitly for clarity
        DatabaseManager.getInstance().deleteReferenceChunksForFile(id);
        DatabaseManager.getInstance().deleteReferenceFile(id);
    }

    /**
     * Splits a reference file into chunks and stores embeddings. Best-effort —
     * if embedding fails, chunks are still stored without vectors so they can
     * be backfilled later (or at least surfaced via fallback truncation).
     */
    private async indexReferenceFile(fileId: string, modeId: string, content: string): Promise<void> {
        const chunks = chunkText(content);
        if (chunks.length === 0) return;

        const records: Array<{
            id: string;
            fileId: string;
            modeId: string;
            chunkIndex: number;
            text: string;
            embedding: Buffer | null;
        }> = [];

        for (let i = 0; i < chunks.length; i++) {
            let embedding: Buffer | null = null;
            if (this.embedFn) {
                try {
                    const vec = await this.embedFn(chunks[i].slice(0, 4000));
                    if (vec && vec.length > 0) embedding = vectorToBuffer(vec);
                } catch (e: any) {
                    console.warn(`[ModesManager] chunk ${i} embedding failed:`, e?.message);
                }
            }
            records.push({
                id: `chk_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
                fileId,
                modeId,
                chunkIndex: i,
                text: chunks[i],
                embedding,
            });
        }

        DatabaseManager.getInstance().insertReferenceChunks(records);
    }

    // ── Note Sections ─────────────────────────────────────────────

    public getNoteSections(modeId: string): ModeNoteSection[] {
        return DatabaseManager.getInstance().getNoteSections(modeId).map(rowToSection);
    }

    public addNoteSection(params: { modeId: string; title: string; description: string }): ModeNoteSection {
        const existingSections = this.getNoteSections(params.modeId);
        const sortOrder = existingSections.length;
        const id = `ns_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        DatabaseManager.getInstance().addNoteSection({
            id,
            modeId: params.modeId,
            title: params.title,
            description: params.description,
            sortOrder,
        });
        return {
            id,
            modeId: params.modeId,
            title: params.title,
            description: params.description,
            sortOrder,
            createdAt: new Date().toISOString(),
        };
    }

    public updateNoteSection(id: string, updates: { title?: string; description?: string }): void {
        DatabaseManager.getInstance().updateNoteSection(id, updates);
    }

    public deleteNoteSection(id: string): void {
        DatabaseManager.getInstance().deleteNoteSection(id);
    }

    public removeAllNoteSections(modeId: string): void {
        DatabaseManager.getInstance().deleteAllNoteSections(modeId);
    }

    // ── LLM Context ───────────────────────────────────────────────

    /**
     * Returns the system prompt suffix for the active mode's template type.
     * Empty string if general or no active mode.
     */
    public getActiveModeSystemPromptSuffix(): string {
        const mode = this.getActiveMode();
        if (!mode) return '';
        return TEMPLATE_SYSTEM_PROMPTS[mode.templateType] ?? '';
    }

    /**
     * Builds a context block to inject before the user message for the active mode.
     * Includes custom context text and reference file content.
     *
     * Two paths:
     *   • With a query → vector retrieval picks the top-K most relevant chunks
     *     across all reference files (smaller, more relevant context).
     *   • No query (or no embeddings yet) → falls back to truncated full-file
     *     injection so the feature still works on first run / before indexing.
     */
    private static readonly MAX_FILE_CHARS = 12_000;
    private static readonly MAX_TOTAL_CHARS = 40_000;
    private static readonly RAG_TOP_K = 6;
    private static readonly RAG_BUDGET_CHARS = 8_000;

    public async buildActiveModeContextBlock(query?: string): Promise<string> {
        const mode = this.getActiveMode();
        if (!mode) return '';

        const parts: string[] = [];

        if (mode.customContext.trim()) {
            parts.push(`<user_context>\n${mode.customContext.trim()}\n</user_context>`);
        }

        // Try retrieval path first — only when we have a query and an embed fn
        const trimmedQuery = (query ?? '').trim();
        const embedFn = this.embedQueryFn ?? this.embedFn;
        const ragBlock = trimmedQuery && embedFn
            ? await this.retrieveTopChunks(mode.id, trimmedQuery, embedFn)
            : '';

        if (ragBlock) {
            parts.push(ragBlock);
        } else {
            // Fallback: dumb-inject truncated reference file content
            parts.push(this.buildTruncatedReferenceBlock(mode.id));
        }

        return parts.filter(Boolean).join('\n\n');
    }

    /**
     * Synchronous variant retained for callers that don't have a query (e.g.,
     * status pings). Always uses the truncated fallback path. New callers
     * should prefer the async `buildActiveModeContextBlock(query)`.
     */
    public buildActiveModeContextBlockSync(): string {
        const mode = this.getActiveMode();
        if (!mode) return '';
        const parts: string[] = [];
        if (mode.customContext.trim()) {
            parts.push(`<user_context>\n${mode.customContext.trim()}\n</user_context>`);
        }
        const fallback = this.buildTruncatedReferenceBlock(mode.id);
        if (fallback) parts.push(fallback);
        return parts.join('\n\n');
    }

    private buildTruncatedReferenceBlock(modeId: string): string {
        const files = this.getReferenceFiles(modeId);
        const parts: string[] = [];
        let totalChars = 0;

        for (const file of files) {
            const raw = file.content.trim();
            if (!raw) continue;

            const remaining = ModesManager.MAX_TOTAL_CHARS - totalChars;
            if (remaining <= 0) break;

            const capped = raw.length > ModesManager.MAX_FILE_CHARS
                ? raw.slice(0, ModesManager.MAX_FILE_CHARS - 14) + '\n[...truncated]'
                : raw;
            const used = Math.min(capped.length, remaining);
            const content = capped.slice(0, used);

            parts.push(`<reference_file name="${file.fileName}">\n${content}\n</reference_file>`);
            totalChars += content.length;
        }
        return parts.join('\n\n');
    }

    private async retrieveTopChunks(modeId: string, query: string, embedFn: EmbedFn): Promise<string> {
        const rows = DatabaseManager.getInstance().getReferenceChunksForMode(modeId);
        const usableRows = rows.filter(r => r.embedding != null);
        if (usableRows.length === 0) return '';

        let queryVec: number[];
        try {
            queryVec = await embedFn(query.slice(0, 2000));
        } catch (e: any) {
            console.warn('[ModesManager] retrieval embed failed:', e?.message);
            return '';
        }
        if (!queryVec || queryVec.length === 0) return '';

        const scored: Array<{ row: typeof rows[number]; score: number }> = [];
        for (const row of usableRows) {
            const vec = bufferToVector(row.embedding);
            if (!vec || vec.length !== queryVec.length) continue;
            scored.push({ row, score: cosine(queryVec, vec) });
        }
        scored.sort((a, b) => b.score - a.score);

        const picked = scored.slice(0, ModesManager.RAG_TOP_K);
        if (picked.length === 0) return '';

        // Group chunks by file_name to keep blocks readable
        const byFile = new Map<string, string[]>();
        let charBudget = ModesManager.RAG_BUDGET_CHARS;
        for (const { row } of picked) {
            if (charBudget <= 0) break;
            const text = row.text.length > charBudget
                ? row.text.slice(0, charBudget) + '…'
                : row.text;
            const fileName = row.file_name || 'reference';
            if (!byFile.has(fileName)) byFile.set(fileName, []);
            byFile.get(fileName)!.push(text);
            charBudget -= text.length;
        }

        const blocks: string[] = [];
        for (const [fileName, chunks] of byFile.entries()) {
            const body = chunks.join('\n\n---\n\n');
            blocks.push(`<reference_file name="${fileName}" retrieved="true">\n${body}\n</reference_file>`);
        }
        return blocks.join('\n\n');
    }

    /**
     * Status snapshot for the UI — what's currently injected when the active
     * mode runs. Cheap to call; safe in render paths.
     */
    public getActiveContextStatus(): {
        modeId: string | null;
        modeName: string | null;
        templateType: ModeTemplateType | null;
        hasCustomContext: boolean;
        referenceFileCount: number;
        indexedChunkCount: number;
    } {
        const mode = this.getActiveMode();
        if (!mode) {
            return {
                modeId: null,
                modeName: null,
                templateType: null,
                hasCustomContext: false,
                referenceFileCount: 0,
                indexedChunkCount: 0,
            };
        }
        const files = this.getReferenceFiles(mode.id);
        const indexedChunkCount = DatabaseManager.getInstance().countReferenceChunksForMode(mode.id);
        return {
            modeId: mode.id,
            modeName: mode.name,
            templateType: mode.templateType,
            hasCustomContext: mode.customContext.trim().length > 0,
            referenceFileCount: files.length,
            indexedChunkCount,
        };
    }

    /**
     * Re-indexes any reference files that have no chunks yet (e.g. files
     * uploaded before RAG was enabled, or when embedFn became available
     * after upload). Idempotent — skips files that already have chunks.
     */
    public async reindexMissingReferenceFiles(): Promise<{ indexed: number; skipped: number }> {
        if (!this.embedFn) return { indexed: 0, skipped: 0 };
        const db = DatabaseManager.getInstance();
        const allModes = this.getModes();
        let indexed = 0;
        let skipped = 0;
        for (const mode of allModes) {
            const files = this.getReferenceFiles(mode.id);
            for (const file of files) {
                const existing = db.getReferenceChunksForMode(mode.id).filter(c => c.file_id === file.id);
                if (existing.length > 0) {
                    skipped++;
                    continue;
                }
                await this.indexReferenceFile(file.id, mode.id, file.content);
                indexed++;
            }
        }
        return { indexed, skipped };
    }
}
