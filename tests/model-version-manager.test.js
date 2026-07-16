const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

let currentUserData = os.tmpdir();
const originalModuleLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => currentUserData } };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

const modelManagerModule = require('../dist-electron/electron/services/ModelVersionManager.js');
Module._load = originalModuleLoad;

const {
  ModelFamily,
  ModelVersionManager,
  TextModelFamily,
  classifyModel,
  classifyTextModel,
  parseModelVersion,
} = modelManagerModule;

test('specialist provider models are never classified as interview generation models', () => {
  const unsupported = [
    'gpt-4o-mini-transcribe-2025-12-15',
    'gpt-4o-mini-tts',
    'gpt-4o-audio-preview',
    'gpt-4o-realtime-preview',
    'gpt-5-search-api',
    'gpt-image-1',
    'gpt-5-codex',
    'gpt-3.5-turbo-instruct',
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-flash-image',
    'meta-llama/llama-guard-4-12b',
  ];

  for (const modelId of unsupported) {
    assert.equal(classifyModel(modelId), null, `${modelId} entered the vision pool`);
    assert.equal(classifyTextModel(modelId), null, `${modelId} entered the text pool`);
  }

  assert.equal(classifyModel('gpt-5.4'), ModelFamily.OPENAI);
  assert.equal(classifyTextModel('gpt-5.4'), TextModelFamily.OPENAI);
  assert.equal(classifyModel('gemini-3.5-flash'), ModelFamily.GEMINI_FLASH);
  assert.equal(classifyTextModel('llama-3.3-70b-versatile'), TextModelFamily.GROQ);
});

test('dated model snapshots use the model version instead of the date', () => {
  assert.deepEqual(parseModelVersion('gpt-5-2025-08-07'), {
    major: 5,
    minor: 0,
    patch: 0,
    raw: 'gpt-5-2025-08-07',
  });
  assert.deepEqual(parseModelVersion('gpt-4.1-2025-04-14'), {
    major: 4,
    minor: 1,
    patch: 0,
    raw: 'gpt-4.1-2025-04-14',
  });
});

test('v3 persisted state self-repairs invalid fallback models on startup', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-model-state-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  currentUserData = tempDir;

  const poisonedModel = 'gpt-4o-mini-transcribe-2025-12-15';
  const poisonedVersion = { major: 12, minor: 15, patch: 0, raw: poisonedModel };
  const baselineVersion = { major: 5, minor: 4, patch: 0, raw: 'gpt-5.4' };
  const state = {
    schemaVersion: 3,
    lastDiscoveryTimestamp: Date.now(),
    discoveryFailureCounts: {},
    families: {
      openai: {
        baseline: 'gpt-5.4',
        tier1: 'gpt-5.4',
        latest: poisonedModel,
        latestVersion: poisonedVersion,
        tier1Version: baselineVersion,
        previousTier1: 'gpt-5.4',
        previousLatest: 'gpt-5.4',
      },
      text_openai: {
        baseline: 'gpt-5.4',
        tier1: 'gpt-5.4',
        latest: poisonedModel,
        latestVersion: poisonedVersion,
        tier1Version: baselineVersion,
        previousTier1: 'gpt-5.4',
        previousLatest: 'gpt-5.4',
      },
    },
  };
  const statePath = path.join(tempDir, 'model_versions.json');
  fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');

  const manager = new ModelVersionManager();
  assert.deepEqual(manager.getTieredModels(ModelFamily.OPENAI), {
    tier1: 'gpt-5.4',
    tier2: 'gpt-5.4',
    tier3: 'gpt-5.4',
  });
  assert.deepEqual(manager.getTextTieredModels(TextModelFamily.OPENAI), {
    tier1: 'gpt-5.4',
    tier2: 'gpt-5.4',
    tier3: 'gpt-5.4',
  });

  const repaired = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(repaired.schemaVersion, 4);
  assert.equal(repaired.families.openai.latest, 'gpt-5.4');
  assert.equal(repaired.families.text_openai.latest, 'gpt-5.4');
  assert.ok(repaired.families.gemini_flash, 'missing families should be restored');
  assert.ok(repaired.families.text_groq, 'missing text families should be restored');
});

test('current v4 state repairs generation tiers older than the baseline', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-model-state-v4-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  currentUserData = tempDir;

  const state = {
    schemaVersion: 4,
    lastDiscoveryTimestamp: Date.now(),
    discoveryFailureCounts: {},
    families: {
      openai: {
        baseline: 'gpt-5.4',
        tier1: 'gpt-5.4',
        latest: 'gpt-4.1',
        latestVersion: { major: 4, minor: 1, patch: 0, raw: 'gpt-4.1' },
        tier1Version: { major: 5, minor: 4, patch: 0, raw: 'gpt-5.4' },
        previousTier1: null,
        previousLatest: null,
      },
    },
  };
  const statePath = path.join(tempDir, 'model_versions.json');
  fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');

  const manager = new ModelVersionManager();
  assert.deepEqual(manager.getTieredModels(ModelFamily.OPENAI), {
    tier1: 'gpt-5.4',
    tier2: 'gpt-5.4',
    tier3: 'gpt-5.4',
  });
  const repaired = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(repaired.families.openai.latest, 'gpt-5.4');
});
