// electron/llm/__tests__/CodexHeldOutputStall2026_10_25.test.mjs
//
// Issue #680: What to answer on Codex cut off mid-code by the 8 s stall guard.
//
// WHAT THE WIRE ACTUALLY DOES (sanitized traces, 2026-10-25: event types,
// timings and delta lengths only, no prompt or answer text)
// gpt-6-luna, a HackerRank coding prompt, 8 runs. In 5 of them the backend
// stopped sending answer text for 4.2-8.2 s (inside the code block, in every
// run that recorded it), sent nothing but `:` keepalive comments meanwhile, then
// delivered the whole rest of the answer in one 80-200 ms burst right before
// response.completed. One run
// held for 8230 ms, past the 8000 ms guard: that is the #644 cut-off. gpt-6.1-sol
// held for 17.5 s once. No reasoning or progress event arrives during a hold, so
// the only sign the request is alive is the bytes themselves.
//
// THE FIX UNDER TEST
// The Codex parser notes transport activity for the stream being pulled
// (streamActivity.ts). raceStreamWithDeadline keeps waiting past the stall
// budget only while that activity keeps arriving, and never longer than
// heldOutputMaxMs since the last answer text. A connection that sends nothing
// still stalls at the plain budget, and nothing extends the first-token budget.
//
// Timings are scaled down (stall 300 ms) so the suite stays fast.
//
// Run via: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/llm/__tests__/CodexHeldOutputStall2026_10_25.test.mjs

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Hermetic: never pick up the developer's real `codex login`.
process.env.CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-codex-home-'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { CodexCliService } = require(path.join(__dirname, '../../../dist-electron/electron/services/CodexCliService.js'));
const { raceStreamWithDeadline, noteStreamActivity, LIVE_HELD_OUTPUT_MAX_MS, LIVE_INTER_TOKEN_STALL_MS } = require(
  path.join(__dirname, '../../../dist-electron/electron/llm/liveDeadlines.js'),
);

const CRED_SLOT = '__nativelyCredentialsManagerV1__';
globalThis[CRED_SLOT] = {
  getCodexOAuthTokens: () => ({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    accountId: 'acct_test',
    expiresAt: Date.now() + 3_600_000,
  }),
  getDisabledProviders: () => [],
};

const STALL_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = new TextEncoder();

