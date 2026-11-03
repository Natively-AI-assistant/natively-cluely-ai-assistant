/**
 * Blind comparison of two versions of a meeting's notes (2026-10-15).
 *
 * When a meeting has two or more versions of its notes (Regenerate keeps the
 * earlier ones, notesVersions.ts), the meeting page offers Compare: the two
 * are shown side by side as "A" and "B" in a random order, with nothing that
 * says which template or model wrote them, until the user picks the better one
 * or "About the same" (and, optionally, why). Then the page reveals which was
 * which.
 *
 * Who is A and who is B lives here, in main, per comparison: the renderer only
 * gets the two notes with their template, model and provider fields removed,
 * and an id to answer with.
 *
 * Stored on this machine only, beside the thumbs ratings (notesRatings.ts):
 * table meeting_notes_comparisons (DatabaseManager.ensureMeetingNotesSchema).
 * Nothing is sent anywhere.
 *
 * A pick also settles the tabs (2026-11-03, Evin): the version that lost is
 * deleted with its tab. When an earlier version beats the current notes, it
 * becomes the meeting's notes (keeping the meeting's own speaker names, memory
 * record and shared screens) and the current notes are deleted. "About the
 * same" deletes nothing. If either side changed since the comparison opened
 * (a Regenerate in between), nothing is deleted.
 *
 * Platform-independent; the store, the random source and the clock are injected.
 */
import crypto from 'node:crypto';
import { notesContentHash, notesVersionLabel } from './notesVersions';

export type CompareChoice = 'A' | 'B' | 'same';
/** A version of the notes: an earlier one by id, or the current notes (null). */
export type VersionRef = number | null;

export const COMPARE_REASON_MAX = 500;
/** Comparisons left open (shown, not answered) are forgotten past this many. */
const MAX_OPEN = 20;

/** The parts of DatabaseManager this module uses. */
export interface NotesComparisonStore {
    getMeetingDetails(id: string): { id: string; detailedSummary?: any } | null;
    getNotesVersions(meetingId: string): Array<{ id: number; label: string; createdAt: number; detailedSummary: any }>;
    saveNotesComparison(r: StoredComparison): boolean;
    deleteNotesVersion(meetingId: string, versionId: number): boolean;
    replaceDetailedSummary(meetingId: string, detailedSummary: any): boolean;
}

/** What a pick did to the tabs: the version deleted, and the earlier one that became the notes. */
export interface PickSettlement {
    meetingId: string;
    removed: 'current' | number | null;
    promoted: number | null;
}

/**
 * What a pick should do (pure): the loser goes; when the loser is the current
 * notes, the winner takes their place. Null for "About the same".
 */
export function settlePick(choice: CompareChoice, a: VersionRef, b: VersionRef): { drop: VersionRef; promote: number | null } | null {
    if (choice !== 'A' && choice !== 'B') return null;
    const winner = choice === 'A' ? a : b;
    const loser = choice === 'A' ? b : a;
    if (winner === loser) return null;
    return { drop: loser, promote: loser === null ? winner : null };
}

/** Fields that belong to the meeting, not to one version of its notes: kept when an earlier version becomes the notes. */
const MEETING_FIELDS = ['speakerLabels', 'meetingMemory', 'sharedScreens'];

export interface ComparisonSide {
    /** 'current' or the earlier version's id. */
    version: 'current' | number;
    /** The template the notes were written in ("General", "Sales call"). */
    label: string;
    provider: string | null;
    model: string | null;
}

export interface StoredComparison {
    meetingId: string;
    aHash: string;
    bHash: string;
    aLabel: string;
    bLabel: string;
    aProvider: string | null;
    aModel: string | null;
    bProvider: string | null;
    bModel: string | null;
    choice: 'a' | 'b' | 'same';
    reason: string | null;
    createdAt: number;
}

/** Fields that would say who wrote the notes; never sent before the pick. */
const IDENTIFYING_FIELDS = ['mode', 'generation', 'recipes', 'speakerLabels', 'userEditedAt'];

/** The notes with every field that names a template, model or provider taken out. */
export function blindNotes(detailed: any): any {
    if (!detailed || typeof detailed !== 'object') return detailed;
    const copy: Record<string, unknown> = { ...detailed };
    for (const f of IDENTIFYING_FIELDS) delete copy[f];
    return copy;
}

/** Which of the pair is shown as A: true puts the second one first. */
export function blindOrder(random: () => number): boolean {
    return random() < 0.5;
}

function str(v: unknown): string | null {
    return typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
}

function sideOf(ref: VersionRef, detailed: any): ComparisonSide {
    return {
        version: ref === null ? 'current' : ref,
        label: notesVersionLabel(detailed),
        provider: str(detailed?.generation?.provider),
        model: str(detailed?.generation?.model),
    };
}

interface OpenComparison {
    meetingId: string;
    a: { ref: VersionRef; detailed: any };
    b: { ref: VersionRef; detailed: any };
}

