/**
 * OpenCode failure messages.
 *
 * Every cause gets a sentence the user can act on, because they need different
 * actions: a 401 means create a key, a 403 on a `-free` id means the model is
 * not callable from here at all, 402/429 mean check the balance, 404 means
 * refresh the list. "The model did not produce an answer" is true for all of
 * them and useful for none.
 *
 * Run: node --test electron/llm/__tests__/OpencodeFailureMessage2026_11_19.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const { describeOpencodeFailure, opencodeError, OPENCODE_EMPTY_ANSWER } =
  require(dist('llm/opencode/errors.js'));

describe('describeOpencodeFailure', () => {
  test('401 names the Console', () => {
    const msg = describeOpencodeFailure({ status: 401, message: 'unauthorized' }, 'opencode/claude-sonnet-5');
    assert.match(msg, /API key/);
    assert.match(msg, /Console/);
  });

  test('403 on a -free id explains the free-tier rule', () => {
    const msg = describeOpencodeFailure({ status: 403 }, 'opencode/deepseek-v4.1-flash-free');
    assert.match(msg, /Free OpenCode models only work inside the OpenCode app/);
    assert.match(msg, /paid model|Go subscription/i);
  });

  test('403 on a paid id is an access problem, not a dead key', () => {
    const msg = describeOpencodeFailure({ status: 403 }, 'opencode/claude-sonnet-5');
    assert.doesNotMatch(msg, /only work inside the OpenCode app/);
    assert.match(msg, /access|Models/i);
  });

  test('402/429 name billing or limits', () => {
    assert.match(describeOpencodeFailure({ status: 402 }, 'opencode/gpt-6.1-sol'), /billing|balance|Go usage/i);
    assert.match(describeOpencodeFailure({ status: 429 }, 'opencode/gpt-6.1-sol'), /billing|rate limits/i);
  });

  test('404 tells the user to refresh the model list', () => {
    const msg = describeOpencodeFailure({ status: 404 }, 'opencode/gemini-3.8-flash');
    assert.match(msg, /Refresh the model list/);
  });

  test('an empty stream names the model and the cause', () => {
    const msg = describeOpencodeFailure(new Error(OPENCODE_EMPTY_ANSWER), 'opencode/kimi-k3');
    assert.match(msg, /kimi-k3/);
    assert.match(msg, /no text|only stream their reasoning/i);
  });

  test('a blocked Gemini prompt keeps its own sentence', () => {
    // The adapter wraps its OWN refusal too; without this branch the message
    // degraded to "Could not reach OpenCode", which sends the user to their
    // network for a content-policy refusal.
    const msg = describeOpencodeFailure(new Error('OpenCode blocked the prompt (SAFETY)'), 'opencode/gemini-3.8-flash');
    assert.match(msg, /blocked the prompt \(SAFETY\)/);
    assert.match(msg, /gemini-3\.8-flash/);
  });

  test('a transport failure has its own sentence', () => {
    assert.match(describeOpencodeFailure(new Error('fetch failed'), 'opencode/glm-5.3'), /Could not reach OpenCode/);
  });

  test('keys are redacted from relayed text', () => {
    const msg = describeOpencodeFailure(
      { status: 401, message: 'bad token oc_sk_live_abcdef123 and sk-proj-xyz Bearer abc.def' },
      'opencode/claude-sonnet-5',
    );
    assert.doesNotMatch(msg, /oc_sk_live_abcdef123/);
    assert.doesNotMatch(msg, /sk-proj-xyz/);
    assert.doesNotMatch(msg, /Bearer abc\.def/);
  });
});

describe('opencodeError', () => {
  test('carries status, provider and a readable message', () => {
    const e = opencodeError({ status: 404, message: 'nope' }, 'opencode/x');
    assert.equal(e.status, 404);
    assert.equal(e.provider, 'opencode');
    assert.match(e.message, /Refresh the model list/);
  });
});