const delta = (text) => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`;
const KEEPALIVE = ': keepalive\n\n';
const COMPLETED = 'event: response.completed\ndata: {"type":"response.completed"}\n\n';

/** An SSE body that sends each step's frames after its delay, like the traced backend. */
function timedSse(steps) {
  let cancelled = false;
  return new Response(new ReadableStream({
    async start(controller) {
      for (const step of steps) {
        await sleep(step.afterMs);
        if (cancelled) return;
        try { controller.enqueue(enc.encode(step.frames)); } catch { return; }
      }
      try { controller.close(); } catch { /* cancelled */ }
    },
    cancel() { cancelled = true; },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** `count` keepalive frames, one every `everyMs`. */
const keepalives = (count, everyMs) => Array.from({ length: count }, () => ({ afterMs: everyMs, frames: KEEPALIVE }));

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function driveCodex(steps, { heldOutputMaxMs = 1500, fuMs = 2000 } = {}) {
  globalThis.fetch = async () => timedSse(steps);
  const controller = new AbortController();
  let out = '';
  let lastTextAt = 0;
  let observation = null;
  const started = Date.now();
  const result = await raceStreamWithDeadline({
    stream: CodexCliService.stream('', { timeoutMs: 30_000, prompt: 'p', model: 'gpt-6-luna', signal: controller.signal }),
    firstUsefulDeadlineMs: fuMs,
    interTokenStallMs: STALL_MS,
    heldOutputMaxMs,
    onToken: (v) => { out += v; lastTextAt = Date.now(); },
    isUsefulYet: () => out.length > 0,
    onCleanup: (reason) => { if (reason !== 'done') controller.abort(reason); },
    observe: (o) => { observation = o; },
  });
  const ended = Date.now();
  return { result, out, observation, elapsed: ended - started, sinceLastText: ended - lastTextAt };
}

describe('#680: a Codex answer held server-side is not cut off', () => {
  test('the traced shape: text, a hold longer than the stall budget with keepalives only, then a burst → the whole answer', async () => {
    const { result, out, observation } = await driveCodex([
      { afterMs: 0, frames: delta('## Code\n```python\n') },
      { afterMs: 20, frames: delta('def concatenation():\n') },
      // ~750 ms of keepalives only: 2.5x the stall budget, like the 8230 ms hold.
      ...keepalives(5, 150),
      { afterMs: 150, frames: delta('    return parse()\n') + delta('```\n') + delta('O(n) time.') + COMPLETED },
    ]);
    assert.equal(result, 'done', 'a live connection holding the rest of the answer must not be cut off');
    assert.equal(out, '## Code\n```python\ndef concatenation():\n    return parse()\n```\nO(n) time.');
    assert.ok(observation.heldPastStallMs > 0, `the wait past the stall budget is reported, got ${observation.heldPastStallMs}`);
  });

  test('keepalives that never lead to more text still end at heldOutputMaxMs', async () => {
    const { result, out, sinceLastText } = await driveCodex([
      { afterMs: 0, frames: delta('partial') },
      ...keepalives(40, 150), // 6 s of keepalives
    ], { heldOutputMaxMs: 1000 });
    assert.equal(result, 'stall_timeout');
    assert.equal(out, 'partial', 'the partial answer is kept, as before');
    assert.ok(sinceLastText >= 1000 - 50, `must wait out the held ceiling, ended ${sinceLastText} ms after the last text`);
    assert.ok(sinceLastText < 1000 + 900, `must not wait past the held ceiling, ended ${sinceLastText} ms after the last text`);
  });

  test('a connection that sends nothing at all still stalls at the plain budget', async () => {
    const { result, sinceLastText, observation } = await driveCodex([
      { afterMs: 0, frames: delta('partial') },
      { afterMs: 3000, frames: delta(' late') + COMPLETED },
    ]);
    assert.equal(result, 'stall_timeout');
    // Below heldOutputMaxMs (1500), which is what a wrongly extended stream would reach.
    assert.ok(sinceLastText < 1000, `a silent connection gets no extension, ended ${sinceLastText} ms after the last text`);
    assert.equal(observation.heldPastStallMs, 0);
  });

  test('keepalives before the first text do not extend the first-token budget', async () => {
    const { result, out, elapsed } = await driveCodex([
      ...keepalives(10, 100),
      { afterMs: 100, frames: delta('too late') + COMPLETED },
    ], { fuMs: 400 });
    assert.equal(result, 'first_useful_timeout');
    assert.equal(out, '');
    assert.ok(elapsed < 400 + 700, `first-token budget unchanged, took ${elapsed} ms`);
  });

  test('two holds in one answer are each bounded from their own last text', async () => {
    const { result, out } = await driveCodex([
      { afterMs: 0, frames: delta('a') },
      ...keepalives(4, 150), // 600 ms hold
      { afterMs: 150, frames: delta('b') },
      ...keepalives(4, 150), // another 600 ms hold
      { afterMs: 150, frames: delta('c') + COMPLETED },
    ], { heldOutputMaxMs: 1000 });
    assert.equal(result, 'done');
    assert.equal(out, 'abc');
  });
});

