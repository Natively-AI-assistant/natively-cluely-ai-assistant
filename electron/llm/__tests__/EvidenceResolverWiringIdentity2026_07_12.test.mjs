// electron/llm/__tests__/EvidenceResolverWiringIdentity2026_07_12.test.mjs
//
// Evidence-execution-repair (2026-07-11/12) — regression guard for the exact
// class of defect that happened on THIS branch: commit a5243292 ("fix
// (provider-state): senior-review follow-ups") silently DELETED the
// EvidenceResolver wiring inside LLMHelper.ts's _streamChatInner (its own
// commit message never mentioned removing anything context-os related — it
// was caught only by a manual diff read during an independent code-review
// pass, days after the fact). A subsequent commit (9b7f84d, "Revert ...")
// restored it.
//
// This test drives the REAL, compiled LLMHelper.streamChat() (not a
// source-grep) with a fake EvidenceResolver + fake ModesManager, and asserts
// the observable CONTRACT the repair promises for a Context-OS-governed,
// document-grounded turn:
//
//   1. EvidenceResolver.resolve() is called EXACTLY ONCE.
//   2. The legacy hybrid/lexical retrieval path (ModesManager.
//      buildRetrievedActiveModeContextBlockHybrid /
//      buildRetrievedActiveModeContextBlock) is NEVER called for a governed
//      turn — retrieval happens through the resolver alone.
//   3. The pack object written onto routeOptions.contextOsGeneration.
//      evidencePack is the SAME OBJECT (identity, not deep-equal) the
//      resolver returned — nothing downstream silently reconstructs a second,
//      divergent pack for the same turn.
//   4. When Context-OS does NOT govern the turn (flag off), the legacy
//      retrieval path DOES run and EvidenceResolver.resolve() is never
//      called — proving the un-governed case is unaffected.
//
// Any regression that deletes the wiring (like a524329 did) makes assertions
// 1-3 fail immediately: the resolver spy count drops to 0, the legacy-path
// spy fires instead, and evidencePack stays the pre-seeded `null`.
//
// Requires: npm run build:electron (uses an ISOLATED per-file tsc tree, same
// pattern as electron/services/__tests__/LLMHelperNegotiationCoachingGate.test.mjs,
// because the default esbuild bundle inlines both ModesManager and
// EvidenceResolver into a single LLMHelper.js, making their singletons/
// classes unreachable from outside for patching).
//
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 \
//   ./node_modules/.bin/electron --test \
//   electron/llm/__tests__/EvidenceResolverWiringIdentity2026_07_12.test.mjs

import { test, describe, after } from 'node:test';
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

// Same isolated-per-file-tsc-tree trick as LLMHelperNegotiationCoachingGate.
// The default `npm run build:electron` esbuild bundle inlines ModesManager
// AND EvidenceResolver into LLMHelper.js, so their exports are unreachable
// for patching from outside. Compile a per-file CJS tree instead, where
// LLMHelper still resolves both via Node's own require() (and thus its
// module cache), so we can pre-seed fakes into that cache before requiring
// LLMHelper.
const distDir = (() => {
  const bundledLLMHelper = path.resolve(repoRoot, 'dist-electron/electron/LLMHelper.js');
  const isBundled = fs.existsSync(bundledLLMHelper) &&
    fs.readFileSync(bundledLLMHelper, 'utf8').includes('init_ModesManager');
  if (!isBundled) return path.resolve(repoRoot, 'dist-electron');

  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'llmhelper-evidence-dist-'));
  isolatedDistDir = target;
  fs.symlinkSync(
    path.join(repoRoot, 'node_modules'),
    path.join(target, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  try {
    execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch (_tscErr) {
    // expected — tsc returns 1 on type errors in unrelated files; we only
    // need LLMHelper.js + its direct deps to have emitted cleanly.
  }
  if (!fs.existsSync(path.join(target, 'electron/LLMHelper.js'))) {
    throw new Error('tsc emission failed — LLMHelper.js missing from isolated tree');
  }
  // Realpath the tmp dir: on macOS, os.tmpdir() returns a path under /var/...
  // which is itself a symlink to /private/var/...; Node's require() resolves
  // module paths through the realpath, so caching under the pre-realpath
  // path would silently miss when LLMHelper.js requires a sibling module —
  // the fake would sit in the cache under a key nothing ever looks up.
  return fs.realpathSync(target);
})();

const llmHelperPath = path.resolve(distDir, 'electron/LLMHelper.js');
const modesPath = path.resolve(distDir, 'electron/services/ModesManager.js');
const evidenceResolverPath = path.resolve(distDir, 'electron/intelligence/context-os/EvidenceResolver.js');
const intelligenceFlagsPath = path.resolve(distDir, 'electron/intelligence/intelligenceFlags.js');

const cjsRequire = createRequire(import.meta.url);

// --- Electron stub -----------------------------------------------------
// LLMHelper transitively constructs ModelVersionManager which calls
// electron.app.getPath('userData').
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'llmhelper-evidence-test-'));
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

