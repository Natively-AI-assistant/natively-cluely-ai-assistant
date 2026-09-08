// electron/llm/__tests__/ProviderPerformanceProfile2026_09_08.test.mjs
//
// The Provider Performance Profile — the evidence layer behind Natively's
// adaptive deadlines.
//
// WHAT THESE TESTS ARE ACTUALLY DEFENDING. This area has a documented history of
// one specific defect shape, written into liveDeadlines.ts twice: a deadline
// placed just above the observed tail, which then kills the turns it was meant
// to protect ("a ceiling 1.4s above the observed tail is not a safety net — it
// is a coin flip"; 21% of one user's vision turns died that way). Every
// assertion below about asymmetry, clamping, hygiene and sample counts exists to
// stop this layer re-creating that geometry from a new direction.
//
// The second thing being defended is subtler: RECORDING IS NOT ADAPTING. The
// store observes every route, but only the routes the shipped route table marks
// adaptive may have their deadline moved. A test that let evidence move
// `server_cascade` would be re-arming F-301 (the client abandoning a turn 2s
// before natively-api rotates providers), so that separation is pinned here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const M = await import('../../../dist-electron/electron/llm/performance/index.js');
const {
  ProviderPerformanceStore,
  classifyWorkload,
  classifySample,
  confidenceFor,
  isLatencyAdmissible,
  isReliabilitySignal,
  foldLatency,
  foldGaps,
  fitContextScaling,
  projectTtft,
  adaptAsymmetric,
  summarizeGaps,
  streamIdleTimeoutMs,
  adaptiveTtftCeilingMs,
  projectLargeContext,
  performanceGrade,
  buildDeadlineDiagnostics,
  computeNetworkProfile,
  classifyInterfaceName,
  subnetOf,
  profileLookupChain,
  migrateProviderPerformanceProfiles,
  RuntimeSignals,
  recordStreamObservation,
  telemetryFor,
  STREAM_IDLE_MIN_MS,
  STREAM_IDLE_MAX_MS,
  ROUTE_TTFT_BOUNDS,
  TTFT_ADAPTIVE_ROUTES,
  PROFILE_STALE_AFTER_MS,
} = M;

const { LIVE_INTER_TOKEN_STALL_MS, LIVE_TOTAL_HARD_TIMEOUT_MS, LIVE_VISION_TOTAL_HARD_TIMEOUT_MS } =
  await import('../../../dist-electron/electron/llm/index.js');

function store(opts = {}) {
  return new ProviderPerformanceStore({ ephemeral: true, ...opts });
}

function sample(over = {}) {
  return {
    providerId: 'custom',
    modelId: 'gw/model-a',
    networkProfileId: 'net1',
    route: 'user_endpoint',
    workload: 'small',
    sampleClass: 'normal',
    ttftMs: 900,
    totalMs: 3000,
    maxGapMs: 120,
    p50GapMs: 60,
    inputTokens: 2000,
    outputTokens: 300,
    ...over,
  };
}

