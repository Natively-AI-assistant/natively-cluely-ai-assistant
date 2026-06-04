import fs from 'fs';
import path from 'path';
import { DatabaseManager } from '../db/DatabaseManager';

export type InterviewAnswerLength = 'Short' | 'Balanced' | 'Detailed';
export type InterviewAnswerTone = 'Direct' | 'Conversational' | 'Confident' | 'Technical';

export interface InterviewRole {
    id: string;
    position: string;
    company: string;
    jobDescription: string;
    companyDescription: string;
    createdAt: string;
    updatedAt: string;
}

export interface InterviewContext {
    id: string;
    roleId: string | null;
    role?: InterviewRole | null;
    resumeText: string;
    resumeFileName: string | null;
    resumeFilePath: string | null;
    optionalContextText: string;
    optionalContextFileName: string | null;
    optionalContextFilePath: string | null;
    modelId: string;
    answerLength: InterviewAnswerLength;
    answerTone: InterviewAnswerTone;
    isLastUsed: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface SaveInterviewContextInput {
    id?: string;
    roleId?: string | null;
    role?: Partial<InterviewRole> | null;
    resumeText?: string;
    resumeFileName?: string | null;
    resumeFilePath?: string | null;
    optionalContextText?: string;
    optionalContextFileName?: string | null;
    optionalContextFilePath?: string | null;
    modelId?: string;
    answerLength?: InterviewAnswerLength;
    answerTone?: InterviewAnswerTone;
    markLastUsed?: boolean;
}

const VALID_LENGTHS = new Set<InterviewAnswerLength>(['Short', 'Balanced', 'Detailed']);
const VALID_TONES = new Set<InterviewAnswerTone>(['Direct', 'Conversational', 'Confident', 'Technical']);

function nowIso(): string {
    return new Date().toISOString();
}

function makeId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value: unknown, maxChars = 80_000): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}\n[...truncated]` : trimmed;
}

function rowToRole(row: any): InterviewRole {
    return {
        id: row.id,
        position: row.position ?? '',
        company: row.company ?? '',
        jobDescription: row.job_description ?? '',
        companyDescription: row.company_description ?? '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToContext(row: any, role?: InterviewRole | null): InterviewContext {
    return {
        id: row.id,
        roleId: row.role_id ?? null,
        role,
        resumeText: row.resume_text ?? '',
        resumeFileName: row.resume_file_name ?? null,
        resumeFilePath: row.resume_file_path ?? null,
        optionalContextText: row.optional_context_text ?? '',
        optionalContextFileName: row.optional_context_file_name ?? null,
        optionalContextFilePath: row.optional_context_file_path ?? null,
        modelId: row.model_id ?? 'gemini-3.1-flash-lite-preview',
        answerLength: VALID_LENGTHS.has(row.answer_length) ? row.answer_length : 'Balanced',
        answerTone: VALID_TONES.has(row.answer_tone) ? row.answer_tone : 'Confident',
        isLastUsed: row.is_last_used === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export class InterviewContextManager {
    private static instance: InterviewContextManager;

    public static getInstance(): InterviewContextManager {
        if (!InterviewContextManager.instance) {
            InterviewContextManager.instance = new InterviewContextManager();
        }
        return InterviewContextManager.instance;
    }

    private get db() {
        const db = DatabaseManager.getInstance().getDb();
        if (!db) throw new Error('Database unavailable');
        return db;
    }

    public getContexts(): InterviewContext[] {
        const rows = this.db.prepare(`
            SELECT c.*, r.id AS r_id, r.position, r.company, r.job_description, r.company_description,
                   r.created_at AS r_created_at, r.updated_at AS r_updated_at
            FROM interview_contexts c
            LEFT JOIN interview_roles r ON r.id = c.role_id
            ORDER BY c.is_last_used DESC, c.updated_at DESC
        `).all() as any[];

        return rows.map(row => {
            const role = row.r_id ? rowToRole({
                id: row.r_id,
                position: row.position,
                company: row.company,
                job_description: row.job_description,
                company_description: row.company_description,
                created_at: row.r_created_at,
                updated_at: row.r_updated_at,
            }) : null;
            return rowToContext(row, role);
        });
    }

    public getActiveContext(): InterviewContext | null {
        const row = this.db.prepare(`
            SELECT c.*, r.id AS r_id, r.position, r.company, r.job_description, r.company_description,
                   r.created_at AS r_created_at, r.updated_at AS r_updated_at
            FROM interview_contexts c
            LEFT JOIN interview_roles r ON r.id = c.role_id
            WHERE c.is_last_used = 1
            ORDER BY c.updated_at DESC
            LIMIT 1
        `).get() as any | undefined;
        if (!row) return null;

        const role = row.r_id ? rowToRole({
            id: row.r_id,
            position: row.position,
            company: row.company,
            job_description: row.job_description,
            company_description: row.company_description,
            created_at: row.r_created_at,
            updated_at: row.r_updated_at,
        }) : null;
        return rowToContext(row, role);
    }

    public saveContext(input: SaveInterviewContextInput): InterviewContext {
        const timestamp = nowIso();
        const roleId = this.upsertRole(input.roleId ?? null, input.role ?? null, timestamp);
        const id = input.id || makeId('ictx');
        const answerLength = VALID_LENGTHS.has(input.answerLength as InterviewAnswerLength) ? input.answerLength! : 'Balanced';
        const answerTone = VALID_TONES.has(input.answerTone as InterviewAnswerTone) ? input.answerTone! : 'Confident';

        const run = this.db.transaction(() => {
            if (input.markLastUsed !== false) {
                this.db.prepare('UPDATE interview_contexts SET is_last_used = 0').run();
            }

            this.db.prepare(`
                INSERT INTO interview_contexts (
                    id, role_id, resume_text, resume_file_name, resume_file_path,
                    optional_context_text, optional_context_file_name, optional_context_file_path,
                    model_id, answer_length, answer_tone, is_last_used, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    role_id = excluded.role_id,
                    resume_text = excluded.resume_text,
                    resume_file_name = excluded.resume_file_name,
                    resume_file_path = excluded.resume_file_path,
                    optional_context_text = excluded.optional_context_text,
                    optional_context_file_name = excluded.optional_context_file_name,
                    optional_context_file_path = excluded.optional_context_file_path,
                    model_id = excluded.model_id,
                    answer_length = excluded.answer_length,
                    answer_tone = excluded.answer_tone,
                    is_last_used = excluded.is_last_used,
                    updated_at = excluded.updated_at
            `).run(
                id,
                roleId,
                normalizeText(input.resumeText),
                input.resumeFileName || null,
                input.resumeFilePath || null,
                normalizeText(input.optionalContextText),
                input.optionalContextFileName || null,
                input.optionalContextFilePath || null,
                input.modelId || 'gemini-3.1-flash-lite-preview',
                answerLength,
                answerTone,
                input.markLastUsed === false ? 0 : 1,
                timestamp,
                timestamp
            );
        });
        run();

        const saved = this.getContexts().find(ctx => ctx.id === id);
        if (!saved) throw new Error('Failed to save interview context');
        return saved;
    }

    public deleteContext(id: string): void {
        this.db.prepare('DELETE FROM interview_contexts WHERE id = ?').run(id);
    }

    public buildPromptBlock(contextId?: string | null, prefs?: { answerLength?: string; answerTone?: string }): string {
        const context = contextId
            ? this.getContexts().find(ctx => ctx.id === contextId)
            : this.getActiveContext();
        if (!context) return '';

        const role = context.role;
        const parts: string[] = [];
        const length = VALID_LENGTHS.has(prefs?.answerLength as InterviewAnswerLength)
            ? prefs!.answerLength
            : context.answerLength;
        const tone = VALID_TONES.has(prefs?.answerTone as InterviewAnswerTone)
            ? prefs!.answerTone
            : context.answerTone;

        parts.push(`<answer_preferences>
Length: ${length}
Tone: ${tone}
Use these preferences only for answer shape. Keep all existing safety, truthfulness, and "speak as the user" rules.
</answer_preferences>`);

        if (role) {
            parts.push(`<target_role>
Position: ${role.position || 'Unknown'}
Company: ${role.company || 'Unknown'}
Job description:
${normalizeText(role.jobDescription, 24_000)}
Company context:
${normalizeText(role.companyDescription, 12_000)}
</target_role>`);
        }

        if (context.resumeText.trim()) {
            parts.push(`<resume_context${context.resumeFileName ? ` file="${context.resumeFileName}"` : ''}>
${normalizeText(context.resumeText, 28_000)}
</resume_context>`);
        }

        if (context.optionalContextText.trim()) {
            parts.push(`<additional_interview_context${context.optionalContextFileName ? ` file="${context.optionalContextFileName}"` : ''}>
${normalizeText(context.optionalContextText, 16_000)}
</additional_interview_context>`);
        }

        if (parts.length === 1 && !role) return '';
        return `<interview_setup_context>\n${parts.join('\n\n')}\n</interview_setup_context>`;
    }

    private upsertRole(roleId: string | null, role: Partial<InterviewRole> | null, timestamp: string): string | null {
        if (!role) return roleId;
        const hasContent = [role.position, role.company, role.jobDescription, role.companyDescription]
            .some(value => typeof value === 'string' && value.trim().length > 0);
        if (!hasContent) return roleId;

        const id = role.id || roleId || makeId('irole');
        this.db.prepare(`
            INSERT INTO interview_roles (id, position, company, job_description, company_description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                position = excluded.position,
                company = excluded.company,
                job_description = excluded.job_description,
                company_description = excluded.company_description,
                updated_at = excluded.updated_at
        `).run(
            id,
            normalizeText(role.position, 2_000),
            normalizeText(role.company, 2_000),
            normalizeText(role.jobDescription, 32_000),
            normalizeText(role.companyDescription, 16_000),
            timestamp,
            timestamp
        );
        return id;
    }

    public async extractFile(filePath: string): Promise<{ text: string; fileName: string; filePath: string; extension: string }> {
        const resolved = path.resolve(filePath);
        if (!fs.existsSync(resolved)) {
            throw new Error('File not found');
        }

        const extension = path.extname(resolved).toLowerCase();
        const fileName = path.basename(resolved);
        let text = '';

        if (extension === '.pdf') {
            const pdfParse = require('pdf-parse');
            const buffer = fs.readFileSync(resolved);
            const data = await pdfParse(buffer);
            text = data.text || '';
        } else if (extension === '.docx' || extension === '.doc') {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ path: resolved });
            text = result.value || '';
        } else if (extension === '.txt' || extension === '.md' || extension === '') {
            text = fs.readFileSync(resolved, 'utf8');
        } else {
            throw new Error('Unsupported file type. Use PDF, DOCX, DOC, TXT, or MD.');
        }

        return {
            text: normalizeText(text, 80_000),
            fileName,
            filePath: resolved,
            extension,
        };
    }
}
