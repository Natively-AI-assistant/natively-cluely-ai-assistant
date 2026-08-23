// electron/llm/__tests__/TruncatedAnswerNotStored2026_08_12.test.mjs
//
// Closes the limitation shipped alongside the post-commit guard (5d39d5c5) and
// the runaway cap (9cb40f4a), and documented in both commit messages:
//
//   "a post-commit failure now ends the stream by returning, so the consumer
//    sees a normal completion and the truncated answer is stored via
//    addAssistantMessage with no error signal."
//
// Returning rather than throwing is still the right call — throwing would make
// all nine consumers' existing catch blocks reclassify a partial answer as a
// failed generation. But it left a truncated answer INDISTINGUISHABLE from a
// complete one, so manual chat stored it into conversation state, the
// manual-conversation memory, the session transcript and usage.
//
// That is the same class of defect as "(referring to: Makefile)": bad state
// captured on one turn and replayed as fact on the next. A truncated answer in
// `lastAssistantMessage` becomes the antecedent for the NEXT turn's referent
// resolution.
//
// Mechanism: `_streamChatInner` yields a private sentinel before each early
// return; `streamChat` — its ONLY caller — strips it and records the outcome.
// The sentinel therefore can never reach a consumer.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const llmSrc = fs.readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');
const ipcSrc = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

const { LLMHelper } = await import('../../../dist-electron/electron/LLMHelper.js');
const SENTINEL = LLMHelper.TRUNCATION_SENTINEL;

/** Drive the real streamChatWithOutcome over a stubbed inner generator. */
async function drive(inner) {
  const fake = Object.create(LLMHelper.prototype);
  fake._streamChatInner = inner;
  const { stream, outcome } = LLMHelper.prototype.streamChatWithOutcome.call(fake);
  let text = '';
  for await (const tok of stream) text += tok;
  return { text, outcome };
}

describe('a completed stream reports itself complete', () => {
  test('truncated is false and the text is whole', async () => {
    const { text, outcome } = await drive(async function* () {
      yield 'Approach\n';
      yield 'BFS explores level by level.';
    });
    assert.equal(outcome.truncated, false);
    assert.equal(text, 'Approach\nBFS explores level by level.');
  });
});

describe('a stream that stops early reports itself truncated', () => {
  test('a post-commit provider failure is visible to the caller', async () => {
    const { text, outcome } = await drive(async function* () {
      yield 'Approach\n';
      yield 'partial answer';
      yield SENTINEL;
    });
    assert.equal(outcome.truncated, true);
    assert.equal(outcome.reason, 'provider_failed_after_first_token');
    // The partial is still delivered — the user keeps what was already painted.
    assert.equal(text, 'Approach\npartial answer');
  });

  test('the runaway cap is visible to the caller', async () => {
    const { outcome } = await drive(async function* () {
      for (let i = 0; i < 200; i++) yield 'x'.repeat(200);
    });
    assert.equal(outcome.truncated, true);
    assert.equal(outcome.reason, 'output_cap_reached');
  });
});

