// electron/llm/__tests__/TextStreamFallback.test.mjs
//
// Tests the TEXT-streaming provider fallback (Phase 3 — kill the 10s wall).
// The text wrapper reuses the proven vision commit-point engine, so these
// tests focus on:
//   1. Text-tuned config (tight TTFT budget, generous inter-chunk).
//   2. The race semantics that matter for the live answer path:
//      - fastest healthy provider wins,
//      - a stalled primary fails over within the TTFT budget,
//      - a pre-commit error silently falls over,
//      - a post-commit error does NOT switch providers (no duplicate output),
//      - exhaustion throws.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/textStreamFallback.js');
const {
  runStreamingTextFallback,
  orderTextByHealth,
  DEFAULT_TEXT_FALLBACK_CONFIG,
} = await import(pathToFileURL(modPath).href);

// ── Fake providers (mirror the vision test helpers) ─────────────────────────

function okProvider(id, tokens, opts = {}) {
  return {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    _calls: 0,
    open(_signal, _attempt) {
      this._calls++;
      return (async function* () { for (const t of tokens) yield t; })();
    },
  };
}

function throwBeforeFirst(id, errMessage, opts = {}) {
  return {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    _calls: 0,
    open(_signal, _attempt) {
      this._calls++;
      return (async function* () { throw new Error(errMessage); })();
    },
  };
}

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

// First token arrives after `delayMs` (real timer), unless the per-attempt signal
// aborts first. Models a slow-prefill provider like the Natively gateway when its
// server-side chain has fallen back to MiniMax (first token 3.3-7.7s).
function slowFirst(id, delayMs, tokens, opts = {}) {
  return {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    ...(opts.ttftTimeoutMs != null ? { ttftTimeoutMs: opts.ttftTimeoutMs } : {}),
    _calls: 0,
    open(signal, _attempt) {
      this._calls++;
      return (async function* () {
        await new Promise((resolve, reject) => {
          if (signal.aborted) return reject(new Error('aborted'));
          const t = setTimeout(resolve, delayMs);
          signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
        });
        for (const tok of tokens) yield tok;
      })();
    },
  };
}

async function collect(gen) {
  const out = [];
  for await (const c of gen) out.push(c);
  return out;
}

function fastHooks(extra = {}) {
  return { now: () => 1_000_000, random: () => 0, sleep: async () => {}, log: () => {}, warn: () => {}, ...extra };
}

// ════════════════════════════════════════════════════════════════════════════
describe('DEFAULT_TEXT_FALLBACK_CONFIG', () => {
  test('has a tight TTFT budget tuned for text first-token', () => {
    assert.ok(DEFAULT_TEXT_FALLBACK_CONFIG.ttftTimeoutMs <= 3_000,
      `text TTFT budget should be tight (<=3s), got ${DEFAULT_TEXT_FALLBACK_CONFIG.ttftTimeoutMs}`);
    assert.ok(DEFAULT_TEXT_FALLBACK_CONFIG.ttftTimeoutMs < DEFAULT_TEXT_FALLBACK_CONFIG.interChunkTimeoutMs,
      'TTFT budget must be smaller than the mid-stream stall budget');
  });
  test('keeps a generous inter-chunk budget so long answers are not cut off', () => {
    assert.ok(DEFAULT_TEXT_FALLBACK_CONFIG.interChunkTimeoutMs >= 15_000);
  });
  test('orderTextByHealth is exported and orders fastest-first', () => {
    const health = new Map([
      ['a', { openUntil: 0, consecutiveFails: 0, ttftEma: 500 }],
      ['b', { openUntil: 0, consecutiveFails: 0, ttftEma: 100 }],
    ]);
    const ordered = orderTextByHealth(
      [{ id: 'a', priority: 0 }, { id: 'b', priority: 1 }],
      health, 1_000_000,
    );
    assert.equal(ordered[0].id, 'b', 'faster TTFT EWMA should be first');
  });
});

