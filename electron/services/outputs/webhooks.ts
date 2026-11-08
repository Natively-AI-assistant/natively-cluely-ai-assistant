// Webhooks and Zapier: when a meeting's notes are ready (or edited), the app
// POSTs them as JSON to the URLs the user added in Settings › Connectors.
//
// Local first: the notes live only on this computer, so a receiver cannot fetch
// them from us. The payload carries the note itself, and the transcript only
// when the endpoint asked for it. Deliveries go out from the app, so they only
// run while Natively is open; a failed one is tried again twice (after 30 s and
// after 2 min) and then given up, with a plain sentence on the row.
//
// Signed per the Standard Webhooks spec (standardwebhooks.com): `webhook-id`,
// `webhook-timestamp` and `webhook-signature` = "v1," + base64 HMAC-SHA256 of
// "{id}.{timestamp}.{body}" under the endpoint's `whsec_` secret.
//
// The URL and the signing secret are secrets: they live in `webhooks.enc` in
// userData, encrypted with safeStorage (Keychain on macOS, DPAPI on Windows),
// and only the host ever comes back to the renderer. Nothing about a note, a
// URL or a secret is ever logged.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { DeliveryInfo, WebhookCreateInput, WebhookEndpointInfo, WebhookEvent, WebhookPatch } from '../../../src/types/connectors';
import type { ConnectionErrorKind, OutputResult } from '../../../src/types/meetingOutputs';
import { ConnectionError, errorKindOf, httpRequest, type FetchLike } from './httpRequest';
import { notesToMarkdown, type NotesDocument } from './notesDocument';
import { loadSecretJson, saveSecretJson } from '../calendar/providers/secureFile';
import { checkAllowed } from './connectorAccess';

export const WEBHOOKS_FILE = 'webhooks.enc';
export const MAX_WEBHOOKS = 20;
export const WEBHOOK_EVENTS: readonly WebhookEvent[] = ['note.generated', 'note.edited'];
export const WEBHOOK_TIMEOUT_MS = 15_000;
/** Waits before the second and third tries. */
export const WEBHOOK_RETRY_WAITS_MS = [30_000, 120_000];
/** Typing in the notes sends one note.edited a minute after the last change. */
export const EDIT_DEBOUNCE_MS = 60_000;
export const ZAPIER_HOST = 'hooks.zapier.com';
const MAX_LABEL = 80;
const MAX_URL = 2048;
const MAX_ID = 200;

// ── Types ────────────────────────────────────────────────────────────────

export interface WebhookRecord {
    id: string;
    kind: 'webhook' | 'zapier';
    label: string;
    url: string;
    /** `whsec_` + base64 of 24 random bytes. */
    secret: string;
    events: WebhookEvent[];
    folderId: string | null;
    includeTranscript: boolean;
    enabled: boolean;
    createdAt: number;
    lastDelivery?: DeliveryInfo;
}

interface WebhooksFile {
    version: 1;
    endpoints: WebhookRecord[];
}

export interface WebhookPayload {
    type: WebhookEvent;
    /** ISO time the event was made. */
    timestamp: string;
    data: {
        meeting_id: string;
        title: string;
        date: string;
        duration?: string;
        attendees: Array<{ email: string; name?: string }>;
        summary_markdown: string;
        sections: Array<{ heading: string; paragraph?: string; bullets: string[] }>;
        action_items: Array<{ text: string; owner?: string; deadline?: string; done: boolean }>;
        transcript?: Array<{ speaker: string; text: string; offset_ms: number }>;
        /** Only on the sample sent by "Send test". */
        test?: true;
    };
}

type SafeStorage = {
    isEncryptionAvailable(): boolean;
    encryptString(plain: string): Buffer;
    decryptString(encrypted: Buffer): string;
};

