// Pasting a hosted key must actually turn that provider on (2026-09-15).
//
// Natively was the only key that self-activated: setNativelyApiKey promotes the
// reranker to 'natively' and readHostedModel falls back to the managed model.
// Every other key was stored and then did nothing —
//
//   • setOpenrouterApiKey / setJinaApiKey (CredentialsManager.ts:1033, :1044)
//     write the credential and return. The reranker stays 'local'.
//   • readHostedModel (rerankerConfig.ts:199) returns settings.jinaModel /
//     settings.openrouterModel raw, so a keyed provider with no model chosen is
//     'no-model' ineligible and silently falls back to local.
//   • EmbeddingProviderResolver gates every hosted embedder on `key && model`
//     (:273, :290), so a pasted Voyage or OpenRouter key builds NO candidate
//     until a model is also set.
//
// So the key looked accepted and changed nothing. This activates it with the
// catalogue's recommended model, which the user can then change.
//
// THE GUARDS ARE THE FEATURE. All three of the ones setRerankerProviderIfManaged
// already documents apply here for the same reasons, plus the embedding scope:
//
//   1. Promote only from an AUTO-DEFAULT. An explicit pick is never replaced —
//      see AUTO_ASSIGNED_MODEL_IDS for this bug being fixed once already.
//   2. Ask the PRIVACY POLICY first. A hosted reranker ships retrieved document
//      text off the machine on the next background query with nothing invoked;
//      hosted embeddings do the same. reference_files gates reranking,
//      embeddings gates embedding. Promoting into a denied scope would also ARM
//      itself later if the scope were ever allowed for an unrelated reason.
//   3. REVERT symmetrically on a cleared key, or the user is left pointed at a
//      provider that cannot authenticate — and a failed rerank keeps the
//      existing order, so there is no symptom to notice.
//   4. Never store a model id we did not verify exists. OpenRouter's catalogue
//      is live (staticCatalogue: false) and the ids in the original brief did
//      NOT exist on the real API — see openrouterRerankModels.ts:150. A failed
//      fetch must leave the setting unset, not guess.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd());
const A = require(path.join(repoRoot, 'dist-electron/electron/services/hostedKeyActivation.js'));
const { decideRerankerActivation, decideEmbeddingActivation, rerankModelForActivation,
        defaultEmbeddingSelection, decideRevert, applyHostedKeyActivation } = A;

/** A settings store + catalogue stub, so the applier is tested without a
 *  SettingsManager singleton and without a network. */
function fakeIo(initial = {}, catalog = null) {
  const store = { ...initial };
  const logs = [];
  return {
    store, logs,
    getSetting: (k) => store[k],
    setSetting: (k, v) => { store[k] = v; return true; },
    fetchRerankCatalog: async () => catalog,
    log: (m) => logs.push(m),
  };
}

const allowed = { referenceFilesAllowed: true, embeddingsAllowed: true };

describe('guard 1 — only an auto-default is promoted', () => {
  test('local or unset is promoted', () => {
    for (const rerankerProvider of ['local', undefined]) {
      assert.equal(
        decideRerankerActivation('jina', { ...allowed, rerankerProvider }).verdict, 'activate');
    }
  });

  test('an explicit pick of another provider is never replaced', () => {
    assert.equal(
      decideRerankerActivation('jina', { ...allowed, rerankerProvider: 'openrouter' }).verdict,
      'explicit-choice');
  });

  test('an embedding model the user already chose is never replaced', () => {
    assert.equal(
      decideEmbeddingActivation('voyage', { ...allowed, embeddingModel: 'voyage-code-4' }).verdict,
      'explicit-choice');
  });
});

describe('guard 2 — the privacy scope is asked first', () => {
  test('reranking is refused when reference-file content may not leave the device', () => {
    assert.equal(
      decideRerankerActivation('jina', { ...allowed, referenceFilesAllowed: false }).verdict,
      'privacy-denied');
  });

  test('embedding is refused when the embeddings scope is denied', () => {
    assert.equal(
      decideEmbeddingActivation('voyage', { ...allowed, embeddingsAllowed: false }).verdict,
      'privacy-denied');
  });

  test('the two scopes are independent — one denial does not block the other', () => {
    assert.equal(
      decideEmbeddingActivation('voyage', { ...allowed, referenceFilesAllowed: false }).verdict,
      'activate');
    assert.equal(
      decideRerankerActivation('jina', { ...allowed, embeddingsAllowed: false }).verdict,
      'activate');
  });
});

