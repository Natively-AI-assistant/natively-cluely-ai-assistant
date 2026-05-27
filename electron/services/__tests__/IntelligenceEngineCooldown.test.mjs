// RC-A: IntelligenceEngine cooldown returns null on rapid double invoke.

import { test, describe } from 'node:test';
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

class StubLLMHelper {
  getActiveModel() { return { provider: 'gemini', model: 'gemini-3-flash' }; }
  isStreamingSupported() { return true; }
  setNegotiationCoachingHandler() {}
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

describe('IntelligenceEngine.runWhatShouldISay — cooldown (RC-A)', () => {
  test('second invoke within 3s returns null without skipCooldown or images', async () => {
    const { engine } = await makeEngine();
    const first = engine.runWhatShouldISay('first question');
    const second = await engine.runWhatShouldISay('second question');
    assert.equal(second, null, 'cooldown must suppress second invoke');
    await first;
  });

  test('skipCooldown bypasses cooldown gate', async () => {
    const { engine } = await makeEngine();
    void engine.runWhatShouldISay('first');
    const second = await engine.runWhatShouldISay('second', 0.8, undefined, { skipCooldown: true });
    assert.notEqual(second, null);
  });

  test('imagePaths bypasses cooldown gate', async () => {
    const { engine } = await makeEngine();
    void engine.runWhatShouldISay('first');
    const second = await engine.runWhatShouldISay('second', 0.8, ['/tmp/screenshot.png']);
    assert.notEqual(second, null);
  });
});