// --- Force the Context-OS evidence-pack flag ON by env, deterministic
// regardless of NODE_ENV/dev-context defaults ------------------------------
process.env.NATIVELY_CONTEXT_OS_EVIDENCE_PACK = '1';

// --- Fake EvidenceResolver module, pre-seeded into the require cache -------
// Resolved via the SAME on-disk path LLMHelper.ts's
// `require('./intelligence/context-os/EvidenceResolver')` resolves to
// (Node's CJS cache is keyed by resolved path), so patching this module's
// exports before LLMHelper is required intercepts the real call site.
let resolveCalls = 0;
let resolveArgsSeen = null;
let nextResolutionPack = null; // set per-test before driving the stream
let throwOnResolve = false;

class FakeEvidenceResolver {
  constructor(deps) {
    this.deps = deps;
    FakeEvidenceResolver.lastConstructedDeps = deps;
  }
  async resolve(request) {
    resolveCalls += 1;
    resolveArgsSeen = request;
    if (throwOnResolve) throw new Error('EVIDENCE_RESOLVER_INJECTED_FAILURE');
    return {
      pack: nextResolutionPack,
      strategy: 'hybrid_rag',
      attemptedSources: ['mode_reference_chunk'],
      retrievedSources: ['mode_reference_chunk'],
      rejectedSources: [],
      confidence: 0.9,
    };
  }
}

const fakeEvidenceResolverModule = new Module(evidenceResolverPath);
fakeEvidenceResolverModule.exports = { EvidenceResolver: FakeEvidenceResolver };
fakeEvidenceResolverModule.loaded = true;
cjsRequire.cache[evidenceResolverPath] = fakeEvidenceResolverModule;

// --- Real intelligenceFlags + context-os modules (needed for a real
// TurnContextContract + flag reads) -----------------------------------------
const { SourceAuthorityKernel, buildDocumentEvidencePackFromBlock } = cjsRequire(
  path.resolve(distDir, 'electron/intelligence/context-os/index.js'),
);

function buildRealContract(question = 'What are the four phases of the project?') {
  const kernel = new SourceAuthorityKernel();
  return kernel.build({
    surface: 'manual_chat',
    question,
    activeModeId: 'evidence-wiring-mode',
    sourceAuthority: 'reference_files_only',
    answerShape: 'list',
    voicePerspective: 'assistant_explanation',
    enforcement: 'enforce',
    hasReferenceFiles: true,
    hasProfileFacts: false,
    hasLiveTranscript: false,
  });
}

function buildFakePack(contract) {
  // A minimal, realistic pack — its object identity is what we assert on,
  // not its exact contents.
  return buildDocumentEvidencePackFromBlock(
    contract,
    [
      '<active_mode_retrieved_context>',
      '  <snippet>',
      '    <source>{"sourceId":"doc-1","fileName":"doc.pdf","chunkIndex":1,"score":0.6}</source>',
      '    <text>The four phases are data prep, fine-tuning, integration, and evaluation.</text>',
      '  </snippet>',
      '</active_mode_retrieved_context>',
    ].join('\n'),
  );
}

