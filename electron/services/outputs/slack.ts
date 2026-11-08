// Slack: the notes as an editable mrkdwn draft, the draft as Block Kit blocks,
// and the post to an Incoming Webhook the user added. Pure apart from the post,
// whose fetch is injected.
//
// The draft the user edits is readable text. Slack's control characters (&, <,
// >) are escaped when it is sent, so meeting text can never turn into a link,
// a user mention or an @channel ping.

import { actionItemLine, inlineSpans, type NotesDocument } from './notesDocument';
import { ConnectionError, httpRequest, type FetchLike } from './httpRequest';
import { SLACK_DRAFT_MAX_CHARS } from '../../../src/types/meetingOutputs';

/** Slack's limits: a section's text, the header, and the blocks in one message. */
export const SLACK_SECTION_MAX = 3000;
export const SLACK_HEADER_MAX = 150;
export const SLACK_MAX_BLOCKS = 50;
/** The longest draft the composer accepts (shown as a counter there); longer drafts are refused, never cut. */
export const SLACK_DRAFT_MAX = SLACK_DRAFT_MAX_CHARS;

const WEBHOOK_RE = /^https:\/\/hooks\.slack(?:-gov)?\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9_\-/]+$/;

export function isSlackWebhookUrl(url: unknown): url is string {
    return typeof url === 'string' && url.length <= 512 && WEBHOOK_RE.test(url.trim());
}

export function escapeSlackText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** **bold** → *bold*, *italic* / _italic_ → _italic_, `code` kept. */
export function toSlackInline(text: string): string {
    return inlineSpans(text)
        .map((s) => (s.code ? `\`${s.text}\`` : s.bold ? `*${s.text}*` : s.italic ? `_${s.text}_` : s.text))
        .join('');
}

/** The draft shown in the composer. Plain mrkdwn, not yet escaped. */
export function composeSlackDraft(doc: NotesDocument, opts: { includeActionItems: boolean }): string {
    const out: string[] = [];
    for (const s of doc.sections) {
        const lines = [`*${s.heading}*`];
        if (s.paragraph) lines.push(toSlackInline(s.paragraph));
        for (const b of s.bullets) lines.push(`• ${toSlackInline(b)}`);
        out.push(lines.join('\n'));
    }
    if (opts.includeActionItems && doc.actionItems.length) {
        out.push(['*Action items*', ...doc.actionItems.map((a) => `${a.done ? '☑' : '☐'} ${toSlackInline(actionItemLine(a))}`)].join('\n'));
    }
    return out.join('\n\n');
}

/** Never cut inside an escape (&amp; &lt; &gt;): the text is already escaped, so every & starts one. */
function safeCut(text: string, max: number): number {
    const a = text.lastIndexOf('&', max - 1);
    if (a > 0 && a > max - 5 && text.indexOf(';', a) >= max) return a;
    return max;
}

/**
 * Sections of at most `max` characters: paragraphs packed together (so a long
 * message of short paragraphs still fits Slack's 50 blocks), a paragraph over
 * the cap split on its lines, a line over it split without breaking an escape.
 * Nothing is dropped: joining the pieces gives back the text.
 */
export function splitForSlack(text: string, max: number = SLACK_SECTION_MAX): string[] {
    const pieces: string[] = [];
    let packed = '';
    const flush = () => { if (packed) { pieces.push(packed); packed = ''; } };
    for (const para of text.split(/\n{2,}/)) {
        const p = para.trim();
        if (!p) continue;
        if (p.length <= max) {
            const candidate = packed ? `${packed}\n\n${p}` : p;
            if (candidate.length <= max) { packed = candidate; continue; }
            flush();
            packed = p;
            continue;
        }
        flush();
        let current = '';
        for (const line of p.split('\n')) {
            const candidate = current ? `${current}\n${line}` : line;
            if (candidate.length <= max) { current = candidate; continue; }
            if (current) pieces.push(current);
            let rest = line;
            while (rest.length > max) {
                const cut = safeCut(rest, max);
                pieces.push(rest.slice(0, cut));
                rest = rest.slice(cut);
            }
            current = rest;
        }
        if (current) packed = current;
    }
    flush();
    return pieces;
}

