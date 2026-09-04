// electron/rag/__tests__/EmbeddingStatus.test.mjs
//
// Pure logic behind the Embedding settings panel: what the user is told is
// running, whether it should carry a "lightweight" indicator, and what to
// recommend instead.
//
// The indicator MUST key off the resolved provider's real embedding SPACE, not a
// model-name test. An Ollama user running nomic-embed-text is NOT on MiniLM, and
// a name heuristic that says otherwise would nag them about a problem they do not
// have — while a user genuinely on MiniLM through some other path would be missed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingStatus.js');
const {
  isLightweightSpace,
  describeEmbeddingProvider,
  recommendEmbeddingModels,
  shouldWarnAboutLightweightEmbeddings,
} = await import(pathToFileURL(modPath).href);

describe('isLightweightSpace', () => {
  test('the bundled MiniLM space is lightweight', () => {
    assert.equal(isLightweightSpace('local:xenova/all-minilm-l6-v2:384'), true);
  });

  test('an Ollama user on nomic-embed-text is NOT flagged', () => {
    // The whole point of keying on space: this user has a perfectly reasonable
    // 768-d local embedder and must not be nagged.
    assert.equal(isLightweightSpace('ollama:nomic-embed-text:768'), false);
  });

  test('a managed Natively space is not flagged', () => {
    assert.equal(isLightweightSpace('natively:gemini-embedding-2:768'), false);
  });

  test('an Ollama-hosted MiniLM IS flagged — the model is what matters, not the host', () => {
    assert.equal(isLightweightSpace('ollama:all-minilm:384'), true);
  });

  test('an unknown or missing space is not flagged, rather than guessed at', () => {
    // Never invent a warning from absent data.
    for (const s of [undefined, null, '', 'garbage']) {
      assert.equal(isLightweightSpace(s), false, `${String(s)} must not be flagged`);
    }
  });
});

describe('describeEmbeddingProvider', () => {
  test('reports the real model and width, not the configured intent', () => {
    const d = describeEmbeddingProvider({ name: 'ollama', model: 'qwen3-embedding:8b', dimensions: 4096, space: 'ollama:qwen3-embedding:8b:4096' });
    assert.equal(d.model, 'qwen3-embedding:8b');
    assert.equal(d.dimensions, 4096);
    assert.equal(d.lightweight, false);
  });

  test('classifies where the embedding actually happens', () => {
    assert.equal(describeEmbeddingProvider({ name: 'local', model: 'x', dimensions: 384, space: 'local:x:384' }).location, 'on-device');
    assert.equal(describeEmbeddingProvider({ name: 'ollama', model: 'x', dimensions: 768, space: 'ollama:x:768' }).location, 'on-device');
    assert.equal(describeEmbeddingProvider({ name: 'natively', model: 'x', dimensions: 768, space: 'natively:x:768' }).location, 'cloud');
    assert.equal(describeEmbeddingProvider({ name: 'openai', model: 'x', dimensions: 1536, space: 'openai:x:1536' }).location, 'cloud');
  });

  test('Ollama counts as on-device, so local-only mode reads honestly', () => {
    // "Local-only" must mean no external call — an Ollama embedder satisfies it.
    assert.equal(describeEmbeddingProvider({ name: 'ollama', model: 'm', dimensions: 768, space: 'ollama:m:768' }).location, 'on-device');
  });

  test('a null provider reports as unconfigured rather than throwing', () => {
    const d = describeEmbeddingProvider(null);
    assert.equal(d.configured, false);
  });
});

describe('shouldWarnAboutLightweightEmbeddings', () => {
  test('warns when a third-party generation provider is set while embeddings are MiniLM', () => {
    // The §5 scenario: the user configures OpenRouter for generation and
    // reasonably assumes it handles everything.
    assert.equal(shouldWarnAboutLightweightEmbeddings({
      embeddingSpace: 'local:xenova/all-minilm-l6-v2:384',
      generationProvider: 'openrouter',
    }), true);
  });

  test('does not warn when embeddings are already strong', () => {
    assert.equal(shouldWarnAboutLightweightEmbeddings({
      embeddingSpace: 'natively:gemini-embedding-2:768',
      generationProvider: 'openrouter',
    }), false);
  });

  test('does not warn when the user already acknowledged it', () => {
    // "Continue with MiniLM" must actually stick — an unstoppable warning is
    // worse than none.
    assert.equal(shouldWarnAboutLightweightEmbeddings({
      embeddingSpace: 'local:xenova/all-minilm-l6-v2:384',
      generationProvider: 'openrouter',
      acknowledged: true,
    }), false);
  });

  test('warns when ANY configured provider is third-party', () => {
    // There is no single "generation provider" setting — the app is key-based,
    // so the real question is whether the user configured any third-party AI
    // provider at all while embeddings stayed lightweight.
    assert.equal(shouldWarnAboutLightweightEmbeddings({
      embeddingSpace: 'local:xenova/all-minilm-l6-v2:384',
      generationProviders: ['ollama', 'anthropic'],
    }), true);
  });

  test('an all-local provider set does not warn', () => {
    assert.equal(shouldWarnAboutLightweightEmbeddings({
      embeddingSpace: 'local:xenova/all-minilm-l6-v2:384',
      generationProviders: ['ollama'],
    }), false);
  });

  test('no configured providers at all does not warn', () => {
    assert.equal(shouldWarnAboutLightweightEmbeddings({
      embeddingSpace: 'local:xenova/all-minilm-l6-v2:384',
      generationProviders: [],
    }), false);
  });

  test('does not warn on a pure local-only setup with no third-party provider', () => {
    // Someone deliberately running everything on-device with no cloud key is not
    // the confused-user case this warning exists for.
    assert.equal(shouldWarnAboutLightweightEmbeddings({
      embeddingSpace: 'local:xenova/all-minilm-l6-v2:384',
      generationProvider: 'ollama',
    }), false);
  });
});

describe('recommendEmbeddingModels', () => {
  const installed = [
    { name: 'all-minilm:latest', dimensionsHint: 384 },
    { name: 'qwen3-embedding:8b', dimensionsHint: 4096 },
    { name: 'nomic-embed-text', dimensionsHint: 768 },
  ];

  test('recommends from what is actually installed, never a hardcoded catalogue', () => {
    const recs = recommendEmbeddingModels(installed);
    for (const r of recs) {
      assert.ok(installed.some(m => m.name === r.name), `${r.name} is not installed`);
    }
  });

  test('prefers a higher-dimensional model for the code/project slot', () => {
    const best = recommendEmbeddingModels(installed).find(r => r.slot === 'quality');
    assert.equal(best.name, 'qwen3-embedding:8b');
  });

  test('offers the smallest installed model as the lightweight slot', () => {
    const light = recommendEmbeddingModels(installed).find(r => r.slot === 'lightweight');
    assert.equal(light.name, 'all-minilm:latest');
  });

  test('makes no claim about how much better one model is', () => {
    // Explicitly out of scope until measured on Natively's own workload.
    const recs = recommendEmbeddingModels(installed);
    for (const r of recs) {
      assert.doesNotMatch(JSON.stringify(r), /\d+\s*%|better than|outperforms/i);
    }
  });

  test('an empty install list yields no recommendations rather than invented ones', () => {
    assert.deepEqual(recommendEmbeddingModels([]), []);
  });

  test('a model with no known width is not promoted to the quality slot', () => {
    const recs = recommendEmbeddingModels([{ name: 'mystery', dimensionsHint: null }]);
    assert.equal(recs.find(r => r.slot === 'quality'), undefined);
  });
});
