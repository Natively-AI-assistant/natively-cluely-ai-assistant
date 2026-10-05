/**
 * The name list, corrected and consolidated (2026-10-01).
 *
 * Measured: OpenAI's o1, o1-pro, o3, o4-mini and gpt-4-turbo read images (OpenAI
 * model pages; OpenRouter input_modalities for o3-pro, o4-mini-high and
 * gpt-4-turbo), and Natively called every one of them text-only. Bare `o1` and
 * `o3` were not even recognised as cloud models. Two Ollama lists had drifted:
 * the one getModelCapabilities used lacked llama4, qwen3-vl, granite3.2-vision
 * and mistral-small3.1, and neither matched Ollama's own `qwen2.5vl` spelling.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { getModelCapabilities } = require(dist('llm/modelCapabilities.js'));
const { isOllamaVisionModelByName } = require(dist('llm/visionCapability.js'));

const reads = (id, ollama = false) => getModelCapabilities(id, ollama).supportsImages;

describe('OpenAI models that read images', () => {
  for (const id of ['o1', 'o1-2024-12-17', 'o1-pro', 'o1-pro-2025-03-19', 'o3', 'o3-2025-04-16', 'o3-pro',
    'o4-mini', 'o4-mini-2025-04-16', 'gpt-4-turbo', 'gpt-4-turbo-2024-04-09', 'O3']) {
    test(id, () => assert.equal(reads(id), true));
  }
  for (const id of ['o1-mini', 'o1-preview', 'o3-mini', 'o3-mini-2025-01-31', 'o3-deep-research',
    'gpt-4', 'gpt-4-0613', 'gpt-4-turbo-preview', 'gpt-3.5-turbo', 'chatgpt-4o-latest', 'gpt-4.5-preview']) {
    test(`${id} is not claimed`, () => assert.equal(reads(id), false));
  }
  test('through gateways, the same answers', () => {
    assert.equal(reads('openrouter/openai/o3'), true);
    assert.equal(reads('openrouter/openai/o4-mini-high'), true);
    assert.equal(reads('litellm/openai/o4-mini'), true);
    assert.equal(reads('agentrouter/o3'), true);
    assert.equal(reads('openrouter/openai/o3-mini'), false);
  });
});

describe("Gemini ids in the API's own `models/` form", () => {
  for (const id of ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro']) {
    test(id, () => assert.equal(reads(`models/${id}`), reads(id)));
  }
  test('and they read images', () => assert.equal(reads('models/gemini-2.5-flash'), true));
});

describe('one Ollama list', () => {
  for (const tag of ['qwen2.5vl:7b', 'qwen2.5vl', 'qwen2.5-vl:7b', 'qwen3-vl:8b', 'qwen2-vl', 'llama4:scout',
    'granite3.2-vision', 'mistral-small3.1:24b', 'llava:13b', 'gemma3:4b', 'minicpm-v:8b',
    'hf.co/Qwen/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M']) {
    test(`${tag} reads images`, () => assert.equal(reads(tag, true), true));
  }
  for (const tag of ['llama3.1:8b', 'qwen2.5-coder:7b', 'qwen3:8b', 'deepseek-r1:8b', 'phi4', 'mistral:7b', 'gpt-oss:20b', 'codellama:13b']) {
    test(`${tag} is not claimed`, () => assert.equal(reads(tag, true), false));
  }
  test('getModelCapabilities and the shared predicate agree on every tag', () => {
    for (const tag of ['qwen2.5vl:7b', 'llama4:scout', 'granite3.2-vision', 'llama3.1:8b', 'gemma3:4b', 'phi4']) {
      assert.equal(reads(tag, true), isOllamaVisionModelByName(tag), tag);
    }
  });
});
