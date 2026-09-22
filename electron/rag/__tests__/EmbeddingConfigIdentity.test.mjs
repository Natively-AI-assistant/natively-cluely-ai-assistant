// electron/rag/__tests__/EmbeddingConfigIdentity.test.mjs
//
// Two silent-failure surfaces around the embedding config:
//
//  1. FOUR hand-rolled AppAPIConfig assembly sites (main.ts x2, ipcHandlers.ts
//     x2) already drifted before this change — `geminiKeys` was passed at only
//     one of them. A newly added field inherits that drift, so the Natively key
//     would reach the resolver from some entry points and not others.
//
//  2. _isConfigChanged is a hand-maintained field-by-field comparison. A field
//     missing from it means changing that setting re-initializes NOTHING and
//     reports no error — the "I changed it and nothing happened" bug.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(path.resolve(__dirname, '../../..', f), 'utf8');
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingConfigIdentity.js');
const { embeddingConfigFrom, embeddingConfigChanged, resolveEmbeddingCredentials } = await import(pathToFileURL(modPath).href);

describe('embeddingConfigFrom', () => {
  test('carries the Natively key through to the resolver config', () => {
    const cfg = embeddingConfigFrom({ nativelyApiKey: 'nk_live_1' });
    assert.equal(cfg.nativelyApiKey, 'nk_live_1');
  });

  test('pairs the trial sentinel with its token, which is the real credential', () => {
    const cfg = embeddingConfigFrom({ nativelyApiKey: '__trial__', trialToken: 'natively_trial_9' });
    assert.equal(cfg.nativelyApiKey, '__trial__');
    assert.equal(cfg.nativelyTrialToken, 'natively_trial_9');
  });

  test('still carries every field the previous call sites passed', () => {
    const cfg = embeddingConfigFrom({
      openaiKey: 'sk-a',
      geminiKey: 'g-a',
      geminiKeys: ['g-a', 'g-b'],
      ollamaUrl: 'http://localhost:11434',
      providerDataScopes: { embeddings: true },
      explicitKeyManagement: true,
    });
    assert.equal(cfg.openaiKey, 'sk-a');
    assert.equal(cfg.geminiKey, 'g-a');
    assert.deepEqual(cfg.geminiKeys, ['g-a', 'g-b']);
    assert.equal(cfg.ollamaUrl, 'http://localhost:11434');
    assert.deepEqual(cfg.providerDataScopes, { embeddings: true });
    assert.equal(cfg.explicitKeyManagement, true);
  });

  test('blank credentials become undefined, so a cleared key really removes its provider', () => {
    const cfg = embeddingConfigFrom({ nativelyApiKey: '   ', openaiKey: '' });
    assert.equal(cfg.nativelyApiKey, undefined);
    assert.equal(cfg.openaiKey, undefined);
  });
});

describe('embeddingConfigChanged', () => {
  const base = { nativelyApiKey: 'nk_1', openaiKey: 'sk-1', ollamaUrl: 'http://localhost:11434' };

  test('identical config is not a change (initialize stays idempotent)', () => {
    assert.equal(embeddingConfigChanged(base, { ...base }), false);
  });

  test('adding a Natively key is a change', () => {
    assert.equal(embeddingConfigChanged({ openaiKey: 'sk-1' }, { openaiKey: 'sk-1', nativelyApiKey: 'nk_1' }), true);
  });

  test('REMOVING a Natively key is a change, so the provider is actually dropped', () => {
    // Removals matter as much as additions: a cleared key that does not
    // re-resolve leaves the old provider alive until restart, and the UI then
    // lies about which provider is active.
    assert.equal(embeddingConfigChanged(base, { ...base, nativelyApiKey: undefined }), true);
  });

  test('swapping one Natively key for another is a change', () => {
    assert.equal(embeddingConfigChanged(base, { ...base, nativelyApiKey: 'nk_2' }), true);
  });

  test('a trial token change is a change (the sentinel key never varies)', () => {
    // nativelyApiKey stays '__trial__' across trials, so comparing the key alone
    // would treat a brand-new trial as "unchanged" and keep the dead token.
    const a = { nativelyApiKey: '__trial__', nativelyTrialToken: 't1' };
    const b = { nativelyApiKey: '__trial__', nativelyTrialToken: 't2' };
    assert.equal(embeddingConfigChanged(a, b), true);
  });

  test('whitespace-only differences are not a change', () => {
    assert.equal(embeddingConfigChanged(base, { ...base, nativelyApiKey: ' nk_1 ' }), false);
  });

  test('the pre-existing fields are still compared', () => {
    assert.equal(embeddingConfigChanged(base, { ...base, openaiKey: 'sk-2' }), true);
    assert.equal(embeddingConfigChanged(base, { ...base, ollamaUrl: 'http://other:11434' }), true);
    assert.equal(embeddingConfigChanged(base, { ...base, geminiKeys: ['x'] }), true);
    assert.equal(embeddingConfigChanged(base, { ...base, providerDataScopes: { embeddings: false } }), true);
    assert.equal(embeddingConfigChanged(base, { ...base, explicitKeyManagement: true }), true);
  });
});

