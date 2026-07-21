/**
 * credentialFallbackCrypto - app-managed AES-256-GCM for the credential fallback.
 *
 * Used by CredentialsManager ONLY when Electron's safeStorage (the OS keyring) is
 * unavailable — e.g. Linux without gnome-libsecret/kwallet, or an improperly-signed
 * build. Without this, those users' API keys (STT keys especially, which have no
 * env-var fallback) silently vanish on every restart.
 *
 * SECURITY POSTURE — read before changing:
 *   This is obfuscation-grade, NOT keyring-grade. The encryption key is derived from
 *   stable machine/install attributes plus a per-install random salt that lives next
 *   to the file, so anyone already running code as this user can re-derive it. That is
 *   an unavoidable property of having no OS-provided secret to anchor to. It still
 *   strictly beats the alternatives it replaces:
 *     - vs. plaintext-at-rest: secrets are not readable in the file (GCM ciphertext).
 *     - vs. today's silent data loss: keys actually survive a restart.
 *     - machine/install-bound: copying the file to another machine, or leaking it via
 *       cloud backup/sync, does not reveal the keys (the salt+material won't match).
 *
 * Kept as a pure module (no Electron imports) so it is unit-testable in plain Node.
 */

import * as crypto from 'crypto';

/** File magic so we can recognise and version the blob format. */
const MAGIC = Buffer.from('NCF1', 'ascii'); // Natively Credential Fallback v1
const VERSION = 1;
const IV_LEN = 12;   // GCM standard nonce length
const TAG_LEN = 16;  // GCM auth tag length
const KEY_LEN = 32;  // AES-256
const HEADER_LEN = MAGIC.length + 1; // magic + version byte

/**
 * Derive a stable 32-byte AES key from per-machine/per-install material and a salt.
 * `materialParts` are joined with a unit-separator so distinct part boundaries can't
 * collide (e.g. ['a','bc'] vs ['ab','c']). scrypt is deliberately slow — fine here,
 * the key is derived once per process and memoized by the caller.
 */
export function deriveFallbackKey(materialParts: string[], salt: Buffer): Buffer {
    const material = materialParts.join('\x1f');
    return crypto.scryptSync(material, salt, KEY_LEN);
}

/**
 * Encrypt a UTF-8 plaintext into the framed blob:
 *   magic(4) | version(1) | iv(12) | tag(16) | ciphertext
 * Returns a Buffer suitable for atomic write to disk.
 */
export function encryptCredentialBlob(plaintext: string, key: Buffer): Buffer {
    if (key.length !== KEY_LEN) {
        throw new Error(`credentialFallbackCrypto: key must be ${KEY_LEN} bytes`);
    }
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const header = Buffer.concat([MAGIC, Buffer.from([VERSION])]);
    return Buffer.concat([header, iv, tag, ciphertext]);
}

/**
 * Decrypt a blob produced by encryptCredentialBlob with the same derived key.
 * Throws on a bad magic/version, a truncated blob, a wrong key, or any tampering
 * (the GCM tag verification fails). Callers treat a throw as "fallback unusable —
 * start fresh", mirroring the encrypted-keyring corruption path.
 */
export function decryptCredentialBlob(buf: Buffer, key: Buffer): string {
    if (key.length !== KEY_LEN) {
        throw new Error(`credentialFallbackCrypto: key must be ${KEY_LEN} bytes`);
    }
    if (buf.length < HEADER_LEN + IV_LEN + TAG_LEN) {
        throw new Error('credentialFallbackCrypto: blob too short');
    }
    if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error('credentialFallbackCrypto: bad magic');
    }
    const version = buf[MAGIC.length];
    if (version !== VERSION) {
        throw new Error(`credentialFallbackCrypto: unsupported version ${version}`);
    }
    let offset = HEADER_LEN;
    const iv = buf.subarray(offset, offset + IV_LEN); offset += IV_LEN;
    const tag = buf.subarray(offset, offset + TAG_LEN); offset += TAG_LEN;
    const ciphertext = buf.subarray(offset);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
}
