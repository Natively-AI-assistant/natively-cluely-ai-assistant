/*
  Meetings saved before the GitHub #662 fix can hold a model's "empty" reply as
  notes: "empty summary array." as the Summary, "None" as an action item or a
  section bullet. New notes are cleaned as they are written (MeetingSummaryV3's
  sanitizers, SummaryPolisher, v2FallbackNotes). This carries saved meetings
  over once, the way calendarNameMigration does: the originals are backed up
  first (no backup, no change), each meeting's notes are rewritten through
  replaceDetailedSummary, and a rating given to the old notes moves to the new
  notes' hash so it is still found. Kept versions (meeting_notes_versions) are
  history and stay as they were.
*/
import { isEmptyListPlaceholder, isEmptyPlaceholder } from './MeetingSummaryV3';
import { notesContentHash } from './notesVersions';

const textOf = (item: unknown): string | null => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && typeof (item as any).text === 'string') return (item as any).text;
    return null;
};

/** The list without placeholder items, or the same array when it has none. */
function cleanList<T>(list: T[], isPlaceholder: (text: string) => boolean): T[] {
    const kept = list.filter((item) => {
        const text = textOf(item);
        return text === null || !isPlaceholder(text);
    });
    return kept.length === list.length ? list : kept;
}

// Lists the prompts said to return empty take "Empty array" as a placeholder
// too; lists that hold free notes ("Empty array" is an interview edge case) do not.
const LIST_REPLY_KEYS = ['tldr', 'actionItems', 'actionItemsV3', 'decisions', 'openQuestions', 'risks'] as const;
const NOTE_KEYS = ['keyPoints', 'topics', 'whatChanged'] as const;

/**
 * The saved notes without placeholder items, or null when there are none.
 * V3 sections left with no bullets are dropped (the V3 notes never keep an
 * empty section); V2 template sections keep their heading, as the V2 notes do,
 * and the page hides one with no bullets.
 */
export function cleanPlaceholderNotes<T>(detailed: T): T | null {
    if (!detailed || typeof detailed !== 'object' || Array.isArray(detailed)) return null;
    const source = detailed as Record<string, unknown>;
    let out: Record<string, unknown> | null = null;
    const set = (key: string, value: unknown) => {
        if (!out) out = { ...source };
        out[key] = value;
    };

    for (const [keys, check] of [[LIST_REPLY_KEYS, isEmptyListPlaceholder], [NOTE_KEYS, isEmptyPlaceholder]] as const) {
        for (const key of keys) {
            const list = source[key];
            if (!Array.isArray(list)) continue;
            const kept = cleanList(list, check);
            if (kept !== list) set(key, kept);
        }
    }

    for (const key of ['sectionsV3', 'sections'] as const) {
        const sections = source[key];
        if (!Array.isArray(sections)) continue;
        let changed = false;
        const kept = sections.flatMap((section: any) => {
            if (!section || typeof section !== 'object' || !Array.isArray(section.bullets)) return [section];
            const bullets = cleanList(section.bullets, isEmptyPlaceholder);
            if (bullets === section.bullets) return [section];
            changed = true;
            return key === 'sectionsV3' && bullets.length === 0 ? [] : [{ ...section, bullets }];
        });
        if (changed) set(key, kept);
    }

    if (typeof source.overview === 'string' && source.overview.trim() && isEmptyPlaceholder(source.overview)) set('overview', '');

    return out as T | null;
}

export interface PlaceholderNotesMigrationDeps {
    /** Whether this already ran, and recording that it has. */
    isDone(): boolean;
    markDone(): void;
    /** Every saved meeting's id and raw summary_json. */
    listSummaries(): Array<{ id: string; summaryJson: string }>;
    /** Writes the originals of every meeting about to change, before any change. */
    backup(rows: Array<{ id: string; summaryJson: string }>): void;
    replaceDetailedSummary(id: string, detailed: unknown): boolean;
    /** Moves a meeting's notes rating from the old notes' hash to the new one. */
    rekeyNotesRating(meetingId: string, fromHash: string, toHash: string): void;
}

/** Cleans every saved meeting's notes once. Returns the ids it changed. */
export function runPlaceholderNotesMigration(deps: PlaceholderNotesMigrationDeps): string[] {
    if (deps.isDone()) return [];
    const plan: Array<{ id: string; summaryJson: string; before: unknown; next: unknown }> = [];
    for (const row of deps.listSummaries()) {
        let data: any;
        try { data = JSON.parse(row.summaryJson); } catch { continue; }
        const next = cleanPlaceholderNotes(data?.detailedSummary);
        if (next) plan.push({ ...row, before: data.detailedSummary, next });
    }
    if (plan.length > 0) {
        deps.backup(plan.map(({ id, summaryJson }) => ({ id, summaryJson })));
    }
    const changed: string[] = [];
    for (const p of plan) {
        if (!deps.replaceDetailedSummary(p.id, p.next)) continue;
        changed.push(p.id);
        const fromHash = notesContentHash(p.before);
        const toHash = notesContentHash(p.next);
        if (fromHash !== toHash) deps.rekeyNotesRating(p.id, fromHash, toHash);
    }
    deps.markDone();
    return changed;
}
