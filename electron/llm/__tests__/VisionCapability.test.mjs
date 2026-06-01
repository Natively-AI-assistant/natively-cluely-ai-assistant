// electron/llm/__tests__/VisionCapability.test.mjs
//
// Tests the pure local-provider vision-capability detection:
//   • Ollama: authoritative /api/show capabilities + name-heuristic fallback
//   • Custom cURL provider: explicit flag > {{IMAGE_BASE64}} > OpenAI messages body
//
// Loads compiled JS from dist-electron like the other __tests__.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/visionCapability.js');
const {
  isOllamaVisionModelByName,
  ollamaVisionFromShow,
  resolveOllamaVision,
  customProviderSupportsVision,
  customProviderIsLocal,
} = await import(pathToFileURL(modPath).href);

describe('isOllamaVisionModelByName', () => {
  for (const m of ['llava:13b', 'llava-llama3', 'bakllava', 'moondream', 'llama3.2-vision',
                   'minicpm-v', 'qwen2.5-vl:7b', 'pixtral-12b', 'gemma3:4b', 'llama4:scout',
                   'granite3.2-vision', 'mistral-small3.1']) {
    test(`recognizes vision model: ${m}`, () => assert.equal(isOllamaVisionModelByName(m), true));
  }
  for (const m of ['llama3.3:70b', 'qwen2.5:7b', 'mistral:7b', 'phi3', 'deepseek-r1', '']) {
    test(`text-only model not flagged: ${m || '(empty)'}`, () => assert.equal(isOllamaVisionModelByName(m), false));
  }
});

describe('ollamaVisionFromShow', () => {
  test('capabilities containing "vision" → true', () => {
    assert.equal(ollamaVisionFromShow({ capabilities: ['completion', 'vision'] }), true);
  });
  test('capabilities without "vision" → false (authoritative)', () => {
    assert.equal(ollamaVisionFromShow({ capabilities: ['completion', 'tools'] }), false);
  });
  test('no capabilities array → null (defer to heuristic)', () => {
    assert.equal(ollamaVisionFromShow({ details: {} }), null);
    assert.equal(ollamaVisionFromShow(null), null);
  });
  test('case-insensitive match', () => {
    assert.equal(ollamaVisionFromShow({ capabilities: ['Vision'] }), true);
  });
});

describe('resolveOllamaVision', () => {
  test('authoritative true overrides a text-looking name', () => {
    assert.equal(resolveOllamaVision('my-custom-model', true), true);
  });
  test('authoritative false overrides a vision-looking name (renamed text model)', () => {
    assert.equal(resolveOllamaVision('llava-but-actually-text', false), false);
  });
  test('null probe falls back to name heuristic', () => {
    assert.equal(resolveOllamaVision('llava:13b', null), true);
    assert.equal(resolveOllamaVision('llama3.3:70b', null), false);
  });
});

describe('customProviderSupportsVision', () => {
  test('null / no curl → false', () => {
    assert.equal(customProviderSupportsVision(null), false);
    assert.equal(customProviderSupportsVision({ curlCommand: '' }), false);
  });

  test('explicit multimodal:true overrides everything', () => {
    assert.equal(customProviderSupportsVision({ curlCommand: 'curl https://x', multimodal: true }), true);
  });

  test('explicit multimodal:false overrides an OpenAI body', () => {
    const curl = `curl https://api.x/v1/chat -d '{"messages":[{"role":"user","content":"{{TEXT}}"}]}'`;
    assert.equal(customProviderSupportsVision({ curlCommand: curl, multimodal: false }), false);
  });

  test('{{IMAGE_BASE64}} placeholder → true', () => {
    const curl = `curl https://api.x -d '{"image":"{{IMAGE_BASE64}}","prompt":"{{TEXT}}"}'`;
    assert.equal(customProviderSupportsVision({ curlCommand: curl }), true);
  });

  test('{{ IMAGE_BASE64 }} with spaces → true', () => {
    const curl = `curl https://api.x -d '{"image":"{{ IMAGE_BASE64 }}"}'`;
    assert.equal(customProviderSupportsVision({ curlCommand: curl }), true);
  });

  test('OpenAI-compatible messages body → true (auto-inject path)', () => {
    const curl = `curl https://api.openai.com/v1/chat/completions -H 'Authorization: Bearer sk' -d '{"model":"gpt-4o","messages":[{"role":"user","content":"{{TEXT}}"}]}'`;
    assert.equal(customProviderSupportsVision({ curlCommand: curl }), true);
  });

  test('non-OpenAI body without image placeholder → false (would silently drop image)', () => {
    const curl = `curl https://api.x/generate -d '{"prompt":"{{TEXT}}","max_tokens":500}'`;
    assert.equal(customProviderSupportsVision({ curlCommand: curl }), false);
  });

  test('messages array but no role (not real OpenAI shape) → false', () => {
    const curl = `curl https://api.x -d '{"messages":["{{TEXT}}"]}'`;
    assert.equal(customProviderSupportsVision({ curlCommand: curl }), false);
  });

  test('system-only messages body → false (injectImageIntoMessages would drop the image)', () => {
    const curl = `curl https://api.x -d '{"messages":[{"role":"system","content":"You are helpful. {{TEXT}}"}]}'`;
    assert.equal(customProviderSupportsVision({ curlCommand: curl }), false);
  });

  test('messages with a user role → true', () => {
    const curl = `curl https://api.x -d '{"messages":[{"role":"system","content":"hi"},{"role":"user","content":"{{TEXT}}"}]}'`;
    assert.equal(customProviderSupportsVision({ curlCommand: curl }), true);
  });
});

describe('customProviderIsLocal', () => {
  test('explicit localOnly flag wins', () => {
    assert.equal(customProviderIsLocal({ curlCommand: 'curl https://api.openai.com', localOnly: true }), true);
    assert.equal(customProviderIsLocal({ curlCommand: 'curl http://127.0.0.1:1234', localOnly: false }), false);
  });
  test('loopback hosts → local', () => {
    assert.equal(customProviderIsLocal({ curlCommand: 'curl http://localhost:11434/v1/chat' }), true);
    assert.equal(customProviderIsLocal({ curlCommand: 'curl http://127.0.0.1:8080/x' }), true);
  });
  test('RFC-1918 private hosts → local', () => {
    assert.equal(customProviderIsLocal({ curlCommand: 'curl http://192.168.1.50:1234/v1' }), true);
    assert.equal(customProviderIsLocal({ curlCommand: 'curl http://10.0.0.5/api' }), true);
    assert.equal(customProviderIsLocal({ curlCommand: 'curl http://172.16.3.4/api' }), true);
    assert.equal(customProviderIsLocal({ curlCommand: 'curl http://172.40.3.4/api' }), false); // outside 16-31
  });
  test('public host → not local', () => {
    assert.equal(customProviderIsLocal({ curlCommand: 'curl https://api.openai.com/v1/chat' }), false);
  });
  test('no URL / null → false', () => {
    assert.equal(customProviderIsLocal(null), false);
    assert.equal(customProviderIsLocal({ curlCommand: 'echo hi' }), false);
  });
});