export interface SlackPayload {
    text: string;
    blocks: Array<Record<string, unknown>>;
}

export type SlackDraftCheck =
    | { ok: true; payload: SlackPayload }
    | { ok: false; reason: 'empty' | 'too_long'; length: number; max: number };

/**
 * The message Slack receives (a header, the date line, the draft as sections),
 * or why the draft cannot be sent as it is. A draft over the limit, or one that
 * would need more blocks than one message holds, is refused, never shortened.
 */
export function checkSlackDraft(title: string, dateLabel: string, draft: string): SlackDraftCheck {
    const text = draft.trim();
    if (!text) return { ok: false, reason: 'empty', length: 0, max: SLACK_DRAFT_MAX };
    if (text.length > SLACK_DRAFT_MAX) return { ok: false, reason: 'too_long', length: text.length, max: SLACK_DRAFT_MAX };
    const header = title.length > SLACK_HEADER_MAX ? `${title.slice(0, SLACK_HEADER_MAX - 1)}…` : title;
    const blocks: Array<Record<string, unknown>> = [
        { type: 'header', text: { type: 'plain_text', text: header || 'Meeting notes', emoji: false } },
    ];
    if (dateLabel) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: escapeSlackText(dateLabel) }] });
    const pieces = splitForSlack(escapeSlackText(text));
    if (pieces.length > SLACK_MAX_BLOCKS - blocks.length) return { ok: false, reason: 'too_long', length: text.length, max: SLACK_DRAFT_MAX };
    for (const piece of pieces) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: piece } });
    // `text` is the notification and the fallback where blocks do not render.
    const fallback = `${escapeSlackText(title)}${dateLabel ? ` · ${escapeSlackText(dateLabel)}` : ''}`;
    return { ok: true, payload: { text: fallback, blocks } };
}

/** The plain sentence for a draft that cannot be sent as it is. */
export function slackDraftMessage(check: { reason: 'empty' | 'too_long'; length: number; max: number }): string {
    if (check.reason === 'empty') return 'The message is empty.';
    const over = check.length - check.max;
    return over > 0
        ? `The message is ${over.toLocaleString('en-US')} characters longer than one Slack message can be. Shorten it, or leave out the action items.`
        : 'The message has too many separate paragraphs for one Slack message. Join some of them, or shorten it.';
}

/** The payload for a draft already checked; throws (never cuts) when it does not fit. */
export function slackPayloadFromDraft(title: string, dateLabel: string, draft: string): SlackPayload {
    const res = checkSlackDraft(title, dateLabel, draft);
    if (!res.ok) throw new ConnectionError(res.reason === 'empty' ? 'invalid_input' : 'too_large', `draft ${res.reason}`);
    return res.payload;
}

export async function postSlackWebhook(url: string, payload: SlackPayload, fetchImpl?: FetchLike, signal?: AbortSignal): Promise<void> {
    await httpRequest(url, { method: 'POST', json: payload, fetchImpl, signal, maxResponseBytes: 64 * 1024 });
}

/**
 * "Test connection" without posting anything to the channel: an empty message
 * is refused by a live webhook as a bad request (Slack answers "no_text"),
 * while a revoked or mistyped one is refused as forbidden, missing or gone.
 * So a bad-request answer proves the webhook is live.
 */
export async function testSlackWebhook(url: string, fetchImpl?: FetchLike, signal?: AbortSignal): Promise<void> {
    try {
        await httpRequest(url, { method: 'POST', json: {}, fetchImpl, signal, maxResponseBytes: 16 * 1024 });
    } catch (err) {
        if (err instanceof ConnectionError && err.status === 400) return;
        // Slack answers a revoked webhook with "invalid_token" and a removed one with "no_service".
        if (err instanceof ConnectionError && (err.status === 403 || err.status === 404 || err.status === 410)) {
            throw new ConnectionError('not_found', 'webhook gone', err.status);
        }
        throw err;
    }
}
