// Issue #272 — verify LLMHelper gates the live-negotiation coaching short-circuit
// by the active ModesManager template. The premium negotiation tracker fires on
// any interviewer utterance regardless of active mode, so without this gate a
// technical-interview / team-meet / lecture user can have their "what to answer"
// stream replaced by a salary-coaching card.
//
// We exercise the compiled JS in dist-electron so the test runs against the
// same code path the Electron main process loads. The setup:
//   1. Stub the `electron` module (LLMHelper -> ModelVersionManager depends on
//      `app.getPath('userData')` during construction).
//   2. Stub knowledgeOrchestrator so isKnowledgeMode() returns true and
//      processQuestion() returns a payload with liveNegotiationResponse.
//   3. Patch ModesManager.getInstance().getActiveMode to return a specific
//      template (same singleton-patching pattern used by ModesManager.test.mjs).
//   4. Drive both streamChat and chatWithGemini and observe whether the
//      negotiation coaching handler was called.
//
// Expected:
//   - For modes where coaching is contextually appropriate
//     (looking-for-work, sales, recruiting, general, no-active-mode):
//     handler IS invoked AND the function short-circuits (no provider call).
//   - For modes where coaching would clobber the answer
//     (technical-interview, team-meet, lecture):
//     handler is NOT invoked. The function falls through to normal LLM
//     dispatch which, with no providers configured, will throw — we catch
//     that and assert only on the handler-invocation flag.

import { test, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import Module from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

let isolatedDistDir = null;

// The default `npm run build:electron` produces a single esbuild bundle per
// entry point, which inlines ModesManager into LLMHelper. That makes the
// internal singleton unreachable from outside, so we cannot patch
// getActiveMode to drive the gate. To keep the test hermetic we compile a
// per-file CJS tree just for this test where LLMHelper still resolves
// ModesManager via Node's CJS cache.
const distDir = (() => {
  const bundledLLMHelper = path.resolve(repoRoot, 'dist-electron/electron/LLMHelper.js');
  const isBundled = fs.existsSync(bundledLLMHelper) &&
    fs.readFileSync(bundledLLMHelper, 'utf8').includes('init_ModesManager');
  if (!isBundled) return path.resolve(repoRoot, 'dist-electron');

  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'llmhelper-gate-dist-'));
  isolatedDistDir = target;
  fs.symlinkSync(
    path.join(repoRoot, 'node_modules'),
    path.join(target, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  // tsc exits non-zero on pre-existing type errors in unrelated test files,
  // but still emits JS for files that compile cleanly. We swallow the
  // non-zero status and verify post-hoc that LLMHelper.js was produced.
  try {
    execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch (_tscErr) {
    // expected — tsc returns 1 on type errors elsewhere
  }
  if (!fs.existsSync(path.join(target, 'electron/LLMHelper.js'))) {
    throw new Error('tsc emission failed — LLMHelper.js missing from isolated tree');
  }
  return target;
})();

const llmHelperPath = path.resolve(distDir, 'electron/LLMHelper.js');
const modesPath = path.resolve(distDir, 'electron/services/ModesManager.js');
const whatToAnswerPath = path.resolve(distDir, 'electron/llm/WhatToAnswerLLM.js');
const settingsPath = path.resolve(distDir, 'electron/services/SettingsManager.js');
const providerRouterPath = path.resolve(distDir, 'electron/llm/ProviderRouter.js');

const cjsRequire = createRequire(import.meta.url);

// --- Electron stub ----------------------------------------------------------
// LLMHelper transitively constructs ModelVersionManager which calls
// `electron.app.getPath('userData')`. We need a tmp dir that exists so the
// state-persistence loader doesn't ENOENT.
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'llmhelper-gate-test-'));
const electronStub = {
  app: {
    isReady: () => true,
    getPath: name => (name === 'userData' ? tmpUserData : os.tmpdir()),
    getName: () => 'natively-test',
    getVersion: () => '0.0.0-test',
  },
  shell: { openPath: async () => '' },
  ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
};

