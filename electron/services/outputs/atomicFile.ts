// One way the meeting outputs write and read their small files in userData
// (connections, writing style, share links): written to a unique temp file and
// renamed over the old one, so a crash never leaves half a file.
//
// Windows: an antivirus scanner or the search indexer often holds a file for a
// moment after it was written, and a rename or read then fails with EPERM,
// EBUSY or EACCES. Those are retried briefly (about half a second in all, the
// files are tiny and this runs on the main process); anything else, or a lock
// that outlasts that, is thrown. On macOS those codes mean a real permission
// problem, which the retries only delay. A failed write never leaves its temp
// file behind.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** Waits between tries, in ms: ~550 ms in all. */
export const LOCK_RETRY_WAITS_MS = [20, 40, 80, 160, 250];

export interface AtomicFileDeps {
    /** fs.renameSync stand-in, for tests that simulate a locked file. */
    rename?: (from: string, to: string) => void;
    /** fs.readFileSync(file, 'utf8') stand-in. */
    readText?: (file: string) => string;
    /** A blocking wait, for tests. */
    sleepSync?: (ms: number) => void;
}

export function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function whileLocked<T>(op: () => T, sleep: (ms: number) => void): T {
    for (let attempt = 0; ; attempt++) {
        try {
            return op();
        } catch (err: any) {
            if (!LOCK_CODES.has(err?.code) || attempt >= LOCK_RETRY_WAITS_MS.length) throw err;
            sleep(LOCK_RETRY_WAITS_MS[attempt]);
        }
    }
}

/** Writes `data` to `file` whole or not at all. Throws when it could not. */
export function writeFileAtomicSync(file: string, data: string | Buffer, opts: { mode?: number } & AtomicFileDeps = {}): void {
    const rename = opts.rename ?? ((from: string, to: string) => fs.renameSync(from, to));
    const sleep = opts.sleepSync ?? sleepSync;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
        fs.writeFileSync(tmp, data, { mode: opts.mode ?? 0o600 });
        whileLocked(() => rename(tmp, file), sleep);
    } catch (err) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* nothing more to do */ }
        throw err;
    }
}

export type TextFileRead = { state: 'missing' } | { state: 'read'; text: string };

/**
 * Reads a text file. A file that is not there is an answer ("missing");
 * anything else that stops the read (a lock that outlasts the retries, a
 * permission problem) throws, so a caller never mistakes "could not read"
 * for "empty" and overwrites what it could not see.
 */
export function readTextFileSync(file: string, deps: AtomicFileDeps = {}): TextFileRead {
    const read = deps.readText ?? ((f: string) => fs.readFileSync(f, 'utf8'));
    try {
        return { state: 'read', text: whileLocked(() => read(file), deps.sleepSync ?? sleepSync) };
    } catch (err: any) {
        // ENOTDIR: a parent is not a folder, so the file cannot exist either.
        if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return { state: 'missing' };
        throw err;
    }
}
