// electron/utils/__tests__/NativeOomTrace.test.mjs
//
// Contract tests for the opt-in native OOM trace. The production module imports
// Electron, so the inlined harness mirrors only the filesystem, privacy, IPC,
// and tracing lifecycle contract and remains runnable in bare node --test.
// A second block of tests below asserts directly against the .ts source for
// behavior that isn't practical to mirror in the inlined harness (RSS-threshold
// arming, ledger-clear-on-sample).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_TRACE_BYTES = 5 * 1024 * 1024;

const SAFE_STRING_FIELDS = new Set(['event', 'platform', 'electron', 'window', 'reason', 'type', 'channel']);
const SAFE_NUMBER_FIELDS = new Set([
  'schema', 'pid', 'webContentsId', 'rendererPid', 'exitCode', 'rss', 'heapUsed',
  'heapTotal', 'external', 'arrayBuffers', 'freeMemory', 'totalMemory', 'messages',
  'estimatedBytes', 'workingSetSize', 'peakWorkingSetSize', 'privateBytes', 'sharedBytes',
]);
const SAFE_OBJECT_FIELDS = new Set(['main', 'system', 'launcher', 'processes', 'memory', 'ipc']);

function sanitizeTraceData(data) {
  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    if (SAFE_STRING_FIELDS.has(key) && typeof value === 'string') {
      sanitized[key] = value.slice(0, 100);
    } else if (SAFE_NUMBER_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      sanitized[key] = value;
    } else if (SAFE_OBJECT_FIELDS.has(key)) {
      if (Array.isArray(value)) {
        sanitized[key] = value.slice(0, 128).map((item) =>
          item && typeof item === 'object' ? sanitizeTraceData(item) : null,
        );
      } else if (value && typeof value === 'object') {
        sanitized[key] = sanitizeTraceData(value);
      }
    }
  }
  return sanitized;
}

function estimateValueBytes(value, depth = 0) {
  if (depth > 4 || value == null) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return 8;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  if (Array.isArray(value)) return value.slice(0, 64).reduce((total, item) => total + estimateValueBytes(item, depth + 1), 0);
  if (typeof value === 'object') return Object.values(value).slice(0, 64).reduce((total, item) => total + estimateValueBytes(item, depth + 1), 0);
  return 0;
}

function makeTrace({ enabled = true, contentTraceEnabled = false, maxTraceBytes = MAX_TRACE_BYTES } = {}) {
  const writes = [];
  const tracing = { starts: [], stops: [] };
  const ledger = new Map();
  let stopped = false;
  let contentTraceRunning = false;
  let contentTraceStarted = false;

  const write = (event, data = {}) => {
    if (!enabled || stopped) return;
    const line = JSON.stringify({ event, ...sanitizeTraceData(data) });
    const currentBytes = writes.reduce((size, entry) => size + Buffer.byteLength(entry), 0);
    if (currentBytes >= maxTraceBytes) return;
    writes.push(line);
  };

  return {
    writes,
    tracing,
    initialize: () => write('session-start', { schema: 1, pid: 123, platform: 'win32', electron: '43.1.0' }),
    record: write,
    recordOutboundIpc: (webContentsId, channel, args) => {
      if (!enabled || stopped) return;
      const key = `${webContentsId}:${channel}`;
      const entry = ledger.get(key) ?? { messages: 0, estimatedBytes: 0 };
      entry.messages += 1;
      entry.estimatedBytes += args.reduce((total, arg) => total + estimateValueBytes(arg), 0);
      ledger.set(key, entry);
    },
    snapshot: () => [...ledger.entries()].map(([key, value]) => {
      const separator = key.indexOf(':');
      return { webContentsId: Number(key.slice(0, separator)), channel: key.slice(separator + 1), ...value };
    }),
    startContentTrace: async (pid) => {
      if (!enabled || !contentTraceEnabled || contentTraceRunning || contentTraceStarted || stopped || pid <= 0) return;
      contentTraceStarted = true;
      contentTraceRunning = true;
      tracing.starts.push(pid);
      write('content-trace-started', { rendererPid: pid });
    },
    stopContentTrace: async (reason) => {
      if (!contentTraceRunning) return;
      contentTraceRunning = false;
      tracing.stops.push(reason);
      write('content-trace-stopped', { reason });
    },
    stop: (reason) => {
      if (!enabled || stopped) return;
      write('session-stop', { reason });
      void trace.stopContentTrace(reason);
      stopped = true;
    },
  };
}

let trace;

test('disabled trace is inert: it creates no records or IPC ledger', () => {
  trace = makeTrace({ enabled: false });
  trace.initialize();
  trace.record('launcher-did-finish-load', { secret: 'must-not-write' });
  trace.recordOutboundIpc(7, 'native-audio-transcript', [{ text: 'must-not-write' }]);
  assert.deepEqual(trace.writes, []);
  assert.deepEqual(trace.snapshot(), []);
});

test('allowlist strips payload text, URLs, credentials, and arbitrary keys', () => {
  const safe = sanitizeTraceData({
    window: 'launcher',
    webContentsId: 7,
    channel: 'native-audio-transcript',
    text: 'private transcript',
    prompt: 'private question',
    url: 'https://private.example/path',
    apiKey: 'secret',
    payload: { text: 'also private' },
    memory: { workingSetSize: 1024, password: 'secret' },
  });
  assert.deepEqual(safe, {
    window: 'launcher',
    webContentsId: 7,
    channel: 'native-audio-transcript',
    memory: { workingSetSize: 1024 },
  });
});

test('IPC ledger records channel and byte totals but never payload values', () => {
  trace = makeTrace();
  trace.recordOutboundIpc(9, 'native-audio-transcript', [{ speaker: 'user', text: 'sensitive transcript' }]);
  trace.recordOutboundIpc(9, 'native-audio-transcript', [{ speaker: 'user', text: 'another sensitive transcript' }]);
  const [entry] = trace.snapshot();
  assert.equal(entry.webContentsId, 9);
  assert.equal(entry.channel, 'native-audio-transcript');
  assert.equal(entry.messages, 2);
  assert.ok(entry.estimatedBytes > 0);
  assert.ok(!JSON.stringify(entry).includes('sensitive transcript'));
});

test('trace cap prevents further writes after the file budget is reached', () => {
  trace = makeTrace({ maxTraceBytes: 1 });
  trace.initialize();
  trace.record('sample', { main: { rss: 999 } });
  assert.equal(trace.writes.length, 1);
});

test('content trace starts once and stops exactly once across repeated terminal paths', async () => {
  trace = makeTrace({ contentTraceEnabled: true });
  await trace.startContentTrace(4321);
  await trace.startContentTrace(4321);
  await trace.stopContentTrace('launcher-render-process-gone');
  await trace.stopContentTrace('will-quit');
  assert.deepEqual(trace.tracing.starts, [4321]);
  assert.deepEqual(trace.tracing.stops, ['launcher-render-process-gone']);
});

test('content tracing stays off unless both diagnostic flags are enabled', async () => {
  trace = makeTrace({ enabled: true, contentTraceEnabled: false });
  await trace.startContentTrace(4321);
  assert.deepEqual(trace.tracing.starts, []);
});

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