const electronStubModule = new Module('electron');
electronStubModule.exports = electronStub;
electronStubModule.loaded = true;
cjsRequire.cache.electron = electronStubModule;
try { cjsRequire.cache[cjsRequire.resolve('electron')] = electronStubModule; } catch { /* no on-disk electron in this env */ }

// Same singleton, both here and inside compiled LLMHelper's
// `require('./services/ModesManager')`, because Node's CJS cache keys by
// resolved path.
const { ModesManager } = cjsRequire(modesPath);
const { LLMHelper } = cjsRequire(llmHelperPath);
const { WhatToAnswerLLM } = cjsRequire(whatToAnswerPath);
const { DOCUMENT_GROUNDING_SCOPE_DENIED_MESSAGE } = cjsRequire(providerRouterPath);

const PAYLOAD_SENTINEL = { phase: 'gate-test', amount: '$0', tone: 'firm' };

function installActiveMode(templateType, modeName = templateType) {
  const manager = ModesManager.getInstance();
  const mode = templateType ? {
    id: `${templateType}-mode`,
    name: modeName,
    templateType,
    customContext: '',
    isActive: true,
    createdAt: '2026-05-26T00:00:00.000Z',
  } : null;
  manager.getActiveMode = () => mode;
  // Neutralize mode-context injection that runs AFTER the gate so the
  // streaming path doesn't try to retrieve real reference files.
  manager.getActiveModeSystemPromptSuffix = () => '';
  manager.buildRetrievedActiveModeContextBlock = () => '';
  manager.buildActiveModeContextBlock = () => '';
  manager.getActiveModeDocumentGroundingInfo = () => ({
    isCustom: Boolean(mode && mode.templateType === 'general' && mode.name !== 'General'),
    hasReferenceFiles: false,
    documentGrounded: false,
    modeId: mode?.id,
    modeName: mode?.name,
    hasCustomPrompt: false,
  });
}

function installCustomDocumentMode({ documentGrounded = true } = {}) {
  const manager = ModesManager.getInstance();
  const mode = {
    id: 'custom-seminar-mode',
    name: 'Seminar mode',
    templateType: 'general',
    customContext: 'Use only uploaded seminar files as the source of truth.',
    isActive: true,
    createdAt: '2026-05-26T00:00:00.000Z',
  };
  manager.getActiveMode = () => mode;
  manager.getActiveModeDocumentGroundingInfo = () => ({
    isCustom: true,
    hasReferenceFiles: true,
    documentGrounded,
    modeId: mode.id,
    modeName: mode.name,
    hasCustomPrompt: true,
    // Mirror ModesManager line ~922: documentGroundedCustomModeActive is computed
    // from (custom && hasCustomPrompt && documentGrounded && hasReferenceFiles).
    // Without this, all doc-grounded tests in this file silently skip the
    // mode-injection block (the stub returned a partial payload).
    documentGroundedCustomModeActive: documentGrounded,
  });
  manager.getActiveModeSystemPromptSuffix = () => 'GENERAL_MODE_SENTINEL';
  manager.getActiveModePinnedInstructions = () => 'PINNED_CUSTOM_MODE_SENTINEL';
  manager.buildRetrievedActiveModeContextBlock = (_query, _ctx, _budget, _answerType, _exclude, _pinned, options) => {
    return options?.forceDocumentGrounding ? 'REFERENCE_FILE_CONTEXT_SENTINEL' : '';
  };
  manager.buildRetrievedActiveModeContextBlockHybrid = async () => '';
  manager.buildActiveModeContextBlock = () => '';
}

function buildHelper() {
  // No API keys, no Ollama -> no provider client branches taken. The gate is
  // checked BEFORE any provider dispatch, so the early-return / fall-through
  // behavior is observable without making a network call.
  return new LLMHelper(undefined, false);
}

