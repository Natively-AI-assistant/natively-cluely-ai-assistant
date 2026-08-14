// electron/llm/__tests__/VisionStreamFallback.test.mjs
//
// Tests the unified streaming vision-fallback state machine — the core that
// makes screenshot analysis robust across OpenAI / Claude / Gemini / Groq /
// custom / Ollama. Loads the compiled JS from dist-electron like other __tests__.
//
// Focus areas:
//   1. classifyVisionError — error → bucket mapping that drives retry vs skip.
//   2. orderVisionByHealth — speed/priority ordering + circuit-breaker demotion.
//   3. runStreamingVisionFallback — the "commit point" pattern: silent
//      pre-first-token fallback, no-switch after commit, retries, auth skip,
//      graceful exhaustion, abort, TTFT timeout.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/visionStreamFallback.js');
const {
  classifyVisionError,
  orderVisionByHealth,
  runStreamingVisionFallback,
  openHedged,
  markVisionUnhealthy,
  markVisionHealthy,
  recordVisionTtft,
  DEFAULT_VISION_FALLBACK_CONFIG,
} = await import(pathToFileURL(modPath).href);

// ── Fake-provider helpers ───────────────────────────────────────────────────

function okProvider(id, tokens, opts = {}) {
  return {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    ...(opts.ttftTimeoutMs !== undefined ? { ttftTimeoutMs: opts.ttftTimeoutMs } : {}),
    _calls: 0,
    open(_signal, _attempt) {
      this._calls++;
      const firstDelayMs = opts.firstDelayMs ?? 0;
      return (async function* () {
        if (firstDelayMs > 0) await new Promise((r) => setTimeout(r, firstDelayMs));
        for (const t of tokens) yield t;
      })();
    },
  };
}

// Throws before yielding anything (pre-commit failure).
function throwBeforeFirst(id, errMessage, opts = {}) {
  const p = {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    _calls: 0,
    open(_signal, _attempt) {
      this._calls++;
      return (async function* () { throw new Error(errMessage); })();
    },
  };
  return p;
}

// Yields `firstTokens`, commits, then throws mid-stream (post-commit failure).
function throwAfterFirst(id, firstTokens, errMessage, opts = {}) {
  return {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    _calls: 0,
    open(_signal, _attempt) {
      this._calls++;
      return (async function* () {
        for (const t of firstTokens) yield t;
        throw new Error(errMessage);
      })();
    },
  };
}

