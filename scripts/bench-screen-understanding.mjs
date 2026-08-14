// Deterministic vision-first screen-understanding benchmark.
//
// What this measures (REAL work):
//   - ImageOptimizer Sharp pipeline across 4 screenshot sizes
//   - per-profile (fast / balanced / technical / best) duration and payload size
//   - cache hit latency (second pass with the same cacheKey)
//   - VisionProviderFallbackChain overhead with a near-instant fake provider
//
// What this DOES NOT measure:
//   - live LLM provider latency (would require API keys + quota)
//   - screenshot capture (Electron desktopCapturer)
//   - native OCR (intentionally removed from the runtime path)
//
// Output: JSON to stdout. Suitable for piping into
//   docs/testing/SCREEN_UNDERSTANDING_PERFORMANCE.md.

import { performance } from 'node:perf_hooks';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');
const iterations = Number.parseInt(process.env.SCREEN_UNDERSTANDING_BENCH_ITERATIONS || '5', 10);
process.env.NATIVELY_TEST_USER_DATA = process.env.NATIVELY_TEST_USER_DATA || os.tmpdir();

const { ImageOptimizer } = await import(pathToFileURL(path.join(screenDir, 'ImageOptimizer.js')).href);
const { runVisionFallback } = await import(pathToFileURL(path.join(screenDir, 'VisionProviderFallbackChain.js')).href);

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function round(n, digits = 2) {
  return Number(n.toFixed(digits));
}

// Build synthetic screenshots representative of the workloads Natively sees.
// We generate them on-disk once and re-use across iterations so the bench is
// dominated by the optimizer/chain work, not by fixture creation.
async function buildFixtures() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-screen-bench-'));
  const fixtures = [];

  const specs = [
    { name: '1080p document',  w: 1920, h: 1080, kind: 'text'  },
    { name: '1440p ui',        w: 2560, h: 1440, kind: 'ui'    },
    { name: '4K dashboard',    w: 3840, h: 2160, kind: 'mixed' },
    { name: 'retina coding',   w: 3024, h: 1964, kind: 'code'  },
  ];

  for (const spec of specs) {
    const out = path.join(dir, `${spec.name.replace(/\s+/g, '_')}.png`);
    // Synthesize a textured PNG so JPEG compression has something real to chew on.
    // A flat solid color compresses too well and gives misleading payload numbers.
    const size = spec.w * spec.h * 3;
    const raw = Buffer.allocUnsafe(size);
    for (let i = 0; i < size; i += 3) {
      raw[i]     = (i * 37) & 0xff;
      raw[i + 1] = (i * 53) & 0xff;
      raw[i + 2] = (i * 71) & 0xff;
    }
    await sharp(raw, { raw: { width: spec.w, height: spec.h, channels: 3 } })
      .png({ compressionLevel: 6 })
      .toFile(out);
    const stat = await fs.stat(out);
    fixtures.push({ ...spec, path: out, originalBytes: stat.size });
  }
  return { dir, fixtures };
}

async function benchOptimizer(fixtures) {
  const optimizer = new ImageOptimizer();
  const results = [];

  const profiles = ['fast', 'balanced', 'technical', 'best'];

  for (const fixture of fixtures) {
    for (const profile of profiles) {
      const durations = [];
      let lastOut;
      for (let i = 0; i < iterations; i++) {
        const started = performance.now();
        lastOut = await optimizer.optimize(fixture.path, {
          profile,
          provider: 'openai',
          cacheKey: `${fixture.name}|${i}`, // unique → never a cache hit
        });
        durations.push(performance.now() - started);
      }
      const cacheStart = performance.now();
      await optimizer.optimize(fixture.path, {
        profile,
        provider: 'openai',
        cacheKey: `${fixture.name}|hit`, // first pass writes the entry, second hits.
      });
      const cacheWriteMs = performance.now() - cacheStart;
      const hitStart = performance.now();
      await optimizer.optimize(fixture.path, {
        profile,
        provider: 'openai',
        cacheKey: `${fixture.name}|hit`,
      });
      const cacheHitMs = performance.now() - hitStart;

      results.push({
        fixture: fixture.name,
        size: `${fixture.w}x${fixture.h}`,
        originalBytes: fixture.originalBytes,
        profile,
        outputBytes: lastOut.byteSize,
        outputWidth: lastOut.width,
        outputHeight: lastOut.height,
        avgMs: round(durations.reduce((s, v) => s + v, 0) / durations.length),
        p50Ms: round(percentile(durations, 50)),
        p95Ms: round(percentile(durations, 95)),
        maxMs: round(Math.max(...durations)),
        cacheWriteMs: round(cacheWriteMs),
        cacheHitMs: round(cacheHitMs),
        reductionPct: round((1 - lastOut.byteSize / fixture.originalBytes) * 100, 1),
      });
    }
  }
  await optimizer.cleanupAll();
  return results;
}