function buildOrchestratorStub(opts = {}) {
  const feedCalls = [];
  return {
    isKnowledgeMode: () => true,
    feedForDepthScoring: msg => feedCalls.push(msg),
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      liveNegotiationResponse: opts.payload ?? PAYLOAD_SENTINEL,
    }),
    feedCalls,
  };
}

async function drainStream(generator) {
  // We don't care about chunks — only whether processQuestion's payload was
  // forwarded to the negotiation handler before/instead of provider dispatch.
  // Provider dispatch with no clients will throw; swallow so the assertion
  // about handler invocation is what fails the test, not unconfigured deps.
  const chunks = [];
  try {
    for await (const chunk of generator) chunks.push(chunk);
  } catch (_err) {
    // expected when the gate blocks and we fall through to provider dispatch
  }
  return chunks;
}

async function callChat(helper, message) {
  try {
    return await helper.chatWithGemini(message, undefined, undefined, true);
  } catch (_err) {
    return null;
  }
}

after(() => {
  if (isolatedDistDir) {
    fs.rmSync(isolatedDistDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  installActiveMode(null);
});

test('streamChat: handler IS invoked when active mode allows coaching (looking-for-work)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('looking-for-work');
  const chunks = await drainStream(helper.streamChat('What salary should I ask for?'));

  assert.equal(captured.length, 1, 'handler must fire once for looking-for-work');
  assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  // Early-return — no normal stream tokens.
  assert.deepEqual(chunks, []);
});

test('streamChat: handler IS invoked when no active mode is set (default-open)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode(null);
  const chunks = await drainStream(helper.streamChat('Any salary thoughts?'));

  assert.equal(captured.length, 1, 'handler must fire when no mode is active');
  assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  assert.deepEqual(chunks, []);
});

test('streamChat: handler is NOT invoked when active mode is technical-interview (issue #272)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('technical-interview');
  await drainStream(helper.streamChat('Walk me through your last system design.'));

  assert.equal(
    captured.length,
    0,
    'technical-interview must NEVER receive a salary card mid-answer (issue #272)',
  );
});

test('streamChat: handler is NOT invoked for team-meet or lecture either', async () => {
  for (const templateType of ['team-meet', 'lecture']) {
    const helper = buildHelper();
    helper.setKnowledgeOrchestrator(buildOrchestratorStub());
    const captured = [];
    helper.setNegotiationCoachingHandler(payload => captured.push(payload));

    installActiveMode(templateType);
    await drainStream(helper.streamChat('any input?'));

    assert.equal(
      captured.length,
      0,
      `${templateType} must NOT trigger a salary-coaching card (issue #272)`,
    );
  }
});

test('streamChat: handler IS invoked for the remaining coaching-eligible modes', async () => {
  for (const templateType of ['sales', 'recruiting', 'general']) {
    const helper = buildHelper();
    helper.setKnowledgeOrchestrator(buildOrchestratorStub());
    const captured = [];
    helper.setNegotiationCoachingHandler(payload => captured.push(payload));

    installActiveMode(templateType);
    await drainStream(helper.streamChat('compensation discussion'));

    assert.equal(
      captured.length,
      1,
      `${templateType} should still allow coaching short-circuit`,
    );
    assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  }
});

// Symmetry check for the non-streaming path — same gate at LLMHelper.ts:~1354.
// Cheap to exercise: chatWithGemini's gate is structurally identical.
test('chatWithGemini: handler IS invoked when active mode allows coaching', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('looking-for-work');
  const result = await callChat(helper, 'What salary should I ask for?');

  assert.equal(captured.length, 1, 'chatWithGemini must fire handler for looking-for-work');
  assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  // chatWithGemini returns '' on the coaching short-circuit branch.
  assert.equal(result, '');
});

test('chatWithGemini: handler is NOT invoked when active mode is technical-interview', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('technical-interview');
  await callChat(helper, 'Explain consistent hashing.');

  assert.equal(
    captured.length,
    0,
    'technical-interview must block the coaching short-circuit on the non-streaming path too (issue #272)',
  );
});

