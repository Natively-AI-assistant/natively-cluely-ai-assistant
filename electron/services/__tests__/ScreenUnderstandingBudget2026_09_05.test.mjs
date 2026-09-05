// electron/services/__tests__/ScreenUnderstandingBudget2026_09_05.test.mjs
//
// The screen-understanding pre-pass had no wall-clock bound and no working
// cancellation, so a single unresponsive provider decided how long the user
// waited before their answer even started.
//
// From natively_debug (3).log (v2.8.8, 33 screenshot turns): 31 of 33 turns —
// 100% of the non-cached ones — logged
//
//     [NativelyAPI] JSON pre-response failure … timeoutMs:8000 durationMs:8009
//
// and `generate-what-to-say` awaits this whole thing before opening the answer
// stream, so that was 8.0s of dead latency on every turn, ~4.1 minutes across
// the session, for a structured extraction the turn never received.
//
// Three defects met there:
//
//  1. VisionProviderRegistry's hand-off into LLMHelper DROPPED both the chain's
//     AbortSignal and its budget, so `perProviderTimeoutMs` (12s) was inert and
//     whatever inner deadline the provider method happened to hold became the
//     real one — for the Natively rung, an 8s default written for cheap TEXT
//     calls, whose own comment says it is "far too short" for a dense
//     extraction.
//  2. `totalDeadlineMs` was checked only BETWEEN rungs, so it could not bound a
//     single overrunning attempt — and nothing passed it anyway.
//  3. The chain's attempt ledger went only to an optional telemetry callback
//     that this caller never supplied, so a debug log showed the failure with
//     no way to tell a SKIPPED rung from a tried-and-failed one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Module, { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');

const { runVisionFallback } = await import(
  pathToFileURL(path.join(screenDir, 'VisionProviderFallbackChain.js')).href
);

let fixturePath;
async function ensureFixture() {
  if (fixturePath) return fixturePath;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sur-budget-test-'));
  fixturePath = path.join(dir, 'tiny.png');
  const png = Buffer.from(
    '89504E470D0A1A0A0000000D49484452000000010000000108020000009077' +
    '53DE0000000C4944415478DA6364F800000200010001ACFCC8AF0000000049' +
    '454E44AE426082',
    'hex',
  );
  await fs.writeFile(fixturePath, png);
  return fixturePath;
}

function rung(id, invoke, over = {}) {
  return {
    id,
    displayName: id,
    modelId: `${id}-model`,
    isLocal: false,
    isConfigured: true,
    supportsVision: true,
    scopeAllowsScreenshots: true,
    hint: 'openai',
    invoke,
    ...over,
  };
}

describe('the vision chain hands its budget and cancellation to the provider', () => {
  test('invoke() receives BOTH the abort signal and the attempt budget', async () => {
    const imagePath = await ensureFixture();
    let seen = null;
    await runVisionFallback({
      imagePath,
      mode: 'vision_first',
      systemPrompt: 's',
      userPrompt: 'u',
      perProviderTimeoutMs: 4321,
      providers: [rung('p1', async (params) => {
        seen = { hasSignal: params.signal instanceof AbortSignal, timeoutMs: params.timeoutMs };
        return 'ok';
      })],
    });
    assert.ok(seen, 'invoke was never called');
    assert.equal(seen.hasSignal, true, 'the per-attempt AbortSignal must reach the provider');
    // Without this, a provider holding its own inner deadline silently overrides
    // the chain — the exact shape of the 8s-vs-12s defect.
    assert.equal(seen.timeoutMs, 4321, 'the attempt budget must reach the provider');
  });

  test('a provider that ignores the signal is still cut off at the budget', async () => {
    const imagePath = await ensureFixture();
    const started = Date.now();
    const res = await runVisionFallback({
      imagePath,
      mode: 'vision_first',
      systemPrompt: 's',
      userPrompt: 'u',
      perProviderTimeoutMs: 200,
      providers: [rung('slow', (params) => new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve('too late'), 5000);
        params.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('per-provider-timeout')); }, { once: true });
      }))],
    });
    assert.equal(res.ok, false);
    assert.equal(res.attempts[0].errorClass, 'timeout');
    assert.ok(Date.now() - started < 2000, 'must abort near the 200ms budget');
  });
});

