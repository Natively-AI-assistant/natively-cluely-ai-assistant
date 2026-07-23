// Campaign 2 longsession runs 026/027 (2026-07-18): a live-path integration
// test for extractAnswerFromJsonEnvelope / isLeakedJsonEnvelope, wired into
// IntelligenceEngine.ts right before the existing isLeakedSchemaStub
// blanking guard. Confirms real JSON-wrapped content is recovered and
// genuinely empty envelopes are still blanked with an honest fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

function makeHelper() {
  return {
    setNegotiationCoachingHandler() {},
  };
}

async function makeEngineWithAnswer(chunks, { question } = {}) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();

  session.addTranscript({
    speaker: 'system',
    text: question || 'Tell me about a production incident you handled, specifically one where you were the incident commander.',
    timestamp: Date.now(),
    final: true,
  });

  const engine = new IntelligenceEngine(makeHelper(), session);
  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
    },
  };

  return { engine, session };
}

test('a JSON-wrapped real answer ({"answer": "..."}) is recovered, not shipped raw or blanked (C2/A18 repro)', async () => {
  const raw = '{"answer": "Sure, here\'s a classic shape: I was the incident commander when our payments API started failing for a subset of merchants.", "chat_id": 0}';
  const { engine, session } = await makeEngineWithAnswer([raw]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.match(answer, /incident commander when our payments API/);
  assert.doesNotMatch(answer, /"answer":/);
  assert.doesNotMatch(answer, /chat_id/);
  assert.deepEqual(finals, [answer]);
  assert.equal(
    session.getFullTranscript().some(segment => segment.text.includes('chat_id')),
    false,
    'the raw JSON envelope must never reach session history',
  );
});

test('a genuinely empty JSON envelope ({"key_facts": []}) is blanked with an honest fallback, not shipped raw', async () => {
  const { engine, session } = await makeEngineWithAnswer(['{"key_facts": []}']);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.doesNotMatch(answer, /key_facts/);
  assert.ok(answer.length > 0, 'must ship SOME honest message, not silence');
  assert.deepEqual(finals, [answer]);
});

test('a real, unstructured answer is never touched by either guard', async () => {
  const realAnswer = 'I owned the payments orchestration platform at Stripe, which sat between our internal services and the card networks.';
  const { engine } = await makeEngineWithAnswer([realAnswer]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.deepEqual(finals, [realAnswer]);
});

// ── Code-review 2026-07-18 HIGH fix: isLeakedJsonEnvelope's shape-only
//    heuristic cannot tell a hallucinated envelope from a real, correct,
//    terse JSON-shaped answer on a technical/system-design question — the
//    isLeakedJsonEnvelope OR-branch is scoped away from those answerTypes
//    at the IntelligenceEngine.ts call site (isLeakedSchemaStub, the
//    narrower pre-existing check, remains unconditional). ─────────────────
test('a real, terse JSON-shaped answer to a system-design question is NEVER blanked (call-site exclusion)', async () => {
  const realAnswer = '{"status":"ok","code":200}';
  const { engine } = await makeEngineWithAnswer(
    [realAnswer],
    // Verified via a direct planAnswer() call with the same parameters the
    // live path actually uses (source: 'what_to_answer', no candidate
    // profile) that this exact phrasing routes to system_design_answer —
    // a shorter/more generic phrasing ("give me an example of a rate
    // limiter response") routed to behavioral_interview_answer instead once
    // run through the real classifier without profile context, so this
    // wording is pinned specifically to land in the excluded set.
    { question: 'Design a rate limiter and describe what the response looks like when a request is allowed.' },
  );
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.deepEqual(finals, [realAnswer]);
});
