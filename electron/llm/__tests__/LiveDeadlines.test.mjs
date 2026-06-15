// electron/llm/__tests__/LiveDeadlines.test.mjs
//
// Issue 1 (P0) acceptance: the live-deadline harness must abort a stalled
// provider so the live copilot never waits 10s+ or hangs forever. These are
// deterministic (no real provider) — they drive raceStreamWithDeadline with fake
// streams that stall, yield late, yield scaffold-only, or hang mid-stream.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { raceStreamWithDeadline, firstUsefulDeadlineMs,
  LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS, LIVE_INTER_TOKEN_STALL_MS } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fake provider stream. `script` is [{ delayMs, value }]; the generator yields
// each value after its delay. `hangMs` keeps it open (simulating a stalled
// provider) after the script — a few seconds is enough to prove the harness
// aborts WITHOUT waiting for the generator to unblock.
async function* fakeStream(script, hangMs = 0) {
  for (const step of script) {
    await sleep(step.delayMs);
    yield step.value;
  }
  if (hangMs) { await sleep(hangMs); }
}

// Drive the harness with a small deadline so tests run fast.
async function drive(stream, { fuMs = 300, stallMs = 300, isUsefulYet } = {}) {
  let out = '';
  const marks = [];
  const started = Date.now();
  const result = await raceStreamWithDeadline({
    stream,
    firstUsefulDeadlineMs: fuMs,
    interTokenStallMs: stallMs,
    onToken: (v) => { out += v; },
    isUsefulYet: isUsefulYet || (() => out.trim().length >= 5),
    onFirstUsefulTimeout: () => marks.push('first_useful_timeout'),
    onStallTimeout: () => marks.push('stall_timeout'),
  });
  return { result, out, marks, elapsed: Date.now() - started };
}

describe('Issue 1: live-deadline harness aborts stalled providers', () => {
  test('provider NEVER yields a first token → first_useful_timeout near the budget', async () => {
    const { result, out, elapsed } = await drive(fakeStream([], 3000), { fuMs: 250 });
    assert.equal(result, 'first_useful_timeout');
    assert.equal(out, '');
    assert.ok(elapsed < 1500, `must abort near the 250ms budget, took ${elapsed}ms`);
  });

  test('provider yields only AFTER 20s → aborted at the budget, not 3s later', async () => {
    const { result, elapsed } = await drive(fakeStream([{ delayMs: 3000, value: 'late' }], 0), { fuMs: 250 });
    assert.equal(result, 'first_useful_timeout');
    assert.ok(elapsed < 1500, `must not wait 20s, took ${elapsed}ms`);
  });

  test('provider yields scaffold-only (no useful content) → first_useful_timeout', async () => {
    // Tokens arrive but isUsefulYet stays false (only whitespace/labels).
    const { result, elapsed } = await drive(
      fakeStream([{ delayMs: 30, value: '   ' }, { delayMs: 30, value: '## ' }], 3000),
      { fuMs: 300, isUsefulYet: () => false },
    );
    assert.equal(result, 'first_useful_timeout');
    assert.ok(elapsed < 2000, `aborted near budget, took ${elapsed}ms`);
  });

  test('provider streams useful content then HANGS mid-stream → stall_timeout, keeps partial', async () => {
    const { result, out, marks } = await drive(
      fakeStream([{ delayMs: 20, value: 'Hello there, this is real content.' }], 3000),
      { fuMs: 1000, stallMs: 250 },
    );
    assert.equal(result, 'stall_timeout');
    assert.match(out, /Hello there/);
    assert.deepEqual(marks, ['stall_timeout']);
  });

  test('healthy steady stream is NEVER truncated by the inter-token guard', async () => {
    // 10 tokens, 50ms apart, total 500ms — well under any wall clock but each gap
    // < stall budget, so it must complete fully (no truncation).
    const script = Array.from({ length: 10 }, (_, i) => ({ delayMs: 50, value: `tok${i} ` }));
    const { result, out } = await drive(fakeStream(script, false), { fuMs: 300, stallMs: 400 });
    assert.equal(result, 'done');
    assert.equal(out.split(' ').filter(Boolean).length, 10, 'all 10 tokens must arrive');
  });

  test('a fast healthy answer completes with result "done"', async () => {
    const { result, out } = await drive(fakeStream([{ delayMs: 20, value: 'My name is X.' }], false), { fuMs: 1000 });
    assert.equal(result, 'done');
    assert.match(out, /My name is X\./);
  });

  test('shouldAbort (superseded) short-circuits without waiting', async () => {
    let out = '';
    const r = await raceStreamWithDeadline({
      stream: fakeStream([{ delayMs: 5000, value: 'late' }], 0),
      firstUsefulDeadlineMs: 3000,
      onToken: (v) => { out += v; },
      isUsefulYet: () => out.length > 0,
      shouldAbort: () => true,
    });
    assert.equal(r, 'aborted');
    assert.equal(out, '');
  });

  test('firstUsefulDeadlineMs uses the complex cap for coding/system-design', () => {
    // Caps must exceed MiniMax's 4-6s first-token (it's the strong fallback when the
    // Gemini chain is down) or the live driver aborts MiniMax before it ever speaks.
    assert.equal(firstUsefulDeadlineMs('coding_question_answer'), 7000);
    assert.equal(firstUsefulDeadlineMs('system_design_answer'), 7000);
    assert.equal(firstUsefulDeadlineMs('identity_answer'), LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS);
    assert.equal(firstUsefulDeadlineMs('jd_fit_answer'), 7000);
  });

  // The single most important safety test: a hung provider that REJECTS after the
  // deadline must NOT surface as an unhandledRejection (fatal in Electron main).
  test('stream that REJECTS after the deadline does NOT cause an unhandledRejection', async () => {
    let unhandled = null;
    const onUnhandled = (e) => { unhandled = e; };
    process.on('unhandledRejection', onUnhandled);
    try {
      async function* hangThenReject() { yield '  '; await sleep(200); throw new Error('provider 429 after deadline'); }
      const { result, elapsed } = await drive(hangThenReject(), { fuMs: 80, isUsefulYet: () => false });
      assert.equal(result, 'first_useful_timeout');
      assert.ok(elapsed < 1000, `aborted near budget, took ${elapsed}ms`);
      // Wait past the rejection time so it would surface if not defused.
      await sleep(400);
      assert.equal(unhandled, null, 'late provider rejection must be defused, not unhandled');
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  test('onToken that throws → cleanup runs and the error propagates (no iterator leak)', async () => {
    let cleaned = false;
    async function* twoTokens() {
      try { yield 'first'; yield 'second'; }
      finally { cleaned = true; } // generator's finally runs on iterator.return()
    }
    await assert.rejects(
      raceStreamWithDeadline({
        stream: twoTokens(),
        firstUsefulDeadlineMs: 1000,
        isUsefulYet: () => true,
        onToken: () => { throw new Error('listener blew up'); },
      }),
      /listener blew up/,
    );
    await sleep(50); // allow fire-and-forget cleanup to run
    assert.equal(cleaned, true, 'iterator must be closed even when onToken throws');
  });

  test('onCleanup is invoked on the timeout path (so the HTTP request can be aborted)', async () => {
    let cleanupCalls = 0;
    const r = await raceStreamWithDeadline({
      stream: fakeStream([], 2000),
      firstUsefulDeadlineMs: 150,
      isUsefulYet: () => false,
      onToken: () => {},
      onCleanup: () => { cleanupCalls++; },
    });
    assert.equal(r, 'first_useful_timeout');
    assert.equal(cleanupCalls, 1, 'onCleanup must fire exactly once to abort the request');
  });
});