// --- Real ModesManager singleton, with legacy-retrieval spies -------------
const { ModesManager } = cjsRequire(modesPath);
const { LLMHelper } = cjsRequire(llmHelperPath);

// NOTE on scope: `_streamChatInner` has an OLDER, orthogonal retrieval call
// site (~line 4417-4432, "DOCUMENT-GROUNDED custom-mode manual chat
// (streaming path)") that unconditionally calls
// buildRetrievedActiveModeContextBlockHybrid whenever
// documentGroundedCustomModeActive is true — this predates the
// evidence-execution-repair and fires for BOTH governed and un-governed
// turns; it feeds a short-lived retrieval used only by the (separate)
// generic-knowledge-intercept bypass check, not the mode-injection block the
// repair guards. It is intentionally out of scope here. We identify it by
// call SHAPE: it always calls with exactly 5 positional args and no trailing
// options object, e.g. (message, undefined, undefined, undefined, true).
// The block the repair actually guards (~line 4680-4726, "single canonical
// retrieval" / legacy hybrid+lexical mode-injection fallback) calls
// buildRetrievedActiveModeContextBlockHybrid with an 8th options-object arg
// ({ forceDocumentGrounding, followUpReferentHint }), and
// buildRetrievedActiveModeContextBlock (lexical) with a 7-arg options object
// too — both distinguishable from the orthogonal early call.
let hybridLegacyCalls = 0; // calls to the block THIS repair guards
let lexicalLegacyCalls = 0; // calls to the block THIS repair guards
let earlyOrthogonalHybridCalls = 0; // the older, out-of-scope call site

function installGovernedDocumentMode() {
  hybridLegacyCalls = 0;
  lexicalLegacyCalls = 0;
  earlyOrthogonalHybridCalls = 0;
  const manager = ModesManager.getInstance();
  const mode = {
    id: 'evidence-wiring-mode',
    name: 'Evidence wiring seminar mode',
    templateType: 'general',
    customContext: 'Use only uploaded seminar files as the source of truth.',
    isActive: true,
    createdAt: '2026-07-12T00:00:00.000Z',
  };
  manager.getActiveMode = () => mode;
  manager.getReferenceFiles = () => [{ id: 'doc-1', fileName: 'doc.pdf', content: 'not used by the fake resolver' }];
  manager.getActiveModeDocumentGroundingInfo = () => ({
    isCustom: true,
    hasReferenceFiles: true,
    documentGrounded: true,
    modeId: mode.id,
    modeName: mode.name,
    hasCustomPrompt: true,
    documentGroundedCustomModeActive: true,
  });
  manager.getActiveModeSystemPromptSuffix = () => '';
  manager.getActiveModePinnedInstructions = () => '';
  // Legacy retrieval spies — a Context-OS-GOVERNED turn must never reach the
  // mode-injection block's hybrid/lexical retrieval (the repair's guarantee).
  manager.buildRetrievedActiveModeContextBlockHybrid = async (...args) => {
    const isGuardedBlockCall = args.length >= 8 && typeof args[7] === 'object' && args[7] !== null;
    if (isGuardedBlockCall) {
      hybridLegacyCalls += 1;
      return 'LEGACY_HYBRID_CONTEXT_SHOULD_NOT_BE_CALLED';
    }
    // The orthogonal early call site — out of scope for this repair.
    earlyOrthogonalHybridCalls += 1;
    return '';
  };
  manager.buildRetrievedActiveModeContextBlock = (...args) => {
    lexicalLegacyCalls += 1;
    return 'LEGACY_LEXICAL_CONTEXT_SHOULD_NOT_BE_CALLED';
  };
  manager.buildActiveModeContextBlock = () => '';
  return mode;
}

