// Evidence-execution-repair (2026-07-12) — regression guard for a source-
// ownership PRECEDENCE bug found during Phase 12 live-provider benchmarking.
//
// THE BUG: two independent source-ownership systems can both fire
// `clarify` for the same turn but disagree on WHAT to say:
//
//   - `sourceOwnership.resolveSourceOwnership()` (electron/llm/sourceOwnership.ts,
//     the legacy, mode-aware arbiter) correctly resolves a SPECIFIC decision
//     for "explicit résumé/JD ask under a reference_files_primary mode with
//     no profile loaded": owner='reference_files',
//     shouldClarifyInsteadOfProfile=true. Its message
//     (buildSourceSwitchClarification) names the requested source and
//     explains how to switch: "This mode only answers from your uploaded
//     material, so I'm not pulling from your résumé here. Switch to a
//     profile or interview mode and I'll answer about your own projects
//     and experience."
//
//   - `SourceAuthorityKernel.resolveSourceOwner()` (electron/intelligence/
//     context-os/SourceAuthorityKernel.ts, the newer Context-OS kernel)
//     resolves `sourceOwner: 'clarify'` for the SAME input (its
//     `reference_files_primary` branch: `userExplicitSource === 'profile'`
//     + not a strict mode + `!hasProfileFacts` → 'clarify'). Its message
//     (buildSourceClarification) is a GENERIC multi-universe disambiguation:
//     "Do you mean the project in your uploaded document, or the project
//     discussed in the meeting?" — which never even mentions the résumé the
//     user actually asked about.
//
// Both `ipcHandlers.ts` (manual chat) and `IntelligenceEngine.ts` (WTA) ran
// the kernel's clarification short-circuit FIRST and returned before the
// legacy resolver's specific message ever got a chance to run — so the
// wrong, generic message always won when `contextOsPropertyValidation` is
// on (the dev/test default). Confirmed live: a benchmark against the real
// Gemini provider showed the wrong "Do you mean..." text for both
// "Based only on my résumé..." and "According to the JD..." explicit-switch
// questions.
//
// THE FIX: both short-circuits now check the legacy resolver's
// `shouldClarifyInsteadOfProfile` FIRST — when true, its specific message
// wins (via `buildSourceSwitchClarification`); the kernel's generic message
// remains the answer ONLY for genuine multi-universe ambiguity that the
// legacy resolver has no opinion on (an ambiguous noun with no explicit
// switch at all).
//
// This test proves two things:
//   1. BEHAVIORAL: the exact incident scenario — both resolvers, driven with
//      real (compiled) logic — genuinely disagree (this is the bug's
//      precondition; if this stops reproducing, the underlying resolvers
//      changed and this test's premise needs revisiting, not silent
//      deletion).
//   2. WIRING: both source files consult the legacy resolver's
//      shouldClarifyInsteadOfProfile BEFORE falling through to the kernel's
//      generic buildSourceClarification, structurally verified against the
//      source (the repo's existing grep-test pattern — see
//      ContextOsManualChatWiring.test.mjs for precedent).
//
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 \
//   ./node_modules/.bin/electron --test \
//   electron/intelligence/__tests__/SourceOwnershipClarificationPrecedence2026_07_12.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distDir = path.resolve(repoRoot, 'dist-electron/electron');

const { SourceAuthorityKernel, buildSourceClarification } = await import(
  pathToFileURL(path.join(distDir, 'intelligence/context-os/index.js')).href
);
const { resolveSourceOwnership, buildSourceSwitchClarification } = await import(
  pathToFileURL(path.join(distDir, 'llm/sourceOwnership.js')).href
);
const { buildCustomModeExecutionContract } = await import(
  pathToFileURL(path.join(distDir, 'llm/customModeExecutionContract.js')).href
);

const QUESTION = 'Based only on my résumé, what is my strongest project?';

function buildLegacyContract() {
  return buildCustomModeExecutionContract({
    question: QUESTION,
    streamRoute: 'manual_chat_stream',
    modeId: 'mode_incident_repro',
    answerType: 'project_answer',
    isCustomMode: true,
    isDocGroundedCustomModeActive: true,
    hasReferenceFiles: true,
    hasCustomPrompt: true,
    hasLiveTranscript: false,
    hasProfileFacts: false, // the exact incident precondition — no profile loaded
    hasMeetingRag: false,
    hasLongTermMemory: false,
    persistedSourceAuthority: 'reference_files_primary',
    userExplicitSource: 'profile',
  });
}

function buildKernelDecision() {
  const kernel = new SourceAuthorityKernel();
  return kernel.build({
    surface: 'manual_chat',
    question: QUESTION,
    activeModeId: 'mode_incident_repro',
    sourceAuthority: 'reference_files_primary',
    answerShape: 'general',
    voicePerspective: 'first_person_candidate',
    enforcement: 'observe',
    hasReferenceFiles: true,
    hasProfileFacts: false, // same precondition
    hasLiveTranscript: false,
    userExplicitSource: 'profile',
  });
}

