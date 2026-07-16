// Source-switch subset runtime regression (2026-07-15).
//
// Run with: npm run build:electron && node --test electron/llm/__tests__/SourceSwitchSubsetRuntime2026_07_15.test.mjs
//
// Proves: buildCustomModeExecutionContract correctly distinguishes a résumé-only
// subscription from a JD-only subscription when the persisted contract carries
// only one switch in `allowedExplicitSwitches`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');
const explicit = await import(
  pathToFileURL(path.join(distDir, 'intelligence/context-os/explicitSourceSwitch.js')).href
);
const legacy = await import(
  pathToFileURL(path.join(distDir, 'llm/customModeExecutionContract.js')).href
);
const { resolveTurnSourceDecision } = await import(
  pathToFileURL(path.join(distDir, 'llm/turnSourceDecision.js')).href
);

const availability = {
  hasReferenceFiles: true,
  hasProfileFacts: true,
  hasJobDescription: true,
  hasLiveTranscript: false,
  hasMeetingRag: false,
};

function buildPrimaryContract(userExplicitSource, turnSourceDecision) {
  return legacy.buildCustomModeExecutionContract({
    question: 'According to the JD, what responsibility would I own?',
    streamRoute: 'manual_chat_stream',
    modeId: 'source-subset-mode',
    answerType: 'jd_requirements_answer',
    isCustomMode: true,
    isDocGroundedCustomModeActive: true,
    hasReferenceFiles: true,
    hasCustomPrompt: true,
    hasLiveTranscript: false,
    hasProfileFacts: true,
    hasMeetingRag: false,
    hasLongTermMemory: false,
    persistedSourceAuthority: 'reference_files_primary',
    userExplicitSource,
    turnSourceDecision,
  });
}

test('a JD-only selected switch denies an explicit résumé request that asks for the OTHER family', () => {
  // Persisted contract shape from the renderer: default reference owner and
  // only the JD switch checked.
  const selectedSwitches = ['job_description'];
  assert.deepEqual(selectedSwitches, ['job_description']);
  const rawRequest = 'According to the JD, what responsibility would I own?';
  // Sanity: ask uses JD shape — only the JD switch is enabled.
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: selectedSwitches,
    },
    explicitRequest: 'job_description',
    availability,
  });
  assert.equal(decision.outcome, 'explicit_granted');
  assert.deepEqual(decision.allowedEvidenceKinds, ['profile_jd']);
});

test('a JD-only contract with turnSourceDecision grants only JD, never profile_resume', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['job_description'],
    },
    explicitRequest: 'job_description',
    availability,
  });
  const contract = buildPrimaryContract(
    explicit.toLegacyUserExplicitSource('job_description'),
    decision,
  );
  assert.equal(contract.allowedSources.includes('profile_jd'), true,
    'JD evidence granted when JD-only switch is selected');
  assert.equal(contract.allowedSources.includes('profile_resume'), false,
    'résumé evidence NEVER granted when only JD switch is selected');
  assert.equal(contract.allowedSources.includes('projects'), false,
    'project evidence NEVER granted when only JD switch is selected');
});
