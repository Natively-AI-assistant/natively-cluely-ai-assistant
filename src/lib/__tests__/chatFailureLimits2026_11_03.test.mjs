// A trial whose AI allowance ran out was counted as a rejected key (2026-11-03).
//
// The answer fell through every provider to main's last line, "No AI provider
// configured. Please add at least one API key in Settings.", and "API key" in
// that sentence read as AUTH_FAILED: "Natively rejected your key or sign-in"
// in the overlay, `answer_failed { cause: 'auth' }` in the funnel. That
// sentence means nothing is set up, which is its own cause.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chatFailureFromError, isProviderFailureSentence } from '../chatFailure.mjs';
import { answerFailureCause } from '../funnel/answerFailure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const llmHelper = fs.readFileSync(path.join(here, '../../../electron/LLMHelper.ts'), 'utf8');

test("main's no-provider sentences are setup, not a rejected key", () => {
  const body = llmHelper.slice(llmHelper.indexOf('private noProviderAvailableMessage(): string {'));
  assert.ok(body.includes("'No AI provider configured. Please add at least one API key in Settings.'"), 'the sentence this test guards is still main\'s');
  for (const raw of [
    'No AI provider configured. Please add at least one API key in Settings.',
    "Error invoking remote method 'gemini-chat-stream': Error: No AI provider configured. Please add at least one API key in Settings.",
  ]) {
    for (const provider of ['Natively', 'OpenAI', '']) {
      const failure = chatFailureFromError(raw, { provider });
      assert.equal(failure.code, 'NO_PROVIDER_CONFIGURED', `${provider}: ${raw}`);
      assert.equal(failure.provider, undefined, 'no provider failed: none was asked');
      assert.equal(answerFailureCause(failure), 'setup', raw);
    }
  }
});

test('the switched-off sentence keeps its own words, as before', () => {
  const raw = 'No AI provider is available: Gemini is switched off in Settings > AI Providers. Switch one back on, or add another provider key.';
  const failure = chatFailureFromError(raw, { provider: 'Natively' });
  assert.notEqual(failure.code, 'AUTH_FAILED');
  assert.notEqual(failure.code, 'NO_PROVIDER_CONFIGURED');
});

test('a provider that really rejected its key is still auth', () => {
  for (const raw of ['401 Unauthorized: invalid api key', 'Incorrect API key provided: sk-…', 'permission_denied']) {
    const failure = chatFailureFromError(raw, { provider: 'OpenAI' });
    assert.equal(failure.code, 'AUTH_FAILED', raw);
    assert.equal(answerFailureCause(failure), 'auth', raw);
  }
});

test("the engine's account and setup sentences are recognised as its own, so the notice is said once", () => {
  for (const sentence of [
    'Your free trial has ended. Pick a plan or add your own keys to keep getting answers.',
    "You've reached your Natively plan's limit. See Settings › Plans to keep getting answers.",
    'Your Natively plan has expired. Renew it in Settings › Plans to keep getting answers.',
    'No AI provider is set up yet. Add one in Settings › AI Providers.',
  ]) {
    assert.equal(isProviderFailureSentence(sentence), true, sentence);
  }
});
