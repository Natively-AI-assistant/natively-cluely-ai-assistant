// electron/llm/__tests__/StreamObservation2026_09_08.test.mjs
//
// The `observe` hook on raceStreamWithDeadline — the single point where every
// live answer stream is measured.
//
// WHY IT IS THERE AND NOWHERE ELSE. That driver has ~18 call sites across
// IntelligenceEngine, ipcHandlers and the phone-mirror path, and it ALREADY
// holds `start`, `lastTokenAt` and the termination reason in order to do its
// job. Measuring at the call sites would mean 18 copies of a measurement that
// can drift — which is the failure this whole area keeps producing (a vision
// budget fixed on one surface and "left on the text deadline" on the other;
// eleven repair sites each carrying their own literal).
//
// The load-bearing property these tests defend is that instrumentation is
// INERT. A caller that passes no observer gets today's behaviour byte for byte,
// and an observer that throws must not be able to break a turn.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { raceStreamWithDeadline, LIVE_INTER_TOKEN_STALL_MS } =
  await import('../../../dist-electron/electron/llm/index.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Yields [value, delayBeforeIt] pairs; `hangMs` keeps the stream open at the end. */
async function* scripted(script, hangMs = 0) {
  for (const [value, delay] of script) {
    if (delay) await sleep(delay);
    yield value;
  }
  if (hangMs) await sleep(hangMs);
}

async function drive(stream, opts = {}) {
  const observations = [];
  const out = [];
  const result = await raceStreamWithDeadline({
    stream,
    firstUsefulDeadlineMs: opts.fuMs ?? 1_000,
    interTokenStallMs: opts.stallMs ?? 500,
    onToken: (v) => { out.push(v); },
    isUsefulYet: () => out.join('').length >= (opts.usefulAt ?? 1),
    observe: opts.noObserver ? undefined : (o) => observations.push(o),
    shouldAbort: opts.shouldAbort,
    ...(opts.isSpeculative ? { isSpeculative: true } : {}),
  });
  return { result, out, observations };
}

describe('the observer fires exactly once, on every termination path', () => {
  test('a healthy stream reports done, with a TTFT and its gaps', () => {
    return (async () => {
      const { result, observations } = await drive(
        scripted([['a', 60], ['b', 40], ['c', 40]]),
        { fuMs: 1_000, stallMs: 500 },
      );
      assert.equal(result, 'done');
      assert.equal(observations.length, 1, 'exactly once');
      const o = observations[0];
      assert.equal(o.reason, 'done');
      assert.equal(o.chunkCount, 3);
      assert.ok(o.ttftMs >= 50, `ttft must reflect the first chunk's delay: ${o.ttftMs}`);
      assert.equal(o.interChunkGapsMs.length, 2, 'N chunks yield N-1 gaps');
      assert.ok(o.totalMs >= o.ttftMs);
    })();
  });

  test('TTFT is NOT counted as an inter-chunk gap', () => {
    return (async () => {
      // The first interval is prefill; every later one is generation. Averaging
      // them together is how a stall guard "derived from inter-chunk latency"
      // quietly inherits the provider's prefill cost.
      const { observations } = await drive(
        scripted([['a', 300], ['b', 20], ['c', 20]]),
        { fuMs: 2_000, stallMs: 1_000 },
      );
      const o = observations[0];
      assert.ok(o.ttftMs >= 290, `ttft: ${o.ttftMs}`);
      for (const gap of o.interChunkGapsMs) {
        assert.ok(gap < 200, `a prefill-sized gap leaked into the gap list: ${gap}`);
      }
    })();
  });

  test('a provider that never speaks reports first_useful_timeout and a null TTFT', () => {
    return (async () => {
      const { result, observations } = await drive(scripted([['a', 5_000]]), { fuMs: 150 });
      assert.equal(result, 'first_useful_timeout');
      const o = observations[0];
      assert.equal(o.reason, 'first_useful_timeout');
      assert.equal(o.ttftMs, null, 'no token arrived, so there is no TTFT to claim');
      assert.equal(o.chunkCount, 0);
      assert.deepEqual(o.interChunkGapsMs, []);
    })();
  });

  test('a stream that speaks then dies reports stall_timeout WITH its TTFT', () => {
    return (async () => {
      // The distinction matters: this turn produced a real first token, so its
      // TTFT is a genuine latency observation even though the turn failed. The
      // GAPS are the part that must be discarded (the largest gap is the guard's
      // own value) — that discard is enforced in the recorder, not here.
      const { result, observations } = await drive(
        scripted([['hello there', 50]], 5_000),
        { fuMs: 1_000, stallMs: 200 },
      );
      assert.equal(result, 'stall_timeout');
      const o = observations[0];
      assert.equal(o.reason, 'stall_timeout');
      assert.ok(o.ttftMs >= 40, `a real first token happened: ${o.ttftMs}`);
      assert.equal(o.chunkCount, 1);
    })();
  });

  test('a superseded turn reports aborted, so it can be excluded from latency', () => {
    return (async () => {
      let cancel = false;
      const p = drive(scripted([['a', 30], ['b', 500]]), {
        fuMs: 5_000, stallMs: 5_000, shouldAbort: () => cancel,
      });
      setTimeout(() => { cancel = true; }, 100);
      const { result, observations } = await p;
      assert.equal(result, 'aborted');
      assert.equal(observations[0].reason, 'aborted');
    })();
  });

  test('a throwing stream reports error and still observes', () => {
    return (async () => {
      async function* boom() { yield 'a'; throw new Error('provider exploded'); }
      const observations = [];
      await assert.rejects(raceStreamWithDeadline({
        stream: boom(),
        firstUsefulDeadlineMs: 1_000,
        onToken: () => {},
        isUsefulYet: () => true,
        observe: (o) => observations.push(o),
      }));
      assert.equal(observations.length, 1);
      assert.equal(observations[0].reason, 'error');
    })();
  });

  test('the budgets the stream actually ran under are reported back', () => {
    return (async () => {
      // Diagnostics has to be able to say "this died at 8000ms" without
      // re-deriving which of five route budgets applied.
      const { observations } = await drive(scripted([['a', 20]]), { fuMs: 777, stallMs: 333 });
      assert.equal(observations[0].firstUsefulBudgetMs, 777);
      assert.equal(observations[0].interTokenStallMs, 333);
      assert.equal(observations[0].speculative, false);
    })();
  });

  test('the default stall budget is reported when the caller omits one', () => {
    return (async () => {
      const observations = [];
      await raceStreamWithDeadline({
        stream: scripted([['a', 10]]),
        firstUsefulDeadlineMs: 1_000,
        onToken: () => {},
        isUsefulYet: () => true,
        observe: (o) => observations.push(o),
      });
      assert.equal(observations[0].interTokenStallMs, LIVE_INTER_TOKEN_STALL_MS);
    })();
  });

  test('a speculative stream is flagged, because no deadline bounded it', () => {
    return (async () => {
      const { observations } = await drive(scripted([['a', 20], ['b', 20]]), { isSpeculative: true });
      assert.equal(observations[0].speculative, true);
    })();
  });
});

describe('instrumentation is inert', () => {
  test('no observer means the driver behaves exactly as before', () => {
    return (async () => {
      const { result, out } = await drive(scripted([['a', 20], ['b', 20]]), { noObserver: true });
      assert.equal(result, 'done');
      assert.deepEqual(out, ['a', 'b']);
    })();
  });

  test('an observer that THROWS cannot break the turn', () => {
    return (async () => {
      // This runs inside cleanup on the answer path. A measurement that can
      // break a turn is worse than no measurement.
      const out = [];
      const result = await raceStreamWithDeadline({
        stream: scripted([['a', 10], ['b', 10]]),
        firstUsefulDeadlineMs: 1_000,
        onToken: (v) => out.push(v),
        isUsefulYet: () => true,
        observe: () => { throw new Error('observer is broken'); },
      });
      assert.equal(result, 'done');
      assert.deepEqual(out, ['a', 'b']);
    })();
  });

  test('the observer runs AFTER onCleanup, never instead of it', () => {
    return (async () => {
      const order = [];
      await raceStreamWithDeadline({
        stream: scripted([['a', 10]]),
        firstUsefulDeadlineMs: 1_000,
        onToken: () => {},
        isUsefulYet: () => true,
        onCleanup: () => order.push('cleanup'),
        observe: () => order.push('observe'),
      });
      assert.deepEqual(order, ['cleanup', 'observe']);
    })();
  });

  test('an onCleanup that throws still lets the observation through', () => {
    return (async () => {
      const observations = [];
      const result = await raceStreamWithDeadline({
        stream: scripted([['a', 10]]),
        firstUsefulDeadlineMs: 1_000,
        onToken: () => {},
        isUsefulYet: () => true,
        onCleanup: () => { throw new Error('cleanup is broken'); },
        observe: (o) => observations.push(o),
      });
      assert.equal(result, 'done');
      assert.equal(observations.length, 1);
    })();
  });

  test('an empty stream is observed with a null TTFT and no gaps', () => {
    return (async () => {
      const { result, observations } = await drive(scripted([]), { fuMs: 500 });
      assert.equal(result, 'done');
      assert.equal(observations[0].ttftMs, null);
      assert.equal(observations[0].chunkCount, 0);
    })();
  });

  test('empty-string chunks still count as chunks, so gaps stay honest', () => {
    return (async () => {
      // raceStreamWithDeadline forwards every yielded value unfiltered — an
      // empty chunk resets `lastTokenAt` and therefore IS a real interval. A
      // gap list that silently skipped them would over-report the true gap.
      const { observations } = await drive(scripted([['', 20], ['', 20], ['x', 20]]), { usefulAt: 1 });
      assert.equal(observations[0].chunkCount, 3);
      assert.equal(observations[0].interChunkGapsMs.length, 2);
    })();
  });
});
