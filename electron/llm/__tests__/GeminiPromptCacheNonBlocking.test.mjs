// electron/llm/__tests__/GeminiPromptCacheNonBlocking.test.mjs
//
// Perf regression: getCachedOrWarmInBackground must NEVER block on caches.create.
// A cache MISS returns null synchronously and kicks off the create in the
// background; a subsequent HIT returns the name synchronously. This is the fix
// for "first token blocked 2.4s on inline caches.create".

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { GeminiPromptCache } from '../../../dist-electron/electron/llm/GeminiPromptCache.js';

// A fake client whose caches.create resolves only when WE allow it, so we can
// prove the call returns BEFORE create resolves (i.e. it didn't await).
function makeSlowClient() {
  let resolveCreate;
  const createStarted = { value: false };
  const client = {
    caches: {
      create: async () => {
        createStarted.value = true;
        await new Promise((r) => { resolveCreate = r; });
        return { name: 'cachedContents/test123' };
      },
    },
  };
  return { client, createStarted, finishCreate: () => resolveCreate?.({ name: 'cachedContents/test123' }) };
}

const BIG_PROMPT = 'x'.repeat(20000); // well above MIN_PROMPT_CHARS

describe('GeminiPromptCache.getCachedOrWarmInBackground', () => {
  test('returns null SYNCHRONOUSLY on a miss (does not await create)', () => {
    const cache = new GeminiPromptCache();
    const { client, createStarted } = makeSlowClient();
    const result = cache.getCachedOrWarmInBackground(client, 'gemini-3.6-flash', BIG_PROMPT);
    // Synchronous return value is null (miss) — even though create hasn't resolved.
    assert.equal(result, null);
    // The background create was kicked off (started) but we did NOT wait for it.
    assert.equal(createStarted.value, true, 'create should have started in background');
  });

  test('returns the cached name on a subsequent HIT after the background create resolves', async () => {
    const cache = new GeminiPromptCache();
    const { client, finishCreate } = makeSlowClient();
    // First call: miss → null, warms in background.
    assert.equal(cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT), null);
    // Let the background create finish.
    finishCreate();
    await new Promise((r) => setTimeout(r, 10));
    // Second call: hit → synchronous name.
    const second = cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT);
    assert.equal(second, 'cachedContents/test123');
  });

  test('does not start a second create while one is in-flight for the same key', () => {
    const cache = new GeminiPromptCache();
    let createCount = 0;
    const client = { caches: { create: async () => { createCount++; await new Promise(() => {}); } } };
    cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT);
    cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT);
    cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT);
    assert.equal(createCount, 1, 'concurrent calls must dedupe to one create');
  });

  test('returns null for a prompt below the minimum (no create attempted)', () => {
    const cache = new GeminiPromptCache();
    let createCount = 0;
    const client = { caches: { create: async () => { createCount++; return { name: 'x' }; } } };
    const result = cache.getCachedOrWarmInBackground(client, 'm', 'too small');
    assert.equal(result, null);
    assert.equal(createCount, 0, 'must not attempt to cache a tiny prompt');
  });

  test('a failed background create does not throw to the caller', async () => {
    const cache = new GeminiPromptCache();
    const client = { caches: { create: async () => { throw new Error('403 billing'); } } };
    // Must not throw synchronously.
    assert.doesNotThrow(() => cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT));
    // Let the rejected promise settle; the .catch in the impl swallows it.
    await new Promise((r) => setTimeout(r, 10));
    // Next call is still null (sentinel cooldown), still no throw.
    assert.equal(cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT), null);
  });
});