describe('INCIDENT PRECONDITION: the two source-ownership resolvers genuinely disagree', () => {
  test('legacy resolveSourceOwnership: owner=reference_files, shouldClarifyInsteadOfProfile=true (SPECIFIC — the mode denied an explicit switch)', () => {
    const legacyContract = buildLegacyContract();
    const decision = resolveSourceOwnership({
      question: QUESTION,
      contract: legacyContract,
      profileContextPolicy: 'allowed',
      answerType: 'project_answer',
      hasProfileFacts: false,
    });
    assert.equal(decision.owner, 'reference_files');
    assert.equal(decision.explicitProfileAsk, true);
    assert.equal(decision.shouldClarifyInsteadOfProfile, true);
    assert.match(decision.reason, /explicit_profile_ask_no_facts_clarify/);
  });

  test('SourceAuthorityKernel: sourceOwner=clarify (GENERIC — kernel has no "denied switch" concept)', () => {
    const contract = buildKernelDecision();
    assert.equal(contract.sourceOwner, 'clarify');
  });

  test('the two resolvers produce DIFFERENT clarification text when queried independently', () => {
    const legacyDecision = resolveSourceOwnership({
      question: QUESTION,
      contract: buildLegacyContract(),
      profileContextPolicy: 'allowed',
      answerType: 'project_answer',
      hasProfileFacts: false,
    });
    const legacyText = buildSourceSwitchClarification(legacyDecision.owner);
    const kernelText = buildSourceClarification({
      hasReferenceFiles: true,
      hasProfileFacts: false,
      hasLiveTranscript: false,
    });
    assert.notEqual(legacyText, kernelText, 'the bug\'s precondition: two different clarification strings exist for the same turn');
    assert.match(legacyText, /uploaded material/i, 'the CORRECT message names the actual source (uploaded material)');
    assert.doesNotMatch(kernelText, /résumé|resume/i, 'the WRONG generic message never mentions the résumé the user actually asked about');
  });
});

describe('FIX: manual-chat and WTA short-circuits prefer the specific legacy message over the generic kernel one', () => {
  const ipcSource = fs.readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  const engineSource = fs.readFileSync(path.resolve(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');

  test('WIRING (manual chat): the clarification short-circuit checks manualOwnership.shouldClarifyInsteadOfProfile before buildSourceClarification', () => {
    // The short-circuit block starts at the kernel's sourceOwner === 'clarify'
    // check and must, within that block, consult manualOwnership's SPECIFIC
    // decision before falling through to the kernel's generic builder.
    const shortCircuitStart = ipcSource.indexOf("turnContract.sourceOwner === 'clarify'");
    assert.ok(shortCircuitStart >= 0, 'clarification short-circuit not found');
    const shortCircuitBlock = ipcSource.slice(shortCircuitStart, shortCircuitStart + 2500);
    assert.match(
      shortCircuitBlock,
      /manualOwnership\?\.shouldClarifyInsteadOfProfile\s*\?\s*require\('\.\/llm\/sourceOwnership'\)\.buildSourceSwitchClarification\(manualOwnership\.owner\)\s*:\s*buildSourceClarification/,
      'manual-chat short-circuit must prefer manualOwnership.shouldClarifyInsteadOfProfile\'s specific message over the kernel\'s generic buildSourceClarification',
    );
  });

  test('WIRING (WTA): the clarification short-circuit checks wtaOwnershipDecision.shouldClarifyInsteadOfProfile before buildSourceClarification', () => {
    const shortCircuitStart = engineSource.indexOf("wtaTurnContract.sourceOwner === 'clarify'");
    assert.ok(shortCircuitStart >= 0, 'WTA clarification short-circuit not found');
    const shortCircuitBlock = engineSource.slice(shortCircuitStart, shortCircuitStart + 2500);
    assert.match(
      shortCircuitBlock,
      /wtaOwnershipDecision\?\.shouldClarifyInsteadOfProfile\s*\?\s*require\('\.\/llm\/sourceOwnership'\)\.buildSourceSwitchClarification\(wtaOwnershipDecision\.owner\)\s*:\s*buildSourceClarification/,
      'WTA short-circuit must prefer wtaOwnershipDecision.shouldClarifyInsteadOfProfile\'s specific message over the kernel\'s generic buildSourceClarification',
    );
  });

  test('WIRING (WTA): wtaOwnershipDecision is populated from the SAME _wtaOwn the profile-fast-path gate above already computes (no second, divergent resolver call)', () => {
    assert.match(
      engineSource,
      /wtaOwnershipDecision\s*=\s*_wtaOwn;/,
      'wtaOwnershipDecision must be assigned from the existing _wtaOwn — a second independent resolveSourceOwnership() call for the same turn would risk drifting from the fast-path gate\'s own decision',
    );
  });
});

describe('SANITY: genuine multi-universe ambiguity (no explicit switch) still uses the kernel\'s generic clarification', () => {
  test('an ambiguous "the project" with reference files + profile + transcript all present, NO explicit switch, still resolves via the kernel path (legacy resolver has no opinion)', () => {
    const decision = resolveSourceOwnership({
      question: 'What are the project timelines?',
      contract: buildCustomModeExecutionContract({
        question: 'What are the project timelines?',
        streamRoute: 'manual_chat_stream',
        modeId: 'mode_ambiguous',
        answerType: 'unknown_answer',
        isCustomMode: false,
        isDocGroundedCustomModeActive: false,
        hasReferenceFiles: true,
        hasCustomPrompt: false,
        hasLiveTranscript: true,
        hasProfileFacts: true,
        hasMeetingRag: false,
        hasLongTermMemory: false,
        persistedSourceAuthority: null,
      }),
      profileContextPolicy: 'allowed',
      answerType: 'unknown_answer',
      hasProfileFacts: true,
    });
    // No explicit ask → the legacy resolver never sets
    // shouldClarifyInsteadOfProfile, so the fix's `?:` correctly falls
    // through to the kernel's generic disambiguation for this case.
    assert.equal(decision.explicitProfileAsk, false);
    assert.equal(decision.shouldClarifyInsteadOfProfile, false);
  });
});
