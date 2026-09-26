// electron/llm/__tests__/PerformanceSettingsPartials2026_09_25.test.mjs
//
// The Settings → Intelligence → Provider performance controls that an audit on
// 2026-09-25 found only half-working. Each test is written against the REAL
// compiled module and pins a behaviour the user can see:
//
//   • A calibration run that got NO answer must not lock the button for 24h.
//   • A second press while a run is in flight must send nothing.
//   • The ladder must size itself from the model registry — LLMHelper has no
//     getModelContextWindowTokens, so it used to run a single rung.
//   • A definite image-probe verdict must be KEPT as the model's vision fact.
//   • "Forget all measurements" must also clear the calibration cooldown, the
//     capability seeding and the late-stream tallies, not only the store.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../dist-electron/electron/llm/performance/index.js');
const {
  runCalibration, __resetCalibrationCooldowns, ProviderPerformanceStore, laddersFor,
  forgetPerformanceEvidence, __setProviderPerformanceStore, performanceHooks,
  recordSecondaryStream, secondaryStreamTallies, readCapabilityFacts,
} = M;

const FLAGS = ['NATIVELY_PROVIDER_CALIBRATION', 'NATIVELY_CAPABILITY_PROBE'];

/** A provider stand-in that counts requests; `reply` may be a function of the prompt. */
function helper(opts = {}) {
  const calls = [];
  return {
    calls,
    performanceIdentity: (hasImages) => ({
      providerId: opts.providerId ?? 'gemini',
      modelId: opts.modelId ?? 'gemini-2.5-flash',
      route: hasImages ? 'vision' : 'default_provider',
      isOllama: false,
    }),
    ...(opts.contextWindow != null ? { getModelContextWindowTokens: () => opts.contextWindow } : {}),
    streamChat: async function* (prompt, imagePaths) {
      calls.push({ image: Boolean(imagePaths && imagePaths.length) });
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.throwWith) throw opts.throwWith;
      yield typeof opts.reply === 'function' ? opts.reply(prompt, imagePaths) : (opts.reply ?? 'OK');
    },
  };
}

const freshStore = () => new ProviderPerformanceStore({ ephemeral: true });

beforeEach(() => {
  __resetCalibrationCooldowns();
  for (const v of FLAGS) delete process.env[v];
});
afterEach(() => {
  for (const v of FLAGS) delete process.env[v];
});

describe('calibration cooldown', () => {
  test('a run where every request failed does NOT start the 24h cooldown', async () => {
    process.env.NATIVELY_PROVIDER_CALIBRATION = '1';
    const h = helper({ throwWith: Object.assign(new Error('offline'), { code: 'ENOTFOUND' }) });
    const store = freshStore();
    const first = await runCalibration(h, { store, networkProfileId: 'n' });
    assert.ok(first.requestsIssued > 0);
    assert.ok(first.rungs.every((r) => !r.ok), 'precondition: nothing succeeded');
    const before = h.calls.length;
    const second = await runCalibration(h, { store, networkProfileId: 'n' });
    assert.notEqual(second.skippedReason, 'cooldown', 'an unanswered run must not lock the user out');
    assert.ok(h.calls.length > before, 'the retry actually sends');
  });

  test('a run the provider answered DOES start the cooldown', async () => {
    process.env.NATIVELY_PROVIDER_CALIBRATION = '1';
    const h = helper({ reply: 'OK' });
    const store = freshStore();
    await runCalibration(h, { store, networkProfileId: 'n' });
    const before = h.calls.length;
    const second = await runCalibration(h, { store, networkProfileId: 'n' });
    assert.equal(second.skippedReason, 'cooldown');
    assert.equal(h.calls.length, before, 'nothing sent inside the cooldown');
  });

  test('a second press while a run is in flight sends nothing', async () => {
    process.env.NATIVELY_PROVIDER_CALIBRATION = '1';
    const h = helper({ reply: 'OK', delayMs: 40 });
    const store = freshStore();
    const running = runCalibration(h, { store, networkProfileId: 'n' });
    const second = await runCalibration(h, { store, networkProfileId: 'n' });
    assert.equal(second.skippedReason, 'cooldown');
    assert.equal(second.requestsIssued, 0);
    await running;
  });
});