// ---------------------------------------------------------------------------
// Broader gate coverage (issue #272 follow-up). The gate now suppresses the
// ENTIRE premium knowledge intercept — not just coaching — for templates where
// it is contextually wrong. This covers the two sibling vectors of the same
// bug class that the code-reviewer flagged: intro-question shortcut and
// premium prompt/context injection.
// ---------------------------------------------------------------------------

function buildIntroOrchestratorStub() {
  return {
    isKnowledgeMode: () => true,
    feedForDepthScoring: () => {},
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      isIntroQuestion: true,
      introResponse: 'CANNED_INTRO_RESPONSE_SENTINEL',
    }),
  };
}

function buildInjectionOrchestratorStub() {
  return {
    isKnowledgeMode: () => true,
    feedForDepthScoring: () => {},
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      systemPromptInjection: 'PREMIUM_PROMPT_SENTINEL',
      contextBlock: 'PREMIUM_CONTEXT_SENTINEL',
    }),
  };
}

test('streamChat: intro shortcut FIRES in looking-for-work mode (regression guard)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildIntroOrchestratorStub());

  installActiveMode('looking-for-work');
  const chunks = await drainStream(helper.streamChat('Tell me about yourself.'));

  assert.ok(
    chunks.includes('CANNED_INTRO_RESPONSE_SENTINEL'),
    'intro shortcut must still fire in modes where it is appropriate',
  );
});

// NOTE: These tests previously checked that the intro shortcut was SUPPRESSED in
// technical-interview / lecture modes (issue #272). That behaviour was revised:
// identity recall (isIntroQuestion + introResponse) now always passes through
// regardless of mode compatibility, because it is factual retrieval (candidate name,
// current role, years of experience), NOT persona injection. Suppressing it in any
// mode meant the user could never ask "what is my name?" in a technical interview.
// The mode gate still blocks negotiation coaching and premium context/prompt injection.
test('streamChat: intro shortcut PASSES THROUGH even in technical-interview mode', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildIntroOrchestratorStub());

  installActiveMode('technical-interview');
  const chunks = await drainStream(helper.streamChat('What is my name?'));

  assert.ok(
    chunks.includes('CANNED_INTRO_RESPONSE_SENTINEL'),
    'identity recall (intro shortcut) must fire even in technical-interview mode',
  );
});

test('chatWithGemini: intro shortcut PASSES THROUGH even in lecture mode', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildIntroOrchestratorStub());

  installActiveMode('lecture');
  const result = await callChat(helper, 'What is my name?');

  assert.strictEqual(
    result,
    'CANNED_INTRO_RESPONSE_SENTINEL',
    'identity recall (intro shortcut) must fire even in lecture mode',
  );
});

// Helper to wire a fake customProvider + spy on the dispatch so we can read
// the resolved (system, context) at the point streamChat/chatWithGemini hand
// off to a provider. This is what makes the prompt/context-injection tests
// falsifiable — without it the dispatch path throws on no-client before we
// can observe the resolved values, and the negative assertion passes
// vacuously whether the gate is in place or not.
function attachDispatchSpy(helper) {
  helper.customProvider = {
    id: 'spy-provider',
    name: 'spy',
    curlCommand: 'noop',
  };
  // Neutralize the provider-data-scope filter so the context the intercept
  // injected actually reaches the dispatch arg. Without this stub the
  // chatWithGemini path applies `shouldOmitContext ? "" : context` and the
  // sentinel gets stripped by an unrelated mechanism, making the assertion
  // unfalsifiable.
  helper.getDeniedOutboundScopes = () => [];
  const calls = [];
  // streamChat path → streamWithCustom (async generator yielding chunks)
  helper.streamWithCustom = async function* (message, context, _imagePaths, systemPrompt) {
    calls.push({ via: 'streamWithCustom', message, context: context || '', systemPrompt: systemPrompt || '' });
    yield '';
  };
  // chatWithGemini path → executeCustomProvider
  helper.executeCustomProvider = async function (_cmd, combinedMessage, systemPrompt, message, context, _img) {
    calls.push({ via: 'executeCustomProvider', message, context: context || '', systemPrompt: systemPrompt || '', combinedMessage: combinedMessage || '' });
    return 'spy-response';
  };
  return calls;
}

