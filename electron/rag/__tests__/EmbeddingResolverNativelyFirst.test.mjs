// electron/rag/__tests__/EmbeddingResolverNativelyFirst.test.mjs
//
// Provider PRIORITY. Before this, EmbeddingProviderResolver consulted only
// openaiKey/geminiKey/ollamaUrl — nativelyApiKey was never read at all, so a
// customer on a Natively key fell through to Ollama or the bundled MiniLM model
// and got the weakest retrieval in the product while paying for the managed one.
//
// Order is asserted against buildCandidates() rather than resolve(), so the test
// makes no network calls and cannot pass for the wrong reason (a bogus cloud key
// failing its probe would let ANY ordering end up selecting Natively).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/EmbeddingProviderResolver.js');
const { EmbeddingProviderResolver } = await import(pathToFileURL(modPath).href);

const names = (config) => EmbeddingProviderResolver.buildCandidates(config).map(p => p.name);

describe('candidate ordering', () => {
  test('Natively is probed FIRST when a Natively key is present', () => {
    // The user's instruction: "if natively api exists then route through it
    // first, if it fails follow the chain".
    const order = names({
      nativelyApiKey: 'nk_live',
      openaiKey: 'sk-openai',
      geminiKey: 'gem-key',
      ollamaUrl: 'http://localhost:11434',
    });
    assert.equal(order[0], 'natively', `expected natively first, got ${order.join(' → ')}`);
  });

  test('the rest of the chain is preserved behind it', () => {
    const order = names({
      nativelyApiKey: 'nk_live',
      openaiKey: 'sk-openai',
      geminiKey: 'gem-key',
      ollamaUrl: 'http://localhost:11434',
    });
    assert.deepEqual(order, ['natively', 'openai', 'gemini', 'ollama']);
  });

  test('no Natively key means the previous ordering is untouched', () => {
    const order = names({ openaiKey: 'sk-openai', geminiKey: 'gem-key' });
    assert.deepEqual(order, ['openai', 'gemini', 'ollama']);
  });

  test('a Natively key alone still yields a usable candidate', () => {
    assert.deepEqual(names({ nativelyApiKey: 'nk_live' }), ['natively', 'ollama']);
  });

  test('a trial sentinel WITHOUT a trial token is not offered as a candidate', () => {
    // The sentinel is not a credential; without the token the provider cannot
    // authenticate, and offering it would just burn a probe before every index.
    assert.deepEqual(names({ nativelyApiKey: '__trial__' }), ['ollama']);
  });

  test('a trial sentinel WITH a trial token is offered first', () => {
    const order = names({ nativelyApiKey: '__trial__', nativelyTrialToken: 'natively_trial_abc' });
    assert.equal(order[0], 'natively');
  });

  test('an empty Natively key is ignored rather than probed', () => {
    assert.deepEqual(names({ nativelyApiKey: '   ' }), ['ollama']);
  });
});

describe('space identity', () => {
  test('the Natively candidate carries its own space, distinct from direct Gemini', () => {
    const [natively] = EmbeddingProviderResolver.buildCandidates({ nativelyApiKey: 'nk_live' });
    assert.equal(natively.space, 'natively:gemini-embedding-2:3072');
    assert.equal(natively.dimensions, 3072);
  });
});

describe('privacy scope policy', () => {
  test('a policy denying cloud embeddings excludes Natively too', () => {
    // Natively is a CLOUD provider. Being the "managed" tier is not an exemption
    // from the user's own privacy policy — if OpenAI and Gemini are excluded for
    // sending content off-device, so is Natively.
    const order = names({
      nativelyApiKey: 'nk_live',
      openaiKey: 'sk-openai',
      geminiKey: 'gem-key',
      providerDataScopes: { embeddings: false },
    });
    assert.ok(!order.includes('natively'), `natively must be excluded, got ${order.join(' → ')}`);
    assert.ok(!order.includes('openai'));
    assert.ok(!order.includes('gemini'));
    assert.deepEqual(order, ['ollama'], 'only the local-capable provider may remain');
  });

  test('a permissive policy leaves Natively first', () => {
    const order = names({ nativelyApiKey: 'nk_live', providerDataScopes: { embeddings: true } });
    assert.equal(order[0], 'natively');
  });
});
