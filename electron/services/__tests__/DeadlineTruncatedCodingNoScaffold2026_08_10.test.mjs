// electron/services/__tests__/DeadlineTruncatedCodingNoScaffold2026_08_10.test.mjs
//
// USER-REPORTED (2026-08-09), reproduced: a CORRECT coding answer becomes
// visible, then is replaced by a placeholder scaffold containing content the
// model never produced.
//
// Mechanism (not the post-stream repair cascade the PR blamed — that measures
// 0-6ms):
//   1. The prose stream path buffers to STREAMING_SAFE_PREFIX_CHARS (160) before
//      emitting, so short prose is never visible and replacing it is correct.
//   2. The CODING path emits through CodingStreamGate, which opens on a heading
//      or at MAX_GATE_CHARS = 48 — far below 160. So a coding answer IS on
//      screen while `fullAnswer` is still short.
//   3. If the provider then stalls past the first-useful deadline, the stream is
//      cut short. `validateAnswerStructure` sees a coding answer missing its
//      required sections and overwrites it with a six-section scaffold whose
//      code block is the MISSING_CODE_MARKER and whose complexity is "O(?)".
//
// Measured before the fix: user saw 68 chars of correct approach text, 676 chars
// were committed — including a fake "Dry Run" section and `O(?)` placeholders.
//
// The fix: a DEADLINE-TRUNCATED answer is incomplete, not malformed. Scaffolding
// it fabricates sections the model never wrote and discards text the user is
// already reading. Keep the honest partial instead.

import assert from 'node:assert/strict';
import { test, describe, after } from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const llmPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js');

const require = createRequire(import.meta.url);
const { LIVE_TOTAL_HARD_TIMEOUT_MS } = require(llmPath);

// The engine warms a shared classifier worker that is kept alive by design.
after(() => new Promise((r) => setTimeout(() => { process.exit(0); r(); }, 200)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeHelper() {
  return {
    setNegotiationCoachingHandler() {},
    isUsingOllama() { return false; },
    async *streamChat() { /* no repair call expected on this path */ },
  };
}

/**
 * Drive a coding turn whose stream delivers real text and then stalls past the
 * first-useful deadline, exactly as a slow provider does in production.
 */
async function runDeadlineTruncatedCodingTurn(partial) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);

  const question = 'Write a Python function to reverse a linked list.';
  const session = new SessionTracker();
  session.addTranscript({ speaker: 'system', text: question, timestamp: Date.now(), final: true });

  const engine = new IntelligenceEngine(makeHelper(), session);
  engine.whatToAnswerLLM = {
    async *generateStream() {
      yield partial;
      await sleep(LIVE_TOTAL_HARD_TIMEOUT_MS + 3000); // provider stalls
      yield ' never arrives';
    },
  };

  const seen = [];
  let emitted = null;
  engine.on('suggested_answer_token', (t) => seen.push(t));
  engine.on('suggested_answer', (a) => { emitted = a; });

  const returned = await engine.runWhatShouldISay(question, 0.9, undefined, { skipCooldown: true });
  return { visible: seen.join(''), committed: emitted ?? returned ?? '' };
}

describe('a deadline-truncated coding answer is not replaced by a placeholder scaffold', () => {
  // Opens CodingStreamGate on the heading, so this text IS visible to the user
  // while still being under the 160-char safe-prefix threshold.
  const PARTIAL = '## Approach\nWalk the list, re-pointing each node to its predecessor.';

  test('the text the user already saw survives into the committed answer', async () => {
    const { visible, committed } = await runDeadlineTruncatedCodingTurn(PARTIAL);
    assert.ok(visible.trim().length > 0, 'precondition: the coding gate must have made text visible');
    assert.ok(
      committed.includes('re-pointing each node to its predecessor'),
      `visible text was discarded.\nSAW: ${JSON.stringify(visible)}\nGOT: ${JSON.stringify(committed)}`,
    );
  });

  test('no fabricated code block is invented for a truncated stream', async () => {
    const { committed } = await runDeadlineTruncatedCodingTurn(PARTIAL);
    assert.ok(
      !/did not return code\. Regenerate/i.test(committed),
      `placeholder code marker was injected:\n${committed}`,
    );
  });

  test('no fabricated complexity/dry-run sections are invented', async () => {
    const { committed } = await runDeadlineTruncatedCodingTurn(PARTIAL);
    assert.ok(!/O\(\?\)/.test(committed), `placeholder complexity injected:\n${committed}`);
    assert.ok(
      !/Trace a small sample input through the code/i.test(committed),
      `fabricated dry-run section injected:\n${committed}`,
    );
  });

  test('the answer does not balloon far beyond what the model actually produced', async () => {
    const { committed } = await runDeadlineTruncatedCodingTurn(PARTIAL);
    // Pre-fix this was 68 chars in -> 676 chars committed, nearly all fabricated.
    assert.ok(
      committed.length < PARTIAL.length * 3,
      `answer grew from ${PARTIAL.length} to ${committed.length} chars — scaffold was applied`,
    );
  });
});
