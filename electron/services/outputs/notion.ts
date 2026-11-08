// Notion: an internal integration token, a parent page or database the user
// picked (found with /v1/search), and the notes as a new page of Notion blocks.
// Notion takes at most 100 blocks per request and 2,000 characters per text
// object, so the page is created with the first 100 and the rest is appended in
// batches of 100. Pure apart from the requests, whose fetch is injected.

import { formatOffset, inlineSpans, type NotesDocument } from './notesDocument';
import { ConnectionError, httpRequest, type FetchLike } from './httpRequest';
import type { NotionParentInfo, NotionSearchResult } from '../../../src/types/meetingOutputs';

export const NOTION_API = 'https://api.notion.com/v1';
/** Pinned so a database parent keeps meaning a database (later versions split it into data sources). */
export const NOTION_VERSION = '2022-06-28';
export const NOTION_BLOCKS_PER_REQUEST = 100;
export const NOTION_TEXT_MAX = 2000;
const NOTION_RICH_TEXT_PER_BLOCK = 100;
/** Transcript lines are packed into paragraphs of about this size, to keep the block count down. */
const TRANSCRIPT_PARAGRAPH_CHARS = 1800;
/** A long meeting's transcript stops here; the page says so. */
export const NOTION_MAX_BLOCKS = 1000;

export type NotionBlock = Record<string, any>;
interface RichText { type: 'text'; text: { content: string }; annotations?: Record<string, boolean> }

export function notionHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION };
}

/** Notion's integration tokens: "secret_…" (older) or "ntn_…". */
export function looksLikeNotionToken(token: unknown): token is string {
    return typeof token === 'string' && /^(?:secret_|ntn_)[A-Za-z0-9]{20,120}$/.test(token.trim());
}

/** A Notion id from a pasted id or URL, normalised with dashes. */
export function normaliseNotionId(raw: unknown): string | null {
    const hex = String(raw ?? '').replace(/-/g, '').match(/[0-9a-f]{32}/i)?.[0];
    if (!hex) return null;
    const h = hex.toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function chunkString(text: string, max: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
    return out;
}

export function richText(text: string, extra?: Record<string, boolean>): RichText[] {
    const out: RichText[] = [];
    for (const span of inlineSpans(text)) {
        const annotations: Record<string, boolean> = { ...(extra || {}) };
        if (span.bold) annotations.bold = true;
        if (span.italic) annotations.italic = true;
        if (span.code) annotations.code = true;
        for (const piece of chunkString(span.text, NOTION_TEXT_MAX)) {
            out.push({ type: 'text', text: { content: piece }, ...(Object.keys(annotations).length ? { annotations } : {}) });
        }
    }
    return out.slice(0, NOTION_RICH_TEXT_PER_BLOCK);
}

const block = (type: string, body: Record<string, unknown>): NotionBlock => ({ object: 'block', type, [type]: body });

export function buildNotionBlocks(doc: NotesDocument, opts: { includeTranscript: boolean }): NotionBlock[] {
    const blocks: NotionBlock[] = [];
    const meta = [doc.dateLabel, doc.durationLabel].filter(Boolean).join(' · ');
    const people = doc.attendees.length ? doc.attendees.map((a) => a.name || a.email) : doc.participants;
    if (meta) blocks.push(block('paragraph', { rich_text: richText(meta, { italic: true }) }));
    if (people.length) blocks.push(block('paragraph', { rich_text: richText(`With ${people.join(', ')}`, { italic: true }) }));

    for (const s of doc.sections) {
        blocks.push(block('heading_2', { rich_text: richText(s.heading) }));
        if (s.paragraph) for (const p of s.paragraph.split(/\n{2,}/)) blocks.push(block('paragraph', { rich_text: richText(p) }));
        for (const b of s.bullets) blocks.push(block('bulleted_list_item', { rich_text: richText(b) }));
    }

    if (doc.actionItems.length) {
        blocks.push(block('heading_2', { rich_text: richText('Action items') }));
        for (const a of doc.actionItems) {
            const parts: RichText[] = [];
            if (a.owner) parts.push(...richText(`${a.owner}: `, { bold: true }));
            parts.push(...richText(a.text));
            if (a.deadline) parts.push(...richText(` (by ${a.deadline})`, { italic: true }));
            blocks.push(block('to_do', { rich_text: parts.slice(0, NOTION_RICH_TEXT_PER_BLOCK), checked: a.done }));
        }
    }

    if (opts.includeTranscript && doc.transcript.length) {
        blocks.push(block('heading_2', { rich_text: richText('Transcript') }));
        let current = '';
        const flush = () => { if (current) blocks.push(block('paragraph', { rich_text: chunkString(current, NOTION_TEXT_MAX).map((c) => ({ type: 'text', text: { content: c } })) })); current = ''; };
        for (const l of doc.transcript) {
            const line = `[${formatOffset(l.offsetMs)}] ${l.speaker}: ${l.text}`;
            if (current && current.length + 1 + line.length > TRANSCRIPT_PARAGRAPH_CHARS) flush();
            current = current ? `${current}\n${line}` : line;
        }
        flush();
    }

    if (blocks.length > NOTION_MAX_BLOCKS) {
        const kept = blocks.slice(0, NOTION_MAX_BLOCKS - 1);
        kept.push(block('paragraph', { rich_text: richText('The rest of this meeting is in Natively.', { italic: true }) }));
        return kept;
    }
    return blocks;
}

export function chunkBlocks<T>(blocks: T[], size: number = NOTION_BLOCKS_PER_REQUEST): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < blocks.length; i += size) out.push(blocks.slice(i, i + size));
    return out;
}

