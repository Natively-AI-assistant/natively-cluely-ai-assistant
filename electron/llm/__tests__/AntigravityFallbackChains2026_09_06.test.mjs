// Antigravity's seat in the three fallback chains.
//
// It was reachable ONLY as the directly-selected provider. The vision chain, the
// streaming-text chain and generateMeetingSummary's fixed ATTEMPT ladder had no
// rung for it, which mattered most for images: _streamChatInner routes every
// image-bearing request into streamVisionWithFallback and RETURNS, so the
// `case 'antigravity': return true` in the vision-support switch was unreachable
// — a signed-in user's screenshots were answered by somebody else, or refused.
//
// What is pinned here is the part that can go wrong quietly: which MODEL a
// fallback rung asks for. streamWithAntigravity defaults `model` to
// `currentModelId` and only strips an `antigravity:` prefix, so when Antigravity
// is recruited as a fallback for another provider that default is that other
// provider's id ("gemini-3.8-flash") and would go onto Antigravity's wire
// verbatim. The catalogue is per-account, so no id is safe to hardcode either.
//
// resolveAntigravityFallbackModel is a pure static precisely so this is testable:
// its wrapper's only other job is reaching an AntigravityService singleton that
// esbuild inlines per bundle and no test can substitute.
//
// Platform: pure string/array logic. No platform branch — identical on darwin
// and win32.
//
// Run: npm run build:electron && node --test \
//        electron/llm/__tests__/AntigravityFallbackChains2026_09_06.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (f) => path.resolve(__dirname, '../../../dist-electron/electron', f);
const { LLMHelper } = require(dist('LLMHelper.js'));

const resolve = (signedIn, currentModelId, cached) =>
  LLMHelper.resolveAntigravityFallbackModel(signedIn, currentModelId, cached);

const CATALOGUE = [{ id: 'gemini-3.6-flash-low' }, { id: 'gemini-3-flash-agent' }];

describe('which model a fallback rung asks Antigravity for', () => {
  test('signed out seats no rung, even with a catalogue in hand', () => {
    assert.equal(resolve(false, 'antigravity:gemini-3.6-flash-low', CATALOGUE), null);
  });

  test("the user's own selection wins over whatever discovery listed first", () => {
    assert.equal(resolve(true, 'antigravity:gemini-3.6-flash-high', CATALOGUE), 'gemini-3.6-flash-high');
  });

  test('recruited for another provider, it asks for a REAL discovered id', () => {
    // The defect this guards: without it the rung inherits currentModelId and
    // sends "gemini-3.8-flash" — a Gemini id — to Antigravity.
    assert.equal(resolve(true, 'gemini-3.8-flash', CATALOGUE), 'gemini-3.6-flash-low');
    assert.notEqual(resolve(true, 'gemini-3.8-flash', CATALOGUE), 'gemini-3.8-flash');
  });

  test('no catalogue yet seats NO rung rather than guessing', () => {
    // A rung that cannot name a model is worse than one rung fewer: it still
    // burns its TTFT budget before the next provider gets a turn.
    assert.equal(resolve(true, 'gemini-3.8-flash', null), null);
    assert.equal(resolve(true, 'gemini-3.8-flash', []), null);
  });

  test('a bare prefix and a blank catalogue id are not model ids', () => {
    assert.equal(resolve(true, 'antigravity:', CATALOGUE), null);
    assert.equal(resolve(true, 'antigravity:   ', CATALOGUE), null);
    assert.equal(resolve(true, 'gemini-3.8-flash', [{ id: '   ' }]), null);
  });
});
