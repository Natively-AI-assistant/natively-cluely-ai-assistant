// electron/rag/__tests__/EmbeddingCatalog.test.mjs
//
// The per-provider embedding model catalogue shown in Settings.
//
// Model ids and widths are taken from the providers' CURRENT official docs
// (fetched 2026-08-29), not from memory. Google publishes shutdown dates for its
// embedding models, and several are already past them — offering a retired model
// is worse than offering none, because the failure only appears at index time.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingCatalog.js');
const { buildEmbeddingCatalog, STATIC_EMBEDDING_MODELS } = await import(pathToFileURL(modPath).href);

const providers = (cat) => cat.map(p => p.id);
const byId = (cat, id) => cat.find(p => p.id === id);
const ids = (p) => p.models.map(m => m.id);

describe('OpenAI', () => {
  test('offers the three documented embedding models', () => {
    const p = byId(buildEmbeddingCatalog({ hasOpenaiKey: true }), 'openai');
    assert.deepEqual(ids(p).sort(), ['text-embedding-3-large', 'text-embedding-3-small', 'text-embedding-ada-002']);
  });

  test('carries the documented default widths', () => {
    const p = byId(buildEmbeddingCatalog({ hasOpenaiKey: true }), 'openai');
    const dims = Object.fromEntries(p.models.map(m => [m.id, m.dimensions]));
    assert.equal(dims['text-embedding-3-small'], 1536);
    assert.equal(dims['text-embedding-3-large'], 3072);
    assert.equal(dims['text-embedding-ada-002'], 1536);
  });

  test('offers no chat model, only embedders', () => {
    const p = byId(buildEmbeddingCatalog({ hasOpenaiKey: true }), 'openai');
    for (const id of ids(p)) assert.match(id, /embedding/);
  });
});

describe('Gemini', () => {
  test('offers only models that are not past their published shutdown date', () => {
    // Retired per Google's model pages: text-embedding-004 (2026-01-14),
    // embedding-001 / embedding-gecko-001 (2025-10-30), embedding-2-preview
    // (2026-08-10). All are in the past as of this file's date.
    const p = byId(buildEmbeddingCatalog({ hasGeminiKey: true }), 'gemini');
    for (const dead of ['text-embedding-004', 'embedding-001', 'embedding-gecko-001', 'embedding-2-preview']) {
      assert.ok(!ids(p).includes(dead), `${dead} is retired and must not be offered`);
    }
  });

  test('offers gemini-embedding-2 and gemini-embedding-001', () => {
    const p = byId(buildEmbeddingCatalog({ hasGeminiKey: true }), 'gemini');
    assert.deepEqual(ids(p).sort(), ['gemini-embedding-001', 'gemini-embedding-2']);
  });

  test('marks gemini-embedding-2 as the current replacement', () => {
    const p = byId(buildEmbeddingCatalog({ hasGeminiKey: true }), 'gemini');
    const v2 = p.models.find(m => m.id === 'gemini-embedding-2');
    assert.equal(v2.recommended, true);
    assert.equal(v2.dimensions, 3072);
  });
});

describe('Natively', () => {
  test('exposes exactly the model the server pins, and it is not user-selectable', () => {
    // The managed tier runs gemini-embedding-2 @768 server-side; offering a
    // choice here would be a lie the client cannot honour.
    const p = byId(buildEmbeddingCatalog({ hasNativelyKey: true }), 'natively');
    assert.deepEqual(ids(p), ['gemini-embedding-2']);
    assert.equal(p.models[0].dimensions, 3072);
    assert.equal(p.managed, true);
  });
});

describe('Built-in', () => {
  test('always offers the bundled MiniLM', () => {
    const p = byId(buildEmbeddingCatalog({ ollamaReachable: false }), 'local');
    assert.deepEqual(ids(p), ['Xenova/all-MiniLM-L6-v2']);
    assert.equal(p.models[0].dimensions, 384);
  });

  test('adds nomic-embed-text only when Ollama is actually running', () => {
    // Natively auto-pulls nomic-embed-text through Ollama, so it is "built in"
    // only in the sense that it arrives without configuration — and only if
    // Ollama is there to serve it.
    const withOllama = byId(buildEmbeddingCatalog({ ollamaReachable: true }), 'local');
    assert.ok(ids(withOllama).includes('nomic-embed-text'));
    const without = byId(buildEmbeddingCatalog({ ollamaReachable: false }), 'local');
    assert.ok(!ids(without).includes('nomic-embed-text'));
  });

  test('MiniLM is labelled lightweight, never recommended', () => {
    // §14: it is the compatibility default, not the recommendation.
    const p = byId(buildEmbeddingCatalog({}), 'local');
    const mini = p.models.find(m => m.id === 'Xenova/all-MiniLM-L6-v2');
    assert.equal(mini.lightweight, true);
    assert.notEqual(mini.recommended, true);
  });
});

