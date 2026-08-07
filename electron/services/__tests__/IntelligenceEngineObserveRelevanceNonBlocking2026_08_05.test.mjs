// electron/services/__tests__/IntelligenceEngineObserveRelevanceNonBlocking2026_08_05.test.mjs
//
// Regression for the blocking observe-only relevance classifier (PR #427
// tech-debt finding, verified 2026-08-05): the answer-relevance guard is
// observe-only by default (`answerRelevanceGuardLive` OFF — run-032 proved the
// live repair made correct answers worse), but the NLI classifier itself was
// `await`ed BEFORE the flag was consulted. Every gated conversational answer
// paid the full zero-shot-NLI inference latency (worker round-trip; seconds on
// a cold model load) purely to record a telemetry trace mark the user never
// sees. The fix branches on the flag FIRST: observe mode fires the classifier
// detached — tracked on the engine as `pendingObserveOnlyRelevanceCheck` so
// its lifecycle stays owned (no unhandled rejections, awaitable in tests and
// shutdown) — and the pipeline completes without waiting on it. Flag-ON
// (live repair) behavior is unchanged and stays awaited, covered by
// IntelligenceEngineAnswerRelevance.test.mjs.
//
// Harness mirrors IntelligenceEngineAnswerRelevance.test.mjs: real compiled
// engine + real classifier, stubbed whatToAnswerLLM stream.
import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');

// The classifier keeps its Worker thread warm by design — force-exit when the
// tests are done (same pattern as IntelligenceEngineAnswerRelevance.test.mjs).
after(() => new Promise(resolve => setTimeout(() => { process.exit(0); resolve(); }, 200)));
const require = createRequire(import.meta.url);

const FLAG = 'NATIVELY_ANSWER_RELEVANCE_GUARD_LIVE';

function makeHelper() {
  return {
    setNegotiationCoachingHandler() {},
    isUsingOllama() { return false; },
    async *streamChat() {
      throw new Error('observe mode must never request a repair stream');
    },
  };
}

async function makeEngineWithAnswer(chunks) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  session.addTranscript({
    speaker: 'system',
    text: 'Tell me about tinroof.',
    timestamp: Date.now(),
    final: true,
  });
  const engine = new IntelligenceEngine(makeHelper(), session);
  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
    },
  };
  return { engine, session };
}

describe('observe-only relevance check must not block the answer pipeline', () => {
  let prevFlag;
  beforeEach(() => { prevFlag = process.env[FLAG]; delete process.env[FLAG]; });
  afterEach(() => { if (prevFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = prevFlag; });

  test('runWhatShouldISay resolves while the detached classifier check is still pending', async () => {
    // A known no-content hallucination the classifier flags as irrelevant —
    // the exact shape whose verdict observe mode exists to record.
    const hallucination = 'This turn appears empty.';
    const { engine } = await makeEngineWithAnswer([hallucination]);
    const finals = [];
    engine.on('suggested_answer', answer => finals.push(answer));

    const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

    // Answer unchanged, exactly as the observe-only contract requires.
    assert.equal(answer, hallucination);
    assert.deepEqual(finals, [hallucination]);

    // The detached check is tracked on the engine…
    const pending = engine.pendingObserveOnlyRelevanceCheck;
    assert.ok(pending && typeof pending.then === 'function',
      'observe-mode classifier check must be tracked as pendingObserveOnlyRelevanceCheck');

    // …and had NOT completed when the pipeline resolved. The classifier is a
    // real NLI worker round-trip (cold model load here — seconds); the
    // pipeline tail after the guard is a few milliseconds, so a completed
    // check at this point means the pipeline awaited it (the bug).
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false,
      'pipeline resolution must not wait for the observe-only classifier');

    // The detached check still completes (telemetry contract) and never
    // mutates the answer or emits anything new.
    await pending;
    assert.deepEqual(finals, [hallucination]);
  });
});
