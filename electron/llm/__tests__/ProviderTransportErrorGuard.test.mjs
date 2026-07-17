// electron/llm/__tests__/ProviderTransportErrorGuard.test.mjs
//
// Campaign 2 (longsession, 2026-07-17) fix: WhatToAnswerLLM.generateStream's
// catch block yields a fixed provider-transport-error string when the STREAM
// ITSELF fails (expired key, 429, billing). That string is real and useful to
// show the user, but is NOT an answer — before this fix it had no guard and
// got persisted into session history like a real answer via the default
// 'store_conversational_only' write policy. A LATER press's prompt then
// contained a poisoned `[ASSISTANT]: I couldn't reach the AI provider...` turn,
// and the model treated the session as mid error-recovery instead of
// answering the next real question. Live-proven on a real 30-minute benchmark
// run (traces2/harness-script-a-press-A12.txt).
//
// Run: npm run build:electron && node --test electron/llm/__tests__/ProviderTransportErrorGuard.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const answerPolishPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/answerPolish.js');
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

const PROVIDER_TRANSPORT_ERROR_TEXT =
  "I couldn't reach the AI provider — this looks like an API key or rate-limit issue. Check your API keys / plan in Settings and try again.";

describe('isProviderTransportError (pure detector)', async () => {
  const { isProviderTransportError } = await import(pathToFileURL(answerPolishPath).href);

  test('matches the exact provider-transport-error string', () => {
    assert.equal(isProviderTransportError(PROVIDER_TRANSPORT_ERROR_TEXT), true);
  });

  test('matches with surrounding whitespace trimmed', () => {
    assert.equal(isProviderTransportError(`  ${PROVIDER_TRANSPORT_ERROR_TEXT}  \n`), true);
  });

  test('does NOT match a real answer that happens to discuss API keys', () => {
    const realAnswer = "I once had to rotate an API key after a rate-limit issue took down our staging environment for a day.";
    assert.equal(isProviderTransportError(realAnswer), false);
  });

  test('does NOT match empty/null/undefined', () => {
    assert.equal(isProviderTransportError(''), false);
    assert.equal(isProviderTransportError(null), false);
    assert.equal(isProviderTransportError(undefined), false);
  });

  test('does NOT match a near-miss variant', () => {
    assert.equal(isProviderTransportError("I couldn't reach the AI provider. Try again later."), false);
  });
});

function makeHelper() {
  return { setNegotiationCoachingHandler() {} };
}

async function makeEngineWithAnswer(chunks) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(), session);
  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
    },
  };
  return { engine, session };
}

describe('runWhatShouldISay: provider-transport-error is shown but never persisted', () => {
  test('the error text is still returned/emitted to the user (ungated delivery)', async () => {
    const { engine, session } = await makeEngineWithAnswer([PROVIDER_TRANSPORT_ERROR_TEXT]);
    const events = [];
    engine.on('suggested_answer', answer => events.push(answer));

    const answer = await engine.runWhatShouldISay('anything?', 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, PROVIDER_TRANSPORT_ERROR_TEXT);
    assert.deepEqual(events, [PROVIDER_TRANSPORT_ERROR_TEXT]);
  });

  test('the error text is NEVER persisted into session history (the actual bug fix)', async () => {
    const { engine, session } = await makeEngineWithAnswer([PROVIDER_TRANSPORT_ERROR_TEXT]);

    await engine.runWhatShouldISay('anything?', 0.9, undefined, { skipCooldown: true });

    assert.equal(
      session.getFullTranscript().some(segment => segment.text.includes("couldn't reach the AI provider")),
      false,
      'the provider-transport-error text must never appear in fullTranscript (would poison a later prompt)',
    );
    assert.equal(session.getLastAssistantMessage(), null, 'must not become the session\'s lastAssistantMessage either');
  });

  test('the error text is NOT counted in fullUsage (mirrors the leaked-schema-stub / timeout precedent)', async () => {
    const { engine, session } = await makeEngineWithAnswer([PROVIDER_TRANSPORT_ERROR_TEXT]);

    await engine.runWhatShouldISay('anything?', 0.9, undefined, { skipCooldown: true });

    assert.deepEqual(session.getFullUsage(), []);
  });

  test('a REAL answer (not the error text) is still persisted normally — no over-suppression', async () => {
    const realAnswer = 'I would explain the tradeoff clearly and ask which constraint matters most.';
    const { engine, session } = await makeEngineWithAnswer(['I would explain ', 'the tradeoff clearly ', 'and ask which constraint matters most.']);

    const answer = await engine.runWhatShouldISay('how should I answer?', 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, realAnswer);
    assert.equal(session.getFullTranscript().some(segment => segment.text === realAnswer), true);
    assert.equal(session.getFullUsage().length, 1);
  });

  // Skeptic-pass regression (Campaign 2, 2026-07-17): the FIRST draft of this
  // fix placed the guard AFTER validateAnswerStructure/repairCodingMarkdown.
  // For a CODING-type question, that repair pipeline wraps a short raw answer
  // (including the transport-error text) into a six-section markdown scaffold
  // BEFORE the guard's exact-match check ran — so the guard silently never
  // fired for coding questions, and the transport-error text (now buried
  // inside a "## Approach" heading) got persisted into session history like a
  // real answer. Reproduced live against the compiled engine during the
  // skeptic pass; fixed by moving both guards to run on the RAW fullAnswer
  // immediately after the stream completes, before any repair pipeline runs.
  test('coding-type question: transport error is still caught before repairCodingMarkdown can mutate it', async () => {
    const { engine, session } = await makeEngineWithAnswer([PROVIDER_TRANSPORT_ERROR_TEXT]);

    // "solve two sum" reliably plans to a coding answer type
    // (dsa_question_answer) via the what_to_answer source — see
    // WtaParallelPrestream.test.mjs / SessionFollowup2026_06_07c.test.mjs for
    // the same fixture phrase used as an established coding-question probe.
    const answer = await engine.runWhatShouldISay('solve two sum', 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, PROVIDER_TRANSPORT_ERROR_TEXT, 'the coding-repair pipeline must not have wrapped/mutated the error text');
    assert.equal(
      session.getFullTranscript().some(segment => segment.text.includes("couldn't reach the AI provider")),
      false,
      'must not be persisted even when repairCodingMarkdown would otherwise have wrapped it into a scaffold first',
    );
    assert.deepEqual(session.getFullUsage(), []);
  });
});