async function benchChain(fixtures) {
  const optimizer = new ImageOptimizer();
  const fastFakeProvider = {
    id: 'bench-fake',
    displayName: 'Bench Fake',
    modelId: 'fake-vision-1',
    isLocal: true,
    isConfigured: true,
    supportsVision: true,
    scopeAllowsScreenshots: true,
    hint: 'generic',
    invoke: async () => 'ok',
  };

  const slowFakeProvider = {
    ...fastFakeProvider,
    id: 'bench-slow',
    invoke: async () => { throw new Error('500 simulated failure'); },
  };

  const out = [];
  for (const fixture of fixtures) {
    // 1. Single-provider best case (optimizer cache warm)
    const warmDurations = [];
    for (let i = 0; i < iterations; i++) {
      const started = performance.now();
      await runVisionFallback({
        imagePath: fixture.path,
        mode: 'vision_first',
        providers: [fastFakeProvider],
        systemPrompt: 'sys',
        userPrompt: 'user',
        optimizer,
        optimizationProfile: 'balanced',
        cacheKey: `chain-warm|${fixture.name}`,
      });
      warmDurations.push(performance.now() - started);
    }

    // 2. Fallback case — first provider fails, second wins
    const fallbackDurations = [];
    for (let i = 0; i < iterations; i++) {
      const started = performance.now();
      await runVisionFallback({
        imagePath: fixture.path,
        mode: 'vision_first',
        providers: [slowFakeProvider, fastFakeProvider],
        systemPrompt: 'sys',
        userPrompt: 'user',
        optimizer,
        optimizationProfile: 'balanced',
        cacheKey: `chain-fb|${fixture.name}`,
      });
      fallbackDurations.push(performance.now() - started);
    }

    out.push({
      fixture: fixture.name,
      size: `${fixture.w}x${fixture.h}`,
      warmAvgMs: round(warmDurations.reduce((s, v) => s + v, 0) / warmDurations.length),
      warmP95Ms: round(percentile(warmDurations, 95)),
      fallbackAvgMs: round(fallbackDurations.reduce((s, v) => s + v, 0) / fallbackDurations.length),
      fallbackP95Ms: round(percentile(fallbackDurations, 95)),
      fallbackOverheadVsWarmMs: round(
        (fallbackDurations.reduce((s, v) => s + v, 0) / fallbackDurations.length) -
        (warmDurations.reduce((s, v) => s + v, 0) / warmDurations.length),
      ),
    });
  }
  await optimizer.cleanupAll();
  return out;
}

async function main() {
  const { dir, fixtures } = await buildFixtures();
  try {
    const optimizer = await benchOptimizer(fixtures);
    const chain = await benchChain(fixtures);

    const summary = {
      timestamp: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      sharpVersion: sharp.versions?.sharp || 'unknown',
      iterationsPerSample: iterations,
      optimizer,
      chain,
      notes: [
        'Optimizer numbers are real Sharp work on synthetic textured PNGs (no flat-color compression bias).',
        'Chain numbers use a fake provider that returns instantly so the duration is dominated by Sharp + chain overhead, not LLM latency.',
        'Cache hit numbers are within-process — they prove the cache works but do not include disk-write latency that the first pass paid.',
      ],
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

await main();
