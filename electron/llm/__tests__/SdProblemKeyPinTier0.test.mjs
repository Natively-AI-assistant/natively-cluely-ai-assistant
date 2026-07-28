// electron/llm/__tests__/SdProblemKeyPinTier0.test.mjs
//
// SPEC 12: clarifier text as problemQuestion changes key and wipes sheet;
// a stable scenario pin keeps designSheet across turns.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdProblemKeyPinTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const gate = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsGate.js')).href);
const live = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsLive.js')).href);

describe('SPEC 12 SD problemKey pin contract', () => {
  test('clarifier-as-problemQuestion changes key and drops prior designSheet', () => {
    const scenario = 'Design a URL shortener like Bitly.';
    const clarifier = 'How would you handle hot keys in Redis?';
    const key1 = live.normalizeSdProblemKey(scenario);
    const key2 = live.normalizeSdProblemKey(clarifier);
    assert.notEqual(key1, key2);

    const prior = gate.createEmptyRequirementsArtifact(key1);
    prior.designSheet = gate.createEmptySdDesignSheet(key1);
    prior.designSheet.committed = [
      {
        id: 'e1',
        section: 'entities',
        text: 'URL mapping',
        fillSource: 'speech',
        status: 'committed',
        updatedAt: 1,
      },
    ];
    prior.recentSdAnswers = gate.createEmptyRecentSdAnswers(key1);

    const prepared = { ...prior, problemKey: key2 };
    const merged = gate.mergeDeepDiveExtensionBeforeCheckpoint(prior, prepared);
    assert.equal(merged.problemKey, key2);
    assert.deepEqual(merged.designSheet.committed, []);
  });

  test('stable scenario pin keeps designSheet when clarifier is not the key', () => {
    const scenario = 'Design a URL shortener like Bitly.';
    const key = live.normalizeSdProblemKey(scenario);
    const prior = gate.createEmptyRequirementsArtifact(key);
    prior.designSheet = gate.createEmptySdDesignSheet(key);
    prior.designSheet.committed = [
      {
        id: 'e1',
        section: 'entities',
        text: 'URL mapping',
        fillSource: 'speech',
        status: 'committed',
        updatedAt: 1,
      },
    ];
    prior.recentSdAnswers = gate.createEmptyRecentSdAnswers(key);

    // Gate question stays the scenario pin even though the spoken clarifier changed.
    const prepared = { ...prior, problemKey: live.normalizeSdProblemKey(scenario) };
    const merged = gate.mergeDeepDiveExtensionBeforeCheckpoint(prior, prepared);
    assert.equal(merged.problemKey, key);
    assert.equal(merged.designSheet.committed.length, 1);
    assert.equal(merged.designSheet.committed[0].text, 'URL mapping');
  });
});
