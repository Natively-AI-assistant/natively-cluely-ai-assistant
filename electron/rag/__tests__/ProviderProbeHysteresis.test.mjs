// electron/rag/__tests__/ProviderProbeHysteresis.test.mjs
//
// MEDIUM fix: cloud provider probes get a bounded retry before demotion, so a
// single transient isAvailable() failure (429 / timeout / network blip) does NOT
// switch the active embedding provider — which would change the embedding SPACE,
// persist it, and trigger a full billed corpus re-index that reverts next launch.
//
// Local/Ollama probes are NOT retried (cheap + deterministic). We verify the
// observable retry behavior via the real compiled EmbeddingProviderResolver's
// private probeAvailable (accessed by name — it's a static on the class).
//
// Pure logic (no sqlite) — runs under plain node OR electron.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/EmbeddingProviderResolver.js');
const { EmbeddingProviderResolver } = await import(pathToFileURL(modPath).href);

// Reach the private static (compiled JS exposes it on the class object).
const probeAvailable = EmbeddingProviderResolver['probeAvailable'].bind(EmbeddingProviderResolver);

function fakeProvider(name, availabilitySequence) {
  let i = 0;
  let calls = 0;
  return {
    name,
    dimensions: 768,
    space: `${name}:m:768`,
    calls: () => calls,
    isAvailable: async () => {
      calls++;
      const v = availabilitySequence[Math.min(i, availabilitySequence.length - 1)];
      i++;
      return v;
    },
    embed: async () => [],
    embedQuery: async () => [],
    embedBatch: async () => [],
  };
}

describe('EmbeddingProviderResolver.probeAvailable — cloud hysteresis', () => {
  test('cloud provider that fails once then succeeds is considered AVAILABLE (no demotion)', async () => {
    const gemini = fakeProvider('gemini', [false, true]);
    const ok = await probeAvailable(gemini);
    assert.equal(ok, true, 'transient first-probe failure must not demote a cloud provider');
    assert.ok(gemini.calls() >= 2, 'should have retried at least once');
  });

  test('cloud provider that fails ALL attempts is unavailable (genuinely down)', async () => {
    const gemini = fakeProvider('gemini', [false]);
    const ok = await probeAvailable(gemini);
    assert.equal(ok, false, 'a persistently-failing cloud provider is correctly unavailable');
    assert.equal(gemini.calls(), 3, 'cloud retries exactly CLOUD_PROBE_ATTEMPTS times');
  });

  test('cloud provider available on first try → no extra probes (fast path)', async () => {
    const openai = fakeProvider('openai', [true]);
    const ok = await probeAvailable(openai);
    assert.equal(ok, true);
    assert.equal(openai.calls(), 1, 'no wasted retries when first probe succeeds');
  });

  test('NON-cloud (local) provider is probed exactly once — no retry', async () => {
    const local = fakeProvider('local', [false]);
    const ok = await probeAvailable(local);
    assert.equal(ok, false);
    assert.equal(local.calls(), 1, 'local/ollama probes are cheap+deterministic — never retried');
  });

  test('ollama (non-cloud) probed once', async () => {
    const ollama = fakeProvider('ollama', [false]);
    await probeAvailable(ollama);
    assert.equal(ollama.calls(), 1);
  });
});
