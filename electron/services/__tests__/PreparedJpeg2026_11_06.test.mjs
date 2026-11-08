// A screenshot's upload JPEG is made right after ⌘/Ctrl+H and reused by the
// send, instead of being re-encoded from the PNG on every send (2026-11-06).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mod = await import(pathToFileURL(path.join(root, 'dist-electron/electron/services/screen/preparedJpeg.js')).href);
const { preparedJpeg, prewarmPreparedJpeg, NATIVELY_API_JPEG, SCREEN_CAPTURE_JPEG, __resetPreparedJpegForTests } = mod;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepared-jpeg-'));
let n = 0;
const shot = async (w = 2940, h = 1912) => {
  const p = path.join(dir, `shot-${n++}.png`);
  await sharp({ create: { width: w, height: h, channels: 3, background: { r: 240, g: 240, b: 250 } } }).png().toFile(p);
  return p;
};
const counting = () => {
  const calls = [];
  const encode = async (p, spec) => { calls.push([p, spec.edge, spec.quality]); return Buffer.from(`${spec.edge}/${spec.quality}`); };
  return { calls, encode };
};

beforeEach(() => __resetPreparedJpegForTests());

test('the specs match what the upload paths ask for', () => {
  assert.deepEqual(NATIVELY_API_JPEG, { edge: 1920, quality: 85 });
  assert.deepEqual(SCREEN_CAPTURE_JPEG, { edge: 1536, quality: 80 });
});

test('a prewarmed screenshot is not encoded again at send time', async () => {
  const p = await shot();
  const { calls, encode } = counting();
  prewarmPreparedJpeg(p, [NATIVELY_API_JPEG, SCREEN_CAPTURE_JPEG], encode);
  assert.equal(calls.length, 2);
  const sent = await preparedJpeg(p, NATIVELY_API_JPEG, encode);
  assert.equal(sent.toString(), '1920/85');
  await preparedJpeg(p, SCREEN_CAPTURE_JPEG, encode);
  assert.equal(calls.length, 2, 'both sends reused the prewarmed bytes');
});

test('a send while the prewarm is still encoding shares that one encode', async () => {
  const p = await shot();
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const encode = async () => { calls++; await gate; return Buffer.from('x'); };
  prewarmPreparedJpeg(p, [NATIVELY_API_JPEG], encode);
  const sending = preparedJpeg(p, NATIVELY_API_JPEG, encode);
  release();
  assert.equal((await sending).toString(), 'x');
  assert.equal(calls, 1);
});

test('a different size is its own entry', async () => {
  const p = await shot();
  const { calls, encode } = counting();
  await preparedJpeg(p, { edge: 1536, quality: 80 }, encode);
  await preparedJpeg(p, { edge: 1024, quality: 78 }, encode);
  assert.equal(calls.length, 2);
});

test('a file rewritten under the same name is encoded afresh', async () => {
  const p = await shot(800, 600);
  const { calls, encode } = counting();
  await preparedJpeg(p, NATIVELY_API_JPEG, encode);
  await sharp({ create: { width: 900, height: 700, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toFile(p);
  await preparedJpeg(p, NATIVELY_API_JPEG, encode);
  assert.equal(calls.length, 2);
});

test('a failed encode rejects for the caller and is not cached', async () => {
  const p = await shot(400, 300);
  let calls = 0;
  const failing = async () => { calls++; throw new Error('decode failed'); };
  prewarmPreparedJpeg(p, [NATIVELY_API_JPEG], failing); // must not throw or leave an unhandled rejection
  await assert.rejects(preparedJpeg(p, NATIVELY_API_JPEG, failing), /decode failed/);
  await new Promise((r) => setImmediate(r));
  const { calls: ok, encode } = counting();
  await preparedJpeg(p, NATIVELY_API_JPEG, encode);
  assert.equal(ok.length, 1, 'retried after the failure');
});

test('a missing file rejects like an uncached encode (the callers fall back on it)', async () => {
  await assert.rejects(preparedJpeg(path.join(dir, 'gone.png'), NATIVELY_API_JPEG));
});

test('the real encoder makes the same bytes as the old inline sharp call', async () => {
  const p = await shot();
  const ours = await preparedJpeg(p, NATIVELY_API_JPEG);
  const before = await sharp(p).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  assert.ok(ours.equals(before));
  const meta = await sharp(ours).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(Math.max(meta.width, meta.height), 1920);
});

test('the cache stays bounded', async () => {
  const { calls, encode } = counting();
  const first = await shot(200, 100);
  await preparedJpeg(first, NATIVELY_API_JPEG, encode);
  for (let i = 0; i < 30; i++) await preparedJpeg(await shot(200, 100), NATIVELY_API_JPEG, encode);
  await preparedJpeg(first, NATIVELY_API_JPEG, encode);
  assert.equal(calls.length, 32, 'the oldest entry was dropped');
});

test('the real encoder reads the file\'s bytes, never opens it by path (Windows: a file libvips holds open cannot be deleted)', () => {
  const src = fs.readFileSync(path.join(root, 'electron/services/screen/preparedJpeg.ts'), 'utf8');
  const encoder = src.slice(src.indexOf('const encodeWithSharp'), src.indexOf('function keyFor'));
  assert.match(encoder, /sharp\(await fs\.promises\.readFile\(filePath\)\)/);
  assert.doesNotMatch(encoder, /sharp\(filePath\)/);
});
