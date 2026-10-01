/**
 * Telling "this model cannot see images" apart from every other failure
 * (2026-10-01). Reproduced live: OpenRouter answers an image sent to a
 * text-only model with HTTP 404 "No endpoints found that support image input",
 * and the stream classifier read the 404 as a RETIRED model — demoted for 24
 * hours, discovery triggered. For the one-time image test the stakes are higher:
 * a transient failure stored as "no" would block a capable model for a month.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { isImageRefusalMessage, judgeProbeReply, judgeProbeError } = require(dist('llm/visionProbeOutcome.js'));
const { classifyStreamError } = require(dist('llm/streamFallbackEngine.js'));

const REFUSALS = [
  '404 No endpoints found that support image input',                        // OpenRouter, observed live 2026-10-01
  'The selected deepseek-v4-flash model does not support image input.',     // Natively's own Direct Assist wording
  "The current model doesn't support image input.",
  'Invalid content type. image_url is only supported by certain models.',   // OpenAI
  'This model does not support vision.',
  'Image input is not supported for this model',
  'images are not supported by this model',
];
const NOT_REFUSALS = [
  '402 Budget pool quota has been exhausted',
  '429 rate limit exceeded',
  '503 当前分组 default 下对于模型 x 无可用渠道',
  '401 unauthorized_client_error',
  '400 content-blocked',
  'The model `x` does not exist or you do not have access to it.',
  'This model does not support streaming.',
  'fetch failed',
  '',
];

describe('isImageRefusalMessage', () => {
  for (const m of REFUSALS) test(`refusal: ${m}`, () => assert.equal(isImageRefusalMessage(m), true));
  for (const m of NOT_REFUSALS) test(`not a refusal: ${m || '(empty)'}`, () => assert.equal(isImageRefusalMessage(m), false));
});

describe('the stream classifier', () => {
  test("OpenRouter's image 404 is no_vision, not a retired model", () => {
    const err = Object.assign(new Error('404 No endpoints found that support image input'), { status: 404 });
    assert.equal(classifyStreamError(err, false), 'no_vision');
  });
  test('a real retired-model 404 is still model_gone', () => {
    const err = Object.assign(new Error('The model `llama-4-scout` has been decommissioned'), { status: 404 });
    assert.equal(classifyStreamError(err, false), 'model_gone');
    assert.equal(classifyStreamError(Object.assign(new Error('Not Found'), { status: 404 }), false), 'model_gone');
  });
});

describe('judgeProbeReply', () => {
  test('the number, however it is written, is a yes', () => {
    for (const reply of ['7392', 'The number is 7392.', 'It shows 7 3 9 2', '7,392', '**7392**', 'The image displays "73 92".']) {
      assert.equal(judgeProbeReply(reply, '7392'), 'yes', reply);
    }
  });
  test('a real reply without the number is a no', () => {
    for (const reply of ["I can't see any image in this chat.", "Images aren't supported here.", 'The number is 1234.', 'I do not have the ability to view images.']) {
      assert.equal(judgeProbeReply(reply, '7392'), 'no', reply);
    }
  });
  test('an empty or near-empty reply is unknown, never a no', () => {
    for (const reply of ['', '   ', '\n', '.', 'ok']) assert.equal(judgeProbeReply(reply, '7392'), 'unknown', JSON.stringify(reply));
  });
  test('a blind model that answers with a different number is a miss, however short (phase 3b)', () => {
    // Measured 2026-10-01: direct deepseek-v4-pro answered "42" to an image
    // showing 7392. Too short to count as "a real reply" by length alone, so a
    // blind model stayed unknown forever and was never marked text-only.
    for (const reply of ['42', '1234', '12', 'It is 4816.', '7391']) assert.equal(judgeProbeReply(reply, '7392'), 'no', reply);
    for (const reply of ['', '4', 'ok', '.']) assert.equal(judgeProbeReply(reply, '7392'), 'unknown', JSON.stringify(reply));
  });
  test('a bare HTTP status code as the whole reply is the provider talking, not a wrong answer (review fix)', () => {
    // Some proxies answer 200 with just the upstream's status as text.
    for (const reply of ['429', '503', ' 404 ', '500\n']) assert.equal(judgeProbeReply(reply, '7392'), 'unknown', JSON.stringify(reply));
    assert.equal(judgeProbeReply('429', '4290'), 'unknown');
    assert.equal(judgeProbeReply('4290', '4290'), 'yes', 'the number itself always wins');
    assert.equal(judgeProbeReply('123', '7392'), 'no', 'any other three-digit number is still a wrong answer');
  });
  test('the number inside a longer number does not count', () => {
    assert.equal(judgeProbeReply('173920', '7392'), 'no');
  });
  test('another number after the answer does not turn a correct reply into a miss (review fix)', () => {
    // Joining "7392, 4" into "73924" hid the answer; a model that formats its
    // reply this way does so on both attempts, so it was saved as text-only.
    for (const reply of ['7392, 4 digits in bold.', '7392\n\n1. The digits are black.', '7392 - 4 bold digits', 'The number is 7392. 2 colours: black and white.']) {
      assert.equal(judgeProbeReply(reply, '7392'), 'yes', reply);
    }
  });
  test("a provider's notice arriving as a normal reply is unknown, never a no (review fix)", () => {
    // Some gateways answer HTTP 200 with the failure in the body.
    for (const reply of [
      'Budget pool quota has been exhausted, please try again later.',
      'Rate limit exceeded. Too many requests.',
      'Your request was blocked by the content filter.',
      'Invalid API key provided.',
      'Insufficient credits to complete this request.',
      '当前分组 default 下对于模型 x 无可用渠道',
      'The service is temporarily unavailable.',
    ]) assert.equal(judgeProbeReply(reply, '7392'), 'unknown', reply);
    assert.equal(judgeProbeReply('Rate limit note aside, the number is 7392', '7392'), 'yes', 'the number still wins');
  });
});

describe('judgeProbeError', () => {
  test('only a recognised image refusal is a no', () => {
    for (const m of REFUSALS) assert.equal(judgeProbeError(new Error(m)), 'no', m);
    for (const m of NOT_REFUSALS) assert.equal(judgeProbeError(new Error(m)), 'unknown', m);
    assert.equal(judgeProbeError(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'unknown');
    assert.equal(judgeProbeError(undefined), 'unknown');
  });
});
