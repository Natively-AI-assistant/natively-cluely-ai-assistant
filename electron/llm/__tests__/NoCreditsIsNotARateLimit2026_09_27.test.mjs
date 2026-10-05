// electron/llm/__tests__/NoCreditsIsNotARateLimit2026_09_27.test.mjs
//
// "When I take a photo from the phone and press What to Answer it takes
// significantly more time than screenshot analysis on the desktop." The log:
//
//   [Vision] OpenAI attempt 1/3: rate (429 You have no credits remaining. ...)
//   [Vision] OpenAI attempt 2/3: rate (429 ...)
//   [Vision] OpenAI attempt 3/3: rate (429 ...)
//   [Perf] wta turn ended early { ..., totalMs: 13002, terminationReason: 'first_useful_timeout' }
//   [Vision] committed to Gemini Flash-Lite (attempt 1/3, ttft=2826ms)
//
// Not the phone: the first image question of a session. OpenAI leads the vision
// chain whenever a key is stored, and its no-credit reply no longer says
// "quota", so the engine's own classifier read the 429 as a rate limit and
// retried a key that cannot pay, with backoff, before moving on (and again
// after every transient cooldown). The shared rule (isPermanentKeyError) knew
// "no credits"; the engine now uses it: one attempt, then the next provider,
// and the key stays demoted.
//
// Executes the compiled engine, like VisionStreamFallback.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = process.env.VISION_FALLBACK_BUNDLE
  ? path.resolve(process.env.VISION_FALLBACK_BUNDLE)
  : path.resolve(__dirname, '../../../dist-electron/electron/llm/visionStreamFallback.js');
const { classifyVisionError, runStreamingVisionFallback, DEFAULT_VISION_FALLBACK_CONFIG } = await import(pathToFileURL(modPath).href);
const classifierPath = process.env.PROVIDER_ERROR_CLASSIFIER_BUNDLE
  ? path.resolve(process.env.PROVIDER_ERROR_CLASSIFIER_BUNDLE)
  : path.resolve(__dirname, '../../../dist-electron/electron/llm/providerErrorClassifier.js');
const { isPermanentKeyError } = await import(pathToFileURL(classifierPath).href);

// The OpenAI SDK's APIError for an account with no credits, as logged.
function noCredits() {
  return Object.assign(
    new Error('429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.'),
    { status: 429 },
  );
}
const collect = async (gen) => { const out = []; for await (const c of gen) out.push(c); return out; };
const hooks = (log) => ({ now: () => 1_000_000, random: () => 0, sleep: async (ms) => log.push(['sleep', ms]), log: () => {}, warn: (m) => log.push(['warn', m]) });

describe('a key with no credits is not a rate limit', () => {
  test('classified as a key problem (auth), not rate', () => {
    assert.equal(classifyVisionError(noCredits(), false), 'auth');
    assert.equal(classifyVisionError(Object.assign(new Error('402 Payment Required'), { status: 402 }), false), 'auth');
    assert.equal(classifyVisionError(Object.assign(new Error('insufficient credits on this account'), { status: 429 }), false), 'auth');
  });

  // The engine carries its own copy of the shared billing rule (it must stay
  // import-free); the two must not drift apart.
  test('the engine\'s billing rule agrees with the shared one', () => {
    const billing = [
      '429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
      'Payment Required',
      'insufficient_funds',
      'insufficient credit balance',
      'You are out of credits',
      'This account has been suspended',
      'FAILED_PRECONDITION: billing is not enabled for this project',
    ];
    for (const message of billing) {
      const err = Object.assign(new Error(message), { status: 429 });
      assert.equal(isPermanentKeyError(err), true, `shared rule: ${message}`);
      assert.equal(classifyVisionError(err, false), 'auth', `engine copy: ${message}`);
    }
    const err402 = Object.assign(new Error('nope'), { status: 402 });
    assert.equal(isPermanentKeyError(err402), true);
    assert.equal(classifyVisionError(err402, false), 'auth');
  });

  test('a plain 429 rate limit is still a rate limit (worth a retry)', () => {
    assert.equal(classifyVisionError(Object.assign(new Error('429 Rate limit reached for requests'), { status: 429 }), false), 'rate');
    assert.equal(classifyVisionError(Object.assign(new Error('Too Many Requests'), { status: 429 }), false), 'rate');
  });

  test('the chain tries the dead key once, no backoff, then answers from the next provider', async () => {
    let openaiCalls = 0;
    const openai = {
      id: 'openai', name: 'OpenAI', isLocal: false, priority: 0,
      open() { openaiCalls++; return (async function* () { throw noCredits(); })(); },
    };
    const gemini = {
      id: 'gemini_flash_lite', name: 'Gemini Flash-Lite', isLocal: false, priority: 1,
      open() { return (async function* () { yield 'It is a whiteboard with '; yield 'the rollout plan.'; })(); },
    };
    const health = new Map();
    const log = [];
    const out = await collect(runStreamingVisionFallback([openai, gemini], DEFAULT_VISION_FALLBACK_CONFIG, health, hooks(log)));
    assert.equal(out.join(''), 'It is a whiteboard with the rollout plan.');
    assert.equal(openaiCalls, 1, 'one attempt, not three');
    assert.equal(log.filter(([k]) => k === 'sleep').length, 0, 'no backoff before moving on');
    assert.ok(health.get('openai'), 'the key is demoted, so the next image question skips it');
  });
});
