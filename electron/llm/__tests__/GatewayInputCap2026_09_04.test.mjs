// A gateway-routed model gets the input ceiling its proxy reports (2026-09-04).
//
// THE GAP
// `litellm/…` ids resolve to the full 'cloud' tier on purpose — a size in a
// model NAME says nothing about where the model runs, and GatewayVisionWiring
// pins that choice. But nothing then capped the prompt: fitContextForCurrentModel
// returns early for any model at or above 100k context, so a proxied model was
// never trimmed at all. `resolveLitellmMaxTokens` recovers only
// max_output_tokens from /model/info, and no caller read max_input_tokens — so
// `litellm/meta/llama-3.1-8b-instant` (small models behind a proxy being the
// common LiteLLM deployment) received a cloud-sized prompt and either 400d or
// silently truncated upstream.
//
// THE FIX, AND WHY IT IS NOT THE OBVIOUS ONE
// The obvious fix — let the small-model name regex claim gateway ids — was
// tried and REVERTED: it reverses a deliberate, tested decision by the owner of
// modelCapabilities, and it is still a guess from a name. /model/info already
// answers the question authoritatively and the fetch was simply discarding the
// field. Capping from the proxy's own number satisfies both positions and needs
// no change to the tier.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/GatewayInputCap2026_09_04.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { LLMHelper } = require(path.join(repoRoot, 'dist-electron/electron/LLMHelper.js'));

/** ~40k tokens of context — far past an 8k upstream, far under the cloud tier. */
const LONG_CONTEXT = Array.from({ length: 4000 },
  (_, i) => `line ${i}: some transcript text that takes up room in the prompt`).join('\n');

function helper({ modelId, inputCaps }) {
  const h = Object.create(LLMHelper.prototype);
  h.useOllama = false;
  h.currentModelId = modelId;
  h.litellmModelInputCaps = new Map(Object.entries(inputCaps ?? {}));
  return h;
}

describe('the proxy-reported input ceiling is honoured', () => {
  test('WITHOUT a reported ceiling the prompt is untouched — the old behaviour', () => {
    const h = helper({ modelId: 'litellm/anthropic/claude-sonnet-5' });
    assert.equal(h.fitContextForCurrentModel(LONG_CONTEXT).length, LONG_CONTEXT.length,
      'a proxy that does not expose /model/info must keep working exactly as before');
  });

  test('WITH a reported 8k ceiling the prompt is trimmed to fit', () => {
    const h = helper({
      modelId: 'litellm/meta/llama-3.1-8b-instant',
      inputCaps: { 'meta/llama-3.1-8b-instant': 8192 },
    });
    const out = h.fitContextForCurrentModel(LONG_CONTEXT);
    assert.ok(out.length < LONG_CONTEXT.length,
      'an 8k upstream received a cloud-sized prompt: nothing capped the input for a gateway');
    // Trimming drops OLDEST lines first, so the tail — the most recent speech —
    // is what survives. Losing the newest lines would be worse than not trimming.
    assert.ok(LONG_CONTEXT.endsWith(out.split('\n').slice(-1)[0]),
      'the most recent lines must be the ones kept');
  });

  test('a large reported ceiling still skips trimming', () => {
    const h = helper({
      modelId: 'litellm/anthropic/claude-sonnet-5',
      inputCaps: { 'anthropic/claude-sonnet-5': 200000 },
    });
    assert.equal(h.fitContextForCurrentModel(LONG_CONTEXT).length, LONG_CONTEXT.length,
      'the cap must only ever narrow, never invent a limit a big model does not have');
  });

  test('a non-gateway id ignores the map entirely', () => {
    // Guards against the lookup keying off a bare model name and catching a
    // directly-configured model that happens to share it. The fixture has to be
    // a model the EXISTING rules leave at the cloud tier — a bare
    // `meta/llama-3.1-8b-instant` is legitimately classified small by the size
    // regex, so it trims for reasons that have nothing to do with this cap.
    const h = helper({ modelId: 'gpt-4o', inputCaps: { 'gpt-4o': 8192 } });
    assert.equal(h.fitContextForCurrentModel(LONG_CONTEXT).length, LONG_CONTEXT.length,
      'only litellm/-prefixed ids consult the proxy cache');
  });
});
