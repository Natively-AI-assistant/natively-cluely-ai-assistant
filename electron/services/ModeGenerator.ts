// electron/services/ModeGenerator.ts
//
// AI-generated custom-mode pipeline (Phase 2 of the Modes Manager mission).
//
// Prior to this, the Modes Manager had NO way to turn a free-text user brief
// ("Senior Backend Engineering Interview — concise expert answers with
// tradeoffs") into a persisted custom mode. `modes:create` only accepted
// { name, templateType }. This service adds the missing generation layer:
//
//   brief (string) --meta-prompt--> LLM --JSON--> validated ModeDraft
//
// The generated draft is then persisted by the caller via the existing
// ModesManager.createMode + updateMode(customContext) path — this service does
// NOT touch the DB, so it is trivially unit-testable with an injected LLM.
//
// DESIGN NOTES
// - LLM access is injected as `complete(system, user)` so the IPC handler wires
//   it to the real backend (MiniMax via /v1/chat) while tests can point it at
//   the same local backend or a deterministic stub for plumbing checks.
// - The generated `customContext` is what becomes the mode's "Real-time prompt"
//   (ModesManager.getActiveModePinnedInstructions). It is capped at
//   PINNED_INSTRUCTIONS_MAX_CHARS (1200) at INJECTION time, so we target well
//   under that here and hard-trim as a safety net.
// - Document grounding: a custom mode only becomes documentGroundedCustomModeActive
//   when its customContext matches BOTH DOCUMENT_SOURCE_RE and
//   DOCUMENT_CONSTRAINT_RE (ModesManager.detectCustomModeDocumentGrounding). For
//   briefs that require grounding, we (a) instruct the model to include both, and
//   (b) deterministically guarantee it via ensureGroundingPhrases() as a backstop
//   so a weak generation can never silently drop grounding.

import { detectCustomModeDocumentGrounding } from './ModesManager';

export type ModeTemplateType =
    | 'general'
    | 'looking-for-work'
    | 'sales'
    | 'recruiting'
    | 'team-meet'
    | 'lecture'
    | 'technical-interview';

const VALID_TEMPLATE_TYPES: ReadonlySet<string> = new Set([
    'general',
    'looking-for-work',
    'sales',
    'recruiting',
    'team-meet',
    'lecture',
    'technical-interview',
]);

// Injection-time cap in ModesManager is 1200; target below it and hard-trim.
export const CUSTOM_CONTEXT_TARGET_MAX = 1200;
const NAME_MAX = 60;

export interface ModeBrief {
    /** Stable key the caller uses to map briefs → generated modes (e.g. 'backend-eng'). */
    key: string;
    /** The user's free-text description exactly as they would type it. */
    brief: string;
    /**
     * Whether this mode should be document-grounded (answers restricted to the
     * uploaded reference files). When true, the generated customContext is
     * guaranteed to satisfy detectCustomModeDocumentGrounding().
     */
    requiresGrounding: boolean;
    /** Optional hint for the closest built-in template; the model may override. */
    templateHint?: ModeTemplateType;
}

export interface ModeDraft {
    key: string;
    name: string;
    templateType: ModeTemplateType;
    customContext: string;
    /** Grounding as actually realized in customContext (post-backstop). */
    documentGrounded: boolean;
    /** Provenance for the report. */
    raw: string;
}

export interface ModeValidationIssue {
    key: string;
    field: string;
    severity: 'error' | 'warning';
    message: string;
}

export type CompleteFn = (system: string, user: string) => Promise<string>;

// Placeholder / laziness sentinels that must never survive into a saved prompt.
const PLACEHOLDER_RE = /\[(?:insert|your|todo|tbd|placeholder|company name|role|xxx+)[^\]]*\]|\bTODO\b|\bTBD\b|\blorem ipsum\b|\{\{[^}]*\}\}/i;

