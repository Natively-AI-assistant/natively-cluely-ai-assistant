// electron/llm/__tests__/capabilityView.test.mjs
//
// Unit tests for electron/llm/performance/capabilityView.ts — the read-only
// consolidation of capability facts: the verdict vocabulary, the facts read for
// one model (which must agree with the registries it is a view OF), the
// advertised-context check and the large-context reliability warning.
//
// The view adds no source of truth, so model facts are asserted against the
// compiled modelCapabilities / groqModels registries rather than hardcoded.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/capabilityView.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const llmDir = path.join(repoRoot, 'dist-electron', 'electron', 'llm');
const {
  verdictFrom,
  readCapabilityFacts,
  exceedsAdvertisedContext,
  largeContextReliabilityWarning,
} = require(path.join(llmDir, 'performance', 'capabilityView.js'));
const { getModelCapabilities } = require(path.join(llmDir, 'modelCapabilities.js'));
const { groqSupportsImages, isGroqModelId, GROQ_PRIMARY_MODEL, GROQ_PRODUCTION_FALLBACK_MODEL } = require(
  path.join(llmDir, 'groqModels.js'),
);

const facts = (contextWindowTokens) => ({
  streaming: true,
  vision: 'unknown',
  tools: 'unknown',
  structuredOutput: 'unknown',
  contextWindowTokens,
  source: 'model_registry',
});

describe('verdictFrom', () => {
  test('true is SUPPORTED, false is UNSUPPORTED, "unknown" is UNKNOWN', () => {
    assert.equal(verdictFrom(true), 'SUPPORTED');
    assert.equal(verdictFrom(false), 'UNSUPPORTED');
    assert.equal(verdictFrom('unknown'), 'UNKNOWN');
  });

  test('anything that is not a strict boolean is UNKNOWN, never UNSUPPORTED', () => {
    for (const v of [undefined, null, 0, 1, '', 'true', 'false']) {
      assert.equal(verdictFrom(v), 'UNKNOWN', JSON.stringify(v));
    }
  });

  test('never produces FAILED_TEMPORARILY from a static fact', () => {
    for (const v of [true, false, 'unknown']) assert.notEqual(verdictFrom(v), 'FAILED_TEMPORARILY');
  });
});

describe('readCapabilityFacts', () => {
  const NON_GROQ = ['gpt-4o', 'claude-sonnet-4-5', 'gemini-2.5-flash', 'some-unknown-model'];

  test('fixed facts: always streaming, tools/structuredOutput unknown, registry source', () => {
    for (const id of [...NON_GROQ, GROQ_PRIMARY_MODEL]) {
      const f = readCapabilityFacts(id, false);
      assert.equal(f.streaming, true, id);
      assert.equal(f.tools, 'unknown', id);
      assert.equal(f.structuredOutput, 'unknown', id);
      assert.equal(f.source, 'model_registry', id);
    }
  });

  test('returns exactly the CapabilityFacts fields', () => {
    assert.deepEqual(Object.keys(readCapabilityFacts('gpt-4o', false)).sort(), [
      'contextWindowTokens', 'source', 'streaming', 'structuredOutput', 'tools', 'vision',
    ]);
  });

  test('non-Groq models report the model registry for vision and context window', () => {
    for (const id of NON_GROQ) {
      assert.equal(isGroqModelId(id), false, id);
      const caps = getModelCapabilities(id, false);
      const f = readCapabilityFacts(id, false);
      assert.equal(f.vision, caps.supportsImages, id);
      assert.equal(f.contextWindowTokens, caps.maxContextTokens, id);
    }
  });

  test('a known vision model reads as vision-capable with a positive context window', () => {
    const f = readCapabilityFacts('gpt-4o', false);
    assert.equal(f.vision, true);
    assert.equal(verdictFrom(f.vision), 'SUPPORTED');
    assert.ok(f.contextWindowTokens > 0);
  });

  test('Groq ids take their vision answer from groqModels', () => {
    for (const id of [GROQ_PRIMARY_MODEL, GROQ_PRODUCTION_FALLBACK_MODEL, 'llama-3.3-70b-versatile']) {
      assert.equal(isGroqModelId(id), true, id);
      assert.equal(readCapabilityFacts(id, false).vision, groqSupportsImages(id), id);
    }
    assert.equal(readCapabilityFacts(GROQ_PRIMARY_MODEL, false).vision, true);
    assert.equal(readCapabilityFacts(GROQ_PRODUCTION_FALLBACK_MODEL, false).vision, false);
  });

  test('Groq ids still take their context window from the model registry', () => {
    const id = GROQ_PRIMARY_MODEL;
    assert.equal(readCapabilityFacts(id, false).contextWindowTokens, getModelCapabilities(id, false).maxContextTokens);
  });

  test('isOllama is passed through to the registry', () => {
    for (const id of ['gpt-4o', 'llava', 'llama3.2']) {
      const caps = getModelCapabilities(id, true);
      const f = readCapabilityFacts(id, true);
      if (!isGroqModelId(id)) assert.equal(f.vision, caps.supportsImages, id);
      assert.equal(f.contextWindowTokens, caps.maxContextTokens, id);
    }
  });

  test('empty, null and undefined model ids do not throw and still return facts', () => {
    for (const id of ['', null, undefined]) {
      const f = readCapabilityFacts(id, false);
      assert.equal(f.streaming, true);
      assert.equal(typeof f.contextWindowTokens, 'number');
      assert.ok(['model_registry', 'unknown'].includes(f.source));
    }
  });
});

