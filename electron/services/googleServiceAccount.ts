// electron/services/googleServiceAccount.ts
//
// One decision: "is this path a usable Google service-account key file, and if
// not, do we KNOW that or merely fail to see it right now?"
//
// WHY THE SECOND HALF MATTERS
// `new SpeechClient({ keyFilename })` does not validate at construction. A bad
// path surfaces later as ENOENT from inside the STT stream and again from the
// `before-quit` teardown, which reads to the user as a fatal app crash rather
// than a bad setting. So we validate up front.
//
// But "cannot read it" is NOT the same as "it is not there". A key file on an
// unmounted external volume, a not-yet-connected network share, or a folder the
// app has not been granted access to (macOS TCC) all fail exactly like a deleted
// file — on macOS an unmounted /Volumes/X path reports ENOENT, not EIO. Treating
// those as "gone" and evicting the stored path would destroy a working
// credential the user gets back the moment the volume mounts.
//
// Hence `definite`: true only when we positively read the file and it is not a
// service-account key. Callers may report a `definite` failure to the user as a
// bad pick; they must NOT delete persisted state on an indefinite one.

import fs from 'fs';

/**
 * The placeholder shipped in `.env.example`. Older builds persisted it into the
 * credential store verbatim, producing an ENOENT crash loop that survived
 * removing the line from `.env` (by then the dummy lived in the keychain).
 * `.env.example` now ships it commented out; this constant lets the boot path
 * evict a copy an earlier build already persisted.
 *
 * This is the ONE literal that is ever evicted automatically. Everything else
 * is handled by classification above — see the note about `definite`.
 */
export const DUMMY_SERVICE_ACCOUNT_PATH = '/path/to/your/service-account.json';

export type ServiceAccountRejection =
    | 'empty'
    | 'placeholder'
    | 'not_a_file'
    | 'unreadable'
    | 'not_json'
    | 'not_service_account';

/**
 * NOTE: deliberately ONE shape with optional fields rather than a discriminated
 * union on `usable`. `electron/tsconfig.json` does not enable `strict`, so
 * narrowing a boolean-literal discriminant does not apply there and every
 * `verdict.reason` read after an `if (!verdict.usable)` would be a type error.
 * A single interface keeps the call sites honest under both configs.
 */
export interface ServiceAccountVerdict {
    usable: boolean;
    /** Present whenever `usable` is false. */
    reason?: ServiceAccountRejection;
    /**
     * True when we positively determined the file is not a usable key.
     * False when we simply could not read it right now (which may be
     * transient) — callers must not treat this as "the credential is gone".
     * Only meaningful when `usable` is false.
     */
    definite?: boolean;
    detail?: string;
}

/** Injectable IO so the classifier is unit-testable without touching a disk. */
export interface ServiceAccountIO {
    statSync(p: string): { isFile(): boolean };
    readFileSync(p: string, enc: 'utf8'): string;
}

const DEFAULT_IO: ServiceAccountIO = {
    statSync: (p) => fs.statSync(p),
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
};

/**
 * Classify a candidate service-account key path.
 *
 * Deliberately reads and parses rather than stopping at `statSync().isFile()`.
 * The file dialog filters to `*.json`, so the realistic mistake is picking the
 * WRONG json — a downloaded OAuth client secret, an api-key export, a
 * package.json. Those all pass an existence check and then fail inside the
 * Speech SDK with the same deferred crash an absent file produces.
 */
export function classifyServiceAccountFile(
    keyPath: string | undefined | null,
    io: ServiceAccountIO = DEFAULT_IO,
): ServiceAccountVerdict {
    if (!keyPath || !keyPath.trim()) {
        return { usable: false, reason: 'empty', definite: true };
    }
    if (keyPath === DUMMY_SERVICE_ACCOUNT_PATH) {
        return { usable: false, reason: 'placeholder', definite: true };
    }

    let raw: string;
    try {
        if (!io.statSync(keyPath).isFile()) {
            // We READ the directory entry and it is not a regular file. That is
            // a positive determination, not a visibility problem.
            return { usable: false, reason: 'not_a_file', definite: true };
        }
        raw = io.readFileSync(keyPath, 'utf8');
    } catch (err: any) {
        // ENOENT / EACCES / EIO / ENOTCONN are NOT distinguishable here in a way
        // that is safe to act on: an unmounted volume yields ENOENT. Indefinite.
        return {
            usable: false,
            reason: 'unreadable',
            definite: false,
            detail: err?.code || err?.message || String(err),
        };
    }

    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // NO detail. `JSON.parse` embeds a snippet of the INPUT in its message
        // ("Unexpected token 'p', \"private_ke\"... is not valid JSON"), and this
        // file is a private key — callers log `detail`, so passing it through
        // would print key material into the app log. The reason code alone is
        // enough to tell the user what to do.
        return { usable: false, reason: 'not_json', definite: true };
    }

    // Google service-account keys carry `type: "service_account"` plus the two
    // fields the SDK actually signs with. Checking all three keeps an OAuth
    // client-secret json (which has none of them) from being adopted.
    if (!parsed || typeof parsed !== 'object'
        || parsed.type !== 'service_account'
        || typeof parsed.client_email !== 'string'
        || typeof parsed.private_key !== 'string') {
        return {
            usable: false,
            reason: 'not_service_account',
            definite: true,
            detail: parsed && typeof parsed === 'object' && typeof parsed.type === 'string'
                ? `type=${parsed.type}`
                : undefined,
        };
    }

    return { usable: true };
}

/** User-facing explanation for a rejection. Kept next to the reasons so the
 *  Settings picker and the boot log stay in agreement. */
export function describeServiceAccountRejection(reason: ServiceAccountRejection | undefined): string {
    switch (reason) {
        case 'empty':
            return 'No file was selected.';
        case 'placeholder':
            return 'That is the example path from .env.example, not a real key file.';
        case 'not_a_file':
            return 'That path is not a file.';
        case 'unreadable':
            return 'That file could not be read right now. If it lives on an external drive or network share, connect it and try again.';
        case 'not_json':
            return 'That file is not valid JSON.';
        case 'not_service_account':
            return 'That JSON is not a Google service-account key. Download the key for a service account (it contains "type": "service_account").';
        default:
            return 'That file is not a usable Google service-account key.';
    }
}