describe('calibration ladder size', () => {
  test('with no helper hook and no seeded profile, the ladder uses the registry window', async () => {
    process.env.NATIVELY_PROVIDER_CALIBRATION = '1';
    const registryWindow = readCapabilityFacts('gemini-2.5-flash', false).contextWindowTokens;
    assert.ok(registryWindow > 0, 'precondition: the registry knows this model');
    const expectedRungs = laddersFor(registryWindow).length;
    assert.ok(expectedRungs > laddersFor(0).length, 'precondition: a real window means more rungs than none');
    const h = helper({ reply: 'OK' }); // no getModelContextWindowTokens, like LLMHelper
    const res = await runCalibration(h, { store: freshStore(), networkProfileId: 'n' });
    assert.equal(res.rungs.length, Math.min(expectedRungs, 3));
  });
});

describe('capability probe verdict is kept', () => {
  test('SUPPORTED is written to the vision identity with source "probe"', async () => {
    process.env.NATIVELY_CAPABILITY_PROBE = '1';
    const store = freshStore();
    const h = helper({ reply: (_p, images) => (images && images.length ? 'SEEN' : 'OK') });
    const res = await runCalibration(h, { store, networkProfileId: 'n' });
    assert.equal(res.vision, 'SUPPORTED');
    const p = store.getExact('gemini', 'gemini-2.5-flash', 'n');
    assert.ok(p, 'a profile exists for the vision identity');
    assert.equal(p.capability.vision, true);
    assert.equal(p.capability.source, 'probe');
    assert.ok(p.capability.contextWindowTokens > 0, 'the other registry facts are kept beside the verdict');
  });

  test('a non-answer (FAILED_TEMPORARILY) writes nothing', async () => {
    process.env.NATIVELY_CAPABILITY_PROBE = '1';
    const store = freshStore();
    const h = helper({ reply: 'I cannot help with that.' });
    const res = await runCalibration(h, { store, networkProfileId: 'n' });
    assert.equal(res.vision, 'FAILED_TEMPORARILY');
    const p = store.getExact('gemini', 'gemini-2.5-flash', 'n');
    assert.notEqual(p?.capability?.source, 'probe');
  });
});

describe('Forget all measurements', () => {
  test('clears the calibration cooldown', async () => {
    process.env.NATIVELY_PROVIDER_CALIBRATION = '1';
    const store = freshStore();
    __setProviderPerformanceStore(store);
    try {
      const h = helper({ reply: 'OK' });
      await runCalibration(h, { store, networkProfileId: 'n' });
      assert.equal((await runCalibration(h, { store, networkProfileId: 'n' })).skippedReason, 'cooldown');
      forgetPerformanceEvidence();
      const after = await runCalibration(h, { store, networkProfileId: 'n' });
      assert.notEqual(after.skippedReason, 'cooldown', 'Forget must not leave "try again tomorrow" behind');
    } finally {
      __setProviderPerformanceStore(null);
    }
  });

  test('re-seeds capability facts on the next turn', () => {
    const store = freshStore();
    __setProviderPerformanceStore(store);
    try {
      const identity = helper({ providerId: 'openai', modelId: 'gpt-4o' });
      performanceHooks({ llmHelper: identity, hasImages: false, inputTokens: 100 });
      const seeded = store.all().find((p) => p.modelId === 'gpt-4o');
      assert.equal(seeded?.capability?.source, 'model_registry', 'precondition: first turn seeds');
      forgetPerformanceEvidence();
      assert.equal(store.all().length, 0, 'the store is empty after Forget');
      performanceHooks({ llmHelper: identity, hasImages: false, inputTokens: 100 });
      const reseeded = store.all().find((p) => p.modelId === 'gpt-4o');
      assert.equal(reseeded?.capability?.source, 'model_registry',
        'without the seeding reset the rebuilt profile kept unknownCapability() until restart');
    } finally {
      __setProviderPerformanceStore(null);
    }
  });

  test('clears the late-stream tallies', () => {
    recordSecondaryStream('repair', {
      ttftMs: null, totalMs: 9000, interChunkGapsMs: [], chunkCount: 0, outputChars: 0,
      reason: 'first_useful_timeout', firstUsefulBudgetMs: 0, interTokenStallMs: 0, speculative: false,
    });
    assert.ok(secondaryStreamTallies().length > 0, 'precondition');
    forgetPerformanceEvidence();
    assert.equal(secondaryStreamTallies().length, 0);
  });
});

describe('coding-session predicate shared by screen understanding and the image downgrade', async () => {
  const { isTechnicalModeTemplate } = await import('../../../dist-electron/electron/services/screen/technicalMode.js');
  test('the technical interview template is a coding session; others are not', () => {
    assert.equal(isTechnicalModeTemplate('technical-interview'), true);
    for (const t of ['general', 'sales', 'lecture', 'looking-for-work', '', null, undefined]) {
      assert.equal(isTechnicalModeTemplate(t), false, String(t));
    }
  });
});