describe('exceedsAdvertisedContext', () => {
  test('an unknown context window (0, negative, missing, NaN) returns null', () => {
    for (const w of [0, -1, undefined, null, NaN]) {
      assert.equal(exceedsAdvertisedContext(facts(w), 1_000_000), null, String(w));
    }
  });

  test('under the limit does not exceed', () => {
    assert.deepEqual(exceedsAdvertisedContext(facts(128_000), 100_000), { exceeds: false, limitTokens: 128_000 });
  });

  test('exactly at the limit does not exceed; one token over does', () => {
    assert.deepEqual(exceedsAdvertisedContext(facts(128_000), 128_000), { exceeds: false, limitTokens: 128_000 });
    assert.deepEqual(exceedsAdvertisedContext(facts(128_000), 128_001), { exceeds: true, limitTokens: 128_000 });
  });

  test('zero input tokens never exceeds a known window', () => {
    assert.deepEqual(exceedsAdvertisedContext(facts(8_000), 0), { exceeds: false, limitTokens: 8_000 });
  });

  test('works on facts read from the registry', () => {
    const f = readCapabilityFacts('gpt-4o', false);
    assert.deepEqual(exceedsAdvertisedContext(f, f.contextWindowTokens + 1), { exceeds: true, limitTokens: f.contextWindowTokens });
  });
});

describe('largeContextReliabilityWarning', () => {
  test('fewer than four attempts never warns, even if every one failed', () => {
    for (let attempts = 0; attempts <= 3; attempts++) {
      assert.equal(largeContextReliabilityWarning({ attempts, failures: attempts }), null, String(attempts));
    }
  });

  test('a failure rate under 30% does not warn', () => {
    assert.equal(largeContextReliabilityWarning({ attempts: 4, failures: 0 }), null);
    assert.equal(largeContextReliabilityWarning({ attempts: 4, failures: 1 }), null);
    assert.equal(largeContextReliabilityWarning({ attempts: 100, failures: 29 }), null);
  });

  test('a failure rate of 30% or more warns, from four attempts up', () => {
    assert.equal(typeof largeContextReliabilityWarning({ attempts: 10, failures: 3 }), 'string');
    assert.equal(typeof largeContextReliabilityWarning({ attempts: 4, failures: 2 }), 'string');
    assert.equal(typeof largeContextReliabilityWarning({ attempts: 4, failures: 4 }), 'string');
  });

  test('the warning is phrased as reliability, never as a capability claim', () => {
    const msg = largeContextReliabilityWarning({ attempts: 8, failures: 8 });
    assert.match(msg, /reliability is poor/i);
    assert.doesNotMatch(msg, /does not support|unsupported|not supported/i);
  });
});
