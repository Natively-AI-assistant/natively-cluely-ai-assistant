/**
 * Earlier versions of a meeting's notes, and what a rating is tied to.
 *
 * Until 2026-10-15 "Regenerate" (and "Regenerate notes as Sales") replaced the
 * notes outright. Now the notes being replaced are kept as a version: the
 * meeting page shows one small tab per version above the notes ("General",
 * "Sales call"), and switching between them is a read, never a model call.
 * At most MAX_ARCHIVED_NOTES_VERSIONS are kept per meeting (oldest dropped),
 * so with the current notes there are never more than five tabs.
 *
 * A rating (thumbs up or down at the end of the notes) belongs to one version
 * of the notes, identified by notesContentHash, so a rating given before a
 * Regenerate is never read as a verdict on what replaced it.
 *
 * Pure: no I/O. DatabaseManager stores the rows; tests in
 * electron/services/__tests__/MeetingUserNotes2026_10_15.test.mjs.
 */
import { createHash } from 'node:crypto';

/** Versions kept per meeting besides the current notes. */
export const MAX_ARCHIVED_NOTES_VERSIONS = 4;

/** Notes worth keeping as a version: written V3 notes with something in them. */
export function isArchivableNotes(detailed: unknown): boolean {
    const d = detailed as any;
    if (!d || typeof d !== 'object' || d.schemaVersion !== 3) return false;
    const has = (v: unknown) => Array.isArray(v) && v.length > 0;
    return (typeof d.overview === 'string' && d.overview.trim().length > 0)
        || has(d.tldr)
        || (Array.isArray(d.sectionsV3) && d.sectionsV3.some((s: any) => has(s?.bullets)));
}

/**
 * Notes worth keeping when a resumed meeting's notes are rewritten
 * (2026-11-02): written V3 notes as above, and also the older short notes
 * (overview, key points, action items) a short meeting or an older version of
 * the app wrote. Regenerate keeps its V3-only rule. The placeholder Stop saves
 * and notes that failed are empty, so they are never kept.
 */
export function isArchivableEarlierNotes(detailed: unknown): boolean {
    if (isArchivableNotes(detailed)) return true;
    const d = detailed as any;
    if (!d || typeof d !== 'object' || d.schemaVersion === 3) return false;
    const has = (v: unknown) => Array.isArray(v) && v.some((x: any) => (typeof x === 'string' ? x : String(x?.text ?? '')).trim().length > 0);
    return (typeof d.overview === 'string' && d.overview.trim().length > 0)
        || has(d.keyPoints) || has(d.actionItems)
        || (Array.isArray(d.sections) && d.sections.some((s: any) => has(s?.bullets)));
}

/** The tab name for a version: the mode the notes were written in. */
export function notesVersionLabel(detailed: unknown): string {
    const mode = (detailed as any)?.mode;
    const name = typeof mode?.selectedModeName === 'string' ? mode.selectedModeName.trim() : '';
    if (name) return name.slice(0, 40);
    const template = typeof mode?.selectedTemplateType === 'string' ? mode.selectedTemplateType.trim()
        : typeof mode?.summaryModeUsed === 'string' ? mode.summaryModeUsed.trim() : '';
    if (template) return (template.charAt(0).toUpperCase() + template.slice(1).replace(/[_-]+/g, ' ')).slice(0, 40);
    return 'Notes';
}

/**
 * A stable fingerprint of what the notes SAY (title, summary, sections,
 * actions, decisions, questions). Speaker renames, the follow-up draft and
 * bookkeeping fields are left out, so a rename does not orphan a rating.
 */
export function notesContentHash(detailed: unknown): string {
    const d = (detailed && typeof detailed === 'object') ? detailed as any : {};
    const texts = (v: unknown) => (Array.isArray(v) ? v : []).map((x: any) => (typeof x === 'string' ? x : String(x?.text ?? ''))).filter(Boolean);
    const content = {
        overview: typeof d.overview === 'string' ? d.overview : '',
        tldr: texts(d.tldr),
        sections: (Array.isArray(d.sectionsV3) ? d.sectionsV3 : Array.isArray(d.sections) ? d.sections : [])
            .map((s: any) => [String(s?.title ?? ''), texts(s?.bullets)]),
        actions: texts(d.actionItemsV3 ?? d.actionItems),
        decisions: texts(d.decisions),
        questions: texts(d.openQuestions),
        keyPoints: d.schemaVersion === 3 ? [] : texts(d.keyPoints),
    };
    return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 32);
}

/** True when the user changed the notes by hand (updateMeetingSummary stamps it). */
export function notesWereEdited(detailed: unknown): boolean {
    const at = (detailed as any)?.userEditedAt;
    return typeof at === 'number' && Number.isFinite(at) && at > 0;
}

/** Which version rows to delete so at most `keep` remain, oldest first out. */
export function versionIdsToPrune(rows: Array<{ id: number; createdAt: number }>, keep: number = MAX_ARCHIVED_NOTES_VERSIONS): number[] {
    const sorted = [...rows].sort((a, b) => (b.createdAt - a.createdAt) || (b.id - a.id));
    return sorted.slice(Math.max(0, keep)).map((r) => r.id);
}
