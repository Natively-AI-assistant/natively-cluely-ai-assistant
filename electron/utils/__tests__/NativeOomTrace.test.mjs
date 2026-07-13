import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, '..', 'NativeOomTrace.ts'), 'utf8');

test('native OOM trace is explicitly opt-in and bounded', () => {
  assert.match(source, /NATIVELY_NATIVE_OOM_TRACE/);
  assert.match(source, /NATIVELY_NATIVE_OOM_CONTENT_TRACE/);
  assert.match(source, /MAX_TRACE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(source, /CONTENT_TRACE_DURATION_MS = 25_000/);
  assert.match(source, /trace_buffer_size_in_kb: 16 \* 1024/);
});

test('native OOM trace allowlist excludes payload text and credentials', () => {
  assert.match(source, /const SAFE_STRING_FIELDS/);
  assert.match(source, /const SAFE_NUMBER_FIELDS/);
  assert.match(source, /const SAFE_OBJECT_FIELDS/);
  assert.doesNotMatch(source, /'text'/);
  assert.doesNotMatch(source, /'prompt'/);
  assert.doesNotMatch(source, /'apiKey'/);
  assert.match(source, /Payload values are never written to disk/);
});

test('native OOM trace records only estimated IPC payload sizes', () => {
  assert.match(source, /recordOutboundIpc\(webContentsId: number, channel: string, args: unknown\[\]\)/);
  assert.match(source, /estimatedBytes/);
  assert.match(source, /estimateValueBytes/);
  assert.match(source, /ipc: this\.ledgerSnapshot\(\)/);
});

test('native OOM trace clears its interval IPC ledger after each sample', () => {
  assert.match(source, /this\.ledger\.clear\(\)/);
  assert.match(source, /Each sample reports the preceding heartbeat interval/);
});

test('native OOM trace arms content tracing only after a bounded RSS-growth threshold', () => {
  assert.match(source, /CONTENT_TRACE_RSS_DELTA_BYTES = 512 \* 1024 \* 1024/);
  assert.match(source, /CONTENT_TRACE_RSS_MULTIPLIER = 2/);
  assert.match(source, /armContentTrace\(launcherPid: number\)/);
  assert.match(source, /rss-growth-threshold-crossed/);
});
