// The Natively judge rung may use most of the controller's 2.5 s when it is
// the LAST model rung.
//
// Live 2026-09-27: 8 judge timeouts in ~110 consults across two runs. Each
// time the Natively decision call aborted at the 1.8 s rung timeout, nothing
// beneath could finish in the ~0.7 s left, and the engine fell back to the
// heuristic verdict. 80 live decision calls: 5% took over 1.8 s, most of them
// 1.87-1.97 s, and 1 in 80 over 2.4 s. A gateway rung still gets its share
// when one follows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LLMHelper } = require(path.resolve(__dirname, '../../../../dist-electron/electron/LLMHelper.js'));

function helper(over = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, { nativelyKey: 'nat_test_key', isLocalOnlyMode: false, rateLimiters: {}, ...over });
  h.callFastModel = async () => null;
  return h;
}

async function nativelyTimeout(h) {
  const seen = [];
  h.generateWithNatively = async (_m, _a, _b, opts) => { seen.push(opts); return '{"is_ask":true}'; };
  await h.generateJudgeVerdict('judge prompt');
  assert.equal(seen.length, 1, 'the Natively rung ran');
  assert.equal(seen[0].purpose, 'decision');
  return seen[0].timeoutMs;
}

test('Natively as the last model rung gets the last-rung budget, not 1.8 s', async () => {
  const h = helper();
  h.judgeGatewayModel = () => null;
  const t = await nativelyTimeout(h);
  assert.ok(t >= 2200 && t < 2500, `last-rung budget inside the controller's 2.5 s, got ${t}`);
});

test('with a gateway rung beneath, Natively keeps the 1.8 s rung so the gateway still has time', async () => {
  const h = helper();
  h.judgeGatewayModel = () => 'openrouter/google/gemini-3.1-flash-lite';
  assert.equal(await nativelyTimeout(h), 1800);
});
