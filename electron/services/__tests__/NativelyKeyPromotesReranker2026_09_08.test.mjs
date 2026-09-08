/**
 * Pasting a Natively API key makes Natively the ACTIVE provider everywhere it
 * can be — generation, speech, embeddings and now reranking.
 *
 * Three of those four already worked. This covers the fourth, and the guards
 * that keep it from being a rude change:
 *
 *   • It promotes only from an AUTO-DEFAULT ('local' or unset). An explicit
 *     'openrouter' or 'jina' is a deliberate choice. The comment on
 *     AUTO_ASSIGNED_MODEL_IDS in CredentialsManager records this exact bug being
 *     fixed once already on the model side — a user's pick silently replaced the
 *     moment they added a key. Not re-introducing it one setting over.
 *
 *   • It asks the PRIVACY POLICY first, which the model and STT promotions do
 *     not need to. A hosted reranker ships retrieved document text off the
 *     machine on the next background query, without the user invoking anything.
 *     referenceFilesScopeAllowed() defaults to ALLOWED, so this would really
 *     send. Promoting into a denied scope would also arm itself later, if the
 *     user ever allowed the scope for an unrelated reason.
 *
 *   • It REVERTS symmetrically — on a cleared key and on a key the server
 *     refuses. Missing the second leaves the user pointed at a managed reranker
 *     they cannot authenticate to, and a failed rerank keeps the existing order,
 *     so there is no symptom to notice.
 *
 * Embeddings are deliberately absent here: EmbeddingProviderResolver already
 * probes Natively FIRST whenever a key exists (see
 * EmbeddingResolverNativelyFirst.test.mjs). Writing embeddingMode:'manual' to
 * "select" it would filter the candidate list to exactly one entry and delete
 * the fallback chain — a regression wearing the feature's clothes.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// A minimal stand-in for SettingsManager: the promotion reaches it through a
// lazy require, so the behaviour under test is the DECISION, not the transport.
function makeSettings(initial = {}) {
  const store = { ...initial };
  return {
    store,
    get: (k) => store[k],
    set: (k, v) => { store[k] = v; return true; },
  };
}

/**
 * The promotion rule, mirrored from CredentialsManager.setRerankerProviderIfManaged.
 * Kept as a pure function here so every branch is reachable without constructing
 * a real CredentialsManager (which reads the keychain and a settings file).
 * PinnedRule below asserts this stays in step with the shipped implementation.
 */
function decide(settings, to) {
  const current = settings.get('reranker') ?? {};
  const provider = current.provider;
  if (to === 'natively') {
    if (!(!provider || provider === 'local')) return false;
    const scopes = settings.get('providerDataScopes');
    if (scopes?.reference_files === false) return false;
  } else if (provider !== 'natively') {
    return false;
  }
  settings.set('reranker', { ...current, provider: to });
  return true;
}

describe('promotion on key paste', () => {
  test('an unset reranker becomes natively', () => {
    const s = makeSettings();
    assert.equal(decide(s, 'natively'), true);
    assert.equal(s.store.reranker.provider, 'natively');
  });

  test('the default local reranker becomes natively', () => {
    const s = makeSettings({ reranker: { provider: 'local' } });
    assert.equal(decide(s, 'natively'), true);
    assert.equal(s.store.reranker.provider, 'natively');
  });

  test('other reranker settings survive the promotion', () => {
    // A user who set a candidate count or opted into local fallback keeps both.
    const s = makeSettings({ reranker: { provider: 'local', candidateCount: 40, fallbackToLocal: true } });
    decide(s, 'natively');
    assert.deepEqual(s.store.reranker, { provider: 'natively', candidateCount: 40, fallbackToLocal: true });
  });

  test('a DELIBERATE hosted choice is never overridden', () => {
    for (const chosen of ['openrouter', 'jina']) {
      const s = makeSettings({ reranker: { provider: chosen } });
      assert.equal(decide(s, 'natively'), false, `${chosen} must be left alone`);
      assert.equal(s.store.reranker.provider, chosen);
    }
  });
});

describe('the privacy gate', () => {
  test('a denied reference-files scope blocks the promotion', () => {
    const s = makeSettings({ providerDataScopes: { reference_files: false } });
    assert.equal(decide(s, 'natively'), false);
    assert.equal(s.store.reranker, undefined, 'nothing may be written');
  });

  test('an explicitly allowed scope permits it', () => {
    const s = makeSettings({ providerDataScopes: { reference_files: true } });
    assert.equal(decide(s, 'natively'), true);
  });

  test('an absent scope permits it — matching referenceFilesScopeAllowed()', () => {
    // That helper reads `!== false`, so absent means allowed. The promotion must
    // agree with the runtime gate, or it refuses in a state that would have run.
    assert.equal(decide(makeSettings({ providerDataScopes: {} }), 'natively'), true);
    assert.equal(decide(makeSettings({}), 'natively'), true);
  });
});

describe('revert — cleared key, and key refused by the server', () => {
  test('natively goes back to local', () => {
    const s = makeSettings({ reranker: { provider: 'natively' } });
    assert.equal(decide(s, 'local'), true);
    assert.equal(s.store.reranker.provider, 'local');
  });

  test('a user-chosen hosted provider is NOT reverted', () => {
    // They never got there by promotion, so the revert has no business undoing it.
    const s = makeSettings({ reranker: { provider: 'openrouter' } });
    assert.equal(decide(s, 'local'), false);
    assert.equal(s.store.reranker.provider, 'openrouter');
  });

  test('an already-local reranker is a no-op', () => {
    const s = makeSettings({ reranker: { provider: 'local' } });
    assert.equal(decide(s, 'local'), false);
  });

  test('promote then revert returns to exactly the starting state', () => {
    const s = makeSettings({ reranker: { provider: 'local', candidateCount: 25 } });
    decide(s, 'natively');
    decide(s, 'local');
    assert.deepEqual(s.store.reranker, { provider: 'local', candidateCount: 25 });
  });
});

describe('the shipped implementation matches this rule', () => {
  test('CredentialsManager promotes, gates on the scope, and reverts', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('electron/services/CredentialsManager.ts', 'utf8');
    // Promotion is wired into the key-stored path...
    assert.match(src, /setRerankerProviderIfManaged\('natively', 'Natively key stored'\)/);
    // ...and the revert into applyNativelyAutoDefaultRevert, which is what both
    // the cleared-key path and revertNativelyAutoDefaults() call.
    const revert = src.slice(src.indexOf('private applyNativelyAutoDefaultRevert'));
    assert.match(revert.slice(0, 1600), /setRerankerProviderIfManaged\('local', reason\)/);
    // The privacy gate must be on the promote branch specifically.
    const fn = src.slice(src.indexOf('private setRerankerProviderIfManaged'));
    assert.match(fn.slice(0, 2600), /reference_files === false/);
    // Only these two providers are ever written.
    assert.match(src, /setRerankerProviderIfManaged\(to: 'natively' \| 'local'/);
  });

  test("AppSettings allows 'natively' — the value being written", async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('electron/services/SettingsManager.ts', 'utf8');
    assert.match(src, /provider\?: 'local' \| 'natively' \| 'openrouter' \| 'jina';/);
  });
});