// First token never arrives until the per-attempt signal aborts (TTFT timeout).
function neverFirst(id, opts = {}) {
  return {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    _calls: 0,
    open(signal, _attempt) {
      this._calls++;
      return (async function* () {
        await new Promise((resolve, reject) => {
          if (signal.aborted) return reject(new Error('aborted'));
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        yield 'too-late';
      })();
    },
  };
}

// Fails the first N attempts (pre-commit), succeeds afterwards.
function flakyProvider(id, failCount, tokens, errMessage, opts = {}) {
  return {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    _calls: 0,
    open(_signal, _attempt) {
      this._calls++;
      const calls = this._calls;
      return (async function* () {
        if (calls <= failCount) throw new Error(errMessage);
        for (const t of tokens) yield t;
      })();
    },
  };
}

async function collect(gen) {
  const out = [];
  for await (const c of gen) out.push(c);
  return out;
}

// Deterministic, instant-retry hooks: fixed clock, zero jitter, no real sleep.
function fastHooks(extra = {}) {
  return { now: () => 1_000_000, random: () => 0, sleep: async () => {}, log: () => {}, warn: () => {}, ...extra };
}

const CFG = DEFAULT_VISION_FALLBACK_CONFIG;

// ════════════════════════════════════════════════════════════════════════════
describe('classifyVisionError', () => {
  test('timedOut flag short-circuits to timeout', () => {
    assert.equal(classifyVisionError(new Error('whatever'), true), 'timeout');
  });
  test('expired API key → auth', () => {
    assert.equal(classifyVisionError(new Error('API key expired. Please renew the API key.'), false), 'auth');
  });
  test('401 / 403 / quota → auth', () => {
    assert.equal(classifyVisionError({ status: 401, message: 'Unauthorized' }, false), 'auth');
    assert.equal(classifyVisionError(new Error('insufficient_quota'), false), 'auth');
  });
  test('429 → rate', () => {
    assert.equal(classifyVisionError(new Error('429 Too Many Requests'), false), 'rate');
  });
  test('ECONNRESET / fetch failed → network', () => {
    assert.equal(classifyVisionError(new Error('fetch failed: ECONNRESET'), false), 'network');
  });
  test('413 / too large → payload', () => {
    assert.equal(classifyVisionError(new Error('413 payload too large'), false), 'payload');
  });
  test('does not support images → no_vision', () => {
    assert.equal(classifyVisionError(new Error('model does not support image input'), false), 'no_vision');
  });
  test('503 / overloaded → server', () => {
    assert.equal(classifyVisionError(new Error('503 Service Unavailable'), false), 'server');
    assert.equal(classifyVisionError(new Error('overloaded'), false), 'server');
  });
  test('unrecognized → unknown', () => {
    assert.equal(classifyVisionError(new Error('weird'), false), 'unknown');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('orderVisionByHealth', () => {
  const mk = (id, priority) => ({ id, priority });

  test('no measurements → priority order preserved', () => {
    const list = [mk('a', 0), mk('b', 1), mk('c', 2)];
    const out = orderVisionByHealth(list, new Map(), 1000);
    assert.deepEqual(out.map(p => p.id), ['a', 'b', 'c']);
  });

  test('among MEASURED providers, the faster one leads regardless of priority', () => {
    // The "rearrange the queue by speed" guarantee applies once we have data
    // for the providers being compared. Here both are measured; the slower
    // higher-priority one is demoted behind the faster lower-priority one.
    const list = [mk('a', 0), mk('b', 1)];
    const health = new Map();
    recordVisionTtft(health, 'a', 4000); // a measured slow
    recordVisionTtft(health, 'b', 500);  // b measured fast
    const out = orderVisionByHealth(list, health, 1000);
    assert.deepEqual(out.map(p => p.id), ['b', 'a']);
  });

  test('an unmeasured higher-priority provider is NOT buried behind a measured slow one', () => {
    // Reviewer-flagged: a single slow measurement must not demote an untried
    // higher-priority provider. Mixed measured/unmeasured keeps priority order.
    const list = [mk('a', 0), mk('b', 1)];
    const health = new Map();
    recordVisionTtft(health, 'b', 6000); // b measured slow; a untried (priority 0)
    const out = orderVisionByHealth(list, health, 1000);
    assert.deepEqual(out.map(p => p.id), ['a', 'b']);
  });

  test('OPEN-breaker provider demoted to back', () => {
    const list = [mk('a', 0), mk('b', 1)];
    const health = new Map();
    markVisionUnhealthy(health, 'a', 30_000, 1000); // a cooling until 31000
    const out = orderVisionByHealth(list, health, 1000);
    assert.deepEqual(out.map(p => p.id), ['b', 'a']);
  });

  test('all cooling → still returned (never fail closed), in priority order', () => {
    const list = [mk('a', 0), mk('b', 1)];
    const health = new Map();
    markVisionUnhealthy(health, 'a', 30_000, 1000);
    markVisionUnhealthy(health, 'b', 30_000, 1000);
    const out = orderVisionByHealth(list, health, 1000);
    assert.deepEqual(out.map(p => p.id), ['a', 'b']);
  });

  test('cooldown expires → provider returns to live set', () => {
    const list = [mk('a', 0)];
    const health = new Map();
    markVisionUnhealthy(health, 'a', 30_000, 1000); // openUntil 31000
    const out = orderVisionByHealth(list, health, 40_000); // past cooldown
    assert.deepEqual(out.map(p => p.id), ['a']);
    assert.ok((health.get('a').openUntil) <= 40_000);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('runStreamingVisionFallback — commit point + fallback', () => {
  test('single provider succeeds → yields all tokens', async () => {
    const p = okProvider('openai', ['Hel', 'lo', '!']);
    const health = new Map();
    const out = await collect(runStreamingVisionFallback([p], CFG, health, fastHooks()));
    assert.deepEqual(out, ['Hel', 'lo', '!']);
    assert.equal(p._calls, 1);
  });

  test('first provider fails pre-commit → SILENT fallback, no partial output', async () => {
    const a = throwBeforeFirst('openai', 'fetch failed');
    const b = okProvider('claude', ['hi']);
    const health = new Map();
    const out = await collect(runStreamingVisionFallback([a, b], CFG, health, fastHooks()));
    // Nothing leaked from `a`; only b's tokens.
    assert.deepEqual(out, ['hi']);
  });

  test('auth failure → provider marked unhealthy and skipped (no retry)', async () => {
    const a = throwBeforeFirst('gemini_flash', 'API key expired');
    const b = okProvider('openai', ['ok']);
    const health = new Map();
    const out = await collect(runStreamingVisionFallback([a, b], CFG, health, fastHooks()));
    assert.deepEqual(out, ['ok']);
    assert.equal(a._calls, 1, 'auth error must NOT retry the same provider');
    assert.ok(health.get('gemini_flash').openUntil > 0, 'breaker opened for auth failure');
  });

  test('transient failure retries up to maxAttempts then moves on', async () => {
    // Fails twice (network), succeeds on 3rd attempt.
    const a = flakyProvider('openai', 2, ['done'], 'ECONNRESET');
    const health = new Map();
    const out = await collect(runStreamingVisionFallback([a], CFG, health, fastHooks()));
    assert.deepEqual(out, ['done']);
    assert.equal(a._calls, 3, 'should retry to the 3rd attempt');
  });

  test('exhausting all attempts on every provider → throws', async () => {
    const a = throwBeforeFirst('openai', 'ECONNRESET');
    const b = throwBeforeFirst('claude', 'ECONNRESET');
    const health = new Map();
    await assert.rejects(
      collect(runStreamingVisionFallback([a, b], CFG, health, fastHooks())),
      /All vision providers failed/,
    );
    assert.equal(a._calls, CFG.maxAttempts);
    assert.equal(b._calls, CFG.maxAttempts);
  });

  test('post-commit failure → keeps delivered tokens, does NOT switch providers', async () => {
    const a = throwAfterFirst('openai', ['par', 'tial'], 'stream broke');
    const b = okProvider('claude', ['SHOULD-NOT-APPEAR']);
    const health = new Map();
    const out = await collect(runStreamingVisionFallback([a, b], CFG, health, fastHooks()));
    assert.deepEqual(out, ['par', 'tial'], 'delivers what arrived before the break');
    assert.equal(b._calls, 0, 'must not switch providers after commit (would duplicate)');
  });

  test('empty-stream first provider → falls back', async () => {
    const a = okProvider('openai', []); // yields nothing → empty-stream
    const b = okProvider('claude', ['recovered']);
    const health = new Map();
    const out = await collect(runStreamingVisionFallback([a, b], CFG, health, fastHooks()));
    assert.deepEqual(out, ['recovered']);
  });

  test('no providers configured → throws config error', async () => {
    await assert.rejects(
      collect(runStreamingVisionFallback([], CFG, new Map(), fastHooks())),
      /No vision-capable provider configured/,
    );
  });

  test('already-aborted signal → yields nothing, no provider called', async () => {
    const a = okProvider('openai', ['x']);
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await collect(runStreamingVisionFallback([a], CFG, new Map(), fastHooks(), ctrl.signal));
    assert.deepEqual(out, []);
    assert.equal(a._calls, 0);
  });

  test('TTFT timeout → aborts slow provider and falls back', async () => {
    const slow = neverFirst('openai');
    const fast = okProvider('claude', ['fast']);
    const health = new Map();
    // Tight TTFT + single attempt so the test is quick.
    const cfg = { ...CFG, maxAttempts: 1, ttftTimeoutMs: 40 };
    const out = await collect(runStreamingVisionFallback([slow, fast], cfg, health, fastHooks()));
    assert.deepEqual(out, ['fast']);
    assert.ok(health.get('openai').openUntil > 0, 'slow provider breaker opened on timeout');
  });

  test('per-provider ttftTimeoutMs overrides the config default', async () => {
    // Provider takes ~80ms to first token. cfg default is 40ms (would abort),
    // but the provider declares its own 5000ms budget → must commit, not fail over.
    const slowButAllowed = okProvider('gemini_pro', ['pro-answer'], { firstDelayMs: 80, ttftTimeoutMs: 5_000 });
    const backup = okProvider('natively', ['backup']);
    const cfg = { ...CFG, maxAttempts: 1, ttftTimeoutMs: 40 };
    // real timers so the 80ms delay actually elapses against the 5000ms budget
    const out = await collect(runStreamingVisionFallback([slowButAllowed, backup], cfg, new Map(),
      { now: () => Date.now(), random: () => 0, sleep: async () => {}, log: () => {}, warn: () => {} }));
    assert.deepEqual(out, ['pro-answer'], 'provider with its own generous ttft budget should commit, not time out');
    assert.equal(backup._calls, 0, 'backup must not be reached');
  });

  test('default config TTFT budget is generous enough for vision (>=15s)', () => {
    assert.ok(DEFAULT_VISION_FALLBACK_CONFIG.ttftTimeoutMs >= 15_000,
      `vision TTFT default should be >=15s (was the aggressive 8s bug), got ${DEFAULT_VISION_FALLBACK_CONFIG.ttftTimeoutMs}`);
  });

  test('no_vision failure opens the breaker so the dead model is demoted next time', async () => {
    const a = throwBeforeFirst('groq', 'model does not support image input');
    const b = okProvider('openai', ['ok']);
    const health = new Map();
    const out = await collect(runStreamingVisionFallback([a, b], CFG, health, fastHooks()));
    assert.deepEqual(out, ['ok']);
    assert.equal(a._calls, 1, 'no_vision must not retry');
    assert.ok(health.get('groq').openUntil > 0, 'breaker opened so it is demoted on the next request');
  });

  test('payload-too-large opens the breaker and skips to next provider', async () => {
    const a = throwBeforeFirst('openai', '413 payload too large');
    const b = okProvider('claude', ['ok']);
    const health = new Map();
    const out = await collect(runStreamingVisionFallback([a, b], CFG, health, fastHooks()));
    assert.deepEqual(out, ['ok']);
    assert.equal(a._calls, 1);
    assert.ok(health.get('openai').openUntil > 0);
  });

  test('always closes the upstream iterator on every exit path (no leak)', async () => {
    let returned = 0;
    const provider = {
      id: 'openai', name: 'openai', isLocal: false, priority: 0, _calls: 0,
      open() {
        this._calls++;
        // A proper async-iterable with a manual return() spy (mirrors how a real
        // async generator exposes [Symbol.asyncIterator] + return()).
        const iter = {
          [Symbol.asyncIterator]() { return this; },
          async next() { return { value: 'hi', done: false }; }, // infinite stream
          async return(v) { returned++; return { value: v, done: true }; },
        };
        return iter;
      },
    };
    const ctrl = new AbortController();
    const gen = runStreamingVisionFallback([provider], CFG, new Map(), fastHooks(), ctrl.signal);
    assert.equal((await gen.next()).value, 'hi'); // commit
    // Consumer abandons the stream → orchestrator generator .return() must close upstream.
    await gen.return(undefined);
    assert.equal(returned, 1, 'upstream iterator .return() called exactly once on abandon');
  });

  test('outer abort mid-attempt does not penalize the provider breaker', async () => {
    const ctrl = new AbortController();
    // Provider whose first token never arrives; we abort the OUTER signal.
    const p = {
      id: 'openai', name: 'openai', isLocal: false, priority: 0, _calls: 0,
      open(signal) {
        this._calls++;
        return (async function* () {
          await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
          yield 'late';
        })();
      },
    };
    const health = new Map();
    const gen = runStreamingVisionFallback([p], CFG, health, fastHooks(), ctrl.signal);
    const firstP = gen.next();
    ctrl.abort(); // user cancels
    const r = await firstP;
    assert.equal(r.done, true, 'generator ends on outer abort');
    assert.equal(health.get('openai'), undefined, 'no breaker penalty for a user-initiated cancel');
  });

  test('records TTFT EWMA on the committed provider', async () => {
    const p = okProvider('openai', ['hi']);
    const health = new Map();
    // now() advances so ttft = end - start > 0.
    let t = 1000;
    const hooks = { ...fastHooks(), now: () => (t += 5) };
    await collect(runStreamingVisionFallback([p], CFG, health, hooks));
    assert.ok(health.get('openai').ttftEma != null, 'ttft EWMA recorded after commit');
    assert.equal(health.get('openai').consecutiveFails, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('openHedged (tail-latency vision hedge)', () => {
  const realHooks = () => ({ now: () => Date.now(), random: () => 0, sleep: async () => {}, log: () => {}, warn: () => {} });
  // small hedge delays so tests are fast
  const hedgeCfg = (over = {}) => ({
    ...DEFAULT_VISION_FALLBACK_CONFIG, hedgeEnabled: true,
    hedgeDelayDefaultMs: 60, hedgeDelayMinMs: 40, hedgeDelayMaxMs: 120, hedgeDelayEmaFactor: 0.6,
    ...over,
  });
  // build a provider with a hedgeWith partner from two okProvider/neverFirst-like specs
  function prov(id, mk, partner) {
    const p = mk(id);
    p.hedgeWith = partner ? { id: partner.id, name: partner.id, open: (s, a) => partner.open(s, a) } : undefined;
    return p;
  }

  test('primary fast → wins solo, partner never launched (no hedge fired)', async () => {
    const partner = okProvider('gemini_flash_lite', ['lite']);
    const primary = prov('gemini_flash', (id) => okProvider(id, ['flash-fast']), partner);
    const health = new Map();
    const out = await collect(openHedged(primary, hedgeCfg(), health, realHooks(), new AbortController().signal, 1));
    assert.deepEqual(out, ['flash-fast']);
    assert.equal(partner._calls, 0, 'partner must not be launched when primary is fast');
    assert.ok(health.get('gemini_flash')?.ttftEma != null, 'TTFT recorded against the winner (flash)');
  });

  test('primary slow → hedge fires, partner wins, primary aborted', async () => {
    const partner = okProvider('gemini_flash_lite', ['lite-wins']);
    // primary delays its first token well past the hedge delay
    const primary = prov('gemini_flash', (id) => okProvider(id, ['too-slow'], { firstDelayMs: 500 }), partner);
    const health = new Map();
    const out = await collect(openHedged(primary, hedgeCfg(), health, realHooks(), new AbortController().signal, 1));
    assert.deepEqual(out, ['lite-wins']);
    assert.equal(partner._calls, 1, 'partner launched once');
    assert.ok(health.get('gemini_flash_lite')?.ttftEma != null, 'TTFT recorded against the winner (lite)');
  });

  test('primary fails fast → partner wins', async () => {
    const partner = okProvider('gemini_flash_lite', ['lite-rescue']);
    const primary = prov('gemini_flash', (id) => throwBeforeFirst(id, 'boom'), partner);
    const out = await collect(openHedged(primary, hedgeCfg(), new Map(), realHooks(), new AbortController().signal, 1));
    assert.deepEqual(out, ['lite-rescue']);
    assert.equal(partner._calls, 1);
  });

  test('both branches fail pre-token → throws (engine then advances)', async () => {
    const partner = throwBeforeFirst('gemini_flash_lite', 'lite-down');
    const primary = prov('gemini_flash', (id) => okProvider(id, ['too-slow'], { firstDelayMs: 500 }), partner);
    // make primary also fail by giving it a stream that ends empty after delay
    primary.open = (_s, _a) => (async function* () { await new Promise(r => setTimeout(r, 80)); throw new Error('flash-down'); })();
    await assert.rejects(
      () => collect(openHedged(primary, hedgeCfg(), new Map(), realHooks(), new AbortController().signal, 1)),
      /all-branches-failed|empty-stream|flash-down|lite-down/,
    );
  });

  test('partner breaker OPEN → no hedge, primary runs solo', async () => {
    const partner = okProvider('gemini_flash_lite', ['lite']);
    const primary = prov('gemini_flash', (id) => okProvider(id, ['flash-ok'], { firstDelayMs: 300 }), partner);
    const health = new Map();
    markVisionUnhealthy(health, 'gemini_flash_lite', 60_000, Date.now()); // partner cooling
    const out = await collect(openHedged(primary, hedgeCfg(), health, realHooks(), new AbortController().signal, 1));
    assert.deepEqual(out, ['flash-ok'], 'primary should win solo even though slow — partner breaker is open');
    assert.equal(partner._calls, 0, 'partner must NOT launch while its breaker is open');
  });

  test('engine integration: hedgeEnabled provider routes through openHedged', async () => {
    const partner = okProvider('gemini_flash_lite', ['lite-via-engine']);
    const primary = prov('gemini_flash', (id) => okProvider(id, ['slow'], { firstDelayMs: 500 }), partner);
    const out = await collect(runStreamingVisionFallback([primary], hedgeCfg({ maxAttempts: 1 }), new Map(), realHooks()));
    assert.deepEqual(out, ['lite-via-engine']);
  });

  test('hedge disabled → primary used directly, no partner', async () => {
    const partner = okProvider('gemini_flash_lite', ['lite']);
    const primary = prov('gemini_flash', (id) => okProvider(id, ['flash-only'], { firstDelayMs: 300 }), partner);
    const out = await collect(runStreamingVisionFallback([primary], { ...hedgeCfg(), hedgeEnabled: false, maxAttempts: 1, ttftTimeoutMs: 5000 }, new Map(), realHooks()));
    assert.deepEqual(out, ['flash-only']);
    assert.equal(partner._calls, 0, 'hedge disabled → partner never launched');
  });
});