export interface WebhooksDeps {
    userDataDir: string;
    safeStorage: SafeStorage;
    /** The meeting's notes, or null when it is gone. */
    loadDoc: (meetingId: string) => NotesDocument | null | Promise<NotesDocument | null>;
    foldersOfMeeting: (meetingId: string) => string[];
    fetchImpl?: FetchLike;
    now?: () => number;
    /** The wait between tries; tests resolve it at once. */
    wait?: (ms: number) => Promise<void>;
    /** For the edit debounce; tests drive it by hand. */
    timers?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };
    /**
     * Connectors are Pro or trial (connectorAccess.ts). Asked when an event is
     * dispatched and again before every try, so an edit timer or a retry wait
     * that ends after Pro or the trial does sends nothing. Absent: allowed.
     */
    allowed?: () => boolean;
}

// ── Pure pieces ──────────────────────────────────────────────────────────

export function newWebhookSecret(): string {
    return `whsec_${crypto.randomBytes(24).toString('base64')}`;
}

/** The key bytes of a `whsec_` secret. */
export function secretKey(secret: string): Buffer {
    return Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
}

export function signWebhook(secret: string, msgId: string, timestampSec: number, body: string): string {
    const mac = crypto.createHmac('sha256', secretKey(secret)).update(`${msgId}.${timestampSec}.${body}`).digest('base64');
    return `v1,${mac}`;
}

export function webhookHeaders(secret: string, msgId: string, timestampSec: number, body: string): Record<string, string> {
    return {
        'webhook-id': msgId,
        'webhook-timestamp': String(timestampSec),
        'webhook-signature': signWebhook(secret, msgId, timestampSec, body),
        'User-Agent': 'Natively-Webhooks/1',
    };
}

const newMessageId = (): string => `msg_${crypto.randomBytes(16).toString('hex')}`;
const newEndpointId = (): string => `wh_${crypto.randomBytes(8).toString('hex')}`;

function ipv4Parts(host: string): number[] | null {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m) return null;
    const parts = m.slice(1).map(Number);
    return parts.every((p) => p <= 255) ? parts : null;
}

function isPrivateIpv4([a, b]: number[]): boolean {
    return a === 0 || a === 10 || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
        || a >= 224; // multicast and reserved
}

/** True for a host this computer's own network could answer: never a webhook target. */
export function isPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    if (!host) return true;
    if (host.startsWith('[')) {
        const v6 = host.slice(1, -1);
        if (v6 === '::' || v6 === '::1') return true;
        if (/^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6)) return true; // unique-local, link-local
        const mapped = /^::ffff:(.+)$/.exec(v6);
        if (mapped) {
            const dotted = ipv4Parts(mapped[1]);
            if (dotted) return isPrivateIpv4(dotted);
            const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped[1]);
            if (hex) return isPrivateIpv4([parseInt(hex[1], 16) >> 8, parseInt(hex[1], 16) & 255]);
            return true;
        }
        // The unspecified and IPv4-compatible forms (::a.b.c.d) never name a public host.
        return v6.startsWith('::');
    }
    const v4 = ipv4Parts(host);
    if (v4) return isPrivateIpv4(v4);
    if (host === 'localhost' || !host.includes('.')) return true;
    return /\.(?:local|localhost|internal|lan|home\.arpa)$/.test(host);
}

export type UrlCheck = { ok: true; url: string; host: string } | { ok: false; message: string };

/** An https URL on a public host; for Zapier, on hooks.zapier.com. */
export function checkWebhookUrl(raw: unknown, kind: 'webhook' | 'zapier'): UrlCheck {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return { ok: false, message: 'Paste the URL to send to.' };
    if (text.length > MAX_URL) return { ok: false, message: 'That URL is too long.' };
    let parsed: URL;
    try { parsed = new URL(text); } catch { return { ok: false, message: 'That does not look like a URL.' }; }
    if (parsed.protocol !== 'https:') return { ok: false, message: 'The URL has to start with https:// so the notes are encrypted on the way.' };
    if (parsed.username || parsed.password) return { ok: false, message: 'Put any password in the receiving service, not in the URL.' };
    if (isPrivateHost(parsed.hostname)) return { ok: false, message: 'The URL has to be on the public internet, not this computer or your local network.' };
    const host = parsed.hostname.toLowerCase();
    if (kind === 'zapier' && host !== ZAPIER_HOST) {
        return { ok: false, message: 'A Zapier URL starts with https://hooks.zapier.com. Copy it from the Catch Hook step in your Zap.' };
    }
    return { ok: true, url: parsed.toString(), host };
}

