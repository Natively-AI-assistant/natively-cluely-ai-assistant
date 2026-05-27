// RequirementsEngine — accept syncs constraints; disable clears store
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadModules() {
  const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
  const reqEnginePath = path.resolve(__dirname, '../../../dist-electron/electron/services/requirements/RequirementsEngine.js');
  const [sessionMod, reqMod] = await Promise.all([
    import(pathToFileURL(sessionPath).href),
    import(pathToFileURL(reqEnginePath).href),
  ]);
  return { SessionTracker: sessionMod.SessionTracker, RequirementsEngine: reqMod.RequirementsEngine };
}

/** Minimal stub — extractor is not invoked in these tests. */
function makeStubLlm() {
  return {
    fitContextForCurrentModel: (t) => t,
    streamChat: async function* () { yield '[]'; },
  };
}

describe('RequirementsEngine integration', () => {
  test('accept syncs to ActiveProblem.constraints', async () => {
    const { SessionTracker, RequirementsEngine } = await loadModules();
    const session = new SessionTracker();
    const engine = new RequirementsEngine(makeStubLlm(), session);
    engine.setEnabled(true);
    session.setCodingQuestion('Two Sum', 'transcript');

    engine.getStore().addCandidates(
      [{ text: 'Sorted input', quote: 'sorted', confidence: 0.9 }],
      { speaker: 'interviewer', timestamp: Date.now() },
    );
    const [item] = engine.getVisible();
    const accepted = engine.accept(item.id);
    assert.ok(accepted);
    assert.ok(session.getActiveProblem()?.constraints.includes('Sorted input'));
  });

  test('setEnabled(false) clears visible requirements', async () => {
    const { SessionTracker, RequirementsEngine } = await loadModules();
    const session = new SessionTracker();
    const engine = new RequirementsEngine(makeStubLlm(), session);
    engine.setEnabled(true);

    engine.getStore().addCandidates(
      [{ text: 'O(n) time', quote: 'linear', confidence: 0.8 }],
      { speaker: 'interviewer', timestamp: Date.now() },
    );
    assert.equal(engine.getVisible().length, 1);

    engine.setEnabled(false);
    assert.equal(engine.getVisible().length, 0);
  });

  test('problem change archives prior requirements', async () => {
    const { SessionTracker, RequirementsEngine } = await loadModules();
    const session = new SessionTracker();
    const engine = new RequirementsEngine(makeStubLlm(), session);
    engine.setEnabled(true);
    session.setCodingQuestion('Two Sum', 'transcript');
    engine.onFinalSegment({
      speaker: 'interviewer',
      text: 'two sum problem',
      timestamp: Date.now(),
      final: true,
    });

    engine.getStore().addCandidates(
      [{ text: 'No duplicates', quote: 'unique', confidence: 0.9 }],
      { speaker: 'interviewer', timestamp: Date.now() },
    );
    assert.equal(engine.getVisible().length, 1);

    session.setCodingQuestion('Three Sum', 'transcript');
    engine.onFinalSegment({
      speaker: 'interviewer',
      text: 'next question',
      timestamp: Date.now(),
      final: true,
    });

    assert.equal(engine.getVisible().length, 0);
    assert.ok(engine.getStore().getArchived().length >= 1);
  });
});