// ───────────────────────────────────────────────────────────────────────────
describe('workload classification', () => {
  test('the 4K / 12K / 32K shape Phase 5 asks for maps onto three buckets', () => {
    assert.equal(classifyWorkload(4_000, false), 'small');
    assert.equal(classifyWorkload(12_000, false), 'medium');
    assert.equal(classifyWorkload(32_000, false), 'large');
  });

  test('an image turn is its OWN bucket, never a text bucket', () => {
    // An image turn's prefill is not predicted by its text token count. That is
    // the entire reason the vision route has its own 20s ceiling rather than
    // sharing the text one, and the bucketing has to agree with it or the
    // context fit would be asked to explain image cost with word counts.
    assert.equal(classifyWorkload(500, true), 'vision');
    assert.equal(classifyWorkload(90_000, true), 'vision');
  });

  test('an unknown input size is treated as small rather than large', () => {
    // Routes that report no usage would otherwise pile into the `large` bucket
    // and poison the context fit with a bogus x-coordinate.
    assert.equal(classifyWorkload(NaN, false), 'small');
    assert.equal(classifyWorkload(0, false), 'small');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('sample hygiene — what may size a deadline', () => {
  test('only a normal turn reaches the latency estimators', () => {
    assert.equal(isLatencyAdmissible('normal'), true);
    for (const cls of ['timeout', 'stall', 'cold_start', 'network_switch', 'app_resumed',
      'user_cancelled', 'rate_limit', 'server_error', 'client_error', 'connection_failure', 'unknown']) {
      assert.equal(isLatencyAdmissible(cls), false, `${cls} must not size a deadline`);
    }
  });

  test('a timeout is a reliability signal but never a latency one', () => {
    // The ratchet recordAnswerFirstToken's own contract forbids: a turn the
    // deadline killed must not teach the budget that this endpoint takes exactly
    // as long as the budget allows.
    assert.equal(isLatencyAdmissible('timeout'), false);
    assert.equal(isReliabilitySignal('timeout'), true);
  });

  test('a user cancellation is neither — it says nothing about the provider', () => {
    assert.equal(isLatencyAdmissible('user_cancelled'), false);
    assert.equal(isReliabilitySignal('user_cancelled'), false);
  });

  const signals = (contamination) => ({ contaminatedSince: () => contamination });
  const obs = (over = {}) => ({
    ttftMs: 800, totalMs: 2000, interChunkGapsMs: [], chunkCount: 3,
    reason: 'done', firstUsefulBudgetMs: 8000, interTokenStallMs: 8000, speculative: false, ...over,
  });
  const ident = (over = {}) => ({
    providerId: 'p', modelId: 'm', route: 'default_provider', inputTokens: 100, outputTokens: 10,
    hasImages: false, startedAt: 1000, coldStart: false, userCancelled: false, ...over,
  });

  test('a completed warm turn is normal', () => {
    assert.equal(classifySample(obs(), ident(), signals(null)), 'normal');
  });

  test('a completed FIRST call is cold_start — counted as ok, excluded from latency', () => {
    const cls = classifySample(obs(), ident({ coldStart: true }), signals(null));
    assert.equal(cls, 'cold_start');
    assert.equal(isReliabilitySignal(cls), true, 'a cold start still SUCCEEDED');
    assert.equal(isLatencyAdmissible(cls), false, 'but a weight load is not the steady state');
  });

  test('a laptop resume outranks the stream outcome', () => {
    // A turn that timed out while the machine was waking is not evidence about
    // the provider; recording it as `timeout` would count an outage against a
    // provider that was barely asked.
    assert.equal(
      classifySample(obs({ reason: 'first_useful_timeout' }), ident(), signals('app_resumed')),
      'app_resumed',
    );
  });

  test('a network switch outranks the stream outcome', () => {
    assert.equal(
      classifySample(obs({ reason: 'stall_timeout' }), ident(), signals('network_switch')),
      'network_switch',
    );
  });

  test('user cancellation outranks EVERYTHING, contamination included', () => {
    assert.equal(
      classifySample(obs({ reason: 'done' }), ident({ userCancelled: true }), signals('app_resumed')),
      'user_cancelled',
    );
    assert.equal(classifySample(obs({ reason: 'aborted' }), ident(), signals(null)), 'user_cancelled');
  });

  test('a provider error class is preserved rather than flattened to timeout', () => {
    for (const errorClass of ['rate_limit', 'server_error', 'client_error', 'connection_failure']) {
      assert.equal(
        classifySample(obs({ reason: 'error' }), ident({ errorClass }), signals(null)),
        errorClass,
      );
    }
  });

  test('a speculative (prefetch) stream is dropped entirely, not recorded', () => {
    // Its deadline was DISABLED, so its timings describe a request nobody waited
    // on and no budget bounded — a different thing from the one being sized.
    const s = store();
    const written = recordStreamObservation(obs({ speculative: true }), ident(), {
      store: s, signals: signals(null), networkProfileId: 'net1',
    });
    assert.equal(written, null);
    assert.equal(s.all().length, 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('estimators', () => {
  test('the decaying max forgives one outlier instead of pinning the budget', () => {
    let e = foldLatency(undefined, 13_000);
    const spiked = e.maxMs;
    for (let i = 0; i < 10; i++) e = foldLatency(e, 500);
    assert.equal(spiked, 13_000);
    assert.ok(e.maxMs < spiked, `must decay: ${spiked} -> ${e.maxMs}`);
    assert.ok(e.maxMs >= 500, 'but never below the samples it has actually seen');
  });

  test('the max tracks a TAIL, not a centre — one slow turn widens it immediately', () => {
    // This is the whole design. An EWMA here lands near p50 and a deadline
    // placed there guillotines the tail.
    let e = foldLatency(undefined, 500);
    for (let i = 0; i < 5; i++) e = foldLatency(e, 500);
    e = foldLatency(e, 11_600);
    assert.equal(e.maxMs, 11_600, 'a single tail sample must move the max at once');
    assert.ok(e.p50Ms < 3_000, `the median must NOT chase it: ${e.p50Ms}`);
  });

  test('a garbage measurement is ignored, not stored', () => {
    const e = foldLatency(undefined, NaN);
    assert.equal(e.count, 0);
    assert.equal(foldLatency(foldLatency(undefined, 100), -5).count, 1);
  });

  test('adaptation is asymmetric: degradation fast, improvement slow', () => {
    const worse = adaptAsymmetric(1000, 5000);
    const better = adaptAsymmetric(5000, 1000);
    assert.ok(worse > 3000, `degradation must be adopted fast, got ${worse}`);
    assert.ok(better > 4000, `improvement must be adopted slowly, got ${better}`);
  });

  test('summarizeGaps reports a real median and max over one stream', () => {
    assert.deepEqual(summarizeGaps([10, 20, 30, 40, 500]), { maxGapMs: 500, p50GapMs: 30 });
    assert.equal(summarizeGaps([]), null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('stream-idle derivation — the knob with no adaptation today', () => {
  test('with no evidence it returns exactly the shipped constant', () => {
    // Phase 0 rule 20, enforced rather than trusted.
    const d = streamIdleTimeoutMs('default_provider', null);
    assert.equal(d.valueMs, LIVE_INTER_TOKEN_STALL_MS);
    assert.equal(d.source, 'shipped_prior');
    assert.equal(d.confidence, 'none');
  });

  test('a chatty provider narrows the guard — but only after enough evidence', () => {
    const chatty = (count) => ({ stream: { maxGapMs: 200, p50GapMs: 50, count }, workloads: {}, sampleCount: count });
    // 1 sample: 200*3 = 600 would narrow, so it must NOT apply yet.
    assert.equal(streamIdleTimeoutMs('default_provider', chatty(1)).valueMs, LIVE_INTER_TOKEN_STALL_MS);
    // 5 samples: narrowing is allowed, and the floor catches it.
    const settled = streamIdleTimeoutMs('default_provider', chatty(5));
    assert.equal(settled.valueMs, STREAM_IDLE_MIN_MS);
    assert.equal(settled.source, 'clamped_floor');
  });

  test('a legitimately bursty provider is never punished below the safety floor', () => {
    // A provider pausing for a tool call, a GC pause or a scheduler hiccup must
    // not be shot by a sub-second guard derived from its own chattiness.
    const d = streamIdleTimeoutMs('default_provider', {
      stream: { maxGapMs: 10, p50GapMs: 5, count: 500 }, workloads: {}, sampleCount: 500,
    });
    assert.equal(d.valueMs, STREAM_IDLE_MIN_MS);
    assert.ok(d.valueMs >= STREAM_IDLE_MIN_MS);
  });

  test('a slow provider cannot widen the guard past the shipped ceiling', () => {
    // Widening past 8s costs the user: they sit watching a half-written answer
    // that will never finish. That is a diagnostics finding, not a grant.
    const d = streamIdleTimeoutMs('user_endpoint', {
      stream: { maxGapMs: 9_000, p50GapMs: 4_000, count: 30 }, workloads: {}, sampleCount: 30,
    });
    assert.equal(d.valueMs, STREAM_IDLE_MAX_MS);
    assert.equal(d.source, 'clamped_ceiling');
    assert.ok(d.rawMs > STREAM_IDLE_MAX_MS, 'the raw derivation is reported honestly');
  });

  test('widening applies from the first sample; narrowing does not', () => {
    // Same asymmetry liveDeadlines already uses, for the same reason: widening
    // cannot kill a turn, narrowing can.
    const wide = streamIdleTimeoutMs('default_provider', {
      stream: { maxGapMs: 3_000, p50GapMs: 1_000, count: 1 }, workloads: {}, sampleCount: 1,
    });
    assert.ok(wide.valueMs > LIVE_INTER_TOKEN_STALL_MS - 1, 'a 3s gap seen once must widen at once');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('adaptive TTFT — recording is not adapting', () => {
  const evidence = (maxMs, count, workload = 'small') => ({
    workloads: { [workload]: { ttft: { maxMs, p50Ms: maxMs, count }, total: { maxMs: 0, p50Ms: 0, count: 0 }, reliability: {}, meanInputTokens: 1000 } },
    stream: { maxGapMs: 0, p50GapMs: 0, count: 0 },
    sampleCount: count,
  });

  test('the server cascade is IMMOVABLE — this is the F-301 invariant', () => {
    // 13000 is "natively-api's 10s provider cutover + 3s". Narrowing it puts the
    // client back to abandoning turns before the server can rotate. Evidence has
    // nothing to correct on a number derived from a mechanism we can read.
    const d = adaptiveTtftCeilingMs(
      { route: 'server_cascade', workload: 'small', shippedMs: LIVE_TOTAL_HARD_TIMEOUT_MS },
      evidence(400, 500),
    );
    assert.equal(d.valueMs, LIVE_TOTAL_HARD_TIMEOUT_MS);
    assert.equal(d.source, 'shipped_prior');
    assert.equal(TTFT_ADAPTIVE_ROUTES.has('server_cascade'), false);
  });

  test('the vision ceiling is immovable too — it is sized off a measured tail', () => {
    const d = adaptiveTtftCeilingMs(
      { route: 'vision', workload: 'vision', shippedMs: LIVE_VISION_TOTAL_HARD_TIMEOUT_MS },
      evidence(300, 200),
    );
    assert.equal(d.valueMs, LIVE_VISION_TOTAL_HARD_TIMEOUT_MS);
  });

  test('a user endpoint DOES adapt, and keeps the 5s margin over its own tail', () => {
    // 5000 is liveDeadlines' own margin, reused rather than re-derived: it is
    // "the margin that would have made that session succeed outright".
    const d = adaptiveTtftCeilingMs(
      { route: 'user_endpoint', workload: 'small', shippedMs: 15_000 },
      evidence(11_600, 8),
    );
    assert.equal(d.rawMs, 16_600, 'observed tail + the 5s margin');
    assert.equal(d.valueMs, 16_600, '16.6s is inside the bounds, so evidence stands unclamped');
    assert.equal(d.source, 'profile');
    assert.ok(d.valueMs <= ROUTE_TTFT_BOUNDS.user_endpoint.max);
  });

  test('an absurdly slow endpoint is clamped at the ceiling, not granted forever', () => {
    // Phase 17: dynamic values must never be able to produce an infinite budget.
    const d = adaptiveTtftCeilingMs(
      { route: 'user_endpoint', workload: 'large', shippedMs: 15_000 },
      evidence(120_000, 40, 'large'),
    );
    assert.equal(d.valueMs, ROUTE_TTFT_BOUNDS.user_endpoint.max);
    assert.equal(d.source, 'clamped_ceiling');
  });

  test('one workload bucket does not size another bucket\u2019s deadline', () => {
    // A user who ran twenty 4K turns has learned nothing about their gateway on
    // a 32K request. Borrowing the small bucket's number for the large one is
    // how a deadline comes to be sized off a population it does not describe,
    // which is the same class of error as one route inheriting another's.
    const d = adaptiveTtftCeilingMs(
      { route: 'user_endpoint', workload: 'large', shippedMs: 15_000 },
      evidence(400, 60, 'small'),
    );
    assert.equal(d.valueMs, 15_000, 'the large bucket has no evidence, so the shipped value stands');
    assert.equal(d.source, 'shipped_prior');
  });

  test('the filter may only WIDEN — it never narrows the shipped adaptive budget', () => {
    // `shippedMs` on this route is NOT a constant: it is already
    // userEndpointBudgetMs(observedAnswerLatency()) from LLMHelper's session
    // map. Two populations now answer the same question, and they are not the
    // same population — the session map is route-wide, this profile is
    // per-workload and per-network.
    //
    // The failure this blocks, concretely: a user with twenty fast 4K turns and
    // one 11.6s 32K turn would have their NEXT large turn sized from the SMALL
    // bucket, narrower than the session map's answer, on exactly the turn shape
    // that produced the 21%-death defect.
    const d = adaptiveTtftCeilingMs(
      { route: 'user_endpoint', workload: 'small', shippedMs: 16_600 },
      evidence(400, 60),
    );
    assert.equal(d.valueMs, 16_600, 'fast-bucket evidence must not shorten a budget the session map widened');
    assert.equal(d.source, 'clamped_floor');
  });

  test('widening past the session map IS allowed — that is the new information', () => {
    // Persisted, per-network, per-workload evidence that this endpoint is
    // slower than the session has seen so far is exactly what the profile adds.
    const d = adaptiveTtftCeilingMs(
      { route: 'user_endpoint', workload: 'small', shippedMs: 9_000 },
      evidence(11_600, 8),
    );
    assert.equal(d.valueMs, 16_600);
    assert.equal(d.source, 'profile');
  });

  test('with no evidence every route returns its shipped value untouched', () => {
    for (const route of ['local', 'vision', 'server_cascade', 'user_endpoint', 'default_provider']) {
      const d = adaptiveTtftCeilingMs({ route, workload: 'small', shippedMs: 4242 }, null);
      assert.equal(d.valueMs, 4242, `${route} must not move without evidence`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('large context — estimated, not brute-forced', () => {
  test('a straight line is fitted from three cheap points', () => {
    // Phase 5/14: measure 4K/12K/32K, then EXTRAPOLATE. This is the alternative
    // to firing five 100K requests at a user's card during onboarding.
    const m = fitContextScaling([
      { inputTokens: 4_000, ttftMs: 1_000 },
      { inputTokens: 12_000, ttftMs: 1_800 },
      { inputTokens: 32_000, ttftMs: 3_800 },
    ]);
    assert.ok(m, 'three points must fit');
    assert.ok(m.slopeMsPerKToken > 0, 'bigger requests must not predict faster');
    const at100k = projectTtft(m, 100_000);
    assert.ok(at100k.ttftMs > 3_800, `100K must project above the largest measured point: ${at100k.ttftMs}`);
  });

  test('one point is not a fit, and two points at the same size are one point', () => {
    assert.equal(fitContextScaling([{ inputTokens: 4_000, ttftMs: 1_000 }]), null);
    assert.equal(fitContextScaling([
      { inputTokens: 4_000, ttftMs: 1_000 },
      { inputTokens: 4_000, ttftMs: 1_400 },
    ]), null);
  });

  test('a NEGATIVE slope is clamped to zero rather than promised as a speedup', () => {
    const m = fitContextScaling([
      { inputTokens: 4_000, ttftMs: 3_000 },
      { inputTokens: 32_000, ttftMs: 1_000 },
    ]);
    assert.equal(m.slopeMsPerKToken, 0, 'noise must not become a discovered efficiency');
  });

  test('a projection carries its own error, and a bad fit is not actionable', () => {
    // Phase 20 rules out misleading precision. A line through noisy points still
    // produces a number; `actionable` is what stops that number being trusted.
    const noisy = {
      contextScaling: { interceptMs: 1_000, slopeMsPerKToken: 10, rmseMs: 5_000, points: 3 },
    };
    const p = projectLargeContext(noisy, 100_000);
    assert.equal(p.actionable, false, 'RMSE larger than the prediction is noise');

    const clean = {
      contextScaling: { interceptMs: 1_000, slopeMsPerKToken: 30, rmseMs: 100, points: 3 },
    };
    assert.equal(projectLargeContext(clean, 100_000).actionable, true);
  });

  test('no fit means no projection, rather than a confident zero', () => {
    assert.equal(projectLargeContext(null, 100_000), null);
    assert.equal(projectLargeContext({ contextScaling: null }, 100_000), null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the store', () => {
  test('a normal turn lands in latency AND reliability', () => {
    const s = store();
    s.record(sample());
    const p = s.lookup('custom', 'gw/model-a', 'net1');
    assert.equal(p.workloads.small.ttft.count, 1);
    assert.equal(p.workloads.small.ttft.maxMs, 900);
    assert.equal(p.workloads.small.reliability.ok, 1);
    assert.equal(p.sampleCount, 1);
  });

  test('a timeout lands in reliability ONLY — the ratchet is blocked', () => {
    const s = store();
    s.record(sample({ sampleClass: 'timeout', ttftMs: 14_900, totalMs: null, maxGapMs: null, p50GapMs: null }));
    const p = s.getExact('custom', 'gw/model-a', 'net1');
    assert.equal(p.workloads.small.ttft.count, 0, 'a killed turn must not teach the budget');
    assert.equal(p.workloads.small.reliability.timeout, 1);
    assert.equal(p.sampleCount, 0);
  });

  test('a stalled stream contributes no GAP evidence', () => {
    // On a stall the largest gap IS the guard's own value; feeding it back would
    // teach the guard that this provider's normal gap equals whatever the guard
    // allows — the TTFT ratchet, one field over.
    const s = store();
    s.record(sample({ sampleClass: 'stall', maxGapMs: null, p50GapMs: null, totalMs: null }));
    assert.equal(s.getExact('custom', 'gw/model-a', 'net1').stream.count, 0);
  });

  test('a user cancellation touches neither side', () => {
    const s = store();
    s.record(sample({ sampleClass: 'user_cancelled' }));
    const p = s.getExact('custom', 'gw/model-a', 'net1');
    assert.equal(p.workloads.small.ttft.count, 0);
    assert.deepEqual(
      Object.values(p.workloads.small.reliability).filter((v) => v > 0),
      [],
      'a user stopping a turn is not a provider failure',
    );
  });

  test('a laptop resume is environmental — it is not counted against the provider', () => {
    const s = store();
    s.record(sample({ sampleClass: 'app_resumed' }));
    const r = s.getExact('custom', 'gw/model-a', 'net1').workloads.small.reliability;
    assert.equal(r.ok + r.timeout + r.serverError + r.stall, 0, 'a lid closing is not an outage');
  });

  test('two networks are measured separately, then fall back up the ladder', () => {
    // Phase 9: exact network → any network for this model → any model for this
    // provider. Without the ladder a user on a new hotspot starts from nothing.
    const s = store();
    for (let i = 0; i < 3; i++) s.record(sample({ networkProfileId: 'home', ttftMs: 500 }));
    assert.equal(s.lookup('custom', 'gw/model-a', 'home').workloads.small.ttft.maxMs, 500);
    const fallback = s.lookup('custom', 'gw/model-a', 'hotspot-never-seen');
    assert.ok(fallback, 'an unseen network must inherit the model tier, not start blank');
    assert.equal(fallback.networkProfileId, 'home');
  });

  test('the lookup ladder is exactly three tiers, most specific first', () => {
    assert.deepEqual(profileLookupChain('p', 'm', 'n'), ['p|m|n', 'p|m|*', 'p|*|*']);
  });

  test('two models on one provider do not blend', () => {
    const s = store();
    for (let i = 0; i < 3; i++) s.record(sample({ modelId: 'fast', ttftMs: 300 }));
    for (let i = 0; i < 3; i++) s.record(sample({ modelId: 'slow', ttftMs: 9_000 }));
    assert.equal(s.lookup('custom', 'fast', 'net1').workloads.small.ttft.maxMs, 300);
    assert.equal(s.lookup('custom', 'slow', 'net1').workloads.small.ttft.maxMs, 9_000);
  });

  test('a stale profile stops sizing deadlines but survives for diagnostics', () => {
    let now = 1_000_000;
    const s = store({ now: () => now });
    s.record(sample());
    assert.ok(s.lookup('custom', 'gw/model-a', 'net1'), 'fresh: usable');
    now += PROFILE_STALE_AFTER_MS + 1;
    assert.equal(s.lookup('custom', 'gw/model-a', 'net1'), null, 'stale: not a deadline source');
    assert.ok(s.getExact('custom', 'gw/model-a', 'net1'), 'stale: still readable for diagnostics');
  });

  test('invalidating a provider drops only that provider', () => {
    const s = store();
    s.record(sample({ providerId: 'custom' }));
    s.record(sample({ providerId: 'gemini' }));
    s.invalidateProvider('custom');
    assert.equal(s.getExact('custom', 'gw/model-a', 'net1'), null);
    assert.ok(s.getExact('gemini', 'gw/model-a', 'net1'));
  });

  test('the context fit is refitted from the workload buckets as they fill', () => {
    const s = store();
    for (const [workload, tokens, ttft] of [['small', 4_000, 900], ['medium', 12_000, 1_600], ['large', 32_000, 3_600]]) {
      for (let i = 0; i < 3; i++) s.record(sample({ workload, inputTokens: tokens, ttftMs: ttft }));
    }
    const p = s.lookup('custom', 'gw/model-a', 'net1');
    assert.ok(p.contextScaling, 'three filled buckets must produce a fit');
    assert.equal(p.contextScaling.points, 3);
    assert.ok(p.contextScaling.slopeMsPerKToken > 0);
  });

  test('vision is excluded from the context fit', () => {
    // An image turn's prefill is not explained by its text token count.
    const s = store();
    for (let i = 0; i < 3; i++) s.record(sample({ workload: 'vision', inputTokens: 500, ttftMs: 6_000 }));
    for (let i = 0; i < 3; i++) s.record(sample({ workload: 'small', inputTokens: 4_000, ttftMs: 900 }));
    const p = s.lookup('custom', 'gw/model-a', 'net1');
    assert.equal(p.contextScaling, null, 'one text bucket is not two points');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('persistence', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'perf-profile-'));

  test('a profile survives a restart', () => {
    const dir = tmp();
    const a = new ProviderPerformanceStore({ storageDir: dir });
    for (let i = 0; i < 4; i++) a.record(sample({ ttftMs: 1_500 }));
    a.dispose();

    const b = new ProviderPerformanceStore({ storageDir: dir });
    const p = b.lookup('custom', 'gw/model-a', 'net1');
    assert.ok(p, 'the profile must survive the process that measured it');
    assert.equal(p.workloads.small.ttft.count, 4);
  });

  test('a corrupt file degrades to a fresh install rather than throwing', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'provider-performance.json'), '{not json');
    const s = new ProviderPerformanceStore({ storageDir: dir });
    assert.doesNotThrow(() => s.load());
    assert.equal(s.all().length, 0);
    assert.doesNotThrow(() => s.record(sample()));
  });

  test('an unknown schema version is dropped, never guessed at', () => {
    assert.equal(migrateProviderPerformanceProfiles({ version: 999, profiles: {} }), null);
    assert.equal(migrateProviderPerformanceProfiles(null), null);
    assert.equal(migrateProviderPerformanceProfiles({ version: 1 }), null, 'a version with no profiles is not a profile file');
    assert.ok(migrateProviderPerformanceProfiles({ version: 1, profiles: {}, savedAt: 5 }));
  });

  test('an ephemeral store writes nothing to disk', () => {
    const dir = tmp();
    const s = new ProviderPerformanceStore({ storageDir: dir, ephemeral: true });
    s.record(sample());
    s.dispose();
    assert.equal(fs.existsSync(path.join(dir, 'provider-performance.json')), false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('network profile — cross-platform, and non-identifying', () => {
  // CLAUDE.md: both platform branches must be exercised, and process.platform is
  // never mutated to do it — the platform is injected.
  const macIfaces = {
    lo0: [{ address: '127.0.0.1', mac: '00:00:00:00:00:00', internal: true, family: 'IPv4' }],
    en0: [{ address: '192.168.1.42', mac: 'aa:bb:cc:dd:ee:ff', internal: false, family: 'IPv4' }],
  };
  const winIfaces = {
    'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', mac: '00:00:00:00:00:00', internal: true, family: 'IPv4' }],
    'Wi-Fi': [{ address: '192.168.1.42', mac: 'aa:bb:cc:dd:ee:ff', internal: false, family: 'IPv4' }],
  };

  test('macOS interface names are classified by macOS rules', () => {
    assert.equal(classifyInterfaceName('en0', 'darwin'), 'wifi');
    assert.equal(classifyInterfaceName('en5', 'darwin'), 'ethernet');
    assert.equal(classifyInterfaceName('utun3', 'darwin'), 'other');
    assert.equal(classifyInterfaceName('lo0', 'darwin'), 'loopback');
  });

  test('Windows interface names are classified by Windows rules', () => {
    assert.equal(classifyInterfaceName('Wi-Fi', 'win32'), 'wifi');
    assert.equal(classifyInterfaceName('Ethernet 2', 'win32'), 'ethernet');
    assert.equal(classifyInterfaceName('Local Area Connection* 12', 'win32'), 'ethernet');
    assert.equal(classifyInterfaceName('Cellular', 'win32'), 'cellular');
  });

  test("neither platform's names are readable by the other's rules", () => {
    // The point of two explicit branches: 'en0' means nothing on Windows and
    // 'Wi-Fi' means nothing on macOS. A single shared matcher would silently
    // class one platform's real interface as 'other'.
    assert.equal(classifyInterfaceName('en0', 'win32'), 'other');
    assert.equal(classifyInterfaceName('Wi-Fi', 'darwin'), 'other');
  });

  test('the same physical network yields the same id on both platforms', () => {
    const mac = computeNetworkProfile({ platform: 'darwin', readInterfaces: () => macIfaces });
    const win = computeNetworkProfile({ platform: 'win32', readInterfaces: () => winIfaces });
    assert.equal(mac.id, win.id, 'the id is hashed from addresses, not from interface naming');
    assert.equal(mac.interfaceClass, 'wifi');
    assert.equal(win.interfaceClass, 'wifi');
  });

  test('a different network yields a different id', () => {
    const other = computeNetworkProfile({
      platform: 'darwin',
      readInterfaces: () => ({ en0: [{ address: '10.20.30.40', mac: '11:22:33:44:55:66', internal: false, family: 'IPv4' }] }),
    });
    const home = computeNetworkProfile({ platform: 'darwin', readInterfaces: () => macIfaces });
    assert.notEqual(other.id, home.id);
  });

  test('a DHCP lease change on the same subnet does NOT look like a new network', () => {
    // Otherwise a user's evidence would be discarded every few days.
    const a = computeNetworkProfile({
      platform: 'darwin',
      readInterfaces: () => ({ en0: [{ address: '192.168.1.42', mac: 'aa:bb:cc:dd:ee:ff', internal: false, family: 'IPv4' }] }),
    });
    const b = computeNetworkProfile({
      platform: 'darwin',
      readInterfaces: () => ({ en0: [{ address: '192.168.1.77', mac: 'aa:bb:cc:dd:ee:ff', internal: false, family: 'IPv4' }] }),
    });
    assert.equal(a.id, b.id);
  });

  test('the id contains no address and no MAC', () => {
    // Phase 24. The stored label must not be reversible into a location.
    const p = computeNetworkProfile({ platform: 'darwin', readInterfaces: () => macIfaces });
    assert.match(p.id, /^[0-9a-f]{12}$/);
    assert.ok(!p.id.includes('192'), 'no address fragment may survive into the id');
    assert.ok(!JSON.stringify(p).includes('aa:bb:cc'), 'no MAC may survive into the profile');
  });

  test('subnets are reduced to a prefix, never kept whole', () => {
    assert.equal(subnetOf('192.168.1.42', 'IPv4'), '192.168.1.0/24');
    assert.equal(subnetOf('192.168.1.42', 4), '192.168.1.0/24');
    assert.equal(subnetOf('2001:db8:1:2:3:4:5:6', 'IPv6'), '2001:db8:1:2::/64');
  });

  test('offline, no interfaces, and a throwing reader all degrade safely', () => {
    assert.equal(computeNetworkProfile({ platform: 'darwin', readInterfaces: () => ({}) }).offline, true);
    assert.equal(computeNetworkProfile({
      platform: 'win32',
      readInterfaces: () => { throw new Error('EPERM'); },
    }).offline, true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('runtime signals', () => {
  test('a resume contaminates turns that started before it', () => {
    let now = 100_000;
    const s = new RuntimeSignals({ now: () => now, readNetwork: () => ({ id: 'n1', interfaceClass: 'wifi', offline: false }) });
    const turnStart = now;
    now += 5_000;
    s.noteSystemResumed();
    assert.equal(s.contaminatedSince(turnStart), 'app_resumed');
  });

  test('the quarantine expires, so a machine is not permanently suspect', () => {
    let now = 100_000;
    const s = new RuntimeSignals({ now: () => now, readNetwork: () => ({ id: 'n1', interfaceClass: 'wifi', offline: false }) });
    s.noteSystemResumed();
    now += 60_000;
    assert.equal(s.contaminatedSince(now), null);
  });

  test('a network switch is detected and contaminates the turn spanning it', () => {
    let now = 100_000;
    let id = 'net-home';
    const s = new RuntimeSignals({ now: () => now, readNetwork: () => ({ id, interfaceClass: 'wifi', offline: false }) });
    s.network();
    const turnStart = now;
    now += 20_000;
    id = 'net-hotspot';
    s.network();
    assert.equal(s.contaminatedSince(turnStart), 'network_switch');
  });

  test('the network read is cached, so it is not a syscall per turn', () => {
    let reads = 0;
    let now = 0;
    const s = new RuntimeSignals({ now: () => now, readNetwork: () => { reads++; return { id: 'n', interfaceClass: 'wifi', offline: false }; } });
    s.network(); s.network(); s.network();
    assert.equal(reads, 1);
    now += 60_000;
    s.network();
    assert.equal(reads, 2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('user-facing grading and diagnostics', () => {
  const profileWith = (ttftMs, rel = {}) => ({
    sampleCount: 20,
    stream: { maxGapMs: 100, p50GapMs: 50, count: 10 },
    workloads: {
      small: {
        ttft: { maxMs: ttftMs, p50Ms: ttftMs, count: 20 },
        total: { maxMs: 0, p50Ms: 0, count: 0 },
        reliability: { ok: 20, timeout: 0, stall: 0, rateLimit: 0, serverError: 0, clientError: 0, connectionFailure: 0, ...rel },
        meanInputTokens: 2000,
      },
    },
  });

  test('grades are words, not numbers', () => {
    assert.equal(performanceGrade(profileWith(600)), 'fast');
    assert.equal(performanceGrade(profileWith(2_000)), 'good');
    assert.equal(performanceGrade(profileWith(4_000)), 'moderate');
    assert.equal(performanceGrade(profileWith(9_000)), 'slow');
  });

  test('reliability outranks latency — a fast provider that fails is not "fast"', () => {
    assert.equal(performanceGrade(profileWith(600, { timeout: 8 })), 'unreliable');
  });

  test('no evidence grades as unknown, never as a flattering default', () => {
    assert.equal(performanceGrade(null), 'unknown');
    assert.equal(performanceGrade({ sampleCount: 0, workloads: {}, stream: {} }), 'unknown');
  });

  test('confidence tiers match the sample counts Phase 7 names', () => {
    assert.equal(confidenceFor(0), 'none');
    assert.equal(confidenceFor(3), 'low');
    assert.equal(confidenceFor(20), 'medium');
    assert.equal(confidenceFor(200), 'high');
  });

  test('the live diagnostics record leaks nothing that could carry request content', () => {
    // Phase 24, enforced by the SHAPE rather than by a sanitiser someone has to
    // remember: PerformanceTurnRecord has no field that could hold a prompt, a
    // transcript line, a filename or an image.
    const { performanceHooks, __setProviderPerformanceStore, __setRuntimeSignals, RuntimeSignals } = M;
    const prev = process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE;
    process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = '1';
    const s = store();
    __setProviderPerformanceStore(s);
    __setRuntimeSignals(new RuntimeSignals({ readNetwork: () => ({ id: 'n', interfaceClass: 'wifi', offline: false }) }));
    const records = [];
    const hooks = performanceHooks({
      llmHelper: { performanceIdentity: () => ({ providerId: 'custom', modelId: 'm', route: 'user_endpoint', isOllama: false }) },
      hasImages: false, inputTokens: 2000,
      onDiagnostics: (r) => records.push(r),
    });
    hooks.observe({
      ttftMs: 900, totalMs: 4000, interChunkGapsMs: [30, 40, 50], chunkCount: 4,
      reason: 'first_useful_timeout', firstUsefulBudgetMs: 15000, interTokenStallMs: 8000, speculative: false,
    });
    __setProviderPerformanceStore(null);
    __setRuntimeSignals(null);
    if (prev === undefined) delete process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE; else process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = prev;

    assert.equal(records.length, 1);
    const serialized = JSON.stringify(records[0]);
    for (const forbidden of ['prompt', 'message', 'transcript', 'content', 'text', 'image', 'error']) {
      assert.ok(!serialized.includes(`"${forbidden}"`), `diagnostics must not carry a ${forbidden} field`);
    }
    assert.equal(records[0].terminationReason, 'first_useful_timeout');
    assert.equal(records[0].firstUsefulBudgetMs, 15000);
  });

  test('telemetry carries metadata only, and never the network id', () => {
    // A per-network identifier leaving the device is a location beacon.
    const { name, properties } = telemetryFor(sample());
    assert.equal(name, 'llm_completed');
    assert.equal(properties.provider, 'custom');
    assert.equal(properties.ttft_ms, 900);
    assert.ok(!('networkProfileId' in properties), 'the network id must never be transmitted');
    assert.ok(!Object.values(properties).some((v) => typeof v === 'string' && v.length > 100));
  });

  test('a failed turn is reported as a provider_error event, not a latency one', () => {
    assert.equal(telemetryFor(sample({ sampleClass: 'timeout' })).name, 'provider_error');
    assert.equal(telemetryFor(sample({ sampleClass: 'rate_limit' })).name, 'provider_error');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the single-provider user (Phase 13)', () => {
  test('one provider still gets a profile, a grade and an adapted stall guard', () => {
    // Nothing here requires a second provider to compare against, which is the
    // requirement: routing is optional, the profile is not.
    const s = store();
    for (let i = 0; i < 10; i++) {
      s.record(sample({ providerId: 'gemini', modelId: 'gemini-3.7-flash', route: 'default_provider', ttftMs: 700, maxGapMs: 90, p50GapMs: 40 }));
    }
    const p = s.lookup('gemini', 'gemini-3.7-flash', 'net1');
    assert.equal(performanceGrade(p), 'fast');
    const idle = streamIdleTimeoutMs('default_provider', p);
    assert.ok(idle.valueMs < LIVE_INTER_TOKEN_STALL_MS, 'a dead stream is now caught faster than 8s');
    assert.ok(idle.valueMs >= STREAM_IDLE_MIN_MS, 'but never below the safety floor');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the flags are the rollback story, so the OFF path is pinned too', () => {
  // The whole migration posture rests on one claim: with the adaptive flags off,
  // every value is byte-for-byte what ships today. The e2e run proves the ON
  // path; nothing proved the OFF path, and it is the half that has to be true
  // for a revert to be a revert. `flagOn()` reads process.env fresh on every
  // call (no cache — see intelligenceFlags' own note on why), so asserting it
  // is a matter of setting the var.
  const { performanceHooks, applyAdaptiveTtft, __setProviderPerformanceStore, __setRuntimeSignals, RuntimeSignals } = M;

  const helper = {
    performanceIdentity: () => ({ providerId: 'custom', modelId: 'gw/m', route: 'user_endpoint' }),
  };

  function withStrongEvidence(fn) {
    const s = store();
    for (let i = 0; i < 40; i++) {
      s.record(sample({ providerId: 'custom', modelId: 'gw/m', networkProfileId: 'testnet', ttftMs: 300, maxGapMs: 20, p50GapMs: 10 }));
    }
    __setProviderPerformanceStore(s);
    __setRuntimeSignals(new RuntimeSignals({ readNetwork: () => ({ id: 'testnet', interfaceClass: 'wifi', offline: false }) }));
    const prevProfile = process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE;
    const prevIdle = process.env.NATIVELY_ADAPTIVE_STREAM_IDLE;
    const prevTtft = process.env.NATIVELY_ADAPTIVE_TTFT;
    try { return fn(s); } finally {
      __setProviderPerformanceStore(null);
      __setRuntimeSignals(null);
      if (prevProfile === undefined) delete process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE; else process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = prevProfile;
      if (prevIdle === undefined) delete process.env.NATIVELY_ADAPTIVE_STREAM_IDLE; else process.env.NATIVELY_ADAPTIVE_STREAM_IDLE = prevIdle;
      if (prevTtft === undefined) delete process.env.NATIVELY_ADAPTIVE_TTFT; else process.env.NATIVELY_ADAPTIVE_TTFT = prevTtft;
    }
  }

  test('adaptiveStreamIdle OFF returns the shipped constant despite strong evidence', () => {
    withStrongEvidence(() => {
      process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = '1';
      process.env.NATIVELY_ADAPTIVE_STREAM_IDLE = '0';
      const hooks = performanceHooks({ llmHelper: helper, hasImages: false, inputTokens: 2000 });
      assert.equal(hooks.interTokenStallMs, LIVE_INTER_TOKEN_STALL_MS);
      // The DECISION is still computed, so diagnostics can show what it would
      // have been — the flag gates the act, not the measurement.
      assert.ok(hooks.streamIdle.valueMs < LIVE_INTER_TOKEN_STALL_MS);
      assert.ok(hooks.observe, 'observe-only recording still runs with the act flag off');
    });
  });

  test('adaptiveStreamIdle ON acts on the same evidence', () => {
    withStrongEvidence(() => {
      process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = '1';
      process.env.NATIVELY_ADAPTIVE_STREAM_IDLE = '1';
      const hooks = performanceHooks({ llmHelper: helper, hasImages: false, inputTokens: 2000 });
      assert.ok(hooks.interTokenStallMs < LIVE_INTER_TOKEN_STALL_MS);
      assert.ok(hooks.interTokenStallMs >= STREAM_IDLE_MIN_MS);
    });
  });

  test('the master flag OFF disables recording as well as acting', () => {
    withStrongEvidence(() => {
      process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = '0';
      process.env.NATIVELY_ADAPTIVE_STREAM_IDLE = '1';
      const hooks = performanceHooks({ llmHelper: helper, hasImages: false, inputTokens: 2000 });
      assert.equal(hooks.interTokenStallMs, LIVE_INTER_TOKEN_STALL_MS);
      assert.equal(hooks.observe, undefined, 'no observer at all when the profile is off');
    });
  });

  test('adaptiveTtft OFF is the identity function on the shipped value', () => {
    withStrongEvidence(() => {
      process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = '1';
      process.env.NATIVELY_ADAPTIVE_TTFT = '0';
      assert.equal(applyAdaptiveTtft(15_000, { llmHelper: helper, hasImages: false, inputTokens: 2000 }), 15_000);
    });
  });

  test('a missing or broken llmHelper never changes a deadline', () => {
    // Fail-open: every path in the wiring returns the shipped value rather than
    // throwing on the answer path.
    process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = '1';
    process.env.NATIVELY_ADAPTIVE_STREAM_IDLE = '1';
    for (const bad of [null, undefined, {}, { performanceIdentity: () => { throw new Error('boom'); } }]) {
      const hooks = performanceHooks({ llmHelper: bad, hasImages: false, inputTokens: 100 });
      assert.equal(hooks.interTokenStallMs, LIVE_INTER_TOKEN_STALL_MS);
      assert.equal(applyAdaptiveTtft(15_000, { llmHelper: bad, hasImages: false, inputTokens: 100 }), 15_000);
    }
    delete process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE;
    delete process.env.NATIVELY_ADAPTIVE_STREAM_IDLE;
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('going live: what the default-ON flags must never do', () => {
  const {
    sampleClassForProviderError, classifyStreamError, MIN_GAPS_FOR_EVIDENCE,
    recordSecondaryStream, secondaryStreamTallies, __resetSecondaryStreamTallies,
    secondaryStreamObserver, STREAM_IDLE_ADAPTIVE_ROUTES, readCapabilityFacts,
    verdictFrom, exceedsAdvertisedContext, largeContextReliabilityWarning,
    __setProviderPerformanceStore,
  } = M;

  test('the LOCAL route never adapts its stall guard, however chatty it looks', () => {
    // An on-device model competes for the machine's own GPU, so a multi-second
    // pause can be thermal throttling rather than a dead stream. Five fast
    // healthy streams would otherwise put the guard at 2500ms and kill the next
    // throttled generation before the decaying max could widen it back. Same
    // argument that gives local a 30s TTFT ceiling instead of 8s.
    const chatty = { stream: { maxGapMs: 20, p50GapMs: 10, count: 500 }, workloads: {}, sampleCount: 500 };
    const d = streamIdleTimeoutMs('local', chatty);
    assert.equal(d.valueMs, LIVE_INTER_TOKEN_STALL_MS);
    assert.equal(d.source, 'shipped_prior');
    assert.equal(STREAM_IDLE_ADAPTIVE_ROUTES.has('local'), false);
  });

  test('every hosted route DOES adapt on the same evidence', () => {
    for (const route of ['vision', 'server_cascade', 'user_endpoint', 'default_provider']) {
      const d = streamIdleTimeoutMs(route, {
        stream: { maxGapMs: 20, p50GapMs: 10, count: 500 }, workloads: {}, sampleCount: 500,
      });
      assert.ok(d.valueMs < LIVE_INTER_TOKEN_STALL_MS, `${route} should adapt`);
      assert.ok(d.valueMs >= STREAM_IDLE_MIN_MS, `${route} must respect the floor`);
    }
  });

  test('the adaptive guard can never make a stream wait LONGER than today', () => {
    // The safety property that makes default-ON defensible: whatever the
    // evidence says, no stream waits longer than the shipped constant.
    for (const maxGapMs of [1, 100, 1_000, 5_000, 50_000, 10_000_000]) {
      for (const route of ['vision', 'server_cascade', 'user_endpoint', 'default_provider', 'local']) {
        const v = streamIdleTimeoutMs(route, {
          stream: { maxGapMs, p50GapMs: maxGapMs / 2, count: 100 }, workloads: {}, sampleCount: 100,
        }).valueMs;
        assert.ok(v <= LIVE_INTER_TOKEN_STALL_MS, `${route}@${maxGapMs} widened past the ceiling: ${v}`);
        assert.ok(v >= STREAM_IDLE_MIN_MS, `${route}@${maxGapMs} fell below the floor: ${v}`);
      }
    }
  });

  test('a thin stream contributes no gap evidence', () => {
    // A two-chunk answer has one interval, and one interval cannot tell "streams
    // smoothly" from "happened not to pause in the 40ms we watched". Since the
    // guard is now live, a thin sample would narrow a real deadline on almost
    // no evidence.
    const s = store();
    const obs = (gaps) => ({
      ttftMs: 500, totalMs: 2000, interChunkGapsMs: gaps, chunkCount: gaps.length + 1,
      reason: 'done', firstUsefulBudgetMs: 8000, interTokenStallMs: 8000, speculative: false,
    });
    const ident = { providerId: 'p', modelId: 'm', route: 'default_provider', inputTokens: 100,
      outputTokens: 10, hasImages: false, startedAt: 0, coldStart: false, userCancelled: false };
    const sig = { contaminatedSince: () => null };

    recordStreamObservation(obs([10, 20]), ident, { store: s, signals: sig, networkProfileId: 'n' });
    assert.equal(s.getExact('p', 'm', 'n').stream.count, 0, '2 gaps is below the minimum');
    recordStreamObservation(obs([10, 20, 30]), ident, { store: s, signals: sig, networkProfileId: 'n' });
    assert.equal(s.getExact('p', 'm', 'n').stream.count, 1, `${MIN_GAPS_FOR_EVIDENCE} gaps qualifies`);
    // TTFT is still recorded from the thin stream — only the GAPS were thin.
    assert.equal(s.getExact('p', 'm', 'n').workloads.small.ttft.count, 2);
  });

  test('every provider error kind has a deliberate destination', () => {
    // A `default: unknown` here would silently swallow `auth`, and an expired
    // API key is exactly the condition a user needs a reliability signal for.
    assert.equal(sampleClassForProviderError('rate_limit'), 'rate_limit');
    assert.equal(sampleClassForProviderError('auth'), 'client_error');
    assert.equal(sampleClassForProviderError('overloaded'), 'server_error');
    assert.equal(sampleClassForProviderError('server_error'), 'server_error');
    assert.equal(sampleClassForProviderError('network'), 'connection_failure');
    // These say nothing the stream's own outcome does not already say.
    assert.equal(sampleClassForProviderError('timeout'), null);
    assert.equal(sampleClassForProviderError('zero_token'), null);
    assert.equal(sampleClassForProviderError('stall'), null);
    assert.equal(sampleClassForProviderError('none'), null);
  });

  test('a real thrown error is classified, and the error itself never escapes', () => {
    const rateLimited = Object.assign(new Error('rate limit exceeded'), { status: 429 });
    assert.equal(classifyStreamError(rateLimited), 'rate_limit');
    const authFailed = Object.assign(new Error('invalid api key'), { status: 401 });
    assert.equal(classifyStreamError(authFailed), 'client_error');
    assert.equal(classifyStreamError(undefined), null);

    // The store must hold the CLASS and nothing of the error.
    const s = store();
    recordStreamObservation(
      { ttftMs: null, totalMs: 900, interChunkGapsMs: [], chunkCount: 0, reason: 'error',
        error: Object.assign(new Error('SECRET-PROMPT-TEXT leaked here'), { status: 429 }),
        firstUsefulBudgetMs: 8000, interTokenStallMs: 8000, speculative: false },
      { providerId: 'p', modelId: 'm', route: 'default_provider', inputTokens: 100, outputTokens: 0,
        hasImages: false, startedAt: 0, coldStart: false, userCancelled: false },
      { store: s, signals: { contaminatedSince: () => null }, networkProfileId: 'n' },
    );
    const p = s.getExact('p', 'm', 'n');
    assert.equal(p.workloads.small.reliability.rateLimit, 1);
    assert.ok(!JSON.stringify(p).includes('SECRET-PROMPT-TEXT'), 'the error text must never be stored');
  });

  test('a wipe drops observations from turns that were already in flight', () => {
    // "Reset" must mean the same thing whether or not a meeting is live.
    const s = store();
    const g = s.currentGeneration();
    s.record(sample(), g);
    assert.equal(s.getExact('custom', 'gw/model-a', 'net1').sampleCount, 1);
    s.clear();
    s.record(sample(), g);           // the in-flight turn, opened before the wipe
    assert.equal(s.getExact('custom', 'gw/model-a', 'net1'), null, 'a pre-wipe turn must not resurrect a profile');
    s.record(sample(), s.currentGeneration()); // a turn opened after
    assert.equal(s.getExact('custom', 'gw/model-a', 'net1').sampleCount, 1);
  });

  test('secondary streams are tallied and reach NO profile', () => {
    // A repair replays a prompt truncated at 24000 chars, runs on a warm
    // connection, and has a deliberately shorter budget. Its latency would land
    // in the wrong workload bucket, drag the median down, and its timeout would
    // libel a healthy provider.
    __resetSecondaryStreamTallies();
    const s = store();
    __setProviderPerformanceStore(s);
    const prev = process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE;
    process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = '1';
    const observe = secondaryStreamObserver('repair');
    observe({ ttftMs: 300, totalMs: 900, interChunkGapsMs: [10, 10, 10], chunkCount: 4,
      reason: 'done', firstUsefulBudgetMs: 7000, interTokenStallMs: 8000, speculative: false });
    observe({ ttftMs: null, totalMs: 7000, interChunkGapsMs: [], chunkCount: 0,
      reason: 'first_useful_timeout', firstUsefulBudgetMs: 7000, interTokenStallMs: 8000, speculative: false });
    if (prev === undefined) delete process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE; else process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = prev;
    __setProviderPerformanceStore(null);

    const tally = secondaryStreamTallies().find((t) => t.kind === 'repair');
    assert.equal(tally.attempts, 2);
    assert.equal(tally.completed, 1);
    assert.equal(tally.firstTokenTimeouts, 1, 'a repair that could never land is the point of the tally');
    assert.equal(tally.maxObservedTtftMs, 300);
    assert.equal(s.all().length, 0, 'no secondary stream may reach a profile');
    __resetSecondaryStreamTallies();
  });

  test('capability facts come from the registries, never from anything measured', () => {
    // Phase 4 / rules 16-17. There is no path in the capability view that can
    // read a duration, and there must not be one.
    const facts = readCapabilityFacts('gemini-3.7-flash', false);
    assert.equal(facts.source, 'model_registry');
    assert.ok(facts.contextWindowTokens > 0);
    assert.equal(verdictFrom(facts.vision === true), 'SUPPORTED');
    assert.equal(verdictFrom('unknown'), 'UNKNOWN');
    assert.equal(verdictFrom(false), 'UNSUPPORTED');
    // Tools/structured output have no registry to read, so 'unknown' is the
    // honest answer rather than an invented one.
    assert.equal(facts.tools, 'unknown');
    assert.equal(facts.structuredOutput, 'unknown');
  });

  test('capability facts are seeded into the profile by the live hook', () => {
    const { performanceHooks, __setRuntimeSignals, RuntimeSignals } = M;
    const prev = process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE;
    process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = '1';
    const s = store();
    __setProviderPerformanceStore(s);
    __setRuntimeSignals(new RuntimeSignals({ readNetwork: () => ({ id: 'n', interfaceClass: 'wifi', offline: false }) }));
    performanceHooks({
      llmHelper: { performanceIdentity: () => ({ providerId: 'gemini', modelId: 'gemini-3.7-flash', route: 'default_provider', isOllama: false }) },
      hasImages: false, inputTokens: 1000,
    });
    const p = s.getExact('gemini', 'gemini-3.7-flash', 'n');
    assert.equal(p.capability.source, 'model_registry', 'the hook must populate capability, not leave it unknown');
    assert.ok(p.capability.contextWindowTokens > 0);
    __setProviderPerformanceStore(null);
    __setRuntimeSignals(null);
    if (prev === undefined) delete process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE; else process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = prev;
  });

  test('an over-limit request is a capability finding; poor big requests are a reliability one', () => {
    // Phase 14's exact distinction: repeated failure at 100K on a model
    // advertising 128K is "large-context reliability is poor", NOT "does not
    // support 100K" — only capability metadata can say the latter.
    const facts = { contextWindowTokens: 128_000, streaming: true, vision: 'unknown', tools: 'unknown', structuredOutput: 'unknown', source: 'model_registry' };
    assert.deepEqual(exceedsAdvertisedContext(facts, 200_000), { exceeds: true, limitTokens: 128_000 });
    assert.deepEqual(exceedsAdvertisedContext(facts, 100_000), { exceeds: false, limitTokens: 128_000 });
    assert.equal(exceedsAdvertisedContext({ ...facts, contextWindowTokens: 0 }, 100_000), null,
      'an unknown limit is not a licence to warn');

    assert.equal(largeContextReliabilityWarning({ attempts: 2, failures: 2 }), null, 'two attempts is not a pattern');
    const warning = largeContextReliabilityWarning({ attempts: 10, failures: 6 });
    assert.match(warning, /reliability/i);
    assert.ok(!/does not support|unsupported/i.test(warning), 'a reliability finding must never be phrased as a capability one');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('generation rate, true quantiles, and the too-slow signal', () => {
  const {
    generationRateTps, quantile, pushSample, RESERVOIR_SIZE,
    ttftQuantiles, MIN_SAMPLES_FOR_QUANTILE, projectTotalDurationMs,
    workloadTooSlowFor, urgencyForStreamRoute, USEFUL_BY_MS,
  } = M;

  test('the rate is measured over the GENERATION window, not the total', () => {
    // total includes prefill, so `tokens / totalMs` lands systematically low —
    // and lands lowest for exactly the providers with the slowest prefill, the
    // ones a rate estimate is most needed for.
    const r = generationRateTps({ estimatedOutputTokens: 100, ttftMs: 4_000, totalMs: 6_000 });
    assert.equal(r, 50, '100 tokens over the 2s generation window is 50/s');
    const wrong = 100 / (6_000 / 1000);
    assert.ok(r > wrong, `the total-based figure (${wrong}) would understate it`);
  });

  test('a single-chunk stream yields null rather than Infinity', () => {
    assert.equal(generationRateTps({ estimatedOutputTokens: 5, ttftMs: 900, totalMs: 900 }), null);
    assert.equal(generationRateTps({ estimatedOutputTokens: 5, ttftMs: 900, totalMs: 500 }), null);
    assert.equal(generationRateTps({ estimatedOutputTokens: 0, ttftMs: 100, totalMs: 5000 }), null);
    assert.equal(generationRateTps({ estimatedOutputTokens: 10, ttftMs: null, totalMs: 5000 }), null);
  });

  test('an interrupted stream contributes NO rate', () => {
    // A stream cut by the runaway cap or the stall guard has a truncated
    // numerator over an untruncated denominator — it reads as a provider that
    // writes slowly when in fact it was interrupted.
    const s = store();
    s.record(sample({ sampleClass: 'stall', totalMs: null, generationRateTps: null }));
    assert.equal(s.getExact('custom', 'gw/model-a', 'net1').workloads.small.generationRate, null);
  });

  test('a completed stream DOES contribute a rate', () => {
    const s = store();
    for (let i = 0; i < 3; i++) s.record(sample({ generationRateTps: 40 }));
    const g = s.getExact('custom', 'gw/model-a', 'net1').workloads.small.generationRate;
    assert.equal(g.count, 3);
    assert.ok(g.tokensPerSecond > 30 && g.tokensPerSecond < 50, `got ${g.tokensPerSecond}`);
  });

  test('no quantile is claimed below the sample threshold', () => {
    // Phase 7, verbatim: "Do not claim a real P95 with n=5." Returning null
    // rather than the maximum is what stops a diagnostics surface printing a
    // confident number derived from four measurements.
    let r = [];
    for (let i = 0; i < 10; i++) r = pushSample(r, 100 + i);
    assert.equal(quantile(r, 0.95, MIN_SAMPLES_FOR_QUANTILE), null);
    assert.equal(quantile(r, 0.5, MIN_SAMPLES_FOR_QUANTILE), null);
  });

  test('a real quantile appears once there are enough samples', () => {
    let r = [];
    for (let i = 1; i <= 100; i++) r = pushSample(r, i * 10);
    // The reservoir keeps the most recent 64, i.e. 370..1000.
    assert.equal(r.length, RESERVOIR_SIZE);
    const p50 = quantile(r, 0.5, MIN_SAMPLES_FOR_QUANTILE);
    const p95 = quantile(r, 0.95, MIN_SAMPLES_FOR_QUANTILE);
    assert.ok(p50 > 0 && p95 > p50, `p50=${p50} p95=${p95}`);
    assert.ok(p95 <= 1000, 'a quantile can never exceed the largest sample');
  });

  test('the reservoir is bounded and keeps the MOST RECENT samples', () => {
    // Most recent, not a uniform sample of all history — the same reason the
    // estimators decay: a provider whose infrastructure changed last week
    // should not be described by last month.
    let r = [];
    for (let i = 0; i < 500; i++) r = pushSample(r, i);
    assert.equal(r.length, RESERVOIR_SIZE);
    assert.equal(r[r.length - 1], 499);
    assert.equal(r[0], 500 - RESERVOIR_SIZE);
  });

  test('the store fills the reservoir, and quantiles unlock at the threshold', () => {
    const s = store();
    for (let i = 0; i < MIN_SAMPLES_FOR_QUANTILE - 1; i++) s.record(sample({ ttftMs: 500 + i }));
    assert.equal(ttftQuantiles(s.lookup('custom', 'gw/model-a', 'net1'), 'small'), null);
    s.record(sample({ ttftMs: 900 }));
    const q = ttftQuantiles(s.lookup('custom', 'gw/model-a', 'net1'), 'small');
    assert.ok(q && q.p95 >= q.p50, `p50=${q?.p50} p95=${q?.p95}`);
  });

  test('urgency comes from real streamRoute values, and unknown is the MOST permissive', () => {
    // An unrecognised route must never inherit the tightest budget in the system
    // by forgetting to label itself.
    assert.equal(urgencyForStreamRoute('wta_live'), 'live');
    assert.equal(urgencyForStreamRoute('manual_chat_stream'), 'interactive');
    assert.equal(urgencyForStreamRoute('phone_mirror'), 'interactive');
    assert.equal(urgencyForStreamRoute('unknown'), 'background');
    assert.equal(urgencyForStreamRoute(undefined), 'background');
    assert.equal(urgencyForStreamRoute('some_route_added_next_year'), 'background');
    assert.ok(USEFUL_BY_MS.live < USEFUL_BY_MS.interactive);
    assert.equal(USEFUL_BY_MS.background, Number.POSITIVE_INFINITY);
  });

  test('a slow provider on a LIVE turn raises the too-slow signal', () => {
    const s = store();
    // TTFT 6s, and 10 tokens/sec — a 400-token answer takes 40s more.
    for (let i = 0; i < 3; i++) s.record(sample({ ttftMs: 6_000, generationRateTps: 10 }));
    const p = s.lookup('custom', 'gw/model-a', 'net1');
    const projected = projectTotalDurationMs(p, 'small', 400);
    assert.ok(projected.totalMs > 40_000, `predicted ${projected.totalMs}ms`);

    const live = workloadTooSlowFor({ profile: p, workload: 'small', urgency: 'live', expectedOutputTokens: 400 });
    assert.ok(live, 'a 46s answer is useless on a live meeting turn');
    assert.equal(live.budgetMs, USEFUL_BY_MS.live);

    // Nothing is too slow in the background — a meeting summary legitimately
    // takes minutes.
    assert.equal(
      workloadTooSlowFor({ profile: p, workload: 'small', urgency: 'background', expectedOutputTokens: 400 }),
      null,
    );
  });

  test('a fast provider raises nothing, at any urgency', () => {
    const s = store();
    for (let i = 0; i < 3; i++) s.record(sample({ ttftMs: 600, generationRateTps: 120 }));
    const p = s.lookup('custom', 'gw/model-a', 'net1');
    for (const urgency of ['live', 'interactive', 'background']) {
      assert.equal(workloadTooSlowFor({ profile: p, workload: 'small', urgency, expectedOutputTokens: 400 }), null);
    }
  });

  test('with no measured rate the signal stays silent rather than guessing', () => {
    assert.equal(projectTotalDurationMs(null, 'small', 400), null);
    const s = store();
    s.record(sample({ generationRateTps: null }));
    assert.equal(
      workloadTooSlowFor({ profile: s.lookup('custom', 'gw/model-a', 'net1'), workload: 'small', urgency: 'live', expectedOutputTokens: 400 }),
      null,
    );
  });

  test('the total-request projection is ADVISORY — no deadline consumes it', async () => {
    // The safety property: every other derived number here either widens a
    // budget or is clamped at today's constant. A total-request ceiling is the
    // first that could terminate a stream mid-answer, and the inputs are two
    // estimates. So it feeds diagnostics and the optimization signal only.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../performance/deadlines.ts', import.meta.url), 'utf8'));
    assert.match(src, /ADVISORY ONLY/,
      'projectTotalDurationMs must document that it is not handed to the driver');
    const wiring = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../performance/wiring.ts', import.meta.url), 'utf8'));
    assert.ok(!/firstUsefulDeadlineMs:\s*projectTotalDurationMs/.test(wiring),
      'the projection must never be wired into a deadline');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the connect timeout — the fourth of Phase 11’s four limits', () => {
  const { connectTimeoutMs, CONNECT_MIN_TIMEOUT_MS, CONNECT_MAX_TIMEOUT_MS, imageProfileForTurn } = M;

  test('with no evidence it is exactly the shipped 4s', () => {
    const d = connectTimeoutMs(null);
    assert.equal(d.valueMs, CONNECT_MIN_TIMEOUT_MS);
    assert.equal(d.source, 'shipped_prior');
  });

  test('it may only WIDEN — a fast network never shortens it', () => {
    // The direction matters more here than anywhere else in the feature: this
    // app has already shipped a defect where a 4s connect timer killed a working
    // vision request by a 6ms margin. Narrowing trades a rare cheap failure
    // (waiting 4s to learn a host is unreachable) for a common expensive one.
    const fast = connectTimeoutMs({ connect: { maxMs: 120, p50Ms: 100, count: 200 } });
    assert.equal(fast.valueMs, CONNECT_MIN_TIMEOUT_MS, 'a 120ms connect must not shorten the timer');
    assert.equal(fast.source, 'clamped_floor');
  });

  test('a slow network DOES buy more room', () => {
    const slow = connectTimeoutMs({ connect: { maxMs: 3_000, p50Ms: 1_500, count: 20 } });
    assert.equal(slow.valueMs, 6_000, '2x the observed worst connect');
    assert.equal(slow.source, 'profile');
  });

  test('it can never eat the tightest route budget', () => {
    // A connect allowance above the 8000ms default-provider ceiling could
    // consume a whole turn before a first token was even possible.
    const awful = connectTimeoutMs({ connect: { maxMs: 60_000, p50Ms: 40_000, count: 20 } });
    assert.equal(awful.valueMs, CONNECT_MAX_TIMEOUT_MS);
    assert.equal(awful.source, 'clamped_ceiling');
  });

  test('a caller with a LARGER shipped value keeps it', () => {
    // The floor is max(4000, shipped) — this filter must never shorten a call
    // site that deliberately asked for longer.
    assert.equal(connectTimeoutMs(null, 12_000).valueMs, 12_000);
    assert.equal(connectTimeoutMs({ connect: { maxMs: 100, p50Ms: 90, count: 50 } }, 12_000).valueMs, 12_000);
  });

  test('the store folds connect samples independently of workload', () => {
    // DNS + TCP + TLS does not care how many tokens the prompt has, so
    // bucketing it by workload would split one population four ways for nothing.
    const s = store();
    s.recordConnect('custom', 'gw/m', 'net1', 'user_endpoint', 800);
    s.recordConnect('custom', 'gw/m', 'net1', 'user_endpoint', 2_400);
    const p = s.getExact('custom', 'gw/m', 'net1');
    assert.equal(p.connect.count, 2);
    assert.equal(p.connect.maxMs, 2_400);
    assert.equal(connectTimeoutMs(p).valueMs, 4_800);
  });

  test('a garbage connect measurement is ignored', () => {
    const s = store();
    s.recordConnect('custom', 'gw/m', 'net1', 'user_endpoint', NaN);
    s.recordConnect('custom', 'gw/m', 'net1', 'user_endpoint', -5);
    assert.equal(s.getExact('custom', 'gw/m', 'net1'), null, 'nothing valid, nothing stored');
  });
});

describe('the image-compression responder (Phase 18)', () => {
  const { imageProfileForTurn, __setProviderPerformanceStore, __setRuntimeSignals, RuntimeSignals } = M;

  function withSlowVisionProvider(fn) {
    const prev = process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE;
    const prevImg = process.env.NATIVELY_ADAPTIVE_IMAGE_QUALITY;
    process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = '1';
    // This responder has its OWN flag, default OFF — it is the only adaptive
    // consumer that visibly degrades output rather than being bounded so that
    // ON is safer or equal, so it has to be asked for.
    process.env.NATIVELY_ADAPTIVE_IMAGE_QUALITY = '1';
    const s = store();
    // A vision provider measured at 9s TTFT and 8 tokens/sec: a 400-token
    // answer needs ~50s more, far past any interactive budget.
    for (let i = 0; i < 3; i++) {
      s.record(sample({ providerId: 'custom', modelId: 'gw/m', networkProfileId: 'n',
        route: 'vision', workload: 'vision', ttftMs: 9_000, generationRateTps: 8 }));
    }
    __setProviderPerformanceStore(s);
    __setRuntimeSignals(new RuntimeSignals({ readNetwork: () => ({ id: 'n', interfaceClass: 'wifi', offline: false }) }));
    try { return fn(); } finally {
      __setProviderPerformanceStore(null);
      __setRuntimeSignals(null);
      if (prev === undefined) delete process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE;
      else process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = prev;
      if (prevImg === undefined) delete process.env.NATIVELY_ADAPTIVE_IMAGE_QUALITY;
      else process.env.NATIVELY_ADAPTIVE_IMAGE_QUALITY = prevImg;
    }
  }

  const helper = { performanceIdentity: () => ({ providerId: 'custom', modelId: 'gw/m', route: 'vision', isOllama: false }) };

  test('with its flag OFF (the default) nothing is ever downgraded', () => {
    // The kill switch a user seeing blurrier screenshots needs.
    const prev = process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE;
    process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = '1';
    delete process.env.NATIVELY_ADAPTIVE_IMAGE_QUALITY;
    const s = store();
    for (let i = 0; i < 3; i++) {
      s.record(sample({ providerId: 'custom', modelId: 'gw/m', networkProfileId: 'n',
        route: 'vision', workload: 'vision', ttftMs: 9_000, generationRateTps: 8 }));
    }
    __setProviderPerformanceStore(s);
    __setRuntimeSignals(new RuntimeSignals({ readNetwork: () => ({ id: 'n', interfaceClass: 'wifi', offline: false }) }));
    assert.equal(imageProfileForTurn('balanced', { llmHelper: helper, inputTokens: 2000 }), 'balanced');
    __setProviderPerformanceStore(null);
    __setRuntimeSignals(null);
    if (prev === undefined) delete process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE;
    else process.env.NATIVELY_PROVIDER_PERFORMANCE_PROFILE = prev;
  });

  test('a slow vision provider downgrades balanced → fast', () => {
    withSlowVisionProvider(() => {
      assert.equal(imageProfileForTurn('balanced', { llmHelper: helper, inputTokens: 2000 }), 'fast');
    });
  });

  test('a TECHNICAL screenshot is never downgraded, however slow', () => {
    // A code screenshot is sent BECAUSE the text must be readable. Trading its
    // legibility for latency answers a different question than the user asked.
    withSlowVisionProvider(() => {
      assert.equal(imageProfileForTurn('technical', { llmHelper: helper, inputTokens: 2000 }), 'technical');
    });
  });

  test('with no evidence the caller’s own choice is returned unchanged', () => {
    for (const p of ['fast', 'balanced', 'technical', 'best']) {
      assert.equal(imageProfileForTurn(p, { llmHelper: helper, inputTokens: 2000 }), p);
      assert.equal(imageProfileForTurn(p, { llmHelper: null, inputTokens: 2000 }), p);
    }
  });

  test('a broken helper fails open to the requested profile', () => {
    const bad = { performanceIdentity: () => { throw new Error('boom'); } };
    assert.equal(imageProfileForTurn('best', { llmHelper: bad, inputTokens: 100 }), 'best');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('routing readiness (Phase 19) — the profile can answer, without being wired', () => {
  const { rankProvidersFor } = M;

  // Phase 19's own example, built as data:
  //   Provider A — normal workload excellent, large context poor
  //   Provider B — normal average,            large context excellent
  //   Provider C — vision excellent
  function scenario() {
    const s = store();
    const put = (providerId, workload, ttftMs, ok, bad) => {
      for (let i = 0; i < ok; i++) {
        s.record(sample({ providerId, modelId: 'm', networkProfileId: 'n', workload, ttftMs }));
      }
      for (let i = 0; i < bad; i++) {
        s.record(sample({ providerId, modelId: 'm', networkProfileId: 'n', workload,
          sampleClass: 'timeout', ttftMs: null, totalMs: null, maxGapMs: null, p50GapMs: null }));
      }
    };
    put('A', 'small', 400, 20, 0);      // excellent small
    put('A', 'large', 9_000, 3, 9);     // poor large: slow AND failing
    put('B', 'small', 2_200, 20, 0);    // average small
    put('B', 'large', 1_500, 20, 0);    // excellent large
    put('C', 'vision', 700, 20, 0);     // excellent vision
    return s.all();
  }

  test('it answers "who is best for a SMALL request"', () => {
    const ranked = rankProvidersFor(scenario(), 'small');
    assert.equal(ranked[0].providerId, 'A', 'A is excellent on small');
    assert.ok(ranked.findIndex((r) => r.providerId === 'B') > 0);
  });

  test('it answers "who is best for a LARGE request" — and it is a different provider', () => {
    // The whole point of the phase: the answer must be able to DIFFER by
    // workload, or the profile cannot inform routing at all.
    const ranked = rankProvidersFor(scenario(), 'large');
    assert.equal(ranked[0].providerId, 'B', 'B is excellent on large');
    const a = ranked.find((r) => r.providerId === 'A');
    assert.ok(a.successRate < 0.5, `A's large-context reliability is poor: ${a.successRate}`);
    assert.ok(ranked.indexOf(a) > 0, 'A must not lead the large ranking');
  });

  test('it answers "who is best for VISION"', () => {
    const ranked = rankProvidersFor(scenario(), 'vision');
    assert.equal(ranked[0].providerId, 'C');
    assert.equal(ranked[0].ttftMaxMs, 700);
  });

  test('reliability outranks latency — a fast, flaky provider does not lead', () => {
    const s = store();
    for (let i = 0; i < 20; i++) s.record(sample({ providerId: 'flaky', modelId: 'm', networkProfileId: 'n', ttftMs: 300 }));
    for (let i = 0; i < 20; i++) s.record(sample({ providerId: 'flaky', modelId: 'm', networkProfileId: 'n',
      sampleClass: 'server_error', ttftMs: null, totalMs: null, maxGapMs: null, p50GapMs: null }));
    for (let i = 0; i < 20; i++) s.record(sample({ providerId: 'steady', modelId: 'm', networkProfileId: 'n', ttftMs: 1_500 }));
    const ranked = rankProvidersFor(s.all(), 'small');
    assert.equal(ranked[0].providerId, 'steady',
      'a provider that answers in 300ms and fails half the time must not lead');
  });

  test('unmeasured providers sort LAST as a group, and are not dropped', () => {
    // "We have no evidence" is a different answer from "it is slow", and a
    // caller choosing a fallback order needs to see the difference.
    const s = store();
    for (let i = 0; i < 5; i++) s.record(sample({ providerId: 'known', modelId: 'm', networkProfileId: 'n', ttftMs: 800 }));
    s.setCapabilities('unknown', 'm', 'n', { streaming: true, vision: 'unknown', tools: 'unknown',
      structuredOutput: 'unknown', contextWindowTokens: 0, source: 'unknown' });
    const ranked = rankProvidersFor(s.all(), 'small');
    assert.equal(ranked.length, 2, 'the unmeasured provider is still listed');
    assert.equal(ranked[0].providerId, 'known');
    assert.equal(ranked[1].ttftMaxMs, null);
  });

  test('the ranking is NOT wired into the fallback engine, and the reason is recorded', async () => {
    // Phase 19 asks that the profile be ABLE to answer routing questions, not
    // that routing be built. The blocker is concrete: the engine orders rungs by
    // id, and 'custom' is shared by two different gateways, so there is no sound
    // rung → profile mapping to seed from.
    const fs = await import('node:fs');
    const deadlines = fs.readFileSync(new URL('../performance/deadlines.ts', import.meta.url), 'utf8');
    assert.match(deadlines, /NOT WIRED INTO THE FALLBACK ENGINE/);
    const vision = fs.readFileSync(new URL('../visionStreamFallback.ts', import.meta.url), 'utf8');
    assert.ok(!/performance\//.test(vision), 'the fallback engine must not import the profile layer');
    const text = fs.readFileSync(new URL('../textStreamFallback.ts', import.meta.url), 'utf8');
    assert.ok(!/performance\//.test(text), 'the text fallback wrapper must not either');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('connect evidence END TO END — the seam the pure-function tests missed', () => {
  // The earlier connect tests exercise connectTimeoutMs as a pure function over
  // an INJECTED profile. They never run recordConnect → read → widen, and never
  // round-trip through disk, which is precisely where three real defects lived.
  const { connectTimeoutMs, CONNECT_MIN_TIMEOUT_MS, PROFILE_STALE_AFTER_MS } = M;
  const fsp = fs;

  test('a connect sample written is a connect sample READ, on a fresh identity', () => {
    // The bug: lookup() gates on sampleCount > 0, which counts LATENCY samples.
    // A brand-new identity with connect evidence and no committed turns failed
    // that gate, so the widening was dead until some unrelated turn bumped it.
    const s = store();
    for (let i = 0; i < 3; i++) s.recordConnect('custom', 'gw/m', 'net1', 'user_endpoint', 3_000);
    assert.equal(s.getExact('custom', 'gw/m', 'net1').sampleCount, 0, 'no latency samples yet');
    const ev = s.connectEvidence('custom', 'gw/m', 'net1');
    assert.ok(ev, 'connect evidence must be readable without any latency sample');
    assert.equal(connectTimeoutMs(ev).valueMs, 6_000);
  });

  test('connect NEVER falls back to another network', () => {
    // A handshake time is a property of THIS network. Serving a sibling's is
    // worse than serving none — and lookup()'s ladder would have done exactly
    // that once any sibling row existed.
    const s = store();
    for (let i = 0; i < 3; i++) s.recordConnect('custom', 'gw/m', 'fast-office', 'user_endpoint', 100);
    assert.equal(s.connectEvidence('custom', 'gw/m', 'slow-hotel'), null,
      'an unmeasured network must not inherit another network’s connect time');
    assert.equal(connectTimeoutMs(s.connectEvidence('custom', 'gw/m', 'slow-hotel')).valueMs,
      CONNECT_MIN_TIMEOUT_MS, 'it falls back to the shipped value, not to a sibling');
  });

  test('a connect sample does NOT resurrect months-old latency evidence', () => {
    // The bug: recordConnect refreshed `lastUpdated`, which isStale() reads. One
    // handshake made a 200-day-old profile look fresh, and adaptiveTtft /
    // streamIdle then sized live deadlines from 200-day-old samples.
    let now = 1_000_000_000;
    const s = store({ now: () => now });
    for (let i = 0; i < 10; i++) s.record(sample({ ttftMs: 11_000 }));
    assert.ok(s.lookup('custom', 'gw/model-a', 'net1'), 'fresh while fresh');

    now += PROFILE_STALE_AFTER_MS + 1;
    assert.equal(s.lookup('custom', 'gw/model-a', 'net1'), null, 'stale latency is not a deadline source');

    s.recordConnect('custom', 'gw/model-a', 'net1', 'user_endpoint', 200);
    assert.equal(s.lookup('custom', 'gw/model-a', 'net1'), null,
      'a connect measurement must NOT make stale latency evidence usable again');
    // …but the connect evidence it just wrote IS usable, on its own clock.
    assert.ok(s.connectEvidence('custom', 'gw/model-a', 'net1'), 'connect ages on its own clock');
  });

  test('eviction still discards the profile with the stalest EVIDENCE', () => {
    // The bug: a connect-only row (sampleCount 0) bumped lastUpdated and so
    // outranked a 50-sample row, breaking MAX_PROFILES' documented contract.
    let now = 1_000;
    const s = store({ now: () => now });
    for (let i = 0; i < 50; i++) s.record(sample({ modelId: 'valuable', ttftMs: 900 }));
    const valuableStamp = s.getExact('custom', 'valuable', 'net1').lastUpdated;
    now += 10_000;
    s.recordConnect('custom', 'worthless', 'net1', 'user_endpoint', 100);
    const worthlessStamp = s.getExact('custom', 'worthless', 'net1').lastUpdated;
    assert.ok(worthlessStamp <= valuableStamp + 10_000);
    // The connect-only row must not have a NEWER lastUpdated than the 50-sample
    // row purely by virtue of one handshake.
    s.recordConnect('custom', 'valuable', 'net1', 'user_endpoint', 100);
    assert.equal(s.getExact('custom', 'valuable', 'net1').lastUpdated, valuableStamp,
      'a connect write must not move the latency-evidence timestamp');
  });

  test('a wipe drops a connect sample from a request already in flight', () => {
    const s = store();
    s.recordConnect('custom', 'gw/m', 'net1', 'user_endpoint', 3_000);
    assert.ok(s.connectEvidence('custom', 'gw/m', 'net1'));
    s.clear();
    assert.equal(s.connectEvidence('custom', 'gw/m', 'net1'), null, 'forget means forget');
  });

  test('connect evidence survives a restart, through the real file', () => {
    const dir = fsp.mkdtempSync(path.join(os.tmpdir(), 'perf-connect-'));
    const a = new ProviderPerformanceStore({ storageDir: dir });
    for (let i = 0; i < 4; i++) a.recordConnect('custom', 'gw/m', 'net1', 'user_endpoint', 2_800);
    a.dispose();

    const b = new ProviderPerformanceStore({ storageDir: dir });
    const ev = b.connectEvidence('custom', 'gw/m', 'net1');
    assert.ok(ev, 'the optional connect field must persist with no schema bump');
    assert.equal(ev.connect.count, 4);
    assert.equal(connectTimeoutMs(ev).valueMs, 5_600, 'and still widen after a restart');
  });
});
