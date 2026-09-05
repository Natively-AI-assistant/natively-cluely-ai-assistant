// electron/llm/__tests__/VisionDeadlineAndAbortCommit2026_09_05.test.mjs
//
// Two regressions from a real user session (natively_debug (3).log, v2.8.8,
// one meeting, 33 screenshot turns on a Custom/OpenRouter provider). 7 of the
// 33 turns (21%) showed the user:
//
//     "The model did not produce an answer in time, so I won't guess from your
//      profile."
//
// and each one was logged as
//
//     [Vision] committed to Custom (OpenRouter) (attempt 1/3, ttft=13043ms)
//
// — a "commit" for a turn that delivered zero tokens.
//
// (1) THE CEILING. LIVE_TOTAL_HARD_TIMEOUT_MS is 13000 for a documented reason:
//     "the server's 10s cutover + 3s for the next leg", where "the server" is
//     natively-api. A user on their own OpenRouter key never reaches that
//     server, so the number was being applied for a reason that did not hold —
//     and it truncated the vision layer's own budget (ttftTimeoutMs 20_000,
//     "Vision TTFT is slower than text"). Measured TTFT that session: p50 5.6s,
//     max SUCCESSFUL 11.6s. A 13.0s ceiling sits 1.4s above the observed tail.
//
// (2) THE COMMIT. runStreamingVisionFallback decided "did we get a first token?"
//     from the chunk alone. On the aborted turns LLMHelper.streamWithCustom's
//     catch yielded "Error streaming from custom provider." in response to the
//     abort itself, which read as a token — so the engine recorded a healthy
//     13s commit for a failure, poisoning the provider-health EWMA and hiding
//     the failures from every answer-delivery metric.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The bundle is CJS; esbuild's output defeats Node's named-export detection for
// these entries, so require() rather than a named import (same pattern as the
// other dist-electron-backed suites in this directory).
const dist = createRequire(import.meta.url);
const {
  totalHardTimeoutMs,
  LIVE_TOTAL_HARD_TIMEOUT_MS,
  LIVE_VISION_TOTAL_HARD_TIMEOUT_MS,
  LIVE_LOCAL_TOTAL_HARD_TIMEOUT_MS,
} = dist('../../../dist-electron/electron/llm/index.js');
const {
  runStreamingVisionFallback,
  DEFAULT_VISION_FALLBACK_CONFIG,
} = dist('../../../dist-electron/electron/llm/visionStreamFallback.js');

// The tail this ceiling has to cover, taken from the session above.
const OBSERVED_MAX_SUCCESSFUL_TTFT_MS = 11_629;

describe('vision turns get a ceiling that is not derived from the natively cascade', () => {
  test('a screenshot turn on a non-cascade provider uses the vision ceiling', () => {
    assert.equal(
      totalHardTimeoutMs({ isVisionTurn: true, viaServerCascade: false }),
      LIVE_VISION_TOTAL_HARD_TIMEOUT_MS,
    );
  });

  test('a screenshot turn routed THROUGH natively-api keeps 13000', () => {
    // LIVE_TOTAL_HARD_TIMEOUT_MS encodes that server's cutover ordering, which
    // DeadlineBudgetOrdering2026_08_10 pins. On that route it is still correct.
    assert.equal(
      totalHardTimeoutMs({ isVisionTurn: true, viaServerCascade: true }),
      LIVE_TOTAL_HARD_TIMEOUT_MS,
    );
  });

  test('a text turn is unchanged on both routes', () => {
    assert.equal(totalHardTimeoutMs({}), LIVE_TOTAL_HARD_TIMEOUT_MS);
    assert.equal(totalHardTimeoutMs({ viaServerCascade: true }), LIVE_TOTAL_HARD_TIMEOUT_MS);
  });

  test('local still wins over the vision case', () => {
    // A cold Ollama load is slower than any cloud vision prefill; the local
    // budget must not be narrowed by the new branch.
    assert.equal(
      totalHardTimeoutMs({ isLocal: true, isVisionTurn: true }),
      LIVE_LOCAL_TOTAL_HARD_TIMEOUT_MS,
    );
  });

  test('the vision ceiling actually clears the measured tail, with margin', () => {
    // The bug was not "13000 is small", it was "13000 is 1.4s above the tail".
    // Pin the property, not the number, so a future edit that re-narrows the
    // ceiling fails here instead of in a user session.
    assert.ok(
      LIVE_VISION_TOTAL_HARD_TIMEOUT_MS >= OBSERVED_MAX_SUCCESSFUL_TTFT_MS + 5000,
      `vision ceiling ${LIVE_VISION_TOTAL_HARD_TIMEOUT_MS}ms leaves only `
      + `${LIVE_VISION_TOTAL_HARD_TIMEOUT_MS - OBSERVED_MAX_SUCCESSFUL_TTFT_MS}ms over the observed `
      + `${OBSERVED_MAX_SUCCESSFUL_TTFT_MS}ms tail — need >= 5000ms`,
    );
    assert.ok(
      LIVE_VISION_TOTAL_HARD_TIMEOUT_MS >= DEFAULT_VISION_FALLBACK_CONFIG.ttftTimeoutMs,
      'the ceiling must not truncate the vision chain\'s own per-attempt budget',
    );
  });
});