describe('guard 3 — a cleared key reverts what the key turned on', () => {
  test('a provider we activated is reverted to local', () => {
    assert.equal(decideRevert('jina', { rerankerProvider: 'jina' }).verdict, 'revert');
  });

  test('a provider the user is not on is left alone', () => {
    assert.equal(decideRevert('jina', { rerankerProvider: 'openrouter' }).verdict, 'not-active');
    assert.equal(decideRevert('jina', { rerankerProvider: 'local' }).verdict, 'not-active');
  });
});

describe('guard 4 — never store a model id we did not verify', () => {
  test('jina resolves from its static catalogue', () => {
    assert.equal(rerankModelForActivation('jina'), 'jina-reranker-v3.5');
  });

  test('openrouter needs the live catalogue and refuses to guess without it', () => {
    assert.equal(rerankModelForActivation('openrouter', []), null);
    assert.equal(rerankModelForActivation('openrouter', undefined), null);
  });

  test('openrouter uses the recommended entry when the fetch succeeded', () => {
    const catalog = [
      { id: 'some/other', group: 'other', free: false, multimodal: false },
      { id: 'voyageai/rerank-2.5-lite', group: 'recommended', free: false, multimodal: false },
    ];
    assert.equal(rerankModelForActivation('openrouter', catalog), 'voyageai/rerank-2.5-lite');
  });
});

describe('embedding defaults name a model and never a width', () => {
  test('voyage resolves to the recommended curated model', () => {
    assert.equal(defaultEmbeddingSelection('voyage').model, 'voyage-4');
  });

  test('no storable width is returned — the width must be MEASURED', () => {
    const sel = defaultEmbeddingSelection('voyage');
    assert.equal(sel.dimensions, undefined,
      'a stored width makes withMeasuredVoyageDims skip its probe, and a stale '
      + 'curated width stamps a wrong space key over real vectors');
    // Kept for logging/comparison only, hence the deliberately different name.
    assert.equal(sel.catalogueDimensions, 1024);
  });

  test('a provider with no curated recommendation yields null rather than a guess', () => {
    // OpenRouter's embedding catalogue is fetched, not curated.
    assert.equal(defaultEmbeddingSelection('openrouter'), null);
  });
});

describe('guard 5 — an embedding switch is a corpus re-index', () => {
  test('filling in a hosted embedding model flips reindexRequired', () => {
    const { embeddingConfigChanged } = require(
      path.join(repoRoot, 'dist-electron/electron/rag/embeddingConfigIdentity.js'));
    assert.equal(
      embeddingConfigChanged({ voyageEmbeddingModel: undefined }, { voyageEmbeddingModel: 'voyage-4' }),
      true,
      'a key paste can now silently re-index every attached file — this must be detectable');
  });
});

