// Regression test for the "Screen Recording Permission Denied" banner appearing
// even when the user has granted permission (false-positive on packaged builds).
//
// Root cause: 6+ independent call sites (meeting start, system audio pipeline
// setup, resume-capture, audio reconfigure, system-audio recovery, default-output
// route change) each independently call resolveMacScreenCaptureCapability() with
// no shared cache or coordination. This has two failure modes:
//
// 1. macOS TCC staleness: Screen Recording permission grants (unlike mic/camera)
//    often do NOT immediately update the in-process cache when granted via System
//    Settings while the app is running. Both systemPreferences.getMediaAccessStatus()
//    and desktopCapturer.getSources() can remain stale until a full app restart.
//    Without a cache, each call site re-queries the stale OS state and floods the
//    user with banners.
//
// 2. Call-site disagreement: Even without OS staleness, the 6 call sites can
//    race each other moment-to-moment — one sees 'granted', another (milliseconds
//    later) sees 'denied', causing the banner to flap on/off unpredictably.
//
// Fix: lightweight TTL cache (3s) so all call sites within a single meeting-start
// sequence share the same result. TTL is short enough that a user who grants
// permission and returns to the app sees a fresh check within moments, but long
// enough that the 6 call sites can't disagree.
//
// Strategy: structural assertions against main.ts source to verify the cache
// wiring exists and is respected by resolveMacScreenCaptureCapability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

test('main.ts declares screenCapabilityCache with TTL constant', () => {
  assert.ok(
    /let\s+screenCapabilityCache\s*:\s*CachedCapability\s*\|\s*null\s*=\s*null/.test(mainSource),
    'BUG: main.ts must declare `let screenCapabilityCache: CachedCapability | null = null` to cache screen recording capability checks.',
  );
  assert.ok(
    /const\s+SCREEN_CAPABILITY_CACHE_TTL_MS\s*=\s*\d+/.test(mainSource),
    'BUG: main.ts must declare SCREEN_CAPABILITY_CACHE_TTL_MS constant for cache lifetime.',
  );
});

test('resolveMacScreenCaptureCapability checks cache before re-querying TCC', () => {
  // Extract the function body
  const fnMatch = /async\s+function\s+resolveMacScreenCaptureCapability\s*\([^)]*\)\s*(?::[^{]*)?\s*\{/;
  const m = fnMatch.exec(mainSource);
  assert.ok(m, 'could not locate resolveMacScreenCaptureCapability in main.ts');
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, 'unbalanced braces in resolveMacScreenCaptureCapability');
  const fnBody = mainSource.slice(start, i - 1);

  // Check for cache lookup early in the function
  assert.ok(
    /if\s*\(\s*!options\?\.bypassCache\s*&&\s*screenCapabilityCache\s*\)/.test(fnBody),
    'BUG: resolveMacScreenCaptureCapability must check screenCapabilityCache early (unless bypassCache option is set).',
  );
  assert.ok(
    /Date\.now\(\)\s*-\s*screenCapabilityCache\.timestamp/.test(fnBody),
    'BUG: cache age must be computed using Date.now() - screenCapabilityCache.timestamp.',
  );
  assert.ok(
    /if\s*\(\s*age\s*<\s*SCREEN_CAPABILITY_CACHE_TTL_MS\s*\)/.test(fnBody),
    'BUG: cache hit must compare age < SCREEN_CAPABILITY_CACHE_TTL_MS.',
  );
});

test('resolveMacScreenCaptureCapability updates cache on every code path', () => {
  const fnMatch = /async\s+function\s+resolveMacScreenCaptureCapability\s*\([^)]*\)\s*(?::[^{]*)?\s*\{/;
  const m = fnMatch.exec(mainSource);
  assert.ok(m, 'could not locate resolveMacScreenCaptureCapability in main.ts');
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  const fnBody = mainSource.slice(start, i - 1);

  // All return paths must update the cache (except the early cache-hit return)
  const cacheUpdates = (fnBody.match(/screenCapabilityCache\s*=\s*\{/g) || []).length;
  // Expected: at least 5 cache updates (dev-bypass, restricted, granted, probe success, probe fail)
  assert.ok(
    cacheUpdates >= 5,
    `BUG: resolveMacScreenCaptureCapability must update screenCapabilityCache on all code paths. Found ${cacheUpdates} updates, expected >= 5.`,
  );
});

test('resolveMacScreenCaptureCapability accepts optional bypassCache parameter', () => {
  const fnMatch = /async\s+function\s+resolveMacScreenCaptureCapability\s*\([^)]*\)/;
  const m = fnMatch.exec(mainSource);
  assert.ok(m, 'could not locate resolveMacScreenCaptureCapability signature');
  const signature = m[0];

  // Should accept an options parameter with optional bypassCache
  assert.ok(
    /options\?\s*:\s*\{\s*bypassCache\?\s*:\s*boolean\s*\}/.test(signature),
    'BUG: resolveMacScreenCaptureCapability should accept optional { bypassCache?: boolean } parameter to force fresh check.',
  );
});
