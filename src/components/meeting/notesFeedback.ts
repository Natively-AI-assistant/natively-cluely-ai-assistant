/*
  The meeting page's notes feedback and templates (2026-10-15), kept pure so
  it is tested without a DOM:

  - Thumbs sampling: about one meeting in ten asks "How were these notes?"
    above the notes when they are new; the rest keep the quiet row at the end.
    Decided by the meeting's id, so a meeting asks every time or never (no
    flicker between opens).
  - Regenerate as: every template the user has, General first, the one that
    wrote the notes marked.
  - Compare: which two versions a Compare opens with.

  Nothing here decides who may use a template: main does (notesTemplateGate.ts).
*/

/** Share of meetings whose new notes ask for a rating. */
export const RATING_PROMPT_RATE = 0.1;
/** Notes count as new for this long after they were written. */
export const FRESH_NOTES_MS = 24 * 60 * 60 * 1000;

/** A stable bucket 0..999 for a meeting id (FNV-1a). */
export function ratingSampleBucket(meetingId: string): number {
    let h = 2166136261;
    const s = String(meetingId ?? '');
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0) % 1000;
}

/** True for about `rate` of meeting ids, always the same answer for one id. */
export function inRatingSample(meetingId: string, rate: number = RATING_PROMPT_RATE): boolean {
    if (!meetingId || !(rate > 0)) return false;
    return ratingSampleBucket(meetingId) < Math.round(Math.min(1, rate) * 1000);
}

/** When the notes were written (generation.completedAt, else startedAt), or null. */
export function notesWrittenAt(detailed: unknown): number | null {
    const g = (detailed as any)?.generation;
    for (const v of [g?.completedAt, g?.startedAt]) {
        const ms = typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN;
        if (Number.isFinite(ms) && ms > 0) return ms;
    }
    return null;
}

/** Ask for a rating above the notes: new notes, in the sample. */
export function shouldPromptRating(meetingId: string, detailed: unknown, now: number, rate: number = RATING_PROMPT_RATE): boolean {
    const at = notesWrittenAt(detailed);
    if (at === null || now - at > FRESH_NOTES_MS || at - now > 60_000) return false;
    return inRatingSample(meetingId, rate);
}

export interface TemplateOption {
    id: string;
    name: string;
    templateType: string;
    /** These notes were written in it. */
    current: boolean;
}

/**
 * The templates to regenerate as: General first, then the rest in the order
 * given; the one that wrote the notes marked (by mode id, else by template and
 * name). Modes without an id or name are left out.
 */
export function templatePickerOptions(
    modes: Array<{ id?: string; name?: string; templateType?: string }> | null | undefined,
    notesMode: { selectedModeId?: string; selectedModeName?: string; selectedTemplateType?: string } | null | undefined,
): TemplateOption[] {
    const list = (Array.isArray(modes) ? modes : [])
        .filter((m) => typeof m?.id === 'string' && m.id && typeof m?.name === 'string' && m.name.trim())
        .map((m) => ({ id: m.id as string, name: (m.name as string).trim(), templateType: typeof m.templateType === 'string' ? m.templateType : '' }));
    const byId = notesMode?.selectedModeId && list.some((m) => m.id === notesMode.selectedModeId) ? notesMode.selectedModeId : null;
    const isCurrent = (m: { id: string; name: string; templateType: string }) => byId
        ? m.id === byId
        : !!notesMode?.selectedTemplateType && m.templateType === notesMode.selectedTemplateType
            && (!notesMode.selectedModeName || m.name === notesMode.selectedModeName);
    let marked = false;
    const out = list.map((m) => {
        const current = !marked && isCurrent(m);
        if (current) marked = true;
        return { ...m, current };
    });
    return [...out.filter((m) => m.templateType === 'general'), ...out.filter((m) => m.templateType !== 'general')];
}

/**
 * The two versions a Compare opens with: the version shown against the
 * current notes, or, on the current notes, the latest earlier version against
 * them. Null with no earlier version.
 */
export function comparePair(
    shown: 'current' | number,
    versions: Array<{ id: number; createdAt?: number }>,
): [number, 'current'] | null {
    if (!Array.isArray(versions) || versions.length === 0) return null;
    if (shown !== 'current' && versions.some((v) => v.id === shown)) return [shown, 'current'];
    const latest = [...versions].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.id - a.id)[0];
    return [latest.id, 'current'];
}
