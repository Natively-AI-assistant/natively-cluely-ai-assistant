// electron/llm/__tests__/CalibrationCostGate2026_09_08.test.mjs
//
// The cost gate on active calibration and capability probing.
//
// THIS IS THE FILE A REVIEWER SHOULD READ FIRST. Everything else in the
// Provider Performance Profile is inert measurement; this is the only code that
// can spend the user's money, and Phase 21 is marked mandatory in a way the
// calibration phases are not. So the assertions here are about what must NOT
// happen, and the helper that stands in for the provider COUNTS REQUESTS —
// a test that only checked the returned shape could pass while the engine fired
// a dozen calls.
//
// The second thing pinned here is rule 16: "Never treat a timeout as proof that
// a capability is unsupported." A probe that times out on a bad network must
// never be able to write "your model does not support images" into a profile
// that then persists across restarts.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs';

const M = await import('../../../dist-electron/electron/llm/performance/index.js');
const {
  runCalibration, laddersFor, verdictFromProbe, __resetCalibrationCooldowns,
  MAX_CALIBRATION_REQUESTS, MAX_PROBE_REQUESTS, CALIBRATION_COOLDOWN_MS,
  CALIBRATION_LADDER_TOKENS, calibrationPrompt, deterministicFiller,
  TINY_PNG_BASE64, TINY_PNG_DATA_URI, VISION_PROBE_PROMPT,
  ProviderPerformanceStore, estimateOutputTokens,
} = M;

const { estimateTokens } = await import('../../../dist-electron/electron/llm/index.js');

/** A provider stand-in that COUNTS every request it is asked to make. */
function spyHelper(opts = {}) {
  const calls = [];
  return {
    calls,
    performanceIdentity: (hasImages) => ({
      providerId: 'custom', modelId: 'gw/m',
      route: hasImages ? 'vision' : 'user_endpoint', isOllama: false,
    }),
    getModelContextWindowTokens: () => opts.contextWindow ?? 128_000,
    streamChat: async function* (prompt, imagePaths) {
      calls.push({ promptChars: String(prompt ?? '').length, imagePaths: imagePaths ?? null });
      if (opts.throwWith) throw opts.throwWith;
      if (opts.hang) { await new Promise((r) => setTimeout(r, 5_000)); return; }
      yield opts.reply ?? 'OK';
    },
  };
}

const store = () => new ProviderPerformanceStore({ ephemeral: true });

