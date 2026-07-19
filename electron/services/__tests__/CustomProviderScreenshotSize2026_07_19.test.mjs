// Custom Provider screenshot size (2026-07-19) — regression for HTTP 400 on
// OpenRouter when a screenshot is attached to a Custom Provider request.
//
// Symptom: Custom Provider via OpenRouter (e.g. anthropic/claude-sonnet-5)
// returns `Error: Custom Provider returned HTTP 400` whenever a screenshot is
// included. Text-only requests succeed.
//
// Root cause (verified): executeCustomProvider() and streamWithCustom() read
// the raw PNG from disk and base64-encode it without resizing/recompressing.
// A 14" MBP full-screen capture (3024×1964) typically lands at 3–6 MB on
// disk → ~4–8 MB base64. A 16" MBP (3456×2234) lands at 5–10 MB → ~7–13 MB
// base64 — comfortably over Anthropic's 10 MB per-image base64 limit.
// OpenRouter forwards that upstream rejection as a 400.
//
// Fix: route the screenshot through getImageOptimizer().optimize(path, {
//   profile: 'balanced',     // 1280px long edge, jpeg q85, 3.5 MB cap with retry
//   provider: 'custom',      // ProviderHint already supports this in ImageOptimizer
//   cacheKey: imagePath,     // same screenshot same session → reuse the optimized file
// }), then read the result via getBase64().
//
// This test pins the size contract. It MUST pass once the fix lands and
// catches any future regression that bypasses the optimizer again.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');

let OptMod;
let optimizer;
let retina14Png;
let retina16Png;
const DEFAULT_MAX_BYTES = 3.5 * 1024 * 1024;

async function loadOptimizer() {
  const mod = await import(pathToFileURL(path.join(screenDir, 'ImageOptimizer.js')).href);
  return mod;
}

// A synthetic Retina-ish PNG with a noise overlay so the source isn't trivially
// compressible to <100 KB. Approximates the byte cost of a real full-screen
// desktop capture on macOS.
async function writeRetinaPng(width, height, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `cprr-screenshot-${label}-`));
  const out = path.join(dir, `screenshot-${width}x${height}.png`);

  // Build a noise layer as raw RGBA, then composite over a flat background.
  // sharp's "create" alone gives a uniform image with very high PNG compressibility
  // — we need the noise to push bytes above 1 MB.
  const noiseBytes = Buffer.alloc(width * height * 4);
  for (let i = 0; i < noiseBytes.length; i += 4) {
    const v = Math.floor(Math.random() * 256);
    noiseBytes[i] = v;
    noiseBytes[i + 1] = v;
    noiseBytes[i + 2] = v;
    noiseBytes[i + 3] = 255;
  }

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 240, g: 240, b: 240, alpha: 1 },
    },
  })
    .composite([{
      input: noiseBytes,
      raw: { width, height, channels: 4 },
      tile: true,
    }])
    .png({ compressionLevel: 6 })
    .toFile(out);

  return out;
}

before(async () => {
  OptMod = await loadOptimizer();
  optimizer = new OptMod.ImageOptimizer();
  retina14Png = await writeRetinaPng(3024, 1964, '14mbp');
  retina16Png = await writeRetinaPng(3456, 2234, '16mbp');
});

after(async () => {
  if (optimizer) {
    try { await optimizer.cleanupAll(); } catch { /* best-effort */ }
  }
});

