// Personal API keys for the local API (Settings › Connectors › API keys), the
// local-first version of Granola's API keys. Notes stay on this computer, so a
// key opens the small read-only server in localApi.ts on 127.0.0.1 and nothing
// else.
//
// Storage: one file in userData (api_keys.enc), encrypted with Electron's
// safeStorage (Keychain on macOS, DPAPI on Windows) and written whole or not at
// all (atomicFile, which also rides out a Windows antivirus or indexer lock).
// It holds only the SHA-256 of each key and its metadata, plus the port the
// server keeps. The key itself is returned once, by create(), and never again:
// not to the UI, not to a log, not to the file.
//
// Without OS encryption (a Linux box with no keyring) no key is made at all,
// rather than one that silently disappears at the next start.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ApiKeyInfo } from '../../../src/types/connectors';
import { API_KEY_EXPIRY_DAYS } from '../../../src/types/connectors';
import type { OutputResult } from '../../../src/types/meetingOutputs';
import { readTextFileSync, writeFileAtomicSync, type AtomicFileDeps } from './atomicFile';
import type { SafeStorageLike } from './connectionsStore';

export const API_KEYS_FILE = 'api_keys.enc';
export const API_KEY_PREFIX = 'nat_';
/** Keys that are not revoked (active or expired) count toward this. */
export const MAX_API_KEYS = 25;
export const API_KEY_DESCRIPTION_MAX = 80;
/** lastUsedAt is saved at most this often per key, so a busy script does not rewrite the file on every request. */
export const LAST_USED_WRITE_MS = 60_000;
/** Revoked keys stay listed; past this many records the oldest revoked ones are dropped so the file stays small. */
export const MAX_STORED_KEY_RECORDS = 100;
const DAY_MS = 24 * 3600 * 1000;
/** nat_ + base64url of 32 bytes is exactly 47 characters. */
const KEY_SHAPE = /^nat_[A-Za-z0-9_-]{43}$/;

interface StoredKey {
    id: string;
    description: string;
    /** Hex SHA-256 of the full key, prefix included. */
    hash: string;
    createdAt: number;
    expiresAt: number | null;
    lastUsedAt: number | null;
    revokedAt: number | null;
}

interface ApiKeysData {
    keys: StoredKey[];
    /** The local API's port, chosen once and kept so scripts keep working. */
    port?: number;
}

export interface ApiKeyStoreDeps extends Pick<AtomicFileDeps, 'sleepSync'> {
    userDataDir: string;
    safeStorage: SafeStorageLike;
    now?: () => number;
}

export type CreateApiKeyResult =
    | { ok: true; key: string; info: ApiKeyInfo }
    | (OutputResult & { ok: false });

/** The file could be there but could not be read now (a lock that outlasted the retries, a permission problem). */
export class ApiKeyStoreUnreadable extends Error {}

const STORAGE_MESSAGE = 'Your API keys could not be read just now. Try again in a moment.';

