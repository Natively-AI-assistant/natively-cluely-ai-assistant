import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modesPath = path.resolve(__dirname, '../../../dist-electron/electron/services/ModesManager.js');
const compilerPath = path.resolve(__dirname, '../../../dist-electron/electron/services/meeting/SectionPromptCompiler.js');

const modesMod = await import(pathToFileURL(modesPath).href);
const compilerMod = await import(pathToFileURL(compilerPath).href);

const { ModesManager } = modesMod;
const { SectionPromptCompiler, deterministicSectionInstruction } = compilerMod;

test('ModesManager.compileAllSectionsAsync short-circuits when no provider is configured', async () => {
  let compileCalls = 0;
  let generateMeetingSummaryCalls = 0;

  const mockLlmHelper = {
    hasAnyConfiguredProvider() {
      return false;
    },
    async generateMeetingSummary() {
      generateMeetingSummaryCalls++;
      return '';
    },
  };

  ModesManager.setLlmHelperForCompiler(mockLlmHelper);

  const manager = ModesManager.getInstance();
  // Override getNoteSections to return sections needing compilation
  manager.getNoteSections = () => [
    { id: 's1', modeId: 'm1', title: 'Action Items', description: 'Next steps', compiledPrompt: '' },
    { id: 's2', modeId: 'm1', title: 'Key Decisions', description: 'Agreed points', compiledPrompt: '' },
  ];

  manager.compileAllSectionsAsync('m1');

  // Allow any microtasks / ticks to run
  await new Promise(r => setTimeout(r, 50));

  assert.equal(generateMeetingSummaryCalls, 0, 'Should not have called generateMeetingSummary when no provider configured');
});

test('ModesManager.addNoteSection short-circuits compilation when no provider is configured', async () => {
  let generateMeetingSummaryCalls = 0;

  const mockLlmHelper = {
    hasAnyConfiguredProvider() {
      return false;
    },
    async generateMeetingSummary() {
      generateMeetingSummaryCalls++;
      return '';
    },
  };

  ModesManager.setLlmHelperForCompiler(mockLlmHelper);

  const manager = ModesManager.getInstance();
  manager.addNoteSection({
    modeId: 'm1',
    title: 'Action Items',
    description: 'Next steps',
  });

  await new Promise(r => setTimeout(r, 50));

  assert.equal(generateMeetingSummaryCalls, 0, 'Should not have called generateMeetingSummary for single section when no provider configured');
});

test('SectionPromptCompiler falls back immediately to deterministic instruction when no provider is configured', async () => {
  let generateMeetingSummaryCalls = 0;

  const mockLlmHelper = {
    hasAnyConfiguredProvider() {
      return false;
    },
    async generateMeetingSummary() {
      generateMeetingSummaryCalls++;
      return '';
    },
  };

  const compiler = new SectionPromptCompiler(mockLlmHelper);
  const result = await compiler.compile({
    sectionTitle: 'Key Takeaways',
    sectionDescription: 'Main points discussed',
    meetingMode: 'general',
  });

  assert.equal(generateMeetingSummaryCalls, 0, 'generateMeetingSummary must not be called when hasAnyConfiguredProvider is false');
  assert.equal(result.compiled, false);
  assert.equal(result.instruction, deterministicSectionInstruction({
    sectionTitle: 'Key Takeaways',
    sectionDescription: 'Main points discussed',
    meetingMode: 'general',
  }));
});

test('LLMHelper.prototype.hasAnyConfiguredProvider reports availability accurately', async () => {
  const llmPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');
  const { LLMHelper } = await import(pathToFileURL(llmPath).href);

  const helper = Object.create(LLMHelper.prototype);
  // Default prototype state: no clients, no providers
  helper._client = null;
  helper._openaiClient = null;
  helper._claudeClient = null;
  helper._groqClient = null;
  helper._deepseekClient = null;
  helper._nvidiaNimClient = null;
  helper._openrouterClient = null;
  helper._litellmClient = null;
  helper._ninerouterClient = null;
  helper.hasFluxionCredential = () => false;
  helper.hasNatively = () => false;
  helper.isCodexAvailable = () => false;
  helper.antigravityFallbackModel = () => null;
  helper.useOllama = false;
  helper.customProvider = null;
  helper.activeCurlProvider = null;
  helper.isProviderDisabled = () => false;

  assert.equal(helper.hasAnyConfiguredProvider(), false, 'Expected false when no providers configured');

  // When any provider is set, it reports true
  helper._client = {};
  assert.equal(helper.hasAnyConfiguredProvider(), true, 'Expected true when gemini client is set');

  helper._client = null;
  helper.hasNatively = () => true;
  assert.equal(helper.hasAnyConfiguredProvider(), true, 'Expected true when Natively is configured');
});

test('LLMHelper.generateMeetingSummary skips Gemini cascade without retries when client is not initialized', async () => {
  const llmPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');
  const { LLMHelper } = await import(pathToFileURL(llmPath).href);

  const helper = Object.create(LLMHelper.prototype);
  helper._client = null;
  helper.isProviderDisabled = () => false;
  helper.getProviderScopePolicy = () => ({});
  helper.logScopeFallback = () => {};
  helper.hasNatively = () => false;
  helper.isCodexAvailable = () => false;
  helper.antigravityFallbackModel = () => null;
  helper.customProvider = null;
  helper.activeCurlProvider = null;
  helper._groqClient = null;
  helper.useOllama = false;

  let generateContentCalls = 0;
  let generateWithFlashCalls = 0;
  helper.generateContent = async () => {
    generateContentCalls++;
    throw new Error('Gemini client not initialized');
  };
  helper.generateWithFlash = async () => {
    generateWithFlashCalls++;
    throw new Error('Gemini client not initialized');
  };

  const start = Date.now();
  await assert.rejects(
    async () => helper.generateMeetingSummary('system prompt', 'some transcript context'),
    /Failed to generate summary after all fallback attempts/
  );
  const elapsed = Date.now() - start;

  assert.equal(generateContentCalls, 0, 'Should not have called generateContent (Flash-Lite) when client is not initialized');
  assert.equal(generateWithFlashCalls, 0, 'Should not have called generateWithFlash when client is not initialized');
  assert.ok(elapsed < 1000, `Expected fast return without retry backoff delays, took ${elapsed}ms`);
});