function sanitiseEvents(raw: unknown): WebhookEvent[] | null {
    if (!Array.isArray(raw)) return null;
    const events = WEBHOOK_EVENTS.filter((e) => raw.includes(e));
    return events.length && raw.every((e) => (WEBHOOK_EVENTS as readonly unknown[]).includes(e)) ? events : null;
}

function sanitiseFolderId(raw: unknown): string | null | undefined {
    if (raw === null) return null;
    if (typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_ID) return raw;
    return undefined;
}

function sanitiseLabel(raw: unknown, fallback: string): string | null {
    if (raw !== undefined && typeof raw !== 'string') return null;
    const label = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
    return label || fallback;
}

export function buildWebhookPayload(event: WebhookEvent, doc: NotesDocument, opts: { includeTranscript: boolean; now: number; test?: boolean }): WebhookPayload {
    return {
        type: event,
        timestamp: new Date(opts.now).toISOString(),
        data: {
            meeting_id: doc.meetingId,
            title: doc.title,
            date: doc.dateIso,
            ...(doc.durationLabel ? { duration: doc.durationLabel } : {}),
            attendees: doc.attendees.map((a) => ({ email: a.email, ...(a.name ? { name: a.name } : {}) })),
            summary_markdown: notesToMarkdown(doc, { includeTitle: false, includeActionItems: true }),
            sections: doc.sections.map((s) => ({ heading: s.heading, ...(s.paragraph ? { paragraph: s.paragraph } : {}), bullets: [...s.bullets] })),
            action_items: doc.actionItems.map((a) => ({
                text: a.text,
                ...(a.owner ? { owner: a.owner } : {}),
                ...(a.deadline ? { deadline: a.deadline } : {}),
                done: a.done,
            })),
            ...(opts.includeTranscript ? { transcript: doc.transcript.map((l) => ({ speaker: l.speaker, text: l.text, offset_ms: l.offsetMs })) } : {}),
            ...(opts.test ? { test: true as const } : {}),
        },
    };
}

/** The made-up meeting "Send test" delivers. */
export function sampleNotesDocument(now: number): NotesDocument {
    const dateIso = new Date(now).toISOString();
    return {
        meetingId: 'test_meeting',
        title: 'Sample meeting from Natively',
        dateIso,
        dateLabel: dateIso.slice(0, 10),
        durationLabel: '30 min',
        attendees: [{ email: 'alex@example.com', name: 'Alex Example' }],
        participants: [],
        sections: [
            { heading: 'Summary', bullets: ['This is a test delivery from Natively.', 'Real notes arrive in this same shape.'] },
        ],
        actionItems: [{ text: 'Check the test arrived', owner: 'Alex Example', done: false }],
        transcript: [{ speaker: 'Alex Example', text: 'This is a sample line of transcript.', offsetMs: 0 }],
    };
}

function receiverName(endpoint: Pick<WebhookRecord, 'kind' | 'url'>): string {
    if (endpoint.kind === 'zapier') return 'Zapier';
    try { return new URL(endpoint.url).hostname; } catch { return 'The receiver'; }
}