export function newApiKey(): string {
    return API_KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function hashApiKey(key: string): string {
    return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

/** One line, no control characters, trimmed. Length is checked by the caller. */
export function cleanDescription(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isExpiryChoice(v: unknown): v is number | null {
    return v === null || (typeof v === 'number' && (API_KEY_EXPIRY_DAYS as readonly number[]).includes(v));
}

function statusOf(k: StoredKey, now: number): ApiKeyInfo['status'] {
    if (k.revokedAt !== null) return 'revoked';
    if (k.expiresAt !== null && now >= k.expiresAt) return 'expired';
    return 'active';
}

function toInfo(k: StoredKey, now: number): ApiKeyInfo {
    return {
        id: k.id,
        description: k.description,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
        lastUsedAt: k.lastUsedAt,
        status: statusOf(k, now),
    };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function sanitize(raw: any): ApiKeysData {
    const keys: StoredKey[] = [];
    const seen = new Set<string>();
    for (const k of Array.isArray(raw?.keys) ? raw.keys : []) {
        if (!k || typeof k.id !== 'string' || !k.id || seen.has(k.id)) continue;
        if (typeof k.hash !== 'string' || !/^[0-9a-f]{64}$/.test(k.hash)) continue;
        const createdAt = num(k.createdAt);
        if (createdAt === null) continue;
        seen.add(k.id);
        keys.push({
            id: k.id.slice(0, 100),
            description: cleanDescription(k.description).slice(0, API_KEY_DESCRIPTION_MAX),
            hash: k.hash,
            createdAt,
            expiresAt: num(k.expiresAt),
            lastUsedAt: num(k.lastUsedAt),
            revokedAt: num(k.revokedAt),
        });
    }
    const port = Number(raw?.port);
    return { keys, ...(Number.isInteger(port) && port >= 1024 && port <= 65535 ? { port } : {}) };
}

export class ApiKeyStore {
    private cache: ApiKeysData | null = null;

    constructor(private readonly deps: ApiKeyStoreDeps) {}

    private get file(): string {
        return path.join(this.deps.userDataDir, API_KEYS_FILE);
    }

    private now(): number {
        return (this.deps.now ?? Date.now)();
    }

    /** True when keys survive a restart (OS encryption is available). */
    isPersistent(): boolean {
        try { return this.deps.safeStorage.isEncryptionAvailable(); } catch { return false; }
    }

    /**
     * The saved keys. A file that cannot be decrypted (a different keychain key,
     * a damaged file) reads as no keys: those keys could never be checked again,
     * and the next save replaces it. A file that cannot be read right now throws
     * ApiKeyStoreUnreadable and is not cached, so a save never overwrites keys it
     * could not see.
     */
    private read(): ApiKeysData {
        if (this.cache) return this.cache;
        if (!this.isPersistent()) {
            this.cache = { keys: [] };
            return this.cache;
        }
        let read;
        try {
            // Binary file: read as base64 text so atomicFile's lock retries apply.
            read = readTextFileSync(this.file, { readText: (f) => fs.readFileSync(f).toString('base64'), sleepSync: this.deps.sleepSync });
        } catch {
            throw new ApiKeyStoreUnreadable('api keys file unreadable');
        }
        let loaded: ApiKeysData = { keys: [] };
        if (read.state === 'read') {
            try {
                loaded = sanitize(JSON.parse(this.deps.safeStorage.decryptString(Buffer.from(read.text, 'base64'))));
            } catch {
                console.warn('[ApiKeys] Saved API keys could not be decrypted; starting with none.');
            }
        }
        this.cache = loaded;
        return loaded;
    }

    /** Applies a change and saves it. False when it could not be saved (the change is then not kept). */
    private update(change: (d: ApiKeysData) => void): boolean {
        const next = sanitize(JSON.parse(JSON.stringify(this.read())));
        change(next);
        const clean = sanitize(next);
        if (!this.isPersistent()) return false;
        try {
            writeFileAtomicSync(this.file, this.deps.safeStorage.encryptString(JSON.stringify(clean)), { mode: 0o600, sleepSync: this.deps.sleepSync });
        } catch {
            console.warn('[ApiKeys] Could not save API keys.');
            return false;
        }
        this.cache = clean;
        return true;
    }

    /** Newest first; revoked keys stay listed. Empty when the file cannot be read right now. */
    list(): ApiKeyInfo[] {
        let data: ApiKeysData;
        try { data = this.read(); } catch { return []; }
        const now = this.now();
        return [...data.keys].sort((a, b) => b.createdAt - a.createdAt).map((k) => toInfo(k, now));
    }

    hasActiveKeys(): boolean {
        try {
            const now = this.now();
            return this.read().keys.some((k) => statusOf(k, now) === 'active');
        } catch {
            return false;
        }
    }

    /** When the soonest active key runs out (epoch ms), or null when none will. */
    nextExpiry(): number | null {
        try {
            const now = this.now();
            const times = this.read().keys.filter((k) => statusOf(k, now) === 'active' && k.expiresAt !== null).map((k) => k.expiresAt as number);
            return times.length ? Math.min(...times) : null;
        } catch {
            return null;
        }
    }

    create(input: { description: unknown; expiresInDays: unknown }): CreateApiKeyResult {
        const description = cleanDescription(input?.description);
        if (!description) return { ok: false, kind: 'invalid_input', message: 'Describe what the key is for, so you can tell your keys apart later.' };
        if (description.length > API_KEY_DESCRIPTION_MAX) return { ok: false, kind: 'invalid_input', message: `Keep the description to ${API_KEY_DESCRIPTION_MAX} characters or fewer.` };
        if (!isExpiryChoice(input?.expiresInDays)) return { ok: false, kind: 'invalid_input', message: 'Pick when the key should expire.' };
        if (!this.isPersistent()) {
            return { ok: false, kind: 'storage_unavailable', message: 'This computer has no secure storage for keys, so a key cannot be made here.' };
        }
        let data: ApiKeysData;
        try { data = this.read(); } catch { return { ok: false, kind: 'storage_unavailable', message: STORAGE_MESSAGE }; }
        if (data.keys.filter((k) => k.revokedAt === null).length >= MAX_API_KEYS) {
            return { ok: false, kind: 'invalid_input', message: `You can have up to ${MAX_API_KEYS} keys. Revoke one you no longer use to make another.` };
        }
        const now = this.now();
        const key = newApiKey();
        const record: StoredKey = {
            id: crypto.randomUUID(),
            description,
            hash: hashApiKey(key),
            createdAt: now,
            expiresAt: input.expiresInDays === null ? null : now + (input.expiresInDays as number) * DAY_MS,
            lastUsedAt: null,
            revokedAt: null,
        };
        const saved = this.update((d) => {
            d.keys.push(record);
            // Keep the file small: drop the oldest revoked records past the limit.
            const extra = d.keys.length - MAX_STORED_KEY_RECORDS;
            if (extra > 0) {
                const drop = new Set(d.keys.filter((k) => k.revokedAt !== null).sort((a, b) => a.createdAt - b.createdAt).slice(0, extra).map((k) => k.id));
                d.keys = d.keys.filter((k) => !drop.has(k.id));
            }
        });
        if (!saved) return { ok: false, kind: 'storage_unavailable', message: 'The key could not be saved. Try again in a moment.' };
        return { ok: true, key, info: toInfo(record, now) };
    }

    /** Revoking a revoked key is fine. Returns not_found for an id that is not there. */
    revoke(id: unknown): OutputResult {
        if (typeof id !== 'string' || !id || id.length > 100) return { ok: false, kind: 'invalid_input', message: 'This key could not be found.' };
        let data: ApiKeysData;
        try { data = this.read(); } catch { return { ok: false, kind: 'storage_unavailable', message: STORAGE_MESSAGE }; }
        const found = data.keys.find((k) => k.id === id);
        if (!found) return { ok: false, kind: 'not_found', message: 'This key could not be found. It may have been removed.' };
        if (found.revokedAt !== null) return { ok: true };
        const now = this.now();
        const saved = this.update((d) => {
            const k = d.keys.find((x) => x.id === id);
            if (k) k.revokedAt = now;
        });
        return saved ? { ok: true } : { ok: false, kind: 'storage_unavailable', message: 'The key could not be revoked. Try again in a moment.' };
    }

    /**
     * True for an active key. Every stored hash is compared in constant time and
     * none is skipped, so timing tells nothing about which key nearly matched.
     * Saves lastUsedAt at most once a minute per key.
     */
    verify(rawKey: unknown): boolean {
        if (typeof rawKey !== 'string' || rawKey.length > 200) return false;
        let data: ApiKeysData;
        try { data = this.read(); } catch { return false; }
        const presented = crypto.createHash('sha256').update(rawKey, 'utf8').digest();
        const shaped = KEY_SHAPE.test(rawKey);
        let match: StoredKey | null = null;
        for (const k of data.keys) {
            const stored = Buffer.from(k.hash, 'hex');
            if (crypto.timingSafeEqual(presented, stored) && !match) match = k;
        }
        if (!shaped || !match) return false;
        const now = this.now();
        if (statusOf(match, now) !== 'active') return false;
        if (match.lastUsedAt === null || now - match.lastUsedAt >= LAST_USED_WRITE_MS) {
            const id = match.id;
            // A failed save only loses the "last used" time.
            this.update((d) => {
                const k = d.keys.find((x) => x.id === id);
                if (k) k.lastUsedAt = now;
            });
        }
        return true;
    }

    port(): number | undefined {
        try { return this.read().port; } catch { return undefined; }
    }

    setPort(port: number): void {
        try { this.update((d) => { d.port = port; }); } catch { /* the port is chosen again next time */ }
    }
}
