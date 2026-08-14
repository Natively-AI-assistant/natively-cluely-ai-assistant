// electron/llm/__tests__/RunawayStreamOutputCap2026_08_12.test.mjs
//
// Live capture 2026-08-12 (what_to_answer, Natively fast-mode):
//
//   tfft=2084ms  tokens=8047  chars=22871  totalStreamMs=61221
//   error='ai_unavailable'  message='The operation was aborted due to timeout'
//
// The model ran away for 61 seconds and 8047 tokens, and the SERVER aborted it —
// nothing on the client did. None of the existing guards applied:
//
//   LIVE_TOTAL_HARD_TIMEOUT_MS (13s)  bounds time to FIRST token; tfft was 2084ms
//   LIVE_INTER_TOKEN_STALL_MS  (8s)   bounds a mid-stream HANG; tokens flowed
//                                     continuously at ~131 tok/s
//
// Both are time-based, and a runaway is fast. `LIVE_INTER_TOKEN_STALL_MS`'s doc
// block explicitly refuses a wall-clock cap so healthy long answers are never
// truncated mid-sentence — which is correct, and is why the bound added here is
// on total CHARACTERS instead.
//
// This is defence in depth, NOT the complete fix: streamWithNatively's request
// body carries no max_tokens, and natively-api's /v1/chat destructures a fixed
// field list that does not include one, so the request still goes out unbounded.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_STREAM_OUTPUT_CHARS,
  LIVE_TOTAL_HARD_TIMEOUT_MS,
  LIVE_INTER_TOKEN_STALL_MS,
} from '../../../dist-electron/electron/llm/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');

// Measured in the same session the runaway occurred in: every `stream completed`
// event that carried a real answer.
const MEASURED_ANSWER_CHARS = [
  2342, 2250, 1003, 536, 2530, 497, 547, 505, 565, 487,
  668, 639, 628, 674, 660, 583, 653, 629, 913,
];
const LARGEST_LEGITIMATE = Math.max(...MEASURED_ANSWER_CHARS);
const RUNAWAY_CHARS = 22871;

describe('the runaway cap is sized off measured answers', () => {
  test('it is well above the largest legitimate answer ever measured', () => {
    // Guards against someone tightening this until it truncates real answers.
    assert.ok(
      MAX_STREAM_OUTPUT_CHARS >= LARGEST_LEGITIMATE * 4,
      `cap ${MAX_STREAM_OUTPUT_CHARS} is under 4x the largest measured answer (${LARGEST_LEGITIMATE}) — `
      + 'too close to real output to be safe',
    );
  });

  test('it is below the observed runaway', () => {
    // The whole point: this exact capture must be caught.
    assert.ok(
      MAX_STREAM_OUTPUT_CHARS < RUNAWAY_CHARS,
      `cap ${MAX_STREAM_OUTPUT_CHARS} would NOT have caught the observed ${RUNAWAY_CHARS}-char runaway`,
    );
  });

  test('it leaves room for a long six-section coding answer', () => {
    // A coding answer with several code blocks is the largest legitimate shape
    // this pipeline produces. ~8000 chars is a generous estimate for one.
    assert.ok(MAX_STREAM_OUTPUT_CHARS >= 8000 * 1.5, `cap ${MAX_STREAM_OUTPUT_CHARS} is too tight for a long coding answer`);
  });
});

describe('the cap is a character bound, not a wall-clock one', () => {
  test('the time-based guards are unchanged', () => {
    // Adding an output bound must not tempt anyone into shortening the
    // deadlines — they address different failure modes and the runaway proved
    // neither of them applies to it.
    assert.equal(LIVE_TOTAL_HARD_TIMEOUT_MS, 13000);
    assert.equal(LIVE_INTER_TOKEN_STALL_MS, 8000);
  });

  test('neither existing guard would have caught the runaway', () => {
    // Documents WHY a third guard was needed, in executable form.
    const observed = { tfftMs: 2084, maxInterTokenGapMs: 1000 / (131.44 / 8047) * 0 + 100 };
    assert.ok(
      observed.tfftMs < LIVE_TOTAL_HARD_TIMEOUT_MS,
      'first-token ceiling would have fired — then the runaway was not the failure mode',
    );
    assert.ok(
      observed.maxInterTokenGapMs < LIVE_INTER_TOKEN_STALL_MS,
      'stall guard would have fired — then the runaway was not the failure mode',
    );
  });
});

