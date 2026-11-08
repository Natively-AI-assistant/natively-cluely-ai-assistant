// Share as link: the notes as a public page on heynatively.com. The app sends
// the same document "Share as file" renders, with people's names only (never an
// email address), to natively-api (POST /v1/share) and keeps what comes back:
// the link and the token that turns it off. One JSON file in userData, keyed by
// meeting id, mode 0600, written whole or not at all (atomicFile.ts). The token
// only lets someone stop sharing, so it is not kept in the keychain.
//
// Plaintext on the server on purpose (Evin, 2026-10-16: the way Granola and
// Cluely do it). Pure where it can be: the payload, the size check and the
// store take no Electron, and the calls take a fetch stand-in, so every branch
// is tested without the network. Both platforms run this one code path.
//
// The rule throughout: the app never loses the token of a link that may still
// be public. A link that has to go (its meeting was deleted, all data was
// cleared, it could not be saved) is kept as "pending" and retried until the
// server confirms it is off.

import * as path from 'path';
import * as fs from 'fs';
import type { NotesDocument } from './notesDocument';
import { ConnectionError, httpRequest, type FetchLike } from './httpRequest';
import { readTextFileSync, writeFileAtomicSync, type AtomicFileDeps } from './atomicFile';
import type { MeetingDeleteHandle, MeetingDeleteTarget } from '../../db/meetingDeleteObservers';
import type { ConnectionErrorKind, OutputResult, ShareLinkInfo } from '../../../src/types/meetingOutputs';

export const SHARE_LINKS_FILE = 'meeting-shares.json';
/** The server's body limit; over it, the request is refused before it is read. */
export const SHARE_MAX_BYTES = 1024 * 1024;

/**
 * natively-api's caps (sharedNotes.js LIMITS). The server refuses a whole share
 * over any one of them, so the app trims to them before sending. Keep the two
 * in step.
 */
export const SHARE_LIMITS = Object.freeze({
    title: 300,
    label: 120, // date and duration labels, a person, an owner, a deadline, a speaker
    people: 50,
    sections: 40,
    heading: 200,
    paragraph: 8000,
    bullets: 200, // per section
    text: 2000, // a bullet, an action item, a transcript line
    actionItems: 200,
    transcript: 20000, // lines
});

// ── The payload ──────────────────────────────────────────────────────────

