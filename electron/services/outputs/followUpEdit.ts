// The follow-up email the user edited in place on the meeting page. Pure: what
// is saved with the meeting (detailedSummary.followUpDraft in summary_json, the
// same place FollowUpDraftGenerator's draft lives) and what counts as the user's
// own writing for the style profile.
//
// The model's text is kept beside the edit (`generated`) the first time the user
// changes it, so a later Copy can tell an edited email from an untouched one. A
// Regenerate writes a fresh draft without it, as before.

export const FOLLOW_UP_SUBJECT_MAX = 300;
export const FOLLOW_UP_BODY_MAX = 8000;

export interface SavedFollowUpDraft {
    type?: string;
    subject?: string;
    body: string;
    tone?: string;
    styled?: boolean;
    /** The model's draft, before the user's first edit. */
    generated?: { subject?: string; body: string };
    /** When the user last edited it. */
    editedAt?: number;
    [k: string]: unknown;
}

const norm = (s: string | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function cleanSubject(raw: unknown): string {
    return String(raw ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, FOLLOW_UP_SUBJECT_MAX);
}

export function cleanBody(raw: unknown): string {
    return String(raw ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim().slice(0, FOLLOW_UP_BODY_MAX);
}

/** The saved draft as an object (older meetings stored a plain string), or null when there is none. */
export function currentDraft(detailed: any): SavedFollowUpDraft | null {
    const raw = detailed?.followUpDraft;
    if (typeof raw === 'string') return raw.trim() ? { type: 'email', body: raw } : null;
    if (raw && typeof raw === 'object' && typeof raw.body === 'string' && raw.body.trim()) return raw as SavedFollowUpDraft;
    return null;
}

export type FollowUpEditResult =
    | { ok: true; changed: boolean; draft: SavedFollowUpDraft; detailed: any }
    | { ok: false; reason: 'no_draft' | 'empty' };

/**
 * The detailed summary with the user's edit applied (subject and body each
 * optional: absent means unchanged). `changed` is false when
 * the text is what is already saved, so the caller can skip the write.
 */
export function applyFollowUpEdit(detailed: any, edit: { subject?: unknown; body?: unknown }, now: number): FollowUpEditResult {
    const prev = currentDraft(detailed);
    if (!prev) return { ok: false, reason: 'no_draft' };
    // An absent field is left as saved (the page sends only what the user changed).
    const body = edit.body === undefined ? prev.body : cleanBody(edit.body);
    if (!body) return { ok: false, reason: 'empty' };
    // A draft with no subject line (not an email) stays without one.
    const subject = prev.subject !== undefined || edit.subject !== undefined
        ? (edit.subject === undefined ? prev.subject : cleanSubject(edit.subject))
        : undefined;
    if (body === prev.body && (subject ?? '') === (prev.subject ?? '')) {
        return { ok: true, changed: false, draft: prev, detailed };
    }
    const generated = prev.generated ?? { ...(prev.subject !== undefined ? { subject: prev.subject } : {}), body: prev.body };
    const backToOriginal = norm(body) === norm(generated.body) && norm(subject) === norm(generated.subject);
    const draft: SavedFollowUpDraft = { ...prev, body, ...(subject !== undefined ? { subject } : {}) };
    if (backToOriginal) {
        delete draft.generated;
        delete draft.editedAt;
    } else {
        draft.generated = generated;
        draft.editedAt = now;
    }
    return { ok: true, changed: true, draft, detailed: { ...detailed, followUpDraft: draft } };
}

/**
 * What the style profile learns when the user copies or sends this draft: the
 * body as they wrote it, against the model's. Null when they did not change it.
 */
export function followUpSample(draft: SavedFollowUpDraft | null): { finalText: string; draftText: string } | null {
    if (!draft?.generated) return null;
    if (norm(draft.body) === norm(draft.generated.body)) return null;
    return { finalText: draft.body, draftText: draft.generated.body };
}
