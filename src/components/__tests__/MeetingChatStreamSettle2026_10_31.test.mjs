// The meeting chat keeps the whole streamed answer (2026-10-31). The ipc reply
// to the Ask query can reach the page before the stream's last chunks and its
// done event; the chat's `finally` then removed the listeners and reset the
// buffer, and answers stayed cut mid-sentence ("$7.20 per employee per month
// on a"), 3 of 84 in the Natively vs Granola benchmark. A direct query of the
// same question streamed the full answer.
//
// Source contract; no platform branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../MeetingChatOverlay.tsx'), 'utf8');

test('after the query returns, the chat waits for the stream to settle before tearing down', () => {
    assert.match(src, /const STREAM_SETTLE_MS = 3000;/);
    assert.match(src, /const result = await window\.electronAPI\?\.ragQueryMeeting\(meetingId, question\);\s*if \(result\?\.success && !result\?\.fallback\) await awaitSettled\(\);/);
    assert.match(src, /\{ skipSystemPrompt: true \}\s*\);\s*await awaitSettled\(\);/);
    // Every done and error handler settles (two streams: RAG and the context-window fallback).
    assert.equal((src.match(/settle\(\);/g) ?? []).length, 4);
});

test('text that streamed in but never got its done event is kept, not dropped', () => {
    const fin = src.slice(src.indexOf('} finally {'));
    assert.ok(fin.indexOf('const pending = streamBuffer.getBufferedContent();') < fin.indexOf('streamBuffer.reset();'));
    assert.match(fin, /msg\.id === assistantMessageId && msg\.isStreaming\s*\? \{ \.\.\.msg, content: pending, isStreaming: false \}/);
});
