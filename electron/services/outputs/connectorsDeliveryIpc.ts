// IPC for the parts of Settings › Connectors that send by themselves: webhooks
// and Zapier (webhooks.ts) and automatic sending rules (autoSend.ts), plus the
// folder list their pickers show. `connectorsDelivery` is what the main
// process calls when a meeting's notes are ready or edited.
//
// Every handler goes through the caller's `guard` (launcher window only, as in
// outputsIpc.ts) and checks its own inputs: nothing from the renderer is
// trusted to have the shape its type says.

import type { FolderOption } from '../../../src/types/connectors';
import type { OutputResult } from '../../../src/types/meetingOutputs';
import type { FetchLike } from './httpRequest';
import type { NotesDocument } from './notesDocument';
import { Webhooks, type WebhooksDeps } from './webhooks';
import { AutoSendRules, type AutoSendSender } from './autoSend';
import { checkAllowed, connectorsAllowed, requirePro } from './connectorAccess';

type SafeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => void;
type Guard = <A extends any[]>(fallback: unknown, fn: (event: any, ...args: A) => unknown) => (event: any, ...args: A) => Promise<unknown>;

export interface ConnectorsDeliveryDeps {
    safeHandle: SafeHandle;
    guard: Guard;
    userDataDir: string;
    loadDoc: (meetingId: string) => NotesDocument | null | Promise<NotesDocument | null>;
    foldersOfMeeting: (meetingId: string) => string[];
    listFolders: () => Array<{ id: string; name: string }>;
    autoSendSender: AutoSendSender;
    /**
     * Pro or trial (connectorAccess.ts). Without it nothing is sent (webhooks,
     * automatic rules) and nothing can be made or tested; listing and deleting
     * still work.
     */
    connectorsAllowed?: () => boolean;
    /** Defaults to Electron's safeStorage (Keychain on macOS, DPAPI on Windows). */
    safeStorage?: WebhooksDeps['safeStorage'];
    /** Test stand-ins. */
    fetchImpl?: FetchLike;
    now?: () => number;
    wait?: WebhooksDeps['wait'];
    timers?: WebhooksDeps['timers'];
}

export const CONNECTORS_DELIVERY_CHANNELS = [
    'connectors:list-folders',
    'connectors:webhooks-list',
    'connectors:webhook-create',
    'connectors:webhook-update',
    'connectors:webhook-delete',
    'connectors:webhook-test',
    'connectors:webhook-rotate',
    'connectors:autosend-list',
    'connectors:autosend-create',
    'connectors:autosend-update',
    'connectors:autosend-delete',
] as const;

const FORBIDDEN: OutputResult = { ok: false, kind: 'forbidden', message: 'Not available here.' };

let webhooks: Webhooks | null = null;
let rules: AutoSendRules | null = null;
let allowed: () => boolean = () => false;

const mayDeliver = (): boolean => checkAllowed(allowed);

/** The hooks the main process calls. Before registration they do nothing. */
export const connectorsDelivery = {
    /** A meeting's notes were generated (or regenerated): webhooks, then the automatic sending rules. Never rejects. */
    async notesReady(meetingId: string): Promise<void> {
        if (typeof meetingId !== 'string' || !meetingId) return;
        // Connectors are Pro: a free user's leftover webhooks and rules stay, silent.
        if (!mayDeliver()) return;
        await Promise.all([
            webhooks ? webhooks.dispatchEvent('note.generated', meetingId) : undefined,
            rules ? rules.onNotesReady(meetingId) : undefined,
        ]).catch(() => { console.warn('[ConnectorsDelivery] notesReady failed'); });
    },
    /** Someone edited the notes in Natively: one note.edited a minute after the last change. */
    notesEdited(meetingId: string): void {
        if (!mayDeliver()) return;
        try { webhooks?.noteEdited(meetingId); } catch { console.warn('[ConnectorsDelivery] notesEdited failed'); }
    },
    /** App quit: drop pending edit timers. */
    dispose(): void {
        webhooks?.dispose();
    },
};

function folderOptions(raw: unknown): FolderOption[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
        .map((f) => ({ id: f.id, name: f.name }));
}

export function registerConnectorsDeliveryIpc(deps: ConnectorsDeliveryDeps): { webhooks: Webhooks; rules: AutoSendRules } {
    const { safeHandle, guard } = deps;
    const gate = deps.connectorsAllowed ?? connectorsAllowed;
    allowed = gate;
    const proGuard: Guard = (fallback, fn) => guard(fallback, requirePro(gate, fn));
    const safeStorage = deps.safeStorage ?? (require('electron') as typeof import('electron')).safeStorage;
    webhooks = new Webhooks({
        userDataDir: deps.userDataDir,
        safeStorage,
        loadDoc: deps.loadDoc,
        foldersOfMeeting: deps.foldersOfMeeting,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
        wait: deps.wait,
        timers: deps.timers,
        allowed: gate,
    });
    rules = new AutoSendRules({
        userDataDir: deps.userDataDir,
        send: deps.autoSendSender,
        foldersOfMeeting: deps.foldersOfMeeting,
        meetingTitle: async (meetingId) => (await deps.loadDoc(meetingId))?.title,
        now: deps.now,
        allowed: gate,
    });
    const wh = webhooks;
    const rs = rules;

    safeHandle('connectors:list-folders', guard([], async () => {
        try { return folderOptions(deps.listFolders()); } catch { return []; }
    }));

    // Webhooks and Zapier
    safeHandle('connectors:webhooks-list', guard([], async () => wh.list()));
    safeHandle('connectors:webhook-create', proGuard(FORBIDDEN, async (_e, input: unknown) => wh.create(input)));
    safeHandle('connectors:webhook-update', proGuard(FORBIDDEN, async (_e, id: unknown, patch: unknown) => wh.update(id, patch)));
    safeHandle('connectors:webhook-delete', guard(FORBIDDEN, async (_e, id: unknown) => wh.remove(id)));
    safeHandle('connectors:webhook-test', proGuard(FORBIDDEN, async (_e, id: unknown) => wh.test(id)));
    safeHandle('connectors:webhook-rotate', proGuard(FORBIDDEN, async (_e, id: unknown) => wh.rotateSecret(id)));

    // Automatic sending
    safeHandle('connectors:autosend-list', guard([], async () => rs.list()));
    safeHandle('connectors:autosend-create', proGuard(FORBIDDEN, async (_e, input: unknown) => rs.create(input)));
    safeHandle('connectors:autosend-update', proGuard(FORBIDDEN, async (_e, id: unknown, patch: unknown) => rs.update(id, patch)));
    safeHandle('connectors:autosend-delete', guard(FORBIDDEN, async (_e, id: unknown) => rs.remove(id)));

    return { webhooks: wh, rules: rs };
}