describe('THE COST GATE — nothing may be spent without an explicit opt-in', () => {
  test('with both flags at their DEFAULTS, zero requests are issued', async () => {
    // The load-bearing assertion of the whole feature. `calibration` and
    // `capabilityProbe` default OFF — unlike the four adaptive flags, which
    // default ON precisely because they cannot spend anything.
    __resetCalibrationCooldowns();
    for (const v of ['NATIVELY_PROVIDER_CALIBRATION', 'NATIVELY_CAPABILITY_PROBE']) delete process.env[v];
    const h = spyHelper();
    const res = await runCalibration(h, { store: store(), networkProfileId: 'n' });
    assert.equal(h.calls.length, 0, 'a default install must issue NO billable request');
    assert.equal(res.requestsIssued, 0);
    assert.equal(res.skippedReason, 'flag_off');
  });

  test('a missing or malformed helper spends nothing and does not throw', async () => {
    __resetCalibrationCooldowns();
    process.env.NATIVELY_PROVIDER_CALIBRATION = '1';
    for (const bad of [null, undefined, {}, { performanceIdentity: () => ({}) }]) {
      const res = await runCalibration(bad, { store: store(), networkProfileId: 'n' });
      assert.equal(res.requestsIssued, 0);
      assert.equal(res.skippedReason, 'no_helper');
    }
    delete process.env.NATIVELY_PROVIDER_CALIBRATION;
  });

  test('one invocation is hard-capped at 3 text + 1 image request', async () => {
    __resetCalibrationCooldowns();
    const h = spyHelper();
    const res = await runCalibration(h, {
      store: store(), networkProfileId: 'n', calibrationEnabled: true, probeEnabled: true,
    });
    assert.equal(h.calls.length, MAX_CALIBRATION_REQUESTS + MAX_PROBE_REQUESTS);
    assert.equal(res.requestsIssued, 4);
    const withImages = h.calls.filter((c) => Array.isArray(c.imagePaths) && c.imagePaths.length > 0);
    assert.equal(withImages.length, MAX_PROBE_REQUESTS, 'exactly one image request');
  });

  test('the cooldown stops a user leaning on the button from billing themselves', async () => {
    __resetCalibrationCooldowns();
    let clock = 1_000_000;
    const h = spyHelper();
    const deps = { store: store(), networkProfileId: 'n', calibrationEnabled: true, probeEnabled: true, now: () => clock };
    await runCalibration(h, deps);
    const afterFirst = h.calls.length;
    assert.ok(afterFirst > 0);

    const second = await runCalibration(h, deps);
    assert.equal(h.calls.length, afterFirst, 'a second press inside the cooldown must send nothing');
    assert.equal(second.skippedReason, 'cooldown');

    clock += CALIBRATION_COOLDOWN_MS + 1;
    await runCalibration(h, deps);
    assert.ok(h.calls.length > afterFirst, 'after the cooldown it may run again');
  });

  test('the probe alone sends ONE request, not the ladder', async () => {
    __resetCalibrationCooldowns();
    const h = spyHelper();
    await runCalibration(h, {
      store: store(), networkProfileId: 'n', calibrationEnabled: false, probeEnabled: true,
    });
    assert.equal(h.calls.length, 1);
    assert.ok(h.calls[0].imagePaths?.length > 0, 'the single request is the image probe');
  });

  test('an unknown context window sends the SMALLEST rung only', () => {
    // Phase 21: "For unknown providers/pricing, choose the conservative
    // low-cost approach."
    assert.deepEqual(laddersFor(0), [CALIBRATION_LADDER_TOKENS[0]]);
    assert.deepEqual(laddersFor(NaN), [CALIBRATION_LADDER_TOKENS[0]]);
  });

  test('a rung is never sent above the model’s advertised window', () => {
    // A rung over the limit is not a measurement — it is a guaranteed 400 the
    // user pays for, which would then be recorded as a client_error against a
    // provider that behaved correctly.
    for (const window of [8_000, 16_000, 32_000, 128_000, 1_000_000]) {
      for (const rung of laddersFor(window)) {
        assert.ok(rung <= window * 0.6 + 1, `rung ${rung} exceeds 60% of a ${window} window`);
      }
    }
  });

  test('a small model still gets three points, scaled down', () => {
    // Otherwise the context-scaling fit has nothing to fit, and a small model
    // would silently never be calibrated at all.
    const rungs = laddersFor(4_000);
    assert.equal(rungs.length, 3);
    assert.ok(rungs[0] < rungs[1] && rungs[1] < rungs[2], 'the ladder must stay monotonic');
  });
});