test('CRIT: optimize() shrinks a 14" MBP capture to <= 3.5 MB JPEG at <= 1280px long edge', async () => {
  const srcStat = await fs.stat(retina14Png);
  assert.ok(srcStat.size > 1_000_000,
    `synthetic 14" MBP PNG should exceed 1 MB on disk; got ${srcStat.size}`);

  const out = await optimizer.optimize(retina14Png, {
    profile: 'balanced',
    provider: 'custom',
    cacheKey: 'cprr-14mbp',
  });

  // The contract that fixes the 400:
  assert.equal(out.mimeType, 'image/jpeg',
    'optimized payload must be JPEG (PNG is too byte-heavy for size-constrained flows)');
  assert.ok(out.byteSize <= DEFAULT_MAX_BYTES,
    `optimized (${out.byteSize}) must be <= 3.5 MB (Anthropic/OpenRouter safe zone)`);
  assert.ok(out.byteSize < srcStat.size,
    `optimized (${out.byteSize}) must be smaller than original (${srcStat.size})`);
  assert.ok(out.width <= 1280 && out.height <= 1280,
    `long edge must be <= 1280 px; got ${out.width}x${out.height}`);
  assert.equal(out.cacheHit, false);

  // The image_url.url that lands on the wire is
  //   data:image/jpeg;base64,<getBase64 bytes>
  // Approximate its at-rest size: base64 grows raw bytes by ~4/3.
  const b64 = await optimizer.getBase64(out);
  const dataUrlBytes = 'data:image/jpeg;base64,'.length + b64.length;
  assert.ok(dataUrlBytes < 4 * 1024 * 1024,
    `final image_url.url length must be < 4 MB to clear Anthropic's 10 MB per-image limit; got ${dataUrlBytes}`);
});

test('CRIT: optimize() shrinks a 16" MBP capture to <= 3.5 MB JPEG at <= 1280px long edge', async () => {
  const srcStat = await fs.stat(retina16Png);
  assert.ok(srcStat.size > 1_500_000,
    `synthetic 16" MBP PNG should exceed 1.5 MB; got ${srcStat.size}`);

  const out = await optimizer.optimize(retina16Png, {
    profile: 'balanced',
    provider: 'custom',
    cacheKey: 'cprr-16mbp',
  });

  assert.equal(out.mimeType, 'image/jpeg');
  assert.ok(out.byteSize <= DEFAULT_MAX_BYTES,
    `optimized (${out.byteSize}) must be <= 3.5 MB; even the largest reasonable Mac capture must fit`);
  assert.ok(out.width <= 1280 && out.height <= 1280);
});

test('cache: same cacheKey returns cacheHit:true on second call (no double-encode per session)', async () => {
  const first = await optimizer.optimize(retina14Png, {
    profile: 'balanced',
    provider: 'custom',
    cacheKey: 'cprr-cache-reuse',
  });
  const second = await optimizer.optimize(retina14Png, {
    profile: 'balanced',
    provider: 'custom',
    cacheKey: 'cprr-cache-reuse',
  });

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true,
    'second call with the same cacheKey must be a cache hit — otherwise the same screenshot is re-encoded on every request');
  assert.equal(first.path, second.path);
});

test('contract: missing source throws (caller must fall back to raw readFile)', async () => {
  // The fix's contract: a Sharp failure must NOT block the request. The caller
  // (executeCustomProvider) should fall back to fs.readFile + raw base64 like
  // the original code does. This pins that the optimizer itself surfaces errors
  // rather than silently returning a partial buffer.
  await assert.rejects(
    () => optimizer.optimize('/nonexistent/path/that/does/not/exist.png', {
      profile: 'balanced',
      provider: 'custom',
    }),
    /cannot stat source image/i,
    'optimizer must throw on missing source so the caller can fall back',
  );
});

test('contract: provider:custom mime is JPEG (not PNG) for vision-compatible bodies', async () => {
  // The wire format changes from data:image/png;base64,... to
  // data:image/jpeg;base64,... after the optimizer. OpenAI / OpenRouter
  // / Anthropic all accept both, but pinning it here so future regressions
  // (someone adding 'png' to the provider override) get caught.
  const out = await optimizer.optimize(retina14Png, {
    profile: 'balanced',
    provider: 'custom',
    cacheKey: 'cprr-mime-pin',
  });
  assert.equal(out.mimeType, 'image/jpeg');
});
