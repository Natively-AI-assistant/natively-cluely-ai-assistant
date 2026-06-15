import * as crypto from 'crypto';
import { DatabaseManager } from '../db/DatabaseManager';
import { ModeContextRetriever } from './ModeContextRetriever';
import type { AnswerType } from '../llm/AnswerPlanner';
import type { ActiveModeInfo } from '../llm/modeProfiles';
import { classifyCustomContext, selectCustomContextForAnswer } from '../llm/customContextClassifier';

/**
 * Drop sensitive (salary/pricing/strategy) chunks from a raw customContext blob
 * for a non-negotiation context. Used by the summary path so sensitive notes
 * don't end up in a stored meeting summary. Returns the original blob unchanged
 * when there is nothing sensitive.
 */
function dropSensitiveCustomContext(raw: string, answerType: AnswerType = 'general_meeting_answer'): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const classified = classifyCustomContext(trimmed);
    if (classified.sensitive.length === 0) return trimmed;
    return selectCustomContextForAnswer(classified, answerType).included.map(c => c.text).join('\n');
}
import {
    MODE_GENERAL_PROMPT,
    MODE_LOOKING_FOR_WORK_PROMPT,
    MODE_SALES_PROMPT,
    MODE_RECRUITING_PROMPT,
    MODE_TEAM_MEET_PROMPT,
    MODE_LECTURE_PROMPT,
    MODE_TECHNICAL_INTERVIEW_PROMPT,
    SHARED_MODE_PREFIX,
    SHARED_MODE_PREFIX_SHORT,
} from '../llm/prompts';

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
    { type: 'general',              label: 'General',              description: 'Universal adaptive copilot for any meeting or conversation.' },
    { type: 'sales',                label: 'Sales',                description: 'Close deals with strategic discovery and objection handling.' },
    { type: 'recruiting',           label: 'Recruiting',           description: 'Evaluate candidates with structured interview insights.' },
    { type: 'team-meet',            label: 'Team Meet',            description: 'Track action items and key decisions from meetings.' },
    { type: 'looking-for-work',     label: 'Looking for work',     description: 'Answer interview questions with confidence and clarity.' },
    { type: 'technical-interview',  label: 'Technical Interview',  description: 'Whiteboard-style coding and system design support.' },
    { type: 'lecture',              label: 'Lecture',              description: 'Capture key concepts and content from lectures.' },
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

// Startup invariant: every MODE_*_PROMPT must begin with one of the two shared
// prefixes so getActiveModeSystemPromptSuffix() can strip duplicated tokens.
// If a future template diverges, we silently regress to shipping ~1.6K duplicate
// tokens per request. Warn loudly here instead so the regression is caught at
// app launch, not by a prod cost spike.
for (const [templateType, prompt] of Object.entries(TEMPLATE_SYSTEM_PROMPTS)) {
    if (!prompt.startsWith(SHARED_MODE_PREFIX) && !prompt.startsWith(SHARED_MODE_PREFIX_SHORT)) {
        console.warn(
            `[ModesManager] WARN: MODE template '${templateType}' does not start with ` +
            `SHARED_MODE_PREFIX or SHARED_MODE_PREFIX_SHORT. Token deduplication will fall ` +
            `back to sending the full template — duplicate-token regression. See prompts.ts.`
        );
    }
}

