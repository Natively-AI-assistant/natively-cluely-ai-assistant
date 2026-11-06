// Latency telemetry counts from the user's action (2026-11-06): a typed
// question answered on the V3 path reported nothing, and What to answer's trace
// started after the screen read, hiding it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dist, require } from './fakeOllamaHarness.mjs';

const { PiLatencyTrace, tracerNow } = require(dist('services/telemetry/PiLatencyTracer.js'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('a trace started at the press counts the time before it was made', () => {
  const trace = new PiLatencyTrace({ source: 'what_to_answer', startedAt: tracerNow() - 800 });
  assert.ok(trace.elapsedMs() >= 800, String(trace.elapsedMs()));
});

test('no start given, or a start in the future: it starts now', () => {
  assert.ok(new PiLatencyTrace({ source: 'manual' }).elapsedMs() < 50);
  assert.ok(new PiLatencyTrace({ source: 'manual', startedAt: tracerNow() + 60_000 }).elapsedMs() < 50);
});

test('What to answer passes the press time to the engine, which starts its trace from it', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const handler = ipc.split("'generate-what-to-say',")[1].split('safeHandle(')[0];
  assert.ok(handler.indexOf('const pressedAt = tracerNow();') < handler.indexOf('return _tracked(async () => {'), 'taken before any work');
  assert.ok(handler.indexOf('const pressedAt = tracerNow();') < handler.indexOf('screen pre-pass'));
  assert.match(handler, /screenContext,\s*pressedAt,/);
  assert.match(read('electron/IntelligenceEngine.ts'), /\.\.\.\(typeof options\?\.pressedAt === 'number' \? \{ startedAt: options\.pressedAt \} : \{\}\),/);
});

test('a typed question has one trace from the handler\'s entry, and the V3 path marks it', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const handler = ipc.split('const _geminiChatStreamHandler = async (')[1].split("safeHandle('gemini-chat-stream', _geminiChatStreamHandler)")[0];
  assert.equal((handler.match(/new PiLatencyTrace\(/g) ?? []).length, 1, 'one trace per question');
  assert.ok(handler.indexOf('const chatTrace = new PiLatencyTrace(') < handler.indexOf('const llmHelper = appState.processingHelper.getLLMHelper();'));
  assert.match(handler, /finalText \+= visible;\s*chatTrace\.markFirstUseful\(\{ path: 'v3' \}\);/);
  assert.match(handler, /chatTrace\.mark\('response_completed', \{ path: 'v3'/);
});