describe('runStreamingTextFallback — race semantics', () => {
  test('fastest provider that produces a token wins and streams through', async () => {
    const health = new Map();
    const natively = okProvider('natively', ['Hello', ' world']);
    const out = await collect(runStreamingTextFallback([natively], health, DEFAULT_TEXT_FALLBACK_CONFIG, fastHooks()));
    assert.deepEqual(out, ['Hello', ' world']);
    assert.equal(natively._calls, 1);
  });

  test('a pre-commit error on the primary silently falls over to the next provider', async () => {
    const health = new Map();
    const primary = throwBeforeFirst('natively', 'fetch failed');
    const fallback = okProvider('groq', ['from', ' groq']);
    const out = await collect(runStreamingTextFallback([primary, fallback], health, DEFAULT_TEXT_FALLBACK_CONFIG, fastHooks()));
    assert.deepEqual(out, ['from', ' groq'], 'fallback served, no primary artifact leaked');
    assert.equal(fallback._calls, 1);
  });

  test('a stalled primary (no first token) fails over within the TTFT budget', async () => {
    const health = new Map();
    const stalled = neverFirst('natively');
    const fallback = okProvider('groq', ['ok']);
    // Real timers here (small budget) so the TTFT abort actually fires.
    const cfg = { ...DEFAULT_TEXT_FALLBACK_CONFIG, ttftTimeoutMs: 60, maxAttempts: 1 };
    const out = await collect(runStreamingTextFallback([stalled, fallback], health, cfg, { log: () => {}, warn: () => {} }));
    assert.deepEqual(out, ['ok'], 'stalled primary timed out, fallback served');
    assert.equal(stalled._calls, 1);
  });

  test('a per-provider ttftTimeoutMs override lets a slow-first-token provider commit (MiniMax fallback regression)', async () => {
    // The Natively gateway can land on MiniMax (first token 3.3-7.7s) after the
    // Gemini chain fails. With ONLY the 2.5s default it would be aborted pre-token
    // and fail over to providers that are typically also down. A per-provider
    // ttftTimeoutMs override (mirrors LLMHelper.ts natively text entry) must let it
    // commit. Small real-timer values stand in for the real seconds.
    const health = new Map();
    // Default budget 60ms; the slow provider's first token lands at 120ms but it
    // carries a 400ms override, so it must NOT be aborted — and must win.
    const slowNatively = slowFirst('natively', 120, ['minimax answer'], { ttftTimeoutMs: 400 });
    const fallback = okProvider('groq', ['SHOULD-NOT-APPEAR']);
    const cfg = { ...DEFAULT_TEXT_FALLBACK_CONFIG, ttftTimeoutMs: 60, maxAttempts: 1 };
    const out = await collect(runStreamingTextFallback([slowNatively, fallback], health, cfg, { log: () => {}, warn: () => {} }));
    assert.deepEqual(out, ['minimax answer'], 'override let the slow gateway commit; fallback never served');
    assert.equal(fallback._calls, 0, 'fallback must not open — the override kept the slow provider alive');
  });

  test('WITHOUT the override, the same slow-first-token provider is aborted by the default budget (proves the gate is real)', async () => {
    // Control for the test above: same 120ms first token, but NO per-provider
    // override, so the 60ms default aborts it and the fallback serves. This is the
    // exact bug the override fixes.
    const health = new Map();
    const slowNatively = slowFirst('natively', 120, ['minimax answer']); // no override
    const fallback = okProvider('groq', ['fallback served']);
    const cfg = { ...DEFAULT_TEXT_FALLBACK_CONFIG, ttftTimeoutMs: 60, maxAttempts: 1 };
    const out = await collect(runStreamingTextFallback([slowNatively, fallback], health, cfg, { log: () => {}, warn: () => {} }));
    assert.deepEqual(out, ['fallback served'], 'no override → default budget aborted the slow provider');
  });

  test('a post-commit failure does NOT switch providers (no duplicate output)', async () => {
    const health = new Map();
    const committed = throwAfterFirst('natively', ['partial answer'], 'socket hangup');
    const fallback = okProvider('groq', ['SHOULD-NOT-APPEAR']);
    const out = await collect(runStreamingTextFallback([committed, fallback], health, DEFAULT_TEXT_FALLBACK_CONFIG, fastHooks()));
    assert.deepEqual(out, ['partial answer'], 'partial answer kept; no fallback duplicate');
    assert.equal(fallback._calls, 0, 'fallback never opened after commit');
  });

  test('exhaustion (all providers fail pre-commit) throws', async () => {
    const health = new Map();
    const a = throwBeforeFirst('natively', 'fetch failed');
    const b = throwBeforeFirst('groq', 'fetch failed');
    await assert.rejects(
      () => collect(runStreamingTextFallback([a, b], health, { ...DEFAULT_TEXT_FALLBACK_CONFIG, maxAttempts: 1 }, fastHooks())),
      /All vision providers failed|failed/i,
    );
  });

  test('an outer abort stops the chain without throwing', async () => {
    const health = new Map();
    const ctrl = new AbortController();
    ctrl.abort();
    const p = okProvider('natively', ['x']);
    const out = await collect(runStreamingTextFallback([p], health, DEFAULT_TEXT_FALLBACK_CONFIG, fastHooks(), ctrl.signal));
    assert.deepEqual(out, [], 'aborted before start yields nothing');
  });
});

