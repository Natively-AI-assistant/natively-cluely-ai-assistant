// electron/llm/__tests__/OllamaGenerationModels2026_09_08.test.mjs
//
// An embedding model is not a chat model. Natively pulls `nomic-embed-text`
// itself on first launch for retrieval, and /api/tags lists it beside the chat
// models — so before this filter existed it appeared in every model picker and
// could be auto-selected as THE local model, failing only later at generation
// time with an opaque Ollama error.
//
// The rules under test are asymmetric on purpose:
//   reported capabilities are authoritative,
//   ABSENT capabilities mean keep (older daemons omit the field entirely, and
//   failing closed there would empty every picker).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/ollamaGenerationModels.js');
const {
  isGenerationCapable,
  filterOllamaGenerationModels,
  isOllamaGenerationModel,
  __resetOllamaCapabilityCache,
} = await import(pathToFileURL(modPath).href);

/** A daemon whose /api/show answers from a fixture, counting the calls it gets. */
function fakeDaemon(byModel, { fail = new Set(), notOk = new Set() } = {}) {
  const calls = [];
  const doFetch = async (url, init) => {
    const name = JSON.parse(init.body).model;
    calls.push(name);
    if (fail.has(name)) throw new Error('connection refused');
    if (notOk.has(name)) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => byModel[name] ?? {} };
  };
  return { doFetch, calls };
}

const CHAT = { capabilities: ['completion', 'tools'] };
const EMBED = { capabilities: ['embedding'] };
const VISION = { capabilities: ['completion', 'vision'] };

describe('isGenerationCapable', () => {
  test('a model that reports completion can generate', () => {
    assert.equal(isGenerationCapable(['completion', 'tools']), true);
  });

  test('an embedding-only model cannot', () => {
    assert.equal(isGenerationCapable(['embedding']), false);
  });

  test('absent capabilities are KEPT, never guessed at', () => {
    // An older daemon omits the field. Failing closed here empties the picker.
    for (const missing of [null, undefined, []]) {
      assert.equal(isGenerationCapable(missing), true, `${JSON.stringify(missing)} must be kept`);
    }
  });
});

describe('filterOllamaGenerationModels', () => {
  test('drops the embedder Natively pulled and keeps the chat models', async () => {
    __resetOllamaCapabilityCache();
    const { doFetch } = fakeDaemon({
      'nomic-embed-text:latest': EMBED,
      'qwen3:8b': CHAT,
      'llava:7b': VISION,
    });
    const kept = await filterOllamaGenerationModels(
      'http://127.0.0.1:11434',
      ['nomic-embed-text:latest', 'qwen3:8b', 'llava:7b'],
      doFetch,
    );
    assert.deepEqual(kept, ['qwen3:8b', 'llava:7b']);
  });

  test('input order is preserved — the caller auto-selects models[0]', async () => {
    // initializeOllamaModel() takes the first entry as THE local model, so a
    // filter that reorders would silently change which model is selected.
    __resetOllamaCapabilityCache();
    const { doFetch } = fakeDaemon({ a: CHAT, b: EMBED, c: CHAT, d: CHAT });
    assert.deepEqual(
      await filterOllamaGenerationModels('http://127.0.0.1:11434', ['a', 'b', 'c', 'd'], doFetch),
      ['a', 'c', 'd'],
    );
  });

  test('a name that merely LOOKS like an embedder is judged on its capabilities', async () => {
    // The trap that rules out name heuristics: qwen3-embedding and qwen3 share a
    // prefix, and all-minilm contains no "embed" at all.
    __resetOllamaCapabilityCache();
    const { doFetch } = fakeDaemon({
      'qwen3-embedding:8b': EMBED,
      'qwen3:30b': CHAT,
      'all-minilm:latest': EMBED,
      'embedded-fun:7b': CHAT,
    });
    assert.deepEqual(
      await filterOllamaGenerationModels(
        'http://127.0.0.1:11434',
        ['qwen3-embedding:8b', 'qwen3:30b', 'all-minilm:latest', 'embedded-fun:7b'],
        doFetch,
      ),
      ['qwen3:30b', 'embedded-fun:7b'],
    );
  });

  test('an unreachable or erroring probe keeps the model rather than hiding it', async () => {
    __resetOllamaCapabilityCache();
    const { doFetch } = fakeDaemon(
      { 'qwen3:8b': CHAT },
      { fail: new Set(['flaky:7b']), notOk: new Set(['gone:7b']) },
    );
    assert.deepEqual(
      await filterOllamaGenerationModels('http://127.0.0.1:11434', ['flaky:7b', 'gone:7b', 'qwen3:8b'], doFetch),
      ['flaky:7b', 'gone:7b', 'qwen3:8b'],
    );
  });

  test('a daemon with ONLY the bootstrapped embedder reports no generation models', async () => {
    // The state a fresh install lands in: Ollama is running and has exactly the
    // model Natively pulled for embeddings. "No models you can chat with" is the
    // honest answer; offering nomic-embed-text is not.
    __resetOllamaCapabilityCache();
    const { doFetch } = fakeDaemon({ 'nomic-embed-text:latest': EMBED });
    assert.deepEqual(
      await filterOllamaGenerationModels('http://127.0.0.1:11434', ['nomic-embed-text:latest'], doFetch),
      [],
    );
  });

  test('capabilities are probed once per model, not once per call', async () => {
    // This runs behind a panel refresh; re-probing every model on every open is
    // enough to stall a daemon that is also serving generation.
    __resetOllamaCapabilityCache();
    const { doFetch, calls } = fakeDaemon({ 'qwen3:8b': CHAT, 'nomic-embed-text:latest': EMBED });
    const names = ['qwen3:8b', 'nomic-embed-text:latest'];
    for (let i = 0; i < 3; i++) {
      await filterOllamaGenerationModels('http://127.0.0.1:11434', names, doFetch);
    }
    assert.deepEqual(calls.length, 2, `expected 2 probes, got ${calls.length}: ${calls.join(', ')}`);
  });

  test('a failed probe is NOT cached — the next call re-asks', async () => {
    __resetOllamaCapabilityCache();
    const { doFetch, calls } = fakeDaemon({}, { fail: new Set(['flaky:7b']) });
    await filterOllamaGenerationModels('http://127.0.0.1:11434', ['flaky:7b'], doFetch);
    await filterOllamaGenerationModels('http://127.0.0.1:11434', ['flaky:7b'], doFetch);
    assert.equal(calls.length, 2);
  });

  test('an empty list needs no daemon round-trip at all', async () => {
    __resetOllamaCapabilityCache();
    const { doFetch, calls } = fakeDaemon({});
    assert.deepEqual(await filterOllamaGenerationModels('http://127.0.0.1:11434', [], doFetch), []);
    assert.equal(calls.length, 0);
  });

  test('a trailing slash on the base URL does not become a double slash', async () => {
    __resetOllamaCapabilityCache();
    const seen = [];
    const doFetch = async (url, init) => {
      seen.push(url);
      return { ok: true, json: async () => ({ capabilities: JSON.parse(init.body).model === 'e' ? ['embedding'] : ['completion'] }) };
    };
    await filterOllamaGenerationModels('http://127.0.0.1:11434/', ['g'], doFetch);
    assert.deepEqual(seen, ['http://127.0.0.1:11434/api/show']);
  });
});