export interface SharePayload {
    title: string;
    dateIso: string;
    dateLabel: string;
    durationLabel?: string;
    people: string[];
    sections: Array<{ heading: string; paragraph?: string; bullets: string[] }>;
    actionItems: Array<{ text: string; owner?: string; deadline?: string; done: boolean }>;
    transcript?: Array<{ speaker: string; text: string; offsetMs: number }>;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** At most `max` characters, ending in "…" when cut, never splitting a surrogate pair. */
export function clip(s: string, max: number): string {
    if (s.length <= max) return s;
    let cut = max - 1;
    if (isHighSurrogate(s.charCodeAt(cut - 1))) cut--;
    return `${s.slice(0, cut)}…`;
}

/** A long transcript line as several of at most `max` characters, cut at a space where one is near. */
export function splitLine(text: string, max: number): string[] {
    const parts: string[] = [];
    let rest = text;
    while (rest.length > max) {
        let cut = rest.lastIndexOf(' ', max);
        if (cut < max / 2) cut = isHighSurrogate(rest.charCodeAt(max - 1)) ? max - 1 : max;
        parts.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts.filter(Boolean);
}

/**
 * What goes to the server, trimmed to its limits so a big meeting is still
 * shareable. Names only: an attendee without a name is left out rather than
 * shown by email, and when the calendar gave no names at all the people the
 * transcript heard are used instead, as the file does.
 */
export function sharePayload(doc: NotesDocument, opts: { includeTranscript: boolean }): SharePayload {
    const L = SHARE_LIMITS;
    const named = doc.attendees.map((a) => a.name).filter((n): n is string => !!n);
    const people = [...new Set((named.length ? named : doc.participants).map((p) => clip(p, L.label)))].slice(0, L.people);
    const transcript = opts.includeTranscript && doc.transcript.length
        ? doc.transcript
            .flatMap((l) => splitLine(l.text, L.text).map((text) => ({ speaker: clip(l.speaker, L.label), text, offsetMs: l.offsetMs })))
            .slice(0, L.transcript)
        : [];
    return {
        title: clip(doc.title, L.title),
        dateIso: doc.dateIso,
        dateLabel: clip(doc.dateLabel, L.label),
        ...(doc.durationLabel ? { durationLabel: clip(doc.durationLabel, L.label) } : {}),
        people,
        sections: doc.sections.slice(0, L.sections).map((s) => ({
            heading: clip(s.heading, L.heading),
            ...(s.paragraph ? { paragraph: clip(s.paragraph, L.paragraph) } : {}),
            bullets: s.bullets.slice(0, L.bullets).map((b) => clip(b, L.text)),
        })),
        actionItems: doc.actionItems.slice(0, L.actionItems).map((a) => ({
            text: clip(a.text, L.text),
            ...(a.owner ? { owner: clip(a.owner, L.label) } : {}),
            ...(a.deadline ? { deadline: clip(a.deadline, L.label) } : {}),
            done: a.done,
        })),
        ...(transcript.length ? { transcript } : {}),
    };
}

export function payloadBytes(payload: SharePayload): number {
    return Buffer.byteLength(JSON.stringify({ notes: payload }));
}

// ── The store ────────────────────────────────────────────────────────────

export interface ShareLinkRecord {
    id: string;
    url: string;
    revokeToken: string;
    createdAt: number;
    includeTranscript: boolean;
    /** Still public, but due to be turned off. Retried until the server confirms (ShareLinks.retryPending). */
    pendingRevoke?: boolean;
}

const ID_RE = /^[A-Za-z0-9]{8,32}$/;

function sanitizeRecord(raw: any): ShareLinkRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
    if (typeof raw.url !== 'string' || !/^https:\/\/[^\s"'<>]{1,300}$/.test(raw.url)) return null;
    if (typeof raw.revokeToken !== 'string' || !raw.revokeToken || raw.revokeToken.length > 200) return null;
    return {
        id: raw.id,
        url: raw.url,
        revokeToken: raw.revokeToken,
        createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
        includeTranscript: raw.includeTranscript === true,
        ...(raw.pendingRevoke === true ? { pendingRevoke: true } : {}),
    };
}

/** What the renderer may see: the link and when, never the token. */
export function publicShareInfo(rec: ShareLinkRecord): ShareLinkInfo {
    return { url: rec.url, createdAt: rec.createdAt, includeTranscript: rec.includeTranscript };
}

/** The links file is there but could not be read. Nothing is written until it can be. */
export class ShareStoreUnreadable extends Error {
    constructor(detail?: string) {
        super(detail || 'share links file could not be read');
        this.name = 'ShareStoreUnreadable';
    }
}

export class ShareLinkStore {
    private cache: Record<string, ShareLinkRecord> | null = null;

    constructor(private readonly userDataDir: string, private readonly fileDeps: AtomicFileDeps = {}) {}

    private file(): string {
        return path.join(this.userDataDir, SHARE_LINKS_FILE);
    }

    /**
     * The records. Only a file that is not there means "nothing shared". A
     * file that cannot be read (Windows antivirus holding it past the retries,
     * a permission problem) throws ShareStoreUnreadable and is tried again on
     * the next call, so the next save never overwrites tokens it could not see.
     * A file that reads but is not ours to parse is set aside under another
     * name, kept for recovery, never overwritten.
     */
    private load(): Record<string, ShareLinkRecord> {
        if (this.cache) return this.cache;
        let read;
        try {
            read = readTextFileSync(this.file(), this.fileDeps);
        } catch (err: any) {
            throw new ShareStoreUnreadable(err?.code || err?.message);
        }
        const out: Record<string, ShareLinkRecord> = {};
        if (read.state === 'read') {
            let raw: any;
            try { raw = JSON.parse(read.text); } catch { raw = undefined; }
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                try {
                    fs.renameSync(this.file(), `${this.file()}.unreadable-${Date.now()}`);
                } catch (err: any) {
                    throw new ShareStoreUnreadable(err?.code || 'damaged file could not be set aside');
                }
                console.warn('[ShareLinks] links file was damaged; set aside and starting a new one');
            } else {
                // Every record, however many: each holds the only token that can turn its link off.
                for (const [meetingId, rec] of Object.entries(raw)) {
                    const clean = sanitizeRecord(rec);
                    if (clean && meetingId) out[meetingId] = clean;
                }
            }
        }
        this.cache = out;
        return out;
    }

    private save(): void {
        writeFileAtomicSync(this.file(), JSON.stringify(this.load()), { mode: 0o600, ...this.fileDeps });
    }

    private trySave(): boolean {
        try {
            this.save();
            return true;
        } catch {
            return false;
        }
    }

    /** Throws ShareStoreUnreadable when the file cannot be read. */
    get(meetingId: string): ShareLinkRecord | null {
        return this.load()[meetingId] || null;
    }

    /** Throws ShareStoreUnreadable when the file cannot be read. */
    entries(): Array<[string, ShareLinkRecord]> {
        return Object.entries(this.load());
    }

    /** Saves the record. Throws when it cannot (unreadable file: not kept at all; failed write: kept in memory only). */
    set(meetingId: string, rec: ShareLinkRecord): void {
        this.load()[meetingId] = rec;
        this.save();
    }

    /** Marks a link as due to be turned off. False when the file was not written (kept in memory this session). */
    markPending(meetingId: string): boolean {
        const rec = this.load()[meetingId];
        if (!rec) return true;
        rec.pendingRevoke = true;
        return this.trySave();
    }

    /** Undoes markPending: the delete it was for did not happen. */
    unmarkPending(meetingId: string): boolean {
        const rec = this.load()[meetingId];
        if (!rec?.pendingRevoke) return true;
        delete rec.pendingRevoke;
        return this.trySave();
    }

    /** Forgets a link. Gone from memory at once; false when the file could not be written. */
    remove(meetingId: string): boolean {
        const data = this.load();
        if (!(meetingId in data)) return true;
        delete data[meetingId];
        return this.trySave();
    }
}

// ── The two calls ────────────────────────────────────────────────────────

export interface ShareApiOptions {
    apiBase: string;
    installId?: string;
    /**
     * Who is asking. Since 2026-10-17 the server makes a link only for a caller
     * it can verify: a Natively API key or a trial token (the same headers the
     * chat calls send). Without one the server answers 401 and no link is made.
     */
    apiKey?: string;
    trialToken?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
}

/** The headers that tell the server who is asking: install id, then key or trial token. */
export function callerHeaders(opts: Pick<ShareApiOptions, 'installId' | 'apiKey' | 'trialToken'>): Record<string, string> {
    const h: Record<string, string> = {};
    if (opts.installId) h['x-install-id'] = opts.installId;
    if (opts.apiKey) h['x-natively-key'] = opts.apiKey;
    else if (opts.trialToken) h['x-trial-token'] = opts.trialToken;
    return h;
}

export type ShareCreateResult = OutputResult & { id?: string; url?: string; revokeToken?: string };

const SHARE_SERVICE = 'Natively';

/** The plain sentence for a failure. Never a status or a code. */
export function describeShareError(kind: ConnectionErrorKind | undefined, action: 'create' | 'revoke', ctx: { transcript?: boolean } = {}): string {
    switch (kind) {
        case 'too_large': return ctx.transcript
            ? 'These notes and the transcript are too long to share as a link. Share them as a file instead.'
            : 'These notes are too long to share as a link. Share them as a file instead.';
        case 'rate_limited': return 'Too many links were made just now. Wait a while and try again.';
        case 'auth': return 'Sharing a link needs an active Natively plan or trial. Check Settings, AI Providers, then try again.';
        case 'network': return 'Natively could not reach its server. Check your internet connection and try again.';
        case 'timeout': return 'The server took too long to answer. Check your connection and try again.';
        case 'server': return action === 'create'
            ? 'The link could not be made right now. Try again in a few minutes.'
            : 'The link could not be turned off right now. Try again in a few minutes.';
        case 'invalid_input': return 'The server did not accept these notes. Try again after the notes have finished.';
        case 'forbidden': return 'The server did not recognise this link as yours, so it stays on. Try again later.';
        default: return action === 'create'
            ? `Something went wrong talking to ${SHARE_SERVICE}. Try again.`
            : 'The link could not be turned off. Try again.';
    }
}

function failed(err: unknown, action: 'create' | 'revoke', ctx: { transcript?: boolean } = {}): OutputResult & { kind: ConnectionErrorKind } {
    const kind: ConnectionErrorKind = err instanceof ConnectionError ? err.kind : 'unknown';
    return { ok: false, kind, message: describeShareError(kind, action, ctx) };
}

export async function createShareLink(payload: SharePayload, opts: ShareApiOptions): Promise<ShareCreateResult> {
    const ctx = { transcript: !!payload.transcript?.length };
    if (payloadBytes(payload) > SHARE_MAX_BYTES) return { ok: false, kind: 'too_large', message: describeShareError('too_large', 'create', ctx) };
    try {
        const res = await httpRequest(`${opts.apiBase}/v1/share`, {
            method: 'POST',
            json: { notes: payload },
            headers: callerHeaders(opts),
            timeoutMs: opts.timeoutMs ?? 20_000,
            fetchImpl: opts.fetchImpl,
        });
        const d = res.data;
        if (!d?.ok || typeof d.id !== 'string' || typeof d.url !== 'string' || typeof d.revokeToken !== 'string') {
            return { ok: false, kind: 'server', message: describeShareError('server', 'create') };
        }
        return { ok: true, id: d.id, url: d.url, revokeToken: d.revokeToken };
    } catch (err) {
        return failed(err, 'create', ctx);
    }
}

/**
 * Turns a link off. A link the server no longer knows counts as off, so the
 * app's record can go either way.
 */
export async function revokeShareLink(id: string, revokeToken: string, opts: ShareApiOptions): Promise<OutputResult> {
    try {
        await httpRequest(`${opts.apiBase}/v1/share/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'x-share-revoke': revokeToken },
            timeoutMs: opts.timeoutMs ?? 15_000,
            fetchImpl: opts.fetchImpl,
        });
        return { ok: true };
    } catch (err) {
        if (err instanceof ConnectionError && err.kind === 'not_found') return { ok: true };
        return failed(err, 'revoke');
    }
}

// ── The whole flow ───────────────────────────────────────────────────────

export type ShareLinkResult = OutputResult & { link?: ShareLinkInfo };

export const STORE_UNREADABLE = 'Natively could not read its list of shared links on this computer. Try again in a moment.';
const SAVE_FAILED_OFF = 'The link was made but could not be saved on this computer, so it was turned off again. Try again.';
const SAVE_FAILED_PENDING = 'The link was made but could not be saved on this computer, and it could not be turned off yet. Natively keeps trying while it is open.';
const STILL_TURNING_OFF = 'The last link for this meeting is still being turned off. Check your internet connection and try again in a minute.';
const DELETED_WHILE_CREATING = 'This meeting was deleted while its link was being made, so the link is being turned off.';

const unreadable = (): ShareLinkResult => ({ ok: false, kind: 'storage_unavailable', message: STORE_UNREADABLE });

/**
 * Create, show and stop sharing. The IPC layer adds only the clipboard and
 * the meeting lookup; meeting deletes reach beginForget through
 * meetingDeleteObservers.
 */
export class ShareLinks {
    private retrying: Promise<number> | null = null;
    private rerun: Promise<number> | null = null;
    /** One create per meeting at a time; a second press gets the first one's answer. */
    private readonly inFlight = new Map<string, Promise<ShareLinkResult>>();
    /** Meetings deleted while their link was being created: that link goes off as soon as it exists. */
    private readonly deletedDuringCreate = new Set<string>();
    /** Links whose token could not be put in the store at all: turned off from memory, this session. */
    private readonly orphans: ShareLinkRecord[] = [];
    /** Deletes that happened while the store could not be read: applied once it can be. */
    private readonly owedIds = new Set<string>();
    private owedAll = false;

    constructor(
        private readonly store: ShareLinkStore,
        private readonly api: () => ShareApiOptions,
        private readonly now: () => number = Date.now,
    ) {}

    /** The meeting's live link, or null. A link being turned off is not offered. Throws ShareStoreUnreadable. */
    info(meetingId: string): ShareLinkInfo | null {
        this.applyOwed();
        const rec = this.store.get(meetingId);
        return rec && !rec.pendingRevoke ? publicShareInfo(rec) : null;
    }

    /** The link that exists, or a new one. The caller has checked the meeting has notes. */
    create(meetingId: string, payload: SharePayload, includeTranscript: boolean): Promise<ShareLinkResult> {
        const running = this.inFlight.get(meetingId);
        if (running) return running;
        const p = this.createOnce(meetingId, payload, includeTranscript).finally(() => {
            this.inFlight.delete(meetingId);
            this.deletedDuringCreate.delete(meetingId);
        });
        this.inFlight.set(meetingId, p);
        return p;
    }

    private async createOnce(meetingId: string, payload: SharePayload, includeTranscript: boolean): Promise<ShareLinkResult> {
        let existing: ShareLinkRecord | null;
        try {
            this.applyOwed();
            existing = this.store.get(meetingId);
        } catch {
            return unreadable();
        }
        if (existing && !existing.pendingRevoke) return { ok: true, link: publicShareInfo(existing) };
        if (existing) {
            // An earlier link still owed a turn-off: finish that first, so a
            // meeting never has two public links.
            const off = await revokeShareLink(existing.id, existing.revokeToken, this.api());
            if (!off.ok) return { ok: false, kind: off.kind, message: STILL_TURNING_OFF };
            this.forget(meetingId, existing);
        }

        const res = await createShareLink(payload, this.api());
        if (!res.ok || !res.id || !res.url || !res.revokeToken) return { ok: false, kind: res.kind, message: res.message };
        const rec: ShareLinkRecord = { id: res.id, url: res.url, revokeToken: res.revokeToken, createdAt: this.now(), includeTranscript };

        if (this.deletedDuringCreate.has(meetingId)) {
            this.keepForTurnOff(meetingId, rec);
            void this.retryPending().catch(() => {});
            return { ok: false, kind: 'not_found', message: DELETED_WHILE_CREATING };
        }
        try {
            this.store.set(meetingId, rec);
        } catch {
            // The link exists but could not be remembered on disk, so after a
            // restart it could never be turned off from here. Turn it off now,
            // and say so only once the server has confirmed it.
            const off = await revokeShareLink(rec.id, rec.revokeToken, this.api());
            if (off.ok) {
                this.forget(meetingId, rec);
                return { ok: false, kind: 'storage_unavailable', message: SAVE_FAILED_OFF };
            }
            this.keepForTurnOff(meetingId, rec);
            return { ok: false, kind: 'storage_unavailable', message: SAVE_FAILED_PENDING };
        }
        return { ok: true, link: publicShareInfo(rec) };
    }

    /** Stop sharing, from the dialog. On failure the link stays on and the dialog keeps offering Stop sharing. */
    async revoke(meetingId: string): Promise<OutputResult> {
        let rec: ShareLinkRecord | null;
        try {
            rec = this.store.get(meetingId);
        } catch {
            return unreadable();
        }
        if (!rec) return { ok: true };
        const res = await revokeShareLink(rec.id, rec.revokeToken, this.api());
        if (res.ok) {
            this.forget(meetingId, rec);
            return { ok: true };
        }
        return res;
    }

    /**
     * A meetingDeleteObservers observer. Before the delete, every link of the
     * meetings going away is marked pending on disk (so a crash right after the
     * delete cannot lose it) and any create in flight for them is told. Commit
     * (rows deleted) starts the turn-offs in the background; abort (the delete
     * failed or found nothing) puts things back, so a meeting that is still
     * there keeps its link.
     */
    beginForget(target: MeetingDeleteTarget): MeetingDeleteHandle {
        const ids = target === 'all' ? null : new Set(target.ids);
        const marked: string[] = [];
        const told: string[] = [];
        let owed = false;
        for (const meetingId of this.inFlight.keys()) {
            if ((!ids || ids.has(meetingId)) && !this.deletedDuringCreate.has(meetingId)) {
                this.deletedDuringCreate.add(meetingId);
                told.push(meetingId);
            }
        }
        try {
            const entries = ids
                ? [...ids].map((id) => [id, this.store.get(id)] as const).filter((e): e is readonly [string, ShareLinkRecord] => !!e[1])
                : this.store.entries();
            for (const [meetingId, rec] of entries) {
                if (rec.pendingRevoke) continue;
                this.store.markPending(meetingId);
                marked.push(meetingId);
            }
        } catch {
            owed = true; // the store cannot be read: remember the delete, apply it when it can
        }
        let settled = false;
        return {
            commit: () => {
                if (settled) return;
                settled = true;
                if (owed) {
                    if (ids) for (const id of ids) this.owedIds.add(id);
                    else this.owedAll = true;
                }
                if (marked.length || owed) void this.retryPending().catch(() => {});
            },
            abort: () => {
                if (settled) return;
                settled = true;
                for (const meetingId of told) this.deletedDuringCreate.delete(meetingId);
                for (const meetingId of marked) {
                    try { this.store.unmarkPending(meetingId); } catch { /* unreadable now: it stays pending, the safe side */ }
                }
            },
        };
    }

    /**
     * Tries every pending turn-off once and answers how many are still owed.
     * One run at a time; a call during a run queues one more run after it, so
     * a link marked pending mid-run is not left for the next timer.
     */
    retryPending(): Promise<number> {
        if (this.retrying) {
            if (!this.rerun) {
                this.rerun = this.retrying.then(() => {
                    this.rerun = null;
                    return this.retryPending();
                });
            }
            return this.rerun;
        }
        this.retrying = (async () => {
            try {
                try { this.applyOwed(); } catch { /* still unreadable: stays owed */ }
                const pending = this.pendingEntries();
                const orphans = this.orphans.slice();
                await Promise.all([
                    ...pending.map(async ([meetingId, rec]) => {
                        const res = await revokeShareLink(rec.id, rec.revokeToken, this.api());
                        if (res.ok) this.forget(meetingId, rec);
                    }),
                    ...orphans.map(async (rec) => {
                        const res = await revokeShareLink(rec.id, rec.revokeToken, this.api());
                        if (res.ok) this.orphans.splice(this.orphans.indexOf(rec), 1);
                    }),
                ]);
                return this.pendingEntries().length + this.orphans.length + this.owedIds.size + (this.owedAll ? 1 : 0);
            } finally {
                this.retrying = null;
            }
        })();
        return this.retrying;
    }

    private pendingEntries(): Array<[string, ShareLinkRecord]> {
        try {
            return this.store.entries().filter(([, rec]) => rec.pendingRevoke);
        } catch {
            return [];
        }
    }

    /** Deletes recorded while the store could not be read, applied now that it can. Throws while it still cannot. */
    private applyOwed(): void {
        if (!this.owedAll && !this.owedIds.size) return;
        for (const [meetingId, rec] of this.store.entries()) {
            if ((this.owedAll || this.owedIds.has(meetingId)) && !rec.pendingRevoke) this.store.markPending(meetingId);
        }
        this.owedAll = false;
        this.owedIds.clear();
    }

    /** Drops a record that is off, if it is still the one that was turned off. */
    private forget(meetingId: string, rec: ShareLinkRecord): void {
        try {
            if (this.store.get(meetingId) === rec) this.store.remove(meetingId);
        } catch { /* unreadable: a later retry of a link already off is answered as done */ }
    }

    /** Keeps a link that must go off: in the store when it can be written, in memory when the store has no room for it. */
    private keepForTurnOff(meetingId: string, rec: ShareLinkRecord): void {
        const pending: ShareLinkRecord = { ...rec, pendingRevoke: true };
        try {
            this.store.set(meetingId, pending);
            return;
        } catch { /* see below */ }
        try {
            if (this.store.get(meetingId) === pending) return; // in memory; the file write failed
        } catch { /* unreadable */ }
        this.orphans.push(pending);
    }
}
