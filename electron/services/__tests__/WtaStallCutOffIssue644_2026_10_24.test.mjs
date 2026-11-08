// Issue #644 — "What to answer" on OpenAI Codex stopped inside a code block
// (`def concatenation():`, unclosed fence). The log: 114 chunks, then no text
// for 8 s, `terminationReason: "stall_timeout"`, and the 514-char partial was
// stored with `policy: "store_conversational_only"`. The overlay showed it as
// a finished answer: no notice, nothing saying it was cut off.
//
// The stall guard ending the stream is by design (electron/llm/performance/
// priors.ts: widening past 8 s "is a finding to surface in diagnostics, not a
// deadline to quietly grant"). What was wrong is what happened to the partial:
//   - the engine's own stall never marked the answer truncated (only
//     WhatToAnswerLLM's drained-stream outcome could), so it was stored as
//     session history and replayed to the next turn as a complete answer;
//   - the normal final emit dropped the stop reason, so the overlay had
//     nothing to say "Answer cut off" with.
//
// Driven through the REAL IntelligenceEngine → WhatToAnswerLLM → LLMHelper →
// CodexCliService; only the HTTPS call is stubbed, with a Responses API SSE
// body that goes quiet mid-answer the way the reported one did.
//
// Run via: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/WtaStallCutOffIssue644_2026_10_24.test.mjs

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test', on: () => {} },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));
const { IntelligenceEngine } = require(dist('IntelligenceEngine.js'));
const { SessionTracker } = require(dist('SessionTracker.js'));
const { LIVE_INTER_TOKEN_STALL_MS } = require(dist('llm/index.js'));
const { looksCutOff } = require(dist('llm/repairCap.js'));

// The engine warms a shared classifier worker that is kept alive by design.
after(() => new Promise((r) => setTimeout(() => { process.exit(0); r(); }, 200)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same seam as WtaCodexModelRejectedIssue543: the CodexOAuthService copy in the
// LLMHelper bundle reads its tokens through this global slot.
const CRED_SLOT = '__nativelyCredentialsManagerV1__';
const seedSignedIn = () => {
  const known = {
    getCodexOAuthTokens: () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      accountId: 'acct_test',
      expiresAt: Date.now() + 3_600_000,
    }),
    getDisabledProviders: () => [],
    anyVisionProviderConfigured: () => true,
    anyLocalVisionProviderConfigured: () => false,
  };
  globalThis[CRED_SLOT] = new Proxy(known, {
    get: (target, prop) => (prop in target ? target[prop] : () => null),
  });
};

// The reported answer, up to where it stopped, and the rest that never came.
const BEFORE_GAP = [
  '## Approach\n',
  "Thompson's construction turns the regular expression into an NFA, then epsilon closures turn it into a DFA, ",
  'so each string is counted exactly once. Build the reachable DFA states and use matrix exponentiation to count ',
  'accepted strings of length L, modulo 10^9 + 7.\n\n',
  '## Code\n```python\n',
  'def countStrings(r, l):\n    eps = []\n    edges = []\n\n    def new_state():\n        eps.append([])\n',
  '        edges.append([[], []])\n        return len(eps) - 1\n\n    def parse():\n        nonlocal pos\n\n',
  '        def expression():\n            nonlocal pos\n            left = concatenation()\n',
  '            return left\n\n        def concatenation():\n',
];
const AFTER_GAP = ['            nonlocal pos\n            return term()\n```\n\n## Complexity\nO(S^3 log L).\n'];

