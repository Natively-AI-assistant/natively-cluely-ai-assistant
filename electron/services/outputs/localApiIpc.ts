// IPC for personal API keys (Settings › Connectors › API keys) and the local
// API they open (localApi.ts). Electron-free: main.ts passes in the storage,
// the meeting source and the launcher-only guard, so the same code runs on
// macOS and Windows and in tests.
//
// Channels:
//   connectors:apikeys-list   ()                               → { keys, server }
//   connectors:apikey-create  ({ description, expiresInDays }) → OutputResult & { key?, info? }
//   connectors:apikey-revoke  (id)                             → OutputResult
//
// The key itself crosses IPC once, in the create answer, and is never logged.

import type { ApiKeyInfo, LocalApiStatus } from '../../../src/types/connectors';
import type { OutputResult } from '../../../src/types/meetingOutputs';
import { ApiKeyStore } from './apiKeys';
import type { SafeStorageLike } from './connectionsStore';
import { LocalApiController, type LocalApiSource } from './localApi';
import { connectorsAllowed, requirePro } from './connectorAccess';

type SafeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => void;
/** registerOutputsIpc's guard: answers the launcher window only, `fallback` for any other sender. */
type Guard = <A extends any[]>(fallback: unknown, fn: (event: any, ...args: A) => unknown) => (event: any, ...args: A) => Promise<unknown>;

export interface LocalApiIpcDeps {
    safeHandle: SafeHandle;
    guard: Guard;
    userDataDir: string;
    /** Electron's safeStorage (Keychain on macOS, DPAPI on Windows). */
    safeStorage: SafeStorageLike;
    /** databaseMeetingSource() from outputsIpc.ts in the app; a fake in tests. */
    source: LocalApiSource;
    /** The user's own name, for their transcript lines. */
    selfName?: () => string | undefined;
    /** Pro or trial (connectorAccess.ts): making a key and reading through the API need it; listing and revoking never do. */
    connectorsAllowed?: () => boolean;
    /** Tests only. */
    now?: () => number;
    randomPort?: () => number;
}

export const LOCAL_API_CHANNELS = {
    list: 'connectors:apikeys-list',
    create: 'connectors:apikey-create',
    revoke: 'connectors:apikey-revoke',
} as const;

let keys: ApiKeyStore | null = null;
let controller: LocalApiController | null = null;

const FORBIDDEN: OutputResult = { ok: false, kind: 'forbidden', message: 'Not available here.' };
const LIST_FALLBACK: { keys: ApiKeyInfo[]; server: LocalApiStatus } = { keys: [], server: { running: false } };

function listing(): { keys: ApiKeyInfo[]; server: LocalApiStatus } {
    if (!keys || !controller) return LIST_FALLBACK;
    return { keys: keys.list(), server: controller.status() };
}

export function registerLocalApiIpc(deps: LocalApiIpcDeps): void {
    keys = new ApiKeyStore({ userDataDir: deps.userDataDir, safeStorage: deps.safeStorage, now: deps.now });
    const store = keys;
    const allowed = deps.connectorsAllowed ?? connectorsAllowed;
    controller = new LocalApiController({ keys: store, source: deps.source, selfName: deps.selfName, allowed, now: deps.now, randomPort: deps.randomPort });
    const ctl = controller;

    deps.safeHandle(LOCAL_API_CHANNELS.list, deps.guard(LIST_FALLBACK, async () => {
        // A key may have run out since the last look; the server follows.
        await ctl.sync();
        return listing();
    }));

    deps.safeHandle(LOCAL_API_CHANNELS.create, deps.guard(FORBIDDEN, requirePro(allowed, async (_e: unknown, input: unknown): Promise<OutputResult & { key?: string; info?: ApiKeyInfo }> => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            return { ok: false, kind: 'invalid_input', message: 'Describe the key and pick when it should expire.' };
        }
        const { description, expiresInDays } = input as { description?: unknown; expiresInDays?: unknown };
        const made = store.create({ description, expiresInDays });
        if (!made.ok) return made;
        await ctl.sync();
        return { ok: true, key: made.key, info: made.info };
    })));

    deps.safeHandle(LOCAL_API_CHANNELS.revoke, deps.guard(FORBIDDEN, async (_e, id: unknown): Promise<OutputResult> => {
        const r = store.revoke(id);
        if (r.ok) await ctl.sync();
        return r;
    }));
}

/** At launch, after registerLocalApiIpc: starts the local API when an active key exists. Never throws, never blocks launch. */
export async function startLocalApiIfKeys(): Promise<void> {
    try { await controller?.start(); } catch { /* the Settings row shows the server as off */ }
}

/** At quit, on both systems: stops listening and drops open connections. */
export async function stopLocalApi(): Promise<void> {
    try { await controller?.stop(); } catch { /* quitting anyway */ }
}

/** The server's state now, for other Connectors code. */
export function localApiStatus(): LocalApiStatus {
    return controller ? controller.status() : { running: false };
}
