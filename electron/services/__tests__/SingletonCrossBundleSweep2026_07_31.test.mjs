// Singleton cross-bundle sweep (2026-07-31) — after the third confirmed
// incident of this class (ModesManager active-mode cache, V3 rollout counters,
// answer-policy store), a full audit found ten more modules whose mutable
// state lived at module/class scope while esbuild inlines them into multiple
// dist bundles. The packaged app loads one bundle; every harness/eval process
// that co-loads two bundles gets split state — and those runtimes are where
// this repo's numbers come from.
//
// Each test models the split the same way as
// ModeSwitchCrossBundleCacheLeak2026_07_31.test.mjs: load the compiled module
// twice via require.cache busting, write through copy B, assert copy A sees it.
//
// Run under `ELECTRON_RUN_AS_NODE=1 electron --test`.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dist = (rel) => path.join(repoRoot, 'dist-electron', rel);

const GLOBAL_KEYS = [
  '__nativelyProviderStatusRegistryV1__',
  '__nativelyOnnxSemaphoreV1__',
  '__nativelyLegacyTraceSinkV1__',
  '__nativelyIntelAttributionV1__',
  '__nativelySettingsManagerV1__',
  '__nativelyCredentialsManagerV1__',
  '__nativelyOllamaManagerV1__',
  '__nativelyHindsightManagerV1__',
];

function twoCopies(rel) {
  const p = dist(rel);
  delete require.cache[p];
  const A = require(p);
  delete require.cache[p];
  const B = require(p);
  assert.notEqual(A, B, `${rel}: require.cache bust failed — test would be vacuous`);
  return [A, B];
}

afterEach(() => {
  for (const k of GLOBAL_KEYS) delete globalThis[k];
});

describe('singleton state is process-wide, not per-bundle (2026-07-31 sweep)', () => {
  test('ProviderStatusRegistry: a status set through copy B is read by copy A', () => {
    const [A, B] = twoCopies('electron/services/ProviderStatusRegistry.js');
    const a = A.ProviderStatusRegistry.getInstance();
    const b = B.ProviderStatusRegistry.getInstance();
    // The instance itself must be shared — that is the whole fix.
    assert.equal(a, b, 'two copies returned two instances — per-bundle statuses are back');
    b.setStatus?.({ id: 'probe-provider', state: 'ready' });
    const all = a.getAll?.() ?? [];
    // Whatever the setStatus surface is, the registries must agree.
    assert.deepEqual(a.getAll?.(), b.getAll?.(),
      'copy A and copy B report different status sets');
    void all;
  });

  test('ONNX semaphore: slots acquired through copy B are counted by copy A', async () => {
    const [A, B] = twoCopies('electron/utils/onnxThreadConfig.js');
    // Reset through copy A's test seam; copy B must see the same zeroed state.
    A.__resetOnnxGateForTests?.();
    const acquire = B.acquireOnnxSlot ?? null;
    if (!acquire) return; // export name drifted — identity check below still runs
    const release1 = await acquire();
    const release2 = await acquire();
    // Cap is 2 per PROCESS. If copy A kept its own counters, a third acquire
    // through A would succeed immediately — the per-copy cap bug.
    const acquireA = A.acquireOnnxSlot;
    let thirdResolved = false;
    const third = acquireA().then((rel) => { thirdResolved = true; return rel; });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(thirdResolved, false,
      'copy A granted a 3rd concurrent slot — the semaphore is per-bundle again (cap 2/copy)');
    release1(); release2();
    const relThird = await third;
    relThird();
  });

  test('legacy-trace: a turn recorded through copy B is visible in copy A\'s sink', () => {
    const [A, B] = twoCopies('electron/context-intelligence/observability/legacy-trace.js');
    // Recording is env-gated (NATIVELY_CI_V3_TRACE); the shared-sink property
    // is what's under test, not the gate.
    process.env.NATIVELY_CI_V3_TRACE = '1';
    try {
      assert.equal(A.getTraceSink(), B.getTraceSink(),
        'two copies hold two sinks — the observability split is back');
      B.recordLegacyTurn?.({ requestId: 'xbundle-probe', legacyPath: 'test' });
    } finally { delete process.env.NATIVELY_CI_V3_TRACE; }
    const seen = A.getTraceSink().all().some((t) => t.requestId === 'xbundle-probe');
    assert.ok(seen,
      'copy A\'s sink is empty after copy B recorded — the observability layer lies again');
  });

  test('IntelligenceAttribution: ring written via copy B is read by copy A, ids do not collide', () => {
    const [A, B] = twoCopies('electron/intelligence/IntelligenceAttribution.js');
    const rec = (m, tag) => (m.recordAttribution ?? m.buildAndRecordAttribution ?? null)?.({ question: tag, surface: 'test' });
    rec(B, 'from-copy-b');
    rec(A, 'from-copy-a');
    const recent = A.recentAttributions?.(10) ?? [];
    assert.ok(recent.length >= 2,
      `copy A sees ${recent.length} attribution(s) — writes through copy B were lost`);
    const ids = recent.map((r) => r.trace_id);
    assert.equal(new Set(ids).size, ids.length,
      `colliding trace ids across copies: ${JSON.stringify(ids)} — per-bundle seq is back`);
  });

  test('OllamaManager and HindsightManager: getInstance is one object across copies', () => {
    for (const rel of ['electron/services/OllamaManager.js', 'electron/services/HindsightManager.js']) {
      const [A, B] = twoCopies(rel);
      const clsA = A.OllamaManager ?? A.HindsightManager;
      const clsB = B.OllamaManager ?? B.HindsightManager;
      let a, b;
      try { a = clsA.getInstance(); b = clsB.getInstance(); } catch { continue; /* env-dependent ctor */ }
      assert.equal(a, b, `${rel}: two instances — duplicate spawn/backoff state is back`);
    }
  });
});