test('streamChat: custom CHAT_MODE_PROMPT still injects custom mode prompt and reference context', async () => {
  const helper = buildHelper();
  const calls = attachDispatchSpy(helper);

  installCustomDocumentMode({ documentGrounded: true });
  await drainStream(helper.streamChat(
    'What is the main topic?',
    undefined,
    'LOW_PRIORITY_PRIOR_CHAT_CONTEXT',
    cjsRequire(path.resolve(distDir, 'electron/llm/prompts.js')).CHAT_MODE_PROMPT,
    true,
    false,
    [],
    undefined,
    undefined,
    { answerType: 'unknown_answer' },
  ));

  const dispatched = calls.find(c => c.via === 'streamWithCustom');
  assert.ok(dispatched, 'streamWithCustom must be reached');
  assert.ok(
    dispatched.systemPrompt.includes('PINNED_CUSTOM_MODE_SENTINEL'),
    'custom mode pinned instructions must be injected even for CHAT_MODE_PROMPT + unknown_answer',
  );
  assert.ok(
    dispatched.systemPrompt.includes('supplemental behavioral layer for this mode'),
    'custom mode instructions must be elevated above default templates without overriding immutable safety rules',
  );
  assert.ok(
    dispatched.context.startsWith('REFERENCE_FILE_CONTEXT_SENTINEL'),
    `reference file context must outrank prior chat context; saw ${JSON.stringify(dispatched.context)}`,
  );
});

test('streamChat: document-grounded custom mode fails closed if reference-file scope is denied', async () => {
  const helper = buildHelper();
  helper.customProvider = { id: 'spy-provider', name: 'spy', curlCommand: 'noop' };
  helper.getDeniedOutboundScopes = () => ['reference_files'];

  installCustomDocumentMode({ documentGrounded: true });
  const chunks = await drainStream(helper.streamChat(
    'What is the main topic?',
    undefined,
    undefined,
    cjsRequire(path.resolve(distDir, 'electron/llm/prompts.js')).CHAT_MODE_PROMPT,
    true,
    false,
    [],
    undefined,
    undefined,
    { answerType: 'unknown_answer' },
  ));

  assert.equal(
    chunks.join(''),
    DOCUMENT_GROUNDING_SCOPE_DENIED_MESSAGE,
    'must not silently erase uploaded-file context and answer from general knowledge',
  );
});

test('WhatToAnswerLLM: document-grounded custom mode fails closed when reference-files scope is denied before provider dispatch', async () => {
  const { SettingsManager } = cjsRequire(settingsPath);
  const originalGetInstance = SettingsManager.getInstance;
  SettingsManager.getInstance = () => ({
    get: key => key === 'providerDataScopes' ? { reference_files: false } : undefined,
  });

  try {
    let streamChatCalled = false;
    const helper = {
      canUseLocalFallback: async () => false,
      getCapabilities: () => ({ outputBudgetTokens: 2000 }),
      getPromptTier: () => 'standard',
      fitContextForCurrentModel: text => text,
      thinkingBudgetForAnswerType: () => 0,
      streamChat: async function* () {
        streamChatCalled = true;
        yield 'SHOULD_NOT_REACH_PROVIDER';
      },
    };
    const modesManager = {
      getActiveModeDocumentGroundingInfo: () => ({
        isCustom: true,
        hasReferenceFiles: true,
        documentGrounded: true,
        modeId: 'custom-doc-mode',
        modeName: 'Custom doc mode',
        hasCustomPrompt: true,
      }),
      buildRetrievedActiveModeContextBlock: () => 'REFERENCE_FILE_CONTEXT_SENTINEL',
      getActiveModePinnedInstructions: () => '',
      getActiveModeSystemPromptSuffix: () => '',
    };

    const wta = new WhatToAnswerLLM(helper, modesManager);
    const chunks = await drainStream(wta.generateStream('What is the main topic?'));

    assert.equal(chunks.join(''), DOCUMENT_GROUNDING_SCOPE_DENIED_MESSAGE);
    assert.equal(streamChatCalled, false, 'WTA must not dispatch to LLMHelper after fail-closed denial');
  } finally {
    SettingsManager.getInstance = originalGetInstance;
  }
});