describe('the sentinel is strictly internal', () => {
  test('it never reaches the consumer', async () => {
    const { text } = await drive(async function* () {
      yield 'visible';
      yield SENTINEL;
    });
    assert.ok(!text.includes(SENTINEL), 'the internal marker leaked into the answer');
    assert.ok(!text.includes('') && !text.includes(''), 'private-use codepoints leaked');
  });

  test('_streamChatInner has exactly one caller, so stripping it is sufficient', () => {
    // The sentinel design is only safe while streamChat is the sole consumer.
    // Count real CALLS, not the many comments that mention the name.
    const calls = llmSrc.match(/this\._streamChatInner\(/g) || [];
    assert.equal(
      calls.length,
      1,
      `_streamChatInner gained a second caller (${calls.length}) — that caller would receive the raw sentinel`,
    );
  });

  test('the sentinel is not emitted by generators consumed directly', () => {
    // streamChatWithGemini is consumed by RAGManager WITHOUT passing through
    // streamChat, so a sentinel yielded there would leak into its output.
    const start = llmSrc.indexOf('public async * streamChatWithGemini(');
    const end = llmSrc.indexOf('private async *streamVisionWithFallback(', start);
    assert.ok(start > 0 && end > start, 'could not bound streamChatWithGemini');
    assert.doesNotMatch(
      llmSrc.slice(start, end),
      /yield LLMHelper\.TRUNCATION_SENTINEL/,
      'streamChatWithGemini must not yield the sentinel — RAGManager consumes it directly',
    );
  });
});

describe('manual chat refuses to store a truncated answer', () => {
  test('it consumes the outcome-bearing API', () => {
    assert.match(
      ipcSrc,
      /const v3Stream = llmHelper\.streamChatWithOutcome\(/,
      'manual chat must use streamChatWithOutcome so it can tell a partial answer from a complete one',
    );
  });

  // Code-review 2026-08-13. This test USED to slice
  //   ipcSrc.slice(start, ipcSrc.indexOf('} // end !v3Truncated'))
  // and assert four sink names appeared in the result. When the end marker moved,
  // indexOf returned -1, the slice became ~90% of the FILE, and all four names
  // were trivially found anywhere in it — a vacuous pass that would not have
  // noticed the guard being deleted outright. Both halves are now pinned
  // explicitly, and the marker's existence is asserted so it cannot go vacuous
  // again.
  //
  // The CONTRACT also changed, and that is the substantive fix: the guard
  // originally wrapped the user-side sinks too, so a truncated turn erased the
  // user's own QUESTION from the session transcript, the usage log, and the
  // phone mirror. The question is not in doubt just because the answer stopped
  // early. Answer-side sinks are gated; user-side sinks always run.
  const ANSWER_SIDE_REGION = (() => {
    const start = ipcSrc.indexOf('// ── ANSWER-SIDE SINKS (skipped when truncated) ──');
    const end = ipcSrc.indexOf('} // end answer-side sinks');
    return { start, end, text: start > 0 && end > start ? ipcSrc.slice(start, end) : null };
  })();

  test('the answer-side region is delimited (guards this test against going vacuous)', () => {
    assert.ok(ANSWER_SIDE_REGION.start > 0, 'the ANSWER-SIDE SINKS marker is missing');
    assert.ok(ANSWER_SIDE_REGION.end > ANSWER_SIDE_REGION.start, 'the end marker is missing or precedes the start');
    assert.ok(
      ANSWER_SIDE_REGION.text.length < ipcSrc.length * 0.05,
      'the delimited region is implausibly large — the markers are not bracketing what they claim',
    );
  });

  test('answer-side sinks are gated on the outcome', () => {
    for (const sink of ['recordAnswerSummary', '_manualConversationMemory.record']) {
      assert.ok(
        ANSWER_SIDE_REGION.text.includes(sink),
        `${sink} writes the assistant answer into conversation state and must be gated`,
      );
    }
    assert.match(
      ANSWER_SIDE_REGION.text,
      /if \(!v3Truncated\) \{/,
      'the answer-side region must actually be conditioned on the outcome',
    );
  });

  test('the two answer-side emitters outside that region carry their own guard', () => {
    for (const call of ['addAssistantMessage', 'publishAssistantMessage']) {
      const re = new RegExp(`if \\(!v3Truncated\\) [^;\\n]*${call}`);
      assert.match(ipcSrc, re, `${call} must be individually gated on !v3Truncated`);
    }
  });

  test('USER-side sinks are NOT gated — the question survives a truncated answer', () => {
    // The regression this pins: a truncated turn must still leave the meeting
    // transcript, the usage row, and the phone mirror knowing what was asked.
    const userSinks = [
      { call: "addTranscript?.({ text: String(message || ''), speaker: 'user'", what: 'the session transcript' },
      { call: "logUsage?.('chat'", what: 'the Meeting Notes usage row' },
      { call: 'publishUserMessage', what: 'the phone mirror' },
    ];
    for (const { call, what } of userSinks) {
      const idx = ipcSrc.indexOf(call);
      assert.ok(idx > 0, `could not locate the user-side sink for ${what}`);
      assert.ok(
        idx < ANSWER_SIDE_REGION.start || idx > ANSWER_SIDE_REGION.end,
        `${what} must not sit inside the answer-side guard`,
      );
      // And it must not carry an inline guard either.
      const lineStart = ipcSrc.lastIndexOf('\n', idx);
      const line = ipcSrc.slice(lineStart, idx);
      assert.ok(
        !/if \(!v3Truncated\)/.test(line),
        `${what} must record the user's turn regardless of whether the answer completed`,
      );
    }
  });

  test('the renderer is told the answer is incomplete', () => {
    const done = ipcSrc.slice(ipcSrc.indexOf("event.sender.send('gemini-stream-done', {"));
    assert.match(done.slice(0, 400), /incomplete: v3Truncated/, 'the done payload must carry the incomplete flag');
  });

  test('the debug trace records it as a non-success', () => {
    assert.match(
      ipcSrc,
      /finishDebug\(finalText, !v3Truncated, v3Truncated \? 'stream_truncated' : null\)/,
      'a truncated turn must not be traced as a successful generation',
    );
  });
});

describe('the WTA path is protected too, not just manual chat', () => {
  // Code review 2026-08-12. The original fix wired manual chat only — while the
  // live capture that motivated it was a `what_to_answer` turn
  // (`addAssistantMessage length=25210, surface: what_to_answer`). WTA called
  // plain `streamChat`, so it could not observe truncation, and
  // IntelligenceEngine stored the answer unconditionally. A truncated WTA
  // answer went into the session transcript, usage, and — via
  // `temporalContext.previousResponses` — the NEXT turn's evidence.
  //
  // Third occurrence this session of "fixed one surface, missed the sibling"
  // (see also 0f4fc959 and the streamChatWithGemini cap gap), which is why
  // these assertions name both surfaces rather than one.
  const wtaSrc = fs.readFileSync(path.resolve(__dirname, '../WhatToAnswerLLM.ts'), 'utf8');
  const engineSrc = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');

  test('WhatToAnswerLLM consumes the outcome-bearing API', () => {
    assert.match(
      wtaSrc,
      /streamChatWithOutcome === 'function'/,
      'WTA must prefer streamChatWithOutcome or it cannot detect a truncated answer',
    );
    assert.doesNotMatch(
      wtaSrc,
      /for await \(const token of \(?this\.llmHelper[^\n]*\.streamChat\(/,
      'WTA still consumes plain streamChat directly — that path cannot see truncation',
    );
  });

  test('the plain-streamChat fallback is for test doubles only, never production', () => {
    // WTA falls back to `streamChat` when the injected helper lacks
    // streamChatWithOutcome, so the 14 suites that stub only `streamChat` keep
    // working. That fallback loses truncation detection, so it must never be
    // the live path: assert the REAL LLMHelper exposes the richer method.
    assert.equal(
      typeof LLMHelper.prototype.streamChatWithOutcome,
      'function',
      'the real LLMHelper lost streamChatWithOutcome — WTA would silently degrade to the pre-fix behaviour',
    );
  });

  test('the truncation sink is caller-owned, not instance state', () => {
    // WhatToAnswerLLM is a long-lived singleton and turns can overlap, so a
    // `this.lastOutcome` field would race between concurrent answers.
    assert.match(wtaSrc, /truncationSink\?:\s*\{\s*truncated:\s*boolean\s*\}/);
    assert.doesNotMatch(wtaSrc, /this\.(lastOutcome|lastTruncated)\b/);
  });

  test('the engine passes a sink and gates the session write on it', () => {
    assert.match(engineSrc, /const wtaTruncation = \{ truncated: false \}/);
    assert.match(engineSrc, /generateStream\([\s\S]{0,600}?wtaTruncation\)/);
    const guard = engineSrc.indexOf('if (wtaTruncation.truncated) {');
    assert.ok(guard > 0, 'the engine must gate its write policy on truncation');
    const block = engineSrc.slice(guard, guard + 500);
    assert.match(block, /decideSessionWritePolicy/, 'must go through the existing write-policy decision');
    assert.match(block, /validationOk: false/, 'a truncated answer is not a valid one');
  });

  test('the gate precedes the addAssistantMessage call it governs', () => {
    const guard = engineSrc.indexOf('if (wtaTruncation.truncated) {');
    const write = engineSrc.indexOf("addAssistantMessage(finalWtaAnswer, wtaWriteDecision, 'what_to_answer')");
    assert.ok(guard > 0 && write > 0);
    assert.ok(guard < write, 'the write policy must be decided BEFORE the session write');
  });
});

// Code-review 2026-08-13. `_streamChatInner` ends a post-commit provider failure
// by yielding TRUNCATION_SENTINEL and returning, on the stated principle that
// throwing "would make every consumer's existing catch reclassify a partial
// answer as a failed generation" (LLMHelper.ts:~5105). Every site was converted
// EXCEPT the Gemini cascade, which still did `if (geminiYielded || aborted)
// throw e` — and since the Gemini cascade is the PRIMARY text path, the whole
// `incomplete` signal was dead exactly where it mattered most: the user got an
// error banner over an answer they had already partly read.
//
// Enumerated rather than spot-checked, so a NEW post-commit site that throws
// fails here instead of silently reopening the hole.
describe('no post-commit site in _streamChatInner ends the turn by throwing', () => {
  const lines = llmSrc.split('\n');

  // The commit-state guards: reaching one means bytes are already on the wire.
  //
  // Matched on the CONDITION, not on a fixed `if (x) {` shape. The narrow form
  // missed the exact regression this suite exists to catch: reverting the Gemini
  // branch to `if (geminiYielded || abortSignal?.aborted) throw e;` is a compound
  // condition with a single-statement body, so it was never enumerated and the
  // throw check silently skipped it. `[^)]*` cannot cross a `)`, which is what
  // keeps `if (typeof chunk === 'string' && …) commit.emitted = true` — an
  // assignment, not a guard — out of the set.
  const postCommitGuards = lines
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /^\s*if \([^)]*(?:commit\.emitted|geminiYielded)\b[^)]*\)/.test(line));

  test('the post-commit guards are found (this test is not vacuous)', () => {
    assert.ok(postCommitGuards.length >= 7, `expected the known post-commit sites, found ${postCommitGuards.length}`);
  });

  // streamChatWithGemini's rotation loop is the ONE documented exception:
  // RAGManager consumes that generator directly, so a sentinel would leak into
  // its output. It reports truncation on the caller-owned state instead, and
  // still must not throw. Keyed on the METHOD'S BYTE RANGE, not on comment text
  // — an exclusion that matches a comment breaks when the comment is reworded,
  // and silently exempts any new post-commit site that lands near it.
  const RAG_PATH_RANGE = (() => {
    const start = llmSrc.indexOf('public async * streamChatWithGemini(');
    const end = llmSrc.indexOf('private async *streamVisionWithFallback(', start);
    assert.ok(start > 0 && end > start, 'could not bound streamChatWithGemini');
    return { startLine: llmSrc.slice(0, start).split('\n').length, endLine: llmSrc.slice(0, end).split('\n').length };
  })();
  const inRagPath = (n) => n >= RAG_PATH_RANGE.startLine && n <= RAG_PATH_RANGE.endLine;

  test('each one yields the sentinel and none of them throws', () => {
    assert.ok(
      postCommitGuards.some(({ n }) => inRagPath(n)),
      'the RAG-path exception was not found inside streamChatWithGemini — the exclusion is not matching what it claims',
    );
    for (const { n } of postCommitGuards) {
      const block = lines.slice(n - 1, n + 5).join('\n');
      if (!inRagPath(n)) {
        assert.match(
          block,
          /yield LLMHelper\.TRUNCATION_SENTINEL;/,
          `post-commit site at L${n} does not signal truncation`,
        );
      }
      assert.doesNotMatch(
        block,
        /\bthrow\b/,
        `post-commit site at L${n} THROWS — the consumer will reclassify a partial answer as a failed generation`,
      );
    }
  });

  test('a caller ABORT still throws — cancellation is not truncation', () => {
    // The Gemini branch must distinguish the two: an aborted turn is the user
    // cancelling, which should not be reported as a truncated answer.
    const idx = llmSrc.indexOf('if (abortSignal?.aborted) throw e;');
    assert.ok(idx > 0, 'the abort case must remain a throw');
    const after = llmSrc.slice(idx, idx + 500);
    assert.match(after, /if \(geminiYielded\) \{/, 'the truncation branch must follow the abort branch');
  });
});

// Code-review 2026-08-14. Splitting the truncation guard by side (so the user's
// QUESTION survives) moved `logUsage` outside it — but the usage log is not
// write-only. SessionTracker.getRecentManualTurn reads fullUsage, and
// IntelligenceEngine.buildRecentManualContext injects the question/answer pair
// into the NEXT prompt as <previous_assistant_answer_excerpt>. Plain logUsage
// therefore fed the truncated answer back as conversation context within the
// 5-minute window — defeating the answer-side guard through a second door, and
// a regression introduced by that split (previously the whole block was skipped).
//
// `synthetic: true` is the existing opt-out: getRecentManualTurn skips those
// entries while every persistence path still returns them, so the Meeting Notes
// usage row survives and the replay does not.
describe('a truncated turn is logged as usage but never replayed as context', () => {
  const trackerSrc = fs.readFileSync(path.resolve(__dirname, '../../SessionTracker.ts'), 'utf8');
  const managerSrc = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceManager.ts'), 'utf8');

  test('getRecentManualTurn still honours the synthetic opt-out', () => {
    // The whole fix rests on this. If the skip is removed, the truncated answer
    // silently starts replaying again.
    const start = trackerSrc.indexOf('getRecentManualTurn(');
    assert.ok(start > 0, 'getRecentManualTurn not found');
    const body = trackerSrc.slice(start, start + 900);
    assert.match(body, /if \(entry\.synthetic === true\) continue;/, 'the synthetic opt-out was removed');
  });

  test('the truncated branch marks the entry synthetic', () => {
    const start = ipcSrc.indexOf('if (v3Truncated) {\n                  im?.pushUsage?.({');
    assert.ok(start > 0, 'the truncated usage branch is missing');
    const body = ipcSrc.slice(start, start + 400);
    assert.match(body, /synthetic: true/, 'a truncated turn must not be reusable as conversation context');
    assert.match(body, /source: 'manual_chat'/, 'the row must still look like a manual-chat turn to the usage panel');
  });

  test('the complete branch still uses plain logUsage (no over-correction)', () => {
    const idx = ipcSrc.indexOf("im?.logUsage?.('chat'");
    assert.ok(idx > 0, 'the non-truncated path must still log usage normally');
    const before = ipcSrc.slice(Math.max(0, idx - 200), idx);
    assert.match(before, /\} else \{/, 'plain logUsage must sit in the else branch');
  });

  test('IntelligenceManager actually exposes pushUsage', () => {
    // The call site uses `im?.pushUsage?.(...)`. Optional chaining means a
    // MISSING method fails silently and drops the usage row entirely — the very
    // bug this whole area exists to prevent. Pin the proxy's existence.
    assert.match(
      managerSrc,
      /pushUsage\(entry: any\): void \{\s*\n\s*this\.session\.pushUsage\(entry\);/,
      'IntelligenceManager must proxy pushUsage, or the optional call silently no-ops',
    );
  });
});
