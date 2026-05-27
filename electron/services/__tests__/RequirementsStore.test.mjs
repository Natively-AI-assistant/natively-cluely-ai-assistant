// RequirementsStore — accept, dismiss, dedup, archive on problem change
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadStore() {
  const storePath = path.resolve(__dirname, '../../../dist-electron/electron/services/requirements/RequirementsStore.js');
  const dedupPath = path.resolve(__dirname, '../../../dist-electron/electron/services/requirements/requirementDedup.js');
  const [storeMod, dedupMod] = await Promise.all([
    import(pathToFileURL(storePath).href),
    import(pathToFileURL(dedupPath).href),
  ]);
  return { RequirementsStore: storeMod.RequirementsStore, isDuplicateRequirement: dedupMod.isDuplicateRequirement };
}

describe('RequirementsStore', () => {
  test('addCandidates dedupes near-duplicate text', async () => {
    const { RequirementsStore } = await loadStore();
    const store = new RequirementsStore();
    const evidence = { speaker: 'interviewer', timestamp: Date.now() };

    const first = store.addCandidates(
      [{ text: 'Input array is sorted', quote: 'assume sorted', confidence: 0.9 }],
      evidence,
    );
    const second = store.addCandidates(
      [{ text: 'Input is sorted', quote: 'sorted input', confidence: 0.85 }],
      evidence,
    );

    assert.equal(first.length, 1);
    assert.equal(second.length, 0, 'near-duplicate should be rejected');
    assert.equal(store.getVisible().length, 1);
  });

  test('accept syncs to accepted status and getAcceptedTexts', async () => {
    const { RequirementsStore } = await loadStore();
    const store = new RequirementsStore();
    const [item] = store.addCandidates(
      [{ text: 'No duplicate values', quote: 'no duplicates', confidence: 0.8 }],
      { speaker: 'interviewer', timestamp: Date.now() },
    );
    const accepted = store.accept(item.id, 'Two Sum problem');
    assert.ok(accepted);
    assert.equal(accepted.status, 'accepted');
    assert.deepEqual(store.getAcceptedTexts(), ['No duplicate values']);
  });

  test('dismiss removes item from visible list', async () => {
    const { RequirementsStore } = await loadStore();
    const store = new RequirementsStore();
    const [item] = store.addCandidates(
      [{ text: 'O(n) time required', quote: 'linear time', confidence: 0.7 }],
      { speaker: 'interviewer', timestamp: Date.now() },
    );
    store.dismiss(item.id);
    assert.equal(store.getVisible().length, 0);
    assert.equal(store.getAcceptedTexts().length, 0);
  });

  test('archiveForProblemChange clears active items', async () => {
    const { RequirementsStore } = await loadStore();
    const store = new RequirementsStore();
    const [item] = store.addCandidates(
      [{ text: 'Millions of users', quote: 'millions of users', confidence: 0.9 }],
      { speaker: 'interviewer', timestamp: Date.now() },
    );
    store.accept(item.id, 'Design Twitter');
    store.archiveForProblemChange();
    assert.equal(store.getVisible().length, 0);
    assert.equal(store.getArchived().length, 1);
  });
});

describe('requirementDedup', () => {
  test('isDuplicateRequirement catches paraphrases', async () => {
    const { isDuplicateRequirement } = await loadStore();
    assert.ok(isDuplicateRequirement('Input array is sorted', 'input is sorted'));
    assert.ok(!isDuplicateRequirement('O(n) time', 'Millions of users'));
  });
});
