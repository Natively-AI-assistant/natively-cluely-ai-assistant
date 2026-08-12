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

  test('the history and memory sinks are gated on the outcome', () => {
    // The specific sinks that poison later turns.
    const start = ipcSrc.indexOf('if (v3Truncated) {');
    assert.ok(start > 0, 'no truncation guard found around the storage sinks');
    const guarded = ipcSrc.slice(start, ipcSrc.indexOf('} // end !v3Truncated'));
    for (const sink of [
      'recordAnswerSummary',
      '_manualConversationMemory.record',
      'addAssistantMessage',
      'logUsage',
    ]) {
      assert.ok(guarded.includes(sink), `${sink} is not inside the truncation guard`);
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
