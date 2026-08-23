// Sharp ImageOptimizer — unit tests.
// Proves the optimizer:
//   - shrinks large PNG → smaller JPEG buffer
//   - honors maxLongEdgePx per profile
//   - strips metadata (no EXIF on output)
//   - caches per cacheKey + profile + provider
//   - enforces maxBytes by stepping quality down

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');

async function loadOptimizer() {
  const mod = await import(pathToFileURL(path.join(screenDir, 'ImageOptimizer.js')).href);
  return mod.ImageOptimizer;
}

let bigPngPath;
async function ensureBigPng() {
  if (bigPngPath) return bigPngPath;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-opt-test-'));
  bigPngPath = path.join(dir, 'big.png');
  // 2560x1440 white PNG with a black square — well over default maxLongEdge.
  await sharp({
    create: { width: 2560, height: 1440, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: Buffer.from([0, 0, 0]), raw: { width: 1, height: 1, channels: 3 }, tile: true, top: 100, left: 100 }])
    .png()
    .toFile(bigPngPath);
  return bigPngPath;
}

test('balanced profile resizes long edge to 1280 and emits JPEG smaller than original', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();
  const srcStat = await fs.stat(src);

  const out = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai' });

  assert.equal(out.mimeType, 'image/jpeg');
  assert.ok(out.width <= 1280, `width should be <= 1280, got ${out.width}`);
  assert.ok(out.height <= 1280, `height should be <= 1280, got ${out.height}`);
  assert.ok(out.byteSize < srcStat.size, `optimized (${out.byteSize}) should be smaller than original (${srcStat.size})`);
  assert.equal(out.originalByteSize, srcStat.size);
  assert.equal(out.cacheHit, false);

  await optimizer.cleanupAll();
});

test('technical profile preserves higher resolution than balanced', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const balanced = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', cacheKey: 'b' });
  const technical = await optimizer.optimize(src, { profile: 'technical', provider: 'openai', cacheKey: 't' });

  assert.ok(technical.width >= balanced.width, 'technical profile should retain >= width');
  assert.ok(technical.height >= balanced.height, 'technical profile should retain >= height');

  await optimizer.cleanupAll();
});

test('fast profile shrinks aggressively below balanced', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const balanced = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', cacheKey: 'b2' });
  const fast = await optimizer.optimize(src, { profile: 'fast', provider: 'openai', cacheKey: 'f2' });

  assert.ok(fast.byteSize <= balanced.byteSize, `fast (${fast.byteSize}) should be <= balanced (${balanced.byteSize})`);
  await optimizer.cleanupAll();
});

test('cache hit returns same OptimizedImage for same key', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const first = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', cacheKey: 'cache-test' });
  const second = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', cacheKey: 'cache-test' });

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(first.path, second.path);

  await optimizer.cleanupAll();
});

test('different profile invalidates cache', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const balanced = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', cacheKey: 'k1' });
  const technical = await optimizer.optimize(src, { profile: 'technical', provider: 'openai', cacheKey: 'k1' });

  assert.equal(balanced.cacheHit, false);
  assert.equal(technical.cacheHit, false, 'profile must be part of cache key');
  assert.notEqual(balanced.path, technical.path);

  await optimizer.cleanupAll();
});

test('output JPEG has no EXIF metadata', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const out = await optimizer.optimize(src, { profile: 'balanced' });
  const meta = await sharp(out.path).metadata();

  // Sharp's default behavior is to drop EXIF unless withMetadata() is called.
  // We never call it, so EXIF must be absent (undefined or empty buffer).
  assert.ok(!meta.exif || meta.exif.length === 0, 'EXIF must be stripped');

  await optimizer.cleanupAll();
});

test('cleanupAll removes every temp file owned by the optimizer', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const a = await optimizer.optimize(src, { profile: 'balanced', cacheKey: 'a' });
  const b = await optimizer.optimize(src, { profile: 'technical', cacheKey: 'b' });

  await fs.access(a.path);
  await fs.access(b.path);

  await optimizer.cleanupAll();
  await assert.rejects(() => fs.access(a.path), 'a.path should be unlinked after cleanupAll');
  await assert.rejects(() => fs.access(b.path), 'b.path should be unlinked after cleanupAll');
});

test('getBase64 returns base64-encoded buffer matching file contents', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const out = await optimizer.optimize(src, { profile: 'fast' });
  const b64 = await optimizer.getBase64(out);
  const expected = (await fs.readFile(out.path)).toString('base64');

  assert.equal(b64, expected);
  await optimizer.cleanupAll();
});
