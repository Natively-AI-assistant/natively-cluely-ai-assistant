// electron/llm/__tests__/ReasoningTagLeak2026_09_03.test.mjs
//
// 2026-09-03: the overlay rendered the model's entire chain of thought. A user
// typing "hi" got ~2200 characters of `<think>…</think>` — including the model
// quoting the system prompt back (`The contract says: "output these EXACT
// markdown headings"`) — before the one-line greeting. SessionTracker then
// stored the whole thing as conversation history.
//
// Cause: `qwen/qwen3.6-27b` became the Groq default at the 2026-08-23 Llama
// retirement, replacing NON-reasoning llama ids. It is a thinking model and
// Groq's default for it puts the reasoning in `delta.content`, which every
// streamWith* generator forwards verbatim. No reasoning param was sent anywhere
// in the repo (`grep -rn reasoning_format electron/` returned nothing).
//
// Two layers are covered here:
//   1. groqReasoningParams — the request-layer fix, gated PER MODEL.
//   2. StreamingReasoningFilter — the provider-agnostic net.
//
// Live probe, streaming, 2026-09-03 (the numbers the gating is derived from):
//   qwen/qwen3.6-27b    {}                          -> <think> in content, ttft 321ms
//   qwen/qwen3.6-27b    {reasoning_effort:'none'}   -> clean, ttft 226ms
//   openai/gpt-oss-120b {}                          -> clean (reasoning out-of-band)
//   openai/gpt-oss-120b {reasoning_effort:'none'}   -> HTTP 400
//
// Platform: pure string logic, no platform branch — one run covers darwin and win32.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/ReasoningTagLeak2026_09_03.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', p)).href;

const { groqReasoningParams, GROQ_PRIMARY_MODEL, GROQ_PRODUCTION_FALLBACK_MODEL } =
  await import(dist('llm/groqModels.js'));
const { StreamingReasoningFilter, stripLeadingReasoningBlock } =
  await import(dist('llm/reasoningTagFilter.js'));
const { LLMHelper } = await import(dist('LLMHelper.js'));

// NOTE: no _resetGroqGoneMemo here. esbuild INLINES groqModels into the
// LLMHelper bundle, so the copy imported from dist llm/groqModels.js is a
// DIFFERENT module instance with a DIFFERENT gone-memo — resetting it does
// nothing to the one createGroqCompletion consults. (Cost a red test to find.)
// The stubs below are keyed on req.model instead, so they behave correctly
// whether a call arrives via the catch-retry or the memo shortcut.

describe('groqReasoningParams — per-model gating', () => {
  test('the qwen3 primary gets reasoning_effort:none', () => {
    assert.deepEqual(groqReasoningParams(GROQ_PRIMARY_MODEL), { reasoning_effort: 'none' });
    assert.deepEqual(groqReasoningParams('qwen/qwen3.6-27b'), { reasoning_effort: 'none' });
  });

  test('LADDER TRAP: the gpt-oss production rung gets NOTHING (it 400s on none)', () => {
    // Measured live: `reasoning_effort` must be one of `low`, `medium`, `high`.
    // A param fixed at the call site would ride the model swap in
    // createGroqCompletion and turn a leak into a hard failure on the ONE path
    // that only fires after a retirement — i.e. it would pass every test until
    // the day it mattered.
    assert.deepEqual(groqReasoningParams(GROQ_PRODUCTION_FALLBACK_MODEL), {});
    assert.deepEqual(groqReasoningParams('openai/gpt-oss-120b'), {});
    assert.deepEqual(groqReasoningParams('openai/gpt-oss-20b'), {});
  });

  test('matches a namespaced id, which the anchored isThinkingModel regex cannot', () => {
    // LLMHelper.isThinkingModel is /^qwen3/i and never matches 'qwen/qwen3.6-27b'.
    assert.equal(/^qwen3/i.test('qwen/qwen3.6-27b'), false, 'guards the premise');
    assert.deepEqual(groqReasoningParams('qwen/qwen3.6-27b'), { reasoning_effort: 'none' });
    assert.deepEqual(groqReasoningParams('qwen3-32b'), { reasoning_effort: 'none' });
  });

  test('null/undefined/empty are safe', () => {
    assert.deepEqual(groqReasoningParams(null), {});
    assert.deepEqual(groqReasoningParams(undefined), {});
    assert.deepEqual(groqReasoningParams(''), {});
  });
});

/** Feed text through the filter one chunk at a time. */
const run = (chunks) => {
  const f = new StreamingReasoningFilter();
  let out = '';
  for (const c of chunks) out += f.feed(c);
  out += f.finish();
  return { out, f };
};

