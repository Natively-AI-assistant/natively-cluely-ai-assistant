// electron/utils/__tests__/OnnxAvailableMemoryProbe2026_11_02.test.mjs
//
// The available-memory probe behind every local ONNX gate, per platform.
// measureAvailableMemory() takes the platform and the OS reads as arguments, so
// each branch runs here on any host — macOS CI exercises the Windows branch and
// Windows CI the macOS one (process.platform is never mutated).
//
// Issue #707 (a 16 GB Windows PC refused local STT) made two gaps visible:
//   - On Windows, libuv reports a failed GlobalMemoryStatusEx as os.freemem()
//     = 0. The gate read that as "0 GB available" and refused every local
//     model, though the gates are meant to fail OPEN on a failed measurement.
//   - Logs printed one "GB available" figure for every OS, though vm_stat,
//     MemAvailable and ullAvailPhys are not the same measure. Readings now
//     name their probe.
//
// Run: npm run build:electron && node --test electron/utils/__tests__/OnnxAvailableMemoryProbe2026_11_02.test.mjs

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gate = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/utils/onnxThreadConfig.js')).href);
const { measureAvailableMemory, getAvailableMemoryReading, checkMemoryForModelSize } = gate;

const GiB = 1024 ** 3;
const VM_STAT = [
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
  'Pages free:                               10000.',
  'Pages active:                            400000.',
  'Pages inactive:                          100000.',
  'Pages speculative:                        21072.',
].join('\n');
// (10000 + 100000 + 21072) * 16384 bytes = 2.0 GiB
const MEMINFO = 'MemTotal:       16000000 kB\nMemFree:          500000 kB\nMemAvailable:    3145728 kB\n'; // 3 GiB

const probes = (over = {}) => ({
  vmStat: () => VM_STAT,
  meminfo: () => MEMINFO,
  freemem: () => 1.5 * GiB,
  ...over,
});
const boom = () => { throw new Error('probe failed'); };

afterEach(() => {
  delete process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB;
});

test('darwin: free + inactive + speculative pages from vm_stat', () => {
  const r = measureAvailableMemory('darwin', probes());
  assert.equal(r.source, 'vm_stat');
  assert.ok(Math.abs(r.gb - 2.0) < 1e-9, String(r.gb));
});

test('win32: os.freemem() (GlobalMemoryStatusEx ullAvailPhys)', () => {
  const r = measureAvailableMemory('win32', probes({ vmStat: boom, meminfo: boom }));
  assert.deepEqual(r, { gb: 1.5, source: 'freemem' });
});

test('linux: MemAvailable from /proc/meminfo', () => {
  assert.deepEqual(measureAvailableMemory('linux', probes()), { gb: 3, source: 'meminfo' });
});

test('darwin: a failed or unparseable vm_stat falls back to os.freemem()', () => {
  assert.deepEqual(measureAvailableMemory('darwin', probes({ vmStat: boom })), { gb: 1.5, source: 'freemem' });
  // Labels that do not parse sum to 0 pages — not a real reading.
  assert.deepEqual(measureAvailableMemory('darwin', probes({ vmStat: () => 'garbage' })), { gb: 1.5, source: 'freemem' });
});

test('win32: os.freemem() = 0 is a failed measurement, not "no memory"', () => {
  assert.equal(measureAvailableMemory('win32', probes({ freemem: () => 0 })), null);
  assert.equal(measureAvailableMemory('win32', probes({ freemem: () => NaN })), null);
  assert.equal(measureAvailableMemory('win32', probes({ freemem: boom })), null);
});

test('darwin: nothing measurable at all is null too', () => {
  assert.equal(measureAvailableMemory('darwin', probes({ vmStat: boom, freemem: () => 0 })), null);
});

test('low but real memory is still reported, so the gate can still refuse', () => {
  assert.deepEqual(measureAvailableMemory('win32', probes({ freemem: () => 0.25 * GiB })), { gb: 0.25, source: 'freemem' });
});

test('the override names itself, and the gate reports its source', () => {
  process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = '0.4';
  assert.deepEqual(getAvailableMemoryReading(), { gb: 0.4, source: 'override' });
  assert.deepEqual(checkMemoryForModelSize(60), { ok: false, availableGB: 0.4, source: 'override', floorGB: 0.62 });
});

test('this host: a real reading is cached, so the gate and its message see the same one', () => {
  const a = getAvailableMemoryReading();
  const b = getAvailableMemoryReading();
  assert.ok(a.gb > 0 && Number.isFinite(a.gb));
  assert.notEqual(a.source, 'override');
  assert.equal(b, a, 'a second read inside the TTL returns the same cached reading');
});
