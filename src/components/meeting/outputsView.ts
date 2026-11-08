/*
  The decisions behind the meeting page's outputs (2026-10-15), kept pure so
  they are tested without a DOM:

  - the follow-up email edited in place: which fields changed, and what is
    kept on screen after a save that worked or failed (an edit is never
    dropped before it is saved);
  - Send to CRM: enabled only for a preview of the CRM picked now, with people
    chosen from that preview;
  - Send to Notion: a half-made page is shown with its link and two choices;
  - Send to Slack: the draft's length against the one limit main enforces.
*/
import { SLACK_DRAFT_MAX_CHARS } from '../../types/meetingOutputs.ts';

// ── Follow-up email ───────────────────────────────────────────────────────

export interface FollowUpText { subject: string; body: string }

/**
 * Only what the user changed, compared with what is saved. An emptied body is
 * not a change (it would erase the email): it is left out.
 */
export function followUpChanges(pending: FollowUpText | null, saved: { subject?: string; body: string }): { subject?: string; body?: string } {
    if (!pending) return {};
    const out: { subject?: string; body?: string } = {};
    if (saved.subject !== undefined) {
        const subject = pending.subject.replace(/\s+/g, ' ').trim();
        if (subject !== saved.subject.trim()) out.subject = subject;
    }
    const body = pending.body.trim();
    if (body && body !== saved.body.trim()) out.body = body;
    return out;
}

export const FOLLOW_UP_SAVE_FAILED = 'Your edit to the email is not saved yet. It is still here; try again.';

/**
 * After a save answered (or failed). On success the pending text goes, unless
 * the user has typed more since it was sent. On failure it stays, so the edit
 * is still on screen and in Copy, and the plain sentence offers a retry.
 */
export function settleFollowUpSave(
    current: FollowUpText | null,
    sent: FollowUpText,
    res: { ok: boolean; message?: string } | null | undefined,
): { pending: FollowUpText | null; error: string | null } {
    if (res?.ok) {
        const unchangedSince = !current || (current.subject === sent.subject && current.body === sent.body);
        return { pending: unchangedSince ? null : current, error: null };
    }
    return { pending: current ?? sent, error: res?.message || FOLLOW_UP_SAVE_FAILED };
}

// ── CRM ───────────────────────────────────────────────────────────────────

export interface CrmPreviewLike {
    ok: boolean;
    service: string;
    attendees: Array<{ email: string; matched: boolean }>;
}

/**
 * The people a Send writes to, or none: only from a preview that worked for
 * the CRM picked now, and only people that preview matched.
 */
export function crmSendable(target: string | null, preview: CrmPreviewLike | null, chosen: ReadonlySet<string>): string[] {
    if (!target || !preview || !preview.ok || preview.service !== target) return [];
    const matched = new Set(preview.attendees.filter((a) => a.matched).map((a) => a.email));
    return [...chosen].filter((e) => matched.has(e));
}

// ── Notion ────────────────────────────────────────────────────────────────

export type NotionView =
    | { state: 'done'; url?: string }
    | { state: 'partial'; url?: string; message: string }
    | { state: 'error'; message: string };

export function notionResultView(res: { ok?: boolean; partial?: boolean; url?: string; message?: string } | null | undefined): NotionView {
    if (res?.ok) return { state: 'done', ...(res.url ? { url: res.url } : {}) };
    if (res?.partial) return { state: 'partial', ...(res.url ? { url: res.url } : {}), message: res.message || 'The page was made in Notion, but only part of the notes reached it.' };
    return { state: 'error', message: res?.message || 'The page was not made. Try again.' };
}

// ── Slack ─────────────────────────────────────────────────────────────────

export function slackDraftStatus(text: string): { length: number; max: number; over: number; empty: boolean } {
    const length = text.trim().length;
    return { length, max: SLACK_DRAFT_MAX_CHARS, over: Math.max(0, length - SLACK_DRAFT_MAX_CHARS), empty: length === 0 };
}

// ── Share as link ─────────────────────────────────────────────────────────

export interface ShareLinkLike { url: string; createdAt: number; includeTranscript: boolean }

export type ShareLinkReadState = 'reading' | 'read' | 'failed';

/**
 * What the Share as link dialog shows: nothing until the meeting's link has
 * been read (a Create button before that could make a second link), then
 * either the offer to make one or the link that exists. When the read failed,
 * whether a link exists is unknown, so only the error and Try again.
 */
export function shareLinkView(read: ShareLinkReadState, link: ShareLinkLike | null): { state: 'reading' | 'failed' | 'none' | 'shared' } {
    if (read === 'reading') return { state: 'reading' };
    if (read === 'failed') return { state: 'failed' };
    return { state: link ? 'shared' : 'none' };
}
