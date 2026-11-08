// Automatic sending (Settings › Connectors): rules that send a meeting's notes
// to Slack, Notion or a CRM by themselves once the notes are ready, for every
// meeting or only those in one folder.
//
// The rules hold no secrets (the Slack webhook is named by id, the tokens stay
// in connections.enc), so they are plain JSON in userData, written whole or
// not at all. Each rule remembers the meetings it already sent (the last 500),
// so regenerating a meeting's notes never sends it twice to the same place.
//
// The sending itself is injected (`send`): the main process wires it to the
// same Slack, Notion and CRM code the Send buttons use. Sends run one at a time
// and nothing here throws out to the caller. Logs name the service and the
// outcome only, never anything from the notes.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { AutoSendDestination, AutoSendRuleInfo, DeliveryInfo } from '../../../src/types/connectors';
import type { CrmService, OutputResult } from '../../../src/types/meetingOutputs';
import { readTextFileSync, writeFileAtomicSync, type AtomicFileDeps } from './atomicFile';
import { CRM_LABELS } from './crm';
import { checkAllowed } from './connectorAccess';

export const AUTOSEND_FILE = 'connector-rules.json';
export const MAX_AUTOSEND_RULES = 50;
/** Meetings remembered per rule as already sent. */
export const SENT_MEMORY = 500;
const MAX_ID = 200;

export interface AutoSendRuleRecord {
    id: string;
    destination: AutoSendDestination;
    folderId: string | null;
    enabled: boolean;
    createdAt: number;
    lastDelivery?: DeliveryInfo;
    /** Oldest first. */
    sentMeetingIds: string[];
}

interface RulesFile {
    version: 1;
    rules: AutoSendRuleRecord[];
}

export interface AutoSendResult {
    ok: boolean;
    /** A plain sentence for a failure or a skip. */
    message?: string;
    /** Nothing to send there (a CRM where nobody in the meeting matched). Not a failure, and not marked sent. */
    skipped?: boolean;
}

export type AutoSendSender = (destination: AutoSendDestination, meetingId: string) => Promise<AutoSendResult>;

export interface AutoSendDeps {
    userDataDir: string;
    send: AutoSendSender;
    foldersOfMeeting: (meetingId: string) => string[];
    /** The meeting's title, for the row's "Sent …" line. */
    meetingTitle?: (meetingId: string) => string | undefined | Promise<string | undefined>;
    now?: () => number;
    /** Lock-retry stand-ins for atomicFile (tests). */
    fileDeps?: AtomicFileDeps;
    /** Connectors are Pro or trial (connectorAccess.ts), asked when a queued run starts. Absent: allowed. */
    allowed?: () => boolean;
}

const CRMS: readonly CrmService[] = ['hubspot', 'attio', 'affinity', 'salesforce', 'pipedrive'];

export function destinationLabel(d: AutoSendDestination): string {
    if (d.kind === 'slack') return 'Slack';
    if (d.kind === 'notion') return 'Notion';
    return CRM_LABELS[d.service] || 'CRM';
}

/** A destination from the renderer, or null. */
export function parseDestination(raw: unknown): AutoSendDestination | null {
    const d = raw as { kind?: unknown; webhookId?: unknown; service?: unknown } | null;
    if (!d || typeof d !== 'object') return null;
    if (d.kind === 'slack') {
        return typeof d.webhookId === 'string' && d.webhookId.length > 0 && d.webhookId.length <= MAX_ID ? { kind: 'slack', webhookId: d.webhookId } : null;
    }
    if (d.kind === 'notion') return { kind: 'notion' };
    if (d.kind === 'crm') return (CRMS as readonly unknown[]).includes(d.service) ? { kind: 'crm', service: d.service as CrmService } : null;
    return null;
}

const sameDestination = (a: AutoSendDestination, b: AutoSendDestination): boolean => {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'slack' && b.kind === 'slack') return a.webhookId === b.webhookId;
    if (a.kind === 'crm' && b.kind === 'crm') return a.service === b.service;
    return true;
};

function parseFolderId(raw: unknown): string | null | undefined {
    if (raw === null) return null;
    if (typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_ID) return raw;
    return undefined;
}

function validRecord(r: any): r is AutoSendRuleRecord {
    return !!r && typeof r.id === 'string' && !!parseDestination(r.destination) && parseFolderId(r.folderId) !== undefined;
}