// Dispatch spy: uses the `activeCurlProvider` streaming branch (2b), which is
// the SIMPLEST provider path that forwards `userContent` verbatim to a
// spyable method (`executeCustomProvider`). The `customProvider` /
// `streamWithCustom` branch (2a, checked FIRST) discards `userContent`
// entirely and reconstructs its own `combinedMessage` from the raw
// `message`/`context` args — so it can never observe whether the typed
// EvidencePack governed the prompt. We must NOT set `helper.customProvider`
// here, or branch 2a wins over 2b and the typed-pack content never reaches
// the spy.
function attachDispatchSpy(helper) {
  helper.activeCurlProvider = { id: 'spy-curl-provider', name: 'spy', curlCommand: 'noop' };
  helper.getDeniedOutboundScopes = () => [];
  const calls = [];
  helper.executeCustomProvider = async function (_cmd, userContent, systemPrompt, message, context, _img) {
    calls.push({ via: 'executeCustomProvider', userContent: userContent || '', message: message || '', context: context || '', systemPrompt: systemPrompt || '' });
    return 'ok';
  };
  return calls;
}

function buildHelper() {
  return new LLMHelper(undefined, false);
}

async function drainStream(generator) {
  const chunks = [];
  try {
    for await (const chunk of generator) chunks.push(chunk);
  } catch (_err) {
    // swallow — unconfigured-provider errors are not what we're testing
  }
  return chunks;
}

after(() => {
  if (isolatedDistDir) {
    fs.rmSync(isolatedDistDir, { recursive: true, force: true });
  }
});

