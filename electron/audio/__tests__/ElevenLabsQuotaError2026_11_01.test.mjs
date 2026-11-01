// User log 2026-11-01 (Windows, 2.9.2): ElevenLabs sent "You have exceeded
// your quota." and closed with reason=insufficient_funds. The provider emitted
// the bare string, main's STT error handler threw on `err.message
// .toLowerCase()`, the throw was swallowed as "Failed to parse message", and
// the overlay never showed the quota failure: transcription just stopped.
// Shared code, no platform branch: the same path runs on macOS and Windows.
//
// Run (after `npm run build:electron`):
//   node --test electron/audio/__tests__/ElevenLabsQuotaError2026_11_01.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { elevenLabsServerError } = require(path.join(REPO, 'dist-electron/electron/audio/ElevenLabsStreamingSTT.js'));

test('a quota message becomes an Error main can classify as quota', () => {
    const err = elevenLabsServerError({ message_type: 'quota_exceeded', error: 'You have exceeded your quota.' });
    assert.ok(err instanceof Error);
    assert.equal(err.code, 'quota_exceeded');
    assert.match(err.message, /You have exceeded your quota\./);
    // main.ts: isQuotaError = message includes 'quota'
    assert.ok(err.message.toLowerCase().includes('quota'));
});

test('an auth_error object keeps its text and type', () => {
    const err = elevenLabsServerError({ message_type: 'auth_error', error: 'Invalid API key' });
    assert.equal(err.code, 'auth_error');
    assert.match(err.message, /Invalid API key/);
});

test('odd shapes never produce an Error without a message', () => {
    for (const msg of [{}, { error: '' }, { error: { message: 'nested' } }, { type: 'error' }, null, undefined]) {
        const err = elevenLabsServerError(msg);
        assert.ok(err instanceof Error);
        assert.equal(typeof err.message, 'string');
        assert.ok(err.message.length > 0);
        assert.doesNotThrow(() => err.message.toLowerCase());
    }
    assert.match(elevenLabsServerError({ error: { message: 'nested' } }).message, /nested/);
});

test('the provider emits wrapped errors, never the raw message', () => {
    const src = fs.readFileSync(path.join(REPO, 'electron/audio/ElevenLabsStreamingSTT.ts'), 'utf8');
    assert.ok(!/this\.emit\('error',\s*msg(\.error)?\)/.test(src), 'raw msg / msg.error emitted');
    assert.equal((src.match(/this\.emit\('error', elevenLabsServerError\(msg\)\)/g) || []).length, 2);
});

test("main's STT error handler normalises non-Error payloads before reading .message", () => {
    const src = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
    const at = src.indexOf("stt.on('error', (raw: unknown) => {");
    assert.ok(at > 0, 'handler takes unknown');
    const head = src.slice(at, at + 2000);
    const firstRead = head.search(/err\.message(\s*\|\||\.toLowerCase)/);
    assert.ok(firstRead > 0, 'found the first code read of err.message');
    assert.ok(head.indexOf('raw instanceof Error') < firstRead, 'normalised before first read');
});
