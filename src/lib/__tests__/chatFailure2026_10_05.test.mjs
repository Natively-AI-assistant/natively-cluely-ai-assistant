// The overlay's other answer paths word their failures like the direct-ask
// path does (2026-10-05).
//
// A quick action, a typed question on the legacy stream and an engine error
// used to print whatever was thrown: "❌ Error (what_to_say): Natively API HTTP
// 403 requestId=… endpoint=…: trial_expired", "[Error: …]", "Error: Error:
// Error invoking remote method …". chatFailureFromError sorts that string into
// the data DirectAssistNotice is drawn from. These are the real strings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatFailureFromError, isProviderFailureSentence, PROVIDER_FAILURE_SENTENCE_STARTS, scrubErrorText } from '../chatFailure.mjs';
import { directAssistFailureText, directAssistNoticeView, DIRECT_ASSIST_PHRASES, CHAT_HINTS } from '../directAssistFailure.mjs';

const view = (raw, context) => directAssistNoticeView({ failure: chatFailureFromError(raw, context), ended: true });
const shown = (raw, context) => {
  const v = view(raw, context);
  return [v.headline, v.detail ?? '', ...v.rows.flatMap((r) => [r.text, r.detail ?? ''])].join(' | ');
};

const NATIVELY_TRIAL = 'Natively API HTTP 403 requestId=nat_json_0d7b1f3a-6c2e-4b8a-a1f5-9e4c7d2b8f60 serverRequestId=n/a endpoint=https://api.natively.software/v1/chat: trial_expired';
const NATIVELY_STREAM_TRIAL = 'Natively API stream HTTP 403 requestId=nat_stream_5f0c2f6e-8a1d-4c57-9f0e-2b7d3a6e41c9 serverRequestId=n/a endpoint=https://api.natively.software/v1/chat: trial_expired';
const IPC_NO_HANDLER = "Error: Error: Error invoking remote method 'generate-clarify': Error: No handler registered for 'generate-clarify'";
const GEMINI_QUOTA = '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details.';
const OPENAI_KEY = 'Incorrect API key provided: sk-proj-****6789. You can find your API key at https://platform.openai.com/account/api-keys.';

const RAW = [
  [NATIVELY_TRIAL, {}],
  [NATIVELY_STREAM_TRIAL, {}],
  ['Natively API HTTP 401 requestId=nat_1 serverRequestId=n/a endpoint=https://api.natively.software/v1/chat: invalid_api_key', {}],
  [IPC_NO_HANDLER, { provider: 'Google' }],
  [GEMINI_QUOTA, { provider: 'Google' }],
  [OPENAI_KEY, { provider: 'OpenAI' }],
  ['401 Unauthorized', { provider: 'Deepgram' }],
  ['connect ECONNREFUSED 127.0.0.1:11434', { provider: 'Ollama' }],
  ['RESOURCE_EXHAUSTED: Quota exceeded for requests per minute', { provider: 'Google' }],
  ['Request failed with status code 503', { provider: 'Groq' }],
  ['500 Internal Server Error', {}],
  ["TypeError: Cannot read properties of undefined (reading 'text')", { provider: 'Google' }],
];