describe('evidence-execution-repair: EvidenceResolver wiring identity (a524329 regression guard)', () => {
  test('governed turn: EvidenceResolver.resolve() is called EXACTLY ONCE, legacy retrieval is NEVER called', async () => {
    resolveCalls = 0;
    resolveArgsSeen = null;
    throwOnResolve = false;

    const contract = buildRealContract();
    nextResolutionPack = buildFakePack(contract);

    installGovernedDocumentMode();
    const helper = buildHelper();
    const calls = attachDispatchSpy(helper);

    const cogCtx = {
      contract,
      turnQuestion: 'What are the four phases of the project?',
      evidencePack: null,
      modeSnapshot: { modeId: contract.activeModeId, modeName: 'Evidence wiring seminar mode', sourceAuthority: 'reference_files_only' },
      govern: true,
    };

    await drainStream(helper.streamChat(
      'What are the four phases of the project?',
      undefined,
      undefined,
      undefined,
      true,
      false,
      [],
      undefined,
      undefined,
      { answerType: 'list_answer', contextOsGeneration: cogCtx },
    ));

    assert.equal(resolveCalls, 1, 'EvidenceResolver.resolve() must be called EXACTLY ONCE for a governed turn');
    assert.equal(hybridLegacyCalls, 0, 'legacy hybrid retrieval must NEVER run for a governed turn (this is what a524329 broke)');
    assert.equal(lexicalLegacyCalls, 0, 'legacy lexical retrieval must NEVER run for a governed turn (this is what a524329 broke)');

    // Identity: the pack written back onto the SAME cogCtx object the caller
    // passed in must be the EXACT object EvidenceResolver.resolve() returned
    // — not a deep-equal reconstruction (buildDocumentEvidencePackFromBlock
    // would mint a NEW pack with a different object identity, even if its
    // contents happened to match).
    assert.equal(cogCtx.evidencePack, nextResolutionPack, 'cogCtx.evidencePack must be the SAME OBJECT EvidenceResolver.resolve() returned (identity, not deep-equal)');

    // The dispatched prompt must actually be governed by the typed pack (the
    // <evidence_pack> XML), never the legacy retrieval block. userContent
    // (not message/context) carries the governed shaping — see
    // attachDispatchSpy's comment for why executeCustomProvider is used.
    const dispatched = calls.find(c => c.via === 'executeCustomProvider');
    assert.ok(dispatched, 'executeCustomProvider must be reached');
    assert.match(dispatched.userContent, /<evidence_pack/, 'the typed evidence pack must govern the dispatched prompt');
    assert.doesNotMatch(dispatched.userContent, /LEGACY_HYBRID_CONTEXT_SHOULD_NOT_BE_CALLED|LEGACY_LEXICAL_CONTEXT_SHOULD_NOT_BE_CALLED/, 'legacy retrieval text must never reach the prompt for a governed turn');
  });

  test('governed turn: resolver request carries the real turnId/contract/activeMode (wiring reaches the resolver with real data, not stubs)', async () => {
    resolveCalls = 0;
    resolveArgsSeen = null;
    throwOnResolve = false;

    const contract = buildRealContract('What compute controller does the system use?');
    nextResolutionPack = buildFakePack(contract);

    const mode = installGovernedDocumentMode();
    const helper = buildHelper();
    attachDispatchSpy(helper);

    const cogCtx = {
      contract,
      turnQuestion: 'What compute controller does the system use?',
      evidencePack: null,
      modeSnapshot: { modeId: contract.activeModeId, modeName: mode.name, sourceAuthority: 'reference_files_only' },
      govern: true,
    };

    await drainStream(helper.streamChat(
      'What compute controller does the system use?',
      undefined,
      undefined,
      undefined,
      true,
      false,
      [],
      undefined,
      undefined,
      { answerType: 'list_answer', contextOsGeneration: cogCtx },
    ));

    assert.equal(resolveCalls, 1);
    assert.ok(resolveArgsSeen, 'resolver must have been invoked with a request object');
    assert.equal(resolveArgsSeen.turnId, contract.turnId, 'resolver must receive the REAL contract turnId');
    assert.equal(resolveArgsSeen.sourceContract, contract, 'resolver must receive the SAME contract object (identity)');
    assert.equal(resolveArgsSeen.activeMode.modeId, mode.id, 'resolver must receive the real active mode id');
    assert.equal(resolveArgsSeen.question, 'What compute controller does the system use?');
  });

  test('un-governed turn (no contextOsGeneration): legacy retrieval DOES run, EvidenceResolver is NEVER called', async () => {
    resolveCalls = 0;
    resolveArgsSeen = null;
    throwOnResolve = false;
    nextResolutionPack = null;

    installGovernedDocumentMode();
    const helper = buildHelper();
    const calls = attachDispatchSpy(helper);

    await drainStream(helper.streamChat(
      'What are the four phases of the project?',
      undefined,
      undefined,
      undefined,
      true,
      false,
      [],
      undefined,
      undefined,
      { answerType: 'list_answer' }, // no contextOsGeneration at all
    ));

    assert.equal(resolveCalls, 0, 'EvidenceResolver must NOT be called when the turn is not Context-OS-governed');
    assert.ok(hybridLegacyCalls + lexicalLegacyCalls > 0, 'legacy retrieval (hybrid or lexical) must run for an un-governed doc-grounded turn');

    const dispatched = calls.find(c => c.via === 'executeCustomProvider');
    assert.ok(dispatched, 'executeCustomProvider must be reached');
    assert.doesNotMatch(dispatched.userContent, /<evidence_pack/, 'the typed evidence pack must NOT govern an un-governed turn');
  });

  test('un-governed turn (govern: false): legacy retrieval DOES run, EvidenceResolver is NEVER called', async () => {
    resolveCalls = 0;
    resolveArgsSeen = null;
    throwOnResolve = false;
    nextResolutionPack = null;

    const contract = buildRealContract();
    installGovernedDocumentMode();
    const helper = buildHelper();
    attachDispatchSpy(helper);

    const cogCtx = {
      contract,
      turnQuestion: 'What are the four phases of the project?',
      evidencePack: null,
      modeSnapshot: { modeId: contract.activeModeId, modeName: 'x', sourceAuthority: 'reference_files_only' },
      govern: false, // explicitly not governing
    };

    await drainStream(helper.streamChat(
      'What are the four phases of the project?',
      undefined,
      undefined,
      undefined,
      true,
      false,
      [],
      undefined,
      undefined,
      { answerType: 'list_answer', contextOsGeneration: cogCtx },
    ));

    assert.equal(resolveCalls, 0, 'EvidenceResolver must NOT be called when govern is false');
    assert.ok(hybridLegacyCalls + lexicalLegacyCalls > 0, 'legacy retrieval must run when govern is false');
    assert.equal(cogCtx.evidencePack, null, 'evidencePack must remain untouched (null) when govern is false');
  });

  test('governed turn missing immutable question fails closed without legacy retrieval or provider dispatch', async () => {
    resolveCalls = 0;
    resolveArgsSeen = null;
    throwOnResolve = false;

    const contract = buildRealContract();
    nextResolutionPack = buildFakePack(contract);
    installGovernedDocumentMode();
    const helper = buildHelper();
    const calls = attachDispatchSpy(helper);
    const cogCtx = {
      contract,
      turnQuestion: '',
      evidencePack: null,
      modeSnapshot: { modeId: contract.activeModeId, modeName: 'x', sourceAuthority: 'reference_files_only' },
      govern: true,
    };

    await drainStream(helper.streamChat(
      'What are the four phases of the project?',
      undefined,
      undefined,
      undefined,
      true,
      false,
      [],
      undefined,
      undefined,
      { answerType: 'list_answer', contextOsGeneration: cogCtx },
    ));

    assert.equal(resolveCalls, 0, 'a missing immutable question must fail before retrieval');
    assert.equal(hybridLegacyCalls, 0, 'a governed missing-question failure must never fall back to legacy hybrid retrieval');
    assert.equal(lexicalLegacyCalls, 0, 'a governed missing-question failure must never fall back to legacy lexical retrieval');
    assert.equal(calls.find(c => c.via === 'executeCustomProvider'), undefined, 'a governed missing-question failure must not dispatch a provider');
  });

  test('resolver throws → governed turn refuses without legacy retrieval or provider dispatch', async () => {
    resolveCalls = 0;
    resolveArgsSeen = null;
    throwOnResolve = true;
    nextResolutionPack = null;

    const contract = buildRealContract();
    installGovernedDocumentMode();
    const helper = buildHelper();
    const calls = attachDispatchSpy(helper);

    const cogCtx = {
      contract,
      turnQuestion: 'What are the four phases of the project?',
      evidencePack: null,
      modeSnapshot: { modeId: contract.activeModeId, modeName: 'x', sourceAuthority: 'reference_files_only' },
      govern: true,
    };

    await drainStream(helper.streamChat(
      'What are the four phases of the project?',
      undefined,
      undefined,
      undefined,
      true,
      false,
      [],
      undefined,
      undefined,
      { answerType: 'list_answer', contextOsGeneration: cogCtx },
    ));

    assert.equal(resolveCalls, 1, 'resolver must have been attempted once');
    assert.equal(hybridLegacyCalls, 0, 'a governed resolver failure must never fall back to legacy hybrid retrieval');
    assert.equal(lexicalLegacyCalls, 0, 'a governed resolver failure must never fall back to legacy lexical retrieval');
    const dispatched = calls.find(c => c.via === 'executeCustomProvider');
    assert.equal(dispatched, undefined, 'a governed resolver failure must return deterministic refusal before provider dispatch');
  });

  // Evidence-execution-repair (2026-07-12) — regression guard for a SECOND,
  // distinct defect found during Phase 12 live-provider benchmarking:
  // LLMHelper.ts constructed EvidenceResolver's `hybridRetriever` dependency
  // from a FRESH `new ModeContextRetriever()` instead of going through
  // ModesManager's own singleton retriever. A freshly-constructed instance's
  // `_sharedEmbeddingPipeline` is always null (that field is only ever wired
  // once, on ModesManager's own instance, by main.ts at RAG-manager init),
  // so every retrieveHybrid() call on the orphaned instance silently returned
  // `{ chunks: [], usedFallback: true }` — EvidenceResolver then reported
  // 'insufficient' evidence and the model said "I could not find that in the
  // retrieved sections" even though the mode's files were genuinely indexed
  // and a DIFFERENT retrieval call path (ModesManager.buildRetrievedActive...
  // Hybrid / the __e2e__:inspect-retrieval diagnostic) proved real, well-
  // scored chunks existed for the exact same query. Fixed by routing through
  // `ModesManager.retrieveHybridRaw()`, a thin passthrough to the SAME shared-
  // pipeline-wired singleton instance every other retrieval call site uses.
  //
  // This test does NOT drive a real hybrid retrieval (that requires a live
  // embedding pipeline) — it proves the WIRING is correct: the function
  // object passed as `deps.hybridRetriever.retrieveHybrid` must delegate to
  // `modesMgr.retrieveHybridRaw`, not construct or call anything else. A
  // regression back to `new ModeContextRetriever()` makes this spy count stay
  // at 0 even though the resolver still resolves successfully (fed by the
  // fake resolver in this test suite) — exactly the silent-fallback shape
  // that made the real bug invisible to the OTHER tests in this file, which
  // all use a FakeEvidenceResolver that never actually calls
  // deps.hybridRetriever.retrieveHybrid at all.
  test('governed turn: EvidenceResolver is constructed with a hybridRetriever wired to modesMgr.retrieveHybridRaw, not an orphaned ModeContextRetriever instance', async () => {
    resolveCalls = 0;
    resolveArgsSeen = null;
    throwOnResolve = false;

    const contract = buildRealContract();
    nextResolutionPack = buildFakePack(contract);

    const mode = installGovernedDocumentMode();
    const manager = ModesManager.getInstance();
    let retrieveHybridRawCalls = 0;
    let retrieveHybridRawArgs = null;
    const sentinelHybridResult = { chunks: [], formattedContext: '', usedFallback: false, usedHybrid: true };
    manager.retrieveHybridRaw = async (m, files, opts) => {
      retrieveHybridRawCalls += 1;
      retrieveHybridRawArgs = { mode: m, files, opts };
      return sentinelHybridResult;
    };

    const helper = buildHelper();
    attachDispatchSpy(helper);

    const cogCtx = {
      contract,
      turnQuestion: 'What are the four phases of the project?',
      evidencePack: null,
      modeSnapshot: { modeId: contract.activeModeId, modeName: mode.name, sourceAuthority: 'reference_files_only' },
      govern: true,
    };

    await drainStream(helper.streamChat(
      'What are the four phases of the project?',
      undefined,
      undefined,
      undefined,
      true,
      false,
      [],
      undefined,
      undefined,
      { answerType: 'list_answer', contextOsGeneration: cogCtx },
    ));

    assert.equal(resolveCalls, 1, 'EvidenceResolver.resolve() must still be called once');
    assert.ok(resolveArgsSeen, 'resolver must have been constructed and invoked');

    // Drive the ACTUAL hybridRetriever the resolver was constructed with —
    // this is the direct proof that LLMHelper wired it to modesMgr's own
    // retrieveHybridRaw rather than a disconnected instance. If this call
    // does NOT reach our spy, the wiring has regressed back to constructing
    // its own ModeContextRetriever (or some other orphaned path).
    const deps = resolveArgsSeen && FakeEvidenceResolver.lastConstructedDeps;
    assert.ok(deps && typeof deps.hybridRetriever?.retrieveHybrid === 'function', 'resolver deps must include a hybridRetriever.retrieveHybrid function');
    const result = await deps.hybridRetriever.retrieveHybrid(mode, [{ id: 'doc-1' }], { query: 'probe' });
    assert.equal(retrieveHybridRawCalls, 1, 'the wired hybridRetriever.retrieveHybrid must delegate to modesMgr.retrieveHybridRaw exactly once');
    assert.equal(result, sentinelHybridResult, 'the delegated call must return modesMgr.retrieveHybridRaw\'s result verbatim (same object identity)');
    assert.ok(retrieveHybridRawArgs, 'retrieveHybridRaw must have been called with real arguments');
  });
});