export function toRuleInfo(r: AutoSendRuleRecord): AutoSendRuleInfo {
    return {
        id: r.id,
        destination: { ...r.destination },
        folderId: r.folderId,
        enabled: r.enabled,
        createdAt: r.createdAt,
        ...(r.lastDelivery ? { lastDelivery: { ...r.lastDelivery } } : {}),
    };
}

const UNREADABLE: OutputResult = {
    ok: false,
    kind: 'storage_unavailable',
    message: 'Your automatic sending rules could not be read right now, so nothing was changed. Try again, or restart Natively.',
};

export class AutoSendRules {
    private cache: AutoSendRuleRecord[] | null = null;
    /** Runs one onNotesReady at a time, so two calls for one meeting cannot both send it. */
    private queue: Promise<void> = Promise.resolve();
    private readonly now: () => number;
    private readonly file: string;

    constructor(private readonly deps: AutoSendDeps) {
        this.now = deps.now ?? Date.now;
        this.file = path.join(deps.userDataDir, AUTOSEND_FILE);
    }

    // Storage

    /** The rules, or null when the file could not be read this time (never mistaken for "none"). */
    private load(): AutoSendRuleRecord[] | null {
        if (this.cache) return this.cache;
        let read;
        try {
            read = readTextFileSync(this.file, this.deps.fileDeps);
        } catch (err: any) {
            console.warn('[AutoSend] Could not read the rules:', err?.code || 'read failed');
            return null;
        }
        if (read.state === 'missing') { this.cache = []; return this.cache; }
        try {
            const data = JSON.parse(read.text) as RulesFile;
            this.cache = (Array.isArray(data?.rules) ? data.rules : []).filter(validRecord).slice(0, MAX_AUTOSEND_RULES).map((r) => ({
                ...r,
                enabled: r.enabled !== false,
                sentMeetingIds: Array.isArray(r.sentMeetingIds) ? r.sentMeetingIds.filter((m) => typeof m === 'string').slice(-SENT_MEMORY) : [],
            }));
        } catch {
            // A damaged file is kept aside, not overwritten blind, and the rules start empty.
            try { fs.renameSync(this.file, `${this.file}.bad`); } catch { /* left where it is */ }
            console.warn('[AutoSend] The rules file was damaged; set aside and started empty');
            this.cache = [];
        }
        return this.cache;
    }

    private save(list: AutoSendRuleRecord[]): void {
        this.cache = list;
        try {
            writeFileAtomicSync(this.file, JSON.stringify({ version: 1, rules: list } satisfies RulesFile), this.deps.fileDeps);
        } catch (err: any) {
            // Kept in memory; the next change tries the disk again.
            console.warn('[AutoSend] Could not save the rules:', err?.code || 'write failed');
        }
    }

    private mutate<T>(fn: (list: AutoSendRuleRecord[]) => T): T | null {
        const list = this.load();
        if (!list) return null;
        const next = list.map((r) => ({ ...r, sentMeetingIds: [...r.sentMeetingIds] }));
        const out = fn(next);
        this.save(next);
        return out;
    }

    list(): AutoSendRuleInfo[] {
        return (this.load() || []).map(toRuleInfo);
    }

    create(input: unknown): OutputResult & { rule?: AutoSendRuleInfo } {
        const i = (input && typeof input === 'object' ? input : {}) as { destination?: unknown; folderId?: unknown };
        const destination = parseDestination(i.destination);
        if (!destination) return { ok: false, kind: 'invalid_input', message: 'Choose where to send the notes.' };
        const folderId = parseFolderId(i.folderId ?? null);
        if (folderId === undefined) return { ok: false, kind: 'invalid_input', message: 'That folder could not be found.' };
        const list = this.load();
        if (!list) return UNREADABLE;
        if (list.length >= MAX_AUTOSEND_RULES) return { ok: false, kind: 'invalid_input', message: `You can have up to ${MAX_AUTOSEND_RULES} rules. Remove one to add another.` };
        if (list.some((r) => sameDestination(r.destination, destination) && r.folderId === folderId)) {
            return { ok: false, kind: 'invalid_input', message: `Notes already go to ${destinationLabel(destination)} for these meetings.` };
        }
        const record: AutoSendRuleRecord = {
            id: `rule_${crypto.randomBytes(8).toString('hex')}`,
            destination,
            folderId,
            enabled: true,
            createdAt: this.now(),
            sentMeetingIds: [],
        };
        this.mutate((l) => { l.push(record); });
        return { ok: true, rule: toRuleInfo(record) };
    }