describe('applying the decision', () => {
  test('a jina key activates the reranker with the recommended model', async () => {
    const io = fakeIo();
    const out = await applyHostedKeyActivation('jina', { keyPresent: true, io });
    assert.equal(out.reranker, 'activate');
    assert.deepEqual(io.store.reranker, { provider: 'jina', jinaModel: 'jina-reranker-v3.5' });
  });

  test('an openrouter key with a reachable catalogue activates with a real id', async () => {
    const io = fakeIo({}, [{ id: 'voyageai/rerank-2.5-lite', group: 'recommended' }]);
    const out = await applyHostedKeyActivation('openrouter', { keyPresent: true, io });
    assert.equal(out.reranker, 'activate');
    assert.equal(io.store.reranker.provider, 'openrouter');
    assert.equal(io.store.reranker.openrouterModel, 'voyageai/rerank-2.5-lite');
  });

  test('a failed catalogue fetch writes NOTHING rather than guessing an id', async () => {
    const io = fakeIo({}, null);
    const out = await applyHostedKeyActivation('openrouter', { keyPresent: true, io });
    assert.equal(out.reranker, 'no-model');
    assert.equal(io.store.reranker, undefined,
      'activating a provider with no model is the inert state this feature removes');
  });

  test('a throwing catalogue fetch is not allowed to fail the key save', async () => {
    const io = fakeIo();
    io.fetchRerankCatalog = async () => { throw new Error('offline'); };
    const out = await applyHostedKeyActivation('openrouter', { keyPresent: true, io });
    assert.equal(out.reranker, 'no-model');
  });

  test('a denied reference-files scope writes nothing and says why', async () => {
    const io = fakeIo({ providerDataScopes: { reference_files: false } });
    const out = await applyHostedKeyActivation('jina', { keyPresent: true, io });
    assert.equal(out.reranker, 'privacy-denied');
    assert.equal(io.store.reranker, undefined);
    assert.ok(io.logs.some((l) => /may not leave this device/.test(l)), io.logs.join('\n'));
  });

  test("an explicit pick is not replaced, and the user's model survives", async () => {
    const io = fakeIo({ reranker: { provider: 'openrouter', openrouterModel: 'x/y' } });
    const out = await applyHostedKeyActivation('jina', { keyPresent: true, io });
    assert.equal(out.reranker, 'explicit-choice');
    assert.deepEqual(io.store.reranker, { provider: 'openrouter', openrouterModel: 'x/y' });
  });

  test('a voyage key fills in the model but NEVER a width', async () => {
    const io = fakeIo();
    const out = await applyHostedKeyActivation('voyage', { keyPresent: true, io });
    assert.equal(out.embedding, 'activate');
    assert.equal(io.store.voyageEmbeddingModel, 'voyage-4');
    assert.equal(io.store.voyageEmbeddingDims, undefined,
      'a stored width makes withMeasuredVoyageDims skip its probe');
  });

  test('a denied embeddings scope blocks the embedding fill', async () => {
    const io = fakeIo({ providerDataScopes: { embeddings: false } });
    const out = await applyHostedKeyActivation('voyage', { keyPresent: true, io });
    assert.equal(out.embedding, 'privacy-denied');
    assert.equal(io.store.voyageEmbeddingModel, undefined);
  });

  test('clearing the key reverts the reranker but LEAVES the embedding model', async () => {
    const io = fakeIo({ reranker: { provider: 'jina', jinaModel: 'jina-reranker-v3.5' },
                        voyageEmbeddingModel: 'voyage-4' });
    const out = await applyHostedKeyActivation('jina', { keyPresent: false, io });
    assert.equal(out.reranker, 'revert');
    assert.equal(io.store.reranker.provider, 'local');
    assert.equal(io.store.voyageEmbeddingModel, 'voyage-4',
      'the embedding model names the SPACE the vectors were built in — clearing it re-indexes');
  });

  test('clearing a key for a provider the user is not on changes nothing', async () => {
    const io = fakeIo({ reranker: { provider: 'openrouter', openrouterModel: 'x/y' } });
    const out = await applyHostedKeyActivation('jina', { keyPresent: false, io });
    assert.equal(out.reranker, 'not-active');
    assert.equal(io.store.reranker.provider, 'openrouter');
  });
});

describe('the credential setters are wired to it', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(
    path.join(repoRoot, 'electron/services/CredentialsManager.ts'), 'utf8');

  test('all three BYOK setters activate, and pass whether a key REMAINS', () => {
    for (const [setter, provider, field] of [
      ['setOpenrouterApiKey', 'openrouter', 'openrouterApiKey'],
      ['setJinaApiKey', 'jina', 'jinaApiKey'],
      ['setVoyageApiKey', 'voyage', 'voyageApiKey'],
    ]) {
      const i = src.indexOf(`public ${setter}(`);
      assert.ok(i > 0, `${setter} must exist`);
      const body = src.slice(i, i + 500);
      assert.ok(
        body.includes(`this.activateHostedRetrieval('${provider}', !!this.credentials.${field})`),
        `${setter} must activate ${provider} keyed on whether a key remains — passing a bare `
        + `true would never revert on a cleared key: ${body.slice(0, 220)}`);
    }
  });

  test('activation happens AFTER the credential is saved', () => {
    const i = src.indexOf('public setJinaApiKey(');
    const body = src.slice(i, i + 400);
    assert.ok(body.indexOf('saveCredentials') < body.indexOf('activateHostedRetrieval'),
      'activation reads the store it is reacting to; running it first would see the old key');
  });

  test('a degraded credential store refuses BEFORE activating', () => {
    const i = src.indexOf('public setVoyageApiKey(');
    const body = src.slice(i, i + 400);
    assert.ok(body.indexOf('refuseWriteWhileDegraded') < body.indexOf('activateHostedRetrieval'),
      'a refused key save must not activate a provider whose key was never written');
  });
});

