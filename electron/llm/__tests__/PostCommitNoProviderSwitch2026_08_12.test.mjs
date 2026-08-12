// electron/llm/__tests__/PostCommitNoProviderSwitch2026_08_12.test.mjs
//
// The user's ORIGINAL report — "it shows a new answer that's wrong after
// initially showing the right answer" — reproduced from a live capture and
// traced to the CLIENT, not the natively-api provider cascade.
//
// what_to_answer, Natively fast-mode, 2026-08-12:
//
//   [NativelyAPI] stream server error  stage=during_stream tfft=2084ms
//                                      tokens=8047 chars=22871
//                                      error=ai_unavailable (aborted at 61s)
//   [LLMHelper] Natively fast-mode failed, falling back
//   [NativelyAPI] stream completed     chars=2342          <- a WHOLE new answer
//   [SessionTracker] addAssistantMessage length=25210
//
//   22871 + 2342 = 25213, stored 25210 — a 3-char trim delta. The fallback's
//   answer was APPENDED to the partial, not substituted for it. The user read a
//   truncated answer immediately followed by a second, different, complete one.
//
// Cause: `yield*` cannot be undone. Every catch-and-continue site in the text
// path delegated with `yield*` and, on ANY error, fell through to the next
// provider — including errors raised long after tokens had been forwarded to
// the renderer.
//
// The codebase already had the correct rule written down for the VISION path
// (above streamVisionWithFallback):
//
//   "A failure AFTER commit cannot switch providers (that would duplicate
//    output) — we end the stream gracefully."
//
// ...and implemented it there via `committedProvider`. The text path had the
// rule documented at streamGeminiTextCascade but never applied at its own
// fall-through sites. `trackCommit` is how they now observe it.
//
// These tests drive the REAL LLMHelper.prototype.trackCommit — not a local
// re-implementation of `yield* / catch / fall through`, which would only prove
// JavaScript semantics rather than that this file behaves correctly.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../../LLMHelper.ts');
const src = fs.readFileSync(SRC, 'utf8');

// Bind the real prototype method without constructing an LLMHelper (its ctor
// reaches for keychain, native modules and provider SDKs). trackCommit uses no
// instance state, so a bare `this` is a faithful host.
const { LLMHelper } = await import('../../../dist-electron/electron/LLMHelper.js');
const trackCommit = LLMHelper.prototype.trackCommit;
assert.equal(typeof trackCommit, 'function', 'trackCommit must exist on LLMHelper');

async function* fromChunks(chunks, throwAfter = -1) {
  for (let i = 0; i < chunks.length; i++) {
    if (i === throwAfter) throw new Error('provider died mid-stream');
    yield chunks[i];
  }
  if (throwAfter === chunks.length) throw new Error('provider died at end of stream');
}

/** Consume a tracked stream exactly as a fall-through site does. */
async function drive(chunks, throwAfter) {
  const state = { emitted: false };
  const seen = [];
  let threw = false;
  try {
    for await (const tok of trackCommit.call({}, fromChunks(chunks, throwAfter), state)) {
      seen.push(tok);
    }
  } catch {
    threw = true;
  }
  return { state, seen, threw };
}

describe('trackCommit records whether the consumer has seen real text', () => {
  test('real text commits', async () => {
    const { state, seen } = await drive(['Approach\n', 'BFS explores level by level.'], -1);
    assert.equal(state.emitted, true);
    assert.deepEqual(seen, ['Approach\n', 'BFS explores level by level.']);
  });

  test('whitespace-only output does NOT commit', async () => {
    // Matches the vision path's predicate exactly (`tok.trim().length > 0`), so
    // a provider that emits only a blank preamble before dying can still fail
    // over — nothing was painted, so switching duplicates nothing.
    const { state } = await drive(['', '   ', '\n\n'], -1);
    assert.equal(state.emitted, false);
  });

  test('a failure BEFORE any text leaves the stream uncommitted', async () => {
    const { state, threw } = await drive(['first'], 0);
    assert.equal(threw, true);
    assert.equal(state.emitted, false, 'pre-commit failure must still allow fail-over');
  });

  test('a failure AFTER text is reported as committed', async () => {
    // The live shape: many tokens forwarded, then the provider dies.
    const { state, seen, threw } = await drive(['Approach\n', 'BFS explores', ' level by level.'], 3);
    assert.equal(threw, true);
    assert.equal(seen.length, 3, 'chunks before the error were already forwarded — they cannot be recalled');
    assert.equal(state.emitted, true, 'a post-commit failure must be visible to the catch site');
  });

  test('chunks pass through byte-for-byte', async () => {
    // trackCommit sits in the hot path of every fast-mode turn; it must observe
    // without transforming. A stray trim here would corrupt code indentation.
    const chunks = ['def f():\n', '    return 1\n', '  ', '\t x $@ \n'];
    const { seen } = await drive(chunks, -1);
    assert.deepEqual(seen, chunks);
  });
});