describe('totalDeadlineMs bounds the WHOLE pre-pass, not just the gaps between rungs', () => {
  test('one overrunning rung cannot spend more than the total budget', async () => {
    const imagePath = await ensureFixture();
    const started = Date.now();
    const res = await runVisionFallback({
      imagePath,
      mode: 'vision_first',
      systemPrompt: 's',
      userPrompt: 'u',
      // Per-provider is deliberately far LARGER than the total: before the fix
      // the attempt armed its controller with 10s and the total was only
      // consulted after it returned, so the pre-pass ran ~10s on a 500ms budget.
      perProviderTimeoutMs: 10_000,
      totalDeadlineMs: 500,
      providers: [rung('hog', (params) => new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve('too late'), 10_000);
        params.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('per-provider-timeout')); }, { once: true });
      }))],
    });
    const elapsed = Date.now() - started;
    assert.equal(res.ok, false);
    assert.ok(elapsed < 3000, `pre-pass must respect the 500ms total budget, took ${elapsed}ms`);
  });

  test('a dead FIRST rung cannot starve the rung behind it', async () => {
    // Regression on the fix for the fix: adding totalDeadlineMs alone let the
    // leading rung consume all of it, and the ledger read `custom:timeout(0ms)`
    // — the user's own selected provider reached and handed nothing. That would
    // have silently cancelled out 3e29a67f, whose point was to reach it at all.
    const imagePath = await ensureFixture();
    let secondRungBudget = null;
    const res = await runVisionFallback({
      imagePath,
      mode: 'vision_first',
      systemPrompt: 's',
      userPrompt: 'u',
      perProviderTimeoutMs: 12_000,
      totalDeadlineMs: 1000,
      providers: [
        rung('dead', (params) => new Promise((_r, reject) => {
          params.signal.addEventListener('abort', () => reject(new Error('per-provider-timeout')), { once: true });
        })),
        rung('the-users-own-provider', async (params) => {
          secondRungBudget = params.timeoutMs;
          return 'a description of the screen';
        }),
      ],
    });
    assert.equal(res.attempts[0].errorClass, 'timeout', 'the first rung should still have timed out');
    assert.ok(secondRungBudget !== null, 'the second rung was never invoked at all');
    assert.ok(secondRungBudget > 100,
      `the second rung got ${secondRungBudget}ms — a leading rung must not eat the whole budget`);
    assert.equal(res.ok, true, 'the chain should still succeed on the second rung');
    assert.equal(res.providerUsed, 'the-users-own-provider');
  });

  test('with no rung behind it, a single rung may use the whole budget', async () => {
    // The share cap is about protecting LATER rungs; it must not shrink the
    // budget when there is nothing to protect.
    const imagePath = await ensureFixture();
    let onlyRungBudget = null;
    await runVisionFallback({
      imagePath,
      mode: 'vision_first',
      systemPrompt: 's',
      userPrompt: 'u',
      perProviderTimeoutMs: 12_000,
      totalDeadlineMs: 5000,
      providers: [rung('only', async (params) => { onlyRungBudget = params.timeoutMs; return 'ok'; })],
    });
    assert.ok(onlyRungBudget >= 4000,
      `a sole rung should get ~the whole budget, got ${onlyRungBudget}ms`);
  });

  test('a healthy fast rung inside the budget is unaffected', async () => {
    const imagePath = await ensureFixture();
    const res = await runVisionFallback({
      imagePath,
      mode: 'vision_first',
      systemPrompt: 's',
      userPrompt: 'u',
      perProviderTimeoutMs: 10_000,
      totalDeadlineMs: 6000,
      providers: [rung('fast', async () => 'a description of the screen')],
    });
    assert.equal(res.ok, true);
    assert.equal(res.outputText, 'a description of the screen');
    assert.equal(res.providerUsed, 'fast');
  });
});

describe('the pre-pass budget is a named, bounded constant', () => {
  test('ScreenUnderstandingService exports a total budget and it is well under the per-provider default', async () => {
    // The service transitively pulls in CredentialsManager, which evaluates
    // app.getPath('userData') at module load. That is unavailable under plain
    // `node --test` AND under ELECTRON_RUN_AS_NODE, so stub the module before
    // importing rather than skipping — the constant is the contract this test
    // exists to pin.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sur-budget-userdata-'));
    process.env.NATIVELY_TEST_USER_DATA = tmp;
    const cjs = createRequire(path.join(root, 'package.json'));
    const stub = new Module('electron');
    stub.exports = {
      app: { isReady: () => true, getPath: (n) => (n === 'userData' ? tmp : os.tmpdir()), getName: () => 'natively-test', getVersion: () => '0.0.0-test', isPackaged: false },
      shell: { openPath: async () => '' },
      safeStorage: { isEncryptionAvailable: () => false },
      ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {} },
      BrowserWindow: { getAllWindows: () => [] },
      desktopCapturer: { getSources: async () => [] },
    };
    stub.loaded = true;
    cjs.cache[cjs.resolve('electron')] = stub;

    const mod = cjs(path.join(screenDir, 'ScreenUnderstandingService.js'));
    const budget = mod.SCREEN_UNDERSTANDING_TOTAL_BUDGET_MS;
    assert.equal(typeof budget, 'number');
    assert.ok(budget > 0 && budget <= 8000,
      `the pre-pass sits on the critical path before the answer stream opens; `
      + `${budget}ms is too much to add to time-to-first-token`);
  });
});