describe('jina no longer needs a model chosen to be eligible', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(
    path.join(repoRoot, 'electron/services/reranking/rerankerConfig.ts'), 'utf8');

  const readHostedModelBody = (() => {
    const i = src.indexOf('export function readHostedModel');
    assert.ok(i > 0, 'readHostedModel must still exist');
    const end = src.indexOf('\n}', i);
    assert.ok(end > i, 'could not find the end of readHostedModel');
    return src.slice(i, end);
  })();

  test('readHostedModel falls back to the curated jina default', () => {
    assert.match(readHostedModelBody, /settings\.jinaModel \|\| defaultHostedModel\('jina'\)/);
  });

  test('openrouter is NOT given a hard-coded fallback', () => {
    assert.ok(!/openrouterModel \|\| '/.test(readHostedModelBody),
      'its catalogue is fetched; a hard-coded id may not exist on the live API');
  });
});

// ── Review findings, 2026-09-15 ─────────────────────────────────────────────

describe("re-saving a key must not replace the user's chosen model", () => {
  // FOUND IN REVIEW. The auto-default guard protects the PROVIDER and nothing
  // else. Re-saving a key for the provider you are already on (rotating it,
  // fixing a typo, re-pasting after a failed test) fell through to 'activate'
  // and wrote the recommended model over the one you picked — the exact bug
  // AUTO_ASSIGNED_MODEL_IDS records being fixed once already: "a user's explicit
  // pick was silently replaced the moment they added a key."
  test('a chosen jina model survives a key rotation', async () => {
    const io = fakeIo({ reranker: { provider: 'jina', jinaModel: 'jina-reranker-m0' } });
    await applyHostedKeyActivation('jina', { keyPresent: true, io });
    assert.equal(io.store.reranker.jinaModel, 'jina-reranker-m0');
    assert.equal(io.store.reranker.provider, 'jina');
  });

  test('a chosen openrouter model survives a key rotation', async () => {
    const io = fakeIo(
      { reranker: { provider: 'openrouter', openrouterModel: 'some/deliberate-pick' } },
      [{ id: 'voyageai/rerank-2.5-lite', group: 'recommended' }]);
    await applyHostedKeyActivation('openrouter', { keyPresent: true, io });
    assert.equal(io.store.reranker.openrouterModel, 'some/deliberate-pick');
  });

  test('but a provider with NO model still gets the default filled in', async () => {
    const io = fakeIo({ reranker: { provider: 'jina' } });
    await applyHostedKeyActivation('jina', { keyPresent: true, io });
    assert.equal(io.store.reranker.jinaModel, 'jina-reranker-v3.5');
  });
});

describe('the decision is re-checked after the catalogue fetch', () => {
  // FOUND IN REVIEW. decideRerankerActivation ran against settings read BEFORE
  // the OpenRouter catalogue fetch. A second key saved during that window (the
  // fetch is a network round trip) would be overwritten by the stale decision:
  // the user ends up on the provider whose fetch happened to finish last, not
  // the one they saved last.
  test('a provider chosen during the fetch window is not overwritten', async () => {
    const io = fakeIo({}, [{ id: 'voyageai/rerank-2.5-lite', group: 'recommended' }]);
    io.fetchRerankCatalog = async () => {
      // Someone else wins the race while we are on the network.
      io.store.reranker = { provider: 'jina', jinaModel: 'jina-reranker-v3.5' };
      return [{ id: 'voyageai/rerank-2.5-lite', group: 'recommended' }];
    };
    const out = await applyHostedKeyActivation('openrouter', { keyPresent: true, io });
    assert.equal(out.reranker, 'explicit-choice');
    assert.equal(io.store.reranker.provider, 'jina',
      'the stale pre-fetch decision must not clobber a newer choice');
  });
});