describe('every text-path fall-through site consults the commit flag', () => {
  // Source pins. The defect was not that the rule was unknown — it was written
  // down two functions away — but that individual catch blocks did not apply
  // it. A new provider added with a bare `yield*` + catch would silently
  // reintroduce duplication, so pin the shape rather than any one call.
  test('trackCommit exists and threads a caller-owned flag', () => {
    assert.match(src, /private async \* trackCommit\(/);
    assert.match(src, /state:\s*\{\s*emitted:\s*boolean\s*\}/);
  });

  test('the emptiness predicate matches the vision path exactly', () => {
    // Two independent copies of "did we emit anything" that drift would give
    // the two surfaces different duplication behaviour.
    const visionPredicate = /typeof tok === 'string' && tok\.trim\(\)\.length > 0/g;
    const hits = src.match(visionPredicate) || [];
    assert.ok(
      hits.length >= 2,
      `expected the vision predicate to be reused by trackCommit, found ${hits.length} occurrence(s)`,
    );
  });

  test('no bare `yield* this.streamWith...` remains inside a catch-and-continue block', () => {
    // Every delegation that is followed by a catch which does NOT return must
    // be wrapped. Assert on the guarded sites' count instead of trying to parse
    // control flow. Eight sites found by sweeping every `yield*` for an
    // enclosing catch that neither returns nor rethrows: fast-mode
    // Codex/Groq/Natively, selected-Groq (multimodal + text share one catch),
    // the streaming rotation loop, the TTFT race (the primary text path), and
    // the Natively and Custom last-resorts.
    const wrapped = (src.match(/yield\* this\.trackCommit\(/g) || []).length;
    assert.ok(
      wrapped >= 8,
      `expected all 8 text-path fall-through sites wrapped in trackCommit, found ${wrapped}`,
    );
  });

  test('each guarded catch returns instead of falling through', () => {
    const guards = (src.match(/if \(commit\.emitted\) \{/g) || []).length;
    assert.ok(
      guards >= 7,
      `expected a commit guard in each fall-through catch block, found ${guards}`,
    );
    // And the guard must END the stream, not merely log. Scan a bounded window
    // rather than to the next `}` — the warn lines interpolate `${provider.name}`
    // and `${err.message}`, whose closing braces would truncate a naive scan.
    const guardBlocks = src.split(/if \(commit\.emitted\) \{/).slice(1);
    for (const [i, block] of guardBlocks.entries()) {
      const body = block.slice(0, 900);
      assert.match(
        body,
        /return;/,
        `commit guard #${i + 1} logs but does not return — the stream would still fall through`,
      );
    }
  });

  test('the STREAMING rotation loop is guarded', () => {
    // streamChatWithGemini retries the whole provider list up to 3 times, so an
    // unguarded post-commit error there could append many complete answers.
    //
    // There are two `MAX_FULL_ROTATIONS` loops. The non-streaming one
    // (chatWithGemini) awaits a whole string and returns it, so it cannot
    // duplicate partial output and correctly has no guard — select the
    // streaming loop by the `yield*` it contains rather than by file order.
    const starts = [...src.matchAll(/for \(let rotation = 0; rotation < MAX_FULL_ROTATIONS/g)]
      .map((m) => m.index);
    assert.ok(starts.length >= 1, 'could not locate any rotation loop');
    const streamingLoops = starts
      .map((i) => src.slice(i, i + 2000))
      .filter((body) => body.includes('yield*'));
    assert.equal(
      streamingLoops.length,
      1,
      `expected exactly one STREAMING rotation loop, found ${streamingLoops.length}`,
    );
    const loop = streamingLoops[0];
    assert.match(loop, /yield\* this\.trackCommit\(provider\.execute\(\)/);
    assert.match(loop, /if \(commit\.emitted\)[\s\S]{0,900}?return;/);
  });
});