describe('Ollama', () => {
  test('is populated from the live probe, not a hardcoded list', () => {
    const cat = buildEmbeddingCatalog({
      ollamaReachable: true,
      ollamaModels: [
        { name: 'qwen3-embedding:8b', dimensionsHint: 4096, dimensionsVerified: false },
        { name: 'nomic-embed-text', dimensionsHint: 768, dimensionsVerified: false },
      ],
    });
    assert.deepEqual(ids(byId(cat, 'ollama')).sort(), ['nomic-embed-text', 'qwen3-embedding:8b']);
  });

  test('a declared width is carried as unverified', () => {
    const cat = buildEmbeddingCatalog({
      ollamaReachable: true,
      ollamaModels: [{ name: 'x', dimensionsHint: 1024, dimensionsVerified: false }],
    });
    const m = byId(cat, 'ollama').models[0];
    assert.equal(m.dimensions, 1024);
    assert.equal(m.dimensionsVerified, false);
  });

  test('an unreachable daemon yields an empty model list, not a fake one', () => {
    const p = byId(buildEmbeddingCatalog({ ollamaReachable: false }), 'ollama');
    assert.deepEqual(p.models, []);
    assert.equal(p.available, false);
  });
});

describe('catalogue shape', () => {
  test('every provider is present so the panel never hides one silently', () => {
    assert.deepEqual(providers(buildEmbeddingCatalog({})), ['natively', 'ollama', 'custom', 'openrouter', 'voyage', 'openai', 'gemini', 'local']);
  });

  test('cloud providers are flagged so the panel can show where data goes', () => {
    const cat = buildEmbeddingCatalog({});
    assert.equal(byId(cat, 'openai').cloud, true);
    assert.equal(byId(cat, 'gemini').cloud, true);
    assert.equal(byId(cat, 'natively').cloud, true);
    assert.equal(byId(cat, 'ollama').cloud, false);
    assert.equal(byId(cat, 'local').cloud, false);
  });

  test('availability reflects credentials, not just existence', () => {
    const noKeys = buildEmbeddingCatalog({});
    assert.equal(byId(noKeys, 'openai').available, false);
    assert.equal(byId(noKeys, 'openai').unavailableReason, 'no_key');

    const withKey = buildEmbeddingCatalog({ hasOpenaiKey: true });
    assert.equal(byId(withKey, 'openai').available, true);
  });

  test('the bundled model is always available — it needs nothing', () => {
    assert.equal(byId(buildEmbeddingCatalog({}), 'local').available, true);
  });

  test('the static catalogue is exported for reuse and is frozen', () => {
    assert.ok(STATIC_EMBEDDING_MODELS.openai.length > 0);
    assert.throws(() => { STATIC_EMBEDDING_MODELS.openai.push({}); });
  });
});

describe('Custom endpoint', () => {
  test('is listed but not configured when no endpoint is set', () => {
    const p = byId(buildEmbeddingCatalog({}), 'custom');
    assert.equal(p.available, false);
    assert.equal(p.unavailableReason, 'not_configured');
    assert.deepEqual(p.models, []);
  });

  test('lists the models the endpoint reports', () => {
    const p = byId(buildEmbeddingCatalog({
      customEndpoint: 'http://localhost:1234/v1',
      customModels: [{ id: 'bge-m3', capabilityKnown: true }, { id: 'nomic-v2', capabilityKnown: true }],
    }), 'custom');
    assert.deepEqual(p.models.map(m => m.id).sort(), ['bge-m3', 'nomic-v2']);
    assert.equal(p.available, true);
    assert.equal(p.endpoint, 'http://localhost:1234/v1');
  });

  test('flags that capability is unknown on a plain OpenAI-compatible server', () => {
    // llama.cpp / vLLM report no model type, so the list is everything they
    // serve. The UI must not imply a check nobody performed.
    const p = byId(buildEmbeddingCatalog({
      customEndpoint: 'http://localhost:8080/v1',
      customModels: [{ id: 'anything', capabilityKnown: false }],
    }), 'custom');
    assert.equal(p.capabilityUnknown, true);
  });

  test('does not flag capability-unknown when the server did report types', () => {
    const p = byId(buildEmbeddingCatalog({
      customEndpoint: 'http://localhost:1234/v1',
      customModels: [{ id: 'bge-m3', capabilityKnown: true }],
    }), 'custom');
    assert.equal(p.capabilityUnknown, false);
  });

  test('widths start unmeasured — they are probed on selection, never declared', () => {
    const p = byId(buildEmbeddingCatalog({
      customEndpoint: 'http://x/v1', customModels: [{ id: 'm', capabilityKnown: true }],
    }), 'custom');
    assert.equal(p.models[0].dimensionsVerified, false);
  });

  test('counts as on-device — self-hosting is the point', () => {
    assert.equal(byId(buildEmbeddingCatalog({}), 'custom').cloud, false);
  });
});