test('streamChat: denied reference-file scope scrubs retrieved blocks from message before cloud/custom dispatch', async () => {
  const helper = buildHelper();
  helper.customProvider = { id: 'spy-provider', name: 'spy', curlCommand: 'noop' };
  helper.getDeniedOutboundScopes = () => ['reference_files'];
  const calls = [];
  helper.streamWithCustom = async function* (message, context) {
    calls.push({ message, context: context || '' });
    yield 'ok';
  };

  installCustomDocumentMode({ documentGrounded: false });
  const chunks = await drainStream(helper.streamChat(
    '<active_mode_retrieved_context>REFERENCE_FILE_CONTEXT_SENTINEL</active_mode_retrieved_context>\n\nWhat is the main topic?',
    undefined,
    undefined,
    cjsRequire(path.resolve(distDir, 'electron/llm/prompts.js')).CHAT_MODE_PROMPT,
    true,
    true,
    [],
    undefined,
    undefined,
    { answerType: 'unknown_answer' },
  ));

  assert.deepEqual(chunks, ['ok']);
  assert.equal(calls.length, 1, 'custom dispatch must be reached with scrubbed payload');
  assert.doesNotMatch(calls[0].message, /REFERENCE_FILE_CONTEXT_SENTINEL|active_mode_retrieved_context/);
  assert.match(calls[0].message, /What is the main topic\?/);
});

test('streamChat: seeded General mode still skips CHAT_MODE_PROMPT mode injection for unknown answers', async () => {
  const helper = buildHelper();
  const calls = attachDispatchSpy(helper);

  installActiveMode('general', 'General');
  await drainStream(helper.streamChat(
    'What is the main topic?',
    undefined,
    undefined,
    cjsRequire(path.resolve(distDir, 'electron/llm/prompts.js')).CHAT_MODE_PROMPT,
    true,
    false,
    [],
    undefined,
    undefined,
    { answerType: 'unknown_answer' },
  ));

  const dispatched = calls.find(c => c.via === 'streamWithCustom');
  assert.ok(dispatched, 'streamWithCustom must be reached');
  assert.ok(
    !dispatched.systemPrompt.includes('PINNED_CUSTOM_MODE_SENTINEL'),
    'default General mode must remain neutral and not get custom-mode injection',
  );
});

test('streamChat: premium context block REACHES dispatch in looking-for-work (positive control)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('looking-for-work');
  await drainStream(helper.streamChat('Talk through your career story.'));

  const dispatched = calls.find(c => c.via === 'streamWithCustom');
  assert.ok(dispatched, 'streamWithCustom must be reached after the intercept');
  // The premium context block is prepended to the (initially empty) context by
  // the intercept body. Its presence at dispatch proves the intercept ran.
  assert.ok(
    dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    `looking-for-work must inject premium context at dispatch; saw context=${JSON.stringify(dispatched.context).slice(0, 200)}`,
  );
});

