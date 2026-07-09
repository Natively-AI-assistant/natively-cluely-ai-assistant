// electron/llm/__tests__/CannedFallbackPhraseFilter2026_07_05.test.mjs
//
// Regression for the "responses not working" / "session memory lost" bug
// reported 2026-07-05: LLMHelper.processResponse and SessionTracker.
// addAssistantMessage both used a `.includes()` SUBSTRING match against
// canned-fallback phrases ("I'm not sure", "It depends", "I can't answer",
// "I don't know"). That meant any honest, useful answer merely CONTAINING
// one of those phrases mid-sentence was thrown away — processResponse threw
// "Filtered fallback response" (silencing generateSummary and every
// tryGenerateResponse fallback chain), and SessionTracker silently dropped
// the message from contextItems/fullTranscript/assistantResponseHistory.
//
// Fix: match only when the ENTIRE (trimmed, punctuation-stripped) text IS
// one of the canned phrases — never as a substring of a longer real answer.
//
// Deterministic; no LLM calls.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { LLMHelper } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js')).href
);
const { SessionTracker } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js')).href
);

// processResponse is a private instance method, but its ONLY `this`-dependency
// is the sibling pure method cleanJsonResponse (markdown-fence strip + trim —
// no I/O, no client state). Constructing a real LLMHelper() pulls in
// ModelVersionManager, which calls Electron's app.getPath('userData') and
// throws under plain `node --test` (no Electron app context). Invoke the
// method via .call() against a minimal stand-in object instead of
// constructing the full class, so this test stays a fast, dependency-free
// `node --test` run rather than needing the ELECTRON_RUN_AS_NODE runner.
function callProcessResponse(text) {
  const stub = { cleanJsonResponse: LLMHelper.prototype.cleanJsonResponse };
  return LLMHelper.prototype.processResponse.call(stub, text);
}

describe('LLMHelper.processResponse — canned-fallback filter', () => {
  test('throws on an EXACT canned fallback phrase (case-insensitive, trailing punctuation)', () => {
    for (const phrase of ["I'm not sure", "It depends", "I can't answer", "I don't know", "i'm not sure.", "IT DEPENDS!"]) {
      assert.throws(() => callProcessResponse(phrase), /Filtered fallback response/, `expected throw for: "${phrase}"`);
    }
  });

  test('does NOT throw when the phrase is embedded in a real, honest answer', () => {
    const realAnswers = [
      "I don't know his exact title, but he's on the platform team and led the migration.",
      "I'm not sure whether it shipped in 2.6 or 2.7, but the changelog says July.",
      "It depends on the dataset size — for under 10k rows a hash join is faster.",
      "I can't answer that specific SQL question without seeing the schema, but here's the general pattern.",
    ];
    for (const answer of realAnswers) {
      assert.doesNotThrow(() => callProcessResponse(answer), `expected NO throw for: "${answer}"`);
    }
  });

  test('a totally unrelated answer passes through unchanged', () => {
    const text = 'The capital of France is Paris.';
    assert.equal(callProcessResponse(text), text);
  });
});

describe('SessionTracker.addAssistantMessage — canned-fallback filter', () => {
  test('drops an EXACT canned fallback message from history', () => {
    const session = new SessionTracker();
    session.addAssistantMessage("I'm not sure.");
    assert.equal(session.getLastAssistantMessage(), null);
    assert.equal(session.getAssistantResponseHistory().length, 0);
    assert.equal(session.getFullTranscript().length, 0);
  });

  test('keeps a real answer that merely contains a fallback phrase mid-sentence', () => {
    const session = new SessionTracker();
    const answer = "I don't know his exact title, but he's on the platform team and led the migration effort last year.";
    session.addAssistantMessage(answer);
    assert.equal(session.getLastAssistantMessage(), answer);
    assert.equal(session.getAssistantResponseHistory().length, 1);
    assert.equal(session.getFullTranscript().length, 1);
    assert.equal(session.getFullTranscript()[0].text, answer);
  });

  test('still drops short (<10 char) messages regardless of fallback-phrase content (unrelated existing guard)', () => {
    const session = new SessionTracker();
    session.addAssistantMessage('ok yes');
    assert.equal(session.getLastAssistantMessage(), null);
  });
});
