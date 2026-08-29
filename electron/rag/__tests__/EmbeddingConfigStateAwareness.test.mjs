// electron/rag/__tests__/EmbeddingConfigStateAwareness.test.mjs
//
// Source-level regression tests for provider state-awareness in the embedding
// stack. The production bug was removal-sensitive: the old idempotency check
// only treated added credentials as an "improvement", so clearing a key kept the
// stale cloud embedding provider alive until restart.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function functionBlock(source, name) {
  const start = source.indexOf(name);
  assert.ok(start >= 0, `${name} must exist`);
  const next = source.indexOf('\n    private ', start + 1);
  return source.slice(start, next > start ? next : start + 1800);
}

function handlerBlock(source, handlerName) {
  const start = source.indexOf(`safeHandle('${handlerName}'`);
  assert.ok(start >= 0, `${handlerName} handler must exist`);
  const next = source.indexOf('safeHandle(', start + 1);
  return source.slice(start, next > start ? next : start + 2600);
}

describe('EmbeddingPipeline config state-awareness', () => {
  test('initialize() re-runs when provider config changes in either direction', () => {
    const source = read('electron/rag/EmbeddingPipeline.ts');
    assert.doesNotMatch(source, /_isConfigImprovement/, 'old add-only improvement check must not survive');
    assert.match(source, /_isConfigChanged\(this\._lastConfig, config\)/, 'initialize should use the removal-aware change detector');
  });

  test('_isConfigChanged compares removals, key-pool shrink, scopes, model dims, and explicit env policy', () => {
    const source = read('electron/rag/EmbeddingPipeline.ts');
    const block = functionBlock(source, 'private _isConfigChanged');
    for (const field of ['openaiKey', 'geminiKey', 'ollamaUrl', 'geminiEmbeddingModel']) {
      assert.match(block, new RegExp(`prev\\.${field}[^\n]+!==[^\n]+next\\.${field}`), `${field} must be compared symmetrically`);
    }
    assert.match(block, /normList\(prev\.geminiKeys\)\s*!==\s*normList\(next\.geminiKeys\)/, 'Gemini key-pool shrink/removal must reinitialize');
    assert.match(block, /providerDataScopes/, 'data-scope changes affect provider choice and must reinitialize');
    assert.match(block, /explicitKeyManagement/, 'Settings-managed key removal must not be masked by env fallback');
  });
});

describe('EmbeddingProviderResolver explicit key-management policy', () => {
  test('AppAPIConfig carries explicitKeyManagement and buildGeminiKeyPool skips env keys in that mode', () => {
    const source = read('electron/rag/EmbeddingProviderResolver.ts');
    assert.match(source, /explicitKeyManagement\?:\s*boolean/, 'AppAPIConfig should expose explicit Settings key-management mode');
    const block = source.slice(source.indexOf('static buildGeminiKeyPool'), source.indexOf('private static async probeAvailable'));
    assert.match(block, /if\s*\(!config\.explicitKeyManagement\)\s*\{[\s\S]*?process\.env\[name\]/, 'env Gemini keys must be folded in only outside explicit Settings mode');
  });

  test('Settings-triggered Gemini/OpenAI key handlers reinitialize embeddings without OR-ing removed keys with env vars', () => {
    const source = read('electron/ipcHandlers.ts');
    const gemini = handlerBlock(source, 'set-gemini-api-key');
    const openai = handlerBlock(source, 'set-openai-api-key');

    assert.match(gemini, /ragManager\.initializeEmbeddings\([\s\S]*explicitKeyManagement:\s*true/, 'Gemini Settings save/remove should use explicitKeyManagement');
    assert.match(openai, /ragManager\.initializeEmbeddings\([\s\S]*explicitKeyManagement:\s*true/, 'OpenAI Settings save/remove should use explicitKeyManagement');
    assert.match(gemini, /openaiKey:\s*cm\.getOpenaiApiKey\(\)\s*\|\|\s*undefined/, 'Gemini handler should use stored OpenAI key only');
    assert.match(gemini, /geminiKey:\s*apiKey\s*\|\|\s*undefined/, 'Gemini handler should pass the just-saved/cleared key only');
    assert.match(openai, /openaiKey:\s*apiKey\s*\|\|\s*undefined/, 'OpenAI handler should pass the just-saved/cleared key only');
    assert.match(openai, /geminiKey:\s*cm\.getGeminiApiKey\(\)\s*\|\|\s*undefined/, 'OpenAI handler should use stored Gemini key only');

    const initArgs = `${gemini}\n${openai}`;
    assert.doesNotMatch(initArgs, /process\.env\.(OPENAI_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY)/, 'Settings reinit must not resurrect removed UI keys from process.env');
  });

  // REWRITTEN 2026-08-30. This asserted three literal spellings —
  // `explicitKeyManagement?: boolean`, `explicitKeyManagement: config.…`,
  // `explicitKeyManagement: keys.…` — which pinned in place the very hand-listing
  // that was the bug. RAGManagerConfig re-declared six embedding fields by name
  // and the constructor re-listed the same six into `initialize()`, so anything
  // `buildEmbeddingConfig()` produces beyond those six was silently dropped on a
  // normal app start. A test that REQUIRED the hand-list could only hold that in
  // place.
  //
  // The property worth guarding is the opposite one: the config is forwarded
  // WHOLE, so no future field can be dropped by omission. That subsumes
  // explicitKeyManagement rather than weakening the guarantee.
  test('RAGManager forwards the WHOLE embedding config into EmbeddingPipeline.initialize()', () => {
    const source = read('electron/rag/RAGManager.ts');

    assert.match(source, /RAGManagerConfig extends Partial<AppAPIConfig>/,
      'the config must carry the pipeline TYPE, not a copy of some of its field names');
    assert.match(source, /this\.embeddingPipeline\.initialize\(embeddingConfig\)/,
      'the constructor must forward the rest-spread, not a hand-listed subset');
    assert.match(source, /const \{ db: _db, dbPath: _dbPath, extPath: _extPath, \.\.\.embeddingConfig \} = config/,
      'only RAGManager-owned fields may be withheld from the pipeline');
    assert.match(source, /initializeEmbeddings\(keys: AppAPIConfig\)/,
      'the second entry point must take the same type; a narrower one reads as though the rest were unsupported');

    assert.doesNotMatch(source, /explicitKeyManagement:\s*config\.explicitKeyManagement/,
      'hand-listing it again would reintroduce the drift this test now guards against');
  });
});