// Deterministic grounding backstop phrases. The first satisfies DOCUMENT_SOURCE_RE
// ("uploaded", "reference", "documents"), the second satisfies
// DOCUMENT_CONSTRAINT_RE ("answer ... from the uploaded", "only use", "grounded in").
const GROUNDING_BACKSTOP =
    'Ground every answer strictly in the uploaded reference documents provided for this mode. ' +
    'Only use information found in those files; do not use knowledge outside them. ' +
    'If the answer is not in the provided documents, say so plainly rather than guessing.';

/**
 * The meta-prompt system instruction. Encodes the contract the model must obey
 * when turning a brief into a mode. Kept explicit and testable.
 */
export function buildMetaPromptSystem(): string {
    return [
        'You are a configuration generator for an AI interview/meeting assistant called Natively.',
        'You turn a short natural-language brief into a single custom "mode" the assistant will run.',
        'A mode has three parts: a short display NAME, a TEMPLATE_TYPE, and a REAL-TIME PROMPT (customContext).',
        '',
        'The REAL-TIME PROMPT is injected verbatim as the assistant\'s live instructions while it answers',
        'questions on the user\'s behalf. Write it as direct, imperative guidance TO the assistant.',
        '',
        'HARD REQUIREMENTS:',
        '1. Output ONLY a single JSON object. No markdown, no code fences, no commentary before or after.',
        '2. JSON shape: {"name": string, "templateType": string, "customContext": string}.',
        '3. templateType MUST be exactly one of: general, looking-for-work, sales, recruiting, team-meet, lecture, technical-interview.',
        '   Use "general" for any bespoke role that does not clearly match the others.',
        '4. name: <= 60 chars, human-readable, specific to the brief.',
        '5. customContext: 400-1000 characters. Encode the brief\'s TONE, ANSWER FORMAT, and any GROUNDING RULES.',
        '   Be concrete about format (e.g. "use STAR structure", "lead with the tradeoff", "cite the section").',
        '6. NEVER include placeholder text like [insert...], TODO, TBD, {{...}}, or lorem ipsum. Write real, usable instructions.',
        '7. Do not invent facts about the user; write instructions, not answers.',
    ].join('\n');
}

/**
 * The per-brief user message. When grounding is required we explicitly demand the
 * two phrase families the runtime grounding detector keys on, so a compliant
 * generation is grounded without needing the backstop.
 */
export function buildMetaPromptUser(brief: ModeBrief): string {
    const lines: string[] = [
        `BRIEF: ${brief.brief}`,
        '',
    ];
    if (brief.templateHint) {
        lines.push(`Closest template hint (you may override if a different one fits better): ${brief.templateHint}`);
        lines.push('');
    }
    if (brief.requiresGrounding) {
        lines.push('GROUNDING REQUIRED: This mode answers ONLY from user-uploaded reference documents.');
        lines.push('The customContext MUST explicitly tell the assistant to:');
        lines.push('  - treat the uploaded/provided reference documents as the source of truth, AND');
        lines.push('  - only use information found in those files (do not use outside knowledge), AND');
        lines.push('  - refuse or say "not in the provided documents" when the answer is absent.');
        lines.push('Use natural language that clearly conveys "answer from the uploaded documents" and "only use the provided files".');
        lines.push('');
    } else {
        lines.push('This mode answers from the user\'s general background and the live conversation; it is NOT document-restricted.');
        lines.push('');
    }
    lines.push('Return the JSON object now.');
    return lines.join('\n');
}

/**
 * Extract the first balanced JSON object from arbitrary model text. MiniMax-M3
 * sometimes emits a leading <think> block (stripped server-side) or stray prose;
 * this is defensive against fences and preamble.
 */
export function extractJsonObject(text: string): any {
    if (!text) throw new Error('empty model output');
    let s = text.trim();
    // Strip common code fences.
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    // Find the first '{' and scan to its matching '}'.
    const start = s.indexOf('{');
    if (start === -1) throw new Error('no JSON object found in model output');
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                const candidate = s.slice(start, i + 1);
                return JSON.parse(candidate);
            }
        }
    }
    throw new Error('unbalanced JSON object in model output');
}

/** Guarantee the customContext satisfies the runtime document-grounding detector. */
export function ensureGroundingPhrases(customContext: string): string {
    if (detectCustomModeDocumentGrounding(customContext)) return customContext;
    const joined = `${customContext.trim()}\n\n${GROUNDING_BACKSTOP}`.trim();
    return joined;
}