export class NotesComparisons {
    private readonly open = new Map<string, OpenComparison>();
    private readonly random: () => number;
    private readonly now: () => number;
    private readonly newId: () => string;

    constructor(
        private readonly store: NotesComparisonStore,
        opts: { random?: () => number; now?: () => number; newId?: () => string } = {},
    ) {
        this.random = opts.random ?? Math.random;
        this.now = opts.now ?? Date.now;
        this.newId = opts.newId ?? (() => crypto.randomUUID());
    }

    private notesFor(meetingId: string, ref: VersionRef): any | null {
        if (ref === null) return this.store.getMeetingDetails(meetingId)?.detailedSummary ?? null;
        return this.store.getNotesVersions(meetingId).find((v) => v.id === ref)?.detailedSummary ?? null;
    }

    /**
     * Open a comparison of two versions. Null when either is missing, or both
     * are the same version or say the same thing (nothing to compare).
     */
    start(meetingId: string, refs: [VersionRef, VersionRef]): { id: string; a: any; b: any } | null {
        if (typeof meetingId !== 'string' || !meetingId || !Array.isArray(refs) || refs.length !== 2) return null;
        const [first, second] = refs;
        if (first === second) return null;
        const one = this.notesFor(meetingId, first);
        const two = this.notesFor(meetingId, second);
        if (!one || !two) return null;
        if (notesContentHash(one) === notesContentHash(two)) return null;
        const swap = blindOrder(this.random);
        const a = swap ? { ref: second, detailed: two } : { ref: first, detailed: one };
        const b = swap ? { ref: first, detailed: one } : { ref: second, detailed: two };
        const id = this.newId();
        this.open.set(id, { meetingId, a, b });
        while (this.open.size > MAX_OPEN) this.open.delete(this.open.keys().next().value as string);
        return { id, a: blindNotes(a.detailed), b: blindNotes(b.detailed) };
    }

    /**
     * The user's pick: stored, then which was which. Null for an unknown or
     * already answered comparison, or a choice that is not A, B or same.
     */
    pick(id: string, choice: CompareChoice, reason?: string | null): { choice: CompareChoice; a: ComparisonSide; b: ComparisonSide; saved: boolean } & PickSettlement | null {
        const c = this.open.get(id);
        if (!c || (choice !== 'A' && choice !== 'B' && choice !== 'same')) return null;
        this.open.delete(id);
        const a = sideOf(c.a.ref, c.a.detailed);
        const b = sideOf(c.b.ref, c.b.detailed);
        const why = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim().slice(0, COMPARE_REASON_MAX) : '';
        const saved = this.store.saveNotesComparison({
            meetingId: c.meetingId,
            aHash: notesContentHash(c.a.detailed),
            bHash: notesContentHash(c.b.detailed),
            aLabel: a.label,
            bLabel: b.label,
            aProvider: a.provider,
            aModel: a.model,
            bProvider: b.provider,
            bModel: b.model,
            choice: choice === 'A' ? 'a' : choice === 'B' ? 'b' : 'same',
            reason: why || null,
            createdAt: this.now(),
        });
        return { choice, a, b, saved, ...this.settle(c, choice) };
    }

    /** Delete the loser (and promote an earlier winner). Never throws. */
    private settle(c: OpenComparison, choice: CompareChoice): PickSettlement {
        const none: PickSettlement = { meetingId: c.meetingId, removed: null, promoted: null };
        const plan = settlePick(choice, c.a.ref, c.b.ref);
        if (!plan) return none;
        try {
            const opened = (ref: VersionRef) => (c.a.ref === ref ? c.a.detailed : c.b.detailed);
            const unchanged = (ref: VersionRef) => {
                const now = this.notesFor(c.meetingId, ref);
                return !!now && notesContentHash(now) === notesContentHash(opened(ref));
            };
            if (!unchanged(c.a.ref) || !unchanged(c.b.ref)) return none;
            if (plan.drop !== null) {
                return this.store.deleteNotesVersion(c.meetingId, plan.drop) ? { ...none, removed: plan.drop } : none;
            }
            if (plan.promote === null) return none;
            const current = this.notesFor(c.meetingId, null);
            const winner = this.notesFor(c.meetingId, plan.promote);
            const next: Record<string, unknown> = { ...winner };
            for (const f of MEETING_FIELDS) if (current?.[f] !== undefined) next[f] = current[f];
            if (!this.store.replaceDetailedSummary(c.meetingId, next)) return none;
            // The earlier version is the notes now: its own tab would be a duplicate.
            this.store.deleteNotesVersion(c.meetingId, plan.promote);
            return { ...none, removed: 'current', promoted: plan.promote };
        } catch (e: any) {
            console.warn('[notesCompare] the pick was kept but the versions were not settled:', e?.message);
            return none;
        }
    }
}
