// IPC for Gmail in Settings › Connectors (gmail.ts), and the brief's read of
// recent threads with a meeting's attendees.
//
// Every handler goes through the caller's `guard` (the launcher window only,
// as outputsIpc does). Mail leaves the computer only from
// 'connectors:gmail-send-followup', which the user reaches by pressing Send;
// threads are read only for a brief, only while the brief switch is on.
//
// Electron (safeStorage, shell.openExternal, CalendarManager) comes in through
// deps or a lazy require, so tests run this under plain Node.

import type { OutputResult } from '../../../src/types/meetingOutputs';
import type { GmailStatus } from '../../../src/types/connectors';
import { GmailError, GmailService, MAX_BODY_BYTES, MAX_RECIPIENTS, type GmailDeps } from './gmail';
import type { FetchLike } from './httpRequest';
import { checkAllowed, connectorsAllowed, requirePro } from './connectorAccess';

type SafeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => void;
type Guard = <A extends any[]>(fallback: unknown, fn: (event: any, ...args: A) => unknown) => (event: any, ...args: A) => Promise<unknown>;

export interface GmailIpcDeps {
    safeHandle: SafeHandle;
    guard: Guard;
    userDataDir: string;
    safeStorage: GmailDeps['safeStorage'];
    openExternal(url: string): Promise<unknown> | unknown;
    platform: NodeJS.Platform;
    /** The meeting the follow-up is about; null when it does not exist. When absent the meeting is not checked. */
    loadFollowUpContext?(meetingId: string): unknown | Promise<unknown>;
    /** Calendar's Google client by default (CalendarManager.calendarOAuthClient). */
    client?(): { id: string; secret: string };
    /** Whether Google Calendar holds this account's grant; by default asks CalendarManager. */
    grantShared?(account: string | undefined): boolean;
    fetchImpl?: FetchLike;
    now?(): number;
    /** Pro or trial (connectorAccess.ts): connect, briefs on and send need it; status, cancel and disconnect never do. */
    connectorsAllowed?: () => boolean;
}

export const GMAIL_CHANNELS = {
    status: 'connectors:gmail-status',
    connect: 'connectors:gmail-connect',
    cancel: 'connectors:gmail-cancel',
    disconnect: 'connectors:gmail-disconnect',
    setBriefs: 'connectors:gmail-set-briefs',
    sendFollowUp: 'connectors:gmail-send-followup',
} as const;

/** The brief's whole budget for Gmail, both reads included. */
export const BRIEF_EMAIL_BUDGET_MS = 8_000;

const FORBIDDEN: OutputResult = { ok: false, kind: 'forbidden', message: 'Not available here.' };
const NO_STATUS: GmailStatus = { available: false, connected: false, briefsEnabled: false };

let service: GmailService | null = null;
let allowed: () => boolean = () => false;

/** The app's Gmail service, once registerGmailIpc ran. */
export function getGmailService(): GmailService | null {
    return service;
}

function calendarClient(): { id: string; secret: string } {
    try {
        const { calendarOAuthClient } = require('../CalendarManager');
        return calendarOAuthClient();
    } catch {
        return { id: '', secret: '' };
    }
}

function calendarHoldsGrant(account: string | undefined): boolean {
    try {
        const { CalendarManager } = require('../CalendarManager');
        const s = CalendarManager.getInstance().getConnectionStatus();
        if (!s?.connected) return false;
        // Unknown on either side: keep the grant, since revoking might end Calendar.
        if (!account || !s.email) return true;
        return String(s.email).toLowerCase() === account.toLowerCase();
    } catch {
        return false;
    }
}

const failed = (err: unknown, fallback: string): OutputResult => (err instanceof GmailError
    ? { ok: false, kind: err.kind, message: err.message }
    : { ok: false, kind: 'unknown', message: err instanceof Error && err.message && !/\d{3}|_/.test(err.message) ? err.message : fallback });

