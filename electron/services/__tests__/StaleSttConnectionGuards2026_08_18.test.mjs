// F-203 regression pin (audit/autopilot-2026-08-18).
//
// NativelyProSTT wraps every handler in `guard(ws === this.ws)` and documents
// it as CRITICAL: "a delayed event from a previously-closed WebSocket can
// mutate this.isConnected / this.isConnecting / fire scheduleReconnect
// against the new ws's state." Google, Soniox and Deepgram had no such guard,
// while all three restart via a SYNCHRONOUS stop()+start().
//
// Live-reproduced for GoogleSTT (the universal fallback provider) in
// scripts/audit/F-203-repro.mjs: after setSampleRate — which main.ts triggers
// on the first audio chunk of EVERY meeting — the destroyed stream's async
// 'close' ran `this.stream = null` against the freshly-created stream,
// orphaning it (open, never ended) so the next write opened a third.
//
// Contract pinned here: every state-mutating handler in the three providers
// verifies it still owns the current connection before mutating it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '..', '..', 'audio');
const read = (f) => fs.readFileSync(path.join(audioDir, f), 'utf8');

test('GoogleSTT guards its state-mutating stream handlers', () => {
  const src = read('GoogleSTT.ts');
  assert.ok(/const stream: any = this\.client/.test(src),
    'startStream must bind the stream to a local for identity comparison (F-203)');
  for (const evt of ['error', 'end', 'close']) {
    const i = src.indexOf(`.on('${evt}'`);
    assert.notEqual(i, -1, `missing ${evt} handler`);
    const body = src.slice(i, i + 260);
    assert.ok(/stream !== this\.stream\) return/.test(body),
      `GoogleSTT '${evt}' handler must bail when it no longer owns this.stream (F-203)`);
  }
  assert.ok(src.indexOf('this.stream = stream;') > src.indexOf(".on('data'"),
    'the new stream must be published only after its handlers are attached');
});

test('SonioxStreamingSTT guards its state-mutating socket handlers', () => {
  const src = read('SonioxStreamingSTT.ts');
  assert.ok(/const ws = this\.ws;/.test(src), 'connect must bind the socket to a local (F-203)');
  for (const evt of ['open', 'error', 'close']) {
    const i = src.indexOf(`this.ws.on('${evt}'`);
    assert.notEqual(i, -1, `missing ${evt} handler`);
    const body = src.slice(i, i + 220);
    assert.ok(/ws !== this\.ws\) return/.test(body),
      `Soniox '${evt}' handler must bail when it no longer owns this.ws — the close path otherwise sets isActive=false and silently drops every chunk (F-203)`);
  }
});

test('DeepgramStreamingSTT guards its state-mutating connection handlers', () => {
  const src = read('DeepgramStreamingSTT.ts');
  assert.ok(/const live = this\.live;/.test(src), 'connect must bind the connection to a local (F-203)');
  const guards = src.match(/live !== this\.live\) return/g) ?? [];
  assert.ok(guards.length >= 3,
    `Open/Error/Close must each bail on a stale connection; found ${guards.length} (F-203)`);
  assert.ok(/live\.on\(LiveTranscriptionEvents\.Transcript/.test(src),
    'the Transcript listener must bind to the captured connection so a stale Open cannot double-register it (F-203)');
});