describe('runStreamingTextFallback — stopChainOnError (shared-credential cascade abort)', () => {
  // Models the Gemini cascade: all rungs share one API key. A permanent key error
  // on the FIRST rung must abort the whole chain so the caller can switch provider,
  // instead of wasting two more doomed calls on the same dead key.
  test('a matching pre-commit error aborts the WHOLE chain (siblings never opened) and throws', async () => {
    const health = new Map();
    const flashLite = throwBeforeFirst('gemini_flash_lite', 'API key expired');
    const flash = okProvider('gemini_flash', ['SHOULD-NOT-APPEAR']);
    const pro = okProvider('gemini_pro', ['SHOULD-NOT-APPEAR']);
    const cfg = { ...DEFAULT_TEXT_FALLBACK_CONFIG, maxAttempts: 1, stopChainOnError: (err) => /expired|api key/i.test(String(err?.message)) };
    await assert.rejects(
      () => collect(runStreamingTextFallback([flashLite, flash, pro], health, cfg, fastHooks())),
      /chain aborted/i,
    );
    assert.equal(flashLite._calls, 1, 'primary attempted once');
    assert.equal(flash._calls, 0, 'sibling on the same key NOT opened');
    assert.equal(pro._calls, 0, 'sibling on the same key NOT opened');
  });

  test('a NON-matching (transient) pre-commit error still walks the cascade normally', async () => {
    const health = new Map();
    const flashLite = throwBeforeFirst('gemini_flash_lite', '429 rate limit');
    const flash = okProvider('gemini_flash', ['from flash']);
    const cfg = { ...DEFAULT_TEXT_FALLBACK_CONFIG, maxAttempts: 1, stopChainOnError: (err) => /expired|api key/i.test(String(err?.message)) };
    const out = await collect(runStreamingTextFallback([flashLite, flash], health, cfg, fastHooks()));
    assert.deepEqual(out, ['from flash'], 'transient error fell through to the next rung');
    assert.equal(flash._calls, 1);
  });

  test('without stopChainOnError (default) every rung is walked even on a key error', async () => {
    const health = new Map();
    const flashLite = throwBeforeFirst('gemini_flash_lite', 'API key expired');
    const flash = okProvider('gemini_flash', ['flash answers']);
    const cfg = { ...DEFAULT_TEXT_FALLBACK_CONFIG, maxAttempts: 1 };
    const out = await collect(runStreamingTextFallback([flashLite, flash], health, cfg, fastHooks()));
    assert.deepEqual(out, ['flash answers'], 'no abort hook → normal fall-through');
    assert.equal(flash._calls, 1);
  });
});