describe('call sites', () => {
  // The four sites that used to hand-roll AppAPIConfig must all go through the
  // shared builder. This is the guard against them drifting apart again — which
  // they already had once, silently dropping geminiKeys at three of the four.
  test('no embedding entry point hand-rolls the config any more', () => {
    for (const file of ['electron/main.ts', 'electron/ipcHandlers.ts']) {
      const src = read(file);
      // An initializeEmbeddings / RAGManager call that passes an inline
      // `ollamaUrl:` is by definition assembling the config itself.
      const handRolled = /initializeEmbeddings\(\{[\s\S]{0,400}?ollamaUrl:/.test(src);
      assert.equal(handRolled, false, `${file} still assembles an embedding config inline`);
    }
  });

  test('every embedding initialization goes through buildEmbeddingConfig', () => {
    for (const file of ['electron/main.ts', 'electron/ipcHandlers.ts']) {
      const src = read(file);
      const calls = src.match(/initializeEmbeddings\(/g) || [];
      const viaBuilder = src.match(/initializeEmbeddings\(buildEmbeddingConfig\(/g) || [];
      assert.equal(calls.length, viaBuilder.length, `${file}: ${calls.length} init call(s) but ${viaBuilder.length} use the builder`);
    }
  });

  test('the RAGManager constructor is fed by the builder too', () => {
    assert.match(read('electron/main.ts'), /new RAGManager\(\{[\s\S]{0,200}?\.\.\.buildEmbeddingConfig\(\)/);
  });
});

describe('explicit key clearing', () => {
  // The Settings handlers call buildEmbeddingConfig({ geminiKey: apiKey || undefined }).
  // When the user CLEARS the field, apiKey is '' so the override is `undefined` —
  // which must still mean "this key is gone", not "I did not specify one". Getting
  // that wrong resurrects the removed key from the credential store and the
  // provider stays alive until restart, with the UI reporting it as removed.
  test('an explicitly-passed undefined key clears it rather than falling back', () => {
    const cfg = embeddingConfigFrom({ geminiKey: undefined, openaiKey: 'sk-kept' });
    assert.equal(cfg.geminiKey, undefined);
    assert.equal(cfg.openaiKey, 'sk-kept');
  });

  test('resolveEmbeddingCredentials distinguishes an absent override from a cleared one', () => {
    const store = {
      getGeminiApiKey: () => 'STORED_GEMINI',
      getOpenaiApiKey: () => 'STORED_OPENAI',
      getNativelyApiKey: () => undefined,
      getTrialToken: () => undefined,
    };

    const cleared = resolveEmbeddingCredentials({ geminiKey: undefined, explicitKeyManagement: true }, store);
    assert.equal(cleared.geminiKey, undefined, 'a cleared Gemini key must NOT come back from the store');
    assert.equal(cleared.openaiKey, 'STORED_OPENAI', 'the untouched key still comes from the store');
    assert.deepEqual(cleared.geminiKeys, [], 'the rotation pool must not resurrect the cleared key either');

    const untouched = resolveEmbeddingCredentials({ explicitKeyManagement: true }, store);
    assert.equal(untouched.geminiKey, 'STORED_GEMINI', 'no override means read the store');
  });

  test('a Natively key is read from the store when not overridden', () => {
    const cfg = resolveEmbeddingCredentials({}, {
      getGeminiApiKey: () => undefined,
      getOpenaiApiKey: () => undefined,
      getNativelyApiKey: () => 'nk_from_store',
    });
    assert.equal(cfg.nativelyApiKey, 'nk_from_store');
  });

  test('a trial sentinel pulls the trial token from the store', () => {
    const cfg = resolveEmbeddingCredentials({}, {
      getGeminiApiKey: () => undefined,
      getOpenaiApiKey: () => undefined,
      getNativelyApiKey: () => '__trial__',
      getTrialToken: () => 'natively_trial_from_store',
    });
    assert.equal(cfg.nativelyTrialToken, 'natively_trial_from_store');
  });
});

describe('Ollama embedding model settings', () => {
  test('the chosen model and its measured width reach the resolver config', () => {
    const cfg = embeddingConfigFrom({ ollamaEmbeddingModel: 'qwen3-embedding:8b', ollamaEmbeddingDims: 4096 });
    assert.equal(cfg.ollamaEmbeddingModel, 'qwen3-embedding:8b');
    assert.equal(cfg.ollamaEmbeddingDims, 4096);
  });

  test('changing the Ollama embedding model re-initializes', () => {
    // Without this the user picks a new model in Settings and NOTHING happens —
    // no re-resolve, no error, the old provider stays active until restart.
    const a = { ollamaEmbeddingModel: 'nomic-embed-text', ollamaEmbeddingDims: 768 };
    const b = { ollamaEmbeddingModel: 'qwen3-embedding:8b', ollamaEmbeddingDims: 4096 };
    assert.equal(embeddingConfigChanged(a, b), true);
  });

  test('a width change alone re-initializes (same model, re-measured)', () => {
    const a = { ollamaEmbeddingModel: 'shrinkable', ollamaEmbeddingDims: 1024 };
    const b = { ollamaEmbeddingModel: 'shrinkable', ollamaEmbeddingDims: 256 };
    assert.equal(embeddingConfigChanged(a, b), true);
  });

  test('an unchanged Ollama selection is not a change', () => {
    const a = { ollamaEmbeddingModel: 'nomic-embed-text', ollamaEmbeddingDims: 768 };
    assert.equal(embeddingConfigChanged(a, { ...a }), false);
  });
});

describe('an explicit provider switch re-initializes', () => {
  // The other half of the "clicking does nothing" bug: even with the resolver
  // honouring the choice, EmbeddingPipeline.initialize() short-circuits when the
  // config compares equal. Switching Natively -> Built-in changes no model and
  // no width, so without these fields the comparator saw NOTHING different and
  // skipped re-resolution entirely.
  test('switching provider is a change even when model and width do not move', () => {
    const a = { embeddingMode: 'manual', embeddingProvider: 'natively' };
    const b = { embeddingMode: 'manual', embeddingProvider: 'local' };
    assert.equal(embeddingConfigChanged(a, b), true);
  });

  test('switching from automatic to an explicit choice is a change', () => {
    assert.equal(embeddingConfigChanged({ embeddingMode: 'auto' }, { embeddingMode: 'manual', embeddingProvider: 'gemini' }), true);
  });

  test('going back to automatic is a change', () => {
    assert.equal(embeddingConfigChanged({ embeddingMode: 'manual', embeddingProvider: 'gemini' }, { embeddingMode: 'auto' }), true);
  });

  test('an unchanged choice is still not a change', () => {
    const a = { embeddingMode: 'manual', embeddingProvider: 'ollama', ollamaEmbeddingModel: 'nomic-embed-text', ollamaEmbeddingDims: 768 };
    assert.equal(embeddingConfigChanged(a, { ...a }), false);
  });

  test('the builder carries the choice for EVERY provider, including the hint-less ones', () => {
    // natively and local have no model/dims hints to map, which is exactly why
    // they were dropped before — the choice itself has to travel.
    for (const provider of ['natively', 'local', 'ollama', 'openai', 'gemini', 'custom']) {
      const cfg = embeddingConfigFrom({ embeddingMode: 'manual', embeddingProvider: provider });
      assert.equal(cfg.embeddingProvider, provider, `${provider} choice must reach the resolver`);
      assert.equal(cfg.embeddingMode, 'manual');
    }
  });
});