describe('models are hidden without a key', () => {
  test('a cloud provider with no key lists NO models', () => {
    // Showing a model that cannot be selected is noise, and invites a click that
    // silently does nothing.
    for (const id of ['openai', 'gemini', 'natively']) {
      assert.deepEqual(byId(buildEmbeddingCatalog({}), id).models, [], `${id} must list nothing`);
    }
  });

  test('the card itself still appears, with the reason', () => {
    // Omitting it entirely would leave the user unable to tell "unsupported"
    // from "no key yet".
    const p = byId(buildEmbeddingCatalog({}), 'openai');
    assert.equal(p.available, false);
    assert.equal(p.unavailableReason, 'no_key');
    assert.equal(p.name, 'OpenAI');
  });

  test('a privacy block also empties the list, not just the availability flag', () => {
    const p = byId(buildEmbeddingCatalog({ hasGeminiKey: true, cloudBlocked: true }), 'gemini');
    assert.deepEqual(p.models, []);
    assert.equal(p.unavailableReason, 'blocked_by_policy');
  });

  test('the bundled provider still lists its model — it needs no key', () => {
    assert.ok(byId(buildEmbeddingCatalog({}), 'local').models.length > 0);
  });
});

describe('discovered models replace the static seed', () => {
  test('a fetched list wins over the built-in one', () => {
    const p = byId(buildEmbeddingCatalog({
      hasOpenaiKey: true,
      fetchedModels: { openai: [{ id: 'text-embedding-4-new', label: 'text-embedding-4-new', dimensions: 0, dimensionsVerified: false }] },
    }), 'openai');
    assert.deepEqual(p.models.map(m => m.id), ['text-embedding-4-new']);
  });

  test('an EMPTY fetch falls back to the seed rather than blanking the card', () => {
    // A failed or not-yet-run discovery must not look like "this key has no
    // embedding models".
    const p = byId(buildEmbeddingCatalog({ hasOpenaiKey: true, fetchedModels: { openai: [] } }), 'openai');
    assert.ok(p.models.length > 0);
  });

  test('a fetch for one provider does not affect another', () => {
    const cat = buildEmbeddingCatalog({
      hasOpenaiKey: true, hasGeminiKey: true,
      fetchedModels: { openai: [{ id: 'only-this', label: 'only-this', dimensions: 0, dimensionsVerified: false }] },
    });
    assert.deepEqual(byId(cat, 'openai').models.map(m => m.id), ['only-this']);
    assert.ok(byId(cat, 'gemini').models.length > 1);
  });
});

describe('OpenRouter', () => {
  const MODELS = [
    { id: 'voyageai/voyage-4-lite', label: 'voyageai/voyage-4-lite', dimensions: 0, dimensionsVerified: false, pricePerMillion: 0.02 },
    { id: 'nvidia/nemotron-3-embed-1b:free', label: 'nvidia/nemotron-3-embed-1b:free', dimensions: 0, dimensionsVerified: false, pricePerMillion: 0 },
  ];

  test('is listed as a cloud provider', () => {
    const p = byId(buildEmbeddingCatalog({}), 'openrouter');
    assert.equal(p.cloud, true);
    assert.equal(p.name, 'OpenRouter');
  });

  test('shows its models even WITHOUT a key — the catalogue is public', () => {
    // Unlike the other cloud providers. The point of listing it is to let someone
    // compare models and prices before deciding to sign up.
    const p = byId(buildEmbeddingCatalog({ openrouterModels: MODELS }), 'openrouter');
    assert.equal(p.models.length, 2);
    assert.equal(p.available, false);
    assert.equal(p.unavailableReason, 'no_key');
  });

  test('becomes selectable once a key exists', () => {
    const p = byId(buildEmbeddingCatalog({ hasOpenrouterKey: true, openrouterModels: MODELS }), 'openrouter');
    assert.equal(p.available, true);
  });

  test('a privacy block empties it, key or not', () => {
    // Browsing prices is not a reason to leak embeddings to a third party.
    const p = byId(buildEmbeddingCatalog({ hasOpenrouterKey: true, openrouterModels: MODELS, cloudBlocked: true }), 'openrouter');
    assert.deepEqual(p.models, []);
    assert.equal(p.unavailableReason, 'blocked_by_policy');
  });

  test('widths start unmeasured — the listing carries none', () => {
    const p = byId(buildEmbeddingCatalog({ hasOpenrouterKey: true, openrouterModels: MODELS }), 'openrouter');
    for (const m of p.models) assert.equal(m.dimensionsVerified, false);
  });

  test('namespaced ids and variant suffixes are preserved', () => {
    const p = byId(buildEmbeddingCatalog({ openrouterModels: MODELS }), 'openrouter');
    assert.ok(p.models.some(m => m.id === 'nvidia/nemotron-3-embed-1b:free'));
  });
});