export function encodeModeContextPayload(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

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
    private readonly modeContextRetriever = new ModeContextRetriever();

    private constructor() {}

    public static getInstance(): ModesManager {
        if (!ModesManager.instance) {
            ModesManager.instance = new ModesManager();
        }
        return ModesManager.instance;
    }

    // ── Modes ─────────────────────────────────────────────────────

    public getModes(): Mode[] {
        const modes = DatabaseManager.getInstance().getModes().map(rowToMode);

        // Always enforce 'general' at the very top of the list.
        // L1: id is the secondary sort key for stable ordering when two modes
        // share createdAt to the millisecond.
        modes.sort((a, b) => {
            if (a.templateType === 'general') return -1;
            if (b.templateType === 'general') return 1;
            const ta = new Date(a.createdAt).getTime();
            const tb = new Date(b.createdAt).getTime();
            if (ta !== tb) return ta - tb;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });

        return modes;
    }

    // Seed the un-deletable General mode once at app init. Idempotent.
    public ensureSeeded(): void {
        const modes = DatabaseManager.getInstance().getModes().map(rowToMode);
        if (!modes.some(m => m.templateType === 'general')) {
            this.createMode({ name: 'General', templateType: 'general' });
        }
    }

    public getActiveMode(): Mode | null {
        const row = DatabaseManager.getInstance().getActiveMode();
        return row ? rowToMode(row) : null;
    }

    // ── Active-mode info cache (PI v3, W1) ────────────────────────
    // The live answer path consults the active mode on EVERY turn (routing
    // prior, pinned instructions, retrieval). The mode itself changes only via
    // setActiveMode/updateMode/deleteMode, so a tiny invalidate-on-write cache
    // removes the per-question SQLite read without any staleness risk.
    private _activeModeInfoCache: ActiveModeInfo | null = null;
    private _activeModeInfoCacheValid = false;

    private invalidateActiveModeCache(): void {
        this._activeModeInfoCache = null;
        this._activeModeInfoCacheValid = false;
    }

    /**
     * The slice of the active mode the answer planner needs, cached. A mode is
     * "custom" when the user built it from the blank template ('general'
     * templateType but not the seeded General mode) — its name/content are
     * user-authored and surfaced to prompt builders.
     */
    public getActiveModeInfo(): ActiveModeInfo | null {
        if (this._activeModeInfoCacheValid) return this._activeModeInfoCache;
        const mode = this.getActiveMode();
        this._activeModeInfoCache = mode ? {
            id: mode.id,
            templateType: mode.templateType,
            name: mode.name,
            isCustom: mode.templateType === 'general' && mode.name !== 'General',
        } : null;
        this._activeModeInfoCacheValid = true;
        return this._activeModeInfoCache;
    }

    // Modes where the premium knowledge intercept (negotiation coaching, intro
    // shortcut, premium-flavored systemPromptInjection/contextBlock) is OUT OF
    // SCOPE and would replace the user's expected answer with off-topic content.
    // Technical interviews are coding/system-design only; team meetings and
    // lectures have no candidate/interview scope. Issue #272: technical-
    // interview users were getting one-line salary coaching cards instead of
    // technical answers because the premium tracker fires on any interviewer
    // utterance regardless of the active mode. The fix also closes two sibling
    // vectors of the same bug class — the intro-question shortcut and the
    // premium prompt/context injection — by gating the whole intercept here.
    private static readonly PREMIUM_INTERCEPT_INCOMPATIBLE_TEMPLATES: ReadonlySet<ModeTemplateType> = new Set([
        'technical-interview',
        'team-meet',
        'lecture',
    ]);

    /**
     * True when the premium knowledge intercept (negotiation coaching, intro
     * shortcut, premium system-prompt/context injection) is contextually
     * appropriate for the active mode. False for technical-interview, team-
     * meet, and lecture — modes where premium-flavored interjections overwrite
     * the user's expected answer. Defaults to true when no mode is active.
     */
    public isPremiumKnowledgeInterceptAllowed(): boolean {
        const mode = this.getActiveMode();
        if (!mode) return true;
        return !ModesManager.PREMIUM_INTERCEPT_INCOMPATIBLE_TEMPLATES.has(mode.templateType);
    }

    public createMode(params: { name: string; templateType: ModeTemplateType }): Mode {
        const id = `mode_${crypto.randomUUID()}`;
        DatabaseManager.getInstance().createMode({
            id,
            name: params.name,
            templateType: params.templateType,
            customContext: '',
        });
        // Seed default note sections for this template type
        const defaultSections = TEMPLATE_NOTE_SECTIONS[params.templateType] ?? [];
        defaultSections.forEach((s, i) => {
            const sectionId = `ns_${crypto.randomUUID()}`;
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
        this.invalidateActiveModeCache();
    }

    public deleteMode(id: string): void {
        // PI v3 (W3): mode_reference_files rows go via FK CASCADE, but the
        // persisted chunk vectors (mode_reference_chunks / index_state) have no
        // FK on purpose (the table is owned by the retriever) — drop them
        // explicitly BEFORE the cascade removes the file rows we enumerate.
        try {
            for (const file of this.getReferenceFiles(id)) {
                this.modeContextRetriever.removeReferenceFileIndex(file.id);
            }
        } catch { /* non-fatal — orphans are disk bloat, not correctness */ }
        DatabaseManager.getInstance().deleteMode(id);
        this.invalidateActiveModeCache();
    }

    public setActiveMode(id: string | null): void {
        DatabaseManager.getInstance().setActiveMode(id);
        this.invalidateActiveModeCache();
    }

    // ── Reference Files ───────────────────────────────────────────

    public getReferenceFiles(modeId: string): ModeReferenceFile[] {
        return DatabaseManager.getInstance().getReferenceFiles(modeId).map(rowToFile);
    }

    public addReferenceFile(params: { modeId: string; fileName: string; content: string }): ModeReferenceFile {
        const id = `ref_${crypto.randomUUID()}`;
        DatabaseManager.getInstance().addReferenceFile({
            id,
            modeId: params.modeId,
            fileName: params.fileName,
            content: params.content,
        });
        return {
            id,
            modeId: params.modeId,
            fileName: params.fileName,
            content: params.content,
            createdAt: new Date().toISOString(),
        };
    }

    public deleteReferenceFile(id: string): void {
        DatabaseManager.getInstance().deleteReferenceFile(id);
        // PI v3 (W3): drop the persisted chunk vectors + index state too.
        try { this.modeContextRetriever.removeReferenceFileIndex(id); } catch { /* non-fatal */ }
    }

    // ── PI v3 (W3): upload-time reference-file indexing ───────────
    // Chunk + embed + persist a file's vectors so the per-question hot path
    // embeds ONLY the live query. Fire-and-forget from upload/activation; the
    // retriever degrades to lexical for any file that isn't 'ready' yet.

    /** Index one reference file (idempotent — re-embeds only on content/space change). */
    public async indexReferenceFile(file: ModeReferenceFile): Promise<void> {
        await this.modeContextRetriever.indexReferenceFile(file);
    }

    /** Kick indexing for every not-yet-ready file of a mode (mode activation prewarm). */
    public async prewarmModeReferenceIndex(modeId: string): Promise<void> {
        const files = this.getReferenceFiles(modeId);
        for (const file of files) {
            const { status } = this.modeContextRetriever.getReferenceFileIndexStatus(file.id);
            if (status !== 'ready') {
                await this.modeContextRetriever.indexReferenceFile(file).catch(() => { /* logged inside */ });
            }
        }
    }

    /** Per-file index status for the Modes Manager UI badges. */
    public getReferenceFileIndexStatuses(modeId: string): Array<{ fileId: string; fileName: string; status: string; chunkCount: number }> {
        return this.getReferenceFiles(modeId).map(file => ({
            fileId: file.id,
            fileName: file.fileName,
            ...this.modeContextRetriever.getReferenceFileIndexStatus(file.id),
        }));
    }

    // ── Note Sections ─────────────────────────────────────────────

    public getNoteSections(modeId: string): ModeNoteSection[] {
        return DatabaseManager.getInstance().getNoteSections(modeId).map(rowToSection);
    }

    public addNoteSection(params: { modeId: string; title: string; description: string }): ModeNoteSection {
        const existingSections = this.getNoteSections(params.modeId);
        const sortOrder = existingSections.length;
        const id = `ns_${crypto.randomUUID()}`;
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
     * Returns the template's MODE_*_PROMPT (including general's MODE_GENERAL_PROMPT
     * and technical-interview's MODE_TECHNICAL_INTERVIEW_PROMPT). Empty string
     * only when no mode is active.
     */
    public getActiveModeSystemPromptSuffix(): string {
        const mode = this.getActiveMode();
        if (!mode) return '';
        const full = TEMPLATE_SYSTEM_PROMPTS[mode.templateType] ?? '';
        // Strip the shared prefix that's already in HARD_SYSTEM_PROMPT, otherwise
        // CORE_IDENTITY + EXECUTION_CONTRACT + CONTEXT_INTELLIGENCE_LAYER (+
        // SHARED_CODING_RULES for coding modes) ship twice per request — ~1.6K
        // duplicated tokens for coding modes, ~1.2K for non-coding.
        //
        // Try the long (4-block) prefix first to handle coding modes, then the
        // short (3-block) prefix for sales/recruiting/team-meet/lecture which
        // intentionally omit SHARED_CODING_RULES. Fall back to unchanged if
        // neither matches — safe default for future template drift.
        for (const prefix of [SHARED_MODE_PREFIX, SHARED_MODE_PREFIX_SHORT]) {
            if (full.startsWith(prefix)) {
                return full.slice(prefix.length).replace(/^\s+/, '');
            }
        }
        return full;
    }

    // Hard cap for the always-pinned "Real-time prompt" (mode customContext).
    // Roughly 300 tokens — enough for real mode instructions, small enough that
    // a pasted document can't crowd out the transcript. Anything longer remains
    // fully available to RETRIEVAL (reference-file path), so nothing is lost.
    private static readonly PINNED_INSTRUCTIONS_MAX_CHARS = 1_200;

    /**
     * PI v3 (W2): the active mode's user-authored "Real-time prompt"
     * (customContext), ALWAYS-ON. Previously this text only reached the prompt
     * when lexical/vector retrieval happened to score it against the live query —
     * so a custom mode's instructions silently failed to apply on most turns.
     * This accessor returns it deterministically (subject to the same
     * answer-type sensitivity scoping as retrieval, so salary/pricing notes
     * still can't leak into a coding/identity answer) for pinning into the
     * prompt as a dedicated block.
     *
     * Returns '' when no mode is active or nothing survives scoping. For custom
     * (user-built) modes the mode NAME is prepended so the model knows whose
     * instructions these are.
     */
    public getActiveModePinnedInstructions(answerType?: AnswerType): string {
        const mode = this.getActiveMode();
        if (!mode) return '';
        const raw = (mode.customContext || '').trim();
        if (!raw) return '';
        const scoped = answerType
            ? selectCustomContextForAnswer(classifyCustomContext(raw), answerType).included.map(c => c.text).join('\n')
            : raw;
        if (!scoped.trim()) return '';
        let text = scoped.trim();
        if (text.length > ModesManager.PINNED_INSTRUCTIONS_MAX_CHARS) {
            text = text.slice(0, ModesManager.PINNED_INSTRUCTIONS_MAX_CHARS) + ' …[truncated]';
        }
        const info = this.getActiveModeInfo();
        return info?.isCustom ? `Mode: ${mode.name}\n${text}` : text;
    }

    /**
     * Builds a context block to inject before the user message for the active mode.
     * Includes custom context text and reference file contents.
     *
     * Limits: each file is capped at MAX_FILE_CHARS to prevent context window overflow.
     * Total block is capped at MAX_TOTAL_CHARS across all files.
     */
    private static readonly MAX_FILE_CHARS = 12_000;
    private static readonly MAX_TOTAL_CHARS = 40_000;

    public buildRetrievedActiveModeContextBlock(query: string, transcript?: string, tokenBudget?: number, answerType?: AnswerType, excludeCustomContext?: boolean): string {
        const mode = this.getActiveMode();
        if (!mode) return '';

        const result = this.modeContextRetriever.retrieve(mode, this.getReferenceFiles(mode.id), {
            query,
            transcript,
            tokenBudget,
            answerType,
            excludeCustomContext,
        });

        return result.formattedContext;
    }

    /**
     * Phase 4 — async hybrid retrieval (FTS + vector + dedupe + lexical fallback).
     * Callers in async paths (WhatToAnswerLLM, LLMHelper paths) should prefer
     * this. If hybrid throws (DB missing, embedding provider unavailable),
     * we fall back to the existing sync lexical path so the answer flow
     * never breaks. Telemetry distinguishes hybrid hits from lexical fallback.
     */
    public async buildRetrievedActiveModeContextBlockHybrid(query: string, transcript?: string, tokenBudget?: number, answerType?: AnswerType, excludeCustomContext?: boolean): Promise<string> {
        const mode = this.getActiveMode();
        if (!mode) return '';
        const files = this.getReferenceFiles(mode.id);

        // Telemetry: rag_query / rag_hit / rag_miss / rag_lexical_fallback.
        let usedHybrid = false;
        let usedFallback = false;
        let chunkCount = 0;
        try {
            const { telemetryService } = require('./telemetry/TelemetryService');
            telemetryService.track({
                name: 'rag_query',
                modeId: mode.id,
                properties: { modeTemplateType: mode.templateType, fileCount: files.length, hasTranscript: Boolean(transcript) },
            });
        } catch { /* non-fatal */ }

        try {
            const result = await this.modeContextRetriever.retrieveHybrid(mode, files, {
                query,
                transcript,
                tokenBudget,
                answerType,
            });
            usedHybrid = result.usedHybrid;
            usedFallback = result.usedFallback;
            chunkCount = result.chunks?.length ?? 0;
            if (result.formattedContext) {
                try {
                    const { telemetryService } = require('./telemetry/TelemetryService');
                    telemetryService.track({
                        name: usedHybrid ? 'rag_hit' : 'rag_lexical_fallback',
                        modeId: mode.id,
                        properties: { chunkCount, modeTemplateType: mode.templateType },
                    });
                } catch { /* non-fatal */ }
                return result.formattedContext;
            }
            // Empty hybrid result — fall through to lexical so we still try.
        } catch (err) {
            console.warn('[ModesManager] hybrid retrieval failed, falling back to lexical:', (err as Error)?.message);
        }

        const lexical = this.buildRetrievedActiveModeContextBlock(query, transcript, tokenBudget, answerType, excludeCustomContext);
        try {
            const { telemetryService } = require('./telemetry/TelemetryService');
            telemetryService.track({
                name: lexical ? 'rag_lexical_fallback' : 'rag_miss',
                modeId: mode.id,
                properties: { modeTemplateType: mode.templateType, fileCount: files.length },
            });
        } catch { /* non-fatal */ }
        return lexical;
    }

    /**
     * Phase 6 — summary-safe context block for post-call summarization.
     *
     * Includes the mode's `customContext` (low-token, user-authored, trusted) plus
     * up to a small budget of *retrieved* reference snippets. Never returns full
     * raw reference file bodies, even when retrieval misses — that data path is
     * covered by `buildActiveModeContextBlock()` and remains legacy/supporting.
     *
     * Callers can opt out of the retrieved-snippets portion via
     * `options.includeReferenceSnippets = false` to honor the
     * `reference_files` provider data scope without losing mode customContext.
     */
    public buildSummarySafeModeContextBlock(
        modeId: string,
        options?: { query?: string; transcript?: string; tokenBudget?: number; includeReferenceSnippets?: boolean }
    ): string {
        const mode = this.getModes().find(m => m.id === modeId);
        if (!mode) return '';

        const parts: string[] = [];

        // Summary path is non-negotiation by nature — drop sensitive customContext
        // chunks (salary/pricing/strategy) so they can't land in a stored summary.
        const summaryCustom = dropSensitiveCustomContext(mode.customContext);
        if (summaryCustom) {
            parts.push(`<active_mode_custom_instructions format="json">\n${encodeModeContextPayload({ content: summaryCustom })}\n</active_mode_custom_instructions>`);
        }

        const includeReferenceSnippets = options?.includeReferenceSnippets !== false;
        if (includeReferenceSnippets) {
            try {
                const result = this.modeContextRetriever.retrieve(mode, this.getReferenceFiles(mode.id), {
                    query: options?.query ?? '',
                    transcript: options?.transcript ?? '',
                    tokenBudget: options?.tokenBudget ?? 1200,
                });
                if (result?.formattedContext) {
                    parts.push(result.formattedContext);
                }
            } catch (err) {
                console.warn('[ModesManager] summary-safe retrieval failed (non-fatal):', (err as Error)?.message);
            }
        }

        return parts.length > 0 ? '\n' + parts.join('\n\n') + '\n' : '';
    }

    public buildActiveModeContextBlock(): string {
        const mode = this.getActiveMode();
        if (!mode) return '';

        const parts: string[] = [];

        if (mode.customContext.trim()) {
            parts.push(`<active_mode_custom_instructions format="json">\n${encodeModeContextPayload({ content: mode.customContext.trim() })}\n</active_mode_custom_instructions>`);
        }

        const files = this.getReferenceFiles(mode.id);
        const MARKER = '[...truncated]';
        let totalChars = 0;

        for (const file of files) {
            const raw = file.content.trim();
            if (!raw) continue;

            const remaining = ModesManager.MAX_TOTAL_CHARS - totalChars;
            if (remaining <= 0) break;

            // Cap per-file. Only append the truncation marker when there's
            // headroom for the full marker — never emit a partial '[...truncat'.
            const fileCap = ModesManager.MAX_FILE_CHARS;
            let capped: string;
            if (raw.length > fileCap) {
                if (fileCap > MARKER.length + 1) {
                    capped = raw.slice(0, fileCap - MARKER.length - 1) + '\n' + MARKER;
                } else {
                    capped = raw.slice(0, fileCap);
                }
            } else {
                capped = raw;
            }

            // Apply the cross-file budget. If the slice would split the marker, drop it.
            let content: string;
            if (capped.length <= remaining) {
                content = capped;
            } else if (remaining >= MARKER.length + 1) {
                content = capped.slice(0, remaining - MARKER.length - 1) + '\n' + MARKER;
            } else {
                content = capped.slice(0, remaining);
            }

            const payload = encodeModeContextPayload({ fileName: file.fileName, content });
            parts.push(`<reference_file format="json">\n${payload}\n</reference_file>`);
            totalChars += content.length;
        }

        return parts.join('\n\n');
    }
}