test('streamChat: premium context block is SUPPRESSED at dispatch in technical-interview (issue #272)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('technical-interview');
  await drainStream(helper.streamChat('Discuss CAP theorem.'));

  const dispatched = calls.find(c => c.via === 'streamWithCustom');
  assert.ok(dispatched, 'streamWithCustom must be reached after fall-through');
  // The gate must block the contextBlock injection — no sentinel can reach
  // the provider. This is the falsifiable assertion: removing the gate would
  // flip both substrings to true.
  assert.ok(
    !dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    `technical-interview must NOT inject premium context at dispatch (issue #272); saw context=${JSON.stringify(dispatched.context).slice(0, 200)}`,
  );
  assert.ok(
    !dispatched.systemPrompt.includes('PREMIUM_PROMPT_SENTINEL'),
    `technical-interview must NOT inject premium system prompt at dispatch; saw systemPrompt=${JSON.stringify(dispatched.systemPrompt).slice(0, 200)}`,
  );
});

// callChat in the rest of the file pins skipSystemPrompt=true, which is
// correct for the coaching/intro tests — those short-circuit BEFORE the
// systemPromptInjection block. For prompt/context-injection tests we need
// skipSystemPrompt=false so the injection block (gated on !skipSystemPrompt
// && knowledgeResult.systemPromptInjection in chatWithGemini) actually runs.
async function callChatWithSystem(helper, message) {
  try {
    return await helper.chatWithGemini(message, undefined, undefined, false);
  } catch (_err) {
    return null;
  }
}

test('chatWithGemini: premium context block is SUPPRESSED at dispatch in team-meet (issue #272)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('team-meet');
  const result = await callChatWithSystem(helper, 'Project status?');

  const dispatched = calls.find(c => c.via === 'executeCustomProvider');
  assert.ok(dispatched, 'executeCustomProvider must be reached after fall-through');
  assert.ok(
    !dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    'team-meet must NOT inject premium context at dispatch (issue #272 sibling)',
  );
  assert.ok(
    !dispatched.combinedMessage.includes('PREMIUM_PROMPT_SENTINEL'),
    'team-meet must NOT inject premium system prompt into the combined message',
  );
  // Sanity: the spy actually returned something rather than the function
  // erroring out before reaching dispatch.
  assert.equal(result, 'spy-response', 'dispatch must have produced the spy response');
});

test('chatWithGemini: premium context block REACHES dispatch in recruiting (positive control)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('recruiting');
  await callChatWithSystem(helper, 'How did the candidate respond?');

  const dispatched = calls.find(c => c.via === 'executeCustomProvider');
  assert.ok(dispatched, 'executeCustomProvider must be reached after the intercept');
  assert.ok(
    dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    `recruiting must inject premium context at dispatch; saw context=${JSON.stringify(dispatched.context).slice(0, 200)}`,
  );
});

test('streamChat: premium prompt injection STILL FIRES in looking-for-work (regression guard)', async () => {
  // We can't see the injected prompt directly (it goes into the next LLM call
  // which we don't reach). But the intercept's other gated behaviors firing
  // is sufficient proof — we already verified coaching fires for
  // looking-for-work. Inverse coverage: confirm the intercept body still
  // executes by stubbing processQuestion to ALSO emit coaching so we can
  // observe handler invocation as proof the body ran.
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator({
    isKnowledgeMode: () => true,
    feedForDepthScoring: () => {},
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      liveNegotiationResponse: PAYLOAD_SENTINEL,
      systemPromptInjection: 'PREMIUM_PROMPT_SENTINEL',
      contextBlock: 'PREMIUM_CONTEXT_SENTINEL',
    }),
  });
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('looking-for-work');
  await drainStream(helper.streamChat('compensation question'));

  assert.equal(
    captured.length,
    1,
    'intercept body must run in looking-for-work; coaching handler proves it',
  );
});

// ----------------------------------------------------------------
// chatWithGemini (non-streaming) mode-injection regression (2026-07-05)
// The non-streaming chatWithGemini path was silently dropping the active
// custom mode's voice + reference-file context + pinned instructions because
// the signature lacked routeOptions/skipModeInjection args AND the function
// body had no mode-injection block. This regression pins the new behavior
// for both doc-grounded and non-doc-grounded custom modes.
// See code-reviewer audit finding #1 (2026-07-04).

