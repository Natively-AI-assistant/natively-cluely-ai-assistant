// The Fast Model picker's advisory hint.
//
// This list is deliberately NOT a filter. A hand-maintained allow-list used to
// gate the dropdown would go stale every time a provider ships a model (this
// repo has been burned by model retirements), and would hide good new options.
// Because it only drives a hint, a stale entry costs a missing or spurious hint
// and nothing more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKnownFastModel } from '../fastModelHint.mjs';

test('known small tiers do not warn', () => {
  for (const id of ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gpt-5.5',
                    'gpt-5.4-mini', 'gpt-5.4-nano', 'deepseek-v4-flash',
                    'llama-3.3-70b-versatile', 'openrouter/google/gemini-3.8-flash']) {
    assert.equal(isKnownFastModel(id), true, id);
  }
});

test('large models warn', () => {
  for (const id of ['gpt-5.6-luna', 'claude-sonnet-4-6', 'gemini-3.8-pro', 'gpt-5.4']) {
    assert.equal(isKnownFastModel(id), false, id);
  }
});

test('unset and junk never warn — the hint is for a real slow pick only', () => {
  for (const id of ['', null, undefined, 'auto']) {
    assert.equal(isKnownFastModel(id), true, String(id));
  }
});
