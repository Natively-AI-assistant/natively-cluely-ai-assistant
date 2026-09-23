// The judge's rung 0: the user's chosen fast model, ahead of the measured
// per-provider ladder.
//
// The ladder below it is the fallback and must stay reachable, so the two cases
// that matter are the boring ones: a null pick still gets a verdict from the
// ladder, and an ABORT must propagate instead of quietly spending a ladder call
// on a judgement the controller has already thrown away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LLMHelper } = require(path.resolve(__dirname, '../../../../dist-electron/electron/LLMHelper.js'));

function judgeHelper(over = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    _client: null, _openaiClient: null, _claudeClient: null, _groqClient: null, _deepseekClient: null,
    isLocalOnlyMode: false,
    getDisabledProviderFamilies: () => [],
    assertOutboundScopes: () => {},
    rateLimiters: {},
    ...over,
  });
  return h;
}

test('the fast model answers the judge before any ladder rung runs', async () => {
  let ladderRan = false;
  const h = judgeHelper();
  h.callFastModel = async () => '{"is_ask":true}';
  h.generateContentStructured = async () => { ladderRan = true; return '{}'; };
  assert.equal(await h.generateJudgeVerdict('prompt'), '{"is_ask":true}');
  assert.equal(ladderRan, false, 'rung 0 answered, so no ladder rung should run');
});

test('when the fast rung returns null the existing ladder still answers', async () => {
  let consulted = false;
  const h = judgeHelper();
  h.callFastModel = async () => { consulted = true; return null; };
  h.generateContentStructured = async () => '{"is_ask":false}';
  assert.equal(await h.generateJudgeVerdict('prompt'), '{"is_ask":false}');
  // Without this the test passes with no rung 0 at all — the ladder answers
  // either way. The point is that rung 0 ran AND yielded.
  assert.equal(consulted, true, 'the fast rung must be consulted before the ladder');
});

test('an abort in the fast rung propagates — it must NOT fall through to the ladder', async () => {
  let ladderRan = false;
  const controller = new AbortController();
  const h = judgeHelper();
  // A distinctive message: the pre-existing ladder ALSO throws an abort error
  // ("judge aborted: superseded by newer speech") when the signal is already
  // aborted, so matching /superseded/ would pass without any rung 0.
  h.callFastModel = async () => { throw Object.assign(new Error('fast-rung-abort'), { name: 'AbortError' }); };
  h.generateContentStructured = async () => { ladderRan = true; return '{}'; };
  controller.abort();
  await assert.rejects(h.generateJudgeVerdict('prompt', { signal: controller.signal }), /fast-rung-abort/);
  assert.equal(ladderRan, false, 'a cancelled judge must not spend a ladder call');
});

test('with no fast model set the judge behaves exactly as before', async () => {
  let consulted = false;
  const h = judgeHelper();
  h.callFastModel = async () => { consulted = true; return null; };   // unset resolves to null
  h.generateContentStructured = async () => '{"ladder":true}';
  assert.equal(await h.generateJudgeVerdict('prompt'), '{"ladder":true}');
  assert.equal(consulted, true, 'rung 0 is always consulted; unset is what makes it a no-op');
});
