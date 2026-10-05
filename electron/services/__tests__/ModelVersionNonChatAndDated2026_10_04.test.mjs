// A user's model_versions.json (2026-10-04) had `latest` set to
// "gpt-4o-mini-tts-2025-12-15" for both the vision and the text OpenAI family.
// Two faults combined: any `gpt-` id was classified as a chat model, and the
// release date at the end of the id ("12-15") was parsed as version 12.15,
// which outranks gpt-5.4. Tiers 2 and 3 read `latest`, so the vision retry
// chain would have sent a chat request to a text-to-speech model.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mvm = await import(pathToFileURL(
  path.resolve(root, 'dist-electron/electron/services/ModelVersionManager.js')).href);

const { parseModelVersion, classifyModel, classifyTextModel, isNonChatModelId, reconcileFamilyEntry, compareVersions } = mvm;

describe('OpenAI release dates are not versions', () => {
  test('a dated id never outranks a dotted version', () => {
    const baseline = parseModelVersion('gpt-5.4');
    for (const id of ['gpt-4o-mini-tts-2025-12-15', 'gpt-4o-2024-08-06', 'gpt-4o-audio-preview-2024-12-17']) {
      const v = parseModelVersion(id);
      assert.ok(!v || compareVersions(v, baseline) < 0, `${id} must not parse above gpt-5.4, got ${JSON.stringify(v)}`);
    }
  });

  test('the date is dropped and the real version kept', () => {
    assert.deepEqual(
      { major: parseModelVersion('gpt-5-2025-08-07').major, minor: parseModelVersion('gpt-5-2025-08-07').minor },
      { major: 5, minor: 0 },
    );
    const dotted = parseModelVersion('gpt-5.4-2026-03-05');
    assert.deepEqual({ major: dotted.major, minor: dotted.minor }, { major: 5, minor: 4 });
  });

  test('undated ids parse as before', () => {
    const cases = { 'gpt-5.4': [5, 4], 'gemini-3.8-flash': [3, 8], 'claude-sonnet-4-6': [4, 6], 'claude-haiku-4-5-20251001': [4, 5] };
    for (const [id, [major, minor]] of Object.entries(cases)) {
      const v = parseModelVersion(id);
      assert.deepEqual([v.major, v.minor], [major, minor], id);
    }
  });
});

describe('non-chat ids are not chat models', () => {
  const NON_CHAT = [
    'gpt-4o-mini-tts-2025-12-15', 'gpt-4o-mini-tts', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe',
    'gpt-4o-realtime-preview', 'gpt-realtime', 'gpt-4o-audio-preview', 'gpt-audio', 'gpt-image-1',
    'gpt-4o-search-preview', 'gemini-2.5-flash-preview-tts', 'gemini-embedding-001',
  ];
  for (const id of NON_CHAT) {
    test(`${id} is rejected by both classifiers`, () => {
      assert.equal(isNonChatModelId(id), true);
      assert.equal(classifyModel(id), null);
      assert.equal(classifyTextModel(id), null);
    });
  }

  for (const id of ['gpt-5.4', 'gpt-5.4-mini', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'claude-sonnet-4-6', 'qwen/qwen3.8-27b']) {
    test(`${id} is still a chat model`, () => {
      assert.equal(isNonChatModelId(id), false);
      assert.notEqual(classifyTextModel(id), null);
    });
  }
});

describe('a saved state with a speech model as latest is repaired on load', () => {
  // The entry exactly as it was on disk.
  const savedEntry = () => ({
    baseline: 'gpt-5.4',
    tier1: 'gpt-5.4',
    latest: 'gpt-4o-mini-tts-2025-12-15',
    latestVersion: { major: 12, minor: 15, patch: 0, raw: 'gpt-4o-mini-tts-2025-12-15' },
    tier1Version: { major: 5, minor: 4, patch: 0, raw: 'gpt-5.4' },
    previousTier1: 'gpt-5.4',
    previousLatest: 'gpt-5.4',
  });

  test('latest falls back to tier1 and the stale stored version is ignored', () => {
    const entry = savedEntry();
    assert.equal(reconcileFamilyEntry(entry, 'gpt-5.4'), true);
    assert.equal(entry.latest, 'gpt-5.4');
    assert.deepEqual([entry.latestVersion.major, entry.latestVersion.minor], [5, 4]);
    assert.equal(entry.tier1, 'gpt-5.4');
  });

  test('the repair is idempotent', () => {
    const entry = savedEntry();
    reconcileFamilyEntry(entry, 'gpt-5.4');
    assert.equal(reconcileFamilyEntry(entry, 'gpt-5.4'), false);
  });

  test('a genuinely newer chat model as latest is left alone', () => {
    const entry = {
      baseline: 'gpt-5.4', tier1: 'gpt-5.4', latest: 'gpt-5.5',
      latestVersion: parseModelVersion('gpt-5.5'), tier1Version: parseModelVersion('gpt-5.4'),
      previousTier1: null, previousLatest: 'gpt-5.4',
    };
    assert.equal(reconcileFamilyEntry(entry, 'gpt-5.4'), false);
    assert.equal(entry.latest, 'gpt-5.5');
    assert.equal(entry.previousLatest, 'gpt-5.4');
  });
});
