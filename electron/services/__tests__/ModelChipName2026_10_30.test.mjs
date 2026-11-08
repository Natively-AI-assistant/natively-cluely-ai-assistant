// The overlay's model selector chip shows the model's own name, in every
// meeting style: no routing prefix, no provider, no slug punctuation (owner,
// 2026-10-30, on a chip reading "claude-haiku-5-5"). modelChipName is the one
// function the chip runs its label through; NativelyInterface is checked to
// call it so a new label branch cannot skip it.
//
// Run via: node --test electron/services/__tests__/ModelChipName2026_10_30.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
// pathToFileURL: a bare `C:\…` import throws on Windows.
const { modelChipName } = await import(pathToFileURL(path.join(root, 'src/utils/modelUtils.ts')).href);

describe('modelChipName', () => {
  test('a raw id becomes the model name', () => {
    assert.equal(modelChipName('claude-haiku-5-5'), 'Claude Haiku 5.5');
    assert.equal(modelChipName('claude-opus-5'), 'Claude Opus 5');
    assert.equal(modelChipName('gemini-3.6-flash'), 'Gemini 3.6 Flash');
    assert.equal(modelChipName('gpt-4o'), 'GPT 4o');
    assert.equal(modelChipName('gpt-5.4'), 'GPT 5.4');
    assert.equal(modelChipName('deepseek-v4-pro'), 'DeepSeek V4 Pro');
    assert.equal(modelChipName('qwen3-8b'), 'Qwen3 8B');
  });

  test('routing prefixes and the upstream segment go', () => {
    assert.equal(modelChipName('agentrouter/claude-haiku-5-5'), 'Claude Haiku 5.5');
    assert.equal(modelChipName('litellm/openai/gpt-4o'), 'GPT 4o');
    assert.equal(modelChipName('ninerouter/minimax/MiniMax-M3'), 'MiniMax M3');
    assert.equal(modelChipName('openrouter/anthropic/claude-sonnet-4-6'), 'Claude Sonnet 4.6');
    assert.equal(modelChipName('bedrock/anthropic.claude-v2'), 'Claude V2');
  });

  test('provider names go', () => {
    assert.equal(modelChipName('Groq Qwen 3.8'), 'Qwen 3.8');
    assert.equal(modelChipName('Groq GPT-OSS 120B'), 'GPT-OSS 120B');
    assert.equal(modelChipName('gemini-3-flash (Antigravity)'), 'Gemini 3 Flash');
    assert.equal(modelChipName('MiniMax-M3 (9Router)'), 'MiniMax M3');
  });

  test('snapshot dates, "latest" and "preview" go', () => {
    assert.equal(modelChipName('gemini-3-flash-preview'), 'Gemini 3 Flash');
    assert.equal(modelChipName('claude-3-5-sonnet-20241022'), 'Claude 3.5 Sonnet');
    assert.equal(modelChipName('gpt-4o-2024-08-06'), 'GPT 4o');
    assert.equal(modelChipName('mistral-large-latest'), 'Mistral Large');
  });

  test('an Ollama tag reads as a size', () => {
    assert.equal(modelChipName('llama3.2:3b'), 'Llama3.2 3B');
    assert.equal(modelChipName('qwen2.5-coder:7b'), 'Qwen2.5 Coder 7B');
  });

  test('names written for people keep their spelling', () => {
    for (const name of ['Natively API', 'Gemini 3.8 Flash', 'GPT-5.6 Luna', 'OpenAI Codex', 'DeepSeek V4.1 Flash', 'My Work Server']) {
      assert.equal(modelChipName(name), name);
    }
  });

  test('never returns empty', () => {
    assert.equal(modelChipName(''), '');
    assert.equal(modelChipName('///'), '///');
  });
});

describe('the overlay chip uses it', () => {
  test('NativelyInterface runs the chip label through modelChipName', () => {
    const src = fs.readFileSync(path.join(root, 'src/components/NativelyInterface.tsx'), 'utf8');
    assert.match(src, /<ModelSelectorLabel>[\s\S]{0,200}?\{modelChipName\(\(\(\) => \{/);
  });
});