describe('Voyage AI', () => {
  const voy = (input = {}) => byId(buildEmbeddingCatalog({ hasVoyageKey: true, ...input }), 'voyage');

  test('offers the current suite, not just one model', () => {
    const ids = voy().models.map(m => m.id);
    for (const expected of ['voyage-4', 'voyage-4-large', 'voyage-4-lite',
                            'voyage-code-4', 'voyage-finance-2', 'voyage-law-2']) {
      assert.ok(ids.includes(expected), `${expected} should be offered`);
    }
  });

  test('the 4-series exposes the widths the LIVE API accepts', () => {
    // voyage-code-4 included: the API accepts 512 and 2048 for it even though the
    // prose docs' support list omits it (verified live 2026-08-31).
    for (const id of ['voyage-4', 'voyage-4-large', 'voyage-4-lite', 'voyage-code-4']) {
      const m = voy().models.find(x => x.id === id);
      assert.deepEqual(m.supportedDimensions, [256, 512, 1024, 2048], id);
      assert.equal(m.dimensions, 1024, `${id} defaults to 1024`);
    }
  });

  test('finance-2 and law-2 are FIXED at 1024 and offer no width choice', () => {
    // VERIFIED LIVE: both answer 400 — "Value '512' supplied for argument
    // 'output_dimension' is not valid" — so offering a choice would break a
    // working model, and SENDING the parameter at all breaks it.
    for (const id of ['voyage-finance-2', 'voyage-law-2']) {
      const m = voy().models.find(x => x.id === id);
      assert.equal(m.supportedDimensions, undefined, id);
      assert.equal(m.dimensions, 1024, id);
    }
  });

  test('shows nothing without a key, like the other cloud providers', () => {
    // Unlike OpenRouter, whose catalogue is public.
    assert.deepEqual(byId(buildEmbeddingCatalog({}), 'voyage').models, []);
  });

  test('a privacy block empties it', () => {
    assert.deepEqual(voy({ cloudBlocked: true }).models, []);
  });

  test('exactly one model is marked recommended', () => {
    assert.equal(voy().models.filter(m => m.recommended).length, 1);
  });
});

describe('Voyage catalogue matches what /v1/embeddings actually serves', () => {
  // The endpoint enumerates its own supported models in the 400 it returns for an
  // unknown one. Checked live 2026-08-31; anything absent there cannot be selected.
  const SERVED = new Set(['voyage-4-large', 'voyage-4', 'voyage-4-lite', 'voyage-code-4',
    'voyage-3', 'voyage-3-lite', 'voyage-finance-2', 'voyage-large-2-instruct', 'voyage-law-2',
    'voyage-code-2', 'voyage-02', 'voyage-2', 'voyage-01', 'voyage-lite-01',
    'voyage-lite-01-instruct', 'voyage-lite-02-instruct', 'voyage-code-3', 'voyage-3-large',
    'voyage-3-5', 'voyage-3-5-lite', 'voyage-code-3-5', 'voyage-multilingual-2',
    'voyage-large-2', 'voyage-3.5', 'voyage-3.5-lite', 'voyage-code-3.5']);

  test('every catalogued model is one the text endpoint serves', () => {
    for (const m of STATIC_EMBEDDING_MODELS.voyage) {
      assert.ok(SERVED.has(m.id), `${m.id} is not served by /v1/embeddings`);
    }
  });

  test('voyage-4-nano and voyage-multimodal-3.5 are NOT offered', () => {
    // nano is open-weights only; multimodal needs the separate multimodal
    // endpoint with a different input shape. Both 400 here, so listing either
    // would offer a model that cannot be selected.
    const ids = STATIC_EMBEDDING_MODELS.voyage.map(m => m.id);
    assert.ok(!ids.includes('voyage-4-nano'));
    assert.ok(!ids.includes('voyage-multimodal-3.5'));
  });
});
