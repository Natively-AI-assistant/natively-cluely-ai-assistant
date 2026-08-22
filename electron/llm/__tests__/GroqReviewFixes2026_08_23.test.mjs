// electron/llm/__tests__/GroqReviewFixes2026_08_23.test.mjs
//
// Regressions for the code-review findings on the Groq model-retirement
// migration (2026-08-23). Root cause behind the worst three: the Groq-id
// knowledge existed as hand-synced copies (three routing predicates, four
// vision predicates, a retirement set in ModelVersionManager) that had
// already drifted. groqModels.ts is now the single authority.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = (p) => pathToFileURL(path.resolve(root, 'dist-electron/electron/', p)).href;
const src = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

const gm = await import(dist('llm/groqModels.js'));
const mvm = await import(dist('services/ModelVersionManager.js'));
const caps = await import(dist('llm/modelCapabilities.js'));

describe('FINDING 1: the picker\'s Groq-hosted OpenAI models route to Groq, never api.openai.com', () => {
  test('isGroqModelId claims openai/gpt-oss-*', () => {
    assert.equal(gm.isGroqModelId('openai/gpt-oss-120b'), true);
    assert.equal(gm.isGroqModelId('openai/gpt-oss-20b'), true);
  });

  test('LLMHelper.isOpenAiModel excludes Groq-hosted ids at the source (order-independent fix)', () => {
    const source = src('electron/LLMHelper.ts');
    assert.match(source, /private isOpenAiModel\(modelId: string\): boolean \{\s*\n[^}]*if \(this\.isGroqModel\(modelId\)\) return false;/,
      'the exclusion must live inside isOpenAiModel so every dispatch site is fixed at once');
  });

  test('LLMHelper.isGroqModel delegates to the shared predicate', () => {
    assert.match(src('electron/LLMHelper.ts'), /private isGroqModel\(modelId: string\): boolean \{[\s\S]{0,400}?isGroqModelId\(modelId\)/);
  });

  test('ipcHandlers uses the shared predicate (no third copy)', () => {
    const source = src('electron/ipcHandlers.ts');
    assert.match(source, /isGroqModelId: isKnownGroqModel/);
    assert.doesNotMatch(source, /const isKnownGroqModel = \(modelId: string\): boolean => \{/);
  });
});

describe('FINDING 2: a persisted RETIRED default is repaired even when a Groq key exists', () => {
  test('ipcHandlers gates the availability early-return on isRetiredModelId', () => {
    assert.match(src('electron/ipcHandlers.ts'),
      /if \(!_isRetiredGroqId\(defaultModel\) && modelAvailable\(defaultModel\)\) return null;/);
  });

  test('the historical auto-installed defaults are in the retired set', () => {
    assert.equal(gm.isRetiredModelId('llama-3.3-70b-versatile'), true);
    assert.equal(gm.isRetiredModelId('meta-llama/llama-4-scout-17b-16e-instruct'), true);
    assert.equal(gm.isRetiredModelId('qwen/qwen3.6-27b'), false);
  });
});

describe('FINDING 3: a deliberate picker choice is never treated as an auto-default', () => {
  test('CredentialsManager only auto-replaces ids the app itself auto-assigns', () => {
    const source = src('electron/services/CredentialsManager.ts');
    assert.match(source, /AUTO_ASSIGNED_MODEL_IDS = new Set/);
    assert.doesNotMatch(source, /current\.startsWith\('openai\/gpt-oss-'\)/,
      'gpt-oss ids are only ever user-chosen; replacing them discards a deliberate choice');
    // legacy auto-set ids must still be promoted off (both are retired)
    assert.match(source, /'llama-3\.3-70b-versatile',\s*\n\s*'meta-llama\/llama-4-scout-17b-16e-instruct',/);
  });
});

describe('FINDING 5: a retired `latest` ALONE triggers reconciliation', () => {
  test('healthy baseline + retired latest resets latest to the baseline', () => {
    const entry = {
      baseline: 'qwen/qwen3.6-27b', tier1: 'qwen/qwen3.6-27b',
      tier1Version: { major: 3, minor: 6 },
      latest: 'qwen/qwen3-32b', // retired 2026-07-17
      latestVersion: { major: 3, minor: 32 },
      previousTier1: null, previousLatest: null,
    };
    const changed = mvm.reconcileFamilyEntry(entry, 'qwen/qwen3.6-27b');
    assert.equal(changed, true, 'a retired latest must trigger the reset');
    assert.equal(entry.latest, 'qwen/qwen3.6-27b');
  });
});

describe('FINDING 7: the two vision predicates are the same predicate', () => {
  test('a text-only qwen never classifies into the VISION family', () => {
    assert.equal(mvm.classifyModel('qwen/qwen3-32b'), null);
    assert.equal(mvm.classifyModel('qwen-qwq-32b'), null);
  });
  test('the actual vision model still classifies (no lost discovery)', () => {
    assert.ok(mvm.classifyModel('qwen/qwen3.6-27b'));
  });
  test('modelCapabilities and groqModels share groqSupportsImages', () => {
    assert.equal(gm.groqSupportsImages('qwen/qwen3.6-27b'), true);
    assert.equal(gm.groqSupportsImages('qwen/qwen3-32b'), false);
    assert.match(src('electron/llm/modelCapabilities.ts'), /import \{ groqSupportsImages \} from '\.\/groqModels'/);
  });
});

describe('FINDINGS 6+10: model-gone handling notifies discovery and never re-sends to a dead model', () => {
  test('the known-gone memo round-trips', () => {
    gm._resetGroqGoneMemo();
    assert.equal(gm.isGroqModelKnownGone('qwen/qwen3.6-27b'), false);
    gm.markGroqModelGone('qwen/qwen3.6-27b');
    assert.equal(gm.isGroqModelKnownGone('qwen/qwen3.6-27b'), true);
    gm._resetGroqGoneMemo();
  });

  test('onModelError fires BEFORE the exhausted-ladder throw (off-ladder ids self-heal)', () => {
    const source = src('electron/LLMHelper.ts');
    const gone = source.indexOf('if (gone) {');
    const throwIdx = source.indexOf('if (!fallback) throw err;');
    assert.ok(gone > 0 && throwIdx > 0 && gone < throwIdx,
      'discovery notification must not be gated on a fallback existing');
  });

  test('a known-gone primary skips straight to the fallback rung', () => {
    assert.match(src('electron/LLMHelper.ts'), /isGroqModelKnownGone\(request\?\.model\)/);
  });
});

describe('FINDING (admission): discovery never admits a retired id', () => {
  test('findLatestInFamily consults isRetiredModelId', () => {
    assert.match(src('electron/services/ModelVersionManager.ts'),
      /if \(isRetiredModelId\(modelId\)\) continue;/);
  });
});

describe('FINDING 4: the e2e harness no longer defaults to a retired model', () => {
  test('groq-keypool EVAL_MODEL default is the live primary', () => {
    assert.match(src('tests/intelligence/e2e/groq-keypool.mjs'), /GROQ_EVAL_MODEL \|\| 'qwen\/qwen3\.6-27b'/);
    assert.doesNotMatch(src('tests/intelligence/e2e/groq-keypool.mjs'), /\|\| 'meta-llama\/llama-4-scout/);
  });
  test('finalize-results fallback label matches', () => {
    assert.doesNotMatch(src('tests/intelligence/e2e/finalize-results.mjs'), /llama-4-scout/);
  });
});

describe('single-authority invariants', () => {
  test('the retirement set lives in groqModels and ModelVersionManager imports it', () => {
    assert.ok(gm.RETIRED_MODEL_IDS.size >= 7);
    assert.match(src('electron/services/ModelVersionManager.ts'),
      /import \{ RETIRED_MODEL_IDS, isRetiredModelId, groqSupportsImages \} from '\.\.\/llm\/groqModels'/);
  });
});