/** The plain sentence for a failed delivery. Never a status or a code. */
export function describeDeliveryFailure(kind: ConnectionErrorKind, name: string, opts: { includeTranscript?: boolean } = {}): string {
    switch (kind) {
        case 'timeout': return `${name} took too long to answer.`;
        case 'network': return `Could not reach ${name}. Check your internet connection.`;
        case 'server': return `${name} is having trouble right now.`;
        case 'rate_limited': return `${name} asked Natively to slow down.`;
        case 'not_found': return `${name} says this address does not exist any more. Check the URL, or add a new one.`;
        case 'auth':
        case 'forbidden': return `${name} refused the delivery. Check that it accepts requests from Natively.`;
        case 'too_large': return opts.includeTranscript
            ? `These notes are too large to send to ${name}. Turn off the transcript for this webhook.`
            : `These notes are too large to send to ${name}.`;
        case 'invalid_input': return `${name} did not accept the delivery.`;
        default: return `Something went wrong sending to ${name}.`;
    }
}

/** Causes a wait could fix; a receiver that refused the request will refuse it again. */
const RETRYABLE = new Set<ConnectionErrorKind>(['timeout', 'network', 'server', 'rate_limited', 'unknown']);

/** Recognises ConnectionError by name too: in the test build each file is its own bundle. */
function kindOf(err: unknown): ConnectionErrorKind {
    const e = err as { name?: unknown; kind?: unknown } | null;
    return e && e.name === 'ConnectionError' && typeof e.kind === 'string' ? e.kind as ConnectionErrorKind : errorKindOf(err);
}

export function toEndpointInfo(r: WebhookRecord): WebhookEndpointInfo {
    let urlHost = '';
    try { urlHost = new URL(r.url).hostname; } catch { /* stays empty */ }
    return {
        id: r.id,
        kind: r.kind,
        label: r.label,
        urlHost,
        events: [...r.events],
        folderId: r.folderId,
        includeTranscript: r.includeTranscript,
        enabled: r.enabled,
        createdAt: r.createdAt,
        ...(r.lastDelivery ? { lastDelivery: { ...r.lastDelivery } } : {}),
    };
}

function validRecord(r: any): r is WebhookRecord {
    return !!r && typeof r.id === 'string' && (r.kind === 'webhook' || r.kind === 'zapier')
        && typeof r.url === 'string' && typeof r.secret === 'string' && Array.isArray(r.events);
}

const UNREADABLE: OutputResult = {
    ok: false,
    kind: 'storage_unavailable',
    message: 'Your saved webhooks could not be read right now, so nothing was changed. Try again, or restart Natively.',
};

// ── The store and the sender ─────────────────────────────────────────────

export class Webhooks {
    private cache: WebhookRecord[] | null = null;
    /** True when nothing reached disk this session (no OS encryption). */
    private sessionOnly = false;
    private readonly editTimers = new Map<string, unknown>();
    private readonly now: () => number;
    private readonly wait: (ms: number) => Promise<void>;
    private readonly timers: NonNullable<WebhooksDeps['timers']>;

    constructor(private readonly deps: WebhooksDeps) {
        this.now = deps.now ?? Date.now;
        this.timers = deps.timers ?? {
            setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
            clearTimeout: (t) => clearTimeout(t as NodeJS.Timeout),
        };
        this.wait = deps.wait ?? ((ms) => new Promise<void>((resolve) => { this.timers.setTimeout(resolve, ms); }));
    }

    // Storage

    /** The endpoints, or null when the file is there but cannot be read (never mistaken for "none"). */
    private load(): WebhookRecord[] | null {
        if (this.cache) return this.cache;
        const file = path.join(this.deps.userDataDir, WEBHOOKS_FILE);
        if (!fs.existsSync(file)) { this.cache = []; return this.cache; }
        const data = loadSecretJson<WebhooksFile>(this.deps, WEBHOOKS_FILE);
        if (!data || !Array.isArray(data.endpoints)) return null;
        this.cache = data.endpoints.filter(validRecord).slice(0, MAX_WEBHOOKS);
        return this.cache;
    }

