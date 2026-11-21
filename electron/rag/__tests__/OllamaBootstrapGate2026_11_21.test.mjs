// electron/rag/__tests__/OllamaBootstrapGate2026_11_21.test.mjs
//
// Startup's Ollama embeddings bootstrap spawns `ollama serve` and pulls
// nomic-embed-text when it is missing. Its guard skipped only for an OpenAI or
// Gemini key, so a user on the Natively API alone got Ollama started on every
// launch (seen 2026-11-21 in a dev launch with only a Natively key: `ollama
// serve` was a child of the app although embeddings ran on Natively).
//
// The gate decides from settings and the resolver's real candidate order (no
// probing, no network, no waiting on the pipeline).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (f) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag', f)).href;
const { EmbeddingProviderResolver } = await import(dist('EmbeddingProviderResolver.js'));
const { ollamaBootstrapSkipReason } = await import(dist('ollamaBootstrapGate.js'));

const OLLAMA = 'http://localhost:11434';
const skip = (config, hasCloudEmbeddingKey = false) => ollamaBootstrapSkipReason({
  config: { ollamaUrl: OLLAMA, ...config },
  buildCandidates: EmbeddingProviderResolver.buildCandidates,
  hasCloudEmbeddingKey,
});
const NATIVELY = { nativelyApiKey: 'natively_sk_test' };

describe('providers that come before Ollama skip the bootstrap', () => {
  test('a Natively key alone (the reported case)', () => {
    assert.match(skip(NATIVELY), /^natively embeddings come before Ollama$/);
  });
  test('a trial with its token', () => {
    assert.match(skip({ nativelyApiKey: '__trial__', nativelyTrialToken: 'trial-token' }), /^natively /);
  });
  test('an OpenAI or Gemini key (the existing rule)', () => {
    assert.equal(skip({}, true), 'a cloud embedding provider is configured');
  });
});

describe('a provider chosen in Settings decides first', () => {
  test('Ollama chosen by hand bootstraps, even with an OpenAI key (review 2026-11-21)', () => {
    assert.equal(skip({ ...NATIVELY, openaiKey: 'sk-test', embeddingMode: 'manual', embeddingProvider: 'ollama' }, true), undefined);
  });
  test('Natively chosen by hand skips, whatever the network does at launch', () => {
    assert.match(skip({ ...NATIVELY, embeddingMode: 'manual', embeddingProvider: 'natively' }), /natively embeddings are chosen in Settings/);
  });
  test('a provider whose width is not measured yet still skips (no candidate is built for it)', () => {
    assert.match(skip({ openrouterKey: 'or-key', embeddingMode: 'manual', embeddingProvider: 'openrouter', openrouterEmbeddingModel: 'x' }), /openrouter/);
  });
  test('the built-in local model chosen by hand skips: Ollama would never be used', () => {
    assert.match(skip({ embeddingMode: 'manual', embeddingProvider: 'local' }), /local embeddings are chosen/);
  });
});

describe('Ollama first, or no candidate: bootstrap as before', () => {
  test('no key at all', () => {
    assert.equal(skip({}), undefined);
  });
  test('a trial sentinel without its token cannot authenticate', () => {
    assert.equal(skip({ nativelyApiKey: '__trial__' }), undefined);
  });
  test('a privacy setting that keeps embeddings on the device', () => {
    assert.equal(skip({ ...NATIVELY, providerDataScopes: { embeddings: false } }), undefined);
  });
});

test('the order check is quiet: the pipeline already printed its warnings', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  skip({ ...NATIVELY, providerDataScopes: { embeddings: false } });
  assert.equal(warn.mock.callCount(), 0);
  EmbeddingProviderResolver.buildCandidates({ ollamaUrl: OLLAMA, ...NATIVELY, providerDataScopes: { embeddings: false } });
  assert.equal(warn.mock.callCount(), 1, 'the default call still warns');
});

describe('main.ts wiring', () => {
  const src = readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');
  const start = src.indexOf('private async bootstrapOllamaEmbeddings()');
  const body = src.slice(start, src.indexOf('private initializeRAGManager', start));

  test('the gate runs before spawning, inside the guard whose errors fall through', () => {
    const gate = body.indexOf('ollamaBootstrapSkipReason({');
    assert.ok(start > 0 && gate > 0);
    assert.ok(gate < body.indexOf('} catch (guardErr'), 'gate is inside the guard try');
    assert.ok(gate < body.indexOf('new OllamaBootstrap()'), 'gate runs before the spawn');
    assert.doesNotMatch(body.slice(0, gate), /if \(hasCloudEmbeddingKey\)/, 'the key check no longer returns before the gate');
    assert.doesNotMatch(body, /waitForReady/, 'the decision never waits on the pipeline');
  });

  test('after the model pull the pipeline is re-resolved, not skipped as unchanged', () => {
    assert.match(body, /getEmbeddingPipeline\(\)\.markConfigStale\(\);\s*this\.ragManager\.initializeEmbeddings\(buildEmbeddingConfig\(\)\)/);
  });
});

describe('EmbeddingPipeline: re-init after Ollama comes up, and the waitForReady timer', async () => {
  const { EmbeddingPipeline } = await import(dist('EmbeddingPipeline.js'));
  const stubDb = { prepare: () => ({ run: () => {}, get: () => undefined, all: () => [] }) };
  const makePipe = () => {
    const pipe = new EmbeddingPipeline(stubDb, {});
    let runs = 0;
    pipe._doInitialize = async () => { runs++; };
    return { pipe, runs: () => runs };
  };
  const CONFIG = { ollamaUrl: OLLAMA };

  test('an unchanged config is skipped; after markConfigStale it re-resolves (Ollama just came up)', async () => {
    const { pipe, runs } = makePipe();
    await pipe.initialize(CONFIG);
    await pipe.initialize(CONFIG);
    assert.equal(runs(), 1);
    pipe.markConfigStale();
    await pipe.initialize(CONFIG);
    assert.equal(runs(), 2);
    await pipe.initialize(CONFIG);
    assert.equal(runs(), 2, 'only the next call');
  });

  test('a waitForReady that resolves early clears its timeout', async (t) => {
    const { pipe } = makePipe();
    await pipe.initialize(CONFIG);
    const cleared = t.mock.method(globalThis, 'clearTimeout');
    await pipe.waitForReady(60_000);
    assert.equal(cleared.mock.callCount(), 1);
  });
});
