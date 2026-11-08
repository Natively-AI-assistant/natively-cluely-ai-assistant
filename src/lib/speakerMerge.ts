/**
 * The meeting page's Speakers row after a Resume (2026-11-02).
 *
 * Someone on the microphone who talks again after a Resume comes back under a
 * new number (the provider numbers voices afresh, and voices are not matched
 * by sound). The saved notes carry `speakerMerges` (meetingResume.ts
 * resumeMergeSuggestions): for each such voice, the first part's voices it may
 * be. Joining is a rename: the new voice takes that person's name, and voices
 * with the same saved name are one person on the row, renamed together.
 *
 * Pure: no React, no platform branches.
 */

export interface SpeakerMergeSuggestion {
    id: string;
    candidates: string[];
}

/** One chip on the Speakers row: every id saved under the same name is one person. */
export interface SpeakerChip {
    /** The id the chip edits from (the first one heard). */
    id: string;
    /** Every id this person was saved under. */
    ids: string[];
}

type Labels = Record<string, string> | null | undefined;

const named = (labels: Labels, id: string): string | null => {
    const v = labels?.[id];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/**
 * Ids in the order heard, as chips: ids with the same saved name together.
 * The user ("me") is never joined to anyone.
 */
export function speakerChips(ids: string[], labels: Labels): SpeakerChip[] {
    const chips: SpeakerChip[] = [];
    const byName = new Map<string, SpeakerChip>();
    for (const id of ids) {
        if (chips.some((c) => c.ids.includes(id))) continue;
        const name = id === 'me' ? null : named(labels, id);
        const key = name?.toLowerCase();
        const same = key ? byName.get(key) : undefined;
        if (same) { same.ids.push(id); continue; }
        const chip = { id, ids: [id] };
        chips.push(chip);
        if (key) byName.set(key, chip);
    }
    return chips;
}

/**
 * Who a chip may be, from the saved part: the candidates still shown as a
 * different person. Empty once the voice has a name of its own (a rename, or
 * a join), so the offer goes away.
 */
export function mergeOffers(chip: SpeakerChip, merges: unknown, labels: Labels): string[] {
    if (!Array.isArray(merges) || named(labels, chip.id)) return [];
    const offer = (merges as SpeakerMergeSuggestion[]).find((m) => m && m.id === chip.id);
    if (!offer || !Array.isArray(offer.candidates)) return [];
    return offer.candidates.filter((c) => typeof c === 'string' && !chip.ids.includes(c));
}

/**
 * The labels after joining `chip` to `target` under `targetName` (the name the
 * page shows for target now). An unnamed target is saved under that name too,
 * so the two stay one person, and a later rename of either renames both.
 */
export function joinSpeakers(labels: Labels, chip: SpeakerChip, target: SpeakerChip, targetName: string): Record<string, string> {
    const name = targetName.trim();
    const next: Record<string, string> = { ...(labels || {}) };
    if (!name) return next;
    for (const id of [...target.ids, ...chip.ids]) next[id] = name;
    return next;
}

/** The labels after renaming a chip: every id the person was saved under. */
export function renameSpeaker(labels: Labels, chip: SpeakerChip, name: string): Record<string, string> {
    const next: Record<string, string> = { ...(labels || {}) };
    for (const id of chip.ids) {
        if (name.trim()) next[id] = name.trim();
        else delete next[id];
    }
    return next;
}