test('nothing machine-made reaches the screen: no code, status, id, endpoint, key or emoji', () => {
  for (const [raw, context] of RAW) {
    const out = shown(raw, context);
    const text = directAssistFailureText(chatFailureFromError(raw, context));
    for (const s of [out, text]) {
      // (not part of an address: 127.0.0.1 is where Ollama was looked for)
      assert.doesNotMatch(s, /(?<![.\d])[45]\d\d(?![.\d])/, `a status number in: ${s}`);
      assert.doesNotMatch(s, /requestId|serverRequestId|endpoint|https?:\/\//i, `an id or address in: ${s}`);
      assert.doesNotMatch(s, /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[a-z]+_[a-z_]+\b/, `a reason code in: ${s}`);
      assert.doesNotMatch(s, /\bE[A-Z]{5,}\b/, `a socket code in: ${s}`);
      assert.doesNotMatch(s, /sk-|\*{2,}/, `a key in: ${s}`);
      assert.doesNotMatch(s, /❌|\[Error|^Error\b|Error:/, `the old prefix in: ${s}`);
      assert.doesNotMatch(s, /invoking remote method|No handler registered|TypeError|undefined/, `an internal in: ${s}`);
    }
  }
});

test('a trial that ended says so, and does not send the user to AI Providers', () => {
  for (const raw of [NATIVELY_TRIAL, NATIVELY_STREAM_TRIAL]) {
    assert.deepEqual(chatFailureFromError(raw), { code: 'TRIAL_ENDED' });
    const v = view(raw);
    assert.equal(v.tone, 'failed');
    assert.equal(v.headline, 'Your free trial has ended');
    assert.equal(v.detail, undefined);
    // 403 alone would have read "rejected your key or sign-in", with a button
    // to a tab where nothing fixes a trial.
    assert.equal(v.fixable, false);
  }
  assert.ok(DIRECT_ASSIST_PHRASES.includes('Your free trial has ended'), 'published, so it is translated');
});

test("a provider's failure names the provider and the cause, with its own words underneath", () => {
  assert.equal(view('401 Unauthorized', { provider: 'OpenAI' }).headline, 'OpenAI rejected your key or sign-in');
  assert.equal(view('401 Unauthorized', { provider: 'OpenAI' }).detail, undefined, '"Unauthorized" adds nothing');
  assert.equal(view('401 Unauthorized', { provider: 'OpenAI' }).fixable, true);

  const quota = view(GEMINI_QUOTA, { provider: 'Google' });
  assert.equal(quota.headline, 'Google is out of credits');
  assert.equal(quota.detail, 'You exceeded your current quota, please check your plan and billing details.');

  const key = view(OPENAI_KEY, { provider: 'OpenAI' });
  assert.equal(key.headline, 'OpenAI rejected your key or sign-in');
  assert.equal(key.detail, 'Incorrect API key provided.', 'the key and the sentence that pointed at a link are gone');

  assert.equal(view('RESOURCE_EXHAUSTED: Quota exceeded for requests per minute', { provider: 'Google' }).headline, 'Google is rate limiting requests');
  assert.equal(view('The model `gpt-9` does not exist or you do not have access to it.', { provider: 'OpenAI' }).headline, "OpenAI doesn't have this model");
  assert.equal(view('Request timed out after 30000ms', { provider: 'Groq' }).headline, "Groq didn't respond in time");
  assert.equal(view('Request failed with status code 503', { provider: 'Groq' }).headline, 'Groq is overloaded');
});

test('our own relay is named Natively whatever model is selected', () => {
  const failure = chatFailureFromError('Natively API HTTP 401 requestId=nat_1 serverRequestId=n/a endpoint=https://api.natively.software/v1/chat: invalid_api_key', { provider: 'Google' });
  assert.equal(failure.provider, 'Natively');
  assert.equal(failure.code, 'AUTH_FAILED');
});

test('an unreachable provider shows only where it was looked for', () => {
  const v = view('connect ECONNREFUSED 127.0.0.1:11434', { provider: 'Ollama' });
  assert.equal(v.headline, "Ollama couldn't be reached");
  assert.equal(v.detail, '127.0.0.1:11434');
  assert.equal(view('TypeError: fetch failed', { provider: 'Groq' }).headline, "Groq couldn't be reached");
});

test('a fault inside Natively is not blamed on a provider and names no internals', () => {
  for (const raw of [IPC_NO_HANDLER, "TypeError: Cannot read properties of undefined (reading 'text')", 'Error: x.map is not a function']) {
    assert.deepEqual(chatFailureFromError(raw, { provider: 'Google' }), { code: 'INTERNAL_ERROR' });
    assert.equal(view(raw, { provider: 'Google' }).headline, 'Natively lost track of this answer. Ask again.');
  }
});

test("a sentence the app wrote is the explanation as it is, once, without the word Error", () => {
  const skill = 'Skill "/code-review" is disabled. Enable it in Settings → Skills.';
  assert.equal(view(skill, { provider: 'Google' }).headline, skill);
  assert.equal(view(`Error: ${skill}`, { provider: 'Google' }).headline, skill);
  const clarify = 'Could not generate a clarifying question. Try again after some audio context is available.';
  const v = view(clarify, { provider: 'Google' });
  assert.equal(v.headline, clarify);
  assert.equal(v.detail, undefined);
  assert.equal(v.fixable, false);
});

test('with nothing to go on, one plain sentence and never an empty line', () => {
  for (const raw of ['', null, undefined, 'Error', 'Error: ', {}]) {
    const v = view(raw, {});
    assert.equal(v.headline, "The request couldn't be completed.");
    assert.equal(v.rows.length, 0);
  }
  // A provider failed but nobody can be named: its words still show.
  const anon = view('429 Too Many Requests: slow down, you are sending requests too quickly', {});
  assert.equal(anon.headline, "The request couldn't be completed.");
  assert.equal(anon.detail, 'slow down, you are sending requests too quickly');
});

test('the text kept for Copy and later context is one sentence, with no provider words in it', () => {
  assert.equal(directAssistFailureText(chatFailureFromError(GEMINI_QUOTA, { provider: 'Google' })), 'Google is out of credits.');
  assert.equal(directAssistFailureText(chatFailureFromError(NATIVELY_TRIAL)), 'Your free trial has ended.');
});

test('scrubbing keeps a readable sentence whole and caps a long one', () => {
  assert.equal(scrubErrorText('Error: Error: Something specific went wrong with the upload.'), 'Something specific went wrong with the upload.');
  assert.equal(scrubErrorText('requestId=abc endpoint=https://x.y/z: some_code'), '');
  const long = scrubErrorText(`The provider said ${'very '.repeat(80)}much.`);
  assert.ok(long.length <= 241 && long.endsWith('…'));
});

test('the two "still working" hints are published sentences, so they are translated', () => {
  assert.deepEqual(Object.keys(CHAT_HINTS).sort(), ['code_hint', 'what_to_say']);
  for (const hint of Object.values(CHAT_HINTS)) {
    assert.ok(DIRECT_ASSIST_PHRASES.includes(hint));
    assert.doesNotMatch(hint, /—|one moment/);
  }
});

test("Natively's own plan running out is said as that, with no AI Providers button", () => {
  const api = (code) => `Natively API HTTP 402 requestId=nat_1 serverRequestId=n/a endpoint=https://api.natively.software/v1/chat: ${code}`;
  for (const code of ['quota_exceeded', 'ai_quota_exceeded', 'plan_limit', 'limit_exceeded', 'lifetime_exceeded']) {
    assert.deepEqual(chatFailureFromError(api(code)), { code: 'PLAN_LIMIT' }, code);
    const v = view(api(code));
    assert.equal(v.headline, "You've reached your Natively plan's limit");
    assert.equal(v.fixable, false, 'AI Providers cannot fix a Natively plan');
    assert.equal(v.detail, undefined);
  }
  for (const code of ['subscription_expired', 'license_expired']) {
    assert.equal(view(api(code)).headline, 'Your Natively plan has expired');
    assert.equal(view(api(code)).fixable, false);
  }
  // Somebody else's quota is still that provider's credits, with the button.
  const other = view('429 insufficient_quota: You exceeded your current quota', { provider: 'OpenAI' });
  assert.equal(other.headline, 'OpenAI is out of credits');
  assert.equal(other.fixable, true);
  for (const phrase of ["You've reached your Natively plan's limit", 'Your Natively plan has expired']) {
    assert.ok(DIRECT_ASSIST_PHRASES.includes(phrase), 'published, so it is translated');
  }
});

test("the engine's own failure sentences are recognised, and still match main's source", () => {
  const main = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../electron/llm/providerErrorClassifier.ts'), 'utf8');
  for (const start of PROVIDER_FAILURE_SENTENCE_STARTS) {
    assert.ok(main.includes(start), `main no longer says: ${start}`);
    assert.equal(isProviderFailureSentence(`${start} and the rest of it.`), true);
  }
  // Every sentence providerFailureUserMessage can return is covered.
  const returned = [...main.matchAll(/return (?:transportSignal\s*\?\s*)?(["'])((?:I couldn't|The AI provider)[^\n]*?)\1;?/g)].map((m) => m[2]);
  assert.ok(returned.length >= 2, `found ${returned.length} sentences in main`);
  for (const sentence of returned) assert.equal(isProviderFailureSentence(sentence), true, sentence);
  // An ordinary answer is never taken for one.
  for (const text of ['Use a token bucket.', 'The AI provider you pick matters less than the prompt.', '', null, undefined]) {
    assert.equal(isProviderFailureSentence(text), false, String(text));
  }
});
