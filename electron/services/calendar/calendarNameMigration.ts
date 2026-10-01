/*
  Meetings saved before 2026-09-29 name the user by the connected Google
  account's FULL name ("Evin John Ignatious"): in the `me` speaker label, the
  notes' text, owners, the people list and evidence attributions. The notes now
  use the first name (calendarSessionMatch.firstNameOf). This carries a saved
  meeting over, deterministically, through the same rename path a speaker
  rename uses (SpeakerLabelService.applyRenamesToSummary: whole-word,
  case-sensitive, never inside quotes, cross-meeting recall or the memory
  record), plus two lists of names that path deliberately skips: evidence
  attributions (only an exact `speakerName`, never quote text) and the memory
  record's participants (exact entries). A label the user typed is not the full
  name and is left alone.
*/
import { SpeakerLabelService } from '../meeting/SpeakerLabelService';
import { firstNameOf } from './calendarSessionMatch';

/** The detailed summary with the account's full name carried to its first name,
 *  or null when it mentions neither the full name nor carries it as a label. */
export function migrateFullNameToFirst<T>(detailed: T, fullName: string | undefined | null): T | null {
    const full = (fullName ?? '').replace(/\s+/g, ' ').trim();
    const first = firstNameOf(full);
    if (!full || !first || first === full || !detailed || typeof detailed !== 'object') return null;
    if (!JSON.stringify(detailed).includes(full)) return null;

    const svc = new SpeakerLabelService();
    let out: any = svc.applyRenamesToSummary(detailed, { me: full }, { me: first });

    // Speaker labels: any the calendar wrote as the full name.
    const labels = out?.speakerLabels;
    if (labels && typeof labels === 'object') {
        const next: Record<string, string> = {};
        for (const [id, name] of Object.entries(labels as Record<string, string>)) next[id] = name === full ? first : name;
        out = { ...out, speakerLabels: next };
    }

    // Evidence attributions (not quotes): exact speakerName only.
    const walk = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(walk);
        if (value && typeof value === 'object') {
            const o: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                o[k] = k === 'speakerName' && v === full ? first : walk(v);
            }
            return o;
        }
        return value;
    };
    out = walk(out);

    // The memory record's participant list: names, not quotes, so exact entries only.
    const participants = out?.meetingMemory?.participants;
    if (Array.isArray(participants) && participants.includes(full)) {
        out = { ...out, meetingMemory: { ...out.meetingMemory, participants: participants.map((p: unknown) => (p === full ? first : p)) } };
    }
    return JSON.stringify(out) === JSON.stringify(detailed) ? null : (out as T);
}

export interface NameMigrationDeps {
    /** The connected Calendar account's name (full), or undefined when not connected. */
    fullName: string | undefined | null;
    /** The name this already ran for, and recording that it has. */
    getDoneFor(): string | undefined;
    setDoneFor(name: string): void;
    /** Saved meetings whose notes mention the text, and saving one's detailed summary. */
    listMentioning(text: string): Array<{ id: string; summaryJson: string }>;
    replaceDetailedSummary(id: string, detailed: unknown): boolean;
    /** Writes the originals of every meeting about to change, before any change. */
    backup(rows: Array<{ id: string; summaryJson: string }>): void;
}

/**
 * Carries every saved meeting that names the user in full over to the first
 * name, once per account name. The originals are backed up first (all or
 * nothing: no backup, no change). Returns the ids it changed.
 */
export function runCalendarNameMigration(deps: NameMigrationDeps): string[] {
    const full = (deps.fullName ?? '').replace(/\s+/g, ' ').trim();
    const first = firstNameOf(full);
    if (!full || !first || first === full || deps.getDoneFor() === full) return [];
    const plan: Array<{ id: string; summaryJson: string; next: unknown }> = [];
    for (const row of deps.listMentioning(full)) {
        let data: any;
        try { data = JSON.parse(row.summaryJson); } catch { continue; }
        const next = migrateFullNameToFirst(data?.detailedSummary, full);
        if (next) plan.push({ ...row, next });
    }
    if (plan.length > 0) {
        deps.backup(plan.map(({ id, summaryJson }) => ({ id, summaryJson })));
    }
    const changed: string[] = [];
    for (const p of plan) if (deps.replaceDetailedSummary(p.id, p.next)) changed.push(p.id);
    deps.setDoneFor(full);
    return changed;
}