describe('the cap covers EVERY public streaming entry point', () => {
  // Code review 2026-08-12 caught this test asserting the wrong invariant. It
  // pinned "the cap is in streamChat" and called streamChat "the single point
  // every chunk passes through" — which was FALSE. streamChatWithGemini is a
  // second public generator that never touches streamChat, and RAGManager
  // consumes it directly, so the doc-grounded/RAG path was unbounded. The test
  // passed the whole time because it only ever looked at streamChat.
  //
  // Enumerate the public streaming generators and require each to be bounded,
  // so adding a third one fails here rather than shipping unbounded.
  const PUBLIC_STREAM_ENTRY_POINTS = ['streamChat', 'streamChatWithGemini', 'streamWithGroqOrGemini'];

  test('every public streaming generator is enumerated', () => {
    const declared = [...src.matchAll(/public async \* (\w+)\(/g)].map(m => m[1]);
    const streaming = declared.filter(n => /^stream/.test(n));
    assert.deepEqual(
      streaming.sort(),
      [...PUBLIC_STREAM_ENTRY_POINTS].sort(),
      'a public streaming generator was added or renamed — bound it with capOutput and list it here',
    );
  });

  test('each public streaming generator applies the output cap', () => {
    for (const name of PUBLIC_STREAM_ENTRY_POINTS) {
      const start = src.indexOf(`public async * ${name}(`);
      assert.ok(start > 0, `could not locate ${name}`);
      // Bound the slice at the next method declaration.
      const nextDecl = src.slice(start + 10).search(/\n  (?:public|private) async \*/);
      const body = src.slice(start, nextDecl > 0 ? start + 10 + nextDecl : start + 4000);
      // Accept either an inline cap or delegation to a bounded private impl —
      // `streamChat` is a thin wrapper over `_streamChatTracked`, which holds
      // the counter. What must never happen is a public streaming generator
      // that neither caps nor delegates to something that does.
      const bounded = /capOutput\(|MAX_STREAM_OUTPUT_CHARS/.test(body)
        || /yield\* this\._streamChatTracked\(/.test(body);
      assert.ok(bounded, `${name} streams to consumers without a total-output bound`);
    }
  });

  test('reaching the cap ends the stream by returning, never throwing', () => {
    // Same shape as a post-commit provider failure, so the consumer has one
    // way to observe "this stream stopped early" rather than two.
    const start = src.indexOf('emittedChars > MAX_STREAM_OUTPUT_CHARS');
    assert.ok(start > 0, 'could not locate the cap check');
    // Strip line comments before asserting on control flow — the code comment
    // here contains the word "throw" while explaining why it must not throw.
    const block = src
      .slice(start, start + 700)
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    assert.match(block, /return;/, 'the cap must end the stream');
    assert.doesNotMatch(
      block.slice(0, block.indexOf('return;')),
      /\bthrow\b/,
      'the cap must not throw — that would surface an error over a partial answer',
    );
  });

  test('the chunk is yielded before the cap is evaluated', () => {
    // Checking BEFORE yielding would drop a chunk the user should have seen;
    // the overshoot is bounded by one chunk, which is the right trade.
    const start = src.indexOf('for await (const chunk of this._streamChatInner');
    const body = src.slice(start, start + 900);
    const yieldIdx = body.indexOf('yield dashReducer.reduce(chunk);');
    const capIdx = body.indexOf('emittedChars > MAX_STREAM_OUTPUT_CHARS');
    assert.ok(yieldIdx > 0 && capIdx > 0);
    assert.ok(yieldIdx < capIdx, 'the chunk must be yielded before the cap check');
  });
});

describe('the cap actually bounds a runaway end-to-end', () => {
  // Source pins prove the code is SHAPED right; this proves it BEHAVES right.
  // Drives the real LLMHelper.prototype.streamChat with only _streamChatInner
  // stubbed, so the dash reducer, the abort check and the cap all really run.
  const CHUNK_SIZE = 200;
  const RUNAWAY_TOTAL = 100_000;

  async function driveRunaway() {
    const { LLMHelper } = await import('../../../dist-electron/electron/LLMHelper.js');
    const chunk = 'x'.repeat(CHUNK_SIZE);
    let produced = 0;
    const fake = Object.create(LLMHelper.prototype);
    fake._streamChatInner = async function* () {
      for (let i = 0; i < RUNAWAY_TOTAL / CHUNK_SIZE; i++) {
        produced += chunk.length;
        yield chunk;
      }
    };
    let received = 0;
    for await (const c of LLMHelper.prototype.streamChat.call(fake)) received += c.length;
    return { produced, received };
  }

  test('the consumer never receives more than the cap plus one chunk', async () => {
    const { received } = await driveRunaway();
    assert.ok(
      received <= MAX_STREAM_OUTPUT_CHARS + CHUNK_SIZE,
      `consumer received ${received}, above cap ${MAX_STREAM_OUTPUT_CHARS} + one chunk`,
    );
    assert.ok(received > MAX_STREAM_OUTPUT_CHARS, 'the cap truncated too early');
  });

  test('returning also stops the upstream generator', async () => {
    // Returning from the for-await closes the inner generator, so the runaway
    // provider stops being pulled instead of burning tokens into a void. This
    // is why the cap is worth having even though the server also aborts.
    const { produced } = await driveRunaway();
    assert.ok(
      produced < RUNAWAY_TOTAL,
      `upstream produced all ${produced} chars — the generator was not closed`,
    );
  });
});

describe('the unbounded request is recorded as still open', () => {
  test('streamWithNatively still sends no max_tokens', () => {
    // This asserts the CURRENT gap so it stays visible. natively-api's /v1/chat
    // destructures { messages, system, language, images, fast_mode, stream,
    // purpose } and would ignore the field today, so sending it alone would be
    // inert — the complete fix needs a server change.
    //
    // If this test starts FAILING, the bound was added: delete this block and
    // note whether the server honours it.
    const start = src.indexOf('private async * streamWithNatively(');
    assert.ok(start > 0, 'could not locate streamWithNatively');
    const bodyStart = src.indexOf('const body: Record<string, unknown> = {', start);
    const bodyEnd = src.indexOf('if (imagePaths?.length)', bodyStart);
    const requestBody = src.slice(bodyStart, bodyEnd);
    assert.doesNotMatch(
      requestBody,
      /max_tokens/,
      'a max_tokens bound was added — verify natively-api reads it, then delete this test',
    );
  });
});
