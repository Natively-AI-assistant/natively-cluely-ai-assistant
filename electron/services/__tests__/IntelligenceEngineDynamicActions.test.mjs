// Phase 3 — verify the wiring between IntelligenceEngine.handleTranscript and
// DynamicActionEngine. Asserts that:
//   1. setDynamicActionContext binds session/mode and engine starts detecting.
//   2. final transcript emits dynamic_action_emitted with a real DynamicAction payload.
//   3. interim (non-final) transcript does NOT emit anything.
//   4. clearDynamicActionContext stops emissions.
//   5. switching session id resets the per-session store (no bleeding).
//   6. accept/dismiss API delegates correctly.
//
// We import compiled JS from dist-electron so the test exercises the same code
// path the Electron main process runs in production.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadIntelligenceEngine() {
  const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
  return import(pathToFileURL(enginePath).href);
}

async function loadSessionTracker() {
  const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
  return import(pathToFileURL(sessionPath).href);
}

// Minimal LLMHelper stub — engine touches getActiveModel, isStreamingSupported,
// and setNegotiationCoachingHandler in its constructor / initializeLLMs path.
// Other LLM methods are unused because we only invoke handleTranscript.
class StubLLMHelper {
  getActiveModel() { return { provider: 'gemini', model: 'gemini-3-flash' }; }
  isStreamingSupported() { return true; }
  setNegotiationCoachingHandler(_fn) { /* no-op for test */ }
  // Other methods that may be referenced during initializeLLMs():
  getGeminiClient() { return null; }
  getOpenAIClient() { return null; }
  getClaudeClient() { return null; }
  getGroqClient() { return null; }
  getOllamaClient() { return null; }
  getModesManager() { return { getActiveMode: () => null, getActiveModeSystemPromptSuffix: () => '' }; }
  getSettingsManager() { return { get: () => null, set: () => {} }; }
}

async function makeEngine() {
  const { IntelligenceEngine } = await loadIntelligenceEngine();
  const { SessionTracker } = await loadSessionTracker();
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(new StubLLMHelper(), session);
  return { engine, session };
}

