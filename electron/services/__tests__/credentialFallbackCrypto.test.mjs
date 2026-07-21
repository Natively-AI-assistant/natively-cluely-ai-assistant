import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  deriveFallbackKey,
  encryptCredentialBlob,
  decryptCredentialBlob,
} from '../../../dist-electron/electron/services/credentialFallbackCrypto.js';

// A representative credential blob (the real thing is JSON of StoredCredentials).
const SECRET = 'sk-deepgram-LIVE-9f3c2a1b0e7d4c8a6b5e2f1d0c9b8a7';
const PLAINTEXT = JSON.stringify({ deepgramApiKey: SECRET, sttProvider: 'deepgram' });

function freshKey(material = ['host-a', 'user-a', '/Users/a/Library/App', 'darwin']) {
  return deriveFallbackKey(material, crypto.randomBytes(32));
}

test('round-trip: encrypt then decrypt returns the original plaintext', () => {
  const key = freshKey();
  const blob = encryptCredentialBlob(PLAINTEXT, key);
  assert.equal(decryptCredentialBlob(blob, key), PLAINTEXT);
  assert.equal(JSON.parse(decryptCredentialBlob(blob, key)).deepgramApiKey, SECRET);
});

test('no plaintext at rest: the encrypted blob does not contain the key bytes', () => {
  const key = freshKey();
  const blob = encryptCredentialBlob(PLAINTEXT, key);
  // The secret (and a recognizable substring of it) must not appear in the ciphertext.
  assert.equal(blob.includes(Buffer.from(SECRET, 'utf8')), false, 'secret leaked verbatim');
  assert.equal(blob.toString('latin1').includes('sk-deepgram'), false, 'secret prefix leaked');
});

test('tamper: flipping any ciphertext byte makes decryption throw (GCM auth)', () => {
  const key = freshKey();
  const blob = encryptCredentialBlob(PLAINTEXT, key);
  const tampered = Buffer.from(blob);
  // Flip a byte well past the header/iv/tag, inside the ciphertext region.
  const idx = tampered.length - 1;
  tampered[idx] = tampered[idx] ^ 0xff;
  assert.throws(() => decryptCredentialBlob(tampered, key));
});

test('wrong key: a blob cannot be decrypted with a different derived key', () => {
  const blob = encryptCredentialBlob(PLAINTEXT, freshKey());
  const otherKey = freshKey(); // different random salt → different key
  assert.throws(() => decryptCredentialBlob(blob, otherKey));
});

test('machine-bind: same material but a different salt cannot decrypt', () => {
  const material = ['host-x', 'user-x', '/Users/x/Library/App', 'linux'];
  const keyA = deriveFallbackKey(material, crypto.randomBytes(32));
  const keyB = deriveFallbackKey(material, crypto.randomBytes(32));
  const blob = encryptCredentialBlob(PLAINTEXT, keyA);
  assert.throws(() => decryptCredentialBlob(blob, keyB),
    'a leaked file should be useless on a machine whose salt differs');
});

test('determinism: same material + same salt derive the identical key', () => {
  const material = ['host-y', 'user-y', '/data', 'win32'];
  const salt = crypto.randomBytes(32);
  assert.ok(deriveFallbackKey(material, salt).equals(deriveFallbackKey(material, salt)));
});

test('format guards: bad magic and truncated blobs throw, not silently misparse', () => {
  const key = freshKey();
  assert.throws(() => decryptCredentialBlob(Buffer.alloc(8), key), /too short|bad magic/i);
  const blob = encryptCredentialBlob(PLAINTEXT, key);
  const badMagic = Buffer.from(blob);
  badMagic[0] = badMagic[0] ^ 0xff;
  assert.throws(() => decryptCredentialBlob(badMagic, key), /bad magic|version/i);
});

test('key length: a non-32-byte key is rejected on both encrypt and decrypt', () => {
  assert.throws(() => encryptCredentialBlob(PLAINTEXT, Buffer.alloc(16)), /32 bytes/);
  const blob = encryptCredentialBlob(PLAINTEXT, freshKey());
  assert.throws(() => decryptCredentialBlob(blob, Buffer.alloc(16)), /32 bytes/);
});