    update(id: unknown, patch: unknown): OutputResult {
        if (typeof id !== 'string') return { ok: false, kind: 'invalid_input', message: 'That rule could not be found.' };
        const p = (patch && typeof patch === 'object' ? patch : {}) as { enabled?: unknown; folderId?: unknown };
        const changes: Partial<AutoSendRuleRecord> = {};
        if (p.enabled !== undefined) {
            if (typeof p.enabled !== 'boolean') return { ok: false, kind: 'invalid_input', message: 'That setting could not be changed.' };
            changes.enabled = p.enabled;
        }
        if (p.folderId !== undefined) {
            const folderId = parseFolderId(p.folderId);
            if (folderId === undefined) return { ok: false, kind: 'invalid_input', message: 'That folder could not be found.' };
            changes.folderId = folderId;
        }
        const found = this.mutate((l) => {
            const r = l.find((x) => x.id === id);
            if (r) Object.assign(r, changes);
            return !!r;
        });
        if (found === null) return UNREADABLE;
        return found ? { ok: true } : { ok: false, kind: 'not_found', message: 'That rule could not be found.' };
    }

    remove(id: unknown): OutputResult {
        if (typeof id !== 'string') return { ok: false, kind: 'invalid_input', message: 'That rule could not be found.' };
        const done = this.mutate((l) => {
            const at = l.findIndex((x) => x.id === id);
            if (at >= 0) l.splice(at, 1);
        });
        return done === null ? UNREADABLE : { ok: true };
    }

    // The engine

    /**
     * A meeting's notes are ready: send them through every enabled rule whose
     * folder matches and that has not sent this meeting yet. Never rejects.
     */
    onNotesReady(meetingId: string): Promise<void> {
        const run = this.queue.then(() => this.runRules(meetingId)).catch(() => { console.warn('[AutoSend] run failed'); });
        this.queue = run;
        return run;
    }

    private async runRules(meetingId: string): Promise<void> {
        if (typeof meetingId !== 'string' || !meetingId) return;
        if (this.deps.allowed !== undefined && !checkAllowed(this.deps.allowed)) return;
        const rules = (this.load() || []).filter((r) => r.enabled && !r.sentMeetingIds.includes(meetingId));
        if (!rules.length) return;
        let folders: string[] = [];
        if (rules.some((r) => r.folderId !== null)) {
            try { folders = this.deps.foldersOfMeeting(meetingId) || []; } catch { folders = []; }
        }
        const due = rules.filter((r) => r.folderId === null || folders.includes(r.folderId));
        if (!due.length) return;
        let meetingTitle: string | undefined;
        try { meetingTitle = (await this.deps.meetingTitle?.(meetingId)) || undefined; } catch { meetingTitle = undefined; }

        for (const rule of due) {
            // Re-read: the rule may have been turned off or removed while an earlier one sent.
            const current = (this.load() || []).find((r) => r.id === rule.id);
            if (!current || !current.enabled || current.sentMeetingIds.includes(meetingId)) continue;
            const service = destinationLabel(current.destination);
            let result: AutoSendResult;
            try {
                result = await this.deps.send(current.destination, meetingId);
            } catch {
                result = { ok: false };
            }
            const at = this.now();
            if (result.skipped) {
                // Nothing went out and nothing is wrong: the row keeps its last real delivery.
                console.log(`[AutoSend] ${service}: skipped`);
                continue;
            }
            if (result.ok) {
                console.log(`[AutoSend] ${service}: sent`);
                this.mutate((l) => {
                    const r = l.find((x) => x.id === rule.id);
                    if (!r) return;
                    r.sentMeetingIds = [...r.sentMeetingIds.filter((m) => m !== meetingId), meetingId].slice(-SENT_MEMORY);
                    r.lastDelivery = { at, status: 'success', ...(meetingTitle ? { meetingTitle } : {}) };
                });
            } else {
                console.warn(`[AutoSend] ${service}: failed`);
                const message = (typeof result.message === 'string' && result.message.trim()) || `Could not send the notes to ${service}.`;
                this.mutate((l) => {
                    const r = l.find((x) => x.id === rule.id);
                    if (r) r.lastDelivery = { at, status: 'failed', message, ...(meetingTitle ? { meetingTitle } : {}) };
                });
            }
        }
    }
}