describe('#680: through the real What to answer chain', () => {
  // WhatToAnswerLLM → LLMHelper.streamChatWithOutcome → streamWithCodexCli →
  // CodexCliService, only the HTTPS call stubbed (same seams as
  // WtaCodexModelRejectedIssue543). Proves the activity scope survives every
  // generator layer between the guard and the Codex parser; a layer that pumped
  // the provider from a background task would drop it and stall here.
  test('a held Codex answer reaches the guard as alive and completes', async () => {
    const { LLMHelper } = require(path.join(__dirname, '../../../dist-electron/electron/LLMHelper.js'));
    const { WhatToAnswerLLM } = require(path.join(__dirname, '../../../dist-electron/electron/llm/WhatToAnswerLLM.js'));
    const saved = globalThis[CRED_SLOT];
    const known = {
      getCodexOAuthTokens: saved.getCodexOAuthTokens,
      getDisabledProviders: () => [],
      anyVisionProviderConfigured: () => true,
      anyLocalVisionProviderConfigured: () => false,
    };
    globalThis[CRED_SLOT] = new Proxy(known, { get: (target, prop) => (prop in target ? target[prop] : () => null) });
    globalThis.fetch = async (url) => {
      if (!String(url).includes('chatgpt.com/backend-api/codex')) throw new Error(`unexpected fetch in test: ${url}`);
      return timedSse([
        { afterMs: 0, frames: delta('Use a token bucket per API key.\n\n') },
        { afterMs: 20, frames: delta('```python\nclass Bucket:\n') },
        ...keepalives(5, 150),
        { afterMs: 150, frames: delta('    def take(self):\n        return True\n```\nRefill rate sets the limit.') + COMPLETED },
      ]);
    };
    try {
      const helper = new LLMHelper(undefined, false);
      helper.setCodexCliConfig({ enabled: true, model: 'gpt-6-luna', timeoutMs: 30_000 });
      helper.setModel('codex-cli:gpt-6-luna');
      const answerer = new WhatToAnswerLLM(helper, {
        getActiveModeSystemPromptSuffix: () => '',
        buildRetrievedActiveModeContextBlockHybrid: async () => '',
        buildRetrievedActiveModeContextBlock: () => '',
        buildActiveModeContextBlock: () => '',
      });
      const controller = new AbortController();
      const snap = Object.freeze({ activeModeInfo: null, modeId: 'general', requestId: 'r680', surface: 'what_to_answer', generationId: 1 });
      let out = '';
      const result = await raceStreamWithDeadline({
        stream: answerer.generateStream(
          '[INTERVIEWER]: How would you rate limit a public API?',
          undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, undefined, undefined, undefined, snap, controller.signal,
        ),
        firstUsefulDeadlineMs: 5000,
        interTokenStallMs: STALL_MS,
        heldOutputMaxMs: 1500,
        onToken: (v) => { out += v; },
        isUsefulYet: () => out.trim().length > 0,
        onCleanup: (reason) => { if (reason !== 'done') controller.abort(reason); },
      });
      assert.equal(result, 'done', 'the WTA chain must carry Codex activity to the guard');
      assert.match(out, /Refill rate sets the limit\./, 'the held rest of the answer arrives');
    } finally {
      globalThis[CRED_SLOT] = saved;
    }
  });
});

describe('#680: transport activity is scoped to the stream being pulled', () => {
  async function* textThenHang(hangMs) {
    yield 'partial';
    await sleep(hangMs);
    yield ' late';
  }

  test('activity noted outside the stream pull does not extend that stream', async () => {
    // Another request's transport keeps reporting activity the whole time.
    const other = setInterval(() => noteStreamActivity(), 50);
    try {
      let out = '';
      const started = Date.now();
      const result = await raceStreamWithDeadline({
        stream: textThenHang(3000),
        firstUsefulDeadlineMs: 2000,
        interTokenStallMs: STALL_MS,
        heldOutputMaxMs: 1500,
        onToken: (v) => { out += v; },
        isUsefulYet: () => out.length > 0,
      });
      assert.equal(result, 'stall_timeout');
      // Below heldOutputMaxMs (1500), which leaked activity would extend it to.
      assert.ok(Date.now() - started < 1000, 'unrelated activity must not hold this stream open');
    } finally {
      clearInterval(other);
    }
  });

  test('a stream without a reporting transport keeps the plain stall budget', async () => {
    let out = '';
    const started = Date.now();
    const result = await raceStreamWithDeadline({
      stream: textThenHang(3000),
      firstUsefulDeadlineMs: 2000,
      interTokenStallMs: STALL_MS,
      onToken: (v) => { out += v; },
      isUsefulYet: () => out.length > 0,
    });
    assert.equal(result, 'stall_timeout');
    assert.ok(Date.now() - started < 1000);
  });

  test('the shipped held ceiling is above the stall budget and bounded', () => {
    assert.equal(LIVE_INTER_TOKEN_STALL_MS, 8000, 'the plain stall budget is not widened');
    assert.ok(LIVE_HELD_OUTPUT_MAX_MS > LIVE_INTER_TOKEN_STALL_MS);
    assert.ok(LIVE_HELD_OUTPUT_MAX_MS <= 30_000, 'a held answer must still end in bounded time');
  });
});