describe('RULE 16 — a timeout is never proof a capability is unsupported', () => {
  const obs = (over = {}) => ({
    ttftMs: 100, totalMs: 500, interChunkGapsMs: [], chunkCount: 1, outputChars: 4,
    reason: 'done', firstUsefulBudgetMs: 60000, interTokenStallMs: 8000, speculative: false, ...over,
  });

  test('an answered probe is SUPPORTED', () => {
    assert.equal(verdictFromProbe(obs(), 'SEEN').verdict, 'SUPPORTED');
  });

  test('a TIMEOUT is FAILED_TEMPORARILY, never UNSUPPORTED', () => {
    assert.equal(verdictFromProbe(obs({ reason: 'first_useful_timeout' }), '').verdict, 'FAILED_TEMPORARILY');
    assert.equal(verdictFromProbe(obs({ reason: 'stall_timeout' }), '').verdict, 'FAILED_TEMPORARILY');
  });

  test('a 429, a 503 and a network failure are all FAILED_TEMPORARILY', () => {
    // Every one of these is evidence about the MOMENT, not about the model.
    for (const status of [429, 500, 503]) {
      const v = verdictFromProbe(obs({ reason: 'error', error: Object.assign(new Error('x'), { status }) }), '');
      assert.equal(v.verdict, 'FAILED_TEMPORARILY', `status ${status} must not condemn the model`);
    }
    const net = verdictFromProbe(obs({ reason: 'error', error: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) }), '');
    assert.equal(net.verdict, 'FAILED_TEMPORARILY');
  });

  test('only an explicit provider REJECTION yields UNSUPPORTED', () => {
    const rejected = verdictFromProbe(
      obs({ reason: 'error', error: Object.assign(new Error('invalid request: image not supported'), { status: 400 }) }),
      '',
    );
    assert.equal(rejected.verdict, 'UNSUPPORTED');
  });

  test('an aborted or empty probe is FAILED_TEMPORARILY, not a verdict about the model', () => {
    assert.equal(verdictFromProbe(obs({ reason: 'aborted' }), '').verdict, 'FAILED_TEMPORARILY');
    assert.equal(verdictFromProbe(obs({ reason: 'done' }), '   ').verdict, 'FAILED_TEMPORARILY');
  });

  test('a probe that HANGS reports FAILED_TEMPORARILY end to end', async () => {
    __resetCalibrationCooldowns();
    const h = spyHelper({ hang: true });
    const res = await runCalibration(h, {
      store: store(), networkProfileId: 'n', calibrationEnabled: false, probeEnabled: true,
    });
    assert.equal(res.vision, 'FAILED_TEMPORARILY');
    assert.notEqual(res.vision, 'UNSUPPORTED');
  });
});

describe('calibration uses the real production path, and records honestly', () => {
  test('it calls streamChat — there is no separate benchmarking client', async () => {
    // Rule 14 / Phase 6: the benchmark must pass through the same request
    // builder, adapter, transport and streaming wrapper as a real answer.
    __resetCalibrationCooldowns();
    const h = spyHelper();
    await runCalibration(h, { store: store(), networkProfileId: 'n', calibrationEnabled: true, probeEnabled: false });
    assert.ok(h.calls.length > 0, 'calibration must go through streamChat');
  });

  test('calibration samples DO enter the latency estimators, tagged as calibration', async () => {
    // Corrected from real data. These were first recorded as `cold_start` to
    // keep a cold synthetic request out of the warm production median — but a
    // live run showed the cost: after three SUCCESSFUL rungs measured
    // 1026/1755/3664ms, the medium and large buckets were still n=0, because an
    // excluded sample populates neither ttft nor meanInputTokens. Those two are
    // the context fit's coordinates, and calibration is in practice the only
    // thing that ever fills the large bucket. So the ladder ran, cost money,
    // and produced no fit — Phase 14 unreachable.
    __resetCalibrationCooldowns();
    const s = store();
    const h = spyHelper();
    await runCalibration(h, { store: s, networkProfileId: 'n', calibrationEnabled: true, probeEnabled: false });
    const p = s.getExact('custom', 'gw/m', 'n');
    assert.ok(p, 'a profile must exist');
    assert.ok(p.sampleCount > 0, 'calibration must reach the latency estimators');
    assert.equal(p.source, 'calibration', 'and its provenance must be recorded');
    // meanInputTokens is the fit's x-coordinate; without it there is no fit.
    const filled = Object.values(p.workloads).filter((w) => w && w.ttft.count > 0);
    assert.ok(filled.length > 0);
    assert.ok(filled.some((w) => w.meanInputTokens > 0), 'the fit needs an x-coordinate');
  });

  test('the ladder is sent at ascending input sizes', async () => {
    __resetCalibrationCooldowns();
    const h = spyHelper();
    await runCalibration(h, { store: store(), networkProfileId: 'n', calibrationEnabled: true, probeEnabled: false });
    const sizes = h.calls.map((c) => c.promptChars);
    for (let i = 1; i < sizes.length; i++) {
      assert.ok(sizes[i] > sizes[i - 1], `rung ${i} must be larger than rung ${i - 1}`);
    }
  });

  test('calibration carries no user content — no transcript, resume or reference files', async () => {
    // It measures the transport. Sending the user's documents to do so would be
    // both unnecessary and a privacy failure.
    __resetCalibrationCooldowns();
    const h = spyHelper();
    await runCalibration(h, { store: store(), networkProfileId: 'n', calibrationEnabled: true, probeEnabled: false });
    for (const call of h.calls) {
      assert.ok(call.promptChars > 0);
    }
    // The prompt is generated from the fixture, which is a fixed sentence.
    const prompt = calibrationPrompt(4_000);
    assert.match(prompt, /Reply with exactly one word: OK$/);
    assert.ok(!/resume|transcript|candidate/i.test(prompt), 'the fixture must not resemble user content');
  });
});

