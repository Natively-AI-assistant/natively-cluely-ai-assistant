/**
 * What the user is told when a 9Router model fails.
 *
 * This matters more for 9Router than for any other provider here, because the
 * failures are NOT the provider's. 9Router relays whatever its upstream said,
 * and on a real instance the reasons are wildly different and each needs a
 * different action from the user. Measured across a 47-model catalogue:
 *
 *   401  5 models   the Claude account's OAuth expired -> reconnect it
 *   401 14 models   the Codex/ChatGPT sign-in expired  -> reconnect it
 *   401  8 models   an API key was revoked             -> paste a new one
 *   410  8 models   the vendor RETIRED the model       -> pick another
 *   429  n models   quota/rate limit                   -> wait, or pick another
 *   400  n models   context window exceeded            -> shorten the prompt
 *   200  2 models   answered with NO TEXT AT ALL       -> pick another
 *
 * A single "the model did not produce an answer" covers all seven and helps
 * with none. The last row is the worst: nothing errors, the stream simply ends
 * empty, so without an explicit check the user gets a blank answer and no clue.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { describeNinerouterFailure, NINEROUTER_EMPTY_ANSWER } =
  require(path.join(__dirname, '../../../dist-electron/electron/llm/ninerouterErrors.js'));

const err = (status, message) => Object.assign(new Error(message), { status });
const say = (e, model = 'cc/claude-opus-5') => describeNinerouterFailure(e, model);

describe('every message names the MODEL and nothing else', () => {
  // The contract: the user picked a row labelled `claude-opus-5`, so that is
  // what a failure calls it. Natively's `ninerouter/` routing prefix and
  // 9Router's upstream alias (`cc/`, `cx/`) are plumbing they never chose.
  const CASES = [
    [401, '401 [claude/claude-opus-5] [401]: {"type":"error","error":{"message":"OAuth token expired"}}'],
    [410, '410 [nvidia/z-ai/glm-5.2] [410]: {"type":"aborted"}'],
    [429, '429 [gemini/gemini-3.6-flash] [429]: {"error":{"message":"You exceeded your current quota"}}'],
    [404, 'No active credentials for provider: alicode'],
    [400, '400 [minimax/MiniMax-M2.7] [400]: {"error":{"message":"invalid params, context window exceeded"}}'],
    [500, '500 [x/y] [500]: upstream boom'],
  ];
  for (const [status, raw] of CASES) {
    test(`${status}: bare name, familiar lead, no plumbing`, () => {
      const m = say(err(status, raw), 'cc/claude-opus-5');
      assert.match(m, /^claude-opus-5 did not produce an answer\./,
        'it must open with the bare model name and the familiar line');
      assert.doesNotMatch(m, /\bcc\//, 'the routing alias must not appear');
      assert.doesNotMatch(m, /ninerouter\//, 'the internal prefix must not appear');
      assert.ok(m.length < 320, 'it has to fit a chat bubble');
      assert.doesNotMatch(m, /\{|\}|"type"/, 'raw JSON must not reach the user');
    });
  }

  test('a fully prefixed id is reduced to the last segment', () => {
    const m = say(err(429, 'quota'), 'ninerouter/gemini/gemini-3.5-flash-lite');
    assert.match(m, /^gemini-3\.5-flash-lite did not produce an answer\./);
  });
});

describe('each cause still gets its own remedy', () => {
  test('401 points at the account, not at the user\'s own key', () => {
    const m = say(err(401, '401 [claude/claude-opus-5] [401]: expired'), 'cc/claude-opus-5');
    assert.match(m, /account is no longer authorised/i);
    assert.match(m, /reconnect/i);
    // The ONE place a destination survives: "reconnect it" with nowhere to go
    // is not a remedy.
    assert.match(m, /9Router dashboard/);
    assert.doesNotMatch(m, /your (Natively )?API key/i);
  });

  test('410 says retired, and does NOT invite a retry', () => {
    const m = say(err(410, '410 [nvidia/z-ai/glm-5.2] [410]: aborted'), 'nvidia/z-ai/glm-5.2');
    assert.match(m, /^glm-5\.2 did not produce an answer\./);
    assert.match(m, /retired/i);
    assert.doesNotMatch(m, /try again|retry/i, 'retrying a retired model never works');
  });

  test('429 says wait — the opposite advice to 410', () => {
    const m = say(err(429, '429 [gemini/x] [429]: quota'), 'gemini/gemini-3.6-flash');
    assert.match(m, /quota|rate.?limit/i);
    assert.match(m, /try again|shortly|later/i);
  });

  test('a context overflow blames the request, not the account', () => {
    const m = say(err(400, '400 [minimax/MiniMax-M2.7] [400]: invalid params, context window exceeded'), 'minimax/MiniMax-M2.7');
    assert.match(m, /too large|context window/i);
    assert.match(m, /shorter|smaller|bigger window/i);
    assert.doesNotMatch(m, /reconnect/i, 'nothing is wrong with the account here');
  });

  test('404 offers to add an account', () => {
    const m = say(err(404, 'No active credentials for provider: alicode'), 'alicode/glm-5');
    assert.match(m, /^glm-5 did not produce an answer\./);
    assert.match(m, /no working account/i);
    assert.match(m, /add one/i);
  });
});

describe('the silent case: a 200 with no text', () => {
  test('an empty stream is reported, not shown as a blank answer', () => {
    // MiniMax-M3 and gemma-4-31b-it both do this on the reference instance:
    // HTTP 200, a well-formed SSE stream, and zero content deltas. Nothing
    // throws, so without this the user sees an empty bubble.
    assert.equal(typeof NINEROUTER_EMPTY_ANSWER, 'string');
    const m = describeNinerouterFailure(new Error(NINEROUTER_EMPTY_ANSWER), 'minimax/MiniMax-M3');
    assert.match(m, /^MiniMax-M3 did not produce an answer\./);
    assert.match(m, /no text/i);
    assert.match(m, /another model/i);
  });
});

describe('it never makes things worse', () => {
  test('an unrecognised error still yields a usable line', () => {
    const m = say(new Error('something entirely unexpected'), 'ninerouter/x/y-model');
    assert.match(m, /^y-model did not produce an answer\./);
  });

  test('no key or token is ever echoed', () => {
    const m = say(err(401, 'Bearer sk-048783e49fcaece4-babrx7-507610ec rejected'), 'x/y');
    assert.doesNotMatch(m, /sk-[0-9a-f]/, 'a key in an upstream message must not reach the UI');
  });

  test('a degenerate id does not produce a blank subject', () => {
    for (const id of ['', '/', 'solo']) {
      const m = describeNinerouterFailure(err(429, 'quota'), id);
      assert.ok(m.trim().length > 20 && !m.startsWith(' '), `id ${JSON.stringify(id)} -> ${m}`);
    }
  });
});
