import * as crypto from 'crypto';
import { DatabaseManager } from '../db/DatabaseManager';
import type { EmbeddingPipeline } from '../rag/EmbeddingPipeline';
import { ModeContextRetriever, type ModeRetrievalOptions, type RetrieveOptions } from './ModeContextRetriever';
import type { ModeRetrievedContext as HybridContext } from './modes/ModeHybridRetriever';
import type { AnswerType } from '../llm/AnswerPlanner';
import type { ActiveModeInfo } from '../llm/modeProfiles';
import { classifyCustomContext, selectCustomContextForAnswer } from '../llm/customContextClassifier';
import { diagLog } from '../llm/documentGroundedPrompt';
import {
    type ModeSourceContract,
    defaultSourceContractForNewMode,
    migrateSourceContractFromPrompt,
    parseModeSourceContract,
    serializeModeSourceContract,
    documentGroundedFromContract,
} from './modeSourceContract';

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

/**
 * OKF Profile Intelligence (migration v23): the reserved mode profile OKF packs
 * hang off. Never a user mode — filtered from getModes(), rejected by
 * setActiveMode. Kept in sync with ProfilePackBuilder.PROFILE_OKF_MODE_ID.
 */
export const PROFILE_OKF_RESERVED_MODE_ID = '__profile_okf__';

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
    /**
     * Persisted, explicit, typed source policy (real-custom-mode-repair,
     * 2026-07-11). `null` for a mode that has never been migrated/set — callers
     * should treat null as "not yet resolved" and call
     * ModesManager.getOrMigrateSourceContract(id) rather than assume a default.
     */
    sourceContract: ModeSourceContract | null;
}

export interface ModeReferenceFile {
    id: string;
    modeId: string;
    fileName: string;
    content: string;
    createdAt: string;
    /** Real page count reported by the PDF parser (pdf-parse@2.x `data.total`).
     *  Only set for `.pdf` uploads; undefined for txt/md/docx. */
    pageCount?: number;
    /** Number of pages from which text was actually extracted (a subset of
     *  `pageCount` when some pages are image-only / blank). Only set for PDFs. */
    extractedPageCount?: number;
}