describe('fixtures', () => {
  test('the filler is deterministic — two builds measure the same request', () => {
    assert.equal(deterministicFiller(4_000), deterministicFiller(4_000));
  });

  test('the filler lands near the requested size', () => {
    for (const target of CALIBRATION_LADDER_TOKENS) {
      const actual = estimateTokens(deterministicFiller(target));
      const ratio = actual / target;
      assert.ok(ratio > 0.85 && ratio < 1.2, `${target} tokens produced ${actual} (ratio ${ratio.toFixed(2)})`);
    }
  });

  test('every calibration prompt asks for a ONE WORD answer', () => {
    // A long output would blur TTFT into generation time, which is the one
    // distinction calibration exists to make — and it would cost more.
    for (const t of CALIBRATION_LADDER_TOKENS) {
      assert.match(calibrationPrompt(t), /exactly one word/i);
    }
    assert.match(VISION_PROBE_PROMPT, /exactly one word/i);
  });

  test('the image fixture is a real, tiny PNG', () => {
    const buf = Buffer.from(TINY_PNG_BASE64, 'base64');
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
    assert.equal(buf.readUInt32BE(16), 8, 'width');
    assert.equal(buf.readUInt32BE(20), 8, 'height');
    assert.ok(buf.length < 200, `must stay tiny, got ${buf.length} bytes`);
    assert.ok(TINY_PNG_DATA_URI.startsWith('data:image/png;base64,'));
  });

  test('the vision probe does not ask a question a blind model could guess', () => {
    // "What colour is this?" is answerable without seeing anything, so it cannot
    // distinguish "saw the image" from "hallucinated an answer".
    assert.ok(!/colou?r/i.test(VISION_PROBE_PROMPT));
  });
});