describe('an aborted vision attempt is not a commit', () => {
  /** Mirrors LLMHelper.streamWithCustom: on a caller abort its catch used to yield. */
  function providerThatYieldsOnAbort(delayMs) {
    return async function* (sig) {
      await new Promise((res) => {
        const t = setTimeout(res, delayMs);
        sig?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
      });
      yield sig?.aborted ? 'Error streaming from custom provider.' : 'A real answer.';
    };
  }

  test('the outer deadline firing mid-first-chunk does NOT mark the provider healthy', async () => {
    const health = new Map();
    const logs = [];
    const ctrl = new AbortController();
    const stream = runStreamingVisionFallback(
      [{ id: 'custom', name: 'Custom (OpenRouter)', isLocal: false, priority: 100, open: (s) => providerThatYieldsOnAbort(5000)(s) }],
      { ...DEFAULT_VISION_FALLBACK_CONFIG, maxAttempts: 1 },
      health,
      { log: (m) => logs.push(m), warn: (m) => logs.push(m) },
      ctrl.signal,
    );

    // The consumer gives up first — exactly what raceStreamWithDeadline does.
    setTimeout(() => ctrl.abort(), 150);

    const out = [];
    for await (const chunk of stream) out.push(chunk);

    assert.deepEqual(out, [], 'a stream the consumer abandoned must yield nothing');
    assert.equal(health.size, 0, `health must stay empty, got ${JSON.stringify([...health])}`);
    assert.ok(
      !logs.some((l) => l.includes('committed to')),
      `must not log a commit for an abandoned turn, got: ${JSON.stringify(logs)}`,
    );
  });

  test('a genuinely fast provider still commits and records its TTFT', async () => {
    // Guard the fix from over-reach: the abort check must not suppress a normal
    // commit on a healthy stream.
    const health = new Map();
    const logs = [];
    const stream = runStreamingVisionFallback(
      [{ id: 'custom', name: 'Custom (OpenRouter)', isLocal: false, priority: 100, open: () => providerThatYieldsOnAbort(0)() }],
      { ...DEFAULT_VISION_FALLBACK_CONFIG, maxAttempts: 1 },
      health,
      { log: (m) => logs.push(m) },
      new AbortController().signal,
    );
    const out = [];
    for await (const chunk of stream) out.push(chunk);

    assert.deepEqual(out, ['A real answer.']);
    assert.equal(health.get('custom')?.consecutiveFails, 0);
    assert.ok(typeof health.get('custom')?.ttftEma === 'number', 'a real commit still records TTFT');
    assert.ok(logs.some((l) => l.includes('committed to')));
  });
});