export function registerGmailIpc(deps: GmailIpcDeps): GmailService {
    const gmail = new GmailService({
        userDataDir: deps.userDataDir,
        safeStorage: deps.safeStorage,
        client: deps.client ?? calendarClient,
        openExternal: deps.openExternal,
        platform: deps.platform,
        grantShared: deps.grantShared ?? calendarHoldsGrant,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.now ? { now: deps.now } : {}),
    });
    service = gmail;
    const { safeHandle, guard } = deps;
    const gate = deps.connectorsAllowed ?? connectorsAllowed;
    allowed = gate;
    const proGuard: Guard = (fallback, fn) => guard(fallback, requirePro(gate, fn));
    let signIn: AbortController | null = null;

    const withAccess = (s: GmailStatus): GmailStatus => (checkAllowed(gate) ? s : { ...s, locked: true });
    safeHandle(GMAIL_CHANNELS.status, guard(NO_STATUS, async (): Promise<GmailStatus> => withAccess(gmail.status())));

    safeHandle(GMAIL_CHANNELS.connect, proGuard(FORBIDDEN, async (): Promise<OutputResult> => {
        // One sign-in at a time: a second Connect replaces the first, whose port closes.
        signIn?.abort();
        const ctl = new AbortController();
        signIn = ctl;
        try {
            await gmail.connect({ signal: ctl.signal });
            return { ok: true };
        } catch (err: any) {
            // Cancel: nothing to say.
            if (ctl.signal.aborted) return { ok: false, kind: 'unknown', message: '' };
            const cause = err?.cause instanceof GmailError ? err.cause : err;
            return failed(cause, 'Gmail could not be connected. Try again.');
        } finally {
            if (signIn === ctl) signIn = null;
        }
    }));

    safeHandle(GMAIL_CHANNELS.cancel, guard(undefined, async () => {
        signIn?.abort();
        signIn = null;
    }));

    safeHandle(GMAIL_CHANNELS.disconnect, guard(FORBIDDEN, async (): Promise<OutputResult> => {
        try {
            await gmail.disconnect();
            return { ok: true };
        } catch (err) {
            return failed(err, 'Gmail could not be disconnected. Try again.');
        }
    }));

    safeHandle(GMAIL_CHANNELS.setBriefs, guard(NO_STATUS, async (_e, enabled: unknown): Promise<GmailStatus> => {
        if (typeof enabled !== 'boolean') return gmail.status();
        // Turning briefs off is always allowed; on needs Pro or a trial.
        if (enabled && !checkAllowed(gate)) return withAccess(gmail.status());
        return withAccess(gmail.setBriefsEnabled(enabled));
    }));

    safeHandle(GMAIL_CHANNELS.sendFollowUp, proGuard(FORBIDDEN, async (_e, input: unknown): Promise<OutputResult & { messageUrl?: string }> => {
        const checked = checkFollowUpInput(input);
        if ('message' in checked) return { ok: false, kind: 'invalid_input', message: checked.message };
        if (deps.loadFollowUpContext) {
            let meeting: unknown = null;
            try { meeting = await deps.loadFollowUpContext(checked.meetingId); } catch { meeting = null; }
            if (!meeting) return { ok: false, kind: 'not_found', message: 'That meeting could not be found.' };
        }
        try {
            const sent = await gmail.sendMessage(checked);
            return { ok: true, messageUrl: sent.url };
        } catch (err) {
            return failed(err, 'The email could not be sent. Try again.');
        }
    }));

    return gmail;
}

/** The send payload's shape and bounds; the addresses themselves are checked by gmail.validateOutgoing. */
export function checkFollowUpInput(input: unknown): { meetingId: string; to: string[]; subject: string; body: string } | { message: string } {
    if (!input || typeof input !== 'object') return { message: 'Nothing to send.' };
    const { meetingId, to, subject, body } = input as Record<string, unknown>;
    if (typeof meetingId !== 'string' || !meetingId || meetingId.length > 200) return { message: 'That meeting could not be found.' };
    if (!Array.isArray(to) || to.length === 0) return { message: 'Add at least one recipient.' };
    if (to.length > MAX_RECIPIENTS) return { message: `Gmail sends to at most ${MAX_RECIPIENTS} people at once from Natively.` };
    if (to.some((t) => typeof t !== 'string' || t.length > 320)) return { message: 'One of the recipients is not an email address.' };
    if (typeof subject !== 'string' || subject.length > 2000) return { message: 'Add a subject.' };
    if (typeof body !== 'string' || body.length > MAX_BODY_BYTES) return { message: typeof body === 'string' ? 'This email is too long to send from Natively.' : 'The email is empty.' };
    return { meetingId, to: to as string[], subject, body };
}

/**
 * Recent emails with these people, for the brief before a meeting. [] when
 * Gmail is not connected, the brief switch is off, or anything fails. Never
 * throws; gives up after eight seconds.
 */
export async function gmailBriefContext(attendeeEmails: string[]): Promise<Array<{ subject: string; from: string; date: string; snippet: string }>> {
    const gmail = service;
    if (!gmail) return [];
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        // Connectors are Pro: no Gmail read for a brief without it.
        if (!checkAllowed(allowed)) return [];
        if (!gmail.status().briefsEnabled) return [];
        const read = gmail.threadsWithPeople(Array.isArray(attendeeEmails) ? attendeeEmails : [], { signal: ctl.signal, perRequestTimeoutMs: 5_000 });
        const budget = new Promise<null>((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve(null); }, BRIEF_EMAIL_BUDGET_MS); });
        const threads = await Promise.race([read, budget]);
        read.catch(() => { /* settled after the budget */ });
        if (!threads) return [];
        return threads.map((t) => ({ subject: t.subject, from: t.from, date: t.date, snippet: t.snippet }));
    } catch {
        return [];
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** For tests: forget the registered service. */
export function resetGmailServiceForTests(): void {
    service = null;
    allowed = () => false;
}
