// electron/rag/__tests__/NinerouterEmbeddingResolver2026_09_21.test.mjs
//
// 9Router as a selectable embedding provider.
//
// Three properties, each of which exists because getting it wrong changes the
// active embedding SPACE — and a space change re-indexes the whole corpus or,
// worse, compares vectors that are not comparable.
//
//   1. No measured width means NO candidate. Guessing stamps a wrong space key
//      over real vectors. Ollama, the custom endpoint, OpenRouter and Voyage all
//      already work this way.
//   2. It belongs in CLOUD_PROVIDER_NAMES, so its availability probe is retried.
//      That set's own comment: "a single 429 or DNS blip would otherwise demote
//      on the first failure, which changes the active embedding SPACE and
//      strands every persisted vector."
//   3. An explicit manual choice yields ONLY that provider — a failed manual
//      choice must not fall through to a different space behind the user's back.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const modPath = path.resolve(root, 'dist-electron/electron/rag/EmbeddingProviderResolver.js');
const { EmbeddingProviderResolver } = await import(pathToFileURL(modPath).href);

const names = (c) => EmbeddingProviderResolver.buildCandidates(c).map(p => p.name);

const NR = {
  ninerouterBaseUrl: 'http://localhost:20128/v1',
  ninerouterKey: 'sk-test',
  ninerouterEmbeddingModel: 'gemini/gemini-embedding-001',
  ninerouterEmbeddingDims: 3072,
};

describe('9Router joins the candidate chain', () => {
  test('a configured, MEASURED model produces a candidate', () => {
    assert.ok(names(NR).includes('ninerouter'));
  });

  test('no measured width means NO candidate — never a guessed one', () => {
    // The same rule Ollama, custom, OpenRouter and Voyage follow. 9Router makes
    // it sharper: /v1/models/info reports no width for 5 of the 6 models a
    // stock instance serves, so "unmeasured" is the normal starting state.
    assert.ok(!names({ ...NR, ninerouterEmbeddingDims: undefined }).includes('ninerouter'));
    assert.ok(!names({ ...NR, ninerouterEmbeddingDims: 0 }).includes('ninerouter'));
    assert.ok(!names({ ...NR, ninerouterEmbeddingDims: -1 }).includes('ninerouter'));
    assert.ok(!names({ ...NR, ninerouterEmbeddingDims: 1024.5 }).includes('ninerouter'));
  });

  test('no model selected means no candidate', () => {
    assert.ok(!names({ ...NR, ninerouterEmbeddingModel: '' }).includes('ninerouter'));
  });

  test('no base URL means no candidate — the base URL is the gate, as everywhere else', () => {
    // Not the key: a stock instance runs with REQUIRE_API_KEY=false, so gating
    // on a key would make a working keyless install unselectable.
    assert.ok(!names({ ...NR, ninerouterBaseUrl: '' }).includes('ninerouter'));
    // ...and a keyless instance IS selectable.
    assert.ok(names({ ...NR, ninerouterKey: '' }).includes('ninerouter'));
  });

  test('the candidate carries the host-keyed space', () => {
    const p = EmbeddingProviderResolver.buildCandidates(NR).find(x => x.name === 'ninerouter');
    assert.match(p.space, /ninerouter@localhost:20128/, 'two instances must not share a space');
    assert.equal(p.dimensions, 3072);
  });
});

describe('an explicit choice wins', () => {
  const ALL = {
    ...NR,
    nativelyApiKey: 'nk_live',
    openaiKey: 'sk-openai',
    geminiKey: 'gem-key',
  };

  test('choosing 9Router yields ONLY 9Router', () => {
    assert.deepEqual(names({ ...ALL, embeddingMode: 'manual', embeddingProvider: 'ninerouter' }), ['ninerouter']);
  });

  test('choosing something else never yields 9Router', () => {
    assert.deepEqual(names({ ...ALL, embeddingMode: 'manual', embeddingProvider: 'gemini' }), ['gemini']);
  });
});

describe('where the text actually goes', () => {
  const statusPath = path.resolve(root, 'dist-electron/electron/rag/embeddingStatus.js');

  test('9Router on localhost is CLOUD, not on-device', async () => {
    // resolveLocation's own docblock: "A wrong answer here is a false privacy
    // claim in the Active Model card, not a cosmetic label."
    //
    // The custom endpoint is host-gated, and correctly so — a loopback LM Studio
    // genuinely runs the model on the machine. 9Router is the opposite case that
    // LOOKS identical: the binary is local, the inference never is. It forwards
    // every request to Gemini, OpenAI, Anthropic and 40+ others. Falling through
    // to the default 'on-device' would tell a user their text stays on their
    // machine while it is being sent to Google.
    //
    // So it is unconditionally cloud, NOT host-gated. Same reasoning that keeps
    // it out of isLocalVisionProvider.
    const { describeEmbeddingProvider } = await import(pathToFileURL(statusPath).href);
    const status = describeEmbeddingProvider({
      name: 'ninerouter',
      space: 'ninerouter@localhost:20128:gemini/gemini-embedding-001:3072',
      dimensions: 3072,
      model: 'gemini/gemini-embedding-001',
    });
    assert.equal(status.location, 'cloud',
      'a localhost ADDRESS is not on-device INFERENCE — 9Router relays to 40+ cloud vendors');
  });
});

describe('probe hysteresis', () => {
  const src = fs.readFileSync(path.join(root, 'electron/rag/EmbeddingProviderResolver.ts'), 'utf8');

  test('9Router is a CLOUD provider, so its probe is retried', () => {
    // Its own comment: "Every NETWORK provider belongs here: a single 429 or DNS
    // blip would otherwise demote on the first failure, which changes the active
    // embedding SPACE and strands every persisted vector."
    const set = src.slice(src.indexOf('CLOUD_PROVIDER_NAMES'), src.indexOf('CLOUD_PROVIDER_NAMES') + 300);
    assert.match(set, /'ninerouter'/,
      'without this, one blip on a localhost round-trip demotes and re-indexes the corpus');
  });

  test('its width is measured in the same parallel pass as the others', () => {
    assert.match(src, /withMeasuredNinerouterDims/, 'the measurement helper must exist');
    assert.match(src, /wanted\('ninerouter'\) \? EmbeddingProviderResolver\.withMeasuredNinerouterDims\(config\) : config/,
      'and be gated by the same pin check, so a pinned user does not pay its timeout');
    assert.match(src, /ninerouterEmbeddingDims: nrCfg\.ninerouterEmbeddingDims/,
      'and be merged back');
  });
});