describe('IntelligenceEngine — dynamic action wiring (Phase 3)', () => {
  test('handleTranscript emits dynamic_action_emitted for matching trigger pack', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));

    engine.setDynamicActionContext({
      sessionId: 'sess-1',
      modeId: 'mode-sales',
      modeTemplateType: 'sales', // matches SALES_TRIGGERS pack in DynamicActionDetector
    });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: 'Honestly, this product is too expensive for my team',
      timestamp: Date.now(),
      final: true,
    }, /* skipRefinementCheck */ true);

    assert.ok(emitted.length >= 1, `expected ≥1 emitted action, got ${emitted.length}`);
    const pricing = emitted.find(a => a.type === 'pricing_objection');
    assert.ok(pricing, 'expected a pricing_objection action');
    assert.equal(pricing.modeId, 'mode-sales');
    assert.equal(pricing.sessionId, 'sess-1');
    assert.equal(pricing.modeTemplateType, 'sales');
    assert.equal(pricing.status, 'candidate');
    assert.ok(Array.isArray(pricing.evidenceRefs) && pricing.evidenceRefs.length === 1);
    assert.equal(pricing.evidenceRefs[0].source, 'transcript');
  });

  test('non-final transcript does not emit dynamic actions', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (a) => emitted.push(a));
    engine.setDynamicActionContext({ sessionId: 's', modeId: 'm', modeTemplateType: 'sales' });
    engine.handleTranscript({
      speaker: 'interviewer',
      text: 'too expensive',
      timestamp: Date.now(),
      final: false,
    }, true);
    assert.equal(emitted.length, 0, 'interim transcripts must not emit dynamic actions');
  });

  test('without setDynamicActionContext nothing is emitted (safe default)', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (a) => emitted.push(a));
    engine.handleTranscript({
      speaker: 'interviewer',
      text: 'too expensive',
      timestamp: Date.now(),
      final: true,
    }, true);
    assert.equal(emitted.length, 0, 'engine must be a no-op until setDynamicActionContext is called');
  });

  test('clearDynamicActionContext stops further emissions', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (a) => emitted.push(a));
    engine.setDynamicActionContext({ sessionId: 's1', modeId: 'm', modeTemplateType: 'sales' });
    engine.handleTranscript({ speaker: 'interviewer', text: 'this is too expensive', timestamp: Date.now(), final: true }, true);
    const beforeClear = emitted.length;
    assert.ok(beforeClear >= 1);
    engine.clearDynamicActionContext();
    engine.handleTranscript({ speaker: 'interviewer', text: 'this is also too expensive', timestamp: Date.now(), final: true }, true);
    assert.equal(emitted.length, beforeClear, 'no new emissions after context cleared');
  });

  test('changing sessionId flushes per-session store (no cross-meeting bleed)', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (a) => emitted.push(a));

    engine.setDynamicActionContext({ sessionId: 's-A', modeId: 'm1', modeTemplateType: 'sales' });
    engine.handleTranscript({ speaker: 'interviewer', text: 'too expensive', timestamp: Date.now(), final: true }, true);
    const aCount = emitted.length;
    assert.ok(aCount >= 1, 'first session should emit');

    // Same trigger phrase in a fresh session must emit again — proving the
    // store was flushed (otherwise dedup would suppress it).
    engine.setDynamicActionContext({ sessionId: 's-B', modeId: 'm1', modeTemplateType: 'sales' });
    engine.handleTranscript({ speaker: 'interviewer', text: 'too expensive', timestamp: Date.now(), final: true }, true);
    assert.ok(emitted.length > aCount, 'second session must produce a fresh action even with identical phrase');
    const last = emitted[emitted.length - 1];
    assert.equal(last.sessionId, 's-B');
  });

  test('detect failure inside DynamicActionEngine never breaks transcript path', async () => {
    const { engine } = await makeEngine();
    // Inject a broken engine that throws on detectActions.
    engine._setDynamicActionEngineForTest({
      detectActions: () => { throw new Error('boom'); },
      acceptAction: () => null,
      dismissAction: () => {},
      getTopActions: () => [],
    });
    engine.setDynamicActionContext({ sessionId: 's', modeId: 'm', modeTemplateType: 'sales' });

    // Should not throw — the catch in handleTranscript is the safety net.
    assert.doesNotThrow(() => {
      engine.handleTranscript({ speaker: 'interviewer', text: 'too expensive', timestamp: Date.now(), final: true }, true);
    });
  });

  test('acceptDynamicAction / dismissDynamicAction delegate correctly', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (a) => emitted.push(a));
    engine.setDynamicActionContext({ sessionId: 's', modeId: 'm', modeTemplateType: 'sales' });
    engine.handleTranscript({ speaker: 'interviewer', text: 'too expensive', timestamp: Date.now(), final: true }, true);
    assert.ok(emitted.length >= 1);
    const action = emitted[0];

    // accept should return the action with status flipped to 'accepted'.
    // (The store keeps accepted actions visible until completed/dismissed —
    // the renderer can show a brief "running…" state on the accepted card.)
    const accepted = engine.acceptDynamicAction(action.id);
    assert.ok(accepted, 'acceptDynamicAction returns the action');
    assert.equal(accepted.id, action.id);
    const afterAccept = engine.getActiveDynamicActions().find(a => a.id === action.id);
    assert.ok(afterAccept, 'accepted action is still listed (renderer can show a "running" indicator)');
    assert.equal(afterAccept.status, 'accepted');

    // dismiss should remove from active list.
    engine.dismissDynamicAction(action.id);
    const afterDismiss = engine.getActiveDynamicActions().find(a => a.id === action.id);
    assert.equal(afterDismiss, undefined, 'dismissed action no longer in active list');

    // dismiss is a no-op for unknown id and must not throw.
    assert.doesNotThrow(() => engine.dismissDynamicAction('does-not-exist'));
  });

  test('acceptDynamicAction returns null when no engine bound', async () => {
    const { engine } = await makeEngine();
    assert.equal(engine.acceptDynamicAction('any'), null);
  });
});
