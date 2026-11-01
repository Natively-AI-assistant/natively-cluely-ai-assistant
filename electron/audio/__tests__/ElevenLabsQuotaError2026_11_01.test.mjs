// User log 2026-11-01 (Windows, 2.9.2): ElevenLabs sent "You have exceeded
// your quota." and closed with reason=insufficient_funds. The provider emitted
// the bare string, main's STT error handler threw on `err.message
// .toLowerCase()`, the throw was swallowed as "Failed to parse message", and
// the overlay never showed the quota failure: transcription just stopped.
// Shared code, no platform branch: the same path runs on macOS and Windows.
//
// Review follow-ups in the same log: auth_error was never classified as final
// by main (overlay stuck on "reconnecting"), and any normal (1000) server
// close (idle with no system audio, session time limit, throttling) set the
// provider inactive for good, so that channel stayed silent for the rest of
// the meeting.
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
const {
    elevenLabsServerError,
    elevenLabsCloseAction,
    elevenLabsServerErrorAction,
    ELEVENLABS_TERMINAL_ERRORS,
    ELEVENLABS_HEALTHY_SESSION_MS,
} = require(path.join(REPO, 'dist-electron/electron/audio/ElevenLabsStreamingSTT.js'));
const { categorizeSttError } = await import(path.join(REPO, 'src/lib/sttErrorMapper.ts'));

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
    assert.equal((src.match(/this\.emit\('error', elevenLabsServerError\(msg\)\)/g) || []).length, 1, 'one emit, in handleServerError');
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

test('terminal types are exactly the ones a reconnect cannot fix', () => {
    assert.deepEqual([...ELEVENLABS_TERMINAL_ERRORS].sort(), ['auth_error', 'invalid_request', 'quota_exceeded', 'unaccepted_terms']);
    for (const t of ELEVENLABS_TERMINAL_ERRORS) {
        assert.equal(elevenLabsServerErrorAction(t), 'terminal', t);
        assert.equal(elevenLabsServerError({ message_type: t, error: 'x' }).terminal, true, t);
    }
    for (const t of ['rate_limited', 'resource_exhausted', 'session_time_limit_exceeded', 'transcriber_error',
        'error', 'commit_throttled', 'queue_overflow', 'input_error', 'chunk_size_exceeded']) {
        assert.equal(elevenLabsServerErrorAction(t), 'retry', t);
        assert.equal(elevenLabsServerError({ message_type: t, error: 'x' }).terminal, false, t);
    }
    assert.equal(elevenLabsServerErrorAction('insufficient_audio_activity'), 'idle');
});

test('a normal close of a healthy session keeps the channel alive (lazy reconnect on next audio)', () => {
    const healthy = ELEVENLABS_HEALTHY_SESSION_MS;
    // The user log: socket closed 1000 with no reason ~15 s into the meeting.
    assert.equal(elevenLabsCloseAction(true, 1000, 15_000), 'lazy');
    assert.equal(elevenLabsCloseAction(true, 1000, healthy), 'lazy');
    // Accept-then-close at once: backoff, never a reconnect per audio chunk.
    assert.equal(elevenLabsCloseAction(true, 1000, healthy - 1), 'reconnect');
    assert.equal(elevenLabsCloseAction(true, 1000, 0), 'reconnect');
    // Dropped socket: backoff as before.
    assert.equal(elevenLabsCloseAction(true, 1006, 60_000), 'reconnect');
    // stop(), terminal error or reconnects exhausted: stays stopped.
    assert.equal(elevenLabsCloseAction(false, 1000, 60_000), 'stop');
    assert.equal(elevenLabsCloseAction(false, 1006, 0), 'stop');
});

test('the provider wires those decisions, and backoff resets only after a healthy session', () => {
    const src = fs.readFileSync(path.join(REPO, 'electron/audio/ElevenLabsStreamingSTT.ts'), 'utf8');
    assert.match(src, /elevenLabsCloseAction\(this\.shouldReconnect, code, livedMs\)/);
    assert.match(src, /if \(action === 'stop'\) this\.isActive = false;/);
    assert.ok(!/this\.shouldReconnect && code !== 1000/.test(src), 'old close rule gone');
    const open = src.slice(src.indexOf("this.ws.on('open'"), src.indexOf("this.ws.on('message'"));
    assert.ok(!open.includes('reconnectAttempts = 0'), 'open no longer resets backoff');
    assert.match(src, /if \(livedMs >= ELEVENLABS_HEALTHY_SESSION_MS\) this\.reconnectAttempts = 0;/);
    const handler = src.slice(src.indexOf('private handleServerError'), src.indexOf('private scheduleReconnect'));
    assert.ok(handler.indexOf('this.shouldReconnect = false') < handler.indexOf("this.emit('error'"), 'latched before main sees the error');
});

test('main treats a terminal non-quota error as final, quota keeps its stand-in branch', () => {
    const src = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
    const at = src.indexOf("stt.on('error', (raw: unknown) => {");
    const body = src.slice(at, at + 6000);
    assert.match(body, /\(\(err as any\)\?\.terminal === true && !isQuotaError\)/);
    assert.ok(body.indexOf('const isQuotaError') < body.indexOf('const isAuthError'), 'quota computed first');
});

test('overlay copy: ElevenLabs quota reads as out of credits, auth_error as auth', () => {
    const quota = categorizeSttError(elevenLabsServerError({ message_type: 'quota_exceeded', error: 'You have exceeded your quota.' }).message);
    assert.equal(quota.category, 'quota');
    assert.match(quota.title, /Out of Credits/);
    const auth = categorizeSttError(elevenLabsServerError({ message_type: 'auth_error', error: 'Invalid API key' }).message);
    assert.match(auth.title, /Authentication Failed/);
    // Natively relay's own quota text is unchanged.
    assert.match(categorizeSttError('transcription_quota_exceeded').title, /Transcription Limit Reached/);
});