function clamp(text: string, max: number): string {
    if (text.length <= max) return stripOrphanListMarker(text);
    // Trim on a sentence/word boundary where possible.
    const cut = text.slice(0, max);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
    const trimmed = (lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : cut).trim();
    return stripOrphanListMarker(trimmed);
}

/**
 * Remove a trailing orphan list marker left by a mid-list truncation, e.g. a
 * dangling "5." or "- " with no content after it. Otherwise a clamped numbered
 * list can ship a bare ordinal as the final "instruction".
 */
function stripOrphanListMarker(text: string): string {
    return text.replace(/\n\s*(?:\d+[.)]|[-*•])\s*$/, '').trim();
}

/**
 * Normalize + validate a parsed model object into a ModeDraft. Applies the
 * grounding backstop when required. Throws on unrecoverable structural failure
 * (the caller retries or records the failure).
 */
export function normalizeDraft(brief: ModeBrief, parsed: any, raw: string): ModeDraft {
    if (!parsed || typeof parsed !== 'object') throw new Error('parsed output is not an object');
    let name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    let templateType = typeof parsed.templateType === 'string' ? parsed.templateType.trim() : '';
    let customContext = typeof parsed.customContext === 'string' ? parsed.customContext.trim() : '';

    if (!name) throw new Error('missing name');
    if (!customContext) throw new Error('missing customContext');

    if (name.length > NAME_MAX) name = name.slice(0, NAME_MAX).trim();
    // "General" is reserved for the built-in default; a custom mode must not be
    // named exactly "General" or isCustomMode() would treat it as the default.
    if (name.toLowerCase() === 'general') name = `${name} (Custom)`;

    if (!VALID_TEMPLATE_TYPES.has(templateType)) {
        templateType = brief.templateHint && VALID_TEMPLATE_TYPES.has(brief.templateHint)
            ? brief.templateHint
            : 'general';
    }

    // A non-general template routes to that template's own canonical system
    // prompt (electron/llm/prompts.ts's per-template prompt), which would
    // compete with/dilute the AI-generated grounding instructions in the
    // customContext. Force 'general' for grounded modes so the generated
    // prompt is the mode's ENTIRE voice, not layered under a template prompt.
    // NOTE (2026-07-05): getActiveModeDocumentGroundingInfo's
    // documentGroundedCustomModeActive no longer requires isCustomMode() —
    // a hand-authored non-general-template mode with reference files + a
    // document-grounded customContext now DOES engage forced retrieval /
    // profile suppression at runtime (see ModesManager.ts). This
    // general-template force is now a prompt-clarity choice for the AI
    // generation pipeline specifically, not a runtime-correctness requirement.
    if (brief.requiresGrounding && templateType !== 'general') {
        templateType = 'general';
    }

    if (brief.requiresGrounding) {
        customContext = ensureGroundingPhrases(customContext);
    }
    customContext = clamp(customContext, CUSTOM_CONTEXT_TARGET_MAX);
    // A trim could have severed a grounding phrase — re-assert after clamp.
    if (brief.requiresGrounding && !detectCustomModeDocumentGrounding(customContext)) {
        // Make room for the backstop by trimming the body first.
        const room = CUSTOM_CONTEXT_TARGET_MAX - GROUNDING_BACKSTOP.length - 2;
        customContext = `${clamp(customContext, Math.max(0, room))}\n\n${GROUNDING_BACKSTOP}`.trim();
    }

    const documentGrounded = detectCustomModeDocumentGrounding(customContext);

    return {
        key: brief.key,
        name,
        templateType: templateType as ModeTemplateType,
        customContext,
        documentGrounded,
        raw,
    };
}