describe('the whole-call budget', () => {
  test('a hung daemon does not hold the caller past the budget, and keeps its models', async () => {
    // checkOllamaAvailable() runs this during a turn. Per-request timeouts alone
    // leave 40 models x 5s / 4 concurrent = 50s of worst case; the budget bounds
    // it, and unprobed models are KEPT (same fail-open direction as everywhere
    // else here).
    __resetOllamaCapabilityCache();
    const names = Array.from({ length: 12 }, (_, i) => `m${i}`);
    const doFetch = async () => {
      await new Promise(r => setTimeout(r, 40));
      return { ok: true, json: async () => ({ capabilities: ['embedding'] }) };
    };
    const started = Date.now();
    const kept = await filterOllamaGenerationModels('http://127.0.0.1:11434', names, doFetch, 60);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 400, `expected the budget to cut this short, took ${elapsed}ms`);
    assert.ok(kept.length > 0, 'models past the budget must be kept, not dropped');
  });

  test('an exhausted budget still answers from cache rather than guessing', async () => {
    __resetOllamaCapabilityCache();
    const { doFetch } = fakeDaemon({ 'nomic-embed-text:latest': EMBED, 'qwen3:8b': CHAT });
    const names = ['nomic-embed-text:latest', 'qwen3:8b'];
    await filterOllamaGenerationModels('http://127.0.0.1:11434', names, doFetch);
    // Budget 0: no new probe may run, but both answers are already cached.
    assert.deepEqual(
      await filterOllamaGenerationModels('http://127.0.0.1:11434', names, doFetch, 0),
      ['qwen3:8b'],
    );
  });
});

describe('isOllamaGenerationModel', () => {
  test('answers for one model without probing the rest', async () => {
    __resetOllamaCapabilityCache();
    const { doFetch, calls } = fakeDaemon({ 'nomic-embed-text:latest': EMBED, 'qwen3:8b': CHAT });
    assert.equal(await isOllamaGenerationModel('http://127.0.0.1:11434', 'nomic-embed-text:latest', doFetch), false);
    assert.equal(await isOllamaGenerationModel('http://127.0.0.1:11434/', 'qwen3:8b', doFetch), true);
    assert.deepEqual(calls, ['nomic-embed-text:latest', 'qwen3:8b']);
  });
});