describe('the output-token estimate', () => {
  test('it agrees with estimateTokens, which it deliberately duplicates', () => {
    // The duplication is intentional (we hold a length, not text) so this test
    // is what stops the two drifting.
    for (const chars of [0, 1, 3, 4, 5, 100, 9999]) {
      assert.equal(estimateOutputTokens(chars), estimateTokens('x'.repeat(chars)),
        `disagreement at ${chars} chars`);
    }
  });

  test('garbage in gives 0, not NaN', () => {
    assert.equal(estimateOutputTokens(NaN), 0);
    assert.equal(estimateOutputTokens(-5), 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('defects found by running against a live provider', () => {
  // Every one of these passed 130+ unit tests and failed the first real request.
  // They are here so they cannot come back.
  const {
    visionProbeImagePath, TINY_PNG_DATA_URI, isPlausibleRemoteSample,
    MIN_PLAUSIBLE_REMOTE_TTFT_MS, VISION_PROBE_EXPECTED, recordStreamObservation,
  } = M;

  test('the vision probe sends a real FILE, not a data URI', () => {
    // THE WORST BUG THIS FEATURE HAD. `imagePaths` are filesystem paths — every
    // adapter does fs.existsSync(p) and silently SKIPS anything else. Passing a
    // data URI meant the probe sent NO IMAGE, degraded to a text request, and
    // recorded vision-SUPPORTED for a model that was never shown a picture. A
    // wrong capability verdict is the worst output of a capability probe
    // because it persists.
    const p = visionProbeImagePath();
    assert.ok(p, 'the probe must be able to materialise its image');
    assert.ok(!p.startsWith('data:'), 'a data URI is not a path');
    assert.ok(fsp.existsSync(p), 'and the path must actually exist on disk');
    const buf = fsp.readFileSync(p);
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'a real PNG');
    assert.equal(buf.readUInt32BE(16), 8);
    // The data URI still exists for other uses, but must never be an imagePath.
    assert.ok(TINY_PNG_DATA_URI.startsWith('data:'));
  });

  test('SUPPORTED requires the answer we ASKED for, not merely some text', () => {
    // Two earlier attempts guessed at what failure looks like and both were
    // wrong: an adapter yields its error as content, and an exhausted vision
    // chain yields a polished user-facing sentence. The reliable question is
    // what SUCCESS looks like — and we specified that ourselves.
    assert.ok(VISION_PROBE_EXPECTED.test('SEEN'));
    assert.ok(VISION_PROBE_EXPECTED.test('  seen. '));
    assert.ok(!VISION_PROBE_EXPECTED.test('Error streaming from custom provider.'));
    assert.ok(!VISION_PROBE_EXPECTED.test(
      'No vision-capable provider configured. Add an API key (OpenAI, Claude, Gemini, or Groq).'));
    assert.ok(!VISION_PROBE_EXPECTED.test('I am unable to view images.'));
  });

  test('a completed probe carrying the WRONG answer is temporary, never unsupported', () => {
    const obs = (over = {}) => ({
      ttftMs: 300, totalMs: 900, interChunkGapsMs: [], chunkCount: 1, outputChars: 40,
      reason: 'done', firstUsefulBudgetMs: 60000, interTokenStallMs: 8000, speculative: false, ...over,
    });
    for (const text of ['Error streaming from custom provider.',
                        'No vision-capable provider configured.',
                        'I cannot see any image.']) {
      const v = verdictFromProbe(obs(), text);
      assert.equal(v.verdict, 'FAILED_TEMPORARILY', `"${text.slice(0,30)}" must not be a capability verdict`);
      assert.notEqual(v.verdict, 'UNSUPPORTED');
    }
    assert.equal(verdictFromProbe(obs(), 'SEEN').verdict, 'SUPPORTED');
  });

  test('a sub-network-latency "success" is dropped, not recorded as the fastest ever', () => {
    // Live: four failed calls arrived as answer TEXT, completed normally, and
    // were recorded as healthy 1ms samples — teaching the profile that a broken
    // endpoint was the fastest it had ever seen. A decaying MAX forgets a floor
    // slowly, so this is poisoning in the most damaging direction.
    assert.equal(isPlausibleRemoteSample('user_endpoint', 1), false);
    assert.equal(isPlausibleRemoteSample('default_provider', 0), false);
    assert.equal(isPlausibleRemoteSample('user_endpoint', MIN_PLAUSIBLE_REMOTE_TTFT_MS), true);
    assert.equal(isPlausibleRemoteSample('user_endpoint', 800), true);
    // A LOCAL model genuinely can answer in microseconds once warm.
    assert.equal(isPlausibleRemoteSample('local', 1), true);
    // No first token at all is not an implausible measurement, it is no
    // measurement — the sample's own class decides what happens to it.
    assert.equal(isPlausibleRemoteSample('user_endpoint', null), true);
  });

  test('the store never sees an implausible remote sample', () => {
    const s = new (M.ProviderPerformanceStore)({ ephemeral: true });
    const written = recordStreamObservation(
      { ttftMs: 1, totalMs: 2, interChunkGapsMs: [], chunkCount: 1, outputChars: 38,
        reason: 'done', firstUsefulBudgetMs: 15000, interTokenStallMs: 8000, speculative: false },
      { providerId: 'custom', modelId: 'gw/m', route: 'user_endpoint', inputTokens: 40,
        outputTokens: 0, hasImages: false, startedAt: 0, coldStart: false, userCancelled: false },
      { store: s, signals: { contaminatedSince: () => null }, networkProfileId: 'n' },
    );
    assert.equal(written, null, 'dropped');
    assert.equal(s.all().length, 0, 'and it never reached a profile');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('defects found by a SUCCESSFUL live run', () => {
  // The first live run that actually generated tokens exposed four more. Unit
  // tests could not have: they all need either real timing jitter or two real
  // request shapes hitting one profile.
  const { foldLatency, ProviderPerformanceStore, TTFT_ADAPTIVE_ROUTES } = M;

  test('a median can never exceed the maximum', () => {
    // Live: six turns produced p50=1797ms against max=1477ms. The max DECAYS on
    // every sample while the median only steps toward the newest one, so the
    // max can slide underneath a median that has not caught up.
    let e;
    for (const ms of [3000, 2800, 900, 850, 800, 780, 760]) e = foldLatency(e, ms);
    assert.ok(e.p50Ms <= e.maxMs, `p50 ${e.p50Ms} must not exceed max ${e.maxMs}`);
    for (let i = 0; i < 50; i++) {
      e = foldLatency(e, 400 + Math.round(Math.sin(i) * 200));
      assert.ok(e.p50Ms <= e.maxMs, `p50 ${e.p50Ms} > max ${e.maxMs} at step ${i}`);
    }
  });

  test('a vision sample does not flip the profile off the adaptive text route', () => {
    // Live: the vision probe shares provider+model, so it shares the profile
    // KEY. Writing its route flipped the row to 'vision', which is not in
    // TTFT_ADAPTIVE_ROUTES — a profile that had been adapting its text ceiling
    // silently reverted to the shipped prior on the very run meant to improve it.
    const s = new ProviderPerformanceStore({ ephemeral: true });
    const base = { providerId: 'custom', modelId: 'm', networkProfileId: 'n',
      sampleClass: 'normal', totalMs: 2000, maxGapMs: 40, p50GapMs: 20,
      inputTokens: 100, outputTokens: 50, generationRateTps: 20, retryCount: 0 };
    s.record({ ...base, route: 'user_endpoint', workload: 'small', ttftMs: 900 });
    assert.equal(s.getExact('custom', 'm', 'n').route, 'user_endpoint');
    s.record({ ...base, route: 'vision', workload: 'vision', ttftMs: 3000 });
    assert.equal(s.getExact('custom', 'm', 'n').route, 'user_endpoint',
      'a vision sample must not steal the row’s transport');
    assert.equal(TTFT_ADAPTIVE_ROUTES.has('user_endpoint'), true);
  });

  test('a row first seen on vision is still allowed to adopt a text route', () => {
    const s = new ProviderPerformanceStore({ ephemeral: true });
    const base = { providerId: 'custom', modelId: 'm', networkProfileId: 'n',
      sampleClass: 'normal', totalMs: 2000, maxGapMs: 40, p50GapMs: 20,
      inputTokens: 100, outputTokens: 50, generationRateTps: 20, retryCount: 0 };
    s.record({ ...base, route: 'vision', workload: 'vision', ttftMs: 3000 });
    assert.equal(s.getExact('custom', 'm', 'n').route, 'vision');
    s.record({ ...base, route: 'user_endpoint', workload: 'small', ttftMs: 900 });
    assert.equal(s.getExact('custom', 'm', 'n').route, 'user_endpoint');
  });

  test('a FAILED vision probe records no vision latency sample', async () => {
    // Live: the chain answered 404 "No endpoints found that support image
    // input", the verdict correctly said FAILED_TEMPORARILY — and the profile
    // still gained `vision ok=1` at 258ms, because the generator had completed
    // carrying a fallback message. That is a vision latency sample for a request
    // that never reached a vision model.
    __resetCalibrationCooldowns();
    const s = store();
    // The stub answers text, so the probe never gets its expected word back.
    const h = spyHelper({ reply: 'No endpoints found that support image input' });
    const res = await runCalibration(h, {
      store: s, networkProfileId: 'n', calibrationEnabled: false, probeEnabled: true,
    });
    assert.equal(res.vision, 'FAILED_TEMPORARILY');
    const rows = s.all();
    for (const p of rows) {
      assert.ok(!p.workloads?.vision || p.workloads.vision.ttft.count === 0,
        'a failed probe must contribute no vision latency');
    }
  });
});
