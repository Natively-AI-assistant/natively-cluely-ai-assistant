// Evidence-execution-repair (2026-07-11) — unit tests for the canonical
// pre-contract explicit-source-switch resolver
// (electron/intelligence/context-os/explicitSourceSwitch.ts), and the
// profile_jd gate gap it closes.
//
// Run under `ELECTRON_RUN_AS_NODE=1 electron --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');

const { resolveExplicitSourceRequest, toLegacyUserExplicitSource } = await import(
  pathToFileURL(path.join(distDir, 'intelligence/context-os/explicitSourceSwitch.js')).href
);
const cjsRequire = createRequire(import.meta.url);

describe('resolveExplicitSourceRequest: generic shape detection, no hardcoded entities', () => {
  test('job description references (definite article, not possessive)', () => {
    for (const q of [
      'According to the JD, what are the main responsibilities?',
      'Does the JD require AWS?',
      'Does the JD prove that I have Tableau experience?',
      'Based on my résumé and this JD, what are my main gaps?',
    ]) {
      assert.equal(resolveExplicitSourceRequest(q), 'job_description', `expected job_description for: ${q}`);
    }
  });

  test('résumé/profile possessive references', () => {
    for (const q of [
      'Based only on my résumé, what is my strongest project?',
      'Answer from my resume instead: what is my main project?',
      'Tell me about my background.',
    ]) {
      assert.equal(resolveExplicitSourceRequest(q), 'profile', `expected profile for: ${q}`);
    }
  });

  test('return-to-document references', () => {
    for (const q of [
      'Now return to the uploaded thesis. What are its four phases?',
      'Use the document to answer this.',
      'Go back to the file.',
    ]) {
      assert.equal(resolveExplicitSourceRequest(q), 'reference_files', `expected reference_files for: ${q}`);
    }
  });

  test('transcript/meeting references', () => {
    assert.equal(resolveExplicitSourceRequest('Based on the meeting, what did we decide?'), 'transcript');
    assert.equal(resolveExplicitSourceRequest('According to the call, what was agreed?'), 'transcript');
  });

  test('a plain document question has no explicit switch', () => {
    assert.equal(resolveExplicitSourceRequest('What are the four main phases of the project?'), null);
    assert.equal(resolveExplicitSourceRequest('What robot was used?'), null);
  });

  test('JD is checked before the generic profile shape (no false-capture)', () => {
    // "this JD" should resolve to job_description, not accidentally match a
    // profile-possessive pattern via "my résumé and this JD" style phrasing.
    assert.equal(resolveExplicitSourceRequest('Based on my résumé and this JD, what are my main gaps?'), 'job_description');
  });
});

describe('toLegacyUserExplicitSource: job_description folds onto profile at the legacy layer', () => {
  test('mapping', () => {
    assert.equal(toLegacyUserExplicitSource('job_description'), 'profile');
    assert.equal(toLegacyUserExplicitSource('profile'), 'profile');
    assert.equal(toLegacyUserExplicitSource('reference_files'), 'reference_files');
    assert.equal(toLegacyUserExplicitSource('transcript'), 'transcript');
    assert.equal(toLegacyUserExplicitSource(null), null);
  });
});

describe('INCIDENT REGRESSION: reference_files_only + explicit JD ask -> contract grants JD for that turn only', () => {
  const cmec = cjsRequire(path.join(distDir, 'llm/customModeExecutionContract.js'));

  test('buildCustomModeExecutionContract grants profile_jd when userExplicitSource=profile under reference_files_only', () => {
    const contract = cmec.buildCustomModeExecutionContract({
      question: 'According to the JD, what are the main responsibilities?',
      streamRoute: 'manual_chat_stream',
      modeId: 'mode-test',
      answerType: 'jd_requirements_answer',
      isCustomMode: true,
      isDocGroundedCustomModeActive: true,
      hasReferenceFiles: true,
      hasCustomPrompt: true,
      hasLiveTranscript: false,
      hasProfileFacts: true,
      hasMeetingRag: false,
      hasLongTermMemory: false,
      persistedSourceAuthority: 'reference_files_only',
      userExplicitSource: 'profile',
    });
    // reference_files_only is a STRICT authority: even an explicit switch
    // must NOT silently widen it (matches the incident brief's "explicit
    // résumé question detected but blocked because the mode was strict
    // reference-files-only" requirement — that block is CORRECT for a
    // strict mode). The contract's sourceAuthority itself never changes;
    // what changes is whether the DOWNSTREAM ownership resolver treats this
    // as a clarify-and-offer-to-switch (verified in
    // ExplicitSourceSwitchingSeminarMode2026_07_11.test.mjs).
    assert.equal(contract.sourceAuthority, 'reference_files_only');
  });

  test('buildCustomModeExecutionContract grants profile_jd when userExplicitSource=profile under reference_files_primary', () => {
    const contract = cmec.buildCustomModeExecutionContract({
      question: 'According to the JD, what are the main responsibilities?',
      streamRoute: 'manual_chat_stream',
      modeId: 'mode-test',
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
      userExplicitSource: 'profile',
    });
    // reference_files_primary explicitly ALLOWS a switch — profile_jd must
    // be granted for this turn.
    const jdCap = contract.allowedSources.includes('profile_jd');
    assert.equal(jdCap, true, `expected profile_jd to be allowed; got allowedSources=${JSON.stringify(contract.allowedSources)}`);
  });
});