describe('StreamingReasoningFilter', () => {
  test('strips the live-captured Groq shape (block, then the real answer)', () => {
    const { out, f } = run([
      '\n<think>\nThe user said "hi".\nThe system prompt says: "Start with the substance."\n</think>\n\n',
      'Hi there. How can I help you today?',
    ]);
    assert.equal(out, 'Hi there. How can I help you today?');
    assert.equal(f.strippedBlock, true);
  });

  test('REGRESSION: a per-chunk regex would fail here — tags split across deltas', () => {
    // The live capture opened with the chunk "\n<think>\n" ALONE. Both tags
    // never share a chunk, so /<think>[\s\S]*?<\/think>/ matches nothing.
    const chunks = ['\n<th', 'ink', '>\nreasoning line one\n', 'reasoning line two\n</thi', 'nk>', '\n\nReal answer.'];
    assert.equal(
      chunks.map((c) => c.replace(/<think>[\s\S]*?<\/think>/g, '')).join(''),
      chunks.join(''),
      'guards the premise: the naive per-chunk regex is a no-op',
    );
    assert.equal(run(chunks).out, 'Real answer.');
  });

  test('one character at a time still strips cleanly', () => {
    const src = '<think>abc</think>Answer.';
    assert.equal(run([...src]).out, 'Answer.');
  });

  test('the whole block arriving in one chunk works too', () => {
    assert.equal(run(['<think>x</think>Answer.']).out, 'Answer.');
  });

  test('handles the MiniMax namespaced shape <mm:think>', () => {
    assert.equal(run(['<mm:think>hidden</mm:think>', 'Answer.']).out, 'Answer.');
  });

  test('handles <thinking> without eating it as a <think> prefix', () => {
    assert.equal(run(['<thinking>hidden</thinking>Answer.']).out, 'Answer.');
  });

  test('NEVER BLANK: an unclosed block is flushed rather than swallowed', () => {
    // max_tokens truncation mid-reasoning. Showing the reasoning beats an
    // empty answer, which is what a naive suppressor would produce.
    const { out } = run(['<think>\nI was still reasoning when the tokens ran out']);
    assert.match(out, /still reasoning when the tokens ran out/);
  });

  test('a mid-answer <think> is left ALONE (leading-only)', () => {
    // A coding answer explaining this very bug must survive intact.
    const src = 'Strip it like this:\n\n```js\ntext.replace(/<think>[\\s\\S]*?<\\/think>/g, "")\n```';
    assert.equal(run([src]).out, src);
  });

  test('a normal answer passes through byte-identical', () => {
    const src = '## Approach\n- Use the modulo operator.\n\n## Code\n```python\nx % 2\n```';
    assert.equal(run([src]).out, src);
    assert.equal(run([...src]).out, src);
  });

  test('an answer that legitimately opens with a non-reasoning tag is untouched', () => {
    // isLeakedInternalTagBlock in answerPolish.ts owns that case; this filter
    // must not silently eat it and hide the leak from the guard that reports it.
    const src = '<answer_contract>\nanswerType: general_meeting_answer\n</answer_contract>';
    assert.equal(run([src]).out, src);
  });

  test('an answer opening with a bare < that is not a tag is untouched', () => {
    assert.equal(run(['<', ' 5 items means the list is short.']).out, '< 5 items means the list is short.');
  });

  test('leading whitespace before real text is preserved, not eaten', () => {
    assert.equal(run(['\n\n', 'Answer.']).out, '\n\nAnswer.');
  });

  test('output after the block is streamed incrementally, not held to the end', () => {
    const f = new StreamingReasoningFilter();
    assert.equal(f.feed('<think>r</think>'), '');
    assert.equal(f.feed('Hello '), 'Hello ', 'must not buffer the visible answer');
    assert.equal(f.feed('world'), 'world');
    assert.equal(f.finish(), '');
  });

  test('stripLeadingReasoningBlock: one-shot form for assembled text', () => {
    assert.equal(stripLeadingReasoningBlock('<think>r</think>\n\nAnswer.'), 'Answer.');
    assert.equal(stripLeadingReasoningBlock('Answer.'), 'Answer.');
    assert.equal(stripLeadingReasoningBlock(''), '');
  });
});