export interface ModeNoteSection {
    id: string;
    modeId: string;
    title: string;
    description: string;
    sortOrder: number;
    createdAt: string;
    /** AI-compiled extraction instruction for this section (cached). Empty = use title+description. */
    compiledPrompt?: string;
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
        { title: 'What changed', description: 'Concrete outcomes, updates, or shifts from the meeting — not generic discussion.' },
        { title: 'Decisions', description: 'Confirmed decisions only. Do not include options that were merely discussed.' },
        { title: 'Action items', description: 'Follow-ups with owner/deadline when present. Mark unknown owner/deadline as absent.' },
        { title: 'Open questions', description: 'Questions that remain unresolved, deferred, or need follow-up.' },
        { title: 'Risks / blockers', description: 'Blockers, dependencies, privacy concerns, timeline risks, or unresolved constraints.' },
        { title: 'Notes', description: 'Useful supporting context that does not fit a stronger outcome section.' },
    ],
    'team-meet': [
        { title: 'Progress since last sync', description: 'Team member progress, shipped work, changed status, and notable updates.' },
        { title: 'Decisions', description: 'Decisions and agreements reached by the team.' },
        { title: 'Owners and next steps', description: 'Concrete next steps, owners, dependencies, and deadlines if stated.' },
        { title: 'Blockers', description: 'Anything blocked, delayed, at risk, or requiring escalation.' },
        { title: 'Dependencies', description: 'Cross-team handoffs, external dependencies, or sequencing constraints.' },
        { title: 'Follow-up needed', description: 'Follow-ups that should happen after the meeting even if not assigned.' },
    ],
    sales: [
        { title: 'Account context', description: 'Company, stakeholders, use case, team size, current workflow, and business context.' },
        { title: 'Pain points', description: 'Customer pain, needs, current gaps, and why the problem matters.' },
        { title: 'Buying signals', description: 'Positive intent, urgency, evaluation signals, pilot/trial interest, or expansion signals.' },
        { title: 'Objections', description: 'Concerns about price, competitors, timing, security, procurement, or fit.' },
        { title: 'Budget / timeline / authority', description: 'Budget, approval process, economic buyer, timeline, procurement, or decision criteria.' },
        { title: 'Next steps', description: 'Specific sales follow-ups, owners, deadlines, and promised materials.' },
        { title: 'Follow-up email', description: 'Facts that should be included in a concise customer follow-up email.' },
    ],
    recruiting: [
        { title: 'Candidate profile', description: 'Candidate background, experience, current role, motivations, and logistics.' },
        { title: 'Role fit', description: 'Evidence for or against fit with the role, team, and level.' },
        { title: 'Strengths', description: 'Concrete strengths shown in answers or experience.' },
        { title: 'Concerns', description: 'Risks, gaps, inconsistencies, or follow-up areas.' },
        { title: 'Compensation / logistics', description: 'Compensation, notice period, availability, location, visa, timeline, or constraints.' },
        { title: 'Next steps', description: 'Recruiting follow-ups, owners, deadlines, next interview stage, or materials.' },
        { title: 'Follow-up draft', description: 'Information that should appear in the recruiter or candidate follow-up.' },
    ],
    'technical-interview': [
        { title: 'Problem discussed', description: 'Problem statement, constraints, clarifications, and target outcome.' },
        { title: 'Approach', description: 'Candidate approach, algorithm, system design, alternatives, and tradeoffs.' },
        { title: 'Correctness', description: 'Correctness reasoning, edge cases, bugs found, or unresolved correctness issues.' },
        { title: 'Complexity', description: 'Time/space complexity, scaling assumptions, and performance tradeoffs.' },
        { title: 'Code quality', description: 'Implementation quality, readability, structure, testing, and maintainability.' },
        { title: 'Communication', description: 'How clearly the candidate explained reasoning and handled feedback.' },
        { title: 'Strengths', description: 'Concrete positive signals from the interview.' },
        { title: 'Weaknesses', description: 'Concrete gaps, missed cases, or areas to improve.' },
        { title: 'Hiring signal', description: 'Overall hire/no-hire signal and evidence; avoid inventing a final decision.' },
        { title: 'Follow-up', description: 'Next steps, additional questions, take-home, or interviewer follow-up.' },
    ],
    lecture: [
        { title: 'Core concepts', description: 'Main concepts, frameworks, and claims from the lecture.' },
        { title: 'Definitions', description: 'Terms, definitions, formulas, and distinctions introduced.' },
        { title: 'Examples', description: 'Concrete examples, analogies, demonstrations, or case studies.' },
        { title: 'Formulas / steps', description: 'Procedures, equations, workflows, or step-by-step methods.' },
        { title: 'Things to memorize', description: 'Facts, definitions, formulas, or lists that should be memorized.' },
        { title: 'Confusing points', description: 'Ambiguous or confusing ideas that need review.' },
        { title: 'Questions to review', description: 'Open questions, exam prep prompts, or self-study questions.' },
        { title: 'Study summary', description: 'Concise study-focused recap of what matters most.' },
    ],
    'looking-for-work': [
        { title: 'Opportunity summary', description: 'Company, role, team, interview stage, and opportunity context.' },
        { title: 'Company / role details', description: 'Role responsibilities, compensation, logistics, process, and requirements.' },
        { title: 'Fit signals', description: 'Evidence that my experience or preferences fit the opportunity.' },
        { title: 'Concerns', description: 'Risks, gaps, objections, or areas to prepare for.' },
        { title: 'Referral / follow-up', description: 'Referral requests, thank-you notes, materials to send, or networking follow-up.' },
        { title: 'Next steps', description: 'Concrete next steps, owners, dates, and preparation items.' },
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

// OKF Phase 7: reference-file content length threshold above which
// KnowledgeManager.generateForFile (deterministic extraction) is routed
// through KnowledgeIndexQueue's background path instead of running
// synchronously inline with addReferenceFile. 300k chars ≈ 150-200 pages of
// dense text — well above the 66-page/128k-char benchmark thesis this
// feature was tuned against (which stays comfortably on the synchronous
// path, preserving existing test/smoke-script assumptions that the pack is
// queryable immediately after addReferenceFile returns).
const OKF_BACKGROUND_INDEX_THRESHOLD_CHARS = 300_000;

const DOCUMENT_SOURCE_RE = /\b(uploaded|attached|provided|reference|source material|course material|seminar material|lecture material|presentation|slides?|deck|papers?|pdfs?|files?|documents?|docs?|notes?|attached material|uploaded content|provided material)\b/i;
// Broadened 2026-07-05 (code-review audit) after confirming false negatives on
// realistic, clearly-grounded user phrasings: "Please only answer based on the
// PDF I uploaded" (based-on...I-uploaded word order), "Stick strictly to the
// material in the file" ("stick to" not immediately adjacent to "the X"),
// "Only reference what is in the notes, do not add anything not written there"
// (no exact-phrase match), "always check the file first before answering" (a
// very common plain-English grounding instruction with no prior alternative
// at all). Each addition below is anchored to an explicit source noun so it
// still requires unambiguous document-grounding intent, not just any
// restrictive-sounding sentence.
const DOCUMENT_CONSTRAINT_RE = /\b(source[-\s]?of[-\s]?truth|from the files?|from the documents?|from the uploaded|answer(?:s|ing)?\s+from\s+(?:the\s+)?(?:uploaded|attached|provided|reference|files?|documents?)|based on (?:uploaded|provided|attached|the\s+(?:uploaded|attached|provided|reference)|my\s+(?:uploaded|attached|provided|reference|files?|documents?|docs?|notes?|papers?|slides?|presentation))|based on the [a-z]+ i(?:'ve| have)?\s+(?:uploaded|attached|provided|shared|given)|use only|only use|only reference|only rely|rely only|use\s+the\s+(?:uploaded|attached|provided|reference|files?|documents?|docs?|notes?|papers?|slides?|presentation)|(?:stick to|restrict to|limit to|draw from)(?:\s+\w+){0,2}\s+(?:the\s+)?(?:uploaded|attached|provided|reference|files?|documents?|docs?|notes?|papers?|slides?|presentation|material)|(?:material|content|info(?:rmation)?)\s+in\s+the\s+(?:file|document|pdf|notes?|slides?|presentation)|do not use knowledge outside|(?:don['’]?t|do not)\s+(?:use|rely on|draw on|add)\s+(?:anything\s+)?(?:outside|beyond|other than|not\s+(?:written|mentioned|present|found)\s+(?:there|in))|ground(?:ed)? (?:your )?answers? in|ground(?:ed)? in|(?:check|read|refer to|consult|verify|look at)\s+the\s+(?:file|document|pdf|notes?|slides?|presentation|material)\s+(?:first|before))\b/i;

export interface ActiveModeDocumentGroundingInfo {
    isCustom: boolean;
    hasReferenceFiles: boolean;
    documentGrounded: boolean;
    /**
     * Authoritative runtime guard for user-created custom modes whose own prompt
     * makes uploaded/reference files the source of truth. This is intentionally
     * stricter than `documentGrounded` so callers can key source precedence and
     * profile suppression off one flag instead of re-deriving the four conditions.
     */
    documentGroundedCustomModeActive: boolean;
    modeId?: string;
    modeName?: string;
    hasCustomPrompt: boolean;
    /** The mode's persisted, explicit source policy (real-custom-mode-repair). */
    sourceContract: ModeSourceContract;
}

export function isCustomMode(mode: Pick<Mode, 'templateType' | 'name'> | null | undefined): boolean {
    return !!mode && mode.templateType === 'general' && mode.name !== 'General';
}

export function detectCustomModeDocumentGrounding(customPrompt: string): boolean {
    const prompt = customPrompt || '';
    return DOCUMENT_SOURCE_RE.test(prompt) && DOCUMENT_CONSTRAINT_RE.test(prompt);
}

function rowToMode(row: any): Mode {
    return {
        id: row.id,
        name: row.name,
        templateType: row.template_type as ModeTemplateType,
        customContext: row.custom_context ?? '',
        isActive: row.is_active === 1,
        createdAt: row.created_at,
        sourceContract: parseModeSourceContract(row.source_contract_json),
    };
}

function rowToFile(row: any): ModeReferenceFile {
    return {
        id: row.id,
        modeId: row.mode_id,
        fileName: row.file_name,
        content: row.content ?? '',
        createdAt: row.created_at,
        // Round-trip PDF page counts (DB stores snake_case columns; the
        // 2026-06-27 v18→v19 migration adds these columns and the
        // IPC handler fills them in for .pdf uploads only).
        pageCount: typeof row.page_count === 'number' ? row.page_count : undefined,
        extractedPageCount: typeof row.extracted_page_count === 'number' ? row.extracted_page_count : undefined,
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
        compiledPrompt: row.compiled_prompt || undefined,
    };
}

