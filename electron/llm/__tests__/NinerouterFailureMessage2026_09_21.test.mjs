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

describe('every message names the model and says what to DO', () => {
  const CASES = [
    [401, '[claude/claude-opus-5] [401]: {"type":"error","error":{"message":"OAuth token expired"}}'],
    [410, '[nvidia/z-ai/glm-5.2] [410]: {"type":"aborted"}'],
    [429, '[gemini/gemini-3.6-flash] [429]: {"error":{"message":"You exceeded your current quota"}}'],
    [404, 'No active credentials for provider: alicode'],
    [400, '[minimax/MiniMax-M2.7] [400]: {"error":{"message":"invalid params, context window exceeded"}}'],
    [500, '[x/y] [500]: upstream boom'],
  ];
  for (const [status, raw] of CASES) {
    test(`${status} names the model and gives an action`, () => {
      const m = say(err(status, raw));
      assert.match(m, /cc\/claude-opus-5/, 'the model must be named — the user picked it');
      assert.match(m, /did not produce an answer/i, 'the familiar line must still be there');
      assert.ok(m.length < 400, 'it has to fit a chat bubble');
      assert.doesNotMatch(m, /\{|\}|"type"/, 'raw JSON must not reach the user');
    });
  }
});

describe('each cause gets its own remedy', () => {
  test('401 sends the user to reconnect the account, not to check their key', () => {
    // The commonest failure by far: 27 of 47 models on the reference instance.
    // It is 9ROUTER's upstream account that expired, not the user's Natively
    // key and not their 9Router key — so "check your API key" would be wrong.
    const m = say(err(401, '[claude/claude-opus-5] [401]: {"error":{"message":"OAuth token expired"}}'));
    assert.match(m, /9Router/, 'it must point at 9Router, not at Natively');
    assert.match(m, /reconnect|sign in|dashboard/i);
    assert.doesNotMatch(m, /your (Natively )?API key/i, 'must not blame the user\'s own key');
  });

  test('410 says the model is gone, so retrying is pointless', () => {
    const m = say(err(410, '[nvidia/z-ai/glm-5.2] [410]: {"type":"aborted"}'), 'nvidia/z-ai/glm-5.2');
    assert.match(m, /retired|no longer/i);
    assert.match(m, /another model|different model/i);
    assert.doesNotMatch(m, /try again|retry/i, 'retrying a retired model never works');
  });

  test('429 says wait — the opposite advice to 410', () => {
    const m = say(err(429, '[gemini/x] [429]: quota'), 'gemini/x');
    assert.match(m, /quota|rate limit/i);
    assert.match(m, /try again|wait|later/i);
  });

  test('a context overflow blames the request, not the account', () => {
    const m = say(err(400, '[minimax/MiniMax-M2.7] [400]: invalid params, context window exceeded'), 'minimax/MiniMax-M2.7');
    assert.match(m, /too (large|long)|context/i);
    assert.match(m, /shorter|shorten|smaller/i);
    assert.doesNotMatch(m, /reconnect|dashboard/i, 'nothing is wrong with the account here');
  });

  test('it names the upstream as the DASHBOARD lists it, not the alias', () => {
    // The OpenAI SDK puts its own status in front of 9Router's relayed text, so
    // the real message is `401 [claude/claude-opus-5] [401]: …`. An anchored
    // regex missed that and fell back to the alias from the model id — telling
    // the user to reconnect their "cc" account, which appears nowhere in the
    // 9Router dashboard. It is listed as "claude".
    const m = say(err(401, '401 [claude/claude-opus-5] [401]: {"error":{"message":"expired"}}'), 'cc/claude-opus-5');
    assert.match(m, /claude account/i, 'must use the upstream name the dashboard shows');
    assert.doesNotMatch(m, /\bcc account\b/i, 'the routing alias is not what the user reconnects');
    assert.match(m, /cc\/claude-opus-5/, 'but the MODEL is still the one the user picked');
  });

  test('"No active credentials for provider: X" names X, not the model', () => {
    const m = say(err(404, 'No active credentials for provider: alicode'), 'alicode/glm-5');
    assert.match(m, /alicode/);
    assert.match(m, /dashboard|add|connect/i);
  });
});

describe('the silent case: a 200 with no text', () => {
  test('an empty stream is reported, not shown as a blank answer', () => {
    // MiniMax-M3 and gemma-4-31b-it both do this on the reference instance:
    // HTTP 200, a well-formed SSE stream, and zero content deltas. Nothing
    // throws, so without this the user sees an empty bubble.
    // The sentinel is an internal marker, not prose — only the MESSAGE has to
    // read like the rest of the app.
    assert.equal(typeof NINEROUTER_EMPTY_ANSWER, 'string');
    const m = describeNinerouterFailure(new Error(NINEROUTER_EMPTY_ANSWER), 'minimax/MiniMax-M3');
    assert.match(m, /did not produce an answer/i);
    assert.match(m, /minimax\/MiniMax-M3/);
    assert.match(m, /no text|nothing|empty/i);
    assert.match(m, /another model|different model/i);
  });
});

describe('it never makes things worse', () => {
  test('an unrecognised error still yields a usable line', () => {
    const m = say(new Error('something entirely unexpected'), 'x/y');
    assert.match(m, /did not produce an answer/i);
    assert.match(m, /x\/y/);
  });

  test('no key or token is ever echoed', () => {
    const m = say(err(401, 'Bearer sk-048783e49fcaece4-babrx7-507610ec rejected'), 'x/y');
    assert.doesNotMatch(m, /sk-[0-9a-f]/, 'a key in an upstream message must not be relayed to the UI');
  });
});