/** Structural + quality validation of a single draft. */
export function validateDraft(draft: ModeDraft, brief: ModeBrief): ModeValidationIssue[] {
    const issues: ModeValidationIssue[] = [];
    const push = (field: string, severity: 'error' | 'warning', message: string) =>
        issues.push({ key: draft.key, field, severity, message });

    if (!draft.name || draft.name.length < 3) push('name', 'error', 'name too short');
    if (draft.name.length > NAME_MAX) push('name', 'error', `name exceeds ${NAME_MAX} chars`);
    if (draft.name.toLowerCase() === 'general') push('name', 'error', 'name collides with reserved "General"');

    if (!VALID_TEMPLATE_TYPES.has(draft.templateType)) push('templateType', 'error', `invalid templateType "${draft.templateType}"`);

    const cc = draft.customContext || '';
    if (cc.length < 120) push('customContext', 'error', 'customContext too short (<120 chars)');
    if (cc.length > CUSTOM_CONTEXT_TARGET_MAX) push('customContext', 'error', `customContext exceeds ${CUSTOM_CONTEXT_TARGET_MAX} chars`);
    if (PLACEHOLDER_RE.test(cc)) push('customContext', 'error', 'customContext contains placeholder/TODO text');

    if (brief.requiresGrounding && !draft.documentGrounded) {
        push('customContext', 'error', 'grounding required but customContext does not satisfy document-grounding detector');
    }
    if (!brief.requiresGrounding && draft.documentGrounded) {
        push('customContext', 'warning', 'non-grounded brief produced a document-grounded prompt');
    }
    return issues;
}

/**
 * Token-set Jaccard similarity of two prompts. Used to flag under-conditioned
 * generations (two briefs → near-identical prompts).
 */
export function promptSimilarity(a: string, b: string): number {
    const toks = (s: string) => {
        const matched: string[] = s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
        return new Set(matched.filter(w => w.length > 3));
    };
    const A = toks(a);
    const B = toks(b);
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    const union = A.size + B.size - inter;
    return union === 0 ? 0 : inter / union;
}

export interface DistinctivenessResult {
    maxPairSimilarity: number;
    nearDuplicates: Array<{ a: string; b: string; similarity: number }>;
}

/** Pairwise distinctiveness across all drafts. threshold default 0.6. */
export function checkDistinctiveness(drafts: ModeDraft[], threshold = 0.6): DistinctivenessResult {
    let maxPairSimilarity = 0;
    const nearDuplicates: Array<{ a: string; b: string; similarity: number }> = [];
    for (let i = 0; i < drafts.length; i++) {
        for (let j = i + 1; j < drafts.length; j++) {
            const sim = promptSimilarity(drafts[i].customContext, drafts[j].customContext);
            if (sim > maxPairSimilarity) maxPairSimilarity = sim;
            if (sim >= threshold) nearDuplicates.push({ a: drafts[i].key, b: drafts[j].key, similarity: sim });
        }
    }
    return { maxPairSimilarity, nearDuplicates };
}

/**
 * Generate a single mode draft from a brief, with bounded retries on structural
 * failure. `complete` is the injected LLM entry (system, user) => text.
 */
export async function generateMode(
    brief: ModeBrief,
    complete: CompleteFn,
    opts: { maxAttempts?: number } = {},
): Promise<{ draft: ModeDraft; attempts: number; issues: ModeValidationIssue[] }> {
    const maxAttempts = opts.maxAttempts ?? 3;
    const system = buildMetaPromptSystem();
    const user = buildMetaPromptUser(brief);
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let raw = '';
        try {
            raw = await complete(system, attempt === 1 ? user : `${user}\n\n(Reminder: output ONLY the JSON object, no prose.)`);
            const parsed = extractJsonObject(raw);
            const draft = normalizeDraft(brief, parsed, raw);
            const issues = validateDraft(draft, brief);
            const hardErrors = issues.filter(i => i.severity === 'error');
            if (hardErrors.length === 0) {
                return { draft, attempts: attempt, issues };
            }
            lastErr = new Error(`validation failed: ${hardErrors.map(e => e.message).join('; ')}`);
        } catch (e: any) {
            lastErr = e instanceof Error ? e : new Error(String(e));
        }
    }
    throw new Error(`generateMode(${brief.key}) failed after ${maxAttempts} attempts: ${lastErr?.message ?? 'unknown'}`);
}