export class ModesManager {
    private static instance: ModesManager;
    private readonly modeContextRetriever = new ModeContextRetriever();
    /** Normalized [0,1] top-score confidence from the most recent
     *  buildRetrievedActiveModeContextBlock call. Read by the doc-grounded
     *  false-refusal gate. See getLastRetrievalConfidence. */
    private lastRetrievalConfidence = 0;

    private constructor() {}

    public static getInstance(): ModesManager {
        if (!ModesManager.instance) {
            ModesManager.instance = new ModesManager();
        }
        return ModesManager.instance;
    }

    // ── Modes ─────────────────────────────────────────────────────

    public getModes(): Mode[] {
        const modes = DatabaseManager.getInstance().getModes()
            // OKF Profile Intelligence (2026-07-02): the '__profile_okf__' reserved
            // mode (template_type '__reserved__', migration v23) exists ONLY to
            // satisfy the knowledge_packs.mode_id NOT NULL + FK constraint for profile
            // OKF packs. It is not a user-facing mode and must never appear in the
            // mode list, be pinnable/activatable, or be matched by document-grounded
            // retrieval's getPacksByModeId — filter it out at the single read choke
            // point so every downstream consumer (UI list, resolveMode, retrieval)
            // is transparently protected.
            .filter((row: any) => row.template_type !== '__reserved__')
            .map(rowToMode);

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

    // ── Pinned-mode resolution (audit finding #6) ─────────────────
    // The live answer path captures the active mode ONCE at t0 (the
    // WhatToAnswerRequestSnapshot) and the prompt builders below take an
    // optional `pinnedModeId` so they read the SAME mode the answer contract was
    // planned from — even if `modes:set-active` flips the active mode while the
    // request is parked at an await. When no id is pinned (every existing
    // caller) this returns the live active mode, so behavior is unchanged.
    private resolveMode(pinnedModeId?: string): Mode | null {
        if (pinnedModeId) {
            const pinned = this.getModes().find(m => m.id === pinnedModeId);
            // Fall back to the active mode only if the pinned mode was deleted
            // mid-request (rare); otherwise the pinned mode wins.
            if (pinned) return pinned;
        }
        return this.getActiveMode();
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
        if (mode) {
            const grounding = this.getActiveModeDocumentGroundingInfo(mode.id);
            this._activeModeInfoCache = {
                id: mode.id,
                templateType: mode.templateType,
                name: mode.name,
                isCustom: isCustomMode(mode),
                hasReferenceFiles: grounding.hasReferenceFiles,
                hasCustomPrompt: grounding.hasCustomPrompt,
                documentGrounded: grounding.documentGrounded,
                documentGroundedCustomModeActive: grounding.documentGroundedCustomModeActive,
                sourceContract: grounding.sourceContract,
            };
        } else {
            this._activeModeInfoCache = null;
        }
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
        const initialContract = defaultSourceContractForNewMode();
        DatabaseManager.getInstance().createMode({
            id,
            name: params.name,
            templateType: params.templateType,
            customContext: '',
            sourceContractJson: serializeModeSourceContract(initialContract),
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
        // Compile extraction instructions for all seeded sections in parallel (fire-and-forget,
        // bounded concurrency). Never blocks mode creation / UI.
        this.compileAllSectionsAsync(id);
        return {
            id,
            name: params.name,
            templateType: params.templateType,
            customContext: '',
            isActive: false,
            createdAt: new Date().toISOString(),
            sourceContract: initialContract,
        };
    }

    public updateMode(id: string, updates: { name?: string; templateType?: ModeTemplateType; customContext?: string; sourceContract?: ModeSourceContract }): void {
        const { sourceContract, ...rest } = updates;
        DatabaseManager.getInstance().updateMode(id, {
            ...rest,
            ...(sourceContract !== undefined ? { sourceContractJson: serializeModeSourceContract(sourceContract) } : {}),
        });
        this.invalidateActiveModeCache();
    }

    /**
     * Returns this mode's persisted ModeSourceContract, migrating it ONCE from
     * legacy prompt-text heuristics (and persisting the result) if the mode has
     * never had an explicit contract saved. This is the ONLY place the legacy
     * regex-based heuristic still runs — after the first call for a given mode,
     * the contract is stable and read verbatim from the database, closing the
     * root cause of the P0 contamination incident (a mode's grounding behavior
     * silently re-deriving, and potentially flipping, on every single turn).
     */
    public getOrMigrateSourceContract(modeId: string): ModeSourceContract {
        const mode = this.resolveMode(modeId);
        if (!mode) return defaultSourceContractForNewMode();
        const files = this.getReferenceFiles(mode.id);
        const hasReferenceFiles = files.some(file => file.content.trim());
        const hasCustomPrompt = mode.customContext.trim().length > 0;
        // Real-benchmark finding (2026-07-11): createMode() seeds every new
        // mode with defaultSourceContractForNewMode() (origin='default_new_mode')
        // AT CREATION TIME, before the user has written a prompt or attached
        // any reference file. A naive "if mode.sourceContract, return it"
        // check would short-circuit HERE and never migrate — permanently
        // freezing every mode at the empty-mode default (defaultOwner=
        // 'clarify'), regardless of what prompt/files get added afterward.
        // This is the incident's failure class recurring one layer up: a
        // stale cached decision silently overriding the mode's real content.
        // Fix: a 'default_new_mode' contract is NOT yet a real decision — it
        // is re-migrated (and the migration persisted, replacing the seed)
        // once the mode actually HAS a prompt or files to migrate from. A
        // 'user_selected' or previously-completed 'migrated_from_prompt'
        // contract is never re-derived (stable, as designed).
        const needsMigration = !mode.sourceContract
            || (mode.sourceContract.origin === 'default_new_mode' && (hasCustomPrompt || hasReferenceFiles));
        if (!needsMigration) return mode.sourceContract!;
        // Profile-facts availability is not known to ModesManager (it lives in
        // KnowledgeOrchestrator/profile services); migration only needs to
        // distinguish "has files" from "no files" for its decision tree — see
        // docs/context-os/real-custom-mode-repair/05_PRODUCT_SOURCE_POLICY.md.
        // A profile-only migration branch is intentionally conservative
        // (defaults to `clarify`) when this signal is unavailable at migration
        // time; a caller with profile-facts knowledge may pass it via
        // migrateSourceContractFromPrompt directly if a tighter migration is
        // later needed.
        const migrated = migrateSourceContractFromPrompt({
            customContext: mode.customContext,
            hasReferenceFiles,
            hasProfileFacts: false,
        });
        this.updateMode(mode.id, { sourceContract: migrated });
        return migrated;
    }

    public deleteMode(id: string): void {
        // PI v3 (W3): mode_reference_files rows go via FK CASCADE, but the
        // persisted chunk vectors (mode_reference_chunks / index_state) have no
        // FK on purpose (the table is owned by the retriever) — drop them
        // explicitly BEFORE the cascade removes the file rows we enumerate.
        //
        // CORRECTION (OKF hardening pass, 2026-07-01): this codebase never
        // runs `PRAGMA foreign_keys = ON` (confirmed zero references
        // anywhere in electron/), so declared FK CASCADE clauses are
        // actually inert — `DatabaseManager.deleteMode` below is a bare
        // `DELETE FROM modes` that does NOT remove `mode_reference_files`
        // rows either. That's a pre-existing gap outside OKF's scope to fix
        // wholesale here; explicitly clean up the OKF knowledge_* rows for
        // this mode's reference files, same reasoning as the chunk-vector
        // cleanup right below.
        try {
            const { KnowledgeManager } = require('./knowledge/KnowledgeManager');
            KnowledgeManager.getInstance().deleteForMode(id);
        } catch (err: any) {
            console.warn('[ModesManager] OKF knowledge cleanup on deleteMode skipped (non-fatal):', err?.message);
        }
        try {
            for (const file of this.getReferenceFiles(id)) {
                this.modeContextRetriever.removeReferenceFileIndex(file.id);
            }
        } catch { /* non-fatal — orphans are disk bloat, not correctness */ }
        DatabaseManager.getInstance().deleteMode(id);
        this.invalidateActiveModeCache();
    }

    public setActiveMode(id: string | null): void {
        // OKF Profile Intelligence (2026-07-02): the reserved '__profile_okf__'
        // mode (migration v23) exists ONLY to satisfy the knowledge_packs.mode_id
        // FK for profile OKF packs. It is filtered out of getModes(), so a
        // renderer's modes:set-active would look it up as `undefined` and skip the
        // pro-gate — but the DB row still exists, so an UPDATE would activate a
        // phantom mode that no longer appears in the list to switch away from.
        // Reject it (and any future reserved mode) here at the single write choke
        // point so it can never become active/pinned.
        if (id === PROFILE_OKF_RESERVED_MODE_ID) {
            console.warn('[ModesManager] setActiveMode: refusing to activate the reserved profile OKF mode');
            return;
        }
        DatabaseManager.getInstance().setActiveMode(id);
        this.invalidateActiveModeCache();
    }

    // ── Reference Files ───────────────────────────────────────────

    public getReferenceFiles(modeId: string): ModeReferenceFile[] {
        return DatabaseManager.getInstance().getReferenceFiles(modeId).map(rowToFile);
    }

    public addReferenceFile(params: {
        modeId: string;
        fileName: string;
        content: string;
        pageCount?: number;
        extractedPageCount?: number;
    }): ModeReferenceFile {
        const id = `ref_${crypto.randomUUID()}`;
        // FIX 2026-07-01: forward pageCount + extractedPageCount to the DB.
        // Previously these fields were accepted on the input params but dropped
        // before the INSERT, leaving NULL page_count on every row written after
        // the v18→v19 migration. Upstream consumers (ModeContextRetriever
        // reportReferenceFilePageCounts telemetry) then triggered their
        // 3000-char heuristic instead of using the real pdf-parse-extracted
        // count. Round 1 — see also v22 backfill migration for existing rows.
        DatabaseManager.getInstance().addReferenceFile({
            id,
            modeId: params.modeId,
            fileName: params.fileName,
            content: params.content,
            pageCount: params.pageCount,
            extractedPageCount: params.extractedPageCount,
        });
        this.invalidateActiveModeCache();
        // OKF Phase 2/7 (2026-07-01): generate a Knowledge Pack alongside the
        // existing chunk pipeline. Heuristic v1 extraction is pure string
        // work — fast enough on typical documents (~2-5s on the 66-page
        // benchmark thesis) to run synchronously without a perceptible
        // upload-UI stall, but for a genuinely large document (the exact
        // case KnowledgeIndexQueue's background path exists for — see its
        // header comment) blocking would be user-visible. Route through
        // KnowledgeIndexQueue.generateForFileInBackground for content over
        // OKF_BACKGROUND_INDEX_THRESHOLD_CHARS; small/typical files stay
        // synchronous so callers (including this method's own return value
        // and the existing test/smoke-script suite) can rely on the pack
        // being queryable immediately after addReferenceFile returns, same
        // as before this change. A thrown error is caught and logged inside
        // generateForFile itself (returns {status:'failed'}, never throws)
        // and additionally guarded here. No-ops when okfKnowledgePacks is
        // OFF (production default) — the flag is checked HERE, before the
        // sync-vs-background routing, so a large-document upload with the
        // feature off never even enqueues a background job (senior review
        // MEDIUM, 2026-07-01: previously generateForFileInBackground was
        // invoked unconditionally for >300k content and only generateForFile
        // INSIDE checked the flag, so a flag-off large upload still spun up a
        // queue promise + broadcast queued/running/done progress events for
        // nothing). The synchronous branch was already safe — generateForFile
        // short-circuits on the flag — but gating up front keeps the chunk
        // path completely untouched when OKF is off.
        try {
            const { isOkfKnowledgePacksEnabled } = require('../intelligence/intelligenceFlags') as typeof import('../intelligence/intelligenceFlags');
            if (isOkfKnowledgePacksEnabled()) {
                const { KnowledgeManager } = require('./knowledge/KnowledgeManager') as typeof import('./knowledge/KnowledgeManager');
                const fileInput = {
                    id, modeId: params.modeId, fileName: params.fileName, content: params.content,
                    pageCount: params.pageCount, extractedPageCount: params.extractedPageCount,
                };
                if (params.content.length > OKF_BACKGROUND_INDEX_THRESHOLD_CHARS) {
                    void KnowledgeManager.getInstance().generateForFileInBackground(fileInput).catch((err: any) => {
                        console.warn('[ModesManager] OKF background knowledge pack generation failed (non-fatal):', err?.message);
                    });
                } else {
                    KnowledgeManager.getInstance().generateForFile(fileInput);
                }
            }
        } catch (err: any) {
            console.warn('[ModesManager] OKF knowledge pack generation skipped (non-fatal):', err?.message);
        }
        return {
            id,
            modeId: params.modeId,
            fileName: params.fileName,
            content: params.content,
            createdAt: new Date().toISOString(),
            pageCount: params.pageCount,
            extractedPageCount: params.extractedPageCount,
        };
    }

    public deleteReferenceFile(id: string): void {
        DatabaseManager.getInstance().deleteReferenceFile(id);
        this.invalidateActiveModeCache();
        // PI v3 (W3): drop the persisted chunk vectors + index state too.
        try { this.modeContextRetriever.removeReferenceFileIndex(id); } catch { /* non-fatal */ }
        // OKF Phase 2: invalidate the file's Knowledge Pack (the knowledge_*
        // tables also cascade-delete via FK on mode_reference_files deletion,
        // but this explicit call makes the intent visible and works even if
        // FK cascading is disabled in a given SQLite build).
        try {
            const { KnowledgeManager } = require('./knowledge/KnowledgeManager') as typeof import('./knowledge/KnowledgeManager');
            KnowledgeManager.getInstance().deleteForFile(id);
        } catch (err: any) {
            console.warn('[ModesManager] OKF knowledge pack invalidation skipped (non-fatal):', err?.message);
        }
    }

    // ── PI v3 (W3): upload-time reference-file indexing ───────────
    // Chunk + embed + persist a file's vectors so the per-question hot path
    // embeds ONLY the live query. Fire-and-forget from upload/activation; the
    // retriever degrades to lexical for any file that isn't 'ready' yet.

    /** Index one reference file (idempotent — re-embeds only on content/space change). */
    public async indexReferenceFile(file: ModeReferenceFile): Promise<void> {
        await this.modeContextRetriever.indexReferenceFile(file);
    }

    /** Wire the RAGManager EmbeddingPipeline into the mode hybrid retriever. */
    public setSharedEmbeddingPipeline(pipeline: EmbeddingPipeline): void {
        this.modeContextRetriever.setSharedEmbeddingPipeline(pipeline);
    }

    /** Re-index files that fell back before the embedding provider became ready,
     *  OR whose stored vectors are in a now-stale embedding space (fallback
     *  promotion flips the active space; getFileIndexStatus reports those 'ready'
     *  files as 'pending', which retryLexicalOnlyFiles re-indexes — MEDIUM #3).
     *
     *  MEDIUM #2: only descend into a mode when at least one of its files is in a
     *  retry-eligible state, so a user with many fully-indexed modes doesn't pay
     *  an O(modes × files) re-scan + per-file indexFile entry on every kick. */
    public async retryAllLexicalOnlyFiles(): Promise<void> {
        const RETRY_ELIGIBLE = new Set(['lexical_only', 'failed', 'pending']);
        for (const mode of this.getModes()) {
            const files = this.getReferenceFiles(mode.id);
            if (files.length === 0) continue;
            // Cheap status read (no embedding work) gates the expensive retry.
            const hasEligible = files.some(f => {
                try {
                    return RETRY_ELIGIBLE.has(this.modeContextRetriever.getReferenceFileIndexStatus(f.id).status);
                } catch {
                    return true; // status lookup failed → let the retry decide
                }
            });
            if (!hasEligible) continue;
            await this.modeContextRetriever.retryLexicalOnlyFiles(files).catch(() => { /* logged inside */ });
        }
    }

    /** Modes that have at least one retry-eligible reference file. Used by the
     *  main process to broadcast 'done' only for modes that were actually
     *  re-indexed (LOW #8), instead of spamming every mode on every kick. */
    public getModesWithRetryEligibleFiles(): string[] {
        const RETRY_ELIGIBLE = new Set(['lexical_only', 'failed', 'pending']);
        const out: string[] = [];
        for (const mode of this.getModes()) {
            const files = this.getReferenceFiles(mode.id);
            if (files.length === 0) continue;
            const hasEligible = files.some(f => {
                try {
                    return RETRY_ELIGIBLE.has(this.modeContextRetriever.getReferenceFileIndexStatus(f.id).status);
                } catch {
                    return true;
                }
            });
            if (hasEligible) out.push(mode.id);
        }
        return out;
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
        // Phase 3: warm the local cross-encoder reranker at activation so the
        // first LIVE transcript turn never pays the cold-load cost inside its
        // retrieval budget. Only when the reranker is actually enabled — never
        // load a model nobody will use. Fire-and-forget, best-effort.
        //
        // Lazy download (2026-07-06): if the model isn't on disk yet, trigger
        // a background download via LocalModelDownloadService. The download is
        // idempotent — a parallel request from another mode activation just
        // attaches to the same in-flight download. When it completes,
        // prewarm() is fired so the reranker activates without the user
        // having to reload the mode.
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { isRagLocalRerankEnabled } = require('../intelligence/intelligenceFlags');
            if (files.length > 0 && isRagLocalRerankEnabled()) {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { getLocalReranker } = require('../rag/LocalReranker');
                const reranker = getLocalReranker();
                void (async () => {
                    try {
                        const cached = await reranker.isCached();
                        if (cached) {
                            void reranker.prewarm?.();
                            return;
                        }
                        // Not cached — kick off a background download. The
                        // download service handles progress + persistence; we
                        // just attach a one-shot prewarm on completion.
                        try {
                            // eslint-disable-next-line @typescript-eslint/no-var-requires
                            const { LocalModelDownloadService } = require('./LocalModelDownloadService');
                            // eslint-disable-next-line @typescript-eslint/no-var-requires
                            const { RERANKER_PROVIDER_NAME } = require('../rag/rerankerDownloadProvider');
                            // eslint-disable-next-line @typescript-eslint/no-var-requires
                            const { RERANKER_MODEL_ID, RERANKER_DTYPE } = require('../rag/rerankerDownloadProvider');
                            void LocalModelDownloadService.getInstance().start(
                                RERANKER_PROVIDER_NAME,
                                `${RERANKER_MODEL_ID}#${RERANKER_DTYPE}`,
                            );
                        } catch {
                            // Service unavailable or download failed — fall
                            // back to the old prewarm path. If the model is
                            // not on disk, prewarm will fail silently and the
                            // reranker will return null on first query.
                            void reranker.prewarm?.();
                        }
                    } catch { /* prewarm-or-download both non-fatal */ }
                })();
            }
        } catch { /* non-fatal — prewarm is an optimization, not a requirement */ }
    }

    /** Per-file index status for the Modes Manager UI badges. */
    public getReferenceFileIndexStatuses(modeId: string): Array<{ fileId: string; fileName: string; status: string; chunkCount: number }> {
        return this.getReferenceFiles(modeId).map(file => ({
            fileId: file.id,
            fileName: file.fileName,
            ...this.modeContextRetriever.getReferenceFileIndexStatus(file.id),
        }));
    }

    /** Single-file index status lookup — used by IPC handlers to decide whether to
     *  schedule a retry when a freshly-uploaded file lands in 'failed'/'lexical_only'. */
    public getReferenceFileIndexStatus(fileId: string): { status: string; chunkCount: number } {
        return this.modeContextRetriever.getReferenceFileIndexStatus(fileId);
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
        // Fire-and-forget: compile a tailored extraction instruction for this section so
        // future summaries fill it faithfully. Never blocks the caller / UI.
        this.compileSectionPromptAsync(id, params.modeId, params.title, params.description);
        return {
            id,
            modeId: params.modeId,
            title: params.title,
            description: params.description,
            sortOrder,
            createdAt: new Date().toISOString(),
        };
    }

    public updateNoteSection(id: string, updates: { title?: string; description?: string; compiledPrompt?: string }): void {
        DatabaseManager.getInstance().updateNoteSection(id, updates);
        // If the section's meaning changed (title/description), recompile its instruction.
        // Skip when we are only writing the compiledPrompt itself (avoids a loop).
        if ((updates.title !== undefined || updates.description !== undefined) && updates.compiledPrompt === undefined) {
            const owner = DatabaseManager.getInstance().getNoteSectionOwnerMode(id);
            if (owner) {
                this.compileSectionPromptAsync(id, owner.modeId, updates.title ?? owner.title, updates.description ?? owner.description);
            }
        }
    }

    public deleteNoteSection(id: string): void {
        DatabaseManager.getInstance().deleteNoteSection(id);
    }

    /**
     * Compile + cache the AI extraction instruction for a section. Fire-and-forget;
     * resolves silently. Requires an LLMHelper (set via setLlmHelperForCompiler); if absent
     * or scope-denied, leaves compiled_prompt empty so the extractor uses title+description.
     */
    private compileSectionPromptAsync(sectionId: string, modeId: string, title: string, description: string): void {
        void (async () => {
            try {
                const llmHelper = ModesManager.llmHelperForCompiler;
                if (!llmHelper) return; // compiler not available in this context
                // Scope gate: never call a cloud LLM for prompt compilation when post_call_summary
                // is denied (the deterministic fallback covers it at summary time).
                try {
                    const { SettingsManager } = require('./SettingsManager');
                    const scope = SettingsManager.getInstance().get('providerDataScopes');
                    if (scope?.post_call_summary === false) return;
                } catch { /* default allow */ }
                const mode = this.getModes().find(m => m.id === modeId);
                const { SectionPromptCompiler } = require('./meeting/SectionPromptCompiler');
                const { instruction, compiled } = await new SectionPromptCompiler(llmHelper).compile({
                    sectionTitle: title,
                    sectionDescription: description,
                    meetingMode: mode?.templateType,
                });
                if (compiled && instruction) {
                    DatabaseManager.getInstance().updateNoteSection(sectionId, { compiledPrompt: instruction });
                }
            } catch (e) {
                console.warn('[ModesManager] section prompt compile skipped (non-fatal):', (e as any)?.message);
            }
        })();
    }

    /**
     * Compile extraction instructions for EVERY section of a mode, in parallel with bounded
     * concurrency. Used when a custom mode is created (many sections at once). Fire-and-forget.
     */
    public compileAllSectionsAsync(modeId: string): void {
        void (async () => {
            try {
                const llmHelper = ModesManager.llmHelperForCompiler;
                if (!llmHelper) return;
                try {
                    const { SettingsManager } = require('./SettingsManager');
                    if (SettingsManager.getInstance().get('providerDataScopes')?.post_call_summary === false) return;
                } catch { /* default allow */ }
                const mode = this.getModes().find(m => m.id === modeId);
                const sections = this.getNoteSections(modeId).filter(s => !s.compiledPrompt || !s.compiledPrompt.trim());
                if (sections.length === 0) return;
                const { SectionPromptCompiler } = require('./meeting/SectionPromptCompiler');
                const compiler = new SectionPromptCompiler(llmHelper);
                const CONCURRENCY = 3;
                let next = 0;
                await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sections.length) }, async () => {
                    while (next < sections.length) {
                        const s = sections[next++];
                        try {
                            const { instruction, compiled } = await compiler.compile({ sectionTitle: s.title, sectionDescription: s.description, meetingMode: mode?.templateType });
                            if (compiled && instruction) DatabaseManager.getInstance().updateNoteSection(s.id, { compiledPrompt: instruction });
                        } catch { /* per-section non-fatal */ }
                    }
                }));
            } catch (e) {
                console.warn('[ModesManager] compileAllSections skipped (non-fatal):', (e as any)?.message);
            }
        })();
    }

    private static llmHelperForCompiler: import('../LLMHelper').LLMHelper | null = null;

    /** Wire the LLMHelper used by the async section-prompt compiler (called at startup). */
    public static setLlmHelperForCompiler(llmHelper: import('../LLMHelper').LLMHelper): void {
        ModesManager.llmHelperForCompiler = llmHelper;
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
    public getActiveModeSystemPromptSuffix(pinnedModeId?: string): string {
        const mode = this.resolveMode(pinnedModeId);
        if (!mode) return '';
        if (isCustomMode(mode)) return '';
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
    public getActiveModePinnedInstructions(answerType?: AnswerType, pinnedModeId?: string): string {
        const mode = this.resolveMode(pinnedModeId);
        if (!mode) return '';
        const raw = (mode.customContext || '').trim();
        if (!raw) return '';
        const grounding = this.getActiveModeDocumentGroundingInfo(pinnedModeId);
        const scoped = (answerType && !grounding.documentGroundedCustomModeActive)
            ? selectCustomContextForAnswer(classifyCustomContext(raw), answerType).included.map(c => c.text).join('\n')
            : raw;
        if (!scoped.trim()) return '';
        let text = scoped.trim();
        if (text.length > ModesManager.PINNED_INSTRUCTIONS_MAX_CHARS) {
            text = text.slice(0, ModesManager.PINNED_INSTRUCTIONS_MAX_CHARS) + ' …[truncated]';
        }
        // isCustom is a pure function of (templateType, name) on the resolved
        // mode — derive it directly so a pinned mode reports correctly even when
        // it differs from the (possibly switched) live active mode.
        const custom = isCustomMode(mode);
        return custom ? `Mode: ${mode.name}\n${text}` : text;
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

    public getActiveModeDocumentGroundingInfo(pinnedModeId?: string): ActiveModeDocumentGroundingInfo {
        const mode = this.resolveMode(pinnedModeId);
        if (!mode) {
            return {
                isCustom: false, hasReferenceFiles: false, documentGrounded: false,
                documentGroundedCustomModeActive: false, hasCustomPrompt: false,
                sourceContract: defaultSourceContractForNewMode(),
            };
        }
        const files = this.getReferenceFiles(mode.id);
        const custom = isCustomMode(mode);
        const hasReferenceFiles = files.some(file => file.content.trim());
        const hasCustomPrompt = mode.customContext.trim().length > 0;
        // Real-custom-mode-repair (2026-07-11): `documentGrounded` is now a PURE
        // function of the mode's PERSISTED ModeSourceContract, never a live regex
        // re-match against the prompt text. Root cause of the P0 contamination
        // incident: the prior implementation ran detectCustomModeDocumentGrounding
        // on every single turn, and a real user's natural phrasing routinely
        // failed to satisfy both regexes simultaneously, silently defaulting the
        // mode to `general_mixed` (everything allowed) with zero user visibility.
        // getOrMigrateSourceContract() migrates + PERSISTS a legacy mode's
        // contract exactly once (docs/context-os/real-custom-mode-repair/
        // 05_PRODUCT_SOURCE_POLICY.md); after that this call is a pure DB read.
        const sourceContract = this.getOrMigrateSourceContract(mode.id);
        const documentGrounded = documentGroundedFromContract(sourceContract, hasReferenceFiles);
        // `documentGroundedCustomModeActive` — NOT `documentGrounded` — is the
        // flag every production retrieval/prompt-shaping call site actually
        // reads (WhatToAnswerLLM.ts forceDocumentGrounding, both LLMHelper.ts
        // active-mode-injection sites, IntelligenceEngine.ts's context
        // suppression + profile bypass, ipcHandlers.ts's Hindsight/OKF
        // isolation gates and phone-chat). The name retains "CustomMode" for
        // historical/API-compat reasons (~65 call sites reference this exact
        // field name) but does not require `isCustomMode` — any mode (built-in
        // template or user-created) whose PERSISTED CONTRACT names reference
        // files as the (primary or exclusive) source activates full doc-grounded
        // behavior.
        const documentGroundedCustomModeActive = hasCustomPrompt && documentGrounded && hasReferenceFiles;
        return {
            isCustom: custom,
            hasReferenceFiles,
            documentGrounded,
            documentGroundedCustomModeActive,
            modeId: mode.id,
            modeName: mode.name,
            hasCustomPrompt,
            sourceContract,
        };
    }

    public buildRetrievedActiveModeContextBlock(query: string, transcript?: string, tokenBudget?: number, answerType?: AnswerType, excludeCustomContext?: boolean, pinnedModeId?: string, retrievalOptions?: ModeRetrievalOptions): string {
        const mode = this.resolveMode(pinnedModeId);
        if (!mode) return '';

        const result = this.modeContextRetriever.retrieve(mode, this.getReferenceFiles(mode.id), {
            query,
            transcript,
            tokenBudget,
            answerType,
            excludeCustomContext,
            ...retrievalOptions,
        });

        // Side-channel the normalized top-score CONFIDENCE for this call
        // (2026-07-02) for DIAGNOSTICS only (surfaced by the debug
        // modes:build-retrieved-context IPC). NOTE: the document-grounded
        // false-refusal gate deliberately does NOT use this — retrieval score
        // proved unreliable there because the forced-doc-grounding section
        // boost inflates off-topic queries (an off-topic "FIFA World Cup?"
        // out-scored a genuine "research questions?" on the real thesis). The
        // gate uses OKF entity/title overlap instead (see ipcHandlers). Kept
        // because it's honest, cheap diagnostic data. Overwritten on every
        // call; synchronous write (no await), so no cross-question clobber.
        this.lastRetrievalConfidence = result.topScoreConfidence ?? 0;

        return result.formattedContext;
    }

    /** Normalized [0,1] retrieval confidence from the most recent
     *  buildRetrievedActiveModeContextBlock call (0 if it retrieved nothing).
     *  DIAGNOSTICS only — NOT used by the false-refusal gate (see setter). */
    public getLastRetrievalConfidence(): number {
        return this.lastRetrievalConfidence;
    }

    /**
     * Evidence-execution-repair (2026-07-12): raw hybrid-retrieval passthrough
     * for EvidenceResolver. Returns the STRUCTURED HybridContext (chunks +
     * per-chunk scores), not the formatted string the other wrappers below
     * build — EvidenceResolver needs typed items, not prose. CRITICAL: this
     * delegates to `this.modeContextRetriever`, the SAME shared instance
     * `main.ts` wires with `setSharedEmbeddingPipeline()` at RAG-manager init.
     * A caller that constructs its own `new ModeContextRetriever()` gets an
     * instance whose `_sharedEmbeddingPipeline` is permanently null — every
     * `retrieveHybrid()` call on it then hits the `!ensureHybridRetriever()`
     * guard and returns `{ chunks: [], usedFallback: true }` even when the
     * mode's files are genuinely indexed and ready, which is exactly the bug
     * this passthrough exists to prevent a future caller from reintroducing.
     */
    public async retrieveHybridRaw(mode: Mode, files: ModeReferenceFile[], options: RetrieveOptions): Promise<HybridContext> {
        return this.modeContextRetriever.retrieveHybrid(mode, files, options);
    }

    /**
     * Phase 4 — async hybrid retrieval (FTS + vector + dedupe + lexical fallback).
     * Callers in async paths (WhatToAnswerLLM, LLMHelper paths) should prefer
     * this. If hybrid throws (DB missing, embedding provider unavailable),
     * we fall back to the existing sync lexical path so the answer flow
     * never breaks. Telemetry distinguishes hybrid hits from lexical fallback.
     */
    public async buildRetrievedActiveModeContextBlockHybrid(query: string, transcript?: string, tokenBudget?: number, answerType?: AnswerType, excludeCustomContext?: boolean, pinnedModeId?: string, allowRerank?: boolean, retrievalOptions?: ModeRetrievalOptions): Promise<string> {
        const mode = this.resolveMode(pinnedModeId);
        if (!mode) return '';
        const files = this.getReferenceFiles(mode.id);

        // Forced document grounding (audit 2026-06-27): run HYBRID retrieval
        // first (semantic + lexical with cross-encoder rerank), and if the
        // hybrid path returns nothing usable (no embedder, no chunks, used
        // fallback), merge the lexical document-identity block on top. This
        // gives document-grounded custom modes the precision of semantic
        // retrieval while preserving the compact identity block for broad
        // questions like "what is this about?" — the previous code
        // unconditionally routed to the sync path here, missing the entire
        // semantic ranking benefit.
        if (retrievalOptions?.forceDocumentGrounding) {
            try {
                const hybridResult = await this.modeContextRetriever.retrieveHybrid(
                    mode, files, {
                        query,
                        transcript,
                        tokenBudget,
                        answerType,
                        excludeCustomContext,
                        allowRerank,
                        forceDocumentGrounding: true,
                        followUpReferentHint: retrievalOptions?.followUpReferentHint,
                        ...(retrievalOptions?.relaxed ? { topK: retrievalOptions.topK, tokenBudget: tokenBudget ?? 5200 } : {}),
                    },
                );
                diagLog('ModesManager hybrid-first branch', {
                    query,
                    usedFallback: hybridResult?.usedFallback,
                    usedHybrid: hybridResult?.usedHybrid,
                    hasContext: !!hybridResult?.formattedContext,
                    tookHybrid: !!(hybridResult && !hybridResult.usedFallback && hybridResult.formattedContext),
                });
                if (hybridResult && !hybridResult.usedFallback && hybridResult.formattedContext) {
                    return hybridResult.formattedContext;
                }
                // Hybrid unavailable — fall back to lexical + identity block.
                return this.buildRetrievedActiveModeContextBlock(
                    query, transcript, tokenBudget, answerType, excludeCustomContext, pinnedModeId, retrievalOptions,
                );
            } catch (err) {
                // Don't let a hybrid outage block a document-grounded answer.
                console.warn('[ModesManager] hybrid forceDocumentGrounding failed, falling back to lexical:', err?.message);
                return this.buildRetrievedActiveModeContextBlock(
                    query, transcript, tokenBudget, answerType, excludeCustomContext, pinnedModeId, retrievalOptions,
                );
            }
        }

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
                allowRerank,
                ...retrievalOptions,
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

        const lexical = this.buildRetrievedActiveModeContextBlock(query, transcript, tokenBudget, answerType, excludeCustomContext, pinnedModeId, retrievalOptions);
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
     * Phase 5 — OKF-augmented mode context block.
     *
     * Wraps `modeContextBlock` (already produced by `buildRetrievedActiveModeContextBlock*`)
     * with OKF Knowledge Cards + graph hints when:
     *   1. `okfHybridRetrieval` flag is on, AND
     *   2. the active mode has at least one reference file with a generated OKF pack.
     *
     * Returns the raw `modeContextBlock` unchanged when any condition fails — additive,
     * never destructive. Used by both the manual `gemini-chat-stream` path and the WTA
     * path (`WhatToAnswerLLM.generateStream`) so synthesis-question recovery reaches
     * every caller, not just the manual path.
     *
     * Mirrors the block in `LLMHelper.ts:4640-4704` so the behaviour stays in lockstep;
     * this is the canonical home for the logic.
     */
    public buildOkfAugmentedContextBlock(modeContextBlock: string, query: string, pinnedModeId?: string): string {
        if (!modeContextBlock || !query) return modeContextBlock;
        try {
            const { isOkfHybridRetrievalEnabled, isOkfGraphExpansionEnabled } = require('../intelligence/intelligenceFlags');
            if (!isOkfHybridRetrievalEnabled()) return modeContextBlock;
            const { classifyQuestion } = require('./knowledge/QuestionClassifier');
            const { queryOkfCards } = require('./knowledge/OkfRetriever');
            const { formatCardsForPrompt, buildOkfEvidenceBlock } = require('./knowledge/OkfPromptFormatter');
            const mode = this.resolveMode(pinnedModeId);
            if (!mode) return modeContextBlock;
            const files = this.getReferenceFiles(mode.id) || [];
            if (files.length === 0) return modeContextBlock;
            const { KnowledgeManager } = require('./knowledge/KnowledgeManager');
            const km = KnowledgeManager.getInstance();
            const classification = classifyQuestion(query);
            const allScoredCards: any[] = [];
            const packsForGraphExpansion: any[] = [];
            for (const file of files) {
                const pack = km.getPackForFile(file.id);
                if (!pack || pack.cards.length === 0) continue;
                const scored = queryOkfCards(pack, query, classification, { topN: 6, fileId: file.id });
                allScoredCards.push(...scored);
                packsForGraphExpansion.push(pack);
            }
            if (allScoredCards.length === 0) return modeContextBlock;
            allScoredCards.sort((a: any, b: any) => b.score - a.score);
            const topCards = allScoredCards.slice(0, 6);
            const cardsBlock = formatCardsForPrompt(topCards);
            let graphHints = '';
            try {
                if (isOkfGraphExpansionEnabled() && classification.targetEntities && classification.targetEntities.length > 0) {
                    const { resolveStartNodeIds, expandGraph, formatGraphHintsForPrompt } = require('./knowledge/GraphRetriever');
                    const allHints: any[] = [];
                    for (const pack of packsForGraphExpansion) {
                        const startIds = resolveStartNodeIds(pack, classification.targetEntities);
                        if (startIds.length === 0) continue;
                        allHints.push(...expandGraph(pack, startIds, 2));
                    }
                    graphHints = formatGraphHintsForPrompt(allHints);
                }
            } catch (_graphErr: any) {
                console.warn('[ModesManager] OKF graph expansion skipped (non-fatal):', _graphErr?.message);
            }
            const combinedCardsBlock = graphHints ? `${cardsBlock}\n\n${graphHints}` : cardsBlock;
            return buildOkfEvidenceBlock({ cardsBlock: combinedCardsBlock, rawChunkText: modeContextBlock });
        } catch (_okfErr: any) {
            console.warn('[ModesManager] OKF augmentation skipped (non-fatal):', _okfErr?.message);
            return modeContextBlock;
        }
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