    private save(list: WebhookRecord[]): void {
        this.cache = list;
        try {
            this.sessionOnly = !saveSecretJson(this.deps, WEBHOOKS_FILE, { version: 1, endpoints: list } satisfies WebhooksFile);
        } catch (err: any) {
            // Kept in memory; the next change tries the disk again.
            console.warn('[Webhooks] Could not save webhooks:', err?.code || 'write failed');
        }
    }

    private mutate<T>(fn: (list: WebhookRecord[]) => T): T | null {
        const list = this.load();
        if (!list) return null;
        const next = list.map((r) => ({ ...r }));
        const out = fn(next);
        this.save(next);
        return out;
    }

    list(): WebhookEndpointInfo[] {
        return (this.load() || []).map(toEndpointInfo);
    }

    create(input: unknown): OutputResult & { endpoint?: WebhookEndpointInfo; secret?: string } {
        const i = (input && typeof input === 'object' ? input : {}) as Partial<WebhookCreateInput>;
        const kind = i.kind === 'zapier' ? 'zapier' : i.kind === 'webhook' ? 'webhook' : null;
        if (!kind) return { ok: false, kind: 'invalid_input', message: 'Choose a webhook or Zapier.' };
        const url = checkWebhookUrl(i.url, kind);
        if (!url.ok) return { ok: false, kind: 'invalid_input', message: url.message };
        const events = sanitiseEvents(i.events);
        if (!events) return { ok: false, kind: 'invalid_input', message: 'Choose at least one thing to send.' };
        const folderId = sanitiseFolderId(i.folderId ?? null);
        if (folderId === undefined) return { ok: false, kind: 'invalid_input', message: 'That folder could not be found.' };
        const label = sanitiseLabel(i.label, kind === 'zapier' ? 'Zapier' : url.host);
        if (label === null) return { ok: false, kind: 'invalid_input', message: 'Give the webhook a name.' };
        const list = this.load();
        if (!list) return UNREADABLE;
        if (list.length >= MAX_WEBHOOKS) return { ok: false, kind: 'invalid_input', message: `You can add up to ${MAX_WEBHOOKS} webhooks. Remove one to add another.` };
        if (list.some((r) => r.url === url.url)) return { ok: false, kind: 'invalid_input', message: 'That URL is already added.' };

        const record: WebhookRecord = {
            id: newEndpointId(),
            kind,
            label,
            url: url.url,
            secret: newWebhookSecret(),
            events,
            folderId,
            includeTranscript: i.includeTranscript === true,
            enabled: true,
            createdAt: this.now(),
        };
        this.mutate((l) => { l.push(record); });
        return {
            ok: true,
            endpoint: toEndpointInfo(record),
            secret: record.secret,
            ...(this.sessionOnly ? { message: 'This computer has no secure storage available, so this webhook is kept until Natively quits.' } : {}),
        };
    }

    update(id: unknown, patch: unknown): OutputResult {
        if (typeof id !== 'string') return { ok: false, kind: 'invalid_input', message: 'That webhook could not be found.' };
        const p = (patch && typeof patch === 'object' ? patch : {}) as WebhookPatch;
        const changes: Partial<WebhookRecord> = {};
        if (p.label !== undefined) {
            const label = sanitiseLabel(p.label, '');
            if (!label) return { ok: false, kind: 'invalid_input', message: 'Give the webhook a name.' };
            changes.label = label;
        }
        if (p.events !== undefined) {
            const events = sanitiseEvents(p.events);
            if (!events) return { ok: false, kind: 'invalid_input', message: 'Choose at least one thing to send.' };
            changes.events = events;
        }
        if (p.folderId !== undefined) {
            const folderId = sanitiseFolderId(p.folderId);
            if (folderId === undefined) return { ok: false, kind: 'invalid_input', message: 'That folder could not be found.' };
            changes.folderId = folderId;
        }
        if (p.includeTranscript !== undefined) {
            if (typeof p.includeTranscript !== 'boolean') return { ok: false, kind: 'invalid_input', message: 'That setting could not be changed.' };
            changes.includeTranscript = p.includeTranscript;
        }
        if (p.enabled !== undefined) {
            if (typeof p.enabled !== 'boolean') return { ok: false, kind: 'invalid_input', message: 'That setting could not be changed.' };
            changes.enabled = p.enabled;
        }
        const found = this.mutate((l) => {
            const r = l.find((x) => x.id === id);
            if (r) Object.assign(r, changes);
            return !!r;
        });
        if (found === null) return UNREADABLE;
        return found ? { ok: true } : { ok: false, kind: 'not_found', message: 'That webhook could not be found.' };
    }

