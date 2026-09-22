// electron/llm/routing/__tests__/RouterSlotBudget2026_09_05.test.mjs
//
// With the ONNX concurrency cap exhausted (the embedder and reranker hold their
// slots for the session), the router's classify() used to await acquireOnnxSlot
// with no deadline, BEFORE the request timer was armed: the speculative turn
// blocked for as long as those sessions lived. A router that cannot get a slot
// inside its budget has no opinion, and the turn must proceed.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const load = (rel) => import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron', rel)).href);
const { acquireOnnxSlot, getMaxConcurrentOnnxSessions } = await load('utils/onnxThreadConfig.js');
const { RouterModel } = await load('llm/routing/RouterModel.js');

const held = [];
after(() => { for (const r of held) r(); RouterModel.resetForTests?.(); });

describe('router slot budget', () => {
  test('with every ONNX slot held, classify() returns null inside its budget instead of waiting', async () => {
    const cap = getMaxConcurrentOnnxSessions();
    for (let i = 0; i < cap; i++) held.push(await acquireOnnxSlot('normal', 1));
    process.env.NATIVELY_INTERACTION_ROUTER = '1';
    const router = RouterModel.getInstance();
    if (!router.isAvailable()) { delete process.env.NATIVELY_INTERACTION_ROUTER; return; } // model not downloaded on this checkout
    const t0 = Date.now();
    const r = await router.classify({ turn: 'mhm right right', mode: 'general', channel: 'system', history: [] }, { timeoutMs: 80 });
    const elapsed = Date.now() - t0;
    delete process.env.NATIVELY_INTERACTION_ROUTER;
    assert.equal(r, null, 'no slot in budget means no opinion');
    assert.ok(elapsed < 5500, `must give up within the load budget, took ${elapsed}ms`);
  });
});