const enc = new TextEncoder();
const sse = (obj) => enc.encode(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`);

/**
 * A Codex Responses SSE body: `before` (default BEFORE_GAP), then `gapMs` of
 * silence, or `failAfterGap` to break off there.
 */
function codexResponse({ gapMs = 0, failAfterGap = false, before = BEFORE_GAP, after: rest = AFTER_GAP } = {}) {
  const body = new ReadableStream({
    async start(c) {
      try {
        c.enqueue(sse({ type: 'response.created', response: { id: 'resp_644' } }));
        for (const delta of before) {
          c.enqueue(sse({ type: 'response.output_text.delta', delta }));
          await sleep(5);
        }
        if (failAfterGap) {
          c.error(new TypeError('terminated'));
          return;
        }
        if (gapMs) await sleep(gapMs);
        for (const delta of rest) c.enqueue(sse({ type: 'response.output_text.delta', delta }));
        c.enqueue(sse({ type: 'response.completed', response: { id: 'resp_644', status: 'completed' } }));
        c.close();
      } catch { /* the client aborted the body; nothing left to send */ }
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** `responseOpts` for every Codex call, or an array: one entry per call, the last repeating. */
async function pressWhatToAnswer(responseOpts, question = 'Count Strings: given a regular expression R over a and b and an integer L, count the strings of length L that R recognises. Write the code.') {
  seedSignedIn();
  const helper = new LLMHelper(undefined, false);
  helper.setCodexCliConfig({ enabled: true, model: 'gpt-6-luna', timeoutMs: 60_000 });
  helper.setModel('codex-cli:gpt-6-luna');
  const realFetch = globalThis.fetch;
  const perCall = Array.isArray(responseOpts) ? responseOpts : [responseOpts];
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('chatgpt.com/backend-api/codex')) return codexResponse(perCall[Math.min(calls++, perCall.length - 1)]);
    throw new Error(`unexpected fetch in test: ${url}`);
  };
  try {
    const session = new SessionTracker();
    session.addTranscript({ speaker: 'interviewer', text: question, timestamp: Date.now(), final: true });
    const engine = new IntelligenceEngine(helper, session);
    let final = null;
    engine.on('suggested_answer', (answer, q, confidence, generationId, sourceLabel, stopReason) => {
      final = { answer, stopReason };
    });
    await engine.runWhatShouldISay(question, 0.9, undefined, { skipCooldown: true });
    return { final, stored: session.getLastAssistantMessage('what_to_answer'), calls };
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis[CRED_SLOT];
  }
}

describe('#644 — a Codex answer cut off by the stall guard says so and is not stored', () => {
  const stalled = pressWhatToAnswer({ gapMs: LIVE_INTER_TOKEN_STALL_MS + 1500 });

  test('the stream still ends at the stall (the guard is unchanged)', async () => {
    const { final } = await stalled;
    assert.ok(final, 'no final answer was emitted');
    assert.match(final.answer, /def concatenation\(\):/);
    assert.doesNotMatch(final.answer, /return term\(\)/, 'text after the gap must not have arrived');
  });

  test('the final answer carries the stall as its stop reason', async () => {
    const { final } = await stalled;
    assert.equal(final.stopReason, 'stall_timeout');
  });

  test('the partial answer is not stored as session history', async () => {
    const { stored } = await stalled;
    assert.equal(stored, null, `stored as a complete answer: ${JSON.stringify(stored?.slice(0, 80))}`);
  });
});

describe('#644 — a provider that breaks off after part of the answer', () => {
  test('the partial is marked incomplete and not stored', async () => {
    const { final, stored } = await pressWhatToAnswer({ failAfterGap: true });
    assert.ok(final, 'no final answer was emitted');
    assert.match(final.answer, /def concatenation\(\):/);
    assert.equal(final.stopReason, 'provider_failed_after_first_token');
    assert.equal(stored, null);
  });
});

describe('#644 — a complete answer is unchanged', () => {
  test('a short pause under the guard: whole answer, no stop reason, stored', async () => {
    const { final, stored } = await pressWhatToAnswer({ gapMs: 300 });
    assert.match(final.answer, /return term\(\)/);
    assert.equal(final.stopReason, undefined);
    assert.ok(stored && stored.includes('def concatenation():'), 'a complete answer must still be stored');
  });
});

// A partial the engine then throws away and regenerates (here: the repeat-
// request guard) is not what the user ends up reading, so it is not "cut off".
describe('#644 — a stalled partial replaced by a regenerated answer', () => {
  const REPEAT_REQUEST = [
    "Sorry, I'm not quite sure what you were asking there about the rollout. ",
    'Could you please repeat the question so I can make sure I answer the part about the owners, the dates and the plan correctly?',
  ];
  const REGENERATED = ['Priya owns the rollout; the first region goes live on the 14th and the rest follow weekly.'];

  test('carries no stop reason', async () => {
    const { final } = await pressWhatToAnswer(
      [{ before: REPEAT_REQUEST, gapMs: LIVE_INTER_TOKEN_STALL_MS + 1500 }, { before: REGENERATED, after: [] }],
      'Who owns the rollout, and when does it start?',
    );
    assert.ok(final, 'no final answer was emitted');
    // Regenerated, or the guard's honest line when no time is left for that.
    assert.doesNotMatch(final.answer, /repeat the question/, 'the stalled partial was kept');
    assert.equal(final.stopReason, undefined, `"${final.answer}" was labelled cut off`);
  });
});

// A provider can hold the stream open after a complete answer (liveDeadlines.ts
// isCompleteShortAnswer, measured through the real app). The stall still ends
// it, but that answer was not cut off.
describe('#644 — a complete answer whose stream is then held open', () => {
  test('no stop reason, and it is stored', async () => {
    const COMPLETE = [
      'Priya owns the rollout. The first region goes live on the 14th, ',
      'and the remaining regions follow one a week after that, once support has signed off on each one.',
    ];
    const { final, stored } = await pressWhatToAnswer(
      { before: COMPLETE, gapMs: LIVE_INTER_TOKEN_STALL_MS + 1500, after: [] },
      'Who owns the rollout, and when does it start?',
    );
    assert.match(final.answer, /signed off on each one\./);
    assert.equal(final.stopReason, undefined);
    assert.ok(stored && stored.includes('Priya owns the rollout'), 'a complete answer must still be stored');
  });
});

describe('#644 — a fragment the engine regenerates is not labelled', () => {
  test('provider breaks off after a few characters: the regenerated answer carries no stop reason', async () => {
    const { final, calls } = await pressWhatToAnswer(
      [{ before: ['Pri'], failAfterGap: true }, { before: ['Priya owns the rollout; the first region goes live on the 14th.'], after: [] }],
      'Who owns the rollout, and when does it start?',
    );
    assert.ok(final, 'no final answer was emitted');
    assert.ok(calls >= 2, `the engine did not regenerate (${calls} call)`);
    assert.doesNotMatch(final.answer, /^Pri$/);
    assert.equal(final.stopReason, undefined, `"${final.answer}" was labelled cut off`);
  });
});

describe('looksCutOff', () => {
  const cut = [
    ['inside a code block', '## Code\n```python\ndef concatenation():\n'],
    ['mid-sentence', 'Thompson\'s construction turns the regular expression into an NFA, then'],
    ['after a comma', 'Build the reachable DFA states,'],
    ['after a colon', 'Here is the approach:'],
    ['a heading with nothing under it', 'The idea is simple.\n\n## Complexity'],
    ['a number mid-list of words', 'The bound is between 1 and 300'],
  ];
  for (const [name, text] of cut) test(`cut off: ${name}`, () => assert.equal(looksCutOff(text), true));

  const finished = [
    ['a finished sentence', 'Lead with the AWS migration.'],
    ['a question', 'Do you want the iterative version?'],
    ['a closed code block', '```python\nprint(1)\n```'],
    ['a list item', 'Trade-offs:\n- O(n) memory\n- one pass'],
    ['a table row', '| n | time |\n|---|---|\n| 10^5 | 0.2 s |'],
    ['the gist line', 'Lead with the migration, then the costs.\n[[GIST]] Lead with the AWS migration'],
    ['a closing quote', 'She said "ship it."'],
    ['a closing bracket', 'It runs in O(n log n) time (one sort, one scan)'],
    ['nothing at all', '   '],
  ];
  for (const [name, text] of finished) test(`finished: ${name}`, () => assert.equal(looksCutOff(text), false));
});