    remove(id: unknown): OutputResult {
        if (typeof id !== 'string') return { ok: false, kind: 'invalid_input', message: 'That webhook could not be found.' };
        const removed = this.mutate((l) => {
            const at = l.findIndex((x) => x.id === id);
            if (at >= 0) l.splice(at, 1);
            return at >= 0;
        });
        if (removed === null) return UNREADABLE;
        // Removing one that is already gone is what the user wanted.
        return { ok: true };
    }

    rotateSecret(id: unknown): OutputResult & { secret?: string } {
        if (typeof id !== 'string') return { ok: false, kind: 'invalid_input', message: 'That webhook could not be found.' };
        const secret = newWebhookSecret();
        const found = this.mutate((l) => {
            const r = l.find((x) => x.id === id);
            if (r) r.secret = secret;
            return !!r;
        });
        if (found === null) return UNREADABLE;
        return found ? { ok: true, secret } : { ok: false, kind: 'not_found', message: 'That webhook could not be found.' };
    }

    private record(id: string, delivery: DeliveryInfo): void {
        this.mutate((l) => {
            const r = l.find((x) => x.id === id);
            if (r) r.lastDelivery = delivery;
        });
    }

    private current(id: string): WebhookRecord | undefined {
        return (this.load() || []).find((r) => r.id === id);
    }

    // Sending

    /** One POST, signed with the endpoint's secret as it is now. Throws ConnectionError. */
    private async post(endpoint: WebhookRecord, msgId: string, body: string): Promise<void> {
        const ts = Math.floor(this.now() / 1000);
        const check = checkWebhookUrl(endpoint.url, endpoint.kind);
        if (!check.ok) throw new ConnectionError('invalid_input', 'bad url');
        // httpRequest serialises `json` itself, so the bytes signed are the bytes sent:
        // `body` is passed parsed and re-stringified identically (JSON.stringify is deterministic).
        await httpRequest(check.url, {
            method: 'POST',
            json: JSON.parse(body),
            headers: webhookHeaders(endpoint.secret, msgId, ts, body),
            timeoutMs: WEBHOOK_TIMEOUT_MS,
            maxResponseBytes: 64 * 1024,
            fetchImpl: this.deps.fetchImpl,
        });
    }

    private mayDeliver(): boolean {
        return this.deps.allowed === undefined || checkAllowed(this.deps.allowed);
    }

    /** Up to three tries; stops early when the endpoint is removed or turned off, or Pro ends, meanwhile. */
    private async deliver(endpointId: string, payload: WebhookPayload): Promise<void> {
        const msgId = newMessageId();
        const body = JSON.stringify(payload);
        const meetingTitle = payload.data.title;
        for (let attempt = 0; ; attempt++) {
            if (!this.mayDeliver()) return;
            const endpoint = this.current(endpointId);
            if (!endpoint || !endpoint.enabled) return;
            try {
                await this.post(endpoint, msgId, body);
                this.record(endpointId, { at: this.now(), status: 'success', meetingTitle });
                console.log(`[Webhooks] ${endpoint.kind}: delivered ${payload.type}`);
                return;
            } catch (err) {
                const kind = kindOf(err);
                const message = describeDeliveryFailure(kind, receiverName(endpoint), { includeTranscript: endpoint.includeTranscript });
                const last = attempt >= WEBHOOK_RETRY_WAITS_MS.length || !RETRYABLE.has(kind);
                console.warn(`[Webhooks] ${endpoint.kind}: ${payload.type} failed (${kind})${last ? ', giving up' : ', will retry'}`);
                if (last) {
                    this.record(endpointId, { at: this.now(), status: 'failed', meetingTitle, message: attempt > 0 ? `${message} Tried ${attempt + 1} times.` : message });
                    return;
                }
                this.record(endpointId, { at: this.now(), status: 'pending', meetingTitle, message: `${message} Trying again shortly.` });
                await this.wait(WEBHOOK_RETRY_WAITS_MS[attempt]);
            }
        }
    }