/** "Weekly sync, Oct 14, 2026". */
export function notionPageTitle(doc: NotesDocument, timeZone?: string): string {
    const d = new Date(doc.dateIso);
    let date = '';
    if (!Number.isNaN(d.getTime())) {
        try { date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(timeZone ? { timeZone } : {}) }); } catch { date = doc.dateIso.slice(0, 10); }
    }
    return (date ? `${doc.title}, ${date}` : doc.title).slice(0, NOTION_TEXT_MAX);
}

interface NotionCallOpts { token: string; fetchImpl?: FetchLike; signal?: AbortSignal }

function titleOf(item: any): string {
    if (item?.object === 'database') return (item.title || []).map((t: any) => t?.plain_text || '').join('').trim();
    const props = item?.properties || {};
    for (const key of Object.keys(props)) {
        if (props[key]?.type === 'title') return (props[key].title || []).map((t: any) => t?.plain_text || '').join('').trim();
    }
    return '';
}

export function parseNotionSearch(data: any): NotionSearchResult[] {
    const out: NotionSearchResult[] = [];
    for (const item of Array.isArray(data?.results) ? data.results : []) {
        if (item?.archived || item?.in_trash) continue;
        if (item?.object !== 'page' && item?.object !== 'database') continue;
        if (typeof item.id !== 'string') continue;
        out.push({ type: item.object, id: item.id, title: titleOf(item) || 'Untitled' });
    }
    return out;
}

export async function searchNotion(query: string, o: NotionCallOpts): Promise<NotionSearchResult[]> {
    const res = await httpRequest(`${NOTION_API}/search`, {
        method: 'POST',
        headers: notionHeaders(o.token),
        json: { query: query.slice(0, 200), page_size: 20, sort: { direction: 'descending', timestamp: 'last_edited_time' } },
        fetchImpl: o.fetchImpl,
        signal: o.signal,
    });
    return parseNotionSearch(res.data);
}

export async function testNotion(o: NotionCallOpts): Promise<void> {
    await httpRequest(`${NOTION_API}/users/me`, { headers: notionHeaders(o.token), fetchImpl: o.fetchImpl, signal: o.signal });
}

async function databaseTitleProperty(databaseId: string, o: NotionCallOpts): Promise<string> {
    const res = await httpRequest(`${NOTION_API}/databases/${encodeURIComponent(databaseId)}`, {
        headers: notionHeaders(o.token), fetchImpl: o.fetchImpl, signal: o.signal,
    });
    const props = res.data?.properties || {};
    for (const key of Object.keys(props)) if (props[key]?.type === 'title') return key;
    return 'Name';
}

export interface NotionPageResult {
    url?: string;
    /** True when the page exists but not every batch of blocks reached it. */
    partial: boolean;
    pageId?: string;
    /** The batches still to append to that page, in order, when partial. */
    remaining?: NotionBlock[][];
}

/**
 * Appends batches to a page in order, stopping at the first refusal. Returns
 * the batches not yet appended (empty when all landed), so a retry continues
 * the same page instead of making a second one.
 */
export async function appendNotionBatches(pageId: string, batches: NotionBlock[][], o: NotionCallOpts): Promise<NotionBlock[][]> {
    for (let i = 0; i < batches.length; i += 1) {
        try {
            await httpRequest(`${NOTION_API}/blocks/${encodeURIComponent(pageId)}/children`, {
                method: 'PATCH',
                headers: notionHeaders(o.token),
                json: { children: batches[i] },
                fetchImpl: o.fetchImpl,
                signal: o.signal,
            });
        } catch {
            return batches.slice(i);
        }
    }
    return [];
}

export async function createNotionPage(
    params: { parent: NotionParentInfo; title: string; blocks: NotionBlock[] },
    o: NotionCallOpts,
): Promise<NotionPageResult> {
    const id = normaliseNotionId(params.parent.id);
    if (!id) throw new ConnectionError('invalid_input', 'bad parent id');
    const title = [{ type: 'text', text: { content: params.title } }];
    const batches = chunkBlocks(params.blocks);
    let body: Record<string, unknown>;
    if (params.parent.type === 'database') {
        const prop = await databaseTitleProperty(id, o);
        body = { parent: { database_id: id }, properties: { [prop]: { title } } };
    } else {
        body = { parent: { page_id: id }, properties: { title: { title } } };
    }
    const created = await httpRequest(`${NOTION_API}/pages`, {
        method: 'POST',
        headers: notionHeaders(o.token),
        json: { ...body, children: batches[0] || [] },
        fetchImpl: o.fetchImpl,
        signal: o.signal,
    });
    const pageId = created.data?.id;
    const url = typeof created.data?.url === 'string' ? created.data.url : undefined;
    if (typeof pageId !== 'string') throw new ConnectionError('unknown', 'no page id');
    const remaining = await appendNotionBatches(pageId, batches.slice(1), o);
    return remaining.length ? { url, partial: true, pageId, remaining } : { url, partial: false, pageId };
}

/**
 * Pages made this session that did not get all their notes, per meeting. A
 * new send for that meeting is refused until the user picks: add the rest to
 * the same page, or start over with a new one. In memory only.
 */
export class NotionPartialPages {
    private readonly pages = new Map<string, { pageId: string; url?: string; remaining: NotionBlock[][] }>();
    get(meetingId: string) { return this.pages.get(meetingId) ?? null; }
    set(meetingId: string, entry: { pageId: string; url?: string; remaining: NotionBlock[][] }): void { this.pages.set(meetingId, entry); }
    clear(meetingId: string): void { this.pages.delete(meetingId); }
}
