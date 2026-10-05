// F-118 regression pin (audit/autopilot-2026-08-14).
//
// The rag:query-live catch used to send a TERMINAL rag:stream-error
// {live:true} AND return {success:false}. The renderer treats non-success as
// "fall through to regular live chat", so one failure produced two
// contradictory UI actions: "[RAG Error: …]" stapled into the bubble with
// streaming state cleared, then fresh fallback tokens streaming into that
// torn-down row. Live-reproduced in scripts/audit/F-118-repro.mjs (both
// signals pre-fix; fallback-return only post-fix).
//
// Contract pinned here: the live handler emits NO rag:stream-error (the
// fallback owns the UX); the meeting and global handlers KEEP their terminal
// error events because nothing falls back for those classes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'ipcHandlers.ts'), 'utf8');

function handlerBlock(channel, nextChannel) {
  const a = source.indexOf(`safeHandle('${channel}'`);
  assert.notEqual(a, -1, `${channel} handler not found`);
  const b = source.indexOf(`safeHandle('${nextChannel}'`, a);
  assert.notEqual(b, -1, `${nextChannel} handler not found after ${channel}`);
  return source.slice(a, b);
}

test('live handler never emits rag:stream-error (fallback owns the UX)', () => {
  const live = handlerBlock('rag:query-live', 'rag:query-global');
  assert.ok(
    !/send\('rag:stream-error'/.test(live),
    'rag:query-live must not send a terminal error event alongside its {success:false} fallback return (F-118)'
  );
});

test('meeting and global handlers keep their terminal error events', () => {
  assert.ok(
    /send\('rag:stream-error',\s*\{\s*meetingId/.test(source),
    'meeting-scoped terminal error event must remain'
  );
  assert.ok(
    /send\('rag:stream-error',\s*\{\s*global:\s*true/.test(source),
    'global-scoped terminal error event must remain'
  );
});