    private matches(r: WebhookRecord, event: WebhookEvent, folders: string[]): boolean {
        return r.enabled && r.events.includes(event) && (r.folderId === null || folders.includes(r.folderId));
    }

    /**
     * Sends `event` for one meeting to every enabled endpoint that wants it.
     * Resolves when every delivery (retries included) is done; never rejects.
     */
    async dispatchEvent(event: WebhookEvent, meetingId: string): Promise<void> {
        try {
            if (!WEBHOOK_EVENTS.includes(event) || typeof meetingId !== 'string' || !meetingId) return;
            if (event === 'note.generated') this.cancelEdit(meetingId);
            if (!this.mayDeliver()) return;
            const all = this.load() || [];
            if (!all.some((r) => r.enabled && r.events.includes(event))) return;
            let folders: string[] = [];
            if (all.some((r) => r.folderId !== null)) {
                try { folders = this.deps.foldersOfMeeting(meetingId) || []; } catch { folders = []; }
            }
            const targets = all.filter((r) => this.matches(r, event, folders));
            if (!targets.length) return;
            const doc = await this.deps.loadDoc(meetingId);
            if (!doc) return;
            const now = this.now();
            await Promise.all(targets.map((r) => this.deliver(r.id, buildWebhookPayload(event, doc, { includeTranscript: r.includeTranscript, now }))
                .catch(() => { console.warn('[Webhooks] delivery stopped unexpectedly'); })));
        } catch {
            console.warn(`[Webhooks] ${event} dispatch failed`);
        }
    }

    /** Notes were edited: one note.edited a minute after the last change. */
    noteEdited(meetingId: string): void {
        if (typeof meetingId !== 'string' || !meetingId) return;
        this.cancelEdit(meetingId);
        const handle = this.timers.setTimeout(() => {
            this.editTimers.delete(meetingId);
            void this.dispatchEvent('note.edited', meetingId);
        }, EDIT_DEBOUNCE_MS);
        this.editTimers.set(meetingId, handle);
    }

    private cancelEdit(meetingId: string): void {
        const handle = this.editTimers.get(meetingId);
        if (handle !== undefined) {
            this.timers.clearTimeout(handle);
            this.editTimers.delete(meetingId);
        }
    }

    /** "Send test": a sample note.generated, once, no retries. */
    async test(id: unknown): Promise<OutputResult> {
        if (typeof id !== 'string') return { ok: false, kind: 'invalid_input', message: 'That webhook could not be found.' };
        const list = this.load();
        if (!list) return UNREADABLE;
        const endpoint = list.find((r) => r.id === id);
        if (!endpoint) return { ok: false, kind: 'not_found', message: 'That webhook could not be found.' };
        const now = this.now();
        const payload = buildWebhookPayload('note.generated', sampleNotesDocument(now), { includeTranscript: endpoint.includeTranscript, now, test: true });
        try {
            await this.post(endpoint, newMessageId(), JSON.stringify(payload));
            return { ok: true };
        } catch (err) {
            const kind = kindOf(err);
            return { ok: false, kind, message: describeDeliveryFailure(kind, receiverName(endpoint)) };
        }
    }

    /** Clears pending edit timers (app quit). */
    dispose(): void {
        for (const handle of this.editTimers.values()) this.timers.clearTimeout(handle);
        this.editTimers.clear();
    }
}
