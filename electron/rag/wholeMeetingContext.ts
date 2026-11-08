/**
 * The whole meeting as the Ask context, when it fits (2026-10-31).
 *
 * The meeting page's Ask sent the model only the retrieved chunks that matched
 * the question. In the 21-meeting Natively vs Granola benchmark that lost
 * answers Granola got from the same audio: "What does Gareth need?" retrieved
 * nothing about Gareth (his own lines never say his name and every other
 * speaker is labelled THEM), so the answer was "That didn't come up" while
 * the notes named him eight times. A six-minute meeting is a few thousand
 * tokens: for a meeting that fits, the model reads its notes (which name the
 * people) and the full transcript, as Granola's chat on a note does. A longer
 * meeting keeps retrieval.
 *
 * Pure text building plus one read of the meeting's own rows; no platform branch.
 */
import type Database from 'better-sqlite3';
import { formatChunkForContext } from './SemanticChunker';

/** Transcript tokens up to which the whole meeting goes to the model (about 45 minutes of talk). */
export const WHOLE_MEETING_TOKEN_BUDGET = 12000;

type NoteBullet = { text?: string };
type Detailed = {
    overview?: string;
    tldr?: string[];
    sectionsV3?: Array<{ id?: string; title?: string; bullets?: NoteBullet[] }>;
    decisions?: Array<{ text?: string } | string>;
    actionItemsV3?: Array<{ text?: string; owner?: string; deadline?: string }>;
    openQuestions?: Array<{ text?: string } | string>;
    people?: Array<{ name?: string; role?: string } | string>;
};

const textOf = (x: { text?: string } | string | undefined): string => (typeof x === 'string' ? x : x?.text ?? '').trim();

/** The saved notes as plain text: who was there, then what the notes say. Empty when there are none. */
export function notesAsText(title: string | null | undefined, d: Detailed | null | undefined): string {
    if (!d) return '';
    const out: string[] = [];
    if (title?.trim()) out.push(`Title: ${title.trim()}`);
    const people = (d.people ?? []).map((p) => (typeof p === 'string' ? p : [p?.name, p?.role].filter(Boolean).join(', '))).filter(Boolean);
    if (people.length) out.push(`People: ${people.join('; ')}`);
    if (d.overview?.trim()) out.push(d.overview.trim());
    const tldr = (d.tldr ?? []).map((t) => t?.trim()).filter(Boolean);
    if (tldr.length) out.push(`Summary:\n${tldr.map((t) => `- ${t}`).join('\n')}`);
    for (const s of d.sectionsV3 ?? []) {
        const bullets = (s.bullets ?? []).map(textOf).filter(Boolean);
        if (s.title && bullets.length) out.push(`${s.title}:\n${bullets.map((b) => `- ${b}`).join('\n')}`);
    }
    const decisions = (d.decisions ?? []).map(textOf).filter(Boolean);
    if (decisions.length) out.push(`Decisions:\n${decisions.map((t) => `- ${t}`).join('\n')}`);
    const actions = (d.actionItemsV3 ?? []).filter((a) => a?.text?.trim()).map((a) => `- ${a.owner ? `${a.owner}: ` : ''}${a.text!.trim()}${a.deadline ? ` (by ${a.deadline})` : ''}`);
    if (actions.length) out.push(`Action items:\n${actions.join('\n')}`);
    const open = (d.openQuestions ?? []).map(textOf).filter(Boolean);
    if (open.length) out.push(`Open questions:\n${open.map((t) => `- ${t}`).join('\n')}`);
    return out.join('\n\n');
}

export type WholeMeetingChunk = { text: string; speaker: string; startMs: number; tokenCount: number };

/** Notes then the full transcript, or null when the transcript is over the budget or empty. */
export function buildWholeMeetingContext(params: {
    title?: string | null;
    detailed?: Detailed | null;
    chunks: WholeMeetingChunk[];
    meetingStartMs?: number;
    budget?: number;
    /** Over the budget: null (the default, so Ask falls back to retrieval), or the notes and the transcript's start (recipes). */
    overflow?: 'none' | 'cut';
}): string | null {
    const { chunks } = params;
    if (chunks.length === 0) return null;
    const budget = params.budget ?? WHOLE_MEETING_TOKEN_BUDGET;
    const tokens = chunks.reduce((n, c) => n + (c.tokenCount || 0), 0);
    let kept = chunks;
    if (tokens > budget) {
        if (params.overflow !== 'cut') return null;
        let used = 0;
        kept = chunks.filter((c) => (used += c.tokenCount || 0) <= budget);
    }
    const transcript = kept
        .map((c) => formatChunkForContext({ text: c.text, speaker: c.speaker, startMs: c.startMs } as any, params.meetingStartMs))
        .join('\n\n');
    const notes = notesAsText(params.title, params.detailed);
    const header = kept.length < chunks.length
        ? 'TRANSCRIPT, its first part only (ME is the user; THEM is everyone else; the notes cover the whole meeting):'
        : 'FULL TRANSCRIPT (ME is the user; THEM is everyone else):';
    return `${notes ? `NOTES (written from this meeting):\n${notes}\n\n` : ''}${header}\n${transcript}`;
}

/** Reads the meeting's chunks and notes; null when it is too long, has no chunks, or cannot be read. */
export function loadWholeMeetingContext(db: Database.Database, meetingId: string, budget = WHOLE_MEETING_TOKEN_BUDGET, overflow: 'none' | 'cut' = 'none'): string | null {
    try {
        const rows = db.prepare(
            'SELECT speaker, start_timestamp_ms AS startMs, cleaned_text AS text, token_count AS tokenCount FROM chunks WHERE meeting_id = ? ORDER BY chunk_index ASC',
        ).all(meetingId) as Array<{ speaker: string | null; startMs: number | null; text: string; tokenCount: number }>;
        if (rows.length === 0) return null;
        if (overflow !== 'cut' && rows.reduce((n, r) => n + (r.tokenCount || 0), 0) > budget) return null;
        const meeting = db.prepare('SELECT title, start_time AS startTime, summary_json AS summaryJson FROM meetings WHERE id = ?').get(meetingId) as
            | { title: string | null; startTime: number | null; summaryJson: string | null }
            | undefined;
        let detailed: Detailed | null = null;
        try { detailed = JSON.parse(meeting?.summaryJson || '{}')?.detailedSummary ?? null; } catch { /* unreadable notes: transcript only */ }
        return buildWholeMeetingContext({
            title: meeting?.title,
            detailed,
            chunks: rows.map((r) => ({ text: r.text, speaker: r.speaker || 'Unknown', startMs: r.startMs ?? 0, tokenCount: r.tokenCount })),
            meetingStartMs: meeting?.startTime ?? undefined,
            budget,
            overflow,
        });
    } catch {
        return null;
    }
}