test('chatWithGemini: doc-grounded custom mode injects pinned instructions + reference context at dispatch', async () => {
  const helper = buildHelper();
  const calls = attachDispatchSpy(helper);

  installCustomDocumentMode({ documentGrounded: true });
  const result = await helper.chatWithGemini(
    'What is the main topic?',
    undefined,
    'LOW_PRIORITY_PRIOR_CHAT_CONTEXT',
    false,
    undefined,
    { answerType: 'lecture_answer' },
    false,
  );

  const dispatched = calls.find(c => c.via === 'executeCustomProvider');
  assert.ok(dispatched, 'executeCustomProvider must be reached');
  assert.ok(
    dispatched.systemPrompt.includes('PINNED_CUSTOM_MODE_SENTINEL'),
    `custom mode pinned instructions must be injected into chatWithGemini system prompt; saw ${JSON.stringify(dispatched.systemPrompt).slice(0, 200)}`,
  );
  assert.ok(
    dispatched.context.startsWith('REFERENCE_FILE_CONTEXT_SENTINEL'),
    `reference file context must outrank prior chat context; saw ${JSON.stringify(dispatched.context).slice(0, 200)}`,
  );
  assert.equal(result, 'spy-response', 'dispatch must have produced the spy response');
});

test('chatWithGemini: non-doc-grounded custom mode still injects pinned instructions (no doc-grounding dependency)', async () => {
  const helper = buildHelper();
  const calls = attachDispatchSpy(helper);

  installCustomDocumentMode({ documentGrounded: false });
  await helper.chatWithGemini(
    'Walk me through your approach.',
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
  );

  const dispatched = calls.find(c => c.via === 'executeCustomProvider');
  assert.ok(dispatched, 'executeCustomProvider must be reached');
  assert.ok(
    dispatched.systemPrompt.includes('PINNED_CUSTOM_MODE_SENTINEL'),
    `non-doc-grounded custom mode still gets pinned instructions; saw ${JSON.stringify(dispatched.systemPrompt).slice(0, 200)}`,
  );
});

test('chatWithGemini: skipModeInjection:true preserves legacy skip (no mode shaping reaches dispatch)', async () => {
  const helper = buildHelper();
  const calls = attachDispatchSpy(helper);

  installCustomDocumentMode({ documentGrounded: true });
  await helper.chatWithGemini(
    'What is the main topic?',
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    true,
  );

  const dispatched = calls.find(c => c.via === 'executeCustomProvider');
  assert.ok(dispatched, 'executeCustomProvider must be reached');
  assert.ok(
    !dispatched.systemPrompt.includes('PINNED_CUSTOM_MODE_SENTINEL'),
    `explicit skipModeInjection must suppress pinned instructions; saw ${JSON.stringify(dispatched.systemPrompt).slice(0, 200)}`,
  );
  assert.ok(
    !dispatched.context.includes('REFERENCE_FILE_CONTEXT_SENTINEL'),
    `explicit skipModeInjection must suppress reference-file context; saw ${JSON.stringify(dispatched.context).slice(0, 200)}`,
  );
});

test('chatWithGemini: legacy callers with no routeOptions + no skipModeInjection still work (backward compat)', async () => {
  const helper = buildHelper();
  const calls = attachDispatchSpy(helper);

  installActiveMode('technical-interview');
  const result = await helper.chatWithGemini(
    'Explain CAP theorem.',
    undefined,
    'PRIOR_CONTEXT',
    false,
    undefined,
  );

  const dispatched = calls.find(c => c.via === 'executeCustomProvider');
  assert.ok(dispatched, 'executeCustomProvider must be reached for legacy callers');
  assert.ok(
    !dispatched.systemPrompt.includes('PINNED_CUSTOM_MODE_SENTINEL'),
    'non-custom mode + no routeOptions → no custom mode shaping (legacy behavior)',
  );
  assert.equal(result, 'spy-response');
});