// ── Integration: the REAL compiled createGroqCompletion ─────────────────────
// The unit tests above prove the predicate. They do NOT prove it is wired to
// the model actually sent, which is the whole point: createGroqCompletion
// rewrites `request.model` on two fallback paths. This drives the compiled
// method with a recording stub so the ladder rung is observed, not assumed.
describe('createGroqCompletion applies reasoning params per attempt', () => {
  /** A bare instance: createGroqCompletion touches only groqClient + modelVersionManager. */
  const harness = (createImpl) => {
    const seen = [];
    const self = Object.create(LLMHelper.prototype);
    self.groqClient = {
      chat: { completions: { create: async (req) => { seen.push(req); return createImpl(req); } } },
    };
    self.modelVersionManager = { onModelError: async () => {} };
    return { self, seen };
  };

  test('the qwen3 primary is sent reasoning_effort:none', async () => {
    const { self, seen } = harness(() => ({ ok: true }));
    await self.createGroqCompletion({ model: GROQ_PRIMARY_MODEL, messages: [], stream: true });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].reasoning_effort, 'none');
    assert.equal(seen[0].model, GROQ_PRIMARY_MODEL);
    assert.equal(seen[0].stream, true, 'the rest of the request survives untouched');
  });

  test('LADDER TRAP: after a model-gone retry the param is DROPPED for gpt-oss', async () => {
    // Without per-attempt recomputation this second request carries
    // reasoning_effort:'none' onto openai/gpt-oss-120b, which the live probe
    // measured as HTTP 400 — a leak traded for an outage, on the one path that
    // only fires after a retirement.
    const gone = (req) => {
      if (req.model === GROQ_PRIMARY_MODEL) { const e = new Error('model_decommissioned'); e.status = 404; throw e; }
      return { ok: true };
    };
    const { self, seen } = harness(gone);
    await self.createGroqCompletion({ model: GROQ_PRIMARY_MODEL, messages: [], stream: true });
    const attempted = seen.find((r) => r.model === GROQ_PRIMARY_MODEL);
    const landed = seen[seen.length - 1];
    if (attempted) assert.equal(attempted.reasoning_effort, 'none', 'qwen attempt keeps the param');
    assert.equal(landed.model, GROQ_PRODUCTION_FALLBACK_MODEL, 'laddered down');
    assert.equal('reasoning_effort' in landed, false, 'gpt-oss must receive NO reasoning_effort');
  });

  test('the known-gone memo path also recomputes for the rung it lands on', async () => {
    const { self, seen } = harness((req) => {
      if (req.model === GROQ_PRIMARY_MODEL) { const e = new Error('model_decommissioned'); e.status = 404; throw e; }
      return { ok: true };
    });
    // First call primes the gone-memo; the second must skip straight to the rung.
    await self.createGroqCompletion({ model: GROQ_PRIMARY_MODEL, messages: [], stream: true });
    await self.createGroqCompletion({ model: GROQ_PRIMARY_MODEL, messages: [], stream: true });
    const last = seen[seen.length - 1];
    assert.equal(last.model, GROQ_PRODUCTION_FALLBACK_MODEL);
    assert.equal('reasoning_effort' in last, false);
  });
});

// ── Wiring: the filter is actually connected to the stream funnel ───────────
// The StreamingReasoningFilter tests above pass whether or not LLMHelper ever
// imports it. These drive the REAL streamChat generator over a stubbed
// _streamChatInner, so deleting the `reasoningFilter.feed(chunk)` line turns
// them red. Same "BEHAVIOURAL, not source-text" precedent as
// RunawayStreamOutputCap2026_08_12.test.mjs.
describe('streamChat strips the reasoning block end to end', () => {
  const drive = async (chunks) => {
    const self = Object.create(LLMHelper.prototype);
    self._streamChatInner = async function* () { for (const c of chunks) yield c; };
    let out = '';
    for await (const c of self.streamChat('q')) out += c;
    return out;
  };

  test('the live-captured delta sequence yields only the answer', async () => {
    assert.equal(
      await drive(['\n<think>\n', 'The system prompt says: "Start with the substance."', '\n</think>', '\n\nHi there.']),
      'Hi there.',
    );
  });

  test('an ordinary answer is unchanged through the funnel', async () => {
    assert.equal(await drive(['## Approach\n', '- Use the modulo operator.']), '## Approach\n- Use the modulo operator.');
  });

  test('an unclosed block is flushed by finish() at normal completion', async () => {
    // Exercises the flush path, which nothing else drives through the real
    // generator. A blank answer here would be worse than the leak.
    const out = await drive(['<think>', 'ran out of tokens mid-thought']);
    assert.match(out, /ran out of tokens mid-thought/);
  });
});
